import React, { useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { PWAInstallButton } from './PWAControls';
import { ThemeToggle } from './ThemeToggle';

export const LoginScreen: React.FC = () => {
  const {
    user,
    accessPending,
    authError,
    clearAuthError,
    signInWithGoogle,
    signInWithGoogleRedirect,
    refreshAuthAccess,
    logout,
  } = useClinic();
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isEmbeddedIframe =
    typeof window !== 'undefined' && window.self !== window.top;
  const currentHref =
    typeof window !== 'undefined' ? window.location.href : '#';
  const displayedError = localError || authError;

  const handleLogin = async () => {
    setLoading(true);
    setLocalError(null);
    clearAuthError();
    try {
      await signInWithGoogle();
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la connexion Google.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRedirectLogin = async () => {
    setLoading(true);
    setLocalError(null);
    clearAuthError();
    try {
      await signInWithGoogleRedirect();
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la redirection Google.'
      );
      setLoading(false);
    }
  };

  const handleRetryProfile = async () => {
    setRetrying(true);
    setLocalError(null);
    try {
      await refreshAuthAccess();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#EDF2F7] dark:bg-slate-950 flex flex-col justify-between p-6 transition-colors duration-200">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/logo_Dr_sara_50e1a027.png"
            alt="Cabinet Dentaire Dr. Sara Bchi"
            width={58}
            height={43}
            className="h-10 w-auto shrink-0 object-contain dark:invert"
          />
          <div>
            <span className="block font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">
              Cabinet Dentaire Dr. Sara Bchi
            </span>
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Chirurgien - Dentiste · Tél. <span className="font-mono tabular-nums">+212 532 101 351</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <PWAInstallButton variant="header" />
        </div>
      </header>

      <main className="mx-auto my-auto w-full max-w-md py-6">
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
          {accessPending && user ? (
            <div className="space-y-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <Lock className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Accès en attente d'autorisation
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Votre compte{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {user.email}
                </strong>{' '}
                est bien authentifié, mais n'a pas encore été ajouté à l'équipe du cabinet.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Connectez-vous avec le compte Titulaire administrateur ou demandez au Praticien Titulaire d'inviter votre adresse email dans <strong>Équipe & Rôles</strong>.
              </p>
              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={retrying}
                  onClick={handleRetryProfile}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#163B63] dark:bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 transition-colors"
                >
                  <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                  <span>{retrying ? 'Vérification...' : "Vérifier à nouveau l'accès"}</span>
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Changer de compte Google</span>
                </button>
              </div>
            </div>
          ) : user && displayedError ? (
            <div className="space-y-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                Impossible de charger votre profil
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Vous êtes connecté en tant que{' '}
                <strong className="text-slate-900 dark:text-slate-100">{user.email}</strong>,
                mais l'initialisation du dossier cabinet a échoué.
              </p>
              <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                {displayedError}
              </div>
              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={retrying}
                  onClick={handleRetryProfile}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#163B63] dark:bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 transition-colors"
                >
                  <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                  <span>{retrying ? 'Nouvelle tentative...' : 'Réessayer la connexion'}</span>
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Se déconnecter</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                  Cabinet Dentaire Dr. Sara Bchi
                </h1>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Connectez-vous pour accéder à l'agenda multi-fauteuils, aux dossiers patients 360°, à la facturation MAD et au mode hors ligne synchronisé.
                </p>
              </div>

              <div className="space-y-2.5 border-y border-slate-100 dark:border-slate-800 py-4 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
                  <span>Cloisonnement strict RBAC (Titulaire, Collaborateur, Secrétaire, Assistant)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <WifiOff className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
                  <span>Continuité d'activité hors ligne avec réplication automatique</span>
                </div>
              </div>

              {displayedError && (
                <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                  {displayedError}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleLogin}
                  className="flex w-full items-center justify-center gap-3 rounded-full bg-[#163B63] dark:bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 transition-colors shadow-sm"
                >
                  <span>{loading ? 'Connexion sécurisée...' : 'Se connecter avec Google'}</span>
                </button>

                {(displayedError || isEmbeddedIframe) && (
                  <div className="flex flex-col gap-2 pt-1">
                    {isEmbeddedIframe && (
                      <a
                        href={currentHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-4 py-2.5 text-xs font-semibold text-[#163B63] dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/70 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Ouvrir dans un nouvel onglet (recommandé si le popup est bloqué)</span>
                      </a>
                    )}
                    {displayedError && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={handleRedirectLogin}
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        <span>Essayer la connexion par redirection</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-5xl text-center text-xs text-slate-500 dark:text-slate-400 tabular-nums">
        Cabinet Dentaire Dr. Sara Bchi · Chirurgien - Dentiste · Lun–Ven 09h–13h / 15h–18h · Sam 09h–13h · Tél. +212 532 101 351
      </footer>
    </div>
  );
};
