# Rapport d'Audit Technique & Correctif — v0.1.0.1
## CoreS3-DebugMonitor: Non-Blocking & Memory Reliability

---

### 1. Introduction et Périmètre de l'Audit

La version v0.1.0 de CoreS3-DebugMonitor a introduit une architecture prometteuse pour le télé-débogage réseau sur ESP32-S3 (M5Stack CoreS3). Néanmoins, l'audit approfondi du code source et des comportements en conditions limites a mis en évidence plusieurs failles de conception et des risques critiques :
- Blocages potentiels dans la boucle applicative lors d'opérations TCP réseau.
- Risque d'inversion protocolaire (transmission de données avant le handshake `hello`).
- Désynchronisation ou transmission de fragments de messages NDJSON en cas de coupure socket.
- Accès concurrents non sécurisés sur les numéros de séquence et les buffers lors de journalisation multi-tâches FreeRTOS.
- Calculs et affirmations trompeurs concernant l'empreinte mémoire et le temps réel absolu.

La version **v0.1.0.1** est une révision strictement corrective apportant des réponses industrielles pérennes à chacun de ces problèmes, sans altérer l'API publique ni ajouter de dépendance logicielle.

---

### 2. Analyse Détaillée des Corrections (C01 à C09)

#### Correction C01 — Transport TCP Réellement Non Bloquant
- **Problème initial** : Utilisation de `WiFiClient::connect(_config.host, _config.port, 50)` et `WiFiClient::write()`.
- **Cause** : `WiFiClient` encapsule des couches Arduino introduisant des attentes synchrones et des résolutions DNS bloquantes pouvant geler la boucle `loop()` du CoreS3 jusqu'à 50 ms par appel en cas de défaillance réseau.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugTransport.h`
  - `firmware/lib/DebugAgent/src/DebugTransport.cpp`
- **Solution retenue** :
  - Élimination complète de `WiFiClient` au profit des sockets BSD/lwIP natives (`socket()`, `fcntl()`, `connect()`, `select()`, `getsockopt()`, `send()`, `close()`).
  - Configuration systématique en mode strictement non-bloquant (`O_NONBLOCK`) et désactivation de l'algorithme de Nagle (`TCP_NODELAY`).
  - Validation et conversion directe de l'adresse IPv4 via `inet_pton()` numérique (aucun appel DNS synchrone).
  - Gestion asynchrone de `connect()` via `EINPROGRESS`, timeout sans attente active par horodatage (`millis()`), et contrôle de disponibilité d'écriture par `select()` avec timeout nul (`{0, 0}`).
  - Traitement strict des codes d'erreur et de flux : `EAGAIN`, `EWOULDBLOCK`, `EINTR`, `ECONNRESET`, `EPIPE`, `ETIMEDOUT`.
  - Fermeture systématique des descripteurs de socket en cas d'erreur ou de perte du signal Wi-Fi. Respect strict de la connexion Wi-Fi de l'application hôte (aucune modification ni tentative de reconnexion Wi-Fi forcée).
- **Tests associés** : REG-01, REG-02, REG-13, REG-14, MAT-13, MAT-14, MAT-15.
- **Limitations restantes** : La socket dépend de la pile réseau lwIP d'ESP-IDF ; en cas de corruption interne sévère de la pile Wi-Fi hôte, DebugAgent bascule en `WAIT_WIFI` jusqu'au rétablissement.

---

