# CoreS3-DebugMonitor v0.1.0.1
> **Lightweight Network Diagnostics for M5Stack CoreS3 (ESP32-S3) — Corrective Release**

CoreS3-DebugMonitor est une solution de télé-débogage réseau haute performance conçue pour remplacer le moniteur série PlatformIO par un tableau de bord Web moderne exécuté sur un PC local.

---

## 🚀 Correctifs Majeurs v0.1.0.1

- **Sockets TCP lwIP Non Bloquantes** : Remplacement complet de `WiFiClient` par des sockets lwIP natives asynchrones (`socket`, `fcntl`, `O_NONBLOCK`, `connect`, `select`, `send`, `close`).
- **Budget Coopératif Global** : Respect d'un budget coopératif de **200 µs** par appel à `debug.update()` (plafond maximal 1 ms, débit par tranche de 512 octets).
- **Handshake Isolé** : Tampon dédié pour le message `hello`, interdisant toute émission de logs avant complétion du handshake.
- **Buffer Circulaire Orienté Messages** : Conservation intégrale des limites de messages NDJSON dans 8192 octets de PSRAM, réémission propre en cas de déconnexion.
- **Sécurité Multitâche FreeRTOS** : Formatage JSON sur pile hors verrou, numéros de séquence monotoniques attribués en section critique < 1 µs, interdiction ISR.
- **Support UTF-8 & Accents Français** : Préservation des caractères multi-octets sans corruption (`StringDecoder` côté serveur, validation UTF-8 firmware).
- **Session & Détection Doublons** : Identifiant stable `bootId` distinguant reconnexion et redémarrage matériel, détection des paquets dupliqués et des pertes.
- **Métrologie Mémoire ESP-IDF** : Empreinte statique mesurée à **+608 octets SRAM** (objectif ≤ 20 Ko) et **8 Ko PSRAM** (objectif ≤ 10 Ko).
- **Modes de Test Interactifs sur Écran CoreS3** : Boutons tactiles pour rafale de 200 logs (`BURST`), tâche concurrente FreeRTOS (`TASK 2`), saturation contrôlée (`STRESS`), et export de rapport sur port série (`r`).

---

## 📁 Architecture

```text
CoreS3-DebugMonitor/
├── firmware/
│   ├── lib/
│   │   └── DebugAgent/              # Bibliothèque C++ autonome
│   │       ├── library.json
│   │       └── src/
│   │           ├── DebugAgent.h
│   │           ├── DebugAgent.cpp
│   │           ├── DebugConfig.h
│   │           ├── DebugProtocol.h
│   │           ├── DebugBuffer.h
│   │           ├── DebugTransport.h
│   │           └── DebugTransport.cpp
│   ├── include/
│   │   ├── AppConfig.h              # Configuration hôte, Wi-Fi & ports
│   │   └── AppConfig.local.h        # Identifiants locaux (exclus de git)
│   ├── src/
│   │   └── main.cpp                 # Firmware BasicDiagnostics avec modes de test
│   └── platformio.ini               # Environnements cores3 et cores3_benchmark_disabled
├── server/
│   ├── index.js                     # Point d'entrée serveur (HTTP, TCP, WS)
│   ├── tcp-server.js                # Serveur TCP NDJSON port 9000
│   ├── websocket-server.js          # Serveur WebSocket port 8080
│   ├── protocol.js                  # Analyseur NDJSON, StringDecoder & validation
│   └── device-manager.js            # Gestionnaire de sessions, bootId & métriques
├── web/                             # Interface Web (Dashboard, Console, Variables, Diagnostics)
├── tools/
│   ├── device-simulator.js          # Simulateur Node.js complet
│   └── unresponsive-server.js       # Simulateur de réseau dégradé (MAT-15)
├── tests/                           # Tests unitaires, Playwright E2E et REG-01 à REG-18
├── docs/
│   ├── audits/AUDIT_V0.1.0.1.md     # Audit exhaustif des 9 corrections
│   ├── validation/VALIDATION_V0.1.0.1.md # Bilan de validation & rapport Section 15
│   └── ...
└── README.md
```

---

## ⚡ Démarrage Rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Exécuter la suite complète de tests (32 tests unitaires & régression)
npm test

# 3. Compiler le frontend et lancer les tests Playwright E2E
npm run build
npm run test:e2e

# 4. Lancer le serveur
npm start

# 5. Compiler le firmware CoreS3 avec PlatformIO
pio run -d firmware -e cores3
pio run -d firmware -e cores3_benchmark_disabled
```
