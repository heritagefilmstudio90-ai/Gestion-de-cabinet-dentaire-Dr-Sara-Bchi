import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Calendar,
  FileText,
  History,
  Package,
  Search,
  Settings,
  Stethoscope,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { ActivityCategory, ActivityLogEntry, ROLE_LABELS } from '../types/dental';

interface ActivityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

type FilterKey = 'all' | 'patient' | 'planning' | 'facturation' | 'clinique';

const FILTER_TABS: Array<{ id: FilterKey; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'patient', label: 'Patients' },
  { id: 'planning', label: 'Planning' },
  { id: 'facturation', label: 'Factures' },
  { id: 'clinique', label: 'Clinique' },
];

const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; toneClass: string }
> = {
  patient: {
    label: 'Patient',
    icon: Users,
    toneClass: 'bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] dark:text-sky-400',
  },
  planning: {
    label: 'Planning',
    icon: Calendar,
    toneClass: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400',
  },
  facturation: {
    label: 'Facturation',
    icon: FileText,
    toneClass: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400',
  },
  clinique: {
    label: 'Clinique',
    icon: Stethoscope,
    toneClass: 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400',
  },
  logistique: {
    label: 'Labo & Stock',
    icon: Package,
    toneClass: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400',
  },
  administration: {
    label: 'Cabinet',
    icon: Settings,
    toneClass: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  },
};

function formatActivityTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';

  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds >= 0 && diffSeconds < 60) {
    return "À l'instant";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes >= 1 && diffMinutes < 60) {
    return `Il y a ${diffMinutes} min`;
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timePart = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) {
    return `Aujourd'hui ${timePart}`;
  }
  const dayPart = date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
  });
  return `${dayPart} · ${timePart}`;
}

export const ActivityDrawer: React.FC<ActivityDrawerProps> = ({ isOpen, onClose }) => {
  const { activityLogs, clearActivityLogs, openPatientFile, setActiveSection } = useClinic();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredLogs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return activityLogs.filter((entry) => {
      if (filter !== 'all' && entry.category !== filter) {
        return false;
      }
      if (!query) return true;
      return `${entry.title} ${entry.detail} ${entry.actorName}`
        .toLowerCase()
        .includes(query);
    });
  }, [activityLogs, filter, searchTerm]);

  const handleSelectEntry = (entry: ActivityLogEntry) => {
    if (entry.patientId) {
      openPatientFile(entry.patientId);
    } else {
      setActiveSection(entry.section);
    }
    onClose();
  };

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          aria-hidden="true"
          className="no-print fixed inset-0 z-40 bg-slate-900/40 dark:bg-black/65 transition-opacity"
        />
      )}

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-drawer-title"
        aria-hidden={!isOpen}
        className={`no-print fixed inset-y-0 right-0 z-50 w-full max-w-md pt-safe pb-safe pr-safe bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col transition-transform duration-200 motion-reduce:transition-none ${
          isOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <h2
              id="activity-drawer-title"
              className="font-display text-base font-bold text-slate-900 dark:text-white tracking-tight"
            >
              Journal d'activité récent
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {activityLogs.length === 0
                ? 'Aucune opération enregistrée'
                : `${activityLogs.length} opération${activityLogs.length > 1 ? 's' : ''} tracée${activityLogs.length > 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {activityLogs.length > 0 && (
              <button
                type="button"
                onClick={clearActivityLogs}
                title="Effacer le journal local"
                aria-label="Effacer le journal d'activité"
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Effacer</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le panneau d'activité"
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search & Interactive Segmented Filter */}
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 space-y-3">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtrer par patient, facture, acte..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div
            role="tablist"
            aria-label="Filtrer par type d'opération"
            className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 overflow-x-auto"
          >
            {FILTER_TABS.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(tab.id)}
                  className={`flex-1 min-w-fit rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chronological Operation Feed */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-14 space-y-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                <History className="h-5 w-5" />
              </div>
              <div className="space-y-1 max-w-xs">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {activityLogs.length === 0
                    ? 'Aucune activité récente'
                    : 'Aucun résultat pour ce filtre'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {activityLogs.length === 0
                    ? 'Les consultations de dossiers, factures émises et modifications du planning apparaîtront ici.'
                    : 'Modifiez votre recherche ou sélectionnez une autre catégorie.'}
                </p>
              </div>
            </div>
          ) : (
            filteredLogs.map((entry) => {
              const meta = CATEGORY_META[entry.category] || CATEGORY_META.administration;
              const Icon = meta.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleSelectEntry(entry)}
                  className="group flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 transition-colors"
                >
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.toneClass}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {entry.title}
                      </p>
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    {entry.detail && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                        {entry.detail}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{meta.label}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate max-w-[140px]">{entry.actorName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{ROLE_LABELS[entry.actorRole] || entry.actorRole}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatActivityTime(entry.timestamp)}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};
