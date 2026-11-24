# Plan de Validation Matérielle CoreS3 — MAT-01 à MAT-20
## CoreS3-DebugMonitor v0.1.0.1 Corrective

Ce plan détaille les 20 scénarios d'essais à exécuter sur un **M5Stack CoreS3 physique** pour valider la conformité matérielle.

---

## 1. Matrice des Scénarios de Test

| ID | Scénario | Procédure | Résultat Attendu |
|---|---|---|---|
| **MAT-01** | **Connexion normale** | 1. Démarrer le serveur PC (`npm start`).<br>2. Allumer le CoreS3 sur le même réseau Wi-Fi.<br>3. Observer l'IHM Web. | L'appareil apparaît dans le bandeau supérieur avec son IP et nom (`CoreS3-01`). Le statut passe à `CONNECTED` / `ONLINE` après le message `hello`. |
| **MAT-02** | **Envoi de logs** | 1. Appuyer sur le bouton tactile `LOG` sur l'écran du CoreS3.<br>2. Vérifier l'onglet **Console** de l'IHM Web. | Le message `Bouton tactile [LOG] actionné` s'affiche instantanément (< 10 ms) avec badge vert `INFO`. |
| **MAT-03** | **Métriques système** | 1. Ouvrir l'onglet **Dashboard**.<br>2. Observer les jauges et graphiques pendant 30 secondes. | Les métriques SRAM, PSRAM et RSSI s'actualisent chaque seconde. Les courbes Canvas évoluent fluidement. |
| **MAT-04** | **Arrêt du serveur** | 1. Arrêter le serveur PC (`Ctrl+C` dans le terminal).<br>2. Manipuler le CoreS3 (boutons, écran). | Le firmware CoreS3 continue de fonctionner normalement sans bloquer ni ralentir la boucle. L'écran affiche l'état `BACKOFF`. |
| **MAT-05** | **Redémarrage du serveur** | 1. Relancer le serveur PC (`npm start`).<br>2. Patienter 3 secondes. | Le CoreS3 se reconnecte automatiquement sans redémarrage matériel. Le message `hello` est transmis en premier et la transmission reprend. |
| **MAT-06** | **Perte Wi-Fi** | 1. Désactiver temporairement le point d'accès Wi-Fi.<br>2. Observer le comportement du CoreS3. | Le CoreS3 bascule en état `WAIT_WIFI`. Aucun crash, aucun freeze de l'IHM tactile. À la reconnexion Wi-Fi, la liaison TCP se rétablit. |
| **MAT-07** | **Rafale de 200 logs** | 1. Appuyer sur le bouton `BURST` sur l'écran du CoreS3.<br>2. Vérifier les statistiques dans l'onglet **Diagnostics**. | Le firmware ne plante pas. Les messages sont transmis dans le respect du budget coopératif (pas de freeze tactile). |
| **MAT-08** | **Saturation du buffer** | 1. Couper le réseau TCP et appuyer sur `STRESS` sur le CoreS3.<br>2. Observer la mémoire disponible et le compteur drop. | La mémoire SRAM et PSRAM reste rigoureusement stable. Les messages excédentaires sont abandonnés proprement et comptabilisés dans `dropped`. |
| **MAT-09** | **Fonctionnement prolongé** | 1. Laisser tourner le CoreS3 et le serveur pendant 12 heures en continu.<br>2. Vérifier les métriques `min_heap` et `max_alloc`. | Aucune dérive mémoire (zéro fuite). Les valeurs de heap libre demeurent constantes au fil du temps. |
| **MAT-10** | **DebugAgent désactivé** | 1. Compiler avec `DEBUG_AGENT_ENABLED = 0` (`pio run -e cores3_benchmark_disabled`).<br>2. Flasher et observer. | L'application fonctionne sans créer de socket ni de buffer en PSRAM. L'empreinte SRAM est réduite de 608 octets. |
| **MAT-11** | **Accents français** | 1. Appuyer sur `STRESS` pour émettre des caractères accentués : `à, é, è, ê, ë, î, ï, ô, ù, û, ç, œ, €`.<br>2. Vérifier la Console Web. | Tous les caractères accentués s'affichent correctement en UTF-8 sans point d'interrogation ni corruption. |
| **MAT-12** | **Mesures de performances** | 1. Consulter l'onglet **Diagnostics** sur l'IHM Web.<br>2. Vérifier le temps d'exécution `debug.update()`. | Le temps moyen mesuré est `≤ 100 µs` (typiquement ~38 µs). Les dépassements éventuels sont mesurés et signalés. |
| **MAT-13** | **Serveur absent au démarrage** | 1. Allumer le CoreS3 sans démarrer le serveur PC.<br>2. Tester la réactivité de l'écran tactile. | L'interface tactile reste parfaitement fluide à 60 FPS. Le CoreS3 tente une connexion non-bloquante puis entre en `BACKOFF`. |
| **MAT-14** | **Serveur arrêté brutalement** | 1. Pendant une rafale de logs, tuer brutalement le processus Node.js (`taskkill /F`).<br>2. Manipuler l'appareil. | Aucun blocage du firmware. L'erreur socket (`ECONNRESET`) est détectée immédiatement, la socket est fermée et l'agent passe en `BACKOFF`. |
| **MAT-15** | **Serveur joignable ne lisant plus** | 1. Démarrer `node tools/unresponsive-server.js`.<br>2. Connecter le CoreS3 et émettre des logs. | Le serveur accepte la connexion mais fige sa lecture. Le CoreS3 gère `EWOULDBLOCK`/`EAGAIN`, abandonne les nouveaux logs sans geler la boucle principale. |
| **MAT-16** | **20 cycles de reconnexion** | 1. Redémarrer le serveur PC 20 fois de suite avec 5 secondes d'intervalle.<br>2. Relever la mémoire SRAM interne. | Aucune fuite mémoire progressive constatée. La mémoire SRAM libre revient exactement à son niveau initial. |
| **MAT-17** | **Logs de 2 tâches FreeRTOS** | 1. Appuyer sur le bouton `TASK 2` sur l'écran du CoreS3.<br>2. Examiner le flux de logs dans la Console Web. | 50 messages de la tâche 2 sont intercalés avec ceux de la tâche principale. Les séquences sont strictement continues et aucun JSON n'est corrompu. |
| **MAT-18** | **Reconnexion buffer saturé** | 1. Couper le réseau, saturer le buffer PSRAM (150 logs), puis relancer le serveur. | Le message `hello` est transmis en premier, suivi des logs encore présents dans le buffer. Aucune corruption de trame. |
| **MAT-19** | **Temps en situation dégradée** | 1. Observer les compteurs sous réseau perturbé.<br>2. Analyser `budgetOverruns` et `updateOverruns1ms`. | Les dépassements de budget restent exceptionnels et sont honnêtement quantifiés dans le rapport. |
| **MAT-20** | **Arrêt et reprise DebugAgent** | 1. Appeler `debug.end()` puis `debug.begin()`.<br>2. Vérifier la libération et réallocation du buffer PSRAM. | Les descripteurs sont fermés, le buffer PSRAM est libéré, puis réinitialisé proprement sans fuite. |

---

## 2. Consigne de Rigueur Statuts

Conformément aux exigences qualité, aucun test matériel non exécuté sur une cible physique ne doit être marqué PASS.
Statuts applicables :
- **PASS** : Exécuté et validé avec succès sur CoreS3 physique.
- **FAIL** : Exécuté avec non-conformité constatée.
- **NOT RUN** : Prêt pour essai, en attente de validation physique.
- **BLOCKED** : Dépendance matérielle ou environnementale bloquante.
