import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  notifySWError,
  notifySWNeedRefresh,
  notifySWOfflineReady,
  setSWUpdateRunner,
} from './lib/swUpdateStore';

const SW_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const SW_VISIBILITY_THROTTLE_MS = 60 * 1000;

function initServiceWorkerLifecycle() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  let hasRequestedReload = false;
  let lastUpdateCheckAt = 0;
  let periodicTimerId: number | null = null;

  const triggerBackgroundUpdateCheck = async (registration: ServiceWorkerRegistration) => {
    if (!navigator.onLine || registration.installing) return;
    const now = Date.now();
    if (now - lastUpdateCheckAt < SW_VISIBILITY_THROTTLE_MS) return;
    lastUpdateCheckAt = now;

    try {
      await registration.update();
    } catch {
      // Ignore transient network failures during background update checks
    }
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasRequestedReload) return;
    hasRequestedReload = true;
    window.location.reload();
  });

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      notifySWNeedRefresh();
    },
    onOfflineReady() {
      notifySWOfflineReady();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      // If a waiting Service Worker already exists (e.g., detected by another open tab), notify immediately
      if (registration.waiting && navigator.serviceWorker.controller) {
        notifySWNeedRefresh();
      }

      // Secondary safeguard for updatefound -> installed while an active controller exists
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (
            installingWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            notifySWNeedRefresh();
          }
        });
      });

      // Periodic background update check every 30 minutes
      if (periodicTimerId !== null) {
        window.clearInterval(periodicTimerId);
      }
      periodicTimerId = window.setInterval(() => {
        void triggerBackgroundUpdateCheck(registration);
      }, SW_UPDATE_CHECK_INTERVAL_MS);

      // Re-check when the practitioner returns to the tab or regains connectivity
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void triggerBackgroundUpdateCheck(registration);
        }
      });
      window.addEventListener('online', () => {
        lastUpdateCheckAt = 0;
        void triggerBackgroundUpdateCheck(registration);
      });
    },
    onRegisterError(error) {
      console.warn('Échec d’enregistrement du Service Worker:', error);
      notifySWError(
        error instanceof Error
          ? error.message
          : 'Impossible d’initialiser le Service Worker hors-ligne.'
      );
    },
  });

  setSWUpdateRunner(updateSW);
}

function clearDevServiceWorkers() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))
    .catch(() => {
      // Ignore cleanup errors
    });
  if ('caches' in window) {
    void caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.includes('workbox') || k.includes('dev-dist'))
            .map((k) => caches.delete(k))
        )
      )
      .catch(() => {
        // Ignore cache cleanup errors
      });
  }
}

if (import.meta.env.PROD) {
  initServiceWorkerLifecycle();
} else {
  clearDevServiceWorkers();
}

createRoot(document.getElementById('root')!).render(<App />);
