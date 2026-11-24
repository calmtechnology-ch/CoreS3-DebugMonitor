# Spécification du Protocole NDJSON — CoreS3-DebugMonitor v0.1.0

Le protocole de communication repose sur le standard **NDJSON** (*Newline Delimited JSON*) : chaque message est un objet JSON compact valide encodé en UTF-8 et terminé par un caractère de fin de ligne `\n` (ou `\r\n`).

Le CoreS3 se connecte en tant que client TCP sur le port `9000` du PC hôte.

---

## 1. Principes Généraux

- **Encodage** : UTF-8 strict (support natif des accents français : `é`, `è`, `à`, `ç`, etc.).
- **Délimiteur** : `\n` (LF) ou `\r\n` (CRLF).
- **Numérotation de séquence** : Chaque message (sauf `hello` et `stats`) contient un champ monotonique croissant `seq` permettant au serveur PC de détecter les paquets perdus en cas de rupture de flux.
- **Horodatage firmware** : Champ `ms` correspondant au temps écoulé depuis le démarrage (`millis()`).
- **Horodatage PC** : Le serveur PC injecte à la réception `rxTime` (ISO 8601) et `rxMs` (millisecondes Unix).
- **Taille maximale** : 512 octets par message émis par le firmware (limite maximale autorisée par le serveur PC : 16 384 octets).

---

## 2. Messages du Protocole

### 2.1 Message d'Identification (`hello`)
Émis immédiatement après l'établissement de la socket TCP par le CoreS3.

```json
{
  "type": "hello",
  "protocol": 1,
  "device": "CoreS3-01",
  "app": "BasicDiagnostics",
  "version": "0.1.0"
}
```

| Champ | Type | Description |
|---|---|---|
| `type` | string | `"hello"` |
| `protocol` | integer | Version du protocole (actuellement `1`) |
| `device` | string | Identifiant ou nom du périphérique |
| `app` | string | Nom de l'application firmware |
| `version` | string | Version sémantique de l'application |

---

### 2.2 Message de Journalisation (`log`)
Transmet une ligne de journalisation avec son niveau de sévérité et sa catégorie.

```json
{
  "type": "log",
  "seq": 42,
  "ms": 12345,
  "level": "INFO",
  "tag": "SYSTEM",
  "message": "Démarrage de la boucle principale avec succès"
}
```

| Champ | Type | Description |
|---|---|---|
| `type` | string | `"log"` |
| `seq` | integer | Numéro de séquence monotonique |
| `ms` | integer | Horodatage firmware en millisecondes |
| `level` | string | `"TRACE"`, `"DEBUG"`, `"INFO"`, `"WARN"`, `"ERROR"` |
| `tag` | string | Catégorie ou module émetteur (ex: `"SYSTEM"`, `"AUDIO"`, `"WIFI"`) |
| `message` | string | Contenu textuel avec échappement JSON valide |

---

### 2.3 Métriques Système Périodiques (`metrics`)
Transmis par défaut chaque seconde (`DEBUG_METRIC_INTERVAL = 1000`).

```json
{
  "type": "metrics",
  "seq": 43,
  "ms": 13000,
  "heap": 147256,
  "min_heap": 132400,
  "max_alloc": 128500,
  "psram": 8052100,
  "rssi": -48,
  "avg_update_us": 45,
  "max_update_us": 120
}
```

| Champ | Type | Description |
|---|---|---|
| `type` | string | `"metrics"` |
| `seq` | integer | Numéro de séquence monotonique |
| `ms` | integer | Horodatage firmware |
| `heap` | integer | Mémoire SRAM interne disponible en octets |
| `min_heap` | integer | Plus basse SRAM observée depuis le boot |
| `max_alloc` | integer | Plus grand bloc contigu de SRAM allouable |
| `psram` | integer | Mémoire PSRAM externe disponible en octets |
| `rssi` | integer | Puissance du signal Wi-Fi en dBm |
| `avg_update_us` | integer | Temps moyen d'exécution de `debug.update()` en microsecondes |
| `max_update_us` | integer | Temps maximal observé de `debug.update()` en microsecondes |

---

### 2.4 Métrique Personnalisée Découvrable (`metric`)
Permet au développeur d'exposer n'importe quelle variable numérique sans reconfigurer l'IHM.

```json
{
  "type": "metric",
  "seq": 44,
  "ms": 13500,
  "name": "temperature",
  "value": 24.85
}
```

---

### 2.5 État Découvrable (`state`)
Permet de suivre l'état d'une machine à états ou d'un automate (ex : PTT, Wi-Fi, Audio).

```json
{
  "type": "state",
  "seq": 45,
  "ms": 14000,
  "name": "PTT",
  "value": "LISTENING"
}
```

---

### 2.6 Statistiques Internes DebugAgent (`stats`)
Transmis périodiquement pour auditer le comportement de la bibliothèque.

```json
{
  "type": "stats",
  "queued": 1250,
  "dropped": 0,
  "truncated": 0,
  "reconnects": 1
}
```

| Champ | Type | Description |
|---|---|---|
| `queued` | integer | Nombre total de messages placés dans le buffer |
| `dropped` | integer | Nombre de messages abandonnés suite à saturation du buffer |
| `truncated` | integer | Messages ayant dépassé la taille maximale autorisée |
| `reconnects` | integer | Nombre de reconnexions TCP opérées |

---

## 3. Gestion de la Fragmentation et des Pertes

### Fragmentation TCP
Les sockets TCP fonctionnent par flux d'octets. Une ligne NDJSON peut être morcelée sur plusieurs réceptions réseau. Le module `ProtocolParser` côté serveur stocke les fragments jusqu'à détection du délimiteur `\n`.

### Regroupement de Paquets (Coalescing)
Plusieurs messages NDJSON émis rapidement peuvent arriver dans un unique paquet TCP. Le serveur extrait l'ensemble des lignes complètes dans une seule boucle synchrone.

### Détection de Pertes en Transit
Le `DeviceManager` compare chaque `msg.seq` reçu :
$$\Delta = \text{seq} - (\text{lastSeq} + 1)$$
Si $\Delta > 0$, $\Delta$ messages ont été perdus en transit ou abandonnés par le firmware avant transmission.