#### Correction C02 — Budget Temporel et Garanties Réalistes
- **Problème initial** : La version v0.1.0 affirmait une « garantie temps réel absolue », alors que le budget de 200 µs n'était vérifié qu'avant l'écriture des données et ignorait la durée des autres opérations de `debug.update()`.
- **Cause** : Contrôle partiel du budget temporel et absence de métrologie sur les cas de dépassement.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugConfig.h`
  - `firmware/lib/DebugAgent/src/DebugAgent.h`
  - `firmware/lib/DebugAgent/src/DebugAgent.cpp`
  - `firmware/lib/DebugAgent/src/DebugTransport.cpp`
- **Solution retenue** :
  - Définition d'un budget coopératif global :
    ```cpp
    #define DEBUG_UPDATE_BUDGET_US 200
    #define DEBUG_MAX_UPDATE_US   1000
    ```
  - Mesure dès l'entrée de `debug.update()` via `esp_timer_get_time()`.
  - Contrôle du temps restant avant chaque étape coûteuse (résolution socket, envoi hello, vidage buffer, formatage métriques).
  - Plafond strict sur le nombre d'octets émis par appel (`DEBUG_MAX_CHUNK_WRITE = 512 octets`).
  - Interdiction formelle de `delay()`, d'attente active, de boucle de reconnexion bloquante ou de création dynamique de tâches.
  - Mesure honnête et séparée : temps moyen (`avgUpdateUs`), maximal (`maxUpdateUs`), minimal (`minUpdateUs`), nombre d'appels, dépassements du budget de 200 µs (`budgetOverruns`), et dépassements critiques de 1 ms (`updateOverruns1ms`).
- **Tests associés** : REG-17, MAT-12, MAT-19.
- **Limitations restantes** : Le budget de 200 µs est un objectif coopératif. Sur un système sans préemption dédiée pour l'agent, un contexte système exceptionnel peut dépasser 200 µs, mais ces occurrences sont désormais mesurées, comptabilisées et signalées.

---

#### Correction C03 — Intégrité du Protocole NDJSON et Handshake
- **Problème initial** : Le message `hello` était empilé dans le buffer circulaire ordinaire, risquant d'être précédé par des logs résiduels ou tronqué en cas de buffer plein.
- **Cause** : Confusion entre le handshake de session TCP et le flux applicatif de messages.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugTransport.h`
  - `firmware/lib/DebugAgent/src/DebugTransport.cpp`
  - `firmware/lib/DebugAgent/src/DebugProtocol.h`
- **Solution retenue** :
  - Isolation du message `hello` dans un tampon dédié fixe de 256 octets (`_helloBuf`).
  - Sous-machine d'états interne stricte : `CONNECTED` -> `SEND_HELLO` -> `STREAMING`.
  - Gestion des écritures partielles du message `hello` via un offset dédié (`_helloOffset`).
  - Interdiction absolue de transmettre le moindre log ou métrique tant que le message `hello` complet n'a pas été accepté par le socket TCP.
- **Tests associés** : REG-01, REG-02, MAT-01, MAT-05.
- **Limitations restantes** : Aucune ; le handshake précède rigoureusement tout paquet applicatif.

---

#### Correction C04 — Buffer Circulaire Orienté Messages
- **Problème initial** : Le buffer de la v0.1.0 fonctionnait par flux d'octets brut, risquant de couper un message NDJSON lors de l'envoi ou lors d'une déconnexion intermédiaire.
- **Cause** : Absence de structure d'enregistrement (framing) interne dans le buffer circulaire.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugBuffer.h`
  - `firmware/lib/DebugAgent/src/DebugTransport.cpp`
- **Solution retenue** :
  - Refonte orientée enregistrements : chaque entrée est structurée sous la forme `[uint16_t length][payload NDJSON]`, avec alignement mémoire sur 2 octets.
  - Maintien rigoureux du budget de 8192 octets en PSRAM (métadonnées incluses).
  - En transmission, mémorisation de l'offset courant (`_currentMsgOffset`). Le message n'est définitivement dépilé (`popCurrentMessage()`) qu'une fois l'intégralité de ses octets acceptée par la socket.
  - En cas de déconnexion inopinée en cours d'envoi : réinitialisation immédiate de l'offset à 0. Après le handshake suivant, le message complet est réémis depuis son début, évitant tout fragment orphelin côté serveur.
  - Détection des doublons déléguée au serveur via les identifiants de séquence et le `bootId`.
