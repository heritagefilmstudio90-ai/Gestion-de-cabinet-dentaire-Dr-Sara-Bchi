#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CAP_DIR="$ROOT_DIR/native-packaging/capacitor"

echo "=== Gestion de cabinet dentaire Dr. Sara Bchi — Build Natif Mobile (Capacitor : Android & iOS) ==="

command -v node >/dev/null 2>&1 || { echo "Erreur : Node.js 20+ requis."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Erreur : npm requis."; exit 1; }

cd "$ROOT_DIR"

echo "[1/5] Préparation des ressources icônes depuis /public..."
node "$ROOT_DIR/native-packaging/scripts/prepare-icons.mjs"

echo "[2/5] Compilation du bundle PWA (/dist)..."
npm run build

cd "$CAP_DIR"
if [ ! -f "$CAP_DIR/package.json" ]; then
  cp "$CAP_DIR/package.native.json" "$CAP_DIR/package.json"
fi

echo "[3/5] Installation des dépendances Capacitor isolées..."
npm install

if [ ! -d "$CAP_DIR/android" ]; then
  echo "[4/5] Ajout de la plateforme Android..."
  npx cap add android
fi

if [ "$(uname -s)" = "Darwin" ] && [ ! -d "$CAP_DIR/ios" ]; then
  echo "[4/5] Ajout de la plateforme iOS (macOS détecté)..."
  npx cap add ios
fi

echo "[5/5] Génération des icônes/splash natifs & synchronisation Capacitor..."
npx @capacitor/assets generate \
  --iconBackgroundColor '#0B2239' \
  --splashBackgroundColor '#0B2239' \
  --splashBackgroundColorDark '#0B2239'
npx cap sync

echo "=== Terminé ! Ouvrez Android Studio ('npm --prefix native-packaging/capacitor run cap:open:android') ou Xcode ('npm --prefix native-packaging/capacitor run cap:open:ios'). ==="
