# Guide d'Installation et Configuration Windows 11 — CoreS3-DebugMonitor v0.1.0

Ce guide détaille la mise en service du serveur sous Windows 11, la configuration du pare-feu et les commandes associées.

---

## 1. Prérequis Système

- **Système d'exploitation** : Windows 11 (ou Windows 10 x64 version 21H2+).
- **Node.js** : Version 18 LTS ou supérieure (recommandé : v20 ou v22).
- **PlatformIO Core ou CLI** : Pour la compilation et le flash du CoreS3.
- **Navigateur Web** : Google Chrome, Microsoft Edge ou Firefox.

---

## 2. Configuration du Pare-feu Windows 11

Pour permettre au M5Stack CoreS3 de communiquer avec votre PC sur le réseau local, vous devez autoriser le port TCP `9000` (et facultativement le port `8080` si vous consultez l'interface Web depuis un autre appareil).

### Méthode 1 : Commande PowerShell (Administrateur)

Ouvrez PowerShell en tant qu'Administrateur et exécutez :

```powershell
# Règle pour le port de diagnostic TCP (CoreS3 -> PC)
New-NetFirewallRule -DisplayName "CoreS3 DebugMonitor TCP" `
                    -Direction Inbound `
                    -LocalPort 9000 `
                    -Protocol TCP `
                    -Action Allow `
                    -Profile Private

# Règle pour l'interface Web (facultatif si consultation locale)
New-NetFirewallRule -DisplayName "CoreS3 DebugMonitor Web" `
                    -Direction Inbound `
                    -LocalPort 8080 `
                    -Protocol TCP `
                    -Action Allow `
                    -Profile Private
```

### Méthode 2 : Interface Graphique Windows
1. Ouvrez le menu Démarrer et tapez **Pare-feu Windows Defender**.
2. Cliquez sur **Paramètres avancés** dans la colonne de gauche.
3. Cliquez sur **Règles de trafic entrant** > **Nouvelle règle...**.
4. Sélectionnez **Port** > **TCP** > Port spécifique : `9000`.
5. Sélectionnez **Autoriser la connexion**.
6. Cochez **Privé** (décocher Public pour la sécurité).
7. Nommez la règle : `CoreS3 DebugMonitor TCP`.

---

## 3. Identifier votre Adresse IPv4 Locale

Pour renseigner `DEBUG_HOST` dans `AppConfig.h` :

1. Lancez simplement le serveur :
   ```bash
   npm start
   ```
2. Le serveur détecte et affiche automatiquement toutes vos interfaces réseau :
   ```text
   Available PC IPv4 addresses for CoreS3:
      - 192.168.1.42     (Wi-Fi)
      - 192.168.56.1     (VirtualBox)
   ```
3. Copiez l'adresse correspondant à votre connexion Wi-Fi active (ex: `192.168.1.42`) dans `firmware/include/AppConfig.h`.

---

## 4. Lancement Rapide via `Start-Monitor.bat`

Un script batch `Start-Monitor.bat` est fourni à la racine du projet.

Un simple double-clic sur ce fichier permet de :
1. Vérifier la présence de Node.js.
2. Installer les packages npm si nécessaire (`npm install`).
3. Compiler l'interface Web si nécessaire (`npm run build`).
4. Ouvrir automatiquement Google Chrome à l'adresse `http://localhost:8080`.
5. Démarrer le serveur unifié (HTTP sur 8080 et TCP sur 9000).

---

## 5. Dépannage Réseau Fréquent

- **Le CoreS3 affiche `BACKOFF` ou `CONNECTING` en boucle** :
  - Vérifiez que le PC et le CoreS3 sont bien sur le **même réseau Wi-Fi** (attention aux réseaux d'invités isolés ou bandes 5 GHz non compatibles si le CoreS3 utilise la bande 2,4 GHz).
  - Vérifiez que l'adresse IP dans `AppConfig.h` correspond bien à l'adresse affichée par `npm start`.
  - Désactivez temporairement un éventuel VPN tiers (ex : NordVPN, ExpressVPN) qui pourrait bloquer les connexions entrantes locales.
- **Port 9000 déjà utilisé** :
  - Vous pouvez modifier le port en définissant la variable d'environnement : `TCP_PORT=9001 npm start`.
