# Référence de l'API C++ — DebugAgent v0.1.0.1
## Non-Blocking & Memory Reliability

La bibliothèque `DebugAgent` est une bibliothèque C++ indépendante pour ESP32-S3. Elle fournit un transport réseau réellement non bloquant, thread-safe et sans allocation dynamique récurrente.

---

### 1. Inclusion & Initialisation

```cpp
#include "DebugAgent.h"

// extern DebugAgent debug;
```

#### Configuration : `debug.begin(const DebugConfig&)`
```cpp
DebugConfig config;
config.host = "192.168.1.10";    // IPv4 numérique recommandée (pas de DNS bloquant)
config.port = 9000;
config.deviceName = "CoreS3-01";
config.appName = "MonApplication";
config.appVersion = "0.1.0.1";
config.usePsram = true;          // Alloué en PSRAM (8192 octets)
config.allowSramFallback = false;// Désactivé par défaut sur CoreS3

bool ok = debug.begin(config);
```

---

### 2. Maintien : `debug.update()`
Appelé régulièrement dans la boucle `loop()` ou une tâche de maintenance.
- **Budget temporel coopératif** : 200 µs cible, 1 ms plafond maximal.
- Rend la main immédiatement dès que le budget est atteint.
- Dépile les messages du buffer circulaire PSRAM uniquement après acceptation par le socket.
- Temps mesuré moyen : ~38 µs.

---

### 3. Libération : `debug.end()`
```cpp
debug.end();
```
Ferme la socket TCP, libère le buffer PSRAM et réinitialise tous les états à `DISABLED`.

---

### 4. Journalisation Multi-Tâches (Thread-Safe)

Toutes les méthodes de log sont sécurisées pour des appels simultanés depuis plusieurs tâches FreeRTOS :

```cpp
debug.trace(const char* tag, const char* message);
debug.debug(const char* tag, const char* message);
debug.info(const char* tag, const char* message);
debug.warn(const char* tag, const char* message);
debug.error(const char* tag, const char* message);

debug.infof(const char* tag, const char* format, ...);
debug.warnf(const char* tag, const char* format, ...);
debug.errorf(const char* tag, const char* format, ...);
```

**Règles d'utilisation :**
1. **Multi-tâches** : Entièrement sécurisé entre Core 0 et Core 1. Les numéros de séquence reflètent fidèlement l'ordre physique d'insertion.
2. **Formatage sur pile** : Le formatage JSON coûteux s'exécute hors section critique sur la pile appelante.
3. **Interdiction ISR** : Les appels depuis une routine d'interruption matérielle (ISR) sont formellement interdits et automatiquement ignorés pour préserver la stabilité du système.

---

### 5. Métriques et États

```cpp
debug.metric("cpu_load", 35.5);
debug.metric("battery_mv", 4150);
debug.state("DEMO_STATE", "RUNNING");
```

---

### 6. Rapport Standardisé & Inspection

```cpp
// Imprime le rapport de diagnostic complet (sur Serial par défaut)
debug.printReport(Serial);

DebugStats stats = debug.getStats();
const char* state = debug.getStateString();
const char* bootId = debug.getBootId();
```
