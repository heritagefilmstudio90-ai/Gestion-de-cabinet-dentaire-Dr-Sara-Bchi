import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FlipHorizontal2,
  FolderOpen,
  RefreshCw,
  ScanLine,
  SwitchCamera,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, OperationType, reportFirestoreListenerError } from '../lib/firebase';
import { generateSafeId, todayISO } from '../lib/formatters';
import { compressCanvasToSafeDataUrl, compressFileToSafeDataUrl } from '../lib/imageCompression';
import { ImagingCategory, Patient, PatientImaging } from '../types/dental';
import { ClinicalImageAnnotator } from './ClinicalImageAnnotator';

interface QuickImagingCaptureModalProps {
  patient: Patient;
  userUid: string;
  initialCategory?: ImagingCategory;
  initialToothRef?: string;
  initialImageToAnnotate?: PatientImaging | null;
  onEnsurePatientExists?: (patientId: string) => Promise<void>;
  onClose: () => void;
  onCaptured?: (image: PatientImaging) => void;
  onOpenImagingTab?: () => void;
  onLogActivity: (detail: string) => void;
  onToast: (text: string, tone?: 'success' | 'error' | 'info') => void;
}

const IMAGING_CATEGORIES: ImagingCategory[] = [
  'Photo Clinique',
  'Cliché Intra-oral',
  'Photo Avant',
  'Photo Après',
  'Rétro-alvéolaire',
  'Panoramique',
  'Téléradiographie',
  'Document',
];

const QUICK_PHOTO_PRESETS: ImagingCategory[] = [
  'Photo Clinique',
  'Cliché Intra-oral',
  'Photo Avant',
  'Photo Après',
];

