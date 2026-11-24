# Guide d'Intégration — CoreS3-DebugMonitor v0.1.0

Ce guide explique comment ajouter `DebugAgent` à une application CoreS3 existante (ou n'importe quel firmware ESP32-S3 sous PlatformIO) sans modifier l'architecture du projet ni sa gestion Wi-Fi.

---

## 1. Intégration dans le Projet PlatformIO

### Étape 1 : Copier la bibliothèque dans votre projet

Copiez le dossier `firmware/lib/DebugAgent` directement dans le dossier `lib/` de votre projet PlatformIO :

```text
MonProjet/
├── lib/
│   └── DebugAgent/
│       ├── library.json
│       └── src/
│           ├── DebugAgent.h
│           ├── DebugAgent.cpp
│           ├── ...
├── src/
│   └── main.cpp
└── platformio.ini
```

### Étape 2 : Configuration du `platformio.ini`

Assurez-vous que le support de la PSRAM est activé dans votre environnement :

```ini
[env:cores3]
platform = espressif32
board = m5stack-cores3
framework = arduino
build_flags =
    -DARDUINO_M5STACK_CORES3
    -DBOARD_HAS_PSRAM
    -mfix-esp32-psram-cache-issue
    -DDEBUG_AGENT_ENABLED=1
```

---

## 2. Exemple de Code Minimal

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <M5Unified.h>
#include "DebugAgent.h"

const char* ssid = "VOTRE_WIFI";
const char* password = "VOTRE_MOT_DE_PASSE";

void setup() {
    auto cfg = M5.config();
    M5.begin(cfg);
    M5.Display.setRotation(0); // Règle CoreS3 : 0 = paysage 320x240

    Serial.begin(115200);

    // 1. Initialiser votre Wi-Fi habituel
    WiFi.begin(ssid, password);

    // 2. Initialiser DebugAgent
    DebugConfig dbgCfg;
    dbgCfg.host = "192.168.1.50"; // Adresse IP de votre PC
    dbgCfg.port = 9000;
    dbgCfg.deviceName = "CoreS3-Demo";
    dbgCfg.appName = "MonApplication";
    dbgCfg.appVersion = "1.0.0";

    debug.begin(dbgCfg);
    debug.info("SETUP", "Démarrage du système");
}

void loop() {
    M5.update();

    // 3. Appel de mise à jour non bloquant
    debug.update();

    // 4. Utilisation de la journalisation et métriques
    static uint32_t lastLog = 0;
    if (millis() - lastLog > 2000) {
        lastLog = millis();
        debug.infof("APP", "Mémoire libre : %lu Ko", ESP.getFreeHeap() / 1024);
        debug.metric("fps", 60.0);
    }
}
```

---

## 3. Conservation du Port Série de Secours

Il est essentiel de **conserver le port série USB (Serial)** comme canal de diagnostic secondaire pour deux situations critiques :

1. **Phase de boot et initialisation précoce** : Avant que la pile Wi-Fi et les adresses IP ne soient établies.
2. **Crashs matériels et Guru Meditation / Panic** : En cas de panic kernel ou de Watchdog reset, le core ESP32 écrit la pile d'exécution sur le port UART.

### Stratégie Recommandée : Double Journalisation

Pour combiner la puissance du moniteur Web avec la sécurité du port série, créez une macro ou fonction d'encapsulation :

```cpp
#define LOG_INFO(tag, fmt, ...) do { \
    Serial.printf("[INFO][%s] " fmt "\n", tag, ##__VA_ARGS__); \
    debug.infof(tag, fmt, ##__VA_ARGS__); \
} while(0)

#define LOG_ERROR(tag, fmt, ...) do { \
    Serial.printf("[ERROR][%s] " fmt "\n", tag, ##__VA_ARGS__); \
    debug.errorf(tag, fmt, ##__VA_ARGS__); \
} while(0)
```

Ainsi, les messages s'affichent instantanément dans l'interface Web pour le confort et l'analyse, tout en restant capturés par le moniteur série en cas d'incident critique.

---

## 4. Règles de Sécurité et Bonnes Pratiques

- **Jamais d'appels depuis une ISR** : Ne journalisez jamais depuis une routine d'interruption matérielle. Levez un drapeau et journalisez depuis une tâche FreeRTOS.
- **Respect du réseau existant** : `DebugAgent` ne touche jamais à votre Wi-Fi. Il attend simplement que `WiFi.status() == WL_CONNECTED` soit effectif.
- **Zéro allocation répétée** : N'utilisez pas `String(arg)` dans les paramètres de log. Privilégiez les méthodes formattées `debug.infof("%d", arg)`.
- **Règle d'écran CoreS3** : Conservez impérativement `M5.Display.setRotation(0)` pour l'orientation paysage `320x240`.
