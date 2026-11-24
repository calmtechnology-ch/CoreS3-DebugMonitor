#include <Arduino.h>
#include <WiFi.h>
#include <M5Unified.h>
#include "AppConfig.h"
#include "DebugAgent.h"

// State machine for demo simulation
enum DemoState {
    DEMO_STATE_IDLE,
    DEMO_STATE_RUNNING,
    DEMO_STATE_PROCESSING
};

static DemoState currentDemoState = DEMO_STATE_IDLE;
static uint32_t lastStateChangeMs = 0;
static uint32_t lastDisplayUpdateMs = 0;
static float customWaveAngle = 0.0f;
static volatile bool concurrentTaskRunning = false;

// Touch button geometries (320x240 landscape)
struct TouchBtn {
    int x, y, w, h;
    const char* label;
    uint32_t color;
};

// 4 Interactive Touch Buttons on CoreS3 screen
static const TouchBtn btnLog        = {   8, 185,  72, 45, "LOG",    0x03E0 }; // Green
static const TouchBtn btnBurst200   = {  85, 185,  72, 45, "BURST",  0xFD20 }; // Orange
static const TouchBtn btnConcurrent = { 162, 185,  72, 45, "TASK 2", 0x04FF }; // Cyan
static const TouchBtn btnStress     = { 239, 185,  72, 45, "STRESS", 0xF800 }; // Red

static bool isTouchInside(int tx, int ty, const TouchBtn& btn) {
    return (tx >= btn.x && tx < (btn.x + btn.w) && ty >= btn.y && ty < (btn.y + btn.h));
}

