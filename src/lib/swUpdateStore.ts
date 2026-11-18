export interface SWLifecycleState {
  needRefresh: boolean;
  offlineReady: boolean;
  isUpdating: boolean;
  dismissed: boolean;
  updateError: string | null;
}

type SWLifecycleListener = (state: SWLifecycleState) => void;

let state: SWLifecycleState = {
  needRefresh: false,
  offlineReady: false,
  isUpdating: false,
  dismissed: false,
  updateError: null,
};

let updateRunner: ((reloadPage?: boolean) => Promise<void>) | null = null;
let offlineReadyTimer: number | null = null;
const listeners = new Set<SWLifecycleListener>();

function emit() {
  const snapshot = { ...state };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function getSWLifecycleState(): SWLifecycleState {
  return { ...state };
}

export function subscribeSWLifecycle(listener: SWLifecycleListener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

export function setSWUpdateRunner(runner: ((reloadPage?: boolean) => Promise<void>) | null) {
  updateRunner = runner;
}

export function notifySWNeedRefresh() {
  state = {
    ...state,
    needRefresh: true,
    dismissed: false,
    updateError: null,
  };
  emit();
}

export function notifySWOfflineReady() {
  if (offlineReadyTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(offlineReadyTimer);
    offlineReadyTimer = null;
  }
  state = {
    ...state,
    offlineReady: true,
  };
  emit();

  if (typeof window !== 'undefined') {
    offlineReadyTimer = window.setTimeout(() => {
      offlineReadyTimer = null;
      if (state.offlineReady) {
        state = { ...state, offlineReady: false };
        emit();
      }
    }, 4500);
  }
}

export function notifySWError(message: string) {
  state = {
    ...state,
    isUpdating: false,
    updateError: message,
  };
  emit();
}

export function dismissSWUpdatePrompt() {
  state = {
    ...state,
    dismissed: true,
  };
  emit();
}

export function dismissSWOfflineReady() {
  if (offlineReadyTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(offlineReadyTimer);
    offlineReadyTimer = null;
  }
  state = {
    ...state,
    offlineReady: false,
  };
  emit();
}

export async function applySWUpdate(): Promise<void> {
  if (state.isUpdating) return;
  state = {
    ...state,
    isUpdating: true,
    updateError: null,
  };
  emit();

  try {
    if (updateRunner) {
      await updateRunner(true);
    } else if (typeof window !== 'undefined') {
      window.location.reload();
      return;
    }

    // Fallback reload if controllerchange didn't already reload within 1.5s
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  } catch (err) {
    state = {
      ...state,
      isUpdating: false,
      updateError:
        err instanceof Error
          ? err.message
          : "Impossible d'appliquer la mise à jour automatiquement. Rechargez la page.",
    };
    emit();
  }
}
