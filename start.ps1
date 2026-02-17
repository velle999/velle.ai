# ⚡ VELLE.AI — PowerShell Launcher
# Run: right-click > Run with PowerShell
# Or:  powershell -ExecutionPolicy Bypass -File start.ps1

$Host.UI.RawUI.WindowTitle = "VELLE.AI"
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║         ⚡ VELLE.AI — LAUNCHER          ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Config
$MODEL = if ($env:MODEL) { $env:MODEL } else { "qwen3:8b" }
$PORT = if ($env:PORT) { $env:PORT } else { "3000" }

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found! Install from https://nodejs.org" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
$nodeVer = (node --version)
Write-Host "[OK] Node.js $nodeVer" -ForegroundColor Green

# Check Ollama
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "[WARN] Ollama not in PATH. Install from https://ollama.ai" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Ollama found" -ForegroundColor Green
}

# Install deps
if (-not (Test-Path "node_modules")) {
    Write-Host "[Setup] Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Start Ollama if not running
$ollamaRunning = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if (-not $ollamaRunning) {
    Write-Host "[Starting] Ollama..." -ForegroundColor Yellow
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
}

# Check/pull model
Write-Host "[Check] Model: $MODEL" -ForegroundColor Cyan
$models = ollama list 2>$null
if ($models -notmatch $MODEL) {
    Write-Host "[Download] Pulling $MODEL... this may take a while." -ForegroundColor Yellow
    ollama pull $MODEL
}

Write-Host ""
Write-Host "[Starting] VELLE.AI on http://localhost:$PORT" -ForegroundColor Green
Write-Host "[Model] $MODEL" -ForegroundColor Cyan
Write-Host "[Press Ctrl+C to stop]" -ForegroundColor DarkGray
Write-Host ""

# Open browser after delay
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:$using:PORT"
} | Out-Null

# Set env and run
$env:MODEL = $MODEL
$env:PORT = $PORT
node server/index.js