export const QuickImagingCaptureModal: React.FC<QuickImagingCaptureModalProps> = ({
  patient,
  userUid,
  initialCategory = 'Photo Clinique',
  initialToothRef = '',
  initialImageToAnnotate = null,
  onEnsurePatientExists,
  onClose,
  onCaptured,
  onOpenImagingTab,
  onLogActivity,
  onToast,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const streamRequestIdRef = useRef(0);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);
  const scannerFileInputRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<ImagingCategory>(
    initialImageToAnnotate?.category || initialCategory
  );
  const [toothRef, setToothRef] = useState(
    initialImageToAnnotate?.toothRef || initialToothRef
  );
  const [title, setTitle] = useState(
    initialImageToAnnotate ? `${initialImageToAnnotate.title} (Annoté)` : ''
  );
  const [notes, setNotes] = useState(initialImageToAnnotate?.notes || '');

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [mirrorHorizontal, setMirrorHorizontal] = useState(false);

  const [cameraStatus, setCameraStatus] = useState<'starting' | 'ready' | 'unavailable'>('starting');
  const [cameraError, setCameraError] = useState<string>('');

  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(
    initialImageToAnnotate?.dataUrl || null
  );
  const [pendingFallbackName, setPendingFallbackName] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);
  const [lastSavedThumb, setLastSavedThumb] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRequestIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopStream();
    };
  }, [stopStream]);

  const refreshVideoDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!isMountedRef.current) return;
      const cams = devices.filter((d) => d.kind === 'videoinput');
      setVideoDevices(cams);
    } catch {
      // Ignore enumeration errors on restricted browsers
    }
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user', deviceId?: string) => {
      stopStream();
      const requestId = streamRequestIdRef.current;
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatus('unavailable');
        setCameraError(
          "Caméra en direct indisponible dans ce navigateur. Utilisez « Caméra mobile » ou « Fichier / Radio » ci-dessous."
        );
        return;
      }

      setCameraStatus('starting');
      setCameraError('');
      try {
        let stream: MediaStream;
        if (deviceId) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: mode },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
              audio: false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        }

        if (!isMountedRef.current || streamRequestIdRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        if (!isMountedRef.current || streamRequestIdRef.current !== requestId) {
          stopStream();
          return;
        }
        setCameraStatus('ready');
        void refreshVideoDevices();
      } catch {
        if (!isMountedRef.current || streamRequestIdRef.current !== requestId) return;
        setCameraStatus('unavailable');
        setCameraError(
          "Accès caméra refusé ou aucune caméra détectée. Vous pouvez ouvrir l'appareil photo natif, importer un fichier ou coller une capture (Ctrl+V)."
        );
      }
    },
    [refreshVideoDevices, stopStream]
  );

  // Start camera only while in live capture mode (no pending image to review/annotate)
  useEffect(() => {
    if (pendingImageDataUrl) {
      stopStream();
      return;
    }
    void startCamera(facingMode, selectedDeviceId || undefined);
    return () => {
      stopStream();
    };
  }, [facingMode, pendingImageDataUrl, selectedDeviceId, startCamera, stopStream]);

  const attachDataUrlToPatient = useCallback(
    async (dataUrl: string, hasAnnotations: boolean) => {
      if (dataUrl.length > 880000) {
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
          pendingFallbackName ||
          `${category}${hasAnnotations ? ' (Annoté)' : ''} (${nowTime})`
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

        if (onEnsurePatientExists) {
          await onEnsurePatientExists(patient.id);
        }

        await setDoc(doc(db, 'patients', patient.id, 'imaging', imgId), payload);

        onCaptured?.({
          id: imgId,
          patientId: patient.id,
          title: cleanTitle,
          category,
          toothRef: toothRef.trim().slice(0, 30) || undefined,
          date: dateStr,
          dataUrl,
          notes: notes.trim() || undefined,
          uploadedBy: userUid,
        });

        onLogActivity(`${category} · ${cleanTitle}${hasAnnotations ? ' [Annoté]' : ''}`);
        setCapturedCount((c) => c + 1);
        setLastSavedThumb(dataUrl);
        setTitle('');
        setPendingFallbackName(undefined);
        onToast(
          hasAnnotations
            ? 'Cliché annoté et enregistré dans le dossier patient.'
            : 'Cliché capturé et attaché au dossier patient.',
          'success'
        );

        if (initialImageToAnnotate) {
          onClose();
        } else {
          setPendingImageDataUrl(null);
        }
      } catch (err) {
        onToast("Impossible d'enregistrer le cliché dans le dossier.", 'error');
        reportFirestoreListenerError(err, OperationType.CREATE, `patients/${patient.id}/imaging`);
      } finally {
        setSaving(false);
      }
    },
    [
      category,
      initialImageToAnnotate,
      notes,
      onCaptured,
      onClose,
      onEnsurePatientExists,
      onLogActivity,
      onToast,
      patient.id,
      pendingFallbackName,
      title,
      toothRef,
      userUid,
    ]
  );

  const handleCaptureSnapshot = async () => {
    if (saving) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      onToast("Flux vidéo en cours d'initialisation, patientez un instant.", 'info');
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (mirrorHorizontal) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = await compressCanvasToSafeDataUrl(canvas, 1400, 840000);
      setPendingFallbackName(undefined);
      setPendingImageDataUrl(dataUrl);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Erreur lors de la capture d'image.", 'error');
    }
  };

  const handleFilePicked = useCallback(
    async (file: File | undefined | null) => {
      if (!file || saving) return;
      if (!file.type.startsWith('image/')) {
        onToast('Veuillez sélectionner un fichier image (JPEG, PNG, WebP...).', 'error');
        return;
      }
      try {
        const dataUrl = await compressFileToSafeDataUrl(file, 1400, 840000);
        const baseName = file.name ? file.name.replace(/\.[^.]+$/, '') : undefined;
        setPendingFallbackName(baseName);
        setPendingImageDataUrl(dataUrl);
      } catch (error) {
        onToast(error instanceof Error ? error.message : 'Erreur lecture image.', 'error');
      }
    },
    [onToast, saving]
  );

  // Support Ctrl+V (copier-coller direct depuis logiciel radio/scanner)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (saving) return;
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
  }, [handleFilePicked, saving]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/65 dark:bg-slate-950/85 p-0 sm:p-4 pt-safe pb-safe">
      <div className="w-full max-w-3xl rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[95dvh]">
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 sm:px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] dark:text-sky-400 shrink-0">
              <Camera className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {pendingImageDataUrl
                  ? `Aperçu & Annotation — ${patient.firstName} ${patient.lastName}`
                  : `Caméra Clinique & Intra-orale — ${patient.firstName} ${patient.lastName}`}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {pendingImageDataUrl
                  ? 'Annotez directement sur le cliché (crayon, flèche, cercle, texte) ou enregistrez tel quel'
                  : `Capture photo clinique, caméra intra-orale ou scanner — Dossier ${patient.fileNumber}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopStream();
              onClose();
            }}
            aria-label="Fermer la capture imagerie"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Corps scrollable */}
        <div className="p-4 sm:p-5 space-y-3.5 text-xs overflow-y-auto overscroll-contain">
          {/* Raccourcis rapides Photo Clinique / Cliché Intra-oral */}
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_PHOTO_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCategory(preset)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors min-h-[34px] ${
                  category === preset
                    ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Paramètres du cliché */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Catégorie
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ImagingCategory)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 min-h-[40px]"
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
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono min-h-[40px]"
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
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 min-h-[40px]"
              />
            </div>
          </div>

          {/* Étape 2 : Prévisualisation & Annotation si une image est capturée / importée */}
          {pendingImageDataUrl ? (
            <>
              <div>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Note clinique rapide (optionnel — ex: contrôle post-opératoire J+7, carie mésiale)"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs min-h-[40px]"
                />
              </div>

              <ClinicalImageAnnotator
                imageDataUrl={pendingImageDataUrl}
                saving={saving}
                retakeLabel={initialImageToAnnotate ? 'Ouvrir la caméra' : 'Reprendre la photo'}
                onRetake={() => {
                  setPendingImageDataUrl(null);
                  setPendingFallbackName(undefined);
                }}
                onSave={({ dataUrl, hasAnnotations }) =>
                  attachDataUrlToPatient(dataUrl, hasAnnotations)
                }
              />
            </>
          ) : (
            /* Étape 1 : Viseur Caméra en direct */
            <>
              <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden aspect-[4/3] sm:aspect-video flex items-center justify-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={mirrorHorizontal ? { transform: 'scaleX(-1)' } : undefined}
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
                  <div className="text-center text-slate-300 p-5 max-w-md space-y-3">
                    <ScanLine className="h-7 w-7 mx-auto text-sky-400" />
                    <p className="text-xs leading-relaxed text-slate-300">{cameraError}</p>
                    <button
                      type="button"
                      onClick={() => void startCamera(facingMode, selectedDeviceId || undefined)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 min-h-[40px]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Réessayer la caméra</span>
                    </button>
                  </div>
                )}

                {cameraStatus === 'ready' && (
                  <div className="absolute top-2.5 right-2.5 left-2.5 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
                    <div className="flex items-center gap-1.5 pointer-events-auto">
                      {videoDevices.length > 1 && (
                        <select
                          aria-label="Choisir la caméra"
                          value={selectedDeviceId}
                          onChange={(e) => setSelectedDeviceId(e.target.value)}
                          className="max-w-[180px] rounded-lg bg-slate-900/85 border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-white"
                        >
                          <option value="">Caméra auto ({facingMode === 'environment' ? 'Arrière' : 'Avant'})</option>
                          {videoDevices.map((dev, idx) => (
                            <option key={dev.deviceId} value={dev.deviceId}>
                              {dev.label || `Caméra ${idx + 1}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 pointer-events-auto">
                      <button
                        type="button"
                        onClick={() => setMirrorHorizontal((v) => !v)}
                        title="Inverser horizontalement (miroir intra-oral)"
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                          mirrorHorizontal
                            ? 'bg-sky-600 border-sky-500 text-white'
                            : 'bg-slate-900/80 border-slate-700 text-white hover:bg-slate-800'
                        }`}
                      >
                        <FlipHorizontal2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Miroir</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDeviceId('');
                          setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
                        }}
                        title="Basculer caméra avant / arrière"
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900/80 border border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
                      >
                        <SwitchCamera className="h-3.5 w-3.5" />
                        <span>{facingMode === 'environment' ? 'Caméra avant' : 'Caméra arrière'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes optionnelles */}
              <div>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Note clinique rapide (optionnel — ex: contrôle post-opératoire J+7)"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs min-h-[40px]"
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
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => nativeCameraInputRef.current?.click()}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 min-h-[42px]"
                  >
                    <Camera className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                    <span>Caméra mobile</span>
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => scannerFileInputRef.current?.click()}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 min-h-[42px]"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                    <span>Fichier / Radio</span>
                  </button>
                </div>

                {cameraStatus === 'ready' && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleCaptureSnapshot()}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-5 py-2.5 font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 shadow-xs min-h-[44px]"
                  >
                    <Camera className="h-4 w-4" />
                    <span>Prendre la photo</span>
                  </button>
                )}
              </div>
            </>
          )}

          {/* Confirmation des captures de la session */}
          {capturedCount > 0 && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 flex flex-wrap items-center justify-between gap-3">
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
                      {capturedCount} cliché{capturedCount > 1 ? 's' : ''} enregistré
                      {capturedCount > 1 ? 's' : ''} au dossier
                    </span>
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Vous pouvez prendre une autre photo ou consulter l'onglet Imagerie.
                  </p>
                </div>
              </div>
              {onOpenImagingTab && (
                <button
                  type="button"
                  onClick={() => {
                    stopStream();
                    onOpenImagingTab();
                    onClose();
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-medium text-white hover:bg-emerald-700 whitespace-nowrap shrink-0 min-h-[36px]"
                >
                  Voir l'imagerie
                </button>
              )}
            </div>
          )}

          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
            Astuce PC : vous pouvez aussi coller une image avec Ctrl+V pour l'annoter et l'ajouter au dossier.
          </p>
        </div>
      </div>
    </div>
  );
};
