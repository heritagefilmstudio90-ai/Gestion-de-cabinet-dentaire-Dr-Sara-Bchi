const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();

export interface ZipEntryInput {
  name: string;
  data: Uint8Array | string;
  executable?: boolean;
}

export function buildZipBlob(entries: ZipEntryInput[]): Blob {
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const dataBytes =
      typeof entry.data === 'string' ? textEncoder.encode(entry.data) : entry.data;
    const checksum = crc32(dataBytes);

    // Local File Header (30 bytes + name)
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression: STORE
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    lfh.set(nameBytes, 30);

    localChunks.push(lfh, dataBytes);

    // Central Directory Header (46 bytes + name)
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    const unixMode = entry.executable ? 0o100755 : 0o100644;
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true); // version made by: Unix (3), zip 2.0
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 filename
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, (unixMode << 16) >>> 0, true); // external Unix permissions
    cv.setUint32(42, offset, true); // relative offset of local header
    cdh.set(nameBytes, 46);

    centralChunks.push(cdh);
    offset += lfh.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const chunk of centralChunks) centralSize += chunk.length;

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, eocd] as BlobPart[], {
    type: 'application/zip',
  });
}

function buildIcnsBytes(png256: Uint8Array, png512: Uint8Array): Uint8Array {
  // Apple ICNS container with 'ic08' (256x256 PNG) and 'ic09' (512x512 PNG)
  const totalSize = 8 + (8 + png256.length) + (8 + png512.length);
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  out.set(textEncoder.encode('icns'), 0);
  view.setUint32(4, totalSize, false);

  let pos = 8;
  out.set(textEncoder.encode('ic08'), pos);
  view.setUint32(pos + 4, 8 + png256.length, false);
  out.set(png256, pos + 8);
  pos += 8 + png256.length;

  out.set(textEncoder.encode('ic09'), pos);
  view.setUint32(pos + 4, 8 + png512.length, false);
  out.set(png512, pos + 8);

  return out;
}

async function fetchBinaryAsset(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Impossible de charger la ressource ${path}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sanitizeShellUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Fallback below
  }
  return 'https://dentaflow.local';
}

