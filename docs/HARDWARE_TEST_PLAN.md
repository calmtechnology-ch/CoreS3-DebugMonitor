# Plan de Validation Matérielle CoreS3 — MAT-01 à MAT-12

Ce plan détaille les 12 scénarios d'essais à exécuter sur un **M5Stack CoreS3 physique** pour valider la conformité matérielle.

---

## Matrice des Scénarios de Test

| ID | Scénario | Procédure | Résultat Attendu |
|---|---|---|---|
| **MAT-01** | **Connexion normale** | 1. Démarrer le serveur PC (`npm start`).<br>2. Allumer le CoreS3 sur le même réseau Wi-Fi.<br>3. Observer l'IHM Web. | L'appareil apparaît dans le bandeau supérieur avec son IP et nom (`CoreS3-01`). Le statut passe à `ONLINE` (pastille verte). |
| **MAT-02** | **Envoi de logs** | 1. Appuyer sur le bouton tactile `LOG` sur l'écran du CoreS3.<br>2. Vérifier l'onglet **Console** de l'IHM Web. | Le message `[USER] Touch button [LOG] pressed` s'affiche instantanément (< 10 ms) avec badge vert `INFO`. |
| **MAT-03** | **Métriques système** | 1. Ouvrir l'onglet **Dashboard**.<br>2. Observer les jauges et graphiques pendant 30 secondes. | Les métriques SRAM, PSRAM et RSSI s'actualisent chaque seconde. Les courbes Canvas évoluent fluidement. |
| **MAT-04** | **Arrêt du serveur** | 1. Arrêter le serveur PC (`Ctrl+C` dans le terminal).<br>2. Manipuler le CoreS3 (boutons, écran). | Le firmware CoreS3 continue de fonctionner normalement sans bloquer ni ralentir la boucle. L'écran affiche l'état `BACKOFF`. |
| **MAT-05** | **Redémarrage du serveur** | 1. Relancer le serveur PC (`npm start`).<br>2. Patienter 3 secondes. | Le CoreS3 se reconnecte automatiquement sans redémarrage matériel. Le message `hello` est renvoyé et la transmission reprend. |
| **MAT-06** | **Perte Wi-Fi** | 1. Désactiver temporairement le point d'accès Wi-Fi.<br>2. Observer le comportement du CoreS3. | Le CoreS3 bascule en état `WAIT_WIFI`. Aucun crash, aucun freeze de l'IHM tactile. À la reconnexion Wi-Fi, la liaison TCP se rétablit. |
| **MAT-07** | **Rafale de logs** | 1. Dans une boucle rapide, émettre 200 logs consécutifs.<br>2. Vérifier les statistiques dans l'onglet **Diagnostics**. | Le firmware ne plante pas. Les messages excédentaires sont abandonnés proprement et comptabilisés dans `dropped`. |
| **MAT-08** | **Saturation du buffer** | 1. Couper le réseau TCP tout en continuant à journaliser intensivement.<br>2. Observer la mémoire disponible. | La mémoire SRAM et PSRAM reste rigoureusement stable. Aucun dépassement de capacité ni fuite de mémoire. |
| **MAT-09** | **Fonctionnement prolongé** | 1. Laisser tourner le CoreS3 et le serveur pendant 12 heures en continu.<br>2. Vérifier les métriques `min_heap` et `max_alloc`. | Aucune dérive mémoire (leak). Les valeurs de heap libre demeurent constantes au fil du temps. |
| **MAT-10** | **DebugAgent désactivé** | 1. Compiler avec `DEBUG_AGENT_ENABLED = 0` (`pio run -e cores3_benchmark_disabled`).<br>2. Flasher et observer. | L'application fonctionne sans créer de socket ni de buffer en PSRAM. L'empreinte SRAM est réduite de 1,5 Ko. |
| **MAT-11** | **Accents français** | 1. Émettre un log contenant : `"Système arrêté à l'état prêt : succès !"`.<br>2. Vérifier la Console Web. | Tous les caractères accentués (`é`, `à`, `ê`) s'affichent correctement en UTF-8 sans corruption de caractères (`?` ou carré). |
| **MAT-12** | **Mesures de performances** | 1. Consulter l'onglet **Diagnostics** sur l'IHM Web.<br>2. Vérifier le temps d'exécution `debug.update()`. | Le temps moyen mesuré est `≤ 100 µs` (typiquement ~45 µs). Le temps maximal ne dépasse jamais `1 000 µs`. |

---

## Consigne de Rigueur
Conformément aux exigences du projet, un test matériel ne doit être déclaré **PASS** que lorsqu'il a été effectivement validé sur un CoreS3 physique connecté.
