@echo off
title Harmony Server Setup

echo =========================================
echo       Harmony Server Setup Script
echo =========================================
echo.

:: Check if Node is installed
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js was not found on your system!
    echo Downloading the official Node.js installer...
    
    curl -o node-installer.msi https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi
    
    if exist node-installer.msi (
        echo.
        echo Starting the installer. Please click "Next" through the prompts to install Node.js.
        start /wait msiexec /i node-installer.msi
        
        echo Cleanup...
        del node-installer.msi
        
        echo.
        echo ==============================================================================
        echo SUCCESS: Node.js has been installed!
        echo IMPORTANT: Windows needs to refresh to see the new 'npm' command.
        echo.
        echo PLEASE CLOSE THIS WINDOW entirely, and then double-click setup_server.bat again!
        echo ==============================================================================
        pause
        exit /b
    ) else (
        echo [ERROR] Failed to download Node.js. Please install it manually from nodejs.org
        pause
        exit /b
    )
)

echo [OK] Node.js is installed!
echo.
echo Installing server dependencies...
call npm install

echo.
echo =========================================
echo Starting the Harmony Server!
echo You can connect to it on Port 3001!
echo =========================================
cd %~dp0

echo [!] Stopping any existing Harmony background processes on Port 3001...
FOR /F "tokens=5" %%T IN ('netstat -a -n -o ^| findstr :3001') DO TaskKill.exe /PID %%T /F >nul 2>&1

call npm run dev

pause
