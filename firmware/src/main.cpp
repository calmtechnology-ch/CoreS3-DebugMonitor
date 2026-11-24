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

// Touch button geometries (320x240 landscape)
struct TouchBtn {
    int x, y, w, h;
    const char* label;
    uint32_t color;
};

static const TouchBtn btnLog   = {  10, 185,  95, 45, "LOG",   0x03E0 }; // Green
static const TouchBtn btnWarn  = { 115, 185,  95, 45, "WARN",  0xFD20 }; // Orange
static const TouchBtn btnError = { 220, 185,  95, 45, "ERROR", 0xF800 }; // Red

static bool isTouchInside(int tx, int ty, const TouchBtn& btn) {
    return (tx >= btn.x && tx < (btn.x + btn.w) && ty >= btn.y && ty < (btn.y + btn.h));
}

static void drawUI() {
    M5.Display.startWrite();

    // Header banner
    M5.Display.fillRect(0, 0, 320, 28, 0x18E3); // Dark slate blue
    M5.Display.setTextColor(0xFFFF, 0x18E3);
    M5.Display.setTextDatum(top_left);
    M5.Display.drawString("CoreS3 Debug Monitor", 8, 6);
    M5.Display.setTextDatum(top_right);
    M5.Display.drawString("v0.1.0", 312, 6);

    // Network & Diagnostics Area (black background)
    M5.Display.fillRect(0, 28, 320, 150, 0x0000);
    M5.Display.setTextDatum(top_left);
    M5.Display.setTextColor(0xAD55, 0x0000); // Gray text

    // Line 1: IP & Server
    char line1[64];
    String localIp = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "Not connected";
    snprintf(line1, sizeof(line1), "IP: %s", localIp.c_str());
    M5.Display.drawString(line1, 10, 35);

    char line2[64];
    snprintf(line2, sizeof(line2), "PC: %s:%d", DEBUG_HOST, DEBUG_PORT);
    M5.Display.drawString(line2, 10, 53);

    // Line 2: Connection Status
    const char* stateStr = debug.getStateString();
    uint32_t stateColor = debug.isConnected() ? 0x07E0 : 0xF800; // Green or Red
    M5.Display.drawString("Status: ", 10, 72);
    M5.Display.setTextColor(stateColor, 0x0000);
    M5.Display.drawString(stateStr, 65, 72);

    // Line 3: Memory Info
    M5.Display.setTextColor(0xFFFF, 0x0000);
    char memLine[64];
    snprintf(memLine, sizeof(memLine), "SRAM: %lu KB  PSRAM: %lu KB",
             (unsigned long)(ESP.getFreeHeap() / 1024),
             (unsigned long)(ESP.getFreePsram() / 1024));
    M5.Display.drawString(memLine, 10, 92);

    // Line 4: Transmitted & Dropped
    DebugStats stats = debug.getStats();
    char statsLine[64];
    snprintf(statsLine, sizeof(statsLine), "Sent: %lu B | Dropped: %lu",
             (unsigned long)stats.sent, (unsigned long)stats.dropped);
    M5.Display.drawString(statsLine, 10, 112);

    // Line 5: Demo state machine & Timing
    char demoLine[64];
    const char* stNames[] = { "IDLE", "RUNNING", "PROCESSING" };
    snprintf(demoLine, sizeof(demoLine), "State: %s | Upd: %lu us",
             stNames[currentDemoState], (unsigned long)stats.avgUpdateUs);
    M5.Display.setTextColor(0x07FF, 0x0000); // Cyan
    M5.Display.drawString(demoLine, 10, 132);

    // Draw Touch Buttons
    const TouchBtn* buttons[3] = { &btnLog, &btnWarn, &btnError };
    for (int i = 0; i < 3; i++) {
        const TouchBtn* b = buttons[i];
        M5.Display.fillRoundRect(b->x, b->y, b->w, b->h, 6, b->color);
        M5.Display.setTextColor(0xFFFF, b->color);
        M5.Display.setTextDatum(middle_center);
        M5.Display.drawString(b->label, b->x + (b->w / 2), b->y + (b->h / 2));
    }

    M5.Display.endWrite();
}

void setup() {
    auto cfg = M5.config();
    M5.begin(cfg);

    // Screen rotation rule for CoreS3 (ILI9342): native landscape is rotation 0 (320x240)
    // Never use setRotation(1) on CoreS3 as it rotates to portrait (240x320)
    M5.Display.setRotation(0);
    M5.Display.fillScreen(0x0000);

    Serial.begin(115200);
    delay(200);
    Serial.println("\n[SYSTEM] CoreS3-DebugMonitor v0.1.0 starting...");

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
    dbgCfg.appVersion = APP_VERSION;
    dbgCfg.minLevel = DEBUG_LEVEL_TRACE;
    dbgCfg.usePsram = true;

    debug.begin(dbgCfg);
    debug.info("SYSTEM", "CoreS3-DebugMonitor v0.1.0 initialized");
    debug.state("DEMO_STATE", "IDLE");

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
                debug.info("USER", "Touch button [LOG] pressed");
                Serial.println("[TOUCH] LOG pressed");
            } else if (isTouchInside(tx, ty, btnWarn)) {
                debug.warn("AUDIO", "Touch button [WARN] pressed: simulated buffer threshold warning");
                Serial.println("[TOUCH] WARN pressed");
            } else if (isTouchInside(tx, ty, btnError)) {
                debug.error("SYSTEM", "Touch button [ERROR] pressed: simulated non-fatal error");
                Serial.println("[TOUCH] ERROR pressed");
            }
        }
    }

    // Update DebugAgent (handles transport, queuing, non-blocking network transmission)
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

        // Custom evolving metric (simulated sensor temperature / sine curve)
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
