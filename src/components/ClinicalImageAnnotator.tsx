import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Camera,
  Check,
  Circle,
  Eraser,
  Pencil,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { compressCanvasToSafeDataUrl, loadHtmlImage } from '../lib/imageCompression';

export type AnnotationTool = 'pen' | 'arrow' | 'circle' | 'rect' | 'text';

interface NormalizedPoint {
  x: number;
  y: number;
}

type AnnotationShape =
  | {
      id: string;
      type: 'pen';
      color: string;
      strokeScale: number;
      points: NormalizedPoint[];
    }
  | {
      id: string;
      type: 'arrow' | 'circle' | 'rect';
      color: string;
      strokeScale: number;
      start: NormalizedPoint;
      end: NormalizedPoint;
    }
  | {
      id: string;
      type: 'text';
      color: string;
      strokeScale: number;
      position: NormalizedPoint;
      text: string;
    };

const ANNOTATION_COLORS = [
  { label: 'Rouge clinique', value: '#EF4444' },
  { label: 'Ambre', value: '#F59E0B' },
  { label: 'Bleu médical', value: '#0EA5E9' },
  { label: 'Vert émeraude', value: '#10B981' },
  { label: 'Blanc', value: '#FFFFFF' },
];

const STROKE_WIDTHS = [
  { label: 'Fin', scale: 0.75 },
  { label: 'Moyen', scale: 1.3 },
  { label: 'Épais', scale: 2.1 },
];

function drawAnnotationShape(
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape,
  width: number,
  height: number
) {
  const baseUnit = Math.max(2, Math.min(width, height) * 0.0045);
  const lineWidth = Math.max(2, baseUnit * shape.strokeScale);

  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (shape.type === 'pen') {
    if (shape.points.length === 1) {
      const p = shape.points[0];
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, lineWidth * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x * width, shape.points[0].y * height);
      for (let i = 1; i < shape.points.length; i += 1) {
        ctx.lineTo(shape.points[i].x * width, shape.points[i].y * height);
      }
      ctx.stroke();
    }
  } else if (shape.type === 'arrow') {
    const x1 = shape.start.x * width;
    const y1 = shape.start.y * height;
    const x2 = shape.end.x * width;
    const y2 = shape.end.y * height;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len >= 2) {
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(lineWidth * 3.8, Math.min(len * 0.35, lineWidth * 6));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }
  } else if (shape.type === 'circle') {
    const x1 = shape.start.x * width;
    const y1 = shape.start.y * height;
    const x2 = shape.end.x * width;
    const y2 = shape.end.y * height;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.max(2, Math.abs(x2 - x1) / 2);
    const ry = Math.max(2, Math.abs(y2 - y1) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.type === 'rect') {
    const x = Math.min(shape.start.x, shape.end.x) * width;
    const y = Math.min(shape.start.y, shape.end.y) * height;
    const w = Math.abs(shape.end.x - shape.start.x) * width;
    const h = Math.abs(shape.end.y - shape.start.y) * height;
    ctx.strokeRect(x, y, w, h);
  } else if (shape.type === 'text') {
    const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.028 * Math.max(0.85, shape.strokeScale * 0.85)));
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'top';
    const paddingX = Math.round(fontSize * 0.45);
    const paddingY = Math.round(fontSize * 0.25);
    const metrics = ctx.measureText(shape.text);
    const boxW = metrics.width + paddingX * 2;
    const boxH = fontSize + paddingY * 2;

    const rawX = shape.position.x * width;
    const rawY = shape.position.y * height;
    const x = Math.max(4, Math.min(width - boxW - 4, rawX));
    const y = Math.max(4, Math.min(height - boxH - 4, rawY));

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, boxW, boxH, Math.max(4, Math.round(fontSize * 0.28)));
    } else {
      ctx.rect(x, y, boxW, boxH);
    }
    ctx.fill();

    ctx.strokeStyle = shape.color;
    ctx.lineWidth = Math.max(1.5, lineWidth * 0.45);
    ctx.stroke();

    ctx.fillStyle = shape.color;
    ctx.fillText(shape.text, x + paddingX, y + paddingY);
  }

  ctx.restore();
}

interface ClinicalImageAnnotatorProps {
  imageDataUrl: string;
  saving?: boolean;
  onRetake?: () => void;
  onSave: (result: { dataUrl: string; hasAnnotations: boolean; annotationCount: number }) => Promise<void> | void;
  retakeLabel?: string;
}

