# Spécification du Protocole NDJSON — CoreS3-DebugMonitor v0.1.0.1
## Non-Blocking & Memory Reliability

Le protocole repose sur le standard **NDJSON** (*Newline Delimited JSON*) : chaque message est un objet JSON compact valide encodé en UTF-8 et terminé par `\n` (ou `\r\n`).

---

### 1. Principes Généraux
- **Encodage** : UTF-8 strict (protection contre la scission de caractères multi-octets).
- **Handshake Prioritaire** : À chaque nouvelle connexion TCP, le message `hello` est transmis en premier. Aucun log ni métrique n'est émis avant l'acceptation intégrale du `hello`.
- **Numérotation de séquence** : Champ monotonique `seq` reflétant l'ordre exact d'insertion dans le buffer circulaire.
- **Identifiant de session (`bootId`)** : Identifiant stable pendant toute la durée d'exécution du firmware, permettant au serveur de distinguer une reconnexion TCP d'un redémarrage matériel.
- **Détection des doublons** : Le serveur détecte les messages réémis (`seq <= lastSeq`).

---

### 2. Messages du Protocole

#### 2.1 Handshake d'Identification (`hello`)
```json
{
  "type": "hello",
  "protocol": 1,
  "device": "CoreS3-01",
  "app": "BasicDiagnostics",
  "version": "0.1.0.1",
  "bootId": "441B32A9C08F7E1D"
}
```

#### 2.2 Journalisation (`log`)
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

#### 2.3 Métriques Périodiques (`metrics`)
```json
{
  "type": "metrics",
  "seq": 43,
  "ms": 13000,
  "heap": 142100,
  "min_heap": 138540,
  "max_alloc": 114688,
  "psram": 8380416,
  "rssi": -48,
  "avg_update_us": 38,
  "max_update_us": 145,
  "min_update_us": 1,
  "budget_overruns": 0,
  "overruns_1ms": 0
}
```

#### 2.4 Métrique Personnalisée (`metric`)
```json
{
  "type": "metric",
  "seq": 44,
  "ms": 13500,
  "name": "temperature",
  "value": 24.85
}
```

#### 2.5 État Découvrable (`state`)
```json
{
  "type": "state",
  "seq": 45,
  "ms": 14000,
  "name": "PTT",
  "value": "LISTENING"
}
```

#### 2.6 Statistiques Détaillées DebugAgent (`stats`)
```json
{
  "type": "stats",
  "seq": 46,
  "ms": 15000,
  "attempted": 1250,
  "enqueued": 1250,
  "sent": 1248,
  "dropped": 0,
  "truncated": 0,
  "bytes_sent": 84210,
  "buf_used": 240,
  "buf_cap": 8192,
  "buf_hwm": 3120,
  "connects": 1,
  "reconnects": 0,
  "sock_errors": 0,
  "avg_us": 38,
  "max_us": 145,
  "overruns": 0,
  "overruns_1ms": 0
}
```
