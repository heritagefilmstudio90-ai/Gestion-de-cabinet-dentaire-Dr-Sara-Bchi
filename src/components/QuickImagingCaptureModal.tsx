import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FolderOpen,
  RefreshCw,
  ScanLine,
  Upload,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { compressImageToDataUrl, generateSafeId, todayISO } from '../lib/formatters';
import { ImagingCategory, Patient, PatientImaging } from '../types/dental';

interface QuickImagingCaptureModalProps {
  patient: Patient;
  userUid: string;
  onClose: () => void;
  onCaptured?: (image: PatientImaging) => void;
  onOpenImagingTab?: () => void;
  onLogActivity: (detail: string) => void;
  onToast: (text: string, tone?: 'success' | 'error' | 'info') => void;
}

const IMAGING_CATEGORIES: ImagingCategory[] = [
  'Photo Avant',
  'Photo Après',
  'Rétro-alvéolaire',
  'Panoramique',
  'Téléradiographie',
  'Document',
];

async function blobOrCanvasToSafeDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  const maxDim = 1200;
  let targetCanvas = canvas;
  if (canvas.width > maxDim || canvas.height > maxDim) {
    const scale = Math.min(maxDim / canvas.width, maxDim / canvas.height);
    const resized = document.createElement('canvas');
    resized.width = Math.max(1, Math.round(canvas.width * scale));
    resized.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = resized.getContext('2d');
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
      targetCanvas = resized;
    }
  }
  let dataUrl = targetCanvas.toDataURL('image/jpeg', 0.82);
  if (dataUrl.length > 850000) {
    dataUrl = targetCanvas.toDataURL('image/jpeg', 0.64);
  }
  return dataUrl;
}

