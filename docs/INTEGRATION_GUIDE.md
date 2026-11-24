# Guide d'Intégration — CoreS3-DebugMonitor v0.1.0.1
## Non-Blocking & Memory Reliability

---

### 1. Intégration PlatformIO

Copiez le dossier `firmware/lib/DebugAgent` dans votre projet.

Dans `platformio.ini` :
```ini
[env:cores3]
platform = espressif32
framework = arduino
board = m5stack-cores3
build_flags =
    -DARDUINO_M5STACK_CORES3
    -DBOARD_HAS_PSRAM
    -mfix-esp32-psram-cache-issue
    -DDEBUG_AGENT_ENABLED=1
    -I"${platformio.packages_dir}/framework-arduinoespressif32/libraries/Network/src"
lib_deps =
    m5stack/M5Unified@^0.3.0
    WiFi
    Networking
```

---

### 2. Exemple Minimal

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <M5Unified.h>
#include "DebugAgent.h"

void setup() {
    auto cfg = M5.config();
    M5.begin(cfg);
    M5.Display.setRotation(0); // CoreS3 paysage natif 320x240

    WiFi.mode(WIFI_STA);
    WiFi.begin("SSID", "PASSWORD");

    DebugConfig cfg;
    cfg.host = "192.168.1.10"; // IP PC hôte (IPv4 numérique)
    cfg.port = 9000;
    cfg.deviceName = "CoreS3-01";
    cfg.appName = "MonApp";
    cfg.appVersion = "0.1.0.1";
    cfg.usePsram = true;

    debug.begin(cfg);
    debug.info("SETUP", "Système initialisé avec succès");
}

void loop() {
    M5.update();
    debug.update(); // Transport coopératif non-bloquant (budget 200 µs)
    delay(5);
}
```

---

### 3. Port Série de Secours & Rapport
Pour analyser le système quand le réseau est absent :
```cpp
if (Serial.available()) {
    char c = Serial.read();
    if (c == 'r') debug.printReport(Serial);
}
```
