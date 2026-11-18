import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  Download,
  WifiOff,
  RefreshCw,
  X,
  Monitor,
  Smartphone,
  Tablet,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  FolderArchive,
  Laptop,
  Puzzle,
  QrCode,
  AlertTriangle,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  downloadBrowserExtensionPackage,
  downloadMacAppPackage,
  downloadWindowsAppPackage,
} from '../lib/macInstaller';
import {
  applySWUpdate,
  dismissSWOfflineReady,
  dismissSWUpdatePrompt,
  getSWLifecycleState,
  subscribeSWLifecycle,
  SWLifecycleState,
} from '../lib/swUpdateStore';

interface DeploymentStatus {
  currentUrl: string;
  sharedUrl: string;
  isSharedLive: boolean;
  sharedHttpStatus: number | null;
}

export const PWAInstallButton: React.FC<{
  variant?: 'sidebar' | 'header';
  alwaysShow?: boolean;
  openModalOnClick?: boolean;
}> = ({ variant = 'header', alwaysShow = false, openModalOnClick = false }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, isMac, isInIframe, install } =
    usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [downloadingWin, setDownloadingWin] = useState(false);
  const [downloadingMac, setDownloadingMac] = useState(false);
  const [downloadingExt, setDownloadingExt] = useState(false);
  const [packageStatus, setPackageStatus] = useState<string | null>(null);
  const [targetUrlInput, setTargetUrlInput] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const [hasEditedUrl, setHasEditedUrl] = useState(false);
  const [deployStatus, setDeployStatus] = useState<DeploymentStatus | null>(null);
  const [checkingDeploy, setCheckingDeploy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const resolvedTargetUrl = useMemo(() => {
    const fallback = currentOrigin || 'https://dentaflow.local';
    const raw = targetUrlInput.trim();
    if (!raw) return fallback;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Invalid URL fallback
    }
    return fallback;
  }, [targetUrlInput, currentOrigin]);

  const isDevPreviewUrl = resolvedTargetUrl.includes('://ais-dev-');

  useEffect(() => {
    if (!showInstallGuide) return;
    let cancelled = false;
    setCheckingDeploy(true);
    void fetch('/api/deployment-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DeploymentStatus | null) => {
        if (cancelled || !data) return;
        setDeployStatus(data);
        if (!hasEditedUrl) {
          if (data.isSharedLive && data.sharedUrl) {
            setTargetUrlInput(data.sharedUrl);
          } else if (currentOrigin) {
            setTargetUrlInput(currentOrigin);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setDeployStatus(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingDeploy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showInstallGuide, hasEditedUrl, currentOrigin]);

  useEffect(() => {
    if (!showInstallGuide || !resolvedTargetUrl) return;
    let cancelled = false;
    void QRCode.toDataURL(resolvedTargetUrl, {
      width: 176,
      margin: 1,
      color: {
        dark: '#0B2239',
        light: '#FFFFFF',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [showInstallGuide, resolvedTargetUrl]);

  if (isInstalled) {
    if (!alwaysShow) return null;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Application installée</span>
      </span>
    );
  }

  const handleClick = async () => {
    if (!openModalOnClick && isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setPackageStatus(null);
    setShowInstallGuide(true);
  };

  const handleDirectPWAInstall = async () => {
    const accepted = await install();
    if (accepted) {
      setShowInstallGuide(false);
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(resolvedTargetUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleDownloadWindowsApp = async () => {
    setDownloadingWin(true);
    setPackageStatus(null);
    try {
      await downloadWindowsAppPackage(resolvedTargetUrl);
      setPackageStatus(
        'Paquet Windows Cabinet-Dr-Sara-Bchi-Windows.zip téléchargé ! Extrayez tout le ZIP (Clic droit → Extraire tout…) puis double-cliquez sur « Installer sur Windows.bat ».'
      );
    } catch {
      setPackageStatus('Impossible de générer le paquet Windows. Réessayez dans un instant.');
    } finally {
      setDownloadingWin(false);
    }
  };

  const handleDownloadMacApp = async () => {
    setDownloadingMac(true);
    setPackageStatus(null);
    try {
      await downloadMacAppPackage(resolvedTargetUrl);
      setPackageStatus(
        'Fichier Cabinet-Dr-Sara-Bchi-Mac.zip téléchargé ! Décompressez-le puis lancez « Installer sur Mac.command » (ou via Terminal si macOS bloque le fichier).'
      );
    } catch {
      setPackageStatus('Impossible de générer le paquet Mac. Réessayez dans un instant.');
    } finally {
      setDownloadingMac(false);
    }
  };

  const handleDownloadExtension = async () => {
    setDownloadingExt(true);
    setPackageStatus(null);
    try {
      await downloadBrowserExtensionPackage(resolvedTargetUrl);
      setPackageStatus(
        'Extension Cabinet-Dr-Sara-Bchi-Extension.zip téléchargée ! Décompressez-la puis chargez le dossier dans chrome://extensions ou edge://extensions.'
      );
    } catch {
      setPackageStatus("Impossible de générer l'extension navigateur. Réessayez dans un instant.");
    } finally {
      setDownloadingExt(false);
    }
  };

  const buttonLabel = isIOS && !isInstallable ? 'Installer (iOS)' : 'Installer Desktop / Mobile';
  const currentUrl = resolvedTargetUrl;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'sidebar'
            ? 'flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0'
            : 'flex items-center gap-1.5 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-3 py-1.5 text-xs font-medium text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className={variant === 'header' && !alwaysShow ? 'hidden 2xl:inline' : ''}>
          {buttonLabel}
        </span>
        {variant === 'header' && !alwaysShow && <span className="2xl:hidden">Installer</span>}
      </button>

      {showInstallGuide &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/75 p-3 sm:p-4 pt-safe pb-safe"
            onClick={() => setShowInstallGuide(false)}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Installer Gestion de cabinet dentaire Dr. Sara Bchi — iPhone, Android, Mac &amp; Windows
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Créez une application autonome avec icône sur le Bureau ou l’écran d’accueil, sans barre Chrome.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallGuide(false)}
                  aria-label="Fermer"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!checkingDeploy && deployStatus && !deployStatus.isSharedLive && currentOrigin.includes('://ais-dev-') && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 p-3.5 space-y-1.5 text-xs text-amber-950 dark:text-amber-100">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Application non encore publiée — étape requise pour Android, iPhone, Mac &amp; PC</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                    L’adresse publique partagée (<code>ais-pre-...</code>) répond actuellement <strong>404</strong> car l’application est en mode Aperçu privé (<code>ais-dev-...</code>).
                    Pour qu’elle s’ouvre librement sur <strong>Android</strong>, <strong>iPhone / iPad</strong> et sur n’importe quel <strong>Mac / PC Windows</strong> : cliquez sur <strong>Partager / Publier (Publish)</strong> pour activer l’adresse publique permanente, puis ouvrez ce nouveau lien sur mobile.
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-200">
                    En attendant, le lien ci-dessous pointe sur l’aperçu actif et fonctionne sur l’appareil déjà connecté à votre compte Google.
                  </p>
                </div>
              )}

              {!checkingDeploy && deployStatus?.isSharedLive && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-[11px] text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    Application publiée active : le lien ci-dessous fonctionne sur <strong>iPhone, Android, Mac et PC Windows</strong>.
                  </span>
                </div>
              )}

              {isInstallable && (
                <div className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50/90 dark:bg-emerald-950/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-emerald-950 dark:text-emerald-100 space-y-0.5">
                    <p className="font-semibold">
                      {isAndroid
                        ? 'Installation directe prête sur cet appareil Android'
                        : 'Installation directe prête sur cet appareil'}
                    </p>
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                      Installe l’application en fenêtre autonome (mode standalone, sans barre Chrome).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDirectPWAInstall}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Installer maintenant</span>
                  </button>
                </div>
              )}

              {/* URL de connexion cible pour les exports bureau & QR Code mobile */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-200">
                    Adresse du cabinet liée à l’icône Bureau &amp; au QR Code
                  </label>
                  {deployStatus?.isSharedLive && deployStatus.sharedUrl && targetUrlInput !== deployStatus.sharedUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setHasEditedUrl(false);
                        setTargetUrlInput(deployStatus.sharedUrl);
                      }}
                      className="text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap"
                    >
                      Utiliser l’URL publiée
                    </button>
                  )}
                </div>
                <input
                  type="url"
                  value={targetUrlInput}
                  onChange={(e) => {
                    setHasEditedUrl(true);
                    setTargetUrlInput(e.target.value);
                  }}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-mono text-[11px] text-slate-800 dark:text-slate-100"
                />
                {isDevPreviewUrl ? (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    Mode Aperçu privé actif : fonctionne sur la session navigateur courante. Publiez l’application pour disposer d’une adresse permanente sur iPhone et autres postes.
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Adresse autonome prête pour Windows, Mac, iPhone et Android.
                  </p>
                )}
              </div>

              {/* Direct Downloadable Windows + Mac App + Browser Extension */}
              <div
                className={`rounded-xl border p-4 space-y-3 ${
                  isMac || (!isIOS && !isAndroid)
                    ? 'border-sky-300 dark:border-sky-700 bg-sky-50/80 dark:bg-sky-950/35'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <Monitor className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>Installeurs Bureau 1-Clic — PC Windows &amp; Mac</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  Téléchargez le paquet adapté à votre ordinateur : un double-clic crée l’icône <strong>Dr. Sara Bchi</strong> sur votre Bureau et ouvre le logiciel en fenêtre dédiée, sans barre Chrome en haut.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={downloadingWin}
                    onClick={handleDownloadWindowsApp}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1598C7] hover:bg-[#1082AC] px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-60 transition-colors"
                  >
                    <Laptop className="h-4 w-4 shrink-0" />
                    <span>{downloadingWin ? 'Préparation...' : 'PC Windows (.zip)'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={downloadingMac}
                    onClick={handleDownloadMacApp}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-700 px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-600 disabled:opacity-60 transition-colors"
                  >
                    <FolderArchive className="h-4 w-4 shrink-0" />
                    <span>{downloadingMac ? 'Préparation...' : 'Mac (.zip)'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={downloadingExt}
                    onClick={handleDownloadExtension}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors"
                  >
                    <Puzzle className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>{downloadingExt ? 'Préparation...' : 'Extension (.zip)'}</span>
                  </button>
                </div>

                {packageStatus && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-[11px] text-emerald-900 dark:text-emerald-200 leading-relaxed">
                    {packageStatus}
                  </div>
                )}

                <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-300 space-y-1.5">
                  <p>
                    <strong>PC Windows 10/11 :</strong> faites clic droit → <strong>Extraire tout…</strong> sur <code>Cabinet-Dr-Sara-Bchi-Windows.zip</code>, puis double-cliquez sur <code>Installer sur Windows.bat</code>.
                  </p>
                  <p>
                    <strong>Mac (méthode 100 % Apple sans Chrome) :</strong> copiez le lien ci-dessous, ouvrez-le dans <strong>Safari</strong> puis cliquez en haut sur <strong>Fichier → Ajouter au Dock…</strong> (zéro Chrome même dans la barre des menus macOS).
                  </p>
                  <p>
                    <strong>Mac (paquet .app) :</strong> extrayez <code>Cabinet-Dr-Sara-Bchi-Mac.zip</code> puis ouvrez <code>Installer sur Mac.command</code> (si macOS le bloque, glissez-le dans Terminal après <code>bash </code>).
                  </p>
                </div>
              </div>

              {isInIframe && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <p className="leading-relaxed">
                    Vous êtes actuellement dans l’aperçu intégré. Ouvrez l’application dans un onglet navigateur normal pour activer le bouton d’installation directe du navigateur (Chrome, Edge ou Safari).
                  </p>
                  <a
                    href={resolvedTargetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Ouvrir dans un onglet autonome</span>
                  </a>
                </div>
              )}

              {/* Mobile Remote Tracking: QR Code + iOS & Android Instructions */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <QrCode className="h-4 w-4 text-[#1598C7] shrink-0" />
                  <span>Suivi à distance sur Portable (iOS &amp; Android)</span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {qrDataUrl && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white p-2.5 shrink-0 shadow-xs">
                      <img
                        src={qrDataUrl}
                        alt="QR Code d'installation mobile — Gestion de cabinet dentaire Dr. Sara Bchi"
                        width={136}
                        height={136}
                        className="h-32 w-32"
                      />
                    </div>
                  )}

                  <div className="space-y-2.5 flex-1 min-w-0">
                    <div
                      className={`rounded-lg border p-2.5 ${
                        isIOS
                          ? 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/30'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                        <Tablet className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        <span>iPhone &amp; iPad (iOS / iPadOS)</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        Scannez le QR Code avec l'appareil photo, ouvrez dans <strong>Safari</strong>, touchez <strong>Partager</strong> puis <strong>Sur l'écran d'accueil</strong>.
                      </p>
                    </div>

                    <div
                      className={`rounded-lg border p-2.5 ${
                        isAndroid
                          ? 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/30'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                        <Smartphone className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        <span>Android (Smartphone &amp; Tablette)</span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        Scannez le QR Code, ouvrez dans <strong>Chrome</strong> puis sélectionnez <strong>⋮ → Installer l'application</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  title={currentUrl}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Lien copié !</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copier le lien d'installation</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowInstallGuide(false)}
                  className="rounded-lg bg-slate-900 dark:bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-sky-500 transition-colors whitespace-nowrap"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export const SWUpdateNotification: React.FC = () => {
  const [swState, setSwState] = useState<SWLifecycleState>(() => getSWLifecycleState());

  useEffect(() => {
    return subscribeSWLifecycle(setSwState);
  }, []);

  const showUpdateCard = swState.needRefresh && !swState.dismissed;
  const showOfflineReady = swState.offlineReady && !showUpdateCard;

  if (!showUpdateCard && !showOfflineReady) return null;

  if (showUpdateCard) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-sm rounded-2xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 p-4 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/70 text-[#1598C7] dark:text-sky-400">
            <RefreshCw className={`h-4 w-4 ${swState.isUpdating ? 'animate-spin' : ''}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                Mise à jour disponible
              </p>
              <button
                type="button"
                onClick={dismissSWUpdatePrompt}
                disabled={swState.isUpdating}
                aria-label="Fermer la notification de mise à jour"
                className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              Une nouvelle version de l’application a été téléchargée en arrière-plan.
            </p>
            {swState.updateError && (
              <p className="mt-1.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                {swState.updateError}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={swState.isUpdating}
                onClick={() => void applySWUpdate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1598C7] hover:bg-[#1082AC] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw className={`h-3 w-3 ${swState.isUpdating ? 'animate-spin' : ''}`} />
                <span>{swState.isUpdating ? 'Actualisation...' : 'Rafraîchir maintenant'}</span>
              </button>
              <button
                type="button"
                disabled={swState.isUpdating}
                onClick={dismissSWUpdatePrompt}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Plus tard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/90 px-3.5 py-2 text-xs font-medium text-emerald-900 dark:text-emerald-200 shadow-md"
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <span>Application prête pour l’utilisation hors ligne</span>
      <button
        type="button"
        onClick={dismissSWOfflineReady}
        aria-label="Fermer"
        className="ml-1 rounded p-0.5 text-emerald-700/70 dark:text-emerald-300/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};

export const OfflineIndicator: React.FC<{ hasPendingSync?: boolean }> = ({ hasPendingSync }) => {
  const isOnline = useOnlineStatus();
  const [swState, setSwState] = useState<SWLifecycleState>(() => getSWLifecycleState());

  useEffect(() => {
    return subscribeSWLifecycle(setSwState);
  }, []);

  const hasSwNotice = (swState.needRefresh && !swState.dismissed) || swState.offlineReady;
  const hasNetworkNotice = !isOnline || Boolean(hasPendingSync);

  if (!hasSwNotice && !hasNetworkNotice) return null;

  return (
    <div className="no-print fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] lg:bottom-4 right-3 lg:right-4 z-40 flex flex-col items-end gap-2 max-w-[calc(100vw-1.5rem)] sm:max-w-[calc(100vw-2rem)]">
      <SWUpdateNotification />

      {hasNetworkNotice && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium shadow-md border ${
            !isOnline
              ? 'bg-amber-50 dark:bg-amber-950/90 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              : 'bg-sky-50 dark:bg-sky-950/90 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200'
          }`}
        >
          {!isOnline ? (
            <>
              <WifiOff className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
              <span>Mode hors ligne — Données locales actives, synchronisation automatique au retour du réseau</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700 dark:text-sky-400 shrink-0" />
              <span>Synchronisation multi-utilisateurs en cours...</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
