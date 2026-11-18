$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$CapDir = Join-Path $RootDir "native-packaging\capacitor"

Write-Host "=== Gestion de cabinet dentaire Dr. Sara Bchi — Build Natif Android sur Windows (Capacitor) ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ est requis."
}

Push-Location $RootDir
try {
  Write-Host "[1/5] Préparation des ressources icônes depuis /public..."
  node (Join-Path $RootDir "native-packaging\scripts\prepare-icons.mjs")

  Write-Host "[2/5] Compilation du bundle PWA (/dist)..."
  npm run build

  Set-Location $CapDir
  if (-not (Test-Path (Join-Path $CapDir "package.json"))) {
    Copy-Item (Join-Path $CapDir "package.native.json") (Join-Path $CapDir "package.json")
  }

  Write-Host "[3/5] Installation des dépendances Capacitor isolées..."
  npm install

  if (-not (Test-Path (Join-Path $CapDir "android"))) {
    Write-Host "[4/5] Ajout de la plateforme Android..."
    npx cap add android
  }

  Write-Host "[5/5] Génération des icônes/splash natifs & synchronisation Capacitor..."
  npx @capacitor/assets generate `
    --iconBackgroundColor "#0B2239" `
    --splashBackgroundColor "#0B2239" `
    --splashBackgroundColorDark "#0B2239"
  npx cap sync android

  Write-Host "=== Terminé ! Ouvrez Android Studio avec : npx cap open android ===" -ForegroundColor Green
}
finally {
  Pop-Location
}
