import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId?: string;
  apiKey?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

const firebaseConfig = loadFirebaseConfig();

function getSmsGatewayStatus() {
  const twilioSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const twilioToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const twilioFrom = (process.env.TWILIO_FROM_NUMBER || '').trim();
  const twilioMessagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const webhookUrl = (process.env.SMS_WEBHOOK_URL || '').trim();

  const envChecklist = {
    accountSid: Boolean(twilioSid),
    authToken: Boolean(twilioToken),
    senderNumberOrService: Boolean(twilioFrom || twilioMessagingServiceSid),
    webhookUrl: Boolean(webhookUrl),
  };

  if (twilioSid && twilioToken && (twilioFrom || twilioMessagingServiceSid)) {
    const senderRaw = twilioFrom || twilioMessagingServiceSid;
    const maskedFrom =
      senderRaw.length > 6
        ? `${senderRaw.slice(0, 4)}••••${senderRaw.slice(-3)}`
        : senderRaw;
    return {
      configured: true,
      provider: 'twilio' as const,
      senderLabel: `Twilio (${maskedFrom})`,
      envChecklist,
    };
  }

  if (webhookUrl) {
    let hostLabel = 'Webhook HTTPS';
    try {
      hostLabel = new URL(webhookUrl).hostname;
    } catch {
      // Keep fallback label
    }
    return {
      configured: true,
      provider: 'webhook' as const,
      senderLabel: `Passerelle HTTP (${hostLabel})`,
      envChecklist,
    };
  }

  return {
    configured: false,
    provider: 'simulation' as const,
    senderLabel: 'Mode Test / Simulation (configurez TWILIO_* dans Secrets)',
    envChecklist,
  };
}

function getWhatsAppGatewayStatus() {
  const businessToken = (
    process.env.WHATSAPP_BUSINESS_TOKEN ||
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
    ''
  ).trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const graphVersion = (process.env.WHATSAPP_GRAPH_VERSION || 'v21.0').trim() || 'v21.0';
  const templateName = (process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const templateLang = (process.env.WHATSAPP_TEMPLATE_LANG || 'fr').trim() || 'fr';
  const webhookVerifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
  const webhookUrl = (process.env.WHATSAPP_WEBHOOK_URL || '').trim();

  const envChecklist = {
    accessToken: Boolean(businessToken),
    phoneNumberId: Boolean(phoneNumberId),
    templateName: Boolean(templateName),
    webhookVerifyToken: Boolean(webhookVerifyToken),
    webhookUrl: Boolean(webhookUrl),
  };

  if (businessToken && phoneNumberId) {
    const maskedId =
      phoneNumberId.length > 6
        ? `${phoneNumberId.slice(0, 3)}••••${phoneNumberId.slice(-3)}`
        : phoneNumberId;
    return {
      configured: true,
      provider: 'whatsapp_cloud_api' as const,
      senderLabel: `Meta WhatsApp Cloud API (ID ${maskedId})`,
      graphVersion,
      templateMode: Boolean(templateName),
      templateName: templateName || null,
      templateLang,
      envChecklist,
    };
  }

  if (webhookUrl) {
    let hostLabel = 'Webhook WhatsApp HTTPS';
    try {
      hostLabel = new URL(webhookUrl).hostname;
    } catch {
      // Keep fallback label
    }
    return {
      configured: true,
      provider: 'webhook' as const,
      senderLabel: `Passerelle WhatsApp (${hostLabel})`,
      graphVersion,
      templateMode: false,
      templateName: null,
      templateLang,
      envChecklist,
    };
  }

  return {
    configured: false,
    provider: 'fallback_link' as const,
    senderLabel: 'Lien direct WhatsApp Business (configurez WHATSAPP_BUSINESS_TOKEN dans Secrets)',
    graphVersion,
    templateMode: false,
    templateName: templateName || null,
    templateLang,
    envChecklist,
  };
}

async function verifyFirebaseBearerToken(authHeader?: string): Promise<{
  uid: string;
  email?: string;
  emailVerified?: boolean;
} | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken || !firebaseConfig.apiKey) {
    return null;
  }

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
    };
  } catch {
    return null;
  }
}

