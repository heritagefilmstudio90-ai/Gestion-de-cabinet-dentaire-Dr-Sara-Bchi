import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const tauriDir = path.join(rootDir, 'native-packaging/tauri');
const capDir = path.join(rootDir, 'native-packaging/capacitor');

function hasCommand(cmd) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(checker, [cmd], { stdio: 'ignore' });
  return res.status === 0;
}

function runStep(label, command, cwd = rootDir) {
  console.log(`\n==> ${label}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function validateConfigs() {
  const requiredFiles = [
    'native-packaging/tauri/tauri.conf.json',
    'native-packaging/tauri/Cargo.toml',
    'native-packaging/tauri/build.rs',
    'native-packaging/tauri/capabilities/default.json',
    'native-packaging/tauri/src/main.rs',
    'native-packaging/tauri/src/lib.rs',
    'native-packaging/capacitor/capacitor.config.ts',
    'native-packaging/capacitor/package.native.json',
    'native-packaging/capacitor/android-permissions.xml',
    'native-packaging/capacitor/ios-info-plist-keys.xml',
  ];

  for (const rel of requiredFiles) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Fichier natif manquant : ${rel}`);
    }
  }

  JSON.parse(fs.readFileSync(path.join(tauriDir, 'tauri.conf.json'), 'utf8'));
  JSON.parse(fs.readFileSync(path.join(tauriDir, 'capabilities/default.json'), 'utf8'));
  JSON.parse(fs.readFileSync(path.join(capDir, 'package.native.json'), 'utf8'));

  const capConfig = fs.readFileSync(path.join(capDir, 'capacitor.config.ts'), 'utf8');
  if (!capConfig.includes("webDir: '../../dist'")) {
    throw new Error("capacitor.config.ts doit pointer sur webDir: '../../dist'.");
  }
}

function runPreflight() {
  validateConfigs();
  runStep('Validation des ressources icônes (/public -> native-packaging)', 'node native-packaging/scripts/prepare-icons.mjs');

  const status = {
    node: process.version,
    npm: hasCommand('npm'),
    rustCargo: hasCommand('cargo'),
    androidAdb: hasCommand('adb'),
    xcodebuild: process.platform === 'darwin' ? hasCommand('xcodebuild') : false,
    distReady: fs.existsSync(path.join(rootDir, 'dist/index.html')),
  };

  console.log('\n[native-packaging] État de l’environnement natif :');
  console.log(`  - Node.js       : ${status.node}`);
  console.log(`  - npm           : ${status.npm ? 'OK' : 'Manquant'}`);
  console.log(`  - Bundle /dist  : ${status.distReady ? 'Compilé' : 'À compiler (npm run build)'}`);
  console.log(`  - Rust / Cargo  : ${status.rustCargo ? 'OK (prêt pour Tauri)' : 'Non installé (https://rustup.rs)'}`);
  console.log(`  - Android ADB   : ${status.androidAdb ? 'OK' : 'Non détecté (Android Studio requis pour APK/AAB)'}`);
  if (process.platform === 'darwin') {
    console.log(`  - Xcode CLI     : ${status.xcodebuild ? 'OK (prêt pour iOS/macOS)' : 'Non détecté'}`);
  }
}

function buildDesktop() {
  validateConfigs();
  if (!hasCommand('cargo')) {
    throw new Error('Rust/Cargo est requis pour compiler le conteneur Tauri (https://rustup.rs).');
  }
  runStep('Préparation des icônes PWA', 'node native-packaging/scripts/prepare-icons.mjs');
  runStep('Compilation de la PWA (/dist)', 'npm run build');
  runStep('Génération des icônes Tauri (.ico / .icns / PNG)', `npx --yes @tauri-apps/cli@^2 icon "${path.join(rootDir, 'public/pwa-512x512.png')}"`, tauriDir);
  runStep('Compilation du conteneur bureau Tauri v2', 'npx --yes @tauri-apps/cli@^2 build', tauriDir);
}

function buildMobile() {
  validateConfigs();
  runStep('Préparation des icônes PWA', 'node native-packaging/scripts/prepare-icons.mjs');
  runStep('Compilation de la PWA (/dist)', 'npm run build');

  const pkgDest = path.join(capDir, 'package.json');
  if (!fs.existsSync(pkgDest)) {
    fs.copyFileSync(path.join(capDir, 'package.native.json'), pkgDest);
  }

  runStep('Installation des dépendances Capacitor isolées', 'npm install', capDir);
  if (!fs.existsSync(path.join(capDir, 'android'))) {
    runStep('Initialisation du projet Android', 'npx cap add android', capDir);
  }
  if (process.platform === 'darwin' && !fs.existsSync(path.join(capDir, 'ios'))) {
    runStep('Initialisation du projet iOS', 'npx cap add ios', capDir);
  }
  runStep(
    'Génération des icônes et écrans de démarrage Capacitor',
    "npx @capacitor/assets generate --iconBackgroundColor '#0B2239' --splashBackgroundColor '#0B2239' --splashBackgroundColorDark '#0B2239'",
    capDir
  );
  runStep('Synchronisation du bundle PWA dans les projets natifs', 'npx cap sync', capDir);
}

const arg = process.argv[2] || '--check';
try {
  if (arg === '--check') {
    runPreflight();
  } else if (arg === '--desktop') {
    buildDesktop();
  } else if (arg === '--mobile') {
    buildMobile();
  } else {
    console.log('Usage: node native-packaging/scripts/package-native.mjs [--check | --desktop | --mobile]');
    process.exit(1);
  }
} catch (err) {
  console.error(`\n[Erreur native-packaging] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
