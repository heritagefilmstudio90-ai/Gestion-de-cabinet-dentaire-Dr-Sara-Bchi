import { useCallback, useEffect, useRef, useState } from 'react';
import { Appointment } from '../types/dental';
import { todayISO } from '../lib/formatters';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

const ENABLED_STORAGE_KEY = 'dentaflow_apt_reminders_enabled';
const NOTIFIED_STORAGE_KEY = 'dentaflow_notified_apt_keys';
const REMINDER_LEAD_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 20_000;

const ELIGIBLE_STATUSES = new Set<Appointment['status']>([
  'En attente',
  'Confirmé',
  "Arrivé en salle d'attente",
]);

function readNotifiedKeys(today: string): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date?: string; keys?: string[] };
    if (parsed.date !== today || !Array.isArray(parsed.keys)) {
      return new Set();
    }
    return new Set(parsed.keys);
  } catch {
    return new Set();
  }
}

function persistNotifiedKeys(today: string, keys: Set<string>): void {
  try {
    localStorage.setItem(
      NOTIFIED_STORAGE_KEY,
      JSON.stringify({ date: today, keys: Array.from(keys) })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function parseAppointmentStartMs(dateIso: string, startTime: string): number | null {
  const dateParts = dateIso.split('-').map(Number);
  const timeParts = startTime.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2) return null;
  const [y, m, d] = dateParts;
  const [hh, mm] = timeParts;
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

interface UseAppointmentNotificationsOptions {
  appointments: Appointment[];
  enabledForSession: boolean;
  onSelectAppointment?: (appointment: Appointment) => void;
  onToast?: (text: string, tone?: 'info' | 'success' | 'error') => void;
}

export function useAppointmentNotifications({
  appointments,
  enabledForSession,
  onSelectAppointment,
  onToast,
}: UseAppointmentNotificationsOptions) {
  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    isSupported ? window.Notification.permission : 'unsupported'
  );

  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(ENABLED_STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const notifiedKeysRef = useRef<Set<string>>(readNotifiedKeys(todayISO()));
  const onSelectRef = useRef(onSelectAppointment);
  const onToastRef = useRef(onToast);

  useEffect(() => {
    onSelectRef.current = onSelectAppointment;
  }, [onSelectAppointment]);

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  const checkUpcomingAppointments = useCallback(() => {
    if (!enabledForSession || !isSupported || permission !== 'granted' || !remindersEnabled) {
      return;
    }

    const today = todayISO();
    const nowMs = Date.now();
    const notifiedSet = notifiedKeysRef.current;
    let changed = false;

    for (const apt of appointments) {
      if (apt.date !== today || !ELIGIBLE_STATUSES.has(apt.status)) continue;

      const startMs = parseAppointmentStartMs(apt.date, apt.startTime);
      if (startMs === null) continue;

      const diffMs = startMs - nowMs;
      if (diffMs <= 0 || diffMs > REMINDER_LEAD_MS) continue;

      const dedupeKey = `${apt.id}_${apt.date}_${apt.startTime}`;
      if (notifiedSet.has(dedupeKey)) continue;

      const minsLeft = Math.max(1, Math.ceil(diffMs / 60_000));
      const title = `Rendez-vous dans ${minsLeft} min · ${apt.startTime}`;
      const body = `${apt.patientName} — ${apt.actType} (${apt.chair} · ${apt.practitionerName})`;
      const notifOptions: NotificationOptions = {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: `dentaflow-apt-${dedupeKey}`,
      };

      let dispatched = false;
      try {
        const notification = new window.Notification(title, notifOptions);
        notification.onclick = () => {
          window.focus();
          onSelectRef.current?.(apt);
          notification.close();
        };
        dispatched = true;
      } catch {
        if ('serviceWorker' in navigator) {
          void navigator.serviceWorker.ready
            .then((registration) => registration.showNotification(title, notifOptions))
            .catch(() => {
              // Ignore OS notification fallback errors
            });
        }
        dispatched = true;
      }

      if (dispatched) {
        notifiedSet.add(dedupeKey);
        changed = true;
        onToastRef.current?.(
          `Rappel RDV (${apt.startTime}) : ${apt.patientName} dans ${minsLeft} min.`,
          'info'
        );
      }
    }

    if (changed) {
      persistNotifiedKeys(today, notifiedSet);
    }
  }, [appointments, enabledForSession, isSupported, permission, remindersEnabled]);

  useEffect(() => {
    if (!enabledForSession || !isSupported || permission !== 'granted' || !remindersEnabled) {
      return;
    }
    checkUpcomingAppointments();
    const intervalId = window.setInterval(checkUpcomingAppointments, CHECK_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [checkUpcomingAppointments, enabledForSession, isSupported, permission, remindersEnabled]);

  const toggleNotifications = useCallback(async () => {
    if (!isSupported) {
      onToastRef.current?.(
        'Les notifications locales ne sont pas prises en charge par ce navigateur.',
        'error'
      );
      return;
    }

    if (window.Notification.permission === 'default') {
      try {
        const result = await window.Notification.requestPermission();
        setPermission(result);
        if (result === 'granted') {
          setRemindersEnabled(true);
          localStorage.setItem(ENABLED_STORAGE_KEY, 'true');
          onToastRef.current?.(
            'Rappels locaux activés (notification 15 min avant chaque rendez-vous du jour).',
            'success'
          );
        } else {
          onToastRef.current?.(
            'Permission de notification refusée par le navigateur.',
            'error'
          );
        }
      } catch {
        onToastRef.current?.('Impossible de demander la permission de notification.', 'error');
      }
      return;
    }

    if (window.Notification.permission === 'denied') {
      setPermission('denied');
      onToastRef.current?.(
        'Notifications bloquées. Autorisez-les dans les paramètres de votre navigateur.',
        'error'
      );
      return;
    }

    setPermission('granted');
    setRemindersEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ENABLED_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      onToastRef.current?.(
        next
          ? 'Rappels locaux des rendez-vous activés (15 min avant).'
          : 'Rappels locaux des rendez-vous mis en pause.',
        'info'
      );
      return next;
    });
  }, [isSupported]);

  return {
    isSupported,
    permission,
    remindersEnabled,
    isActive: isSupported && permission === 'granted' && remindersEnabled,
    toggleNotifications,
  };
}
