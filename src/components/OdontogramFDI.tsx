import React, { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
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
  onQuickAddAct?: (toothId: string, faces: string) => void;
}

const FACE_LABELS: Record<ToothFace, string> = {
  M: 'Mésiale',
  D: 'Distale',
  O: 'Occlusale',
  V: 'Vestibulaire',
  L: 'Linguale / Palatine',
};

const ALL_STATUSES = Object.keys(TOOTH_STATUS_META) as ToothStatus[];

const ToothTile: React.FC<{
  toothId: string;
  record?: ToothRecord;
  selected: boolean;
  onSelect: () => void;
}> = ({ toothId, record, selected, onSelect }) => {
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
      className={`group flex flex-col items-center rounded-lg border p-1.5 transition-all ${
        selected
          ? 'border-sky-600 dark:border-sky-400 bg-sky-50/60 dark:bg-sky-950/60 ring-2 ring-sky-200 dark:ring-sky-800'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
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
  onQuickAddAct,
}) => {
  const [selectedTooth, setSelectedTooth] = useState<string>('16');
  const [selectedStatus, setSelectedStatus] = useState<ToothStatus>('carie');
  const [noteInput, setNoteInput] = useState<string>('');

  const currentRecord: ToothRecord = odontogram[selectedTooth] || {
    status: 'sain',
    faces: {},
    note: '',
  };

  useEffect(() => {
    setNoteInput(odontogram[selectedTooth]?.note || '');
  }, [odontogram, selectedTooth]);

  const handleSelectTooth = (toothId: string) => {
    setSelectedTooth(toothId);
    const rec = odontogram[toothId];
    setNoteInput(rec?.note || '');
  };

  const applyToothGlobalStatus = (status: ToothStatus) => {
    if (!canEdit) return;
    onUpdateTooth(selectedTooth, {
      ...currentRecord,
      status,
      faces: status === 'sain' || status === 'manquante' ? {} : currentRecord.faces,
      note: noteInput,
      updatedAt: new Date().toISOString(),
    });
  };

  const toggleFace = (face: ToothFace) => {
    if (!canEdit) return;
    const nextFaces = { ...currentRecord.faces };
    if (nextFaces[face] === selectedStatus) {
      delete nextFaces[face];
    } else {
      nextFaces[face] = selectedStatus;
    }
    const nextGlobal =
      currentRecord.status === 'sain' && Object.keys(nextFaces).length > 0
        ? selectedStatus
        : currentRecord.status;
    onUpdateTooth(selectedTooth, {
      ...currentRecord,
      status: nextGlobal,
      faces: nextFaces,
      note: noteInput,
      updatedAt: new Date().toISOString(),
    });
  };

  const saveNote = () => {
    if (!canEdit) return;
    onUpdateTooth(selectedTooth, {
      ...currentRecord,
      note: noteInput,
      updatedAt: new Date().toISOString(),
    });
  };

  const showAdult = dentitionMode === 'adulte' || dentitionMode === 'mixte';
  const showTemp = dentitionMode === 'temporaire' || dentitionMode === 'mixte';

  return (
    <div className="space-y-5">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Odontogramme Interactif (Norme FDI)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cliquez sur une dent puis sélectionnez l'état ou les faces (M, D, O, V, L)
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
        <div className="xl:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4 space-y-4 overflow-x-auto">
          {showAdult && (
            <>
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
                      selected={selectedTooth === t}
                      onSelect={() => handleSelectTooth(t)}
                    />
                  ))}
                  <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                  {FDI_UPPER_LEFT.map((t) => (
                    <ToothTile
                      key={t}
                      toothId={t}
                      record={odontogram[t]}
                      selected={selectedTooth === t}
                      onSelect={() => handleSelectTooth(t)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {showTemp && (
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-center gap-1 min-w-[460px]">
                {FDI_TEMP_UPPER_RIGHT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTooth === t}
                    onSelect={() => handleSelectTooth(t)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_TEMP_UPPER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTooth === t}
                    onSelect={() => handleSelectTooth(t)}
                  />
                ))}
              </div>
              <div className="flex items-center justify-center gap-1 min-w-[460px]">
                {FDI_TEMP_LOWER_RIGHT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTooth === t}
                    onSelect={() => handleSelectTooth(t)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_TEMP_LOWER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTooth === t}
                    onSelect={() => handleSelectTooth(t)}
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
                    selected={selectedTooth === t}
                    onSelect={() => handleSelectTooth(t)}
                  />
                ))}
                <div className="w-px h-14 bg-slate-300 dark:bg-slate-700 mx-1.5" />
                {FDI_LOWER_LEFT.map((t) => (
                  <ToothTile
                    key={t}
                    toothId={t}
                    record={odontogram[t]}
                    selected={selectedTooth === t}
                    onSelect={() => handleSelectTooth(t)}
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

        {/* Selected Tooth Inspector */}
        <div className="xl:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Dent sélectionnée</p>
              <p className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                Dent #{selectedTooth}
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {TOOTH_STATUS_META[currentRecord.status].label}
            </span>
          </div>

          {/* Active tool status for faces */}
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">
              État à appliquer aux faces ou à la dent entière
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

          {/* Faces toggle */}
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-2">Découpage par face dentaire</p>
            <div className="grid grid-cols-5 gap-1.5">
              {(['M', 'D', 'O', 'V', 'L'] as ToothFace[]).map((f) => {
                const faceSt = currentRecord.faces?.[f];
                return (
                  <button
                    key={f}
                    type="button"
                    disabled={!canEdit}
                    title={FACE_LABELS[f]}
                    onClick={() => toggleFace(f)}
                    className={`flex flex-col items-center justify-center rounded-lg border py-2 text-xs font-mono font-semibold hover:border-sky-400 disabled:opacity-50 ${
                      faceSt
                        ? ''
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                    style={
                      faceSt
                        ? {
                            backgroundColor: `${TOOTH_STATUS_META[faceSt].color}22`,
                            borderColor: TOOTH_STATUS_META[faceSt].color,
                            color: TOOTH_STATUS_META[faceSt].color,
                          }
                        : undefined
                    }
                  >
                    <span>{f}</span>
                    <span className="text-[9px] font-sans font-normal mt-0.5 truncate max-w-full px-1">
                      {faceSt ? TOOTH_STATUS_META[faceSt].short : '—'}
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
                Appliquer « {TOOTH_STATUS_META[selectedStatus].label} » à la dent
              </button>
            </div>
          )}

          {/* Note */}
          <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">Note clinique dent #{selectedTooth}</label>
            <textarea
              rows={2}
              disabled={!canEdit}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Observations cliniques, matériaux, sensibilité..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-900"
            />
            {canEdit && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={saveNote}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Enregistrer la note</span>
                </button>
                {onQuickAddAct && (
                  <button
                    type="button"
                    onClick={() =>
                      onQuickAddAct(
                        selectedTooth,
                        Object.keys(currentRecord.faces || {}).join('') || 'Globale'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Saisir un acte</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
