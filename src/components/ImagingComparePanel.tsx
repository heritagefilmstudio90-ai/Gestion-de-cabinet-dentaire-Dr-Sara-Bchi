import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Columns2,
  Contrast,
  RotateCcw,
  SplitSquareHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatDateFR } from '../lib/formatters';
import { PatientImaging } from '../types/dental';

interface ImagingComparePanelProps {
  imagingList: PatientImaging[];
  initialLeftId?: string;
  initialRightId?: string;
}

type CompareMode = 'side-by-side' | 'split';

function computeIntervalLabel(dateA: string, dateB: string): string | null {
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const diffDays = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Même date';
  if (diffDays > 0) return `+${diffDays} j d'évolution`;
  return `${Math.abs(diffDays)} j d'écart (ordre inversé)`;
}

export const ImagingComparePanel: React.FC<ImagingComparePanelProps> = ({
  imagingList,
  initialLeftId,
  initialRightId,
}) => {
  const sortedImages = useMemo(
    () => [...imagingList].sort((a, b) => a.date.localeCompare(b.date)),
    [imagingList]
  );

  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');
  const [mode, setMode] = useState<CompareMode>('side-by-side');
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [zoom, setZoom] = useState<number>(1);
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [invertRadiograph, setInvertRadiograph] = useState<boolean>(false);
  const splitStageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>(false);

  useEffect(() => {
    if (sortedImages.length < 2) return;
    if (initialLeftId && sortedImages.some((i) => i.id === initialLeftId)) {
      setLeftId(initialLeftId);
    }
    if (initialRightId && sortedImages.some((i) => i.id === initialRightId)) {
      setRightId(initialRightId);
    }
  }, [initialLeftId, initialRightId, sortedImages]);

  const leftImage = useMemo(() => {
    if (sortedImages.length === 0) return null;
    return sortedImages.find((i) => i.id === leftId) || sortedImages[0];
  }, [sortedImages, leftId]);

  const rightImage = useMemo(() => {
    if (sortedImages.length === 0) return null;
    const candidate = sortedImages.find((i) => i.id === rightId);
    if (candidate) return candidate;
    if (sortedImages.length >= 2) {
      const last = sortedImages[sortedImages.length - 1];
      return last.id === leftImage?.id ? sortedImages[0] : last;
    }
    return sortedImages[0];
  }, [sortedImages, rightId, leftImage]);

  const handleSwap = () => {
    if (!leftImage || !rightImage) return;
    setLeftId(rightImage.id);
    setRightId(leftImage.id);
  };

  const handleResetFilters = () => {
    setZoom(1);
    setBrightness(100);
    setContrast(100);
    setInvertRadiograph(false);
    setSplitPercent(50);
  };

  const updateSplitFromClientX = (clientX: number) => {
    const el = splitStageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = Math.min(100, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * 100)));
    setSplitPercent(pct);
  };

  if (sortedImages.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Comparateur Radiographique & Suivi d'Évolution
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Importez au moins 2 radiographies ou clichés cliniques pour activer la comparaison côte à côte ou par superposition.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {sortedImages.length} / 2 clichés requis
          </span>
        </div>
      </div>
    );
  }

  const imageFilterStyle = {
    transform: `scale(${zoom})`,
    filter: `brightness(${brightness}%) contrast(${contrast}%) invert(${invertRadiograph ? 100 : 0}%)`,
  };

  const intervalLabel =
    leftImage && rightImage ? computeIntervalLabel(leftImage.date, rightImage.date) : null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
      {/* Header & Mode Switcher */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Comparateur Radiographique & Suivi d'Évolution
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Comparaison synchronisée de deux clichés pour le suivi thérapeutique</span>
            {intervalLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-medium text-[#1598C7] dark:text-sky-400 tabular-nums">
                  {intervalLabel}
                </span>
              </>
            )}
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Mode de comparaison des clichés"
          className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'side-by-side'}
            onClick={() => setMode('side-by-side')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'side-by-side'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Columns2 className="h-3.5 w-3.5" />
            <span>Côte à côte</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'split'}
            onClick={() => setMode('split')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'split'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
            <span>Superposition</span>
          </button>
        </div>
      </div>

      {/* Image Selectors & Synchronized Diagnostic Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 dark:border-slate-800 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="font-medium text-slate-600 dark:text-slate-300">Référence (A)</span>
            <select
              aria-label="Cliché de référence (A)"
              value={leftImage?.id || ''}
              onChange={(e) => setLeftId(e.target.value)}
              className="max-w-[220px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5"
            >
              {sortedImages.map((img) => (
                <option key={img.id} value={img.id}>
                  {formatDateFR(img.date)} · {img.title} ({img.category}
                  {img.toothRef ? ` #${img.toothRef}` : ''})
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={handleSwap}
            title="Inverser les deux clichés"
            aria-label="Inverser les deux clichés"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>

          <label className="flex items-center gap-1.5">
            <span className="font-medium text-slate-600 dark:text-slate-300">Suivi (B)</span>
            <select
              aria-label="Cliché de suivi (B)"
              value={rightImage?.id || ''}
              onChange={(e) => setRightId(e.target.value)}
              className="max-w-[220px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5"
            >
              {sortedImages.map((img) => (
                <option key={img.id} value={img.id}>
                  {formatDateFR(img.date)} · {img.title} ({img.category}
                  {img.toothRef ? ` #${img.toothRef}` : ''})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Luminosité</span>
            <input
              type="range"
              min={50}
              max={180}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="w-20"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Contraste</span>
            <input
              type="range"
              min={50}
              max={200}
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
              className="w-20"
            />
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              aria-label="Dézoomer la comparaison"
              title="Dézoomer"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
              aria-label="Zoomer la comparaison"
              title="Zoomer"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setInvertRadiograph((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              invertRadiograph
                ? 'border-[#163B63] dark:border-sky-500 bg-[#163B63] dark:bg-sky-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <Contrast className="h-3.5 w-3.5" />
            <span>Inversion</span>
          </button>

          <button
            type="button"
            onClick={handleResetFilters}
            title="Réinitialiser zoom et réglages"
            aria-label="Réinitialiser les réglages"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Réinitialiser</span>
          </button>
        </div>
      </div>

      {/* Comparison Stage */}
      {leftImage && rightImage && mode === 'side-by-side' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { tag: 'Cliché A (Référence)', item: leftImage },
            { tag: 'Cliché B (Suivi)', item: rightImage },
          ].map(({ tag, item }) => (
            <div key={`${tag}-${item.id}`} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {tag} : {item.title}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {item.category}
                  {item.toothRef ? ` · Dent #${item.toothRef}` : ''}
                  {' · '}
                  {formatDateFR(item.date)}
                </span>
              </div>
              <div className="flex h-72 items-center justify-center overflow-hidden rounded-lg bg-slate-950 border border-slate-800 p-2">
                <img
                  src={item.dataUrl}
                  alt={`${tag} - ${item.title}`}
                  referrerPolicy="no-referrer"
                  style={imageFilterStyle}
                  className="max-h-full max-w-full object-contain transition-transform duration-150 select-none"
                />
              </div>
              {item.notes && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Note : {item.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {leftImage && rightImage && mode === 'split' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-700 dark:text-slate-200 font-medium">
              Gauche (A) : {leftImage.title} · {formatDateFR(leftImage.date)}
            </span>
            <span className="text-slate-700 dark:text-slate-200 font-medium">
              Droite (B) : {rightImage.title} · {formatDateFR(rightImage.date)}
            </span>
          </div>

          <div
            ref={splitStageRef}
            onPointerDown={(e) => {
              draggingRef.current = true;
              updateSplitFromClientX(e.clientX);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) {
                updateSplitFromClientX(e.clientX);
              }
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
            onPointerLeave={() => {
              draggingRef.current = false;
            }}
            className="relative h-80 w-full overflow-hidden rounded-lg bg-slate-950 border border-slate-800 cursor-ew-resize select-none touch-none"
          >
            {/* Base layer: Cliché A */}
            <div className="absolute inset-0 flex items-center justify-center p-2 pointer-events-none">
              <img
                src={leftImage.dataUrl}
                alt={`Cliché A - ${leftImage.title}`}
                referrerPolicy="no-referrer"
                style={imageFilterStyle}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            {/* Clipped top layer: Cliché B */}
            <div
              className="absolute inset-0 flex items-center justify-center p-2 pointer-events-none"
              style={{ clipPath: `inset(0 0 0 ${splitPercent}%)` }}
            >
              <img
                src={rightImage.dataUrl}
                alt={`Cliché B - ${rightImage.title}`}
                referrerPolicy="no-referrer"
                style={imageFilterStyle}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            {/* Vertical Divider Handle */}
            <div
              className="absolute inset-y-0 w-0.5 bg-sky-400 shadow-[0_0_0_1px_rgba(15,23,42,0.7)] pointer-events-none"
              style={{ left: `${splitPercent}%` }}
            >
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#163B63] shadow-md border border-slate-200">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-mono tabular-nums whitespace-nowrap">
              Curseur de superposition : {splitPercent}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={splitPercent}
              onChange={(e) => setSplitPercent(Number(e.target.value))}
              className="flex-1"
            />
          </label>
        </div>
      )}
    </div>
  );
};
