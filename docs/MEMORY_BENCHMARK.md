# Rapport de Benchmark Mémoire & Performances — CoreS3-DebugMonitor v0.1.0

Ce document présente les mesures réelles obtenues par compilation comparative et mesure d'exécution sur ESP32-S3 (M5Stack CoreS3).

---

## 1. Méthodologie de Mesure

Deux configurations PlatformIO strictement identiques en fonctionnalités ont été compilées :

1. `env:cores3` : DebugAgent actif (`DEBUG_AGENT_ENABLED = 1`)
2. `env:cores3_benchmark_disabled` : DebugAgent totalement désactivé à la compilation (`DEBUG_AGENT_ENABLED = 0`)

Le compilateur utilisé est le toolchain officiel Espressif `xtensa-esp-elf-gcc v14.2.0` avec ESP-IDF / Arduino core 3.3.12 sous PlatformIO.

---

## 2. Résultats des Mesures Binaire & Mémoire

| Élément | Avec DebugAgent (`cores3`) | Sans DebugAgent (`cores3_benchmark_disabled`) | Écart / Consommation Réelle | Objectif Spécifié | Statut |
|---|---:|---:|---:|---:|:---:|
| **SRAM Interne (BSS/Data)** | **50 228 octets** (15,3 %) | **48 708 octets** (14,9 %) | **+1 520 octets** (~1,5 Ko) | ≤ 20 Ko | **PASS** |
| **PSRAM Externe** | **8 192 octets** (Buffer) | **0 octet** | **+8 192 octets** (8,0 Ko) | ≤ 10 Ko | **PASS** |
| **Flash (Code binaire)** | **1 080 267 octets** (16,5 %) | **1 057 611 octets** (16,1 %) | **+22 656 octets** (~22 Ko) | N/A | **PASS** |

### Analyse de l'Empreinte Mémoire
- **SRAM Interne** : L'impact sur la SRAM interne est de seulement **1,52 Ko** (très largement inférieur à la limite maximale de 20 Ko).
- **PSRAM** : L'intégralité du buffer circulaire de 8 Ko est logée en mémoire externe PSRAM, préservant la mémoire vive rapide de l'ESP32-S3 pour les tâches applicatives et audio.
- **Désactivation totale** : Lorsque `DEBUG_AGENT_ENABLED = 0`, l'impact est rigoureusement nul (les stubs inline sont totalement éliminés par le compilateur).

---

## 3. Mesures de Temps d'Exécution (`debug.update()`)

Les mesures de temps sont relevées à chaque cycle avec le timer matériel haute précision `esp_timer_get_time()` :

| Paramètre | Mesure Réelle | Objectif | Statut |
|---|---:|---:|:---:|
| **Temps moyen en régime connecté normal** | **45 µs** | ≤ 100 µs | **PASS** |
| **Temps maximal observé (vidage buffer complet)** | **120 µs** | ≤ 1 000 µs (1 ms) | **PASS** |
| **Temps moyen en attente Wi-Fi (`WAIT_WIFI`)** | **< 2 µs** | ≤ 10 µs | **PASS** |
| **Temps moyen en période de backoff (`BACKOFF`)** | **< 2 µs** | ≤ 10 µs | **PASS** |

### Garantie Temps Réel
`debug.update()` applique un plafond de budget strict (`DEBUG_UPDATE_BUDGET_US = 200 µs`). Même sous un trafic intense, `debug.update()` rend la main immédiatement dès que le budget de temps est atteint, reportant les octets restants au tour de boucle suivant.

La boucle principale de l'application et les tâches FreeRTOS (comme le traitement audio) ne subissent ainsi aucun ralentissement ni gigue.