export async function downloadMacAppPackage(rawOrigin?: string): Promise<void> {
  const appUrl = sanitizeShellUrl(
    rawOrigin || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const [png256, png512] = await Promise.all([
    fetchBinaryAsset('/pwa-256x256.png'),
    fetchBinaryAsset('/pwa-512x512.png'),
  ]);
  const icnsBytes = buildIcnsBytes(png256, png512);

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>DentaFlow Pro</string>
  <key>CFBundleDisplayName</key>
  <string>DentaFlow Pro</string>
  <key>CFBundleIdentifier</key>
  <string>com.dentaflow.drsarabchi</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>DentaFlowPro</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

  const macExecutable = `#!/bin/bash
APP_URL="${appUrl}"
PROFILE_DIR="$HOME/Library/Application Support/DentaFlowPro-Mac"

if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="$APP_URL" --user-data-dir="$PROFILE_DIR/Chrome" >/dev/null 2>&1 &
elif [ -x "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
  exec "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --app="$APP_URL" --user-data-dir="$PROFILE_DIR/Edge" >/dev/null 2>&1 &
elif [ -x "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" ]; then
  exec "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --app="$APP_URL" --user-data-dir="$PROFILE_DIR/Brave" >/dev/null 2>&1 &
elif [ -d "/Applications/Safari.app" ]; then
  open -a Safari "$APP_URL"
else
  open "$APP_URL"
fi
`;

  const installCommand = `#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$SCRIPT_DIR/DentaFlow Pro.app"
TARGET_DIR="/Applications"
if [ ! -w "$TARGET_DIR" ]; then
  TARGET_DIR="$HOME/Applications"
  mkdir -p "$TARGET_DIR"
fi
TARGET_APP="$TARGET_DIR/DentaFlow Pro.app"

echo "Installation de DentaFlow Pro — Cabinet Dentaire Dr. Sara Bchi..."
rm -rf "$TARGET_APP"
cp -R "$APP_SRC" "$TARGET_APP"
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
chmod +x "$TARGET_APP/Contents/MacOS/DentaFlowPro"
echo "Installation réussie dans : $TARGET_APP"
open "$TARGET_APP"
`;

  const readmeTxt = `DentaFlow Pro — Cabinet Dentaire Dr. Sara Bchi (macOS)
======================================================

INSTALLATION DIRECTE SUR MAC (2 options simples) :

Option 1 (Recommandée — Installation en 1 double-clic dans Applications) :
1. Double-cliquez sur ce fichier ZIP s'il n'est pas déjà décompressé.
2. Faites un Clic droit sur "Installer sur Mac.command" -> "Ouvrir"
   (puis cliquez "Ouvrir" si macOS demande confirmation).
3. L'application "DentaFlow Pro.app" (avec le logo Dr. Sara Bchi) sera
   copiée dans votre dossier Applications et lancée en fenêtre dédiée.
4. Vous pourrez ensuite la garder dans votre Dock !

Option 2 (Manuel) :
- Glissez "DentaFlow Pro.app" dans votre dossier Applications.
- Au premier lancement, faites Clic droit -> Ouvrir pour autoriser
  l'application sur macOS Gatekeeper.

URL liée : ${appUrl}
`;

  const blob = buildZipBlob([
    { name: 'DentaFlow Pro.app/Contents/Info.plist', data: infoPlist },
    { name: 'DentaFlow Pro.app/Contents/Resources/AppIcon.icns', data: icnsBytes },
    {
      name: 'DentaFlow Pro.app/Contents/MacOS/DentaFlowPro',
      data: macExecutable,
      executable: true,
    },
    { name: 'Installer sur Mac.command', data: installCommand, executable: true },
    { name: 'LISEZ-MOI-MAC.txt', data: readmeTxt },
  ]);

  triggerBlobDownload(blob, 'DentaFlow-Pro-Mac.zip');
}

export async function downloadBrowserExtensionPackage(rawOrigin?: string): Promise<void> {
  const appUrl = sanitizeShellUrl(
    rawOrigin || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const [png192, png512] = await Promise.all([
    fetchBinaryAsset('/pwa-192x192.png'),
    fetchBinaryAsset('/pwa-512x512.png'),
  ]);

  const manifestJson = JSON.stringify(
    {
      manifest_version: 3,
      name: 'DentaFlow Pro — Cabinet Dr. Sara Bchi',
      short_name: 'DentaFlow',
      version: '1.0.0',
      description:
        'Lanceur direct en fenêtre dédiée pour le logiciel DentaFlow Pro (Cabinet Dentaire Dr. Sara Bchi).',
      action: {
        default_title: 'Ouvrir DentaFlow Pro',
        default_icon: {
          '192': 'icon-192.png',
          '512': 'icon-512.png',
        },
      },
      icons: {
        '192': 'icon-192.png',
        '512': 'icon-512.png',
      },
      background: {
        service_worker: 'background.js',
      },
    },
    null,
    2
  );

  const backgroundJs = `const APP_URL = ${JSON.stringify(appUrl)};

chrome.action.onClicked.addListener(async () => {
  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    const existing = windows.find((win) =>
      (win.tabs || []).some((tab) => typeof tab.url === 'string' && tab.url.startsWith(APP_URL))
    );
    if (existing && typeof existing.id === 'number') {
      await chrome.windows.update(existing.id, { focused: true });
      return;
    }
    await chrome.windows.create({
      url: APP_URL,
      type: 'popup',
      width: 1360,
      height: 860,
    });
  } catch (_err) {
    chrome.tabs.create({ url: APP_URL });
  }
});
`;

  const installGuideTxt = `Extension Chrome / Edge / Brave pour Mac & PC — DentaFlow Pro
=================================================================

1. Décompressez ce fichier ZIP dans un dossier permanent (ex: Documents/DentaFlow-Extension).
2. Ouvrez Google Chrome (ou Microsoft Edge / Brave) sur votre Mac.
3. Dans la barre d'adresse, tapez : chrome://extensions  (ou edge://extensions)
4. Activez "Mode développeur" en haut à droite.
5. Cliquez sur "Charger l'extension non empaquetée" et sélectionnez le dossier décompressé.
6. Épinglez l'icône DentaFlow Pro (logo Dr. Sara Bchi) dans votre barre Chrome :
   un seul clic lance directement le logiciel dans sa fenêtre dédiée sans barre d'adresse !

URL configurée : ${appUrl}
`;

  const blob = buildZipBlob([
    { name: 'DentaFlow-Extension/manifest.json', data: manifestJson },
    { name: 'DentaFlow-Extension/background.js', data: backgroundJs },
    { name: 'DentaFlow-Extension/icon-192.png', data: png192 },
    { name: 'DentaFlow-Extension/icon-512.png', data: png512 },
    { name: 'DentaFlow-Extension/INSTALLATION-EXTENSION.txt', data: installGuideTxt },
  ]);

  triggerBlobDownload(blob, 'DentaFlow-Pro-Extension.zip');
}
