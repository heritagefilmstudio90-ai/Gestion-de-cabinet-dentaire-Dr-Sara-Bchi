export function formatMAD(amount: number | undefined | null): string {
  const value = Number.isFinite(amount) ? Number(amount) : 0;
  return `${value.toLocaleString('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysISO(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function formatDateFR(isoDate: string | undefined | null): string {
  if (!isoDate) return '—';
  const parts = isoDate.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return isoDate;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return dt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function computeWaitingMinutes(arrivedAtIso?: string): number {
  if (!arrivedAtIso) return 0;
  const start = new Date(arrivedAtIso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.round((Date.now() - start) / 60000));
}

export function generateSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

function sanitizeCsvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '""';
  if (typeof val === 'number') {
    const numStr = Number.isFinite(val) ? String(val) : '0';
    return `"${numStr}"`;
  }
  let str = String(val)
    .replace(/\0/g, '')
    .replace(/\r?\n/g, ' ');
  // Neutralize CSV / spreadsheet formula injection (=, +, -, @, tab, CR)
  if (/^[\s]*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function buildCsvContent(headers: string[], rows: Array<Array<string | number>>): string {
  return [
    headers.map(sanitizeCsvCell).join(';'),
    ...rows.map((r) => r.map(sanitizeCsvCell).join(';')),
  ].join('\n');
}

function triggerCsvDownload(filename: string, csvContent: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function computeSha256Hex(content: string): Promise<string> {
  try {
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
      const encoded = new TextEncoder().encode('\uFEFF' + content);
      const digest = await window.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback below if WebCrypto is unavailable
  }
  // Deterministic non-cryptographic fallback fingerprint if SubtleCrypto is unavailable
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function exportToCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const csv = buildCsvContent(headers, rows);
  triggerCsvDownload(filename, csv);
}

export async function exportSecureCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>
): Promise<{ sha256: string; rowCount: number; byteSize: number }> {
  const csv = buildCsvContent(headers, rows);
  const sha256 = await computeSha256Hex(csv);
  const byteSize = new TextEncoder().encode('\uFEFF' + csv).length;
  triggerCsvDownload(filename, csv);
  return {
    sha256,
    rowCount: rows.length,
    byteSize,
  };
}

export async function compressImageToDataUrl(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format image non reconnu.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Contexte graphique indisponible.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
