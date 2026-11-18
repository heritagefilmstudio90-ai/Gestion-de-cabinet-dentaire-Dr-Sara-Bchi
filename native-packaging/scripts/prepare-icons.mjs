import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const publicDir = path.join(rootDir, 'public');
const tauriIconsDir = path.join(rootDir, 'native-packaging/tauri/icons');
const capAssetsDir = path.join(rootDir, 'native-packaging/capacitor/assets');

const requiredSources = [
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
  'pwa-256x256.png',
  'pwa-192x192.png',
  'apple-touch-icon.png',
  'icon.svg',
];

for (const file of requiredSources) {
  const fullPath = path.join(publicDir, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`[native-packaging] Ressource icône introuvable : ${fullPath}`);
    process.exit(1);
  }
}

fs.mkdirSync(tauriIconsDir, { recursive: true });
fs.mkdirSync(capAssetsDir, { recursive: true });

// 1. Préparer les icônes sources Capacitor (@capacitor/assets) depuis les ressources PWA existantes
fs.copyFileSync(
  path.join(publicDir, 'pwa-512x512.png'),
  path.join(capAssetsDir, 'icon-only.png')
);
fs.copyFileSync(
  path.join(publicDir, 'pwa-maskable-512x512.png'),
  path.join(capAssetsDir, 'icon-foreground.png')
);
fs.copyFileSync(
  path.join(publicDir, 'pwa-512x512.png'),
  path.join(capAssetsDir, 'splash.png')
);
fs.copyFileSync(
  path.join(publicDir, 'pwa-512x512.png'),
  path.join(capAssetsDir, 'splash-dark.png')
);

// 2. Préparer la ressource source haute résolution pour Tauri (`tauri icon`)
fs.copyFileSync(
  path.join(publicDir, 'pwa-512x512.png'),
  path.join(tauriIconsDir, 'source-512x512.png')
);

console.log('[native-packaging] Icônes PWA existantes préparées avec succès :');
console.log(`  - Mobile Capacitor assets : ${path.relative(rootDir, capAssetsDir)}`);
console.log(`  - Bureau Tauri source     : ${path.relative(rootDir, path.join(tauriIconsDir, 'source-512x512.png'))}`);
