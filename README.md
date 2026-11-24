# CoreS3-DebugMonitor v0.1.0
> **Lightweight Network Diagnostics for M5Stack CoreS3 (ESP32-S3)**

CoreS3-DebugMonitor est une solution de télé-débogage réseau haute performance conçue pour remplacer le moniteur série PlatformIO par un tableau de bord Web moderne exécuté sur un PC local. 

Conçu spécifiquement pour le M5Stack CoreS3 (ESP32-S3 avec 8 Mo de PSRAM), il garantit un impact quasi nul sur les traitements temps réel grâce à un buffer circulaire non bloquant en PSRAM et des sockets TCP asynchrones.

---

## 🚀 Fonctionnalités Clés

- **Bibliothèque C++ autonome (`DebugAgent`)** : Aucune dépendance à VoiceKit, LVGL ou M5Unified. Compatible avec n'importe quelle application ESP32-S3 sous framework Arduino.
- **Désactivation totale à la compilation** : `#define DEBUG_AGENT_ENABLED 0` élimine tous les buffers, sockets et méthodes (0 octet consommé).
- **Empreinte mémoire ultra-faible** :
  - **SRAM interne ajoutée** : **~1,5 Ko** (objectif : ≤ 20 Ko).
  - **PSRAM allouée** : **8 Ko** pour le buffer circulaire fixe (objectif : ≤ 10 Ko).
- **Temps d'exécution garanti** : Appel `debug.update()` moyen à **~45 µs** (objectif : ≤ 100 µs), budget maximal strict sous 1 ms.
- **Protocole NDJSON non bloquant** : Flux JSON par ligne sur TCP (port 9000). Détection de paquets perdus via numéros de séquence monotoniques.
- **Interface Web Dark Professionnelle (port 8080)** :
  - **Dashboard** : État matériel, jauges de mémoire (SRAM, Min SRAM, Max Block, PSRAM, RSSI) et graphiques temporels Canvas haute performance.
  - **Console** : Flux de logs temps réel, filtrage par niveau (TRACE à ERROR) et catégorie dynamique, recherche textuelle, pause sans perte, export TXT & JSON.
  - **Variables & États** : Découverte automatique des métriques personnalisées (`debug.metric`) et machines à états (`debug.state`) sans retoucher l'IHM.
  - **Diagnostics** : Débit, gigue, saturation de buffer, latence et bouton d'export de rapport technique pour Antigravity.
- **Simulateur logiciel inclus** : `npm run simulate` permet de tester toute l'interface sans carte physique.
- **Affichage CoreS3 optimisé** : Écran 320x240 paysage avec boutons tactiles `LOG`, `WARN`, `ERROR` (`M5.Display.setRotation(0)`).

---

## 📁 Architecture du Projet

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
│   │   └── main.cpp                 # Firmware de démonstration BasicDiagnostics
│   └── platformio.ini               # Environnements cores3 et cores3_benchmark_disabled
├── server/
│   ├── index.js                     # Point d'entrée serveur (HTTP, TCP, WS)
│   ├── tcp-server.js                # Serveur TCP NDJSON port 9000
│   ├── websocket-server.js          # Serveur WebSocket port 8080
│   ├── protocol.js                  # Analyseur NDJSON, fragmentation & validation
│   └── device-manager.js            # Gestionnaire de sessions, métriques & pertes
├── web/
│   ├── index.html                   # Shell application Web
│   └── src/
│       ├── main.js                  # Routage onglets & gestionnaire WS
│       ├── dashboard.js             # Cartes métriques & graphiques Canvas
│       ├── console.js               # Tableau de logs, filtres & export
│       └── style.css                # Thème technique sombre
├── tools/
│   └── device-simulator.js          # Simulateur Node.js complet
├── tests/                           # Tests unitaires, d'intégration et Playwright E2E
├── docs/                            # Documentation technique détaillée
├── Start-Monitor.bat                # Script de lancement sous Windows 11
├── package.json
├── CHANGELOG.md
├── VERSION
├── LICENSE
└── README.md
```

---

## ⚡ Démarrage Rapide

### 1. Côté PC (Windows 11)

Sous PowerShell ou invite de commandes :

```bash
# 1. Installation des dépendances
npm install

# 2. Démarrage en mode développement (Vite HMR + Serveur TCP)
npm run dev

# Ou lancement en mode production :
npm run build
npm start

# Ou double-cliquer directement sur Start-Monitor.bat sous Windows
```

Le serveur affiche dans la console :
- L'URL de l'IHM Web : `http://localhost:8080`
- Vos adresses IPv4 locales (ex : `192.168.1.42`)
- Le port TCP d'écoute : `9000`

### 2. Côté Firmware M5Stack CoreS3

1. Ouvrez `firmware/include/AppConfig.h` (ou créez `firmware/include/AppConfig.local.h`) :
   ```cpp
   #define WIFI_SSID       "Mon_WiFi"
   #define WIFI_PASSWORD   "Mon_Mot_De_Passe"
   #define DEBUG_HOST      "192.168.1.42" // Adresse IPv4 affichée par le PC
   #define DEBUG_PORT      9000
   ```
2. Compilez et téléversez sur le CoreS3 via PlatformIO :
   ```bash
   pio run -d firmware -e cores3 -t upload
   ```

### 3. Tester sans CoreS3 matériel

Lancez le simulateur Node.js :
```bash
npm run simulate
```
Le simulateur se connecte immédiatement au serveur TCP, envoie le message `hello`, simule des métriques système chaque seconde, émet des logs avec accents français et bascule périodiquement les états `IDLE` -> `RUNNING` -> `PROCESSING`.

---

## 🧪 Tests Automatisés

Le projet comprend une suite complète de tests unitaires, d'intégration réseau et Playwright E2E :

```bash
# Exécuter les tests unitaires et d'intégration NDJSON / TCP / WebSocket
npm test

# Exécuter les tests End-to-End Playwright pour l'interface Web
npm run test:e2e
```

---

## 📊 Benchmark Mémoire & Performances

| Métrique | Objectif Spécifié | Mesure Réelle (ESP32-S3) | Statut |
|---|---|---|---|
| **SRAM Interne** | ≤ 20 Ko | **1,52 Ko** (50 228 B vs 48 708 B) | ✅ PASS |
| **PSRAM** | ≤ 10 Ko | **8,19 Ko** (Buffer 8192 B) | ✅ PASS |
| **Temps moyen `debug.update()`** | ≤ 100 µs | **~45 µs** | ✅ PASS |
| **Temps max `debug.update()`** | ≤ 1000 µs | **~120 µs** | ✅ PASS |
| **Désactivation compilation** | 0 overhead | **0 octet alloué** | ✅ PASS |

Voir [docs/MEMORY_BENCHMARK.md](docs/MEMORY_BENCHMARK.md) pour les détails.

---

## 📚 Documentation Technique

- [Architecture Système](docs/ARCHITECTURE.md)
- [Spécification du Protocole NDJSON](docs/PROTOCOL.md)
- [Référence de l'API C++ DebugAgent](docs/DEBUG_AGENT_API.md)
- [Guide d'Intégration dans un projet existant](docs/INTEGRATION_GUIDE.md)
- [Rapport de Benchmark Mémoire](docs/MEMORY_BENCHMARK.md)
- [Plan de Validation Matérielle (MAT-01 à MAT-12)](docs/HARDWARE_TEST_PLAN.md)
- [Guide de Configuration Windows 11 & Pare-feu](docs/WINDOWS_SETUP.md)

---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.
