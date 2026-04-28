# Harmony Federation Test — Local Two-Server Setup
# 
# Server A: port 3001, data in .\test-data-a\
#   Guild:  RPI Fools (C:\Harmony\RPI Fools-305208823793057803)
#
# Server B: port 3002, data in .\test-data-b\
#   Guild:  Role Playing Adventures (C:\Harmony\Role Playing Adventures-745035401495838781)
#
# Both Discord exports share some users (same Discord IDs), which tests
# that imported users resolve to the same global Harmony identity.
#
# Usage:   cd C:\Harmony\server && .\scripts\start-federation-test.ps1
#          cd C:\Harmony\server && .\scripts\start-federation-test.ps1 -Clean
# Prereq:  npm run build  (dist/server.js must exist)
# Stop:    Press Enter in this window — kills both child processes cleanly

param(
    [switch]$Clean  # Wipe test-data-a and test-data-b to force a fresh import
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Resolve-Path "$ScriptDir\.."

$dataA = "$ServerDir\test-data-a"
$dataB = "$ServerDir\test-data-b"
$importPathA = "C:\Harmony\RPI Fools-305208823793057803"
$importPathB = "C:\Harmony\Role Playing Adventures-745035401495838781"
$serverEntry = "$ServerDir\dist\server.js"

# --- Clean mode: wipe test data directories ---
if ($Clean) {
    Write-Host "Cleaning test data directories..." -ForegroundColor Cyan
    # Stop any background node processes that might have file locks
    Get-Process -Name node, harmony* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    
    if (Test-Path $dataA) { 
        Remove-Item -Recurse -Force $dataA -ErrorAction SilentlyContinue 
        Write-Host "  Removed test-data-a" -ForegroundColor DarkGray 
    }
    if (Test-Path $dataB) { 
        Remove-Item -Recurse -Force $dataB -ErrorAction SilentlyContinue
        Write-Host "  Removed test-data-b" -ForegroundColor DarkGray 
    }
    Write-Host ""
}

# --- Sanity checks ---
if (-not (Test-Path $serverEntry)) {
    Write-Host "ERROR: dist/server.js not found. Run 'npm run build' first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $importPathA)) {
    Write-Host "ERROR: Import path not found: $importPathA" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $importPathB)) {
    Write-Host "ERROR: Import path not found: $importPathB" -ForegroundColor Red
    exit 1
}

# --- Create data directories ---
if (-not (Test-Path $dataA)) { New-Item -ItemType Directory -Path $dataA | Out-Null }
if (-not (Test-Path $dataB)) { New-Item -ItemType Directory -Path $dataB | Out-Null }

# --- Helper: check if a data dir already has a fully imported guild ---
# Requires BOTH the node DB (node was initialized) AND at least one guild.db
# (guild was actually imported). This prevents false positives from partial runs.
function Has-ImportedData($dataDir, $port) {
    if ($Clean) { return $false }
    # Port 3001 uses node.db; other ports use node_{port}.db
    $nodeDbName = if ($port -eq 3001) { "node.db" } else { "node_$port.db" }
    $nodeDb = "$dataDir\$nodeDbName"
    if (-not (Test-Path $nodeDb)) { return $false }
    $guildsDir = "$dataDir\guilds"
    if (-not (Test-Path $guildsDir)) { return $false }
    $guildDbs = @(Get-ChildItem -Path $guildsDir -Recurse -Filter "guild.db" -ErrorAction SilentlyContinue)
    return ($guildDbs.Count -gt 0)
}

