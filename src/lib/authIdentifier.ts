export const CLINIC_LOGIN_DOMAIN = 'dentaflow.local';

export interface NormalizedLoginIdentifier {
  displayLogin: string;
  authEmail: string;
  isLocalLogin: boolean;
}

export function validateLoginIdentifier(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "Veuillez saisir un identifiant (login) ou une adresse email.";
  }
  if (trimmed.includes('@')) {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
    if (!emailOk) {
      return "Le format de l'adresse email est invalide.";
    }
    return null;
  }
  if (trimmed.length < 3) {
    return "L'identifiant doit contenir au moins 3 caractères.";
  }
  if (!/^[a-z0-9._-]+$/.test(trimmed)) {
    return "L'identifiant ne peut contenir que des lettres sans accents, chiffres, points (.), tirets (-) ou underscores (_).";
  }
  return null;
}

export function normalizeLoginIdentifier(raw: string): NormalizedLoginIdentifier {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (cleaned.includes('@')) {
    const suffix = `@${CLINIC_LOGIN_DOMAIN}`;
    const isLocalLogin = cleaned.endsWith(suffix);
    return {
      displayLogin: isLocalLogin ? cleaned.slice(0, -suffix.length) : cleaned,
      authEmail: cleaned,
      isLocalLogin,
    };
  }
  const safeLocalPart = cleaned.replace(/[^a-z0-9._-]/g, '');
  return {
    displayLogin: safeLocalPart,
    authEmail: `${safeLocalPart}@${CLINIC_LOGIN_DOMAIN}`,
    isLocalLogin: true,
  };
}

export function formatStaffDisplayLogin(member: { login?: string; email: string }): string {
  if (member.login && member.login.trim().length > 0) {
    return member.login.trim();
  }
  const suffix = `@${CLINIC_LOGIN_DOMAIN}`;
  const lower = (member.email || '').toLowerCase();
  if (lower.endsWith(suffix)) {
    return lower.slice(0, -suffix.length);
  }
  return member.email;
}

export function generateSecurePassword(length = 10): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$!';
  const all = upper + lower + digits + symbols;

  const pick = (charset: string) => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return charset[arr[0] % charset.length];
    }
    return charset[Math.floor(Math.random() * charset.length)];
  };

  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j =
      typeof crypto !== 'undefined' && crypto.getRandomValues
        ? crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
        : Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
