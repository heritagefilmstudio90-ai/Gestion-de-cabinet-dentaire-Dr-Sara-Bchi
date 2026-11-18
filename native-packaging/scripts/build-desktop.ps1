$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TauriDir = Join-Path $RootDir "native-packaging\tauri"

Write-Host "=== Gestion de cabinet dentaire Dr. Sara Bchi — Build Natif Windows (Tauri v2 .exe / .msi) ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ est requis."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "Rust/Cargo est requis (https://rustup.rs) avec Visual Studio C++ Build Tools."
}

Push-Location $RootDir
try {
  Write-Host "[1/4] Préparation des icônes depuis /public..."
  node (Join-Path $RootDir "native-packaging\scripts\prepare-icons.mjs")

  Write-Host "[2/4] Compilation du bundle PWA (/dist)..."
  npm run build

  Set-Location $TauriDir
  Write-Host "[3/4] Génération des icônes natives (.ico / PNG) via Tauri CLI..."
  npx --yes @tauri-apps/cli@^2 icon (Join-Path $RootDir "public\pwa-512x512.png")

  Write-Host "[4/4] Compilation de l'installateur Windows (.exe / .msi)..."
  npx --yes @tauri-apps/cli@^2 build @args

  Write-Host "=== Terminé ! Installateurs générés dans : $TauriDir\target\release\bundle\ ===" -ForegroundColor Green
}
finally {
  Pop-Location
}