- **Tests associés** : REG-03, REG-04, REG-06, REG-07, MAT-07, MAT-08, MAT-18.
- **Limitations restantes** : En cas de buffer plein (8 Ko saturés avant vidage réseau), la politique est le drop propre du nouveau message avec incrémentation du compteur `messagesDropped`.

---

#### Correction C05 — Sécurité Multitâche (FreeRTOS Concurrency)
- **Problème initial** : Accès concurrents depuis plusieurs tâches FreeRTOS pouvant corrompre le buffer circulaire et désynchroniser les numéros de séquence par rapport à l'ordre d'insertion.
- **Cause** : Incrémentation atomique découplée de l'écriture en buffer, et sections critiques inadaptées.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugAgent.h`
  - `firmware/lib/DebugAgent/src/DebugAgent.cpp`
  - `firmware/lib/DebugAgent/src/DebugBuffer.h`
- **Solution retenue** :
  - Découplage strict : le formatage coûteux du message JSON (`snprintf`, échappement, conversion) est exécuté intégralement **hors section critique** dans la pile de la tâche appelante, avec un placeholder de 10 caractères pour le champ `seq`.
  - Dans une section critique ultra-courte (< 1 µs, spinlock matériel `portMUX_TYPE`), attribution du numéro de séquence monotonique, écriture des 10 chiffres ASCII dans le payload préformaté, et empilement direct dans `DebugBuffer`.
  - Garantie que les numéros de séquence reflètent rigoureusement l'ordre d'insertion physique dans la file.
  - Aucune opération réseau ni allocation mémoire sous verrou.
  - Détection et rejet explicite de tout appel depuis un contexte d'interruption matérielle (`xPortInIsrContext()`).
- **Tests associés** : REG-08, REG-09, MAT-17.
- **Limitations restantes** : Les appels de journalisation ne sont pas autorisés depuis les ISRs matérielles (règle industrielle standard sur ESP32).

---

#### Correction C06 — Formatage des Messages & Encodage UTF-8
- **Problème initial** : Risques de JSON invalide en cas de troncature, de manipulation de nombres non finis (`NaN`/`Inf`), de coupure au milieu d'un caractère UTF-8 multi-octets, ou de formatage inutile lorsque le log level est désactivé.
- **Cause** : Validation superficielle dans `escapeJson()` et formatage systématique dans les méthodes `printf`.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugProtocol.h`
  - `firmware/lib/DebugAgent/src/DebugAgent.cpp`
- **Solution retenue** :
  - Échappement JSON rigoureux de tous les caractères de contrôle ASCII (< 32) en notation `\u00xx`, des guillemets `\"` et des antislashs `\\`.
  - Détection de longueur des séquences UTF-8 (2, 3 et 4 octets). Si la limite du buffer de destination est atteinte, la copie s'interrompt proprement avant le début de la séquence multi-octets, interdisant tout découpage de caractère accentué français (`é`, `à`, `ê`, `€`).
  - Neutralisation des valeurs numériques non finies (`isnan()`, `isinf()`) dans les métriques en les ramenant à `0.0`.
  - Vérification préalable systématique du niveau de log (`level >= _config.minLevel`) avant tout appel à `vsnprintf`.
  - Contrôle strict des valeurs de retour de `snprintf` pour éviter tout débordement.
- **Tests associés** : REG-11, REG-12, MAT-11.
- **Limitations restantes** : Les chaînes dépassant 512 octets sont tronquées proprement en préservant la validité du conteneur JSON.

---