# --- Helper: run import synchronously (blocks until complete) ---
function Run-Import($dataDir, $importPath, $label, $port) {
    Write-Host "  Importing $label into $dataDir (port $port) ..." -ForegroundColor Yellow
    Write-Host "  (This may take a moment for large exports)" -ForegroundColor DarkGray
    $env:HARMONY_DATA_DIR = $dataDir
    $env:NODE_ENV = "development"
    # Node.js console.warn() writes to stderr, which PowerShell's
    # $ErrorActionPreference="Stop" treats as a terminating error.
    # Temporarily relax the preference for the import command.
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & node $serverEntry --import $importPath --port $port 2>&1 | Out-Host
    $ErrorActionPreference = $savedEAP
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Import failed for $label (exit code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Import complete." -ForegroundColor Green
}

# --- Import data if needed ---
Write-Host ""
Write-Host "=== Checking test data ==" -ForegroundColor Cyan

if (Has-ImportedData $dataA 3001) {
    Write-Host "  [Server A] Data already present - skipping import" -ForegroundColor Green
} else {
    Run-Import $dataA $importPathA "RPI Fools" 3001
}

if (Has-ImportedData $dataB 3002) {
    Write-Host "  [Server B] Data already present - skipping import" -ForegroundColor Green
} else {
    Run-Import $dataB $importPathB "Role Playing Adventures" 3002
}

# --- Launch servers ---
Write-Host ""
Write-Host "=== Harmony Federation Test ===" -ForegroundColor Cyan
Write-Host "  Server A: http://localhost:3001" -ForegroundColor Green
Write-Host "    Data:   $dataA" -ForegroundColor DarkGray
Write-Host "    Guild:  RPI Fools" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Server B: http://localhost:3002" -ForegroundColor Yellow
Write-Host "    Data:   $dataB" -ForegroundColor DarkGray
Write-Host "    Guild:  Role Playing Adventures" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Federation test scenarios:" -ForegroundColor White
Write-Host "  1. Sign up on Server A (port 3001) - this becomes your primary account"
Write-Host "  2. Settings -> Trusted Servers -> Add http://localhost:3002"
Write-Host "  3. Connect to Server B in the client - log in with same credentials"
Write-Host "  4. Verify cross-server token works (check Server B log for [AUTH] messages)"
Write-Host "  5. Verify shared Discord users appear on both servers"
Write-Host "  6. Kill Server A - observe Server B behavior (will work for ~5 mins via cache)"
Write-Host ""
Write-Host "Press Enter to stop both servers and exit." -ForegroundColor DarkGray
Write-Host ""

$cmdA = "`$host.UI.RawUI.WindowTitle = 'Harmony Server A :3001'; Write-Host '=== SERVER A (port 3001) ===' -ForegroundColor Green; `$env:PORT = '3001'; `$env:HARMONY_DATA_DIR = '$($dataA -replace "'", "''")'; `$env:NODE_ENV = 'development'; node '$($serverEntry -replace "'", "''")'"
$procA = Start-Process powershell -ArgumentList "-NoExit", "-Command", "`"$cmdA`"" -PassThru

Start-Sleep -Milliseconds 1500  # stagger startup so port 3001 initializes first

$cmdB = "`$host.UI.RawUI.WindowTitle = 'Harmony Server B :3002'; Write-Host '=== SERVER B (port 3002) ===' -ForegroundColor Yellow; `$env:PORT = '3002'; `$env:HARMONY_DATA_DIR = '$($dataB -replace "'", "''")'; `$env:NODE_ENV = 'development'; node '$($serverEntry -replace "'", "''")'"
$procB = Start-Process powershell -ArgumentList "-NoExit", "-Command", "`"$cmdB`"" -PassThru

Write-Host "Server A PID: $($procA.Id)" -ForegroundColor Green
Write-Host "Server B PID: $($procB.Id)" -ForegroundColor Yellow

Read-Host

Write-Host "Stopping servers..." -ForegroundColor Cyan
# taskkill /T kills the entire process tree (the PowerShell wrapper AND its
# Node.js child), which Stop-Process alone does not do.
taskkill /T /F /PID $procA.Id 2>$null | Out-Null
taskkill /T /F /PID $procB.Id 2>$null | Out-Null
Write-Host "Done." -ForegroundColor Cyan
