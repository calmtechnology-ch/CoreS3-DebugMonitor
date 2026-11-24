@echo off
setlocal
title CoreS3-DebugMonitor v0.1.0

echo ======================================================================
echo           Demarrage de CoreS3-DebugMonitor v0.1.0
echo ======================================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas installe ou n'est pas dans le PATH.
    echo Veuillez installer Node.js v18+ depuis https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo [INFO] Installation des dependances npm...
    call npm install
)

if not exist dist (
    echo [INFO] Compilation de l'interface Web...
    call npm run build
)

echo [INFO] Lancement du serveur (Web sur 8080, TCP sur 9000)...
start http://localhost:8080
call npm start

pause