// FreeRTOS Concurrent Worker Task (C05 validation)
static void concurrentWorkerTask(void* pvParameters) {
    concurrentTaskRunning = true;
    debug.info("TASK2", "Tâche secondaire FreeRTOS démarrée sur Core 1");

    for (int i = 1; i <= 50; i++) {
        debug.infof("TASK2", "Message concurrent #%d/50 (accentué: déconnexion, réémission)", i);
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    debug.info("TASK2", "Tâche secondaire FreeRTOS terminée avec succès");
    concurrentTaskRunning = false;
    vTaskDelete(NULL);
}

// Trigger test modes
static void runBurst200() {
    Serial.println("[TEST] Starting burst of 200 logs...");
    debug.info("BURST", "Début de la rafale de 200 messages");
    for (int i = 1; i <= 200; i++) {
        debug.infof("BURST", "Message #%d/200: test de débit et de budget", i);
    }
    debug.info("BURST", "Fin de la rafale de 200 messages");
    Serial.println("[TEST] Burst completed.");
}

static void runStressAndSaturation() {
    Serial.println("[TEST] Starting stress & special character test...");
    // Special characters & French accents
    debug.info("STRESS", "Test accents français: à, é, è, ê, ë, î, ï, ô, ù, û, ç, œ, €");
    debug.warn("STRESS", "Test caractères contrôle JSON: \"guillemets\", \\antislash\\, tab\tet saut\nde ligne");

    // Long message (380+ chars)
    debug.infof("STRESS", "Message long test: %s %s %s %s",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
        "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
        "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
        "Excepteur sint occaecat cupidatat non proident.");

    // Controlled buffer saturation: push fast messages until dropped count increases
    debug.warn("SATURATE", "Injection rapide de messages pour saturation contrôlée");
    for (int i = 1; i <= 150; i++) {
        debug.infof("SATURATE", "Message de saturation #%d: charge maximale du buffer circulaire PSRAM", i);
    }

    Serial.println("[TEST] Stress test completed.");
}

static void runConcurrentLogging() {
    if (concurrentTaskRunning) {
        Serial.println("[TEST] Task 2 is already running!");
        return;
    }
    xTaskCreatePinnedToCore(concurrentWorkerTask, "DbgTask2", 4096, NULL, 1, NULL, 1);
}

static void drawUI() {
    M5.Display.startWrite();

    // Header banner
    M5.Display.fillRect(0, 0, 320, 26, 0x18E3); // Dark slate blue
    M5.Display.setTextColor(0xFFFF, 0x18E3);
    M5.Display.setTextDatum(top_left);
    M5.Display.drawString("CoreS3 Debug Monitor", 8, 5);
    M5.Display.setTextDatum(top_right);
    M5.Display.drawString("v0.1.0.1", 312, 5);

    // Network & Diagnostics Area (black background)
    M5.Display.fillRect(0, 26, 320, 155, 0x0000);
    M5.Display.setTextDatum(top_left);
    M5.Display.setTextColor(0xAD55, 0x0000); // Gray text

    // Line 1: IP & Server
    char line1[64];
    String localIp = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "Not connected";
    snprintf(line1, sizeof(line1), "IP: %s", localIp.c_str());
    M5.Display.drawString(line1, 8, 30);

    char line2[64];
    snprintf(line2, sizeof(line2), "PC: %s:%d", DEBUG_HOST, DEBUG_PORT);
    M5.Display.drawString(line2, 8, 48);

    // Line 2: Connection Status & Handshake
    const char* stateStr = debug.getStateString();
    uint32_t stateColor = debug.isConnected() ? 0x07E0 : 0xF800; // Green or Red
    M5.Display.drawString("Transport: ", 8, 66);
    M5.Display.setTextColor(stateColor, 0x0000);
    M5.Display.drawString(stateStr, 80, 66);

    // Line 3: Memory Info
    M5.Display.setTextColor(0xFFFF, 0x0000);
    char memLine[64];
    snprintf(memLine, sizeof(memLine), "SRAM: %u KB  PSRAM: %u KB",
             (unsigned int)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) / 1024),
             (unsigned int)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
    M5.Display.drawString(memLine, 8, 85);

    // Line 4: Transmitted & Dropped & Buffer Used
    DebugStats stats = debug.getStats();
    char statsLine[64];
    snprintf(statsLine, sizeof(statsLine), "Sent: %lu | Drop: %lu | Buf: %lu B",
             (unsigned long)stats.messagesSent, (unsigned long)stats.messagesDropped,
             (unsigned long)stats.bufferUsed);
    M5.Display.drawString(statsLine, 8, 103);

    // Line 5: Timing & Budget
    char timingLine[64];
    snprintf(timingLine, sizeof(timingLine), "Upd: %lu us (Max: %lu | >200: %lu)",
             (unsigned long)stats.avgUpdateUs, (unsigned long)stats.maxUpdateUs,
             (unsigned long)stats.budgetOverruns);
    M5.Display.setTextColor(0x07FF, 0x0000); // Cyan
    M5.Display.drawString(timingLine, 8, 121);

    // Line 6: State & Help hint
    char hintLine[64];
    const char* stNames[] = { "IDLE", "RUNNING", "PROCESSING" };
    snprintf(hintLine, sizeof(hintLine), "State: %s | Serial 'r': Report",
             stNames[currentDemoState]);
    M5.Display.setTextColor(0xFFE0, 0x0000); // Yellow
    M5.Display.drawString(hintLine, 8, 140);

    // Draw Touch Buttons
    const TouchBtn* buttons[4] = { &btnLog, &btnBurst200, &btnConcurrent, &btnStress };
    for (int i = 0; i < 4; i++) {
        const TouchBtn* b = buttons[i];
        M5.Display.fillRoundRect(b->x, b->y, b->w, b->h, 5, b->color);
        M5.Display.setTextColor(0xFFFF, b->color);
        M5.Display.setTextDatum(middle_center);
        M5.Display.drawString(b->label, b->x + (b->w / 2), b->y + (b->h / 2));
    }

    M5.Display.endWrite();
}

