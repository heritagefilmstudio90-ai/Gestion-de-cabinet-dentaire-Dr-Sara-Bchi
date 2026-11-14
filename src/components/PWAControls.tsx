import React, { useState } from 'react';
import { createPortal } from 'react-dom';
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
  Puzzle,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  downloadBrowserExtensionPackage,
  downloadMacAppPackage,
} from '../lib/macInstaller';

export const PWAInstallButton: React.FC<{
  variant?: 'sidebar' | 'header';
  alwaysShow?: boolean;
}> = ({ variant = 'header', alwaysShow = false }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, isMac, isInIframe, install } =
    usePWAInstall();
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [downloadingMac, setDownloadingMac] = useState(false);
  const [downloadingExt, setDownloadingExt] = useState(false);
  const [packageStatus, setPackageStatus] = useState<string | null>(null);

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
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setPackageStatus(null);
    setShowInstallGuide(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleDownloadMacApp = async () => {
    setDownloadingMac(true);
    setPackageStatus(null);
    try {
      await downloadMacAppPackage(window.location.origin);
      setPackageStatus(
        "Fichier DentaFlow-Pro-Mac.zip téléchargé ! Décompressez-le puis double-cliquez sur « Installer sur Mac.command » (ou Clic droit → Ouvrir)."
      );
    } catch {
      setPackageStatus("Impossible de générer le paquet Mac. Réessayez dans un instant.");
    } finally {
      setDownloadingMac(false);
    }
  };

  const handleDownloadExtension = async () => {
    setDownloadingExt(true);
    setPackageStatus(null);
    try {
      await downloadBrowserExtensionPackage(window.location.origin);
      setPackageStatus(
        "Extension DentaFlow-Pro-Extension.zip téléchargée ! Décompressez-la puis chargez le dossier dans chrome://extensions (Mode développeur)."
      );
    } catch {
      setPackageStatus("Impossible de générer l'extension navigateur. Réessayez dans un instant.");
    } finally {
      setDownloadingExt(false);
    }
  };

  const buttonLabel = isIOS && !isInstallable ? 'Installer (iOS)' : "Installer l'app";
  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '/';

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
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/75 p-4"
            onClick={() => setShowInstallGuide(false)}
          >
            <div
              className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Installer DentaFlow Pro sur Mac, PC &amp; Mobile
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Application autonome en fenêtre dédiée, même hors ligne, avec le logo du cabinet.
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

              {/* Direct Downloadable Mac App + Browser Extension */}
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
                    <span>Installation directe sur Mac (hors lien navigateur)</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  Téléchargez directement le paquet Mac avec l'icône <strong>Dr. Sara Bchi</strong> à cliquer et placer dans <strong>Applications</strong>, ou téléchargez l'extension Chrome/Edge pour lancer le logiciel en 1 clic depuis votre barre d'outils.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={downloadingMac}
                    onClick={handleDownloadMacApp}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 transition-colors"
                  >
                    <FolderArchive className="h-4 w-4 shrink-0" />
                    <span>
                      {downloadingMac ? 'Préparation...' : 'Télécharger App Mac (.zip)'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={downloadingExt}
                    onClick={handleDownloadExtension}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors"
                  >
                    <Puzzle className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>
                      {downloadingExt ? 'Préparation...' : 'Extension Chrome / Edge (.zip)'}
                    </span>
                  </button>
                </div>

                {packageStatus && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2 text-[11px] text-emerald-900 dark:text-emerald-200 leading-relaxed">
                    {packageStatus}
                  </div>
                )}

                <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                  <p>
                    <strong>Pour l'App Mac (.zip) :</strong> décompressez le ZIP puis faites <strong>Clic droit → Ouvrir</strong> sur <code>Installer sur Mac.command</code> (ou glissez <code>DentaFlow Pro.app</code> dans <strong>Applications</strong>).
                  </p>
                  <p>
                    <strong>Pour Safari Mac (natif) :</strong> ouvrez l'application dans un onglet Safari puis cliquez sur <strong>Fichier → Ajouter au Dock…</strong>
                  </p>
                </div>
              </div>

              {isInIframe && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <p className="leading-relaxed">
                    L'application est actuellement ouverte dans un aperçu intégré. Vous pouvez aussi l'ouvrir dans un onglet navigateur autonome pour l'installation native Safari / Chrome.
                  </p>
                  <a
                    href={typeof window !== 'undefined' ? window.location.href : '/'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Ouvrir dans un nouvel onglet</span>
                  </a>
                </div>
              )}

              <div className="space-y-2.5 text-xs">
                <div
                  className={`rounded-xl border p-3.5 ${
                    isAndroid
                      ? 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Smartphone className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>Tablette &amp; Smartphone Android / Windows PC</span>
                  </div>
                  <p className="mt-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
                    Ouvrez dans <strong>Chrome</strong> ou <strong>Edge</strong>, puis sélectionnez <strong>⋮ → Installer l'application</strong> (ou <strong>Ajouter à l'écran d'accueil</strong>).
                  </p>
                </div>

                <div
                  className={`rounded-xl border p-3.5 ${
                    isIOS
                      ? 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Tablet className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                    <span>iPhone &amp; iPad (iOS / iPadOS)</span>
                  </div>
                  <p className="mt-1.5 text-slate-600 dark:text-slate-300 leading-relaxed">
                    Ouvrez dans <strong>Safari</strong>, appuyez sur le bouton <strong>Partager</strong> (carré avec une flèche vers le haut), puis sélectionnez <strong>Sur l'écran d'accueil</strong>.
                  </p>
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

export const OfflineIndicator: React.FC<{ hasPendingSync?: boolean }> = ({ hasPendingSync }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && !hasPendingSync) return null;

  return (
    <div
      className={`no-print fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium shadow-md border ${
        !isOnline
          ? 'bg-amber-50 dark:bg-amber-950/90 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          : 'bg-sky-50 dark:bg-sky-950/90 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200'
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
          <span>Mode hors ligne — Données locales actives, synchronisation automatique au retour du réseau</span>
        </>
      ) : (
        <>
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700 dark:text-sky-400" />
          <span>Synchronisation multi-utilisateurs en cours...</span>
        </>
      )}
    </div>
  );
};
