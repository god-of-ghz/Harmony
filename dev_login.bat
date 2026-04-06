@echo off
title Harmony Dev Login
setlocal enabledelayedexpansion

:: Get the directory of this script
set "ROOT_DIR=%~dp0"

echo ========================================================
echo        Harmony One-Click Multi-Client Login
echo ========================================================
echo.
echo [!] Requirement: Ensure Harmony Server is running!
echo.

echo [+] Starting Client 1: test@gmail.com
start "Harmony - test@gmail.com" cmd /k "cd /d !ROOT_DIR!client && set "HARMONY_USER_DATA_DIR=userData1" && set "HARMONY_AUTO_EMAIL=test@gmail.com" && set "HARMONY_AUTO_PASS=test" && npm run dev"

timeout /t 2 /nobreak >nul

echo [+] Starting Client 2: test1@gmail.com
start "Harmony - test1@gmail.com" cmd /k "cd /d !ROOT_DIR!client && set "HARMONY_USER_DATA_DIR=userData2" && set "HARMONY_AUTO_EMAIL=test1@gmail.com" && set "HARMONY_AUTO_PASS=test" && npm run dev"

echo.
echo ========================================================
echo SUCCESS: Both clients are launching in separate windows.
echo Environment variables are used for zero-clash automation.
echo ========================================================
echo.
pause
