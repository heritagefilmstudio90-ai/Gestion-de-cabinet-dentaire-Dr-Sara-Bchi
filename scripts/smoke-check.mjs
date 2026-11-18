import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function normalizePhoneForSms(rawPhone) {
  const trimmed = rawPhone.trim().replace(/[\s().-]/g, '');
  if (trimmed.startsWith('00')) {
    return `+${trimmed.slice(2)}`;
  }
  if (/^0[567]\d{8}$/.test(trimmed)) {
    return `+212${trimmed.slice(1)}`;
  }
  return trimmed;
}

function normalizePhoneDigitsForWhatsApp(rawPhone) {
  const trimmed = (rawPhone || '').trim().replace(/[\s().-]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return trimmed.slice(1).replace(/\D/g, '');
  }
  if (trimmed.startsWith('00')) {
    return trimmed.slice(2).replace(/\D/g, '');
  }
  const digits = trimmed.replace(/\D/g, '');
  if (/^0[567]\d{8}$/.test(digits)) {
    return `212${digits.slice(1)}`;
  }
  return digits;
}

test('Normalisation téléphonique Maroc (SMS & WhatsApp)', () => {
  assert.equal(normalizePhoneForSms('06 12-34.56.78'), '+212612345678');
  assert.equal(normalizePhoneForSms('0532101351'), '+212532101351');
  assert.equal(normalizePhoneForSms('00212612345678'), '+212612345678');
  assert.equal(normalizePhoneDigitsForWhatsApp('+212 6 12 34 56 78'), '212612345678');
  assert.equal(normalizePhoneDigitsForWhatsApp('07 00 11 22 33'), '212700112233');
  assert.equal(normalizePhoneDigitsForWhatsApp(''), '');
});

test('Durcissement HTTP & authentification serveur dans server.ts', () => {
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

  assert.match(serverSource, /app\.disable\('x-powered-by'\)/);
  assert.match(serverSource, /express\.json\(\{\s*limit:\s*'512kb'\s*\}\)/);
  assert.match(serverSource, /X-Content-Type-Options/);
  assert.match(serverSource, /Strict-Transport-Security/);
  assert.match(serverSource, /Permissions-Policy/);
  assert.match(serverSource, /verifyFirebaseBearerToken/);
  assert.match(serverSource, /AbortSignal\.timeout\(/);
  assert.match(serverSource, /app\.listen\(PORT,\s*'0\.0\.0\.0'/);
});

test('Contrat package.json, build scripts et ressources PWA', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const requiredScript of ['dev', 'build', 'start', 'lint', 'verify']) {
    assert.ok(pkg.scripts?.[requiredScript], `Script manquant dans package.json : ${requiredScript}`);
  }
  assert.equal(pkg.scripts.start, 'node server.ts');

  for (const asset of ['apple-touch-icon.png', 'icon.svg', 'pwa-192x192.png', 'pwa-512x512.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', asset)), `Ressource PWA manquante : ${asset}`);
  }
});

test('Hygiène client src/ (absence de window.alert/open non sécurisés)', () => {
  const srcDir = path.join(ROOT, 'src');
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  walk(srcDir);

  assert.ok(files.length > 0, 'Aucun fichier source trouvé dans src/');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.equal(
      /\bwindow\.alert\s*\(/.test(content),
      false,
      `window.alert interdit dans iFrame : ${rel}`
    );
    assert.equal(
      /\bwindow\.open\s*\(/.test(content),
      false,
      `window.open interdit dans iFrame : ${rel}`
    );
  }
});
