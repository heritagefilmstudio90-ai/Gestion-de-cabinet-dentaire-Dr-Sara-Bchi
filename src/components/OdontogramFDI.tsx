import React, { useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, FileText, Layers, Plus, RotateCcw, X } from 'lucide-react';
import {
  DentitionMode,
  FDI_LOWER_LEFT,
  FDI_LOWER_RIGHT,
  FDI_TEMP_LOWER_LEFT,
  FDI_TEMP_LOWER_RIGHT,
  FDI_TEMP_UPPER_LEFT,
  FDI_TEMP_UPPER_RIGHT,
  FDI_UPPER_LEFT,
  FDI_UPPER_RIGHT,
  TOOTH_STATUS_META,
  ToothFace,
  ToothRecord,
  ToothStatus,
} from '../types/dental';

interface OdontogramFDIProps {
  dentitionMode: DentitionMode;
  odontogram: Record<string, ToothRecord>;
  canEdit: boolean;
  onChangeDentitionMode: (mode: DentitionMode) => void;
  onUpdateTooth: (toothId: string, record: ToothRecord) => void;
  onUpdateTeethBatch?: (updates: Record<string, ToothRecord>) => void;
  onQuickAddAct?: (toothId: string, faces: string) => void;
  onGenerateQuote?: (teeth: string[]) => void;
}

const FACE_LABELS: Record<ToothFace, string> = {
  M: 'Mésiale',
  D: 'Distale',
  O: 'Occlusale',
  V: 'Vestibulaire',
  L: 'Linguale / Palatine',
};

const ALL_STATUSES = Object.keys(TOOTH_STATUS_META) as ToothStatus[];

const ADULT_UPPER_ARCH = [...FDI_UPPER_RIGHT, ...FDI_UPPER_LEFT];
const ADULT_LOWER_ARCH = [...FDI_LOWER_RIGHT, ...FDI_LOWER_LEFT];
const TEMP_UPPER_ARCH = [...FDI_TEMP_UPPER_RIGHT, ...FDI_TEMP_UPPER_LEFT];
const TEMP_LOWER_ARCH = [...FDI_TEMP_LOWER_RIGHT, ...FDI_TEMP_LOWER_LEFT];

const ToothTile: React.FC<{
  toothId: string;
  record?: ToothRecord;
  selected: boolean;
  showMultiBadge?: boolean;
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ toothId, record, selected, showMultiBadge = false, onSelect }) => {
  const globalStatus = record?.status || 'sain';
  const faces = record?.faces || {};
  const meta = TOOTH_STATUS_META[globalStatus];
  const isMissing = globalStatus === 'manquante';

  const faceColor = (f: ToothFace) => {
    const fStatus = faces[f];
    if (fStatus && fStatus !== 'sain') return TOOTH_STATUS_META[fStatus].color;
    if (globalStatus !== 'sain' && globalStatus !== 'carie' && globalStatus !== 'composite' && globalStatus !== 'amalgame') {
      return meta.color;
    }
    return undefined;
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex flex-col items-center rounded-lg border p-1.5 transition-all ${
        selected
          ? 'border-sky-600 dark:border-sky-400 bg-sky-50/80 dark:bg-sky-950/70 shadow-[0_0_14px_rgba(2,132,199,0.22)] dark:shadow-[0_0_14px_rgba(56,189,248,0.22)] z-10'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-0.5 rounded-lg ring-2 ring-sky-400/80 dark:ring-sky-400/70 animate-tooth-glow"
        />
      )}
      {selected && showMultiBadge && (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-white shadow-xs"
        >
          <Check className="h-2.5 w-2.5 stroke-[3]" />
        </span>
      )}
      <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums mb-1">
        {toothId}
      </span>
      <svg viewBox="0 0 40 40" className="h-9 w-9 text-slate-900 dark:text-slate-100">
        {isMissing ? (
          <>
            <rect x="4" y="4" width="32" height="32" rx="6" className="fill-slate-100 dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.5" />
            <line x1="9" y1="9" x2="31" y2="31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="31" y1="9" x2="9" y2="31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            {/* Top: Vestibulaire (V) */}
            <polygon points="4,4 36,4 28,12 12,12" fill={faceColor('V')} className={!faceColor('V') ? 'fill-slate-50 dark:fill-slate-700' : undefined} stroke="#94A3B8" strokeWidth="1" />
            {/* Bottom: Linguale / Palatine (L) */}
            <polygon points="12,28 28,28 36,36 4,36" fill={faceColor('L')} className={!faceColor('L') ? 'fill-slate-50 dark:fill-slate-700' : undefined} stroke="#94A3B8" strokeWidth="1" />
            {/* Left: Mésiale/Distale */}
            <polygon points="4,4 12,12 12,28 4,36" fill={faceColor('M')} className={!faceColor('M') ? 'fill-slate-50 dark:fill-slate-700' : undefined} stroke="#94A3B8" strokeWidth="1" />
            {/* Right: Distale/Mésiale */}
            <polygon points="36,4 36,36 28,28 28,12" fill={faceColor('D')} className={!faceColor('D') ? 'fill-slate-50 dark:fill-slate-700' : undefined} stroke="#94A3B8" strokeWidth="1" />
            {/* Center: Occlusale (O) */}
            <rect x="12" y="12" width="16" height="16" fill={faceColor('O')} className={!faceColor('O') ? 'fill-slate-50 dark:fill-slate-700' : undefined} stroke="#94A3B8" strokeWidth="1" />
          </>
        )}
      </svg>
      <span
        className="mt-1 font-mono text-[10px] font-medium tabular-nums"
        style={{ color: globalStatus === 'sain' ? '#94A3B8' : meta.color }}
      >
        {meta.short}
      </span>
    </button>
  );
};