function normalizePhoneForSms(rawPhone: string): string {
  const trimmed = rawPhone.trim().replace(/[\s().-]/g, '');
  if (trimmed.startsWith('00')) {
    return `+${trimmed.slice(2)}`;
  }
  if (/^0[567]\d{8}$/.test(trimmed)) {
    return `+212${trimmed.slice(1)}`;
  }
  return trimmed;
}

function normalizePhoneDigitsForWhatsApp(rawPhone: string): string {
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  const allowedNativeOrigins = new Set<string>([
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  const appUrlOrigin = (() => {
    try {
      return process.env.APP_URL ? new URL(process.env.APP_URL).origin : '';
    } catch {
      return '';
    }
  })();
  if (appUrlOrigin) {
    allowedNativeOrigins.add(appUrlOrigin);
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (req.path.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && allowedNativeOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mode: isProd ? 'production' : 'development',
      firebase: {
        configured: Boolean(firebaseConfig.projectId && firebaseConfig.apiKey),
        projectId: firebaseConfig.projectId || null,
        firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || '(default)',
      },
      smsGateway: getSmsGatewayStatus(),
      whatsappGateway: getWhatsAppGatewayStatus(),
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/api/deployment-status', async (_req, res) => {
    const currentUrl = (process.env.APP_URL || '').trim();
    const sharedUrl = currentUrl.includes('://ais-dev-')
      ? currentUrl.replace('://ais-dev-', '://ais-pre-')
      : currentUrl;

    if (!sharedUrl) {
      res.json({
        currentUrl,
        sharedUrl: '',
        isSharedLive: false,
        sharedHttpStatus: null,
      });
      return;
    }

    if (!currentUrl.includes('://ais-dev-')) {
      res.json({
        currentUrl,
        sharedUrl,
        isSharedLive: true,
        sharedHttpStatus: 200,
      });
      return;
    }

    try {
      const checkResp = await fetch(sharedUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(3500),
      });
      const isLive = checkResp.status >= 200 && checkResp.status < 400;
      res.json({
        currentUrl,
        sharedUrl,
        isSharedLive: isLive,
        sharedHttpStatus: checkResp.status,
      });
    } catch {
      res.json({
        currentUrl,
        sharedUrl,
        isSharedLive: false,
        sharedHttpStatus: null,
      });
    }
  });

  app.get('/api/sms/status', (_req, res) => {
    res.json(getSmsGatewayStatus());
  });

  app.post('/api/sms/send', async (req, res) => {
    const authUser = await verifyFirebaseBearerToken(req.headers.authorization);
    if (!authUser) {
      res.status(401).json({
        ok: false,
        delivered: false,
        error: 'Authentification Firebase requise pour envoyer un SMS.',
      });
      return;
    }

    const body = (req.body || {}) as {
      to?: unknown;
      message?: unknown;
      patientName?: unknown;
      appointmentId?: unknown;
      clinicName?: unknown;
    };

    const rawTo = typeof body.to === 'string' ? body.to.trim() : '';
    const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';

    if (rawTo.replace(/\D/g, '').length < 6 || !rawMessage) {
      res.status(400).json({
        ok: false,
        delivered: false,
        error: 'Numéro de téléphone et contenu du message requis.',
      });
      return;
    }

    const normalizedTo = normalizePhoneForSms(rawTo);
    const safeMessage = rawMessage.slice(0, 480);
    const status = getSmsGatewayStatus();

    if (status.provider === 'twilio') {
      try {
        const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
        const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
        const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
        const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
        const credentials = Buffer.from(`${sid}:${token}`).toString('base64');

        const formParams = new URLSearchParams({
          To: normalizedTo,
          Body: safeMessage,
        });
        if (from) {
          formParams.set('From', from);
        } else if (messagingServiceSid) {
          formParams.set('MessagingServiceSid', messagingServiceSid);
        }

        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formParams.toString(),
            signal: AbortSignal.timeout(15000),
          }
        );

        const twilioJson = (await twilioRes.json().catch(() => ({}))) as {
          sid?: string;
          message?: string;
          status?: string;
          code?: number;
        };

        if (!twilioRes.ok) {
          const codeLabel = twilioJson.code ? ` [Code Twilio ${twilioJson.code}]` : '';
          res.status(502).json({
            ok: false,
            delivered: false,
            mode: 'twilio',
            error:
              (twilioJson.message || `Erreur opérateur Twilio (${twilioRes.status}).`) + codeLabel,
          });
          return;
        }

        res.json({
          ok: true,
          delivered: true,
          mode: 'twilio',
          providerId: twilioJson.sid || null,
          to: normalizedTo,
        });
        return;
      } catch (err) {
        res.status(502).json({
          ok: false,
          delivered: false,
          mode: 'twilio',
          error: err instanceof Error ? err.message : 'Erreur réseau vers Twilio.',
        });
        return;
      }
    }

    if (status.provider === 'webhook') {
      try {
        const webhookUrl = (process.env.SMS_WEBHOOK_URL || '').trim();
        const webhookToken = (process.env.SMS_WEBHOOK_TOKEN || '').trim();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (webhookToken) {
          headers.Authorization = `Bearer ${webhookToken}`;
        }

        const hookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to: normalizedTo,
            message: safeMessage,
            patientName: typeof body.patientName === 'string' ? body.patientName : '',
            appointmentId: typeof body.appointmentId === 'string' ? body.appointmentId : '',
            clinicName: typeof body.clinicName === 'string' ? body.clinicName : 'Gestion de cabinet dentaire Dr. Sara Bchi',
            requestedByUid: authUser.uid,
            requestedByEmail: authUser.email || '',
          }),
          signal: AbortSignal.timeout(15000),
        });

        const hookJson = (await hookRes.json().catch(() => ({}))) as { id?: string; message?: string };
        if (!hookRes.ok) {
          res.status(502).json({
            ok: false,
            delivered: false,
            mode: 'webhook',
            error: hookJson.message || `Erreur passerelle SMS (${hookRes.status}).`,
          });
          return;
        }

        res.json({
          ok: true,
          delivered: true,
          mode: 'webhook',
          providerId: hookJson.id || null,
          to: normalizedTo,
        });
        return;
      } catch (err) {
        res.status(502).json({
          ok: false,
          delivered: false,
          mode: 'webhook',
          error: err instanceof Error ? err.message : 'Erreur réseau vers la passerelle SMS.',
        });
        return;
      }
    }

    res.json({
      ok: true,
      delivered: false,
      mode: 'simulation',
      reason: 'PASSERELLE_NON_CONFIGURÉE',
      to: normalizedTo,
      detail:
        'Passerelle SMS opérateur non configurée côté serveur (TWILIO_* ou SMS_WEBHOOK_URL). Le rappel a été journalisé en mode test.',
    });
  });

  app.get('/api/whatsapp/status', (_req, res) => {
    res.json(getWhatsAppGatewayStatus());
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    const authUser = await verifyFirebaseBearerToken(req.headers.authorization);
    if (!authUser) {
      res.status(401).json({
        ok: false,
        delivered: false,
        error: 'Authentification Firebase requise pour envoyer un rappel WhatsApp.',
      });
      return;
    }

    const body = (req.body || {}) as {
      to?: unknown;
      message?: unknown;
      patientName?: unknown;
      appointmentId?: unknown;
      appointmentDate?: unknown;
      appointmentTime?: unknown;
      actType?: unknown;
      clinicName?: unknown;
    };

    const rawTo = typeof body.to === 'string' ? body.to.trim() : '';
    const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
    const waDigits = normalizePhoneDigitsForWhatsApp(rawTo);

    if (waDigits.length < 6 || !rawMessage) {
      res.status(400).json({
        ok: false,
        delivered: false,
        error: 'Numéro de téléphone WhatsApp valide et contenu du message requis.',
      });
      return;
    }

    const safeMessage = rawMessage.slice(0, 1000);
    const waUrl = `https://wa.me/${waDigits}?text=${encodeURIComponent(safeMessage)}`;
    const status = getWhatsAppGatewayStatus();

    if (status.provider === 'whatsapp_cloud_api') {
      try {
        const businessToken = (
          process.env.WHATSAPP_BUSINESS_TOKEN ||
          process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
          ''
        ).trim();
        const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
        const templateName = (process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
        const templateLang = (process.env.WHATSAPP_TEMPLATE_LANG || 'fr').trim() || 'fr';

        const safePatientName =
          typeof body.patientName === 'string' && body.patientName.trim()
            ? body.patientName.trim().slice(0, 100)
            : 'Patient';
        const safeDate =
          typeof body.appointmentDate === 'string' && body.appointmentDate.trim()
            ? body.appointmentDate.trim().slice(0, 30)
            : '';
        const safeTime =
          typeof body.appointmentTime === 'string' && body.appointmentTime.trim()
            ? body.appointmentTime.trim().slice(0, 15)
            : '';
        const safeAct =
          typeof body.actType === 'string' && body.actType.trim()
            ? body.actType.trim().slice(0, 120)
            : 'Consultation';

        const noParamsTemplate =
          templateName.toLowerCase() === 'hello_world' ||
          process.env.WHATSAPP_TEMPLATE_NO_PARAMS === 'true';
        const effectiveLang =
          templateName.toLowerCase() === 'hello_world' && !process.env.WHATSAPP_TEMPLATE_LANG
            ? 'en_US'
            : templateLang;

        const graphPayload = templateName
          ? {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: waDigits,
              type: 'template',
              template: noParamsTemplate
                ? {
                    name: templateName,
                    language: { code: effectiveLang },
                  }
                : {
                    name: templateName,
                    language: { code: effectiveLang },
                    components: [
                      {
                        type: 'body',
                        parameters: [
                          { type: 'text', text: safePatientName },
                          { type: 'text', text: safeDate || 'prochainement' },
                          { type: 'text', text: safeTime || 'confirmée' },
                          { type: 'text', text: safeAct },
                        ],
                      },
                    ],
                  },
            }
          : {
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: waDigits,
              type: 'text',
              text: {
                preview_url: false,
                body: safeMessage,
              },
            };

        const metaRes = await fetch(
          `https://graph.facebook.com/${encodeURIComponent(status.graphVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${businessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(graphPayload),
            signal: AbortSignal.timeout(15000),
          }
        );

        const metaJson = (await metaRes.json().catch(() => ({}))) as {
          messages?: Array<{ id?: string }>;
          error?: { message?: string; code?: number };
        };

        if (!metaRes.ok) {
          res.status(502).json({
            ok: false,
            delivered: false,
            mode: 'whatsapp_cloud_api',
            waUrl,
            error:
              metaJson.error?.message ||
              `Erreur API WhatsApp Business (${metaRes.status}).`,
          });
          return;
        }

        res.json({
          ok: true,
          delivered: true,
          mode: 'whatsapp_cloud_api',
          providerId: metaJson.messages?.[0]?.id || null,
          to: `+${waDigits}`,
          waUrl,
        });
        return;
      } catch (err) {
        res.status(502).json({
          ok: false,
          delivered: false,
          mode: 'whatsapp_cloud_api',
          waUrl,
          error:
            err instanceof Error
              ? err.message
              : "Erreur réseau vers l'API WhatsApp Business.",
        });
        return;
      }
    }

    if (status.provider === 'webhook') {
      try {
        const webhookUrl = (process.env.WHATSAPP_WEBHOOK_URL || '').trim();
        const webhookToken = (process.env.WHATSAPP_WEBHOOK_TOKEN || '').trim();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (webhookToken) {
          headers.Authorization = `Bearer ${webhookToken}`;
        }

        const hookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            channel: 'whatsapp',
            to: `+${waDigits}`,
            digits: waDigits,
            message: safeMessage,
            patientName: typeof body.patientName === 'string' ? body.patientName : '',
            appointmentId: typeof body.appointmentId === 'string' ? body.appointmentId : '',
            appointmentDate: typeof body.appointmentDate === 'string' ? body.appointmentDate : '',
            appointmentTime: typeof body.appointmentTime === 'string' ? body.appointmentTime : '',
            actType: typeof body.actType === 'string' ? body.actType : '',
            clinicName:
              typeof body.clinicName === 'string'
                ? body.clinicName
                : 'Gestion de cabinet dentaire Dr. Sara Bchi',
            requestedByUid: authUser.uid,
            requestedByEmail: authUser.email || '',
          }),
          signal: AbortSignal.timeout(15000),
        });

        const hookJson = (await hookRes.json().catch(() => ({}))) as {
          id?: string;
          message?: string;
        };
        if (!hookRes.ok) {
          res.status(502).json({
            ok: false,
            delivered: false,
            mode: 'webhook',
            waUrl,
            error:
              hookJson.message ||
              `Erreur passerelle WhatsApp (${hookRes.status}).`,
          });
          return;
        }

        res.json({
          ok: true,
          delivered: true,
          mode: 'webhook',
          providerId: hookJson.id || null,
          to: `+${waDigits}`,
          waUrl,
        });
        return;
      } catch (err) {
        res.status(502).json({
          ok: false,
          delivered: false,
          mode: 'webhook',
          waUrl,
          error:
            err instanceof Error
              ? err.message
              : 'Erreur réseau vers la passerelle WhatsApp.',
        });
        return;
      }
    }

    res.json({
      ok: true,
      delivered: false,
      mode: 'fallback_link',
      reason: 'WHATSAPP_API_NON_CONFIGURÉE',
      to: `+${waDigits}`,
      waUrl,
      detail:
        "API WhatsApp Business non configurée côté serveur (WHATSAPP_BUSINESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID). Ouverture de WhatsApp via lien pré-rempli.",
    });
  });

  app.get('/api/whatsapp/webhook', (req, res) => {
    const verifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === undefined && token === undefined && challenge === undefined) {
      res.status(200).json({
        ok: true,
        service: 'Meta WhatsApp Cloud API Webhook',
        verifyTokenConfigured: Boolean(verifyToken),
        message:
          "Route webhook prête. Pour la validation dans Meta Developers, publiez l'app et utilisez l'URL publique partagée (ais-pre-...) avec ?hub.mode=subscribe.",
      });
      return;
    }

    if (mode === 'subscribe' && verifyToken && token === verifyToken && typeof challenge === 'string') {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).json({
      ok: false,
      error: verifyToken
        ? 'Validation Meta refusée : hub.verify_token différent de WHATSAPP_WEBHOOK_VERIFY_TOKEN.'
        : 'WHATSAPP_WEBHOOK_VERIFY_TOKEN non configuré dans les Secrets serveur.',
    });
  });

  app.post('/api/whatsapp/webhook', (_req, res) => {
    res.sendStatus(200);
  });

  app.post('/api/gateways/verify', async (req, res) => {
    const authUser = await verifyFirebaseBearerToken(req.headers.authorization);
    if (!authUser) {
      res.status(401).json({
        ok: false,
        error: 'Authentification Firebase requise pour vérifier les passerelles.',
      });
      return;
    }

    const smsStatus = getSmsGatewayStatus();
    const waStatus = getWhatsAppGatewayStatus();

    const twilioResult: {
      configured: boolean;
      reachable: boolean;
      accountName?: string;
      accountStatus?: string;
      accountType?: string;
      error?: string;
    } = {
      configured: smsStatus.provider === 'twilio',
      reachable: false,
    };

    if (smsStatus.provider === 'twilio') {
      try {
        const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
        const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
        const credentials = Buffer.from(`${sid}:${token}`).toString('base64');
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
          {
            headers: { Authorization: `Basic ${credentials}` },
            signal: AbortSignal.timeout(8000),
          }
        );
        const data = (await resp.json().catch(() => ({}))) as {
          friendly_name?: string;
          status?: string;
          type?: string;
          message?: string;
        };
        if (resp.ok) {
          twilioResult.reachable = true;
          twilioResult.accountName = data.friendly_name || 'Compte Twilio';
          twilioResult.accountStatus = data.status || 'active';
          twilioResult.accountType = data.type || 'Full';
        } else {
          twilioResult.error = data.message || `Erreur Twilio HTTP ${resp.status}`;
        }
      } catch (err) {
        twilioResult.error =
          err instanceof Error ? err.message : 'Impossible de joindre api.twilio.com';
      }
    }

    const metaResult: {
      configured: boolean;
      reachable: boolean;
      verifiedName?: string;
      displayPhoneNumber?: string;
      qualityRating?: string;
      error?: string;
    } = {
      configured: waStatus.provider === 'whatsapp_cloud_api',
      reachable: false,
    };

    if (waStatus.provider === 'whatsapp_cloud_api') {
      try {
        const businessToken = (
          process.env.WHATSAPP_BUSINESS_TOKEN ||
          process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
          ''
        ).trim();
        const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
        const resp = await fetch(
          `https://graph.facebook.com/${encodeURIComponent(waStatus.graphVersion)}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
          {
            headers: { Authorization: `Bearer ${businessToken}` },
            signal: AbortSignal.timeout(8000),
          }
        );
        const data = (await resp.json().catch(() => ({}))) as {
          display_phone_number?: string;
          verified_name?: string;
          quality_rating?: string;
          error?: { message?: string };
        };
        if (resp.ok) {
          metaResult.reachable = true;
          metaResult.verifiedName = data.verified_name || 'WhatsApp Business';
          metaResult.displayPhoneNumber = data.display_phone_number || '';
          metaResult.qualityRating = data.quality_rating || '';
        } else {
          metaResult.error =
            data.error?.message || `Erreur Meta Graph HTTP ${resp.status}`;
        }
      } catch (err) {
        metaResult.error =
          err instanceof Error ? err.message : 'Impossible de joindre graph.facebook.com';
      }
    }

    res.json({
      ok: true,
      twilio: twilioResult,
      metaWhatsApp: metaResult,
      smsGateway: smsStatus,
      whatsappGateway: waStatus,
      checkedAt: new Date().toISOString(),
    });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use((req, res, next) => {
      if (req.path === '/@vite/client') {
        delete req.headers['if-none-match'];
        const origEnd = res.end.bind(res);
        const chunks: Buffer[] = [];
        res.write = ((chunk: unknown, ...rest: unknown[]) => {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          const cb = typeof rest[rest.length - 1] === 'function' ? (rest[rest.length - 1] as () => void) : null;
          if (cb) cb();
          return true;
        }) as typeof res.write;
        res.end = ((chunk?: unknown, ...rest: unknown[]) => {
          if (chunk && typeof chunk !== 'function') {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          const body = Buffer.concat(chunks).toString('utf8');
          const patched = body.replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR disabled: WebSocket connection skipped */'
          );
          if (res.getHeader('Content-Length') !== undefined) {
            res.setHeader('Content-Length', Buffer.byteLength(patched, 'utf8'));
          }
          res.removeHeader('ETag');
          const cb =
            typeof chunk === 'function'
              ? (chunk as () => void)
              : typeof rest[rest.length - 1] === 'function'
              ? (rest[rest.length - 1] as () => void)
              : undefined;
          return cb ? origEnd(patched, 'utf8', cb) : origEnd(patched, 'utf8');
        }) as typeof res.end;
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gestion de cabinet dentaire Dr. Sara Bchi server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

void startServer();
