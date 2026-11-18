#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAURI_DIR="$ROOT_DIR/native-packaging/tauri"

echo "=== Gestion de cabinet dentaire Dr. Sara Bchi — Build Natif Bureau (Tauri v2 : macOS / Linux / Windows) ==="

command -v node >/dev/null 2>&1 || { echo "Erreur : Node.js 20+ requis."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Erreur : npm requis."; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Erreur : Rust/Cargo requis (https://rustup.rs)."; exit 1; }

cd "$ROOT_DIR"

echo "[1/4] Préparation des icônes depuis /public..."
node "$ROOT_DIR/native-packaging/scripts/prepare-icons.mjs"

echo "[2/4] Compilation du bundle PWA (/dist)..."
npm run build

echo "[3/4] Génération des icônes natives (.icns / .ico / PNG) via Tauri CLI..."
cd "$TAURI_DIR"
npx --yes @tauri-apps/cli@^2 icon "$ROOT_DIR/public/pwa-512x512.png"

echo "[4/4] Compilation de l'application bureau Tauri..."
npx --yes @tauri-apps/cli@^2 build "$@"

echo "=== Terminé ! Les installateurs générés se trouvent dans : $TAURI_DIR/target/release/bundle/ ==="
