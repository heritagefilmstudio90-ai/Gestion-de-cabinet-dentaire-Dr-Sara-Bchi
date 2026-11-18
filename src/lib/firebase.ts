import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  disableNetwork,
  enableNetwork,
  doc,
  getDocFromServer,
  waitForPendingWrites,
  onSnapshot,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Query,
  QuerySnapshot,
  Unsubscribe,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { SyncErrorCategory, SyncErrorLog, SyncRetryPayload } from '../types/dental';

const app = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: 100 * 1024 * 1024,
      }),
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = firestoreInstance;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

let provisioningAuthInstance: Auth | null = null;

function getProvisioningAuth(): Auth {
  if (provisioningAuthInstance) return provisioningAuthInstance;
  const existingApp: FirebaseApp | undefined = getApps().find(
    (a) => a.name === 'staff-provisioning'
  );
  const secondaryApp = existingApp || initializeApp(firebaseConfig, 'staff-provisioning');
  try {
    provisioningAuthInstance = initializeAuth(secondaryApp, {
      persistence: inMemoryPersistence,
    });
  } catch {
    provisioningAuthInstance = getAuth(secondaryApp);
  }
  return provisioningAuthInstance;
}

export async function provisionAuthUserWithPassword(
  authEmail: string,
  password: string,
  displayName: string
): Promise<string> {
  const secondaryAuth = getProvisioningAuth();
  const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
  if (displayName.trim()) {
    try {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    } catch {
      // Display name update is non-blocking
    }
  }
  const createdUid = cred.user.uid;
  await signOut(secondaryAuth).catch(() => undefined);
  return createdUid;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const SYNC_ERROR_STORAGE_KEY = 'dentaflow_sync_error_logs_v1';
const MAX_SYNC_ERROR_LOGS = 40;

type SyncErrorListener = (logs: SyncErrorLog[]) => void;
const syncErrorListeners = new Set<SyncErrorListener>();

function loadInitialSyncErrors(): SyncErrorLog[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SYNC_ERROR_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SyncErrorLog => Boolean(item && typeof item === 'object' && typeof item.id === 'string'))
      .slice(0, MAX_SYNC_ERROR_LOGS);
  } catch {
    return [];
  }
}

let syncErrorLogsState: SyncErrorLog[] = loadInitialSyncErrors();

function persistSyncErrors(logs: SyncErrorLog[]) {
  if (typeof window === 'undefined') return;
  try {
    const serializable = logs.slice(0, MAX_SYNC_ERROR_LOGS).map((entry) => {
      if (!entry.retryPayload) return entry;
      try {
        const serializedPayload = JSON.stringify(entry.retryPayload);
        if (serializedPayload.length > 8192) {
          const { retryPayload: _omitted, ...rest } = entry;
          return rest;
        }
      } catch {
        const { retryPayload: _omitted, ...rest } = entry;
        return rest;
      }
      return entry;
    });
    window.localStorage.setItem(SYNC_ERROR_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore localStorage quota errors
  }
}

function emitSyncErrorLogs() {
  const snapshot = [...syncErrorLogsState];
  syncErrorListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function getSyncErrorLogs(): SyncErrorLog[] {
  return [...syncErrorLogsState];
}

export function subscribeSyncErrorLogs(listener: SyncErrorListener): () => void {
  syncErrorListeners.add(listener);
  listener([...syncErrorLogsState]);
  return () => {
    syncErrorListeners.delete(listener);
  };
}

function extractErrorCodeAndMessage(error: unknown): { code: string; message: string } {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  let message = error instanceof Error ? error.message : String(error || 'Erreur inconnue');

  // Avoid double-wrapped JSON messages when an already wrapped FirestoreErrorInfo arrives
  if (message.startsWith('{') && message.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(message) as Partial<FirestoreErrorInfo>;
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Keep original message
    }
  }

  let code = rawCode;
  if (!code) {
    const lower = message.toLowerCase();
    if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
      code = 'permission-denied';
    } else if (lower.includes('target id already exists') || lower.includes('already-exists')) {
      code = 'already-exists';
    } else if (lower.includes('client is offline') || lower.includes('unavailable') || lower.includes('failed to get document because the client is offline')) {
      code = 'unavailable';
    } else if (lower.includes('resource-exhausted') || lower.includes('quota exceeded')) {
      code = 'resource-exhausted';
    } else if (lower.includes('deadline-exceeded') || lower.includes('timeout')) {
      code = 'deadline-exceeded';
    } else if (lower.includes('aborted')) {
      code = 'aborted';
    } else if (lower.includes('invalid-argument') || lower.includes('failed-precondition')) {
      code = 'invalid-argument';
    } else if (lower.includes('network')) {
      code = 'network-error';
    } else {
      code = 'firestore-error';
    }
  }

  return { code, message: message.slice(0, 600) };
}

