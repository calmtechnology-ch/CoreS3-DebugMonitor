# Référence de l'API C++ — DebugAgent v0.1.0

La bibliothèque `DebugAgent` est une bibliothèque C++ indépendante pour ESP32-S3. Elle fournit une interface non bloquante, thread-safe et sans allocation dynamique récurrente.

---

## 1. Inclusion et Instance Globale

```cpp
#include "DebugAgent.h"

// L'instance globale est prédéfinie :
// extern DebugAgent debug;
```

---

## 2. Configuration Initiale : `debug.begin()`

```cpp
bool debug.begin(const DebugConfig& config = DebugConfig());
```

Initialise le buffer circulaire en PSRAM et prépare la socket client TCP.

### Structure `DebugConfig`

| Propriété | Type | Valeur par défaut | Description |
|---|---|---|---|
| `host` | `const char*` | `"192.168.1.10"` | Adresse IPv4 du serveur PC hôte |
| `port` | `uint16_t` | `9000` | Port d'écoute TCP du serveur |
| `deviceName` | `const char*` | `"CoreS3-01"` | Nom du périphérique identifié |
| `appName` | `const char*` | `"BasicDiagnostics"` | Nom de l'application hôte |
| `appVersion` | `const char*` | `"0.1.0"` | Version applicative |
| `minLevel` | `uint8_t` | `DEBUG_LEVEL_TRACE` | Niveau minimal de journalisation |
| `metricIntervalMs`| `uint32_t` | `1000` | Fréquence d'émission des métriques (ms) |
| `reconnectIntervalMs`| `uint32_t`| `3000` | Délai de reconnexion après échec (ms) |
| `bufferSize` | `size_t` | `8192` | Taille du buffer en PSRAM (octets) |
| `usePsram` | `bool` | `true` | Allouer préférentiellement en PSRAM |

---

## 3. Maintien de la Tâche : `debug.update()`

```cpp
void debug.update();
```

Doit être appelée régulièrement dans la boucle `loop()` ou dans une tâche FreeRTOS dédiée.

**Garanties de fonctionnement :**
- Vérifie l'état de la connexion Wi-Fi existante (sans jamais appeler `WiFi.begin()`).
- Met à jour la machine à états de transport TCP.
- Dépile et envoie les données du tampon circulaire dans la limite de son budget (`DEBUG_UPDATE_BUDGET_US = 200 µs`).
- Collecte et transmet périodiquement les métriques de santé ESP32-S3.
- Temps d'exécution mesuré : ~45 µs (≤ 100 µs en moyenne, ≤ 1 ms au maximum).

---

## 4. Libération des Ressources : `debug.end()`

```cpp
void debug.end();
```

Ferme proprement la socket TCP, libère le buffer circulaire de la mémoire PSRAM et réinitialise tous les états internes à `DISABLED`.

---

## 5. Méthodes de Journalisation

### 5.1 Journalisation Simple (Chaînes C constantes)

```cpp
debug.trace(const char* tag, const char* message);
debug.debug(const char* tag, const char* message);
debug.info(const char* tag, const char* message);
debug.warn(const char* tag, const char* message);
debug.error(const char* tag, const char* message);
```

Exemple :
```cpp
debug.info("SYSTEM", "Application démarrée");
debug.warn("AUDIO", "Sous-remplissage du tampon audio I2S");
debug.error("NETWORK", "Échec de résolution DNS hôte distant");
```

### 5.2 Journalisation Formatée (Type `printf`)

Toutes les méthodes formatées bénéficient du contrôle de syntaxe par le compilateur GCC (`__attribute__((format(printf, ...)))`) :

```cpp
debug.tracef(const char* tag, const char* format, ...);
debug.debugf(const char* tag, const char* format, ...);
debug.infof(const char* tag, const char* format, ...);
debug.warnf(const char* tag, const char* format, ...);
debug.errorf(const char* tag, const char* format, ...);
debug.logf(uint8_t level, const char* tag, const char* format, ...);
```

Exemple :
```cpp
debug.infof("SENSORS", "Température = %.2f °C, Humidité = %d %%", temp, hum);
debug.warnf("TASK", "Tâche %s : temps de calcul excessif (%lu µs)", taskName, duration);
```

---

## 6. Métriques et États Personnalisés

```cpp
// Métrique numérique (int ou double)
debug.metric("cpu_load", 35.5);
debug.metric("packet_count", 1024);

// État d'une machine d'états
debug.state("PTT_BUTTON", "PRESSED");
debug.state("AUDIO_ENGINE", "STREAMING");
```

Ces données apparaissent instantanément dans l'onglet **Variables & États** de l'interface Web sans aucune configuration côté PC.

---

## 7. Inspection et Métrologie

```cpp
bool isConnected = debug.isConnected();
DebugStats stats = debug.getStats();
const char* stateStr = debug.getStateString();
```

### Structure `DebugStats`
```cpp
struct DebugStats {
    uint32_t queued;        // Messages placés dans le buffer
    uint32_t sent;          // Octets transmis sur la socket
    uint32_t dropped;       // Messages abandonnés (buffer plein)
    uint32_t truncated;     // Messages tronqués (> 512 octets)
    uint32_t reconnects;    // Nombre de reconnexions TCP opérées
    uint32_t avgUpdateUs;   // Temps moyen d'exécution de debug.update()
    uint32_t maxUpdateUs;   // Temps maximal observé de debug.update()
    size_t sramUsed;        // Octets SRAM consommés par la bibliothèque
    size_t psramUsed;       // Octets PSRAM consommés par le buffer
};
```

---

## 8. Désactivation Totale à la Compilation

Pour éliminer intégralement l'empreinte de la bibliothèque (par exemple en production finale) :

```cpp
#define DEBUG_AGENT_ENABLED 0
```
*(ou dans `platformio.ini` : `build_flags = -DDEBUG_AGENT_ENABLED=0`)*

Lorsque cette macro vaut `0` :
- Tous les appels de méthode sont déclarés `inline` vides et totalement élidés par l'optimiseur GCC/Clang.
- Aucun buffer n'est alloué en SRAM ou PSRAM.
- Aucun objet de socket ou tâche de transport n'est instancié.
- L'empreinte binaire additionnelle est de **0 octet**.
