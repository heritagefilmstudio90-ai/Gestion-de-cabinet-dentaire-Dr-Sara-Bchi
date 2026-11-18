import { formatDateFR } from './formatters';
import { Appointment, ClinicSettings, SmsReminderSettings } from '../types/dental';

export const DEFAULT_SMS_REMINDER_SETTINGS: SmsReminderSettings = {
  enabled: true,
  hoursBefore: 24,
  template:
    'Bonjour {patient}, rappel de votre RDV au {cabinet} le {date} à {heure} ({acte}). Tél : {tel}',
};

export function resolveSmsReminderSettings(
  clinicSettings: ClinicSettings | null | undefined
): SmsReminderSettings {
  const raw = clinicSettings?.smsReminders;
  return {
    enabled: raw?.enabled ?? DEFAULT_SMS_REMINDER_SETTINGS.enabled,
    hoursBefore:
      typeof raw?.hoursBefore === 'number' && raw.hoursBefore >= 1 && raw.hoursBefore <= 72
        ? raw.hoursBefore
        : DEFAULT_SMS_REMINDER_SETTINGS.hoursBefore,
    template:
      raw?.template && raw.template.trim().length > 0
        ? raw.template
        : DEFAULT_SMS_REMINDER_SETTINGS.template,
  };
}

export function getAppointmentDateTime(dateIso: string, startTime: string): Date | null {
  if (!dateIso) return null;
  const dateParts = dateIso.slice(0, 10).split('-').map(Number);
  if (dateParts.length !== 3 || dateParts.some(Number.isNaN)) return null;
  const [hoursRaw, minsRaw] = (startTime || '09:00').split(':').map(Number);
  const hours = Number.isFinite(hoursRaw) ? hoursRaw : 9;
  const mins = Number.isFinite(minsRaw) ? minsRaw : 0;
  return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], hours, mins, 0, 0);
}

export function isAppointmentDueForSmsReminder(
  apt: Appointment,
  hoursBefore: number,
  now: Date = new Date()
): boolean {
  if (apt.status !== 'En attente' && apt.status !== 'Confirmé') return false;
  const normalizedStatus = (apt.reminderStatus || '').toUpperCase();
  if (
    normalizedStatus.startsWith('SMS') ||
    normalizedStatus.startsWith('WHATSAPP') ||
    normalizedStatus.startsWith('APPEL')
  ) {
    return false;
  }
  const aptDt = getAppointmentDateTime(apt.date, apt.startTime);
  if (!aptDt) return false;
  const diffMs = aptDt.getTime() - now.getTime();
  return diffMs > 0 && diffMs <= Math.max(1, hoursBefore) * 3600 * 1000;
}

export function formatSmsReminderMessage(
  template: string,
  apt: Pick<Appointment, 'patientName' | 'date' | 'startTime' | 'actType' | 'practitionerName'>,
  clinicSettings?: ClinicSettings | null
): string {
  const clinicName = clinicSettings?.clinicName || 'Cabinet Dentaire Dr. Sara Bchi';
  const clinicPhone = clinicSettings?.phone || '+212 532 101 351';
  const formattedDate = formatDateFR(apt.date);
  return (template || DEFAULT_SMS_REMINDER_SETTINGS.template)
    .replace(/\{patient\}/gi, apt.patientName)
    .replace(/\{date\}/gi, formattedDate)
    .replace(/\{heure\}/gi, apt.startTime)
    .replace(/\{acte\}/gi, apt.actType)
    .replace(/\{praticien\}/gi, apt.practitionerName || 'Dr. Sara Bchi')
    .replace(/\{cabinet\}/gi, clinicName)
    .replace(/\{tel\}/gi, clinicPhone)
    .trim();
}

export function buildRecallSmsNotes(appointmentId: string, message: string): string {
  const prefix = `[RDV:${appointmentId}] `;
  const maxMsgLen = Math.max(0, 295 - prefix.length);
  return `${prefix}${message.slice(0, maxMsgLen)}`;
}

export function stripRecallAppointmentTag(notes?: string): string {
  if (!notes) return '';
  return notes.replace(/^\[RDV:[^\]]+\]\s*/i, '').trim();
}

export function formatSentDateTimeFR(isoOrDate?: string): string {
  if (!isoOrDate) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    return formatDateFR(isoOrDate);
  }
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return isoOrDate;
  return dt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function normalizePhoneDigitsForWhatsApp(rawPhone: string): string {
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

export function normalizePhoneForTelUri(rawPhone: string): string {
  const trimmed = (rawPhone || '').trim().replace(/[\s().-]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('00')) {
    return `+${trimmed.slice(2).replace(/\D/g, '')}`;
  }
  if (/^0[567]\d{8}$/.test(trimmed)) {
    return `+212${trimmed.slice(1)}`;
  }
  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }
  return trimmed.replace(/\D/g, '');
}

export function buildWhatsAppUrl(rawPhone: string, message: string): string | null {
  const digits = normalizePhoneDigitsForWhatsApp(rawPhone);
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function buildTelUri(rawPhone: string): string | null {
  const normalized = normalizePhoneForTelUri(rawPhone);
  if (normalized.replace(/\D/g, '').length < 6) return null;
  return `tel:${normalized}`;
}

export function triggerExternalActionLink(href: string, openInNewTab = false): void {
  if (typeof document === 'undefined' || !href) return;
  const anchor = document.createElement('a');
  anchor.href = href;
  if (openInNewTab) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