function classifySyncError(
  code: string,
  message: string,
  operationType: OperationType | 'sync',
  isOffline: boolean
): { category: SyncErrorCategory; diagnosticHint: string } {
  const lower = `${code} ${message}`.toLowerCase();

  if (
    isOffline ||
    code === 'unavailable' ||
    code === 'network-error' ||
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('err_internet_disconnected')
  ) {
    return {
      category: 'offline',
      diagnosticHint:
        "Connexion réseau indisponible. Les données saisies sont conservées dans le cache local ; cliquez sur « Relancer » ou « Tester & resynchroniser » dès le retour d'Internet.",
    };
  }

  if (code === 'permission-denied' || lower.includes('insufficient permissions') || lower.includes('permission_denied')) {
    return {
      category: 'permission',
      diagnosticHint:
        "Accès refusé par les règles Firestore pour ce rôle ou ce document. Vérifiez le rôle attribué dans Équipe & Rôles ou actualisez la session.",
    };
  }

  if (code === 'already-exists' || lower.includes('target id already exists')) {
    return {
      category: 'listener',
      diagnosticHint:
        'Conflit temporaire d’identifiant de flux temps réel Firestore. La réinitialisation automatique du flux rétablit l’écoute sans perte de données.',
    };
  }

  if (code === 'resource-exhausted' || lower.includes('quota')) {
    return {
      category: 'quota',
      diagnosticHint:
        'Quota journalier Firestore temporairement atteint. Patientez quelques instants avant de relancer la synchronisation.',
    };
  }

  if (code === 'deadline-exceeded' || code === 'aborted' || lower.includes('timeout') || lower.includes('aborted')) {
    return {
      category: 'timeout',
      diagnosticHint:
        'Délai de réponse dépassé ou écriture concurrente détectée. Utilisez « Relancer » pour réappliquer la modification en toute sécurité.',
    };
  }

  if (code === 'invalid-argument' || code === 'failed-precondition' || lower.includes('invalid-argument')) {
    return {
      category: 'validation',
      diagnosticHint:
        'Données rejetées lors de la validation (champ requis manquant ou taille maximale dépassée). Vérifiez les champs saisis avant de réessayer.',
    };
  }

  if (operationType === OperationType.LIST || operationType === OperationType.GET) {
    return {
      category: 'listener',
      diagnosticHint:
        'Flux temps réel interrompu sur cette collection. Testez la connexion serveur pour rétablir l’écoute en direct.',
    };
  }

  return {
    category: 'unknown',
    diagnosticHint:
      'Incident technique lors de la synchronisation Firestore. Copiez le log si besoin et relancez l’opération.',
  };
}

