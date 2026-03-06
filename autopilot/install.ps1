# Install @nexeradigital/gsd-autopilot
# Usage: irm https://raw.githubusercontent.com/NexeraDigital/get-shit-done/main/autopilot/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Package = "@nexeradigital/gsd-autopilot"

Write-Host "Installing $Package..." -ForegroundColor Cyan
Write-Host ""

# 1. Ensure Node.js >= 20
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js is required but not installed." -ForegroundColor Red
    Write-Host "Install it from https://nodejs.org (v20+)"
    exit 1
}

$nodeMajor = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 20) {
    $nodeVer = node -v
    Write-Host "Error: Node.js >= 20 required (found $nodeVer)" -ForegroundColor Red
    exit 1
}

# 2. Ensure GSD workflows are installed
$gsdInstalled = npm list -g get-shit-done-cc --depth=0 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: GSD workflows not found. Installing get-shit-done-cc..." -ForegroundColor Yellow
    npm install -g get-shit-done-cc@latest
}

# 3. Install globally
Write-Host "Running: npm install -g $Package" -ForegroundColor Cyan
npm install -g $Package

Write-Host ""
Write-Host "Done! Restart Claude Code to use /gsd:autopilot" -ForegroundColor Green