export const QuickImagingCaptureModal: React.FC<QuickImagingCaptureModalProps> = ({
  patient,
  userUid,
  onClose,
  onCaptured,
  onOpenImagingTab,
  onLogActivity,
  onToast,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);
  const scannerFileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<ImagingCategory>('Photo Avant');
  const [toothRef, setToothRef] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'unavailable'>('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);
  const [lastSavedThumb, setLastSavedThumb] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopStream();
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatus('unavailable');
        setCameraError(
          "Caméra directe non disponible dans ce navigateur. Utilisez « Caméra appareil » ou « Scanner / Fichier » ci-dessous."
        );
        return;
      }

      setCameraStatus('starting');
      setCameraError('');
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: mode }, width: { ideal: 1600 }, height: { ideal: 1200 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraStatus('ready');
      } catch {
        setCameraStatus('unavailable');
        setCameraError(
          "Accès caméra non autorisé ou aucune caméra détectée. Vous pouvez utiliser la caméra native, un scanner ou coller une image (Ctrl+V)."
        );
      }
    },
    [stopStream]
  );

  useEffect(() => {
    void startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [facingMode, startCamera, stopStream]);

  const attachDataUrlToPatient = useCallback(
    async (dataUrl: string, fallbackName?: string) => {
      if (dataUrl.length > 850000) {
        onToast('Image trop volumineuse après compression.', 'error');
        return;
      }
      setSaving(true);
      try {
        const nowTime = new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const cleanTitle = (
          title.trim() ||
          fallbackName ||
          `${category} (${nowTime})`
        ).slice(0, 145);
        const imgId = generateSafeId('img');
        const dateStr = todayISO();

        const payload = {
          patientId: patient.id,
          title: cleanTitle,
          category,
          toothRef: toothRef.trim().slice(0, 30),
          date: dateStr,
          dataUrl,
          notes: notes.trim().slice(0, 390),
          uploadedBy: userUid,
          createdAt: serverTimestamp(),
        };

        await setDoc(doc(db, 'patients', patient.id, 'imaging', imgId), payload);

        onCaptured?.({
          id: imgId,
          patientId: patient.id,
          title: cleanTitle,
          category,
          toothRef: toothRef.trim() || undefined,
          date: dateStr,
          dataUrl,
          notes: notes.trim() || undefined,
          uploadedBy: userUid,
        });

        onLogActivity(`${category} · ${cleanTitle}`);
        setCapturedCount((c) => c + 1);
        setLastSavedThumb(dataUrl);
        setTitle('');
        onToast('Image capturée et attachée au dossier patient.', 'success');
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `patients/${patient.id}/imaging`);
        onToast("Impossible d'enregistrer le cliché dans le dossier.", 'error');
      } finally {
        setSaving(false);
      }
    },
    [category, notes, onCaptured, onLogActivity, onToast, patient.id, title, toothRef, userUid]
  );

  const handleCaptureSnapshot = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      onToast('Flux vidéo en cours d’initialisation, patientez un instant.', 'info');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = await blobOrCanvasToSafeDataUrl(canvas);
    await attachDataUrlToPatient(dataUrl);
  };

  const handleFilePicked = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('Veuillez sélectionner un fichier image (JPEG, PNG, WebP...).', 'error');
      return;
    }
    try {
      const dataUrl = await compressImageToDataUrl(file, 1200, 0.8);
      const baseName = file.name ? file.name.replace(/\.[^.]+$/, '') : undefined;
      await attachDataUrlToPatient(dataUrl, baseName);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Erreur lecture image.', 'error');
    }
  };

  // Support Ctrl+V (copier-coller direct depuis logiciel radio/scanner)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            void handleFilePicked(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-4">
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] dark:text-sky-400 shrink-0">
              <Camera className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                Capture Imagerie — {patient.firstName} {patient.lastName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Caméra directe, scanner ou import instantané vers le dossier {patient.fileNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la capture imagerie"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Paramètres du cliché */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Catégorie
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ImagingCategory)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              >
                {IMAGING_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Dent réf. (FDI)
              </label>
              <input
                type="text"
                value={toothRef}
                onChange={(e) => setToothRef(e.target.value)}
                placeholder="Ex: 16, 21..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Libellé (optionnel)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Auto si vide"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
            </div>
          </div>

          {/* Zone Caméra en direct */}
          <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-contain ${
                cameraStatus === 'ready' ? 'block' : 'hidden'
              }`}
            />

            {cameraStatus === 'starting' && (
              <div className="text-center text-slate-300 p-6 space-y-2">
                <Camera className="h-7 w-7 mx-auto text-sky-400 animate-pulse" />
                <p className="text-xs font-medium">Activation de la caméra en cours...</p>
              </div>
            )}

            {cameraStatus === 'unavailable' && (
              <div className="text-center text-slate-300 p-6 max-w-md space-y-3">
                <ScanLine className="h-7 w-7 mx-auto text-sky-400" />
                <p className="text-xs leading-relaxed text-slate-300">{cameraError}</p>
                <button
                  type="button"
                  onClick={() => void startCamera(facingMode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Réessayer la caméra</span>
                </button>
              </div>
            )}

            {cameraStatus === 'ready' && (
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                title="Basculer caméra avant / arrière"
                className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-lg bg-slate-900/80 border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Changer caméra</span>
              </button>
            )}
          </div>

          {/* Notes optionnelles */}
          <div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Note clinique rapide (optionnel — ex: contrôle post-opératoire J+7)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
            />
          </div>

          {/* Inputs cachés pour Caméra appareil & Scanner/Fichier */}
          <input
            ref={nativeCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              void handleFilePicked(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />
          <input
            ref={scannerFileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              void handleFilePicked(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />

          {/* Actions de capture & import */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => nativeCameraInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
              >
                <Camera className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                <span>Caméra appareil</span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => scannerFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
              >
                <FolderOpen className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                <span>Scanner / Fichier</span>
              </button>
            </div>

            {cameraStatus === 'ready' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleCaptureSnapshot()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 shadow-xs"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{saving ? 'Enregistrement...' : 'Capturer & Attacher'}</span>
              </button>
            )}
          </div>

          {/* Confirmation des captures de la session */}
          {capturedCount > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {lastSavedThumb && (
                  <img
                    src={lastSavedThumb}
                    alt="Dernier cliché"
                    className="h-10 w-10 rounded-lg object-cover border border-emerald-200 dark:border-emerald-800 shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1 font-semibold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {capturedCount} cliché{capturedCount > 1 ? 's' : ''} attaché
                      {capturedCount > 1 ? 's' : ''} au dossier
                    </span>
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Vous pouvez continuer à capturer ou consulter l'onglet Imagerie.
                  </p>
                </div>
              </div>
              {onOpenImagingTab && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenImagingTab();
                    onClose();
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
                >
                  Voir l'imagerie
                </button>
              )}
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
            Astuce PC : vous pouvez aussi coller directement une capture depuis votre logiciel radio ou scanner avec Ctrl+V.
          </p>
        </div>
      </div>
    </div>
  );
};