export function recordSyncError(params: {
  error: unknown;
  operationType: OperationType | 'sync';
  path: string | null;
  retryPayload?: SyncRetryPayload;
}): SyncErrorLog {
  const isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
  const { code, message } = extractErrorCodeAndMessage(params.error);
  const { category, diagnosticHint } = classifySyncError(code, message, params.operationType, isOffline);
  const safePath = (params.path || 'firestore/inconnu').slice(0, 180);
  const collectionName = safePath.split('/')[0] || 'firestore';
  const nowIso = new Date().toISOString();

  // Deduplicate rapid identical unresolved errors within 3 seconds
  const head = syncErrorLogsState[0];
  if (
    head &&
    !head.resolved &&
    head.path === safePath &&
    head.operationType === params.operationType &&
    head.errorCode === code &&
    Date.now() - new Date(head.timestamp).getTime() < 3000
  ) {
    const updatedHead: SyncErrorLog = {
      ...head,
      timestamp: nowIso,
      isOfflineAtOccurrence: isOffline,
      retryPayload: params.retryPayload || head.retryPayload,
    };
    syncErrorLogsState = [updatedHead, ...syncErrorLogsState.slice(1)];
    persistSyncErrors(syncErrorLogsState);
    emitSyncErrorLogs();
    return updatedHead;
  }

  const entry: SyncErrorLog = {
    id: `syncerr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: nowIso,
    operationType: params.operationType,
    path: safePath,
    collectionName,
    errorCode: code,
    message,
    diagnosticHint,
    category,
    isOfflineAtOccurrence: isOffline,
    resolved: false,
    retryCount: 0,
    retryPayload: params.retryPayload,
  };

  syncErrorLogsState = [entry, ...syncErrorLogsState].slice(0, MAX_SYNC_ERROR_LOGS);
  persistSyncErrors(syncErrorLogsState);
  emitSyncErrorLogs();
  return entry;
}

export function markSyncErrorResolved(logId: string) {
  const nowIso = new Date().toISOString();
  syncErrorLogsState = syncErrorLogsState.map((entry) =>
    entry.id === logId ? { ...entry, resolved: true, resolvedAt: nowIso } : entry
  );
  persistSyncErrors(syncErrorLogsState);
  emitSyncErrorLogs();
}

export function autoResolveRecoverableSyncErrors() {
  const nowIso = new Date().toISOString();
  let changed = false;
  syncErrorLogsState = syncErrorLogsState.map((entry) => {
    const isTargetCollision =
      entry.errorCode === 'already-exists' ||
      entry.message.toLowerCase().includes('target id already exists');
    if (
      !entry.resolved &&
      !entry.retryPayload &&
      (entry.category === 'offline' ||
        entry.category === 'listener' ||
        entry.category === 'timeout' ||
        isTargetCollision)
    ) {
      changed = true;
      return { ...entry, resolved: true, resolvedAt: nowIso };
    }
    return entry;
  });
  if (changed) {
    persistSyncErrors(syncErrorLogsState);
    emitSyncErrorLogs();
  }
}

export function markCollectionSyncHealthy(pathPrefix: string) {
  if (!pathPrefix) return;
  const cleanPrefix = pathPrefix.trim();
  if (!cleanPrefix) return;
  const matchesRecoverable = (entry: SyncErrorLog) =>
    !entry.resolved &&
    !entry.retryPayload &&
    (entry.path === cleanPrefix ||
      entry.path.startsWith(`${cleanPrefix}/`) ||
      entry.collectionName === cleanPrefix) &&
    (entry.operationType === OperationType.LIST ||
      entry.operationType === OperationType.GET ||
      entry.category === 'offline' ||
      entry.category === 'listener' ||
      entry.category === 'timeout' ||
      entry.errorCode === 'already-exists' ||
      entry.message.toLowerCase().includes('target id already exists'));

  if (!syncErrorLogsState.some(matchesRecoverable)) return;

  const nowIso = new Date().toISOString();
  syncErrorLogsState = syncErrorLogsState.map((entry) =>
    matchesRecoverable(entry) ? { ...entry, resolved: true, resolvedAt: nowIso } : entry
  );
  persistSyncErrors(syncErrorLogsState);
  emitSyncErrorLogs();
}

export function incrementSyncErrorRetry(logId: string) {
  syncErrorLogsState = syncErrorLogsState.map((entry) =>
    entry.id === logId ? { ...entry, retryCount: (entry.retryCount || 0) + 1 } : entry
  );
  persistSyncErrors(syncErrorLogsState);
  emitSyncErrorLogs();
}

export function clearResolvedSyncErrors() {
  syncErrorLogsState = syncErrorLogsState.filter((entry) => !entry.resolved);
  persistSyncErrors(syncErrorLogsState);
  emitSyncErrorLogs();
}

export function clearAllSyncErrors() {
  syncErrorLogsState = [];
  persistSyncErrors(syncErrorLogsState);
  emitSyncErrorLogs();
}

export async function verifyFirestoreServerSync(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!auth.currentUser) {
    return {
      ok: false,
      latencyMs: 0,
      error: 'Session non authentifiée.',
    };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offlineErr = new Error('Le navigateur signale une connexion hors ligne.');
    recordSyncError({
      error: offlineErr,
      operationType: 'sync',
      path: 'settings/clinic',
    });
    return {
      ok: false,
      latencyMs: 0,
      error: offlineErr.message,
    };
  }

  try {
    await Promise.race([
      waitForPendingWrites(db),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('Délai dépassé (timeout) lors de la purge des écritures locales.')), 6000)
      ),
    ]);

    await Promise.race([
      getDocFromServer(doc(db, 'settings', 'clinic')),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('Le serveur Firestore ne répond pas dans le délai imparti.')), 6000)
      ),
    ]);

    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      ok: true,
      latencyMs: Math.max(1, Math.round(endedAt - startedAt)),
    };
  } catch (err) {
    recordSyncError({
      error: err,
      operationType: 'sync',
      path: 'settings/clinic',
    });
    return {
      ok: false,
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function reportFirestoreListenerError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  retryPayload?: SyncRetryPayload
): FirestoreErrorInfo {
  recordSyncError({
    error,
    operationType,
    path,
    retryPayload,
  });

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  retryPayload?: SyncRetryPayload
): never {
  const errInfo = reportFirestoreListenerError(error, operationType, path, retryPayload);
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore fonctionne en mode cache hors ligne local.');
    }
    return false;
  }
}

const MAX_TARGET_ID_COLLISION_RETRIES = 3;
const WATCH_RESET_COOLDOWN_MS = 2500;
let watchStreamResetPromise: Promise<boolean> | null = null;
let lastWatchStreamResetAt = 0;

export function isTargetIdCollisionError(error: unknown): boolean {
  const { code, message } = extractErrorCodeAndMessage(error);
  const lower = message.toLowerCase();
  return (
    code === 'already-exists' ||
    lower.includes('target id already exists')
  );
}

export async function resetFirestoreWatchStream(force = false): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  if (watchStreamResetPromise) return watchStreamResetPromise;

  const now = Date.now();
  if (!force && now - lastWatchStreamResetAt < WATCH_RESET_COOLDOWN_MS) {
    return true;
  }

  watchStreamResetPromise = (async () => {
    try {
      lastWatchStreamResetAt = Date.now();
      await disableNetwork(db);
      await new Promise<void>((resolve) => {
        if (typeof window !== 'undefined') {
          window.setTimeout(resolve, 160);
        } else {
          setTimeout(resolve, 160);
        }
      });
      await enableNetwork(db);
      return true;
    } catch {
      try {
        await enableNetwork(db);
      } catch {
        // Ignore follow-up enableNetwork errors
      }
      return false;
    } finally {
      watchStreamResetPromise = null;
    }
  })();

  return watchStreamResetPromise;
}

export function subscribeFirestoreDoc<T = DocumentData>(
  ref: DocumentReference<T>,
  onNext: (snap: DocumentSnapshot<T>) => void,
  path: string
): () => void {
  let disposed = false;
  let retryCount = 0;
  let currentUnsub: Unsubscribe | null = null;
  let retryTimer: number | null = null;

  const attach = () => {
    if (disposed) return;
    currentUnsub = onSnapshot(
      ref,
      (snap) => {
        if (disposed) return;
        retryCount = 0;
        onNext(snap);
      },
      (err) => {
        if (disposed) return;
        if (isTargetIdCollisionError(err) && retryCount < MAX_TARGET_ID_COLLISION_RETRIES && auth.currentUser) {
          retryCount += 1;
          const unsubFailed = currentUnsub;
          currentUnsub = null;
          unsubFailed?.();
          console.warn(
            `Réinitialisation automatique du flux Firestore (${path}, tentative ${retryCount}/${MAX_TARGET_ID_COLLISION_RETRIES}).`
          );
          void resetFirestoreWatchStream().then(() => {
            if (disposed || !auth.currentUser) return;
            const jitter = 80 + retryCount * 140 + Math.floor(Math.random() * 100);
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              attach();
            }, jitter);
          });
          return;
        }
        reportFirestoreListenerError(err, OperationType.GET, path);
      }
    );
  };

  attach();

  return () => {
    disposed = true;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    const unsub = currentUnsub;
    currentUnsub = null;
    unsub?.();
  };
}

export function subscribeFirestoreQuery<T = DocumentData>(
  targetQuery: Query<T>,
  onNext: (snap: QuerySnapshot<T>) => void,
  path: string
): () => void {
  let disposed = false;
  let retryCount = 0;
  let currentUnsub: Unsubscribe | null = null;
  let retryTimer: number | null = null;

  const attach = () => {
    if (disposed) return;
    currentUnsub = onSnapshot(
      targetQuery,
      (snap) => {
        if (disposed) return;
        retryCount = 0;
        onNext(snap);
      },
      (err) => {
        if (disposed) return;
        if (isTargetIdCollisionError(err) && retryCount < MAX_TARGET_ID_COLLISION_RETRIES && auth.currentUser) {
          retryCount += 1;
          const unsubFailed = currentUnsub;
          currentUnsub = null;
          unsubFailed?.();
          console.warn(
            `Réinitialisation automatique du flux Firestore (${path}, tentative ${retryCount}/${MAX_TARGET_ID_COLLISION_RETRIES}).`
          );
          void resetFirestoreWatchStream().then(() => {
            if (disposed || !auth.currentUser) return;
            const jitter = 80 + retryCount * 140 + Math.floor(Math.random() * 100);
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              attach();
            }, jitter);
          });
          return;
        }
        reportFirestoreListenerError(err, OperationType.LIST, path);
      }
    );
  };

  attach();

  return () => {
    disposed = true;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    const unsub = currentUnsub;
    currentUnsub = null;
    unsub?.();
  };
}

export async function resyncFirestoreNetwork(options?: { forceReset?: boolean }): Promise<boolean> {
  if (!auth.currentUser) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    if (options?.forceReset) {
      await resetFirestoreWatchStream(true);
    } else {
      await enableNetwork(db);
    }
    await Promise.race([
      waitForPendingWrites(db),
      new Promise<void>((resolve) => window.setTimeout(resolve, 4000)),
    ]);
    autoResolveRecoverableSyncErrors();
    return true;
  } catch {
    return false;
  }
}