void setup() {
    auto cfg = M5.config();
    M5.begin(cfg);

    // CoreS3 Display rule: native landscape is rotation 0 (320x240)
    // Never use setRotation(1) on CoreS3 as it rotates to portrait (240x320)
    M5.Display.setRotation(0);
    M5.Display.fillScreen(0x0000);

    Serial.begin(115200);
    delay(200);
    Serial.println("\n[SYSTEM] CoreS3-DebugMonitor v0.1.0.1 starting...");

    // Initial Wi-Fi connection
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);

    // Initialize DebugAgent
    DebugConfig dbgCfg;
    dbgCfg.host = DEBUG_HOST;
    dbgCfg.port = DEBUG_PORT;
    dbgCfg.deviceName = DEVICE_NAME;
    dbgCfg.appName = APP_NAME;
    dbgCfg.appVersion = "0.1.0.1";
    dbgCfg.minLevel = DEBUG_LEVEL_TRACE;
    dbgCfg.usePsram = true;
    dbgCfg.allowSramFallback = false;

    if (debug.begin(dbgCfg)) {
        debug.info("SYSTEM", "CoreS3-DebugMonitor v0.1.0.1 initialized");
        debug.state("DEMO_STATE", "IDLE");
        Serial.printf("[SYSTEM] DebugAgent initialized with BootId: %s\n", debug.getBootId());
    } else {
        Serial.println("[SYSTEM] ERROR: Failed to initialize DebugAgent (PSRAM unavailable)");
    }

    drawUI();
}

void loop() {
    M5.update();

    // Check Touch input
    auto touchCount = M5.Touch.getCount();
    if (touchCount > 0) {
        auto detail = M5.Touch.getDetail(0);
        if (detail.wasPressed()) {
            int tx = detail.x;
            int ty = detail.y;

            if (isTouchInside(tx, ty, btnLog)) {
                debug.info("USER", "Bouton tactile [LOG] actionné");
                Serial.println("[TOUCH] LOG pressed");
            } else if (isTouchInside(tx, ty, btnBurst200)) {
                runBurst200();
            } else if (isTouchInside(tx, ty, btnConcurrent)) {
                runConcurrentLogging();
            } else if (isTouchInside(tx, ty, btnStress)) {
                runStressAndSaturation();
            }
        }
    }

    // Check Serial commands (e.g. 'r' prints report)
    if (Serial.available()) {
        char ch = (char)Serial.read();
        if (ch == 'r' || ch == 'R' || ch == 'd' || ch == 'D') {
            debug.printReport(Serial);
        } else if (ch == 'b' || ch == 'B') {
            runBurst200();
        } else if (ch == 's' || ch == 'S') {
            runStressAndSaturation();
        } else if (ch == 'c' || ch == 'C') {
            runConcurrentLogging();
        }
    }

    // Update DebugAgent (handles transport, queuing, cooperative non-blocking network transmission)
    debug.update();

    uint32_t now = millis();

    // Demo state machine: IDLE -> RUNNING -> PROCESSING -> IDLE every 3.5 seconds
    if (now - lastStateChangeMs >= 3500) {
        lastStateChangeMs = now;
        switch (currentDemoState) {
            case DEMO_STATE_IDLE:
                currentDemoState = DEMO_STATE_RUNNING;
                debug.state("DEMO_STATE", "RUNNING");
                debug.trace("STATE", "Transition: IDLE -> RUNNING");
                break;
            case DEMO_STATE_RUNNING:
                currentDemoState = DEMO_STATE_PROCESSING;
                debug.state("DEMO_STATE", "PROCESSING");
                debug.debug("STATE", "Transition: RUNNING -> PROCESSING");
                break;
            case DEMO_STATE_PROCESSING:
                currentDemoState = DEMO_STATE_IDLE;
                debug.state("DEMO_STATE", "IDLE");
                debug.info("STATE", "Transition: PROCESSING -> IDLE");
                break;
        }

        // Custom evolving metric (sine curve)
        customWaveAngle += 0.2f;
        if (customWaveAngle > 6.2831f) customWaveAngle = 0.0f;
        double simulatedTemp = 24.0 + 5.0 * sin(customWaveAngle);
        debug.metric("temperature", simulatedTemp);
        debug.metric("cpu_load", 15.0 + 10.0 * cos(customWaveAngle));
    }

    // Refresh LCD display at 5 Hz
    if (now - lastDisplayUpdateMs >= 200) {
        lastDisplayUpdateMs = now;
        drawUI();
    }

    delay(5);
}
