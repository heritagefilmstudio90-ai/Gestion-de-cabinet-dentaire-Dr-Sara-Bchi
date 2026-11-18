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

function buildIcoBytes(png256: Uint8Array): Uint8Array {
  // Windows ICO container wrapping a 256x256 PNG (supported since Windows Vista+)
  const headerSize = 6 + 16;
  const out = new Uint8Array(headerSize + png256.length);
  const view = new DataView(out.buffer);

  // ICONDIR (6 bytes)
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = 1 (icon)
  view.setUint16(4, 1, true); // image count = 1

  // ICONDIRENTRY (16 bytes)
  out[6] = 0; // width: 0 means 256px
  out[7] = 0; // height: 0 means 256px
  out[8] = 0; // color palette count
  out[9] = 0; // reserved
  view.setUint16(10, 1, true); // color planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png256.length, true); // image byte size
  view.setUint32(18, headerSize, true); // offset to PNG data

  out.set(png256, headerSize);
  return out;
}

export async function downloadWindowsAppPackage(rawOrigin?: string): Promise<void> {
  const appUrl = sanitizeShellUrl(
    rawOrigin || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const isDevProxyUrl = appUrl.includes('://ais-dev-');
  const png256 = await fetchBinaryAsset('/pwa-256x256.png');
  const icoBytes = buildIcoBytes(png256);

  const vbsLauncher = `' Lanceur Windows (mode application autonome sans barre navigateur)
Option Explicit
Dim shell, fso, localAppData, profileDir, appUrl, browsers, b, cmd, extraArgs
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appUrl = "${appUrl}"
localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
profileDir = localAppData & "\\CabinetDrSaraBchi-Win\\Profile"
extraArgs = ${
    isDevProxyUrl
      ? `"--no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2 --window-size=1440,900"`
      : `"--user-data-dir=""" & profileDir & """ --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2 --window-size=1440,900"`
  }

browsers = Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\\Microsoft\\Edge\\Application\\msedge.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\\Microsoft\\Edge\\Application\\msedge.exe", _
  localAppData & "\\Microsoft\\Edge\\Application\\msedge.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\\Google\\Chrome\\Application\\chrome.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\\Google\\Chrome\\Application\\chrome.exe", _
  localAppData & "\\Google\\Chrome\\Application\\chrome.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" _
)

For Each b In browsers
  If fso.FileExists(b) Then
    cmd = """" & b & """ --app=""" & appUrl & """ " & extraArgs
    shell.Run cmd, 1, False
    WScript.Quit
  End If
Next

shell.Run """" & appUrl & """", 1, False
`;

  const psInstaller = `$ErrorActionPreference = 'Stop'
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:LOCALAPPDATA 'CabinetDrSaraBchi-Win'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$VbsSrc = Join-Path $SourceDir 'Lancer Gestion de cabinet dentaire Dr. Sara Bchi.vbs'
$IcoSrc = Join-Path $SourceDir 'Cabinet-Dr-Sara-Bchi.ico'
$VbsDst = Join-Path $InstallDir 'Lancer Gestion de cabinet dentaire Dr. Sara Bchi.vbs'
$IcoDst = Join-Path $InstallDir 'Cabinet-Dr-Sara-Bchi.ico'

if (-not (Test-Path $IcoSrc)) {
  throw "Extrayez d'abord tout le dossier ZIP avant de lancer Installer sur Windows.bat."
}

Copy-Item -Path $VbsSrc -Destination $VbsDst -Force
Copy-Item -Path $IcoSrc -Destination $IcoDst -Force
try { Unblock-File -Path $VbsDst -ErrorAction SilentlyContinue } catch {}

$AppUrl = '${appUrl}'
$ProfileDir = Join-Path $InstallDir 'Profile'
$Candidates = @(
  (Join-Path $env:ProgramFiles 'Microsoft\\Edge\\Application\\msedge.exe'),
  (Join-Path \${env:ProgramFiles(x86)} 'Microsoft\\Edge\\Application\\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\\Edge\\Application\\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Google\\Chrome\\Application\\chrome.exe'),
  (Join-Path \${env:ProgramFiles(x86)} 'Google\\Chrome\\Application\\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\\Chrome\\Application\\chrome.exe'),
  (Join-Path $env:ProgramFiles 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')
)
$BrowserExe = $Candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$Wsh = New-Object -ComObject WScript.Shell
$DesktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Gestion de cabinet dentaire Dr. Sara Bchi.lnk'
$StartMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Gestion de cabinet dentaire Dr. Sara Bchi'
New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null
$StartLink = Join-Path $StartMenuDir 'Gestion de cabinet dentaire Dr. Sara Bchi.lnk'

$LaunchArgs = ${
    isDevProxyUrl
      ? `'"--app=' + $AppUrl + '" --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2 --window-size=1440,900'`
      : `'"--app=' + $AppUrl + '" "--user-data-dir=' + $ProfileDir + '" --no-first-run --no-default-browser-check --disable-features=msEdgeSidebarV2 --window-size=1440,900'`
  }

foreach ($TargetLink in @($DesktopLink, $StartLink)) {
  $Shortcut = $Wsh.CreateShortcut($TargetLink)
  if ($BrowserExe) {
    $Shortcut.TargetPath = $BrowserExe
    $Shortcut.Arguments = $LaunchArgs
  } else {
    $Shortcut.TargetPath = 'wscript.exe'
    $Shortcut.Arguments = '"' + $VbsDst + '"'
  }
  $Shortcut.WorkingDirectory = $InstallDir
  $Shortcut.IconLocation = $IcoDst + ',0'
  $Shortcut.Description = 'Gestion de cabinet dentaire Dr. Sara Bchi'
  $Shortcut.Save()
}

Write-Host 'Gestion de cabinet dentaire Dr. Sara Bchi installe sur le Bureau et dans le Menu Demarrer !' -ForegroundColor Green
if ($BrowserExe) {
  Start-Process -FilePath $BrowserExe -ArgumentList $LaunchArgs
} else {
  Start-Process 'wscript.exe' -ArgumentList ('"' + $VbsDst + '"')
}
`;

  const batInstaller = `@echo off
chcp 65001 >nul
if not exist "%~dp0Cabinet-Dr-Sara-Bchi.ico" (
  echo.
  echo [ATTENTION] Vous devez d'abord extraire le fichier ZIP ^(Clic droit -^> Extraire tout...^) avant de lancer cet installateur.
  echo.
  pause
  exit /b 1
)
echo Installation de Gestion de cabinet dentaire Dr. Sara Bchi sur Windows...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Cabinet-Dr-Sara-Bchi.ps1"
if errorlevel 1 (
  echo.
  echo Erreur pendant l'installation. Essayez "Lancer Gestion de cabinet dentaire Dr. Sara Bchi.vbs".
  pause
)
`;

  const readmeWin = `Gestion de cabinet dentaire Dr. Sara Bchi (Windows 10 / 11)
==================================================================

INSTALLATION SUR WINDOWS (en 1 double-clic) :

1. Faites un clic droit sur ce fichier ZIP -> "Extraire tout..."
2. Ouvrez le dossier extrait et double-cliquez sur :
   "Installer sur Windows.bat"
   (Si Windows SmartScreen affiche un avertissement : "Informations complementaires" -> "Executer quand meme").
3. Un raccourci "Gestion de cabinet dentaire Dr. Sara Bchi" (avec le logo du cabinet) est cree
   automatiquement sur votre Bureau et dans votre Menu Demarrer.
4. L'application s'ouvre dans sa propre fenetre bureau (sans barre navigateur ni onglets).

URL liee : ${appUrl}
`;

  const blob = buildZipBlob([
    { name: 'Cabinet-Dr-Sara-Bchi-Windows/Cabinet-Dr-Sara-Bchi.ico', data: icoBytes },
    { name: 'Cabinet-Dr-Sara-Bchi-Windows/Lancer Gestion de cabinet dentaire Dr. Sara Bchi.vbs', data: vbsLauncher },
    { name: 'Cabinet-Dr-Sara-Bchi-Windows/Installer-Cabinet-Dr-Sara-Bchi.ps1', data: psInstaller },
    { name: 'Cabinet-Dr-Sara-Bchi-Windows/Installer sur Windows.bat', data: batInstaller },
    { name: 'Cabinet-Dr-Sara-Bchi-Windows/LISEZ-MOI-WINDOWS.txt', data: readmeWin },
  ]);

  triggerBlobDownload(blob, 'Cabinet-Dr-Sara-Bchi-Windows.zip');
}

export async function downloadMacAppPackage(rawOrigin?: string): Promise<void> {
  const appUrl = sanitizeShellUrl(
    rawOrigin || (typeof window !== 'undefined' ? window.location.origin : '')
  );
  const isDevProxyUrl = appUrl.includes('://ais-dev-');
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
  <string>Gestion de cabinet dentaire Dr. Sara Bchi</string>
  <key>CFBundleDisplayName</key>
  <string>Gestion de cabinet dentaire Dr. Sara Bchi</string>
  <key>CFBundleIdentifier</key>
  <string>com.dentaflow.drsarabchi</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>CabinetDrSaraBchi</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

  const macExecutable = isDevProxyUrl
    ? `#!/bin/bash
APP_URL="${appUrl}"

if [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "/Applications/Microsoft Edge.app" --args --app="$APP_URL" --no-first-run --no-default-browser-check --new-window
elif [ -d "/Applications/Google Chrome.app" ]; then
  open -na "/Applications/Google Chrome.app" --args --app="$APP_URL" --no-first-run --no-default-browser-check --new-window
elif [ -d "/Applications/Brave Browser.app" ]; then
  open -na "/Applications/Brave Browser.app" --args --app="$APP_URL" --no-first-run --no-default-browser-check --new-window
elif [ -d "/Applications/Safari.app" ]; then
  open -a Safari "$APP_URL"
else
  open "$APP_URL"
fi
`
    : `#!/bin/bash
APP_URL="${appUrl}"
PROFILE_DIR="$HOME/Library/Application Support/CabinetDrSaraBchi-Mac"

if [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "/Applications/Microsoft Edge.app" --args --app="$APP_URL" --user-data-dir="$PROFILE_DIR/Edge" --no-first-run --no-default-browser-check --new-window
elif [ -d "/Applications/Brave Browser.app" ]; then
  open -na "/Applications/Brave Browser.app" --args --app="$APP_URL" --user-data-dir="$PROFILE_DIR/Brave" --no-first-run --no-default-browser-check --new-window
elif [ -d "/Applications/Google Chrome.app" ]; then
  open -na "/Applications/Google Chrome.app" --args --app="$APP_URL" --user-data-dir="$PROFILE_DIR/Chrome" --no-first-run --no-default-browser-check --new-window
elif [ -d "/Applications/Safari.app" ]; then
  open -a Safari "$APP_URL"
else
  open "$APP_URL"
fi
`;

  const installCommand = `#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$SCRIPT_DIR/Gestion de cabinet dentaire Dr. Sara Bchi.app"
TARGET_DIR="/Applications"
if [ ! -w "$TARGET_DIR" ]; then
  TARGET_DIR="$HOME/Applications"
  mkdir -p "$TARGET_DIR"
fi
TARGET_APP="$TARGET_DIR/Gestion de cabinet dentaire Dr. Sara Bchi.app"

echo "Installation de Gestion de cabinet dentaire Dr. Sara Bchi..."
rm -rf "$TARGET_APP"
cp -R "$APP_SRC" "$TARGET_APP"
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
chmod +x "$TARGET_APP/Contents/MacOS/CabinetDrSaraBchi"

if [ -d "$HOME/Desktop" ]; then
  ln -sfn "$TARGET_APP" "$HOME/Desktop/Gestion de cabinet dentaire Dr. Sara Bchi.app"
fi

echo "Installation réussie dans : $TARGET_APP (et raccourci créé sur le Bureau)"
open "$TARGET_APP"
`;

  const readmeTxt = `Gestion de cabinet dentaire Dr. Sara Bchi (macOS)
======================================================

INSTALLATION DIRECTE SUR MAC (fenêtre autonome sans barre navigateur) :

Option 1 (Recommandée — 100 % Apple Safari WebKit, zéro Chrome même dans la barre des menus) :
1. Ouvrez Safari sur votre Mac et allez sur :
   ${appUrl}
2. Dans la barre des menus en haut : Fichier -> "Ajouter au Dock..."
3. L'application s'ouvre dans sa propre fenêtre macOS native avec son icône dans le Dock.

Option 2 (Installeur .app + raccourci sur le Bureau) :
1. Double-cliquez sur ce fichier ZIP s'il n'est pas déjà décompressé.
2. Si macOS bloque "Installer sur Mac.command" (développeur non identifié) :
   Ouvrez Terminal et glissez-déposez le fichier "Installer sur Mac.command" précédé de "bash ",
   ou autorisez-le dans Réglages Système -> Confidentialité et sécurité -> Ouvrir quand même.
3. L'application "Gestion de cabinet dentaire Dr. Sara Bchi.app" est copiée dans Applications,
   un raccourci est ajouté sur votre Bureau, et le logiciel démarre sans barre d'adresse.

URL liée : ${appUrl}
`;

  const blob = buildZipBlob([
    { name: 'Gestion de cabinet dentaire Dr. Sara Bchi.app/Contents/Info.plist', data: infoPlist },
    { name: 'Gestion de cabinet dentaire Dr. Sara Bchi.app/Contents/Resources/AppIcon.icns', data: icnsBytes },
    {
      name: 'Gestion de cabinet dentaire Dr. Sara Bchi.app/Contents/MacOS/CabinetDrSaraBchi',
      data: macExecutable,
      executable: true,
    },
    { name: 'Installer sur Mac.command', data: installCommand, executable: true },
    { name: 'LISEZ-MOI-MAC.txt', data: readmeTxt },
  ]);

  triggerBlobDownload(blob, 'Cabinet-Dr-Sara-Bchi-Mac.zip');
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
      name: 'Gestion de cabinet dentaire Dr. Sara Bchi',
      short_name: 'Dr Sara Bchi',
      version: '1.0.0',
      description:
        'Lanceur direct en fenêtre dédiée pour Gestion de cabinet dentaire Dr. Sara Bchi.',
      action: {
        default_title: 'Ouvrir Gestion de cabinet dentaire Dr. Sara Bchi',
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

  const installGuideTxt = `Extension Chrome / Edge / Brave pour Mac & PC — Gestion de cabinet dentaire Dr. Sara Bchi
=================================================================

1. Décompressez ce fichier ZIP dans un dossier permanent (ex: Documents/Cabinet-Dr-Sara-Bchi-Extension).
2. Ouvrez Google Chrome (ou Microsoft Edge / Brave).
3. Dans la barre d'adresse, tapez : chrome://extensions  (ou edge://extensions)
4. Activez "Mode développeur" en haut à droite.
5. Cliquez sur "Charger l'extension non empaquetée" et sélectionnez le dossier décompressé.
6. Épinglez l'icône Gestion de cabinet dentaire Dr. Sara Bchi (logo Dr. Sara Bchi) dans votre barre :
   un seul clic lance directement le logiciel dans sa fenêtre dédiée sans barre d'adresse !

URL configurée : ${appUrl}
`;

  const blob = buildZipBlob([
    { name: 'Cabinet-Dr-Sara-Bchi-Extension/manifest.json', data: manifestJson },
    { name: 'Cabinet-Dr-Sara-Bchi-Extension/background.js', data: backgroundJs },
    { name: 'Cabinet-Dr-Sara-Bchi-Extension/icon-192.png', data: png192 },
    { name: 'Cabinet-Dr-Sara-Bchi-Extension/icon-512.png', data: png512 },
    { name: 'Cabinet-Dr-Sara-Bchi-Extension/INSTALLATION-EXTENSION.txt', data: installGuideTxt },
  ]);

  triggerBlobDownload(blob, 'Cabinet-Dr-Sara-Bchi-Extension.zip');
}