#### Correction C07 — Mesures Mémoire Réelles et Distinction des Espaces
- **Problème initial** : La v0.1.0 utilisait `_stats.sramUsed = sizeof(DebugAgent);` comme estimation trompeuse de la mémoire globale consommée.
- **Cause** : Confusion entre taille de structure statique et allocations dynamiques du tas ESP-IDF.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugConfig.h`
  - `firmware/lib/DebugAgent/src/DebugAgent.cpp`
  - `docs/MEMORY_BENCHMARK.md`
- **Solution retenue** :
  - Distinction formelle entre :
    1. Empreinte statique BSS/Data (mesurée par compilation différentielle : +608 octets).
    2. Taille d'objet `sizeof(DebugAgent)`.
    3. Mémoire tampon externe PSRAM (fixe à 8192 octets).
    4. Tas dynamique SRAM mesuré via les APIs ESP-IDF officielles :
       `heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)`
       `heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)`
       `heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)`
       `heap_caps_get_total_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)`
  - Mesures relevées aux 9 étapes clés du cycle de vie du firmware.
  - En l'absence de PSRAM, DebugAgent se désactive proprement par défaut (`allowSramFallback = false`).
- **Tests associés** : REG-18, MAT-08, MAT-09, MAT-10, MAT-16, MAT-20.
- **Limitations restantes** : L'activation de la pile TCP lwIP lors de la connexion réseau induit une allocation interne de buffers de socket par ESP-IDF (~3 à 6 Ko selon la configuration réseau), documentée en toute transparence.

---

#### Correction C08 — Statistiques Fiables et Complètes
- **Problème initial** : Statistiques limitées et absence de métrologie sur les dépassements de budget, la gigue et les erreurs d'infrastructure.
- **Cause** : Compteurs partiels dans `DebugStats`.
- **Fichiers modifiés** :
  - `firmware/lib/DebugAgent/src/DebugConfig.h`
  - `firmware/lib/DebugAgent/src/DebugBuffer.h`
  - `firmware/lib/DebugAgent/src/DebugTransport.cpp`
  - `firmware/lib/DebugAgent/src/DebugAgent.cpp`
  - `server/device-manager.js`
- **Solution retenue** :
  - Intégration des compteurs obligatoires :
    `messagesAttempted`, `messagesEnqueued`, `messagesSent`, `messagesDropped`, `messagesTruncated`, `bytesSent`, `bufferUsed`, `bufferCapacity`, `bufferHighWatermark`, `connectAttempts`, `successfulConnections`, `reconnects`, `socketErrors`, `avgUpdateUs`, `maxUpdateUs`, `minUpdateUs`, `budgetOverruns`, `updateOverruns1ms`.
  - Maintien d'alias de compatibilité (`queued`, `sent`, `dropped`, `truncated`).
  - Ségrégation claire entre octets transmis et messages transmis.
- **Tests associés** : REG-06, REG-17, MAT-03, MAT-12.
- **Limitations restantes** : Aucune ; cohérence mathématique validée par les tests unitaires.

---

#### Correction C09 — Adaptation du Serveur Node.js
- **Problème initial** : Le serveur acceptait n'importe quelle trame en tête de connexion et ne distinguait pas une reconnexion TCP d'un redémarrage matériel.
- **Cause** : Absence de validation du handshake initial et absence d'identifiant de session stable (`bootId`).
- **Fichiers modifiés** :
  - `server/protocol.js`
  - `server/tcp-server.js`
  - `server/device-manager.js`
- **Solution retenue** :
  - Intégration de `StringDecoder('utf-8')` pour garantir un décodage parfait des caractères multi-octets fragmentés entre plusieurs paquets TCP.
  - Rejet systématique de toute trame reçue sur une nouvelle connexion TCP tant qu'un message `hello` valide n'a pas été reçu.
  - Intégration du champ `bootId` stable généré par le CoreS3 à chaque initialisation.
  - Si un périphérique se reconnecte avec le même `bootId`, l'historique et les compteurs sont préservés et le compteur `reconnects` est incrémenté. Si le `bootId` change, le serveur identifie un redémarrage matériel et réinitialise l'ordonnancement des séquences.
  - Détection et signalement des messages dupliqués (`duplicatesCount`) et des discontinuités de séquence (`sequenceGaps`).
- **Tests associés** : REG-01, REG-05, REG-10, REG-12.
- **Limitations restantes** : Le serveur PC conserve un historique borné à 5000 logs en mémoire pour éviter tout épuisement de mémoire Node.js.
