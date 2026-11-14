import { useCallback, useEffect, useRef, useState } from 'react';

const WORKSPACE_EXPANDED_KEY = 'dentaflow_workspace_expanded';
const FULLSCREEN_SYNC_EVENT = 'dentaflow-fullscreen-sync';

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function getNativeFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FullscreenDocument;
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

function isNativeFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as FullscreenElement;
  return Boolean(
    document.fullscreenEnabled ||
      typeof el.requestFullscreen === 'function' ||
      typeof el.webkitRequestFullscreen === 'function'
  );
}

function readStoredExpanded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(WORKSPACE_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredExpanded(expanded: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WORKSPACE_EXPANDED_KEY, expanded ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(FULLSCREEN_SYNC_EVENT, { detail: expanded }));
  } catch {
    // Ignore storage errors in restricted browsing modes
  }
}

export function useFullscreen() {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(() =>
    Boolean(getNativeFullscreenElement())
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(() => readStoredExpanded());
  const wasNativeRef = useRef<boolean>(Boolean(getNativeFullscreenElement()));

  useEffect(() => {
    const handleNativeChange = () => {
      const nowNative = Boolean(getNativeFullscreenElement());
      const previouslyNative = wasNativeRef.current;
      wasNativeRef.current = nowNative;
      setIsNativeFullscreen(nowNative);

      // Si l'utilisateur quitte le plein écran natif via Échap, on synchronise aussi l'état d'expansion
      if (previouslyNative && !nowNative) {
        setIsExpanded(false);
        writeStoredExpanded(false);
      }
    };

    const handleSyncEvent = (event: Event) => {
      const custom = event as CustomEvent<boolean>;
      if (typeof custom.detail === 'boolean') {
        setIsExpanded(custom.detail);
      } else {
        setIsExpanded(readStoredExpanded());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_EXPANDED_KEY) {
        setIsExpanded(event.newValue === 'true');
      }
    };

    document.addEventListener('fullscreenchange', handleNativeChange);
    document.addEventListener('webkitfullscreenchange', handleNativeChange);
    window.addEventListener(FULLSCREEN_SYNC_EVENT, handleSyncEvent);
    window.addEventListener('storage', handleStorage);

    return () => {
      document.removeEventListener('fullscreenchange', handleNativeChange);
      document.removeEventListener('webkitfullscreenchange', handleNativeChange);
      window.removeEventListener(FULLSCREEN_SYNC_EVENT, handleSyncEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setFullscreenEnabled = useCallback(async (enabled: boolean): Promise<boolean> => {
    setIsExpanded(enabled);
    writeStoredExpanded(enabled);

    if (typeof document === 'undefined') return enabled;
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;

    if (enabled) {
      if (!getNativeFullscreenElement()) {
        try {
          if (typeof root.requestFullscreen === 'function') {
            await root.requestFullscreen();
          } else if (typeof root.webkitRequestFullscreen === 'function') {
            await Promise.resolve(root.webkitRequestFullscreen());
          }
        } catch {
          // Dans un aperçu iframe ou sur iOS Safari, le plein écran natif peut être bloqué :
          // le mode espace de travail élargi (isExpanded) reste actif en repli transparent.
        }
      }
    } else if (getNativeFullscreenElement()) {
      try {
        if (typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === 'function') {
          await Promise.resolve(doc.webkitExitFullscreen());
        }
      } catch {
        // Ignorer les erreurs de sortie plein écran
      }
    }

    return enabled;
  }, []);

  const isFullscreen = isNativeFullscreen || isExpanded;

  const toggleFullscreen = useCallback(async (): Promise<boolean> => {
    return setFullscreenEnabled(!isFullscreen);
  }, [isFullscreen, setFullscreenEnabled]);

  const toggleExpanded = useCallback(() => {
    const next = !isExpanded;
    setIsExpanded(next);
    writeStoredExpanded(next);
  }, [isExpanded]);

  return {
    isFullscreen,
    isNativeFullscreen,
    isExpanded,
    canUseNativeFullscreen: isNativeFullscreenSupported(),
    toggleFullscreen,
    setFullscreenEnabled,
    toggleExpanded,
  };
}