export const OdontogramFDI: React.FC<OdontogramFDIProps> = ({
  dentitionMode,
  odontogram,
  canEdit,
  onChangeDentitionMode,
  onUpdateTooth,
  onUpdateTeethBatch,
  onQuickAddAct,
  onGenerateQuote,
}) => {
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>(['16']);
  const [multiSelectMode, setMultiSelectMode] = useState<boolean>(false);
  const [selectedStatus, setSelectedStatus] = useState<ToothStatus>('carie');
  const [noteInput, setNoteInput] = useState<string>('');

  const showAdult = dentitionMode === 'adulte' || dentitionMode === 'mixte';
  const showTemp = dentitionMode === 'temporaire' || dentitionMode === 'mixte';

  const visibleTeethSet = useMemo(() => {
    const list: string[] = [];
    if (showAdult) list.push(...ADULT_UPPER_ARCH, ...ADULT_LOWER_ARCH);
    if (showTemp) list.push(...TEMP_UPPER_ARCH, ...TEMP_LOWER_ARCH);
    return new Set(list);
  }, [showAdult, showTemp]);

  useEffect(() => {
    setSelectedTeeth((prev) => {
      const remaining = prev.filter((t) => visibleTeethSet.has(t));
      if (remaining.length > 0) return remaining;
      return [dentitionMode === 'temporaire' ? '55' : '16'];
    });
  }, [dentitionMode, visibleTeethSet]);

  const primaryTooth = selectedTeeth[selectedTeeth.length - 1] || '';
  const isMultiSelected = selectedTeeth.length > 1;

  const sortedSelectedTeeth = useMemo(
    () => [...selectedTeeth].sort((a, b) => Number(a) - Number(b)),
    [selectedTeeth]
  );

  const currentRecord: ToothRecord = (primaryTooth && odontogram[primaryTooth]) || {
    status: 'sain',
    faces: {},
    note: '',
  };

  useEffect(() => {
    if (selectedTeeth.length === 1 && primaryTooth) {
      setNoteInput(odontogram[primaryTooth]?.note || '');
    } else if (selectedTeeth.length === 0) {
      setNoteInput('');
    }
  }, [odontogram, primaryTooth, selectedTeeth.length]);

  const commitBatch = (updates: Record<string, ToothRecord>) => {
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    if (onUpdateTeethBatch) {
      onUpdateTeethBatch(updates);
      return;
    }
    keys.forEach((toothId) => {
      onUpdateTooth(toothId, updates[toothId]);
    });
  };

  const handleSelectTooth = (toothId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const isAdditiveModifier = e.ctrlKey || e.metaKey;
    const isRangeModifier = e.shiftKey;

    if (isRangeModifier && selectedTeeth.length > 0) {
      if (!multiSelectMode) setMultiSelectMode(true);
      const anchor = selectedTeeth[selectedTeeth.length - 1];
      const arches = [ADULT_UPPER_ARCH, ADULT_LOWER_ARCH, TEMP_UPPER_ARCH, TEMP_LOWER_ARCH];
      const matchingArch = arches.find((arch) => arch.includes(anchor) && arch.includes(toothId));
      if (matchingArch) {
        const i1 = matchingArch.indexOf(anchor);
        const i2 = matchingArch.indexOf(toothId);
        const [start, end] = i1 <= i2 ? [i1, i2] : [i2, i1];
        const range = matchingArch.slice(start, end + 1);
        setSelectedTeeth((prev) => Array.from(new Set([...prev, ...range])));
        return;
      }
    }

    if (multiSelectMode || isAdditiveModifier) {
      if (!multiSelectMode && isAdditiveModifier) {
        setMultiSelectMode(true);
      }
      setSelectedTeeth((prev) => {
        if (prev.includes(toothId)) {
          return prev.filter((id) => id !== toothId);
        }
        return [...prev, toothId];
      });
      return;
    }

    setSelectedTeeth([toothId]);
    setNoteInput(odontogram[toothId]?.note || '');
  };

  const selectToothGroup = (group: string[]) => {
    setMultiSelectMode(true);
    setSelectedTeeth((prev) => {
      const allPresent = group.every((t) => prev.includes(t));
      if (allPresent) {
        return prev.filter((t) => !group.includes(t));
      }
      return Array.from(new Set([...prev, ...group]));
    });
  };

  const toggleMultiSelectMode = () => {
    setMultiSelectMode((prev) => {
      const next = !prev;
      if (!next && selectedTeeth.length > 1) {
        setSelectedTeeth([selectedTeeth[selectedTeeth.length - 1]]);
      }
      return next;
    });
  };

  const resetSelection = () => {
    const fallback = primaryTooth && visibleTeethSet.has(primaryTooth) ? primaryTooth : dentitionMode === 'temporaire' ? '55' : '16';
    setSelectedTeeth([fallback]);
    setMultiSelectMode(false);
    setNoteInput(odontogram[fallback]?.note || '');
  };

  const removeToothFromSelection = (toothId: string) => {
    setSelectedTeeth((prev) => prev.filter((t) => t !== toothId));
  };

  const applyToothGlobalStatus = (status: ToothStatus) => {
    if (!canEdit || selectedTeeth.length === 0) return;
    const now = new Date().toISOString();
    const updates: Record<string, ToothRecord> = {};

    selectedTeeth.forEach((toothId) => {
      const rec = odontogram[toothId] || { status: 'sain' as ToothStatus, faces: {}, note: '' };
      updates[toothId] = {
        ...rec,
        status,
        faces: status === 'sain' || status === 'manquante' ? {} : rec.faces,
        note: selectedTeeth.length === 1 ? noteInput : rec.note || '',
        updatedAt: now,
      };
    });

    if (selectedTeeth.length === 1 && onUpdateTeethBatch === undefined) {
      onUpdateTooth(selectedTeeth[0], updates[selectedTeeth[0]]);
    } else {
      commitBatch(updates);
    }
  };

  const toggleFace = (face: ToothFace) => {
    if (!canEdit || selectedTeeth.length === 0) return;
    const now = new Date().toISOString();
    const allHaveSelectedStatus = selectedTeeth.every(
      (toothId) => odontogram[toothId]?.faces?.[face] === selectedStatus
    );

    const updates: Record<string, ToothRecord> = {};
    selectedTeeth.forEach((toothId) => {
      const rec = odontogram[toothId] || { status: 'sain' as ToothStatus, faces: {}, note: '' };
      const nextFaces = { ...rec.faces };
      if (allHaveSelectedStatus) {
        delete nextFaces[face];
      } else {
        nextFaces[face] = selectedStatus;
      }
      const nextGlobal =
        rec.status === 'sain' && Object.keys(nextFaces).length > 0 ? selectedStatus : rec.status;
      updates[toothId] = {
        ...rec,
        status: nextGlobal,
        faces: nextFaces,
        note: selectedTeeth.length === 1 ? noteInput : rec.note || '',
        updatedAt: now,
      };
    });

    if (selectedTeeth.length === 1 && onUpdateTeethBatch === undefined) {
      onUpdateTooth(selectedTeeth[0], updates[selectedTeeth[0]]);
    } else {
      commitBatch(updates);
    }
  };

  const saveNote = () => {
    if (!canEdit || selectedTeeth.length === 0) return;
    const now = new Date().toISOString();
    const updates: Record<string, ToothRecord> = {};

    selectedTeeth.forEach((toothId) => {
      const rec = odontogram[toothId] || { status: 'sain' as ToothStatus, faces: {}, note: '' };
      updates[toothId] = {
        ...rec,
        note: noteInput,
        updatedAt: now,
      };
    });

    if (selectedTeeth.length === 1 && onUpdateTeethBatch === undefined) {
      onUpdateTooth(selectedTeeth[0], updates[selectedTeeth[0]]);
    } else {
      commitBatch(updates);
    }
  };

  const getMultiFaceDisplay = (face: ToothFace): { status?: ToothStatus; count: number; mixed: boolean } => {
    if (selectedTeeth.length === 0) return { count: 0, mixed: false };
    const statuses = selectedTeeth.map((id) => odontogram[id]?.faces?.[face]).filter(Boolean) as ToothStatus[];
    if (statuses.length === 0) return { count: 0, mixed: false };
    const unique = Array.from(new Set(statuses));
    if (unique.length === 1 && statuses.length === selectedTeeth.length) {
      return { status: unique[0], count: statuses.length, mixed: false };
    }
    return { status: unique.length === 1 ? unique[0] : undefined, count: statuses.length, mixed: true };
  };

  const getCombinedFacesForAct = (): string => {
    const faceSet = new Set<string>();
    selectedTeeth.forEach((id) => {
      Object.keys(odontogram[id]?.faces || {}).forEach((f) => faceSet.add(f));
    });
    return Array.from(faceSet).join('') || 'Globale';
  };

  return (
    <div className="space-y-5">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Odontogramme Interactif (Norme FDI)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cliquez sur une dent ou activez la sélection multiple (⌘/Ctrl + clic, Maj + clic pour une plage) pour un traitement groupé
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {(['adulte', 'mixte', 'temporaire'] as DentitionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={!canEdit && mode !== dentitionMode}
              onClick={() => onChangeDentitionMode(mode)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                dentitionMode === mode
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {mode === 'adulte' ? 'Dentition Adulte (11–48)' : mode === 'mixte' ? 'Mixte' : 'Temporaire (51–85)'}
            </button>
          ))}
        </div>
      </div>

      {/* Main grid + Editor drawer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* FDI Arch Chart */}
        <div className="xl:col-span-8 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-3 sm:p-4 space-y-4 overflow-x-auto">
          {/* Multi-selection & quick quadrant toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleMultiSelectMode}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  multiSelectMode || isMultiSelected
                    ? 'border-sky-600 bg-sky-600 text-white shadow-xs'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {multiSelectMode || isMultiSelected ? (
                  <CheckSquare className="h-3.5 w-3.5" />
                ) : (
                  <Layers className="h-3.5 w-3.5" />
                )}
                <span>Sélection multiple</span>
                {selectedTeeth.length > 0 && (
                  <span
                    className={`ml-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                      multiSelectMode || isMultiSelected
                        ? 'bg-sky-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {selectedTeeth.length}
                  </span>
                )}
              </button>

              {showAdult && (
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { label: 'Maxillaire', teeth: ADULT_UPPER_ARCH },
                    { label: 'Mandibule', teeth: ADULT_LOWER_ARCH },
                    { label: 'Q1', teeth: FDI_UPPER_RIGHT },
                    { label: 'Q2', teeth: FDI_UPPER_LEFT },
                    { label: 'Q3', teeth: FDI_LOWER_LEFT },
                    { label: 'Q4', teeth: FDI_LOWER_RIGHT },
                  ].map((grp) => {
                    const active = grp.teeth.every((t) => selectedTeeth.includes(t));
                    return (
                      <button
                        key={grp.label}
                        type="button"
                        onClick={() => selectToothGroup(grp.teeth)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        {grp.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {dentitionMode === 'temporaire' && (
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { label: 'Arcade Sup.', teeth: TEMP_UPPER_ARCH },
                    { label: 'Arcade Inf.', teeth: TEMP_LOWER_ARCH },
                  ].map((grp) => {
                    const active = grp.teeth.every((t) => selectedTeeth.includes(t));
                    return (
                      <button
                        key={grp.label}
                        type="button"
                        onClick={() => selectToothGroup(grp.teeth)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        {grp.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {(isMultiSelected || multiSelectMode) && (
              <button
                type="button"
                onClick={resetSelection}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Sélection simple</span>
              </button>
            )}
          </div>

          {showAdult && (
            <div>
              <div className="flex justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 px-1">
                <span>Quadrant 1 · Maxillaire Droit</span>
                <span>Quadrant 2 · Maxillaire Gauche</span>
              </div>
              <div className="flex items-center justify-center gap-1 min-w-[680px]">
                {FDI_UPPER_RIGHT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_UPPER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
              </div>
            </div>
          )}

          {showTemp && (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-center gap-1 min-w-[460px]">
                {FDI_TEMP_UPPER_RIGHT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_TEMP_UPPER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
              </div>
              <div className="flex items-center justify-center gap-1 min-w-[460px]">
                {FDI_TEMP_LOWER_RIGHT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_TEMP_LOWER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
              </div>
            </div>
          )}

          {showAdult && (
            <div>
              <div className="flex items-center justify-center gap-1 min-w-[680px]">
                {FDI_LOWER_RIGHT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_LOWER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTeeth.includes(t)}
                    showMultiBadge={multiSelectMode || isMultiSelected}
                    onSelect={(e) => handleSelectTooth(t, e)}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1.5 px-1">
                <span>Quadrant 4 · Mandibulaire Droit</span>
                <span>Quadrant 3 · Mandibulaire Gauche</span>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3 text-[11px] text-slate-600 dark:text-slate-300">
            {ALL_STATUSES.map((st) => (
              <span key={st} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm border border-slate-300 dark:border-slate-600"
                  style={{ backgroundColor: TOOTH_STATUS_META[st].color }}
                />
                <span>{TOOTH_STATUS_META[st].label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Selected Tooth / Batch Inspector */}
        <div className="xl:col-span-4 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedTeeth.length === 0
                    ? 'Aucune dent sélectionnée'
                    : isMultiSelected
                    ? 'Traitement groupé'
                    : 'Dent sélectionnée'}
                </p>
                <p className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                  {selectedTeeth.length === 0
                    ? '—'
                    : isMultiSelected
                    ? `${selectedTeeth.length} dents sélectionnées`
                    : `Dent #${primaryTooth}`}
                </p>
              </div>
              {selectedTeeth.length === 1 ? (
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {TOOTH_STATUS_META[currentRecord.status].label}
                </span>
              ) : selectedTeeth.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setSelectedTeeth([])}
                  className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Tout vider
                </button>
              ) : null}
            </div>

            {selectedTeeth.length > 1 && (
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-0.5">
                {sortedSelectedTeeth.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-800 dark:text-sky-200 tabular-nums"
                  >
                    <span>#{t}</span>
                    <button
                      type="button"
                      onClick={() => removeToothFromSelection(t)}
                      aria-label={`Retirer la dent ${t}`}
                      className="rounded hover:bg-sky-200/70 dark:hover:bg-sky-800/70 p-0.5"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {selectedTeeth.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-5 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <p>Cliquez sur une ou plusieurs dents dans le schéma FDI ou utilisez les raccourcis de quadrant (Q1–Q4, Maxillaire, Mandibule).</p>
            </div>
          ) : (
            <>
              {/* Active tool status for faces & global treatment */}
              <div>
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">
                  État à appliquer {isMultiSelected ? `aux ${selectedTeeth.length} dents` : 'aux faces ou à la dent entière'}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setSelectedStatus(st)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                        selectedStatus === st
                          ? 'border-sky-600 dark:border-sky-400 bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200 font-medium'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                      } disabled:opacity-50`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-sm shrink-0 border border-slate-300 dark:border-slate-600"
                        style={{ backgroundColor: TOOTH_STATUS_META[st].color }}
                      />
                      <span className="truncate">{TOOTH_STATUS_META[st].label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Faces toggle (supports batch across all selected teeth) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Découpage par face dentaire
                  </p>
                  {isMultiSelected && (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      Applique à {selectedTeeth.length} dents
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {(['M', 'D', 'O', 'V', 'L'] as ToothFace[]).map((f) => {
                    const singleFaceSt = !isMultiSelected ? currentRecord.faces?.[f] : undefined;
                    const multiFaceInfo = isMultiSelected ? getMultiFaceDisplay(f) : undefined;
                    const displayStatus = isMultiSelected ? multiFaceInfo?.status : singleFaceSt;
                    const subLabel = isMultiSelected
                      ? multiFaceInfo && multiFaceInfo.count > 0
                        ? multiFaceInfo.mixed
                          ? `${multiFaceInfo.count}/${selectedTeeth.length}`
                          : TOOTH_STATUS_META[multiFaceInfo.status!].short
                        : '—'
                      : singleFaceSt
                      ? TOOTH_STATUS_META[singleFaceSt].short
                      : '—';

                    return (
                      <button
                        key={f}
                        type="button"
                        disabled={!canEdit}
                        title={FACE_LABELS[f]}
                        onClick={() => toggleFace(f)}
                        className={`flex flex-col items-center justify-center rounded-lg border py-2 text-xs font-mono font-semibold hover:border-sky-400 disabled:opacity-50 ${
                          displayStatus || (multiFaceInfo && multiFaceInfo.count > 0)
                            ? ''
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                        style={
                          displayStatus
                            ? {
                                backgroundColor: `${TOOTH_STATUS_META[displayStatus].color}22`,
                                borderColor: TOOTH_STATUS_META[displayStatus].color,
                                color: TOOTH_STATUS_META[displayStatus].color,
                              }
                            : multiFaceInfo && multiFaceInfo.count > 0
                            ? {
                                backgroundColor: '#0284C715',
                                borderColor: '#0284C7',
                                color: '#0284C7',
                              }
                            : undefined
                        }
                      >
                        <span>{f}</span>
                        <span className="text-[9px] font-sans font-normal mt-0.5 truncate max-w-full px-1">
                          {subLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {canEdit && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => applyToothGlobalStatus(selectedStatus)}
                    className="flex-1 rounded-lg bg-slate-900 dark:bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-sky-500 transition-colors"
                  >
                    {isMultiSelected
                      ? `Appliquer « ${TOOTH_STATUS_META[selectedStatus].label} » aux ${selectedTeeth.length} dents`
                      : `Appliquer « ${TOOTH_STATUS_META[selectedStatus].label} » à la dent`}
                  </button>
                </div>
              )}

              {/* Note & Quick Act */}
              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                  {isMultiSelected
                    ? `Note clinique groupée (${selectedTeeth.length} dents)`
                    : `Note clinique dent #${primaryTooth}`}
                </label>
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder={
                    isMultiSelected
                      ? `Observations à enregistrer sur les ${selectedTeeth.length} dents sélectionnées...`
                      : 'Observations cliniques, matériaux, sensibilité...'
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-900"
                />
                {canEdit && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={saveNote}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        {isMultiSelected
                          ? `Enregistrer la note (${selectedTeeth.length})`
                          : 'Enregistrer la note'}
                      </span>
                    </button>
                    {onQuickAddAct && (
                      <button
                        type="button"
                        onClick={() =>
                          onQuickAddAct(
                            sortedSelectedTeeth.join(','),
                            getCombinedFacesForAct()
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>
                          {isMultiSelected
                            ? `Saisir un acte (${selectedTeeth.length} dents)`
                            : 'Saisir un acte'}
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {onGenerateQuote && selectedTeeth.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => onGenerateQuote(sortedSelectedTeeth)}
                      className={`w-full inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        isMultiSelected
                          ? 'border-[#163B63] bg-[#163B63] text-white hover:bg-[#0F2C4C] dark:border-sky-500 dark:bg-sky-600 dark:hover:bg-sky-500'
                          : 'border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/60'
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>
                        {isMultiSelected
                          ? `Générer & imprimer devis récapitulatif (${selectedTeeth.length} dents)`
                          : `Générer devis pour la dent #${primaryTooth}`}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

