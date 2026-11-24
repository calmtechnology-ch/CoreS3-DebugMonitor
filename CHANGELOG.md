# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0.1] - 2026-11-24

### Corrective Release: Non-Blocking & Memory Reliability

#### Fixed & Corrected
- **C01 — Transport TCP Réellement Non Bloquant** :
  - Remplacement complet de `WiFiClient` par des sockets lwIP natives (`socket`, `fcntl`, `O_NONBLOCK`, `TCP_NODELAY`, `connect`, `select`, `send`, `close`).
  - Utilisation d'adresses IPv4 numériques directes éliminant tout blocage DNS.
  - Gestion rigoureuse de `EINPROGRESS`, `EAGAIN`, `EWOULDBLOCK`, `ECONNRESET`, `EPIPE` et `ETIMEDOUT`.
  - Contrôle de disponibilité du socket via `select()` avec timeout nul (`{0, 0}`).
  - Fermeture systématique des descripteurs de sockets lors d'une déconnexion ou perte Wi-Fi, sans altérer la connexion Wi-Fi de l'application hôte.
- **C02 — Budget Temporel Coopératif** :
  - Budget global `#define DEBUG_UPDATE_BUDGET_US 200` et plafond `#define DEBUG_MAX_UPDATE_US 1000`.
  - Contrôle du temps restant avant chaque opération potentiellement coûteuse.
  - Découpage par tranche maximale d'écriture de 512 octets par appel.
  - Métrologie honnête : temps moyen, maximal, minimal, dépassements > 200 µs et dépassements > 1 ms.
- **C03 — Intégrité Protocolaire NDJSON & Handshake** :
  - Tampon fixe dédié de 256 octets pour le message `hello`, isolé du buffer de logs.
  - Sous-état `CONNECTED` -> `SEND_HELLO` -> `STREAMING`.
  - Aucun message ni métrique n'est transmis avant terminaison complète du `hello`.
  - Gestion complète des écritures partielles du message `hello`.
- **C04 — Buffer Circulaire Orienté Messages** :
  - Refonte du buffer en PSRAM au format enregistrement `[uint16_t length][payload]`, aligné sur 2 octets.
  - Mémorisation de l'offset du message courant ; retrait uniquement après acceptation totale par la socket.
  - Réinitialisation de l'offset en cas de déconnexion et réémission complète du message après reconnexion.
  - Abandon propre des nouveaux messages avec compteur `messagesDropped` lorsque le buffer est plein.
- **C05 — Sécurité Multitâche (FreeRTOS Concurrency)** :
  - Formatage JSON complexe exécuté hors section critique sur la pile de la tâche appelante.
  - Numéros de séquence monotoniques attribués en section critique courte (< 1 µs) garantissant que les numéros reflètent l'ordre physique d'insertion.
  - Détection et interdiction des appels depuis une ISR matérielle (`xPortInIsrContext()`).
- **C06 — Formatage des Messages & Robustesse UTF-8** :
  - Échappement JSON rigoureux des caractères de contrôle ASCII (< 32), guillemets et antislashs.
  - Détection des caractères UTF-8 multi-octets sans coupure mid-caractère lors d'une troncature.
  - Neutralisation des nombres `NaN` et `Infinity` dans les métriques.
  - Vérification préalable du niveau de log avant tout formatage.
- **C07 — Mesures Mémoire Réelles ESP-IDF** :
  - Empreinte statique mesurée : +608 octets SRAM, 8 Ko PSRAM.
  - Utilisation des APIs ESP-IDF `heap_caps_get_free_size`, `heap_caps_get_minimum_free_size`, `heap_caps_get_largest_free_block`.
  - Profil mémoire détaillé relevé aux 9 étapes clés du cycle de vie.
  - Désactivation propre par défaut si la PSRAM est indisponible.
- **C08 — Statistiques Enrichies** :
  - Ajout des compteurs complets : `messagesAttempted`, `messagesEnqueued`, `messagesSent`, `messagesDropped`, `messagesTruncated`, `bytesSent`, `bufferUsed`, `bufferCapacity`, `bufferHighWatermark`, `connectAttempts`, `successfulConnections`, `reconnects`, `socketErrors`, `budgetOverruns`, `updateOverruns1ms`.
- **C09 — Serveur Node.js & Web UI** :
  - Intégration de `StringDecoder` pour le décodage sans perte des fragments UTF-8.
  - Enregistrement de session par identifiant stable `bootId` distinguant reconnexion et redémarrage matériel.
  - Détection des doublons (`duplicatesCount`) et discontinuités de séquence (`lostInTransit`).
  - Page Diagnostics adaptée pour afficher toutes les nouvelles métriques et export de rapport standardisé Section 15.

## [0.1.0] - 2026-11-24
- Initial release
