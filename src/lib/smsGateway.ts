import { auth } from './firebase';

export interface SmsGatewayStatus {
  configured: boolean;
  provider: 'twilio' | 'webhook' | 'simulation';
  senderLabel: string;
}

export interface WhatsAppGatewayStatus {
  configured: boolean;
  provider: 'whatsapp_cloud_api' | 'webhook' | 'fallback_link';
  senderLabel: string;
  graphVersion?: string;
  templateMode?: boolean;
}

export interface SystemHealthReport {
  ok: boolean;
  mode: string;
  firebase: {
    configured: boolean;
    projectId: string | null;
    firestoreDatabaseId: string;
  };
  smsGateway: SmsGatewayStatus;
  whatsappGateway?: WhatsAppGatewayStatus;
  serverTime: string;
}

export interface SmsSendResult {
  ok: boolean;
  delivered: boolean;
  mode: 'twilio' | 'webhook' | 'simulation' | 'offline';
  providerId?: string | null;
  detail?: string;
  error?: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  delivered: boolean;
  mode: 'whatsapp_cloud_api' | 'webhook' | 'fallback_link' | 'offline';
  providerId?: string | null;
  waUrl?: string | null;
  detail?: string;
  error?: string;
}

function resolveApiUrl(path: string): string {
  const configuredBase = (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');
  if (configuredBase) {
    return `${configuredBase}${path}`;
  }
  return path;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchSystemHealth(): Promise<SystemHealthReport | null> {
  try {
    const res = await fetchWithTimeout(resolveApiUrl('/api/health'), { cache: 'no-store' }, 8000);
    if (!res.ok) return null;
    return (await res.json()) as SystemHealthReport;
  } catch {
    return null;
  }
}

export async function fetchSmsGatewayStatus(): Promise<SmsGatewayStatus> {
  try {
    const res = await fetchWithTimeout(resolveApiUrl('/api/sms/status'), { cache: 'no-store' }, 8000);
    if (!res.ok) {
      throw new Error('Statut indisponible');
    }
    return (await res.json()) as SmsGatewayStatus;
  } catch {
    return {
      configured: false,
      provider: 'simulation',
      senderLabel: 'Serveur SMS hors ligne ou non configuré (Mode Test)',
    };
  }
}

export async function fetchWhatsAppGatewayStatus(): Promise<WhatsAppGatewayStatus> {
  try {
    const res = await fetchWithTimeout(resolveApiUrl('/api/whatsapp/status'), { cache: 'no-store' }, 8000);
    if (!res.ok) {
      throw new Error('Statut WhatsApp indisponible');
    }
    return (await res.json()) as WhatsAppGatewayStatus;
  } catch {
    return {
      configured: false,
      provider: 'fallback_link',
      senderLabel: 'Lien direct WhatsApp (serveur API hors ligne)',
    };
  }
}

export async function sendSmsViaGateway(payload: {
  to: string;
  message: string;
  patientName?: string;
  appointmentId?: string;
  clinicName?: string;
}): Promise<SmsSendResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: true,
      delivered: false,
      mode: 'offline',
      detail: 'Mode hors ligne : enregistrement conservé localement.',
    };
  }

  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      return {
        ok: false,
        delivered: false,
        mode: 'simulation',
        error: 'Session authentifiée requise pour appeler la passerelle SMS.',
      };
    }

    const res = await fetchWithTimeout(
      resolveApiUrl('/api/sms/send'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      },
      15000
    );

    const data = (await res.json().catch(() => ({}))) as Partial<SmsSendResult>;
    if (!res.ok) {
      return {
        ok: false,
        delivered: false,
        mode: (data.mode as SmsSendResult['mode']) || 'simulation',
        error: data.error || `Erreur serveur SMS (${res.status}).`,
      };
    }

    return {
      ok: Boolean(data.ok ?? true),
      delivered: Boolean(data.delivered),
      mode: (data.mode as SmsSendResult['mode']) || 'simulation',
      providerId: data.providerId ?? null,
      detail: data.detail,
    };
  } catch (err) {
    return {
      ok: false,
      delivered: false,
      mode: 'simulation',
      error: err instanceof Error ? err.message : 'Erreur réseau vers /api/sms/send.',
    };
  }
}

export async function sendWhatsAppViaGateway(payload: {
  to: string;
  message: string;
  patientName?: string;
  appointmentId?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  actType?: string;
  clinicName?: string;
}): Promise<WhatsAppSendResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: true,
      delivered: false,
      mode: 'offline',
      detail: 'Mode hors ligne : rappel WhatsApp enregistré localement.',
    };
  }

  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      return {
        ok: false,
        delivered: false,
        mode: 'fallback_link',
        error: 'Session authentifiée requise pour appeler la passerelle WhatsApp Business.',
      };
    }

    const res = await fetchWithTimeout(
      resolveApiUrl('/api/whatsapp/send'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      },
      15000
    );

    const data = (await res.json().catch(() => ({}))) as Partial<WhatsAppSendResult>;
    if (!res.ok) {
      return {
        ok: false,
        delivered: false,
        mode: (data.mode as WhatsAppSendResult['mode']) || 'whatsapp_cloud_api',
        waUrl: data.waUrl ?? null,
        error: data.error || `Erreur serveur WhatsApp Business (${res.status}).`,
      };
    }

    return {
      ok: Boolean(data.ok ?? true),
      delivered: Boolean(data.delivered),
      mode: (data.mode as WhatsAppSendResult['mode']) || 'fallback_link',
      providerId: data.providerId ?? null,
      waUrl: data.waUrl ?? null,
      detail: data.detail,
    };
  } catch (err) {
    return {
      ok: false,
      delivered: false,
      mode: 'fallback_link',
      error: err instanceof Error ? err.message : 'Erreur réseau vers /api/whatsapp/send.',
    };
  }
}