export const ClinicalImageAnnotator: React.FC<ClinicalImageAnnotatorProps> = ({
  imageDataUrl,
  saving = false,
  onRetake,
  onSave,
  retakeLabel = 'Reprendre la photo',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const [imageReady, setImageReady] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 1200, height: 900 });
  const [annotatingEnabled, setAnnotatingEnabled] = useState(true);
  const [tool, setTool] = useState<AnnotationTool>('pen');
  const [color, setColor] = useState<string>('#EF4444');
  const [strokeScale, setStrokeScale] = useState<number>(1.3);
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);

  // Inline text placement without window.prompt
  const [pendingTextPoint, setPendingTextPoint] = useState<NormalizedPoint | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImageReady(false);
    setShapes([]);
    setDraftShape(null);
    setPendingTextPoint(null);
    setPendingTextValue('');

    loadHtmlImage(imageDataUrl)
      .then((img) => {
        if (cancelled) return;
        loadedImageRef.current = img;
        setImageDimensions({
          width: Math.max(1, img.naturalWidth || img.width),
          height: Math.max(1, img.naturalHeight || img.height),
        });
        setImageReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          loadedImageRef.current = null;
          setImageReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageDataUrl]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = loadedImageRef.current;
    if (!canvas || !img || !imageReady) return;

    const w = imageDimensions.width;
    const h = imageDimensions.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    for (const shape of shapes) {
      drawAnnotationShape(ctx, shape, w, h);
    }
    if (draftShape) {
      drawAnnotationShape(ctx, draftShape, w, h);
    }

    if (pendingTextPoint) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.004);
      ctx.beginPath();
      ctx.arc(
        pendingTextPoint.x * w,
        pendingTextPoint.y * h,
        Math.max(5, Math.min(w, h) * 0.009),
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [color, draftShape, imageDimensions.height, imageDimensions.width, imageReady, pendingTextPoint, shapes]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!annotatingEnabled || saving || exporting || !imageReady) return;
    e.preventDefault();
    const point = getNormalizedPoint(e);

    if (tool === 'text') {
      setPendingTextPoint(point);
      setPendingTextValue('');
      return;
    }

    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }

    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (tool === 'pen') {
      setDraftShape({
        id,
        type: 'pen',
        color,
        strokeScale,
        points: [point],
      });
    } else {
      setDraftShape({
        id,
        type: tool,
        color,
        strokeScale,
        start: point,
        end: point,
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draftShape || activePointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    const point = getNormalizedPoint(e);
    if (draftShape.type === 'pen') {
      setDraftShape((prev) =>
        prev && prev.type === 'pen'
          ? { ...prev, points: [...prev.points, point] }
          : prev
      );
    } else {
      setDraftShape((prev) =>
        prev && prev.type !== 'pen' && prev.type !== 'text'
          ? { ...prev, end: point }
          : prev
      );
    }
  };

  const commitDraftShape = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draftShape || activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }

    const valid =
      draftShape.type === 'pen'
        ? draftShape.points.length >= 1
        : draftShape.type !== 'text'
        ? Math.hypot(draftShape.end.x - draftShape.start.x, draftShape.end.y - draftShape.start.y) > 0.008
        : false;

    if (valid) {
      setShapes((prev) => [...prev, draftShape]);
    }
    setDraftShape(null);
  };

  const handleConfirmTextAnnotation = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = pendingTextValue.trim();
    if (!pendingTextPoint || !trimmed) {
      setPendingTextPoint(null);
      setPendingTextValue('');
      return;
    }
    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setShapes((prev) => [
      ...prev,
      {
        id,
        type: 'text',
        color,
        strokeScale,
        position: pendingTextPoint,
        text: trimmed.slice(0, 60),
      },
    ]);
    setPendingTextPoint(null);
    setPendingTextValue('');
  };

  const handleSaveComposite = async (includeAnnotations: boolean) => {
    if (saving || exporting) return;
    const img = loadedImageRef.current;
    if (!img) {
      await onSave({ dataUrl: imageDataUrl, hasAnnotations: false, annotationCount: 0 });
      return;
    }

    if (!includeAnnotations || shapes.length === 0) {
      await onSave({ dataUrl: imageDataUrl, hasAnnotations: false, annotationCount: 0 });
      return;
    }

    setExporting(true);
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = imageDimensions.width;
      offscreen.height = imageDimensions.height;
      const ctx = offscreen.getContext('2d');
      if (!ctx) throw new Error('Contexte graphique indisponible.');
      ctx.drawImage(img, 0, 0, offscreen.width, offscreen.height);
      for (const shape of shapes) {
        drawAnnotationShape(ctx, shape, offscreen.width, offscreen.height);
      }
      const compressed = await compressCanvasToSafeDataUrl(offscreen, 1400, 840000);
      await onSave({
        dataUrl: compressed,
        hasAnnotations: true,
        annotationCount: shapes.length,
      });
    } finally {
      setExporting(false);
    }
  };

  const isBusy = saving || exporting;

  return (
    <div className="space-y-3">
      {/* Barre d'outils d'annotation */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-2.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setAnnotatingEnabled((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors min-h-[36px] ${
                annotatingEnabled
                  ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>{annotatingEnabled ? 'Annotation active' : 'Activer annotation'}</span>
            </button>

            {annotatingEnabled && (
              <>
                {(
                  [
                    { id: 'pen', label: 'Crayon', icon: Pencil },
                    { id: 'arrow', label: 'Flèche', icon: ArrowUpRight },
                    { id: 'circle', label: 'Cercle', icon: Circle },
                    { id: 'rect', label: 'Cadre', icon: Square },
                    { id: 'text', label: 'Texte', icon: Type },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTool(id);
                      if (id !== 'text') {
                        setPendingTextPoint(null);
                      }
                    }}
                    title={label}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors min-h-[36px] ${
                      tool === id
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Undo / Clear */}
          {annotatingEnabled && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={shapes.length === 0 || isBusy}
                onClick={() => setShapes((prev) => prev.slice(0, -1))}
                title="Annuler la dernière annotation"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-45 min-h-[36px]"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Annuler</span>
              </button>
              <button
                type="button"
                disabled={shapes.length === 0 || isBusy}
                onClick={() => {
                  setShapes([]);
                  setPendingTextPoint(null);
                }}
                title="Effacer toutes les annotations"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-45 min-h-[36px]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Effacer</span>
              </button>
            </div>
          )}
        </div>

        {/* Palette couleur & épaisseur */}
        {annotatingEnabled && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 dark:border-slate-700/70 pt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                Couleur :
              </span>
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  onClick={() => setColor(c.value)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    color === c.value
                      ? 'border-slate-900 dark:border-white scale-110'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                Trait :
              </span>
              {STROKE_WIDTHS.map((sw) => (
                <button
                  key={sw.label}
                  type="button"
                  onClick={() => setStrokeScale(sw.scale)}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    strokeScale === sw.scale
                      ? 'bg-slate-900 dark:bg-sky-600 text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {sw.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Saisie de texte en ligne (sans window.prompt) */}
        {pendingTextPoint && (
          <form
            onSubmit={handleConfirmTextAnnotation}
            className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 dark:border-slate-700/70 pt-2"
          >
            <input
              type="text"
              autoFocus
              maxLength={60}
              value={pendingTextValue}
              onChange={(e) => setPendingTextValue(e.target.value)}
              placeholder="Note sur le cliché (ex: Carie 16, Fissure mésiale)..."
              className="flex-1 min-w-[180px] rounded-lg border border-sky-400 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Placer</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingTextPoint(null);
                setPendingTextValue('');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>

      {/* Zone de dessin interactive */}
      <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden flex items-center justify-center min-h-[220px] max-h-[52dvh]">
        {imageReady ? (
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={commitDraftShape}
            onPointerCancel={commitDraftShape}
            className={`max-h-[52dvh] max-w-full w-auto h-auto object-contain select-none ${
              annotatingEnabled ? 'touch-none cursor-crosshair' : 'cursor-default'
            }`}
          />
        ) : (
          <div className="p-8 text-xs text-slate-400">Préparation de l'image...</div>
        )}

        {annotatingEnabled && imageReady && shapes.length === 0 && !pendingTextPoint && (
          <div className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-lg bg-slate-900/80 px-3 py-1 text-[11px] text-slate-200 whitespace-nowrap border border-slate-700/70">
            {tool === 'text'
              ? 'Touchez ou cliquez sur la zone à légender'
              : 'Dessinez directement sur le cliché (doigt ou souris)'}
          </div>
        )}
      </div>

      {/* Actions de sauvegarde */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {onRetake && (
            <button
              type="button"
              disabled={isBusy}
              onClick={onRetake}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 min-h-[40px]"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>{retakeLabel}</span>
            </button>
          )}
          {shapes.length > 0 && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleSaveComposite(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 min-h-[40px]"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span>Enregistrer sans annotation</span>
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={isBusy || !imageReady}
          onClick={() => void handleSaveComposite(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 shadow-xs min-h-[40px]"
        >
          <Check className="h-3.5 w-3.5" />
          <span>
            {isBusy
              ? 'Enregistrement...'
              : shapes.length > 0
              ? `Enregistrer avec ${shapes.length} annotation${shapes.length > 1 ? 's' : ''}`
              : 'Enregistrer dans le dossier'}
          </span>
        </button>
      </div>
    </div>
  );
};
