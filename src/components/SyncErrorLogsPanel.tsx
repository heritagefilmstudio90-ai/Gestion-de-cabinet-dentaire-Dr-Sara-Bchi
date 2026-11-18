import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { SyncErrorCategory, SyncErrorLog } from '../types/dental';

const COLLECTION_LABELS: Record<string, string> = {
  patients: 'Patients',
  appointments: 'Agenda & RDV',
  bookingRequests: 'Demandes en ligne',
  treatmentPlans: 'Plans & Devis',
  invoices: 'Factures',
  payments: 'Encaissements',
  labOrders: 'Laboratoire & Prothèses',
  medicalDocuments: 'Documents médicaux',
  recalls: 'Rappels & SMS',
  expenses: 'Charges & Dépenses',
  cashClosures: 'Clôtures de caisse',
  inventory: 'Stock consommables',
  stockMovements: 'Mouvements de stock',
  adminDocuments: 'Documents administratifs',
  staff: 'Équipe & Rôles',
  staffInvites: 'Invitations équipe',
  actsCatalog: 'Catalogue des actes',
  settings: 'Paramètres cabinet',
};

const CATEGORY_META: Record<
  SyncErrorCategory,
  { label: string; toneClass: string }
> = {
  offline: {
    label: 'Hors-ligne / Réseau',
    toneClass: 'text-amber-700 dark:text-amber-400',
  },
  permission: {
    label: 'Permissions RBAC',
    toneClass: 'text-red-700 dark:text-red-400',
  },
  quota: {
    label: 'Quota Firestore',
    toneClass: 'text-rose-700 dark:text-rose-400',
  },
  timeout: {
    label: 'Délai / Conflit',
    toneClass: 'text-amber-700 dark:text-amber-400',
  },
  validation: {
    label: 'Validation schéma',
    toneClass: 'text-orange-700 dark:text-orange-400',
  },
  listener: {
    label: 'Flux temps réel',
    toneClass: 'text-sky-700 dark:text-sky-400',
  },
  unknown: {
    label: 'Incident technique',
    toneClass: 'text-slate-700 dark:text-slate-300',
  },
};

const OPERATION_LABELS: Record<SyncErrorLog['operationType'], string> = {
  create: 'Création',
  update: 'Mise à jour',
  delete: 'Suppression',
  list: 'Écoute liste',
  get: 'Lecture doc',
  write: 'Écriture',
  sync: 'Vérification synchro',
};

function formatSyncTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const SyncErrorLogsPanel: React.FC = () => {
  const {
    hasPendingSync,
    pendingSyncCollections,
    syncErrorLogs,
    retrySyncError,
    retryAllSyncErrors,
    checkServerConnection,
    resolveSyncError,
    clearResolvedSyncErrors,
    clearAllSyncErrors,
    showToast,
  } = useClinic();
  const isOnline = useOnlineStatus();

  const [statusFilter, setStatusFilter] = useState<'active' | 'resolved' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<'all' | SyncErrorCategory>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [checkingServer, setCheckingServer] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const [busyLogId, setBusyLogId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);
  const [lastServerCheck, setLastServerCheck] = useState<{
    ok: boolean;
    latencyMs: number;
    checkedAt: string;
  } | null>(null);

  const activeCount = useMemo(
    () => syncErrorLogs.filter((l) => !l.resolved).length,
    [syncErrorLogs]
  );
  const resolvedCount = useMemo(
    () => syncErrorLogs.filter((l) => l.resolved).length,
    [syncErrorLogs]
  );

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return syncErrorLogs.filter((entry) => {
      if (statusFilter === 'active' && entry.resolved) return false;
      if (statusFilter === 'resolved' && !entry.resolved) return false;
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (!q) return true;
      const collectionLabel = (COLLECTION_LABELS[entry.collectionName] || entry.collectionName).toLowerCase();
      return (
        entry.path.toLowerCase().includes(q) ||
        entry.errorCode.toLowerCase().includes(q) ||
        entry.message.toLowerCase().includes(q) ||
        entry.diagnosticHint.toLowerCase().includes(q) ||
        collectionLabel.includes(q)
      );
    });
  }, [syncErrorLogs, statusFilter, categoryFilter, searchTerm]);

  const pendingCollectionLabels = useMemo(
    () =>
      pendingSyncCollections.map(
        (col) => COLLECTION_LABELS[col] || col
      ),
    [pendingSyncCollections]
  );

  const handleCheckServer = async () => {
    if (checkingServer) return;
    setCheckingServer(true);
    try {
      const res = await checkServerConnection();
      setLastServerCheck({
        ok: res.ok,
        latencyMs: res.latencyMs,
        checkedAt: new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });
    } finally {
      setCheckingServer(false);
    }
  };

  const handleRetryOne = async (logId: string) => {
    if (busyLogId || retryingAll) return;
    setBusyLogId(logId);
    try {
      await retrySyncError(logId);
    } finally {
      setBusyLogId(null);
    }
  };

  const handleRetryAll = async () => {
    if (retryingAll || activeCount === 0) return;
    setRetryingAll(true);
    try {
      await retryAllSyncErrors();
    } finally {
      setRetryingAll(false);
    }
  };

  const handleCopyLog = async (entry: SyncErrorLog) => {
    const payload = JSON.stringify(
      {
        id: entry.id,
        timestamp: entry.timestamp,
        operationType: entry.operationType,
        path: entry.path,
        errorCode: entry.errorCode,
        category: entry.category,
        isOfflineAtOccurrence: entry.isOfflineAtOccurrence,
        retryCount: entry.retryCount,
        resolved: entry.resolved,
        message: entry.message,
      },
      null,
      2
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedLogId(entry.id);
      window.setTimeout(() => {
        setCopiedLogId((prev) => (prev === entry.id ? null : prev));
      }, 1800);
      showToast('Log de synchronisation copié dans le presse-papiers.', 'info');
    } catch {
      showToast('Impossible de copier automatiquement le log.', 'error');
    }
  };

  const handleExportLogs = () => {
    if (syncErrorLogs.length === 0) return;
    try {
      const cleanLogs = syncErrorLogs.map(({ retryPayload: _omitted, ...rest }) => rest);
      const blob = new Blob([JSON.stringify(cleanLogs, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dentaflow-sync-logs-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast('Export JSON des erreurs de synchronisation téléchargé.', 'success');
    } catch {
      showToast("Échec de l'export des logs.", 'error');
    }
  };

  return (
    <section
      aria-label="Erreurs de synchronisation et diagnostic hors-ligne"
      className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
    >
      {/* Header & Live Sync Telemetry Strip */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5 min-w-0">
          <Wrench
            className={`h-4 w-4 mt-0.5 shrink-0 ${
              activeCount > 0 || !isOnline
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-[#1598C7] dark:text-sky-400'
            }`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Erreurs de synchronisation & Diagnostic hors-ligne
              </h2>
              {activeCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900/60 px-2 py-0.5 text-[11px] font-semibold font-mono tabular-nums text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>
                    {activeCount} erreur{activeCount > 1 ? 's' : ''} active{activeCount > 1 ? 's' : ''}
                  </span>
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  isOnline
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {isOnline ? (
                  <Wifi className="h-3 w-3 shrink-0" />
                ) : (
                  <WifiOff className="h-3 w-3 shrink-0" />
                )}
                <span>{isOnline ? 'Réseau en ligne' : 'Mode hors ligne actif'}</span>
              </span>

              <span aria-hidden="true">·</span>

              <span className="font-mono tabular-nums">
                {hasPendingSync
                  ? `${pendingSyncCollections.length} file(s) locale(s) en attente (${pendingCollectionLabels.join(', ')})`
                  : 'Cache local synchronisé'}
              </span>

              {lastServerCheck && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-mono tabular-nums ${
                      lastServerCheck.ok
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {lastServerCheck.ok
                      ? `Serveur OK (${lastServerCheck.latencyMs} ms à ${lastServerCheck.checkedAt})`
                      : `Serveur injoignable (${lastServerCheck.checkedAt})`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={checkingServer}
            onClick={handleCheckServer}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60 whitespace-nowrap"
          >
            <Server className={`h-3.5 w-3.5 shrink-0 ${checkingServer ? 'animate-pulse text-[#1598C7]' : ''}`} />
            <span>{checkingServer ? 'Test en cours...' : 'Tester & resynchroniser'}</span>
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              disabled={retryingAll || !isOnline}
              onClick={handleRetryAll}
              title={!isOnline ? 'Reconnectez-vous à Internet pour relancer les écritures' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${retryingAll ? 'animate-spin' : ''}`} />
              <span>{retryingAll ? 'Relance...' : `Tout relancer (${activeCount})`}</span>
            </button>
          )}

          {syncErrorLogs.length > 0 && (
            <button
              type="button"
              onClick={handleExportLogs}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>Exporter JSON</span>
            </button>
          )}

          {resolvedCount > 0 && (
            <button
              type="button"
              onClick={clearResolvedSyncErrors}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <span>Effacer résolues ({resolvedCount})</span>
            </button>
          )}

          {syncErrorLogs.length > 0 && (
            <button
              type="button"
              onClick={clearAllSyncErrors}
              aria-label="Vider le journal des erreurs de synchronisation"
              title="Vider le journal"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filters (only displayed when logs exist) */}
      {syncErrorLogs.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 border-y border-slate-100 dark:border-slate-800 py-2.5">
          <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'active'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Actives ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('resolved')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'resolved'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Résolues ({resolvedCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Toutes ({syncErrorLogs.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial justify-end">
            <select
              aria-label="Filtrer par type d'erreur de synchronisation"
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as 'all' | SyncErrorCategory)
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-700 dark:text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="all">Toutes causes</option>
              <option value="offline">Hors-ligne / Réseau</option>
              <option value="permission">Permissions RBAC</option>
              <option value="timeout">Délai / Conflit</option>
              <option value="validation">Validation schéma</option>
              <option value="quota">Quota Firestore</option>
              <option value="listener">Flux temps réel</option>
              <option value="unknown">Autre</option>
            </select>

            <div className="relative min-w-[190px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Collection, chemin, code..."
                aria-label="Rechercher dans les logs de synchronisation"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Logs Content / Healthy Empty State */}
      {syncErrorLogs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 px-4 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                Aucune erreur de synchronisation détectée.
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Le cache local multi-onglets et les flux temps réel Firestore capturent automatiquement tout incident hors-ligne, de droits ou de latence ici pour une relance en un clic.
              </p>
            </div>
          </div>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="py-6 text-center space-y-1.5">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {statusFilter === 'active' && activeCount === 0
              ? 'Toutes les erreurs de synchronisation enregistrées ont été résolues.'
              : 'Aucun log ne correspond aux filtres sélectionnés.'}
          </p>
          {statusFilter === 'active' && resolvedCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className="text-xs font-semibold text-[#1598C7] dark:text-sky-400 hover:underline"
            >
              Afficher l’historique complet ({syncErrorLogs.length})
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto pr-1">
          {filteredLogs.map((entry) => {
            const catMeta = CATEGORY_META[entry.category] || CATEGORY_META.unknown;
            const collectionLabel =
              COLLECTION_LABELS[entry.collectionName] || entry.collectionName;
            const isExpanded = expandedLogId === entry.id;
            const isBusy = busyLogId === entry.id;
            const canReplayWrite = Boolean(entry.retryPayload);

            return (
              <div
                key={entry.id}
                className={`py-3 first:pt-1 last:pb-1 space-y-2 ${
                  entry.resolved ? 'opacity-75' : ''
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          entry.resolved
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : catMeta.toneClass
                        }`}
                      >
                        {entry.resolved ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{entry.resolved ? 'Résolue' : catMeta.label}</span>
                      </span>

                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>

                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {collectionLabel}
                      </span>

                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {OPERATION_LABELS[entry.operationType]} · {entry.path}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>{formatSyncTimestamp(entry.timestamp)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Code : {entry.errorCode}</span>
                      {entry.isOfflineAtOccurrence && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-700 dark:text-amber-400 font-sans font-medium">
                            Survenue hors-ligne
                          </span>
                        </>
                      )}
                      {entry.retryCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{entry.retryCount} relance(s)</span>
                        </>
                      )}
                      {canReplayWrite && !entry.resolved && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-sky-700 dark:text-sky-400 font-sans font-medium">
                            Donnée locale prête à réappliquer
                          </span>
                        </>
                      )}
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 rounded-lg px-2.5 py-1.5">
                      {entry.diagnosticHint}
                    </p>
                  </div>

                  {/* Row Actions */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {!entry.resolved && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy || retryingAll || !isOnline}
                          onClick={() => handleRetryOne(entry.id)}
                          title={
                            !isOnline
                              ? 'Connexion Internet requise pour relancer'
                              : canReplayWrite
                              ? 'Réappliquer la modification vers Firestore'
                              : 'Vérifier le flux et relancer la synchronisation'
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-[#1598C7] hover:bg-[#1082AC] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          <RefreshCw className={`h-3 w-3 shrink-0 ${isBusy ? 'animate-spin' : ''}`} />
                          <span>{isBusy ? 'Relance...' : 'Relancer'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => resolveSyncError(entry.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                        >
                          <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>Résolu</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedLogId((prev) => (prev === entry.id ? null : entry.id))
                      }
                      aria-expanded={isExpanded}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                    >
                      <span>Détails</span>
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 text-[11px] font-mono space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">
                        Message brut Firebase / Réseau
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyLog(entry)}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-sans font-medium text-slate-200 hover:bg-slate-700"
                      >
                        {copiedLogId === entry.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span>Copié</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copier</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="break-words text-rose-300 leading-relaxed">
                      {entry.message}
                    </p>
                    {entry.resolved && entry.resolvedAt && (
                      <p className="text-emerald-400">
                        Marqué résolu le {formatSyncTimestamp(entry.resolvedAt)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
