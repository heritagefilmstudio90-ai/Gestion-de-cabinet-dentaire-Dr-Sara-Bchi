import React, { useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
  WifiOff,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import firebaseConfig from '../../firebase-applet-config.json';
import { formatStaffDisplayLogin } from '../lib/authIdentifier';
import { ThemeToggle } from './ThemeToggle';
import { PWAInstallButton } from './PWAControls';

export const LoginScreen: React.FC = () => {
  const {
    user,
    accessPending,
    authError,
    clearAuthError,
    signInWithCredentials,
    sendPasswordReset,
    signInWithGoogle,
    signInWithGoogleRedirect,
    refreshAuthAccess,
    logout,
  } = useClinic();

  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  const isEmbeddedIframe =
    typeof window !== 'undefined' && window.self !== window.top;
  const currentHref =
    typeof window !== 'undefined' ? window.location.href : '#';
  const displayedError = localError || authError;

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingCredentials(true);
    setLocalError(null);
    setResetNotice(null);
    clearAuthError();
    try {
      await signInWithCredentials(loginInput, password);
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : 'Identifiant ou mot de passe incorrect.'
      );
    } finally {
      setLoadingCredentials(false);
    }
  };

  const handleForgotPassword = async () => {
    setLocalError(null);
    setResetNotice(null);
    clearAuthError();
    if (!loginInput.trim()) {
      setLocalError("Saisissez d'abord votre adresse email dans le champ Identifiant pour réinitialiser le mot de passe.");
      return;
    }
    setSendingReset(true);
    try {
      await sendPasswordReset(loginInput);
      setResetNotice(
        'Un email de réinitialisation du mot de passe vient de vous être envoyé.'
      );
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : 'Impossible d’envoyer la demande de réinitialisation.'
      );
    } finally {
      setSendingReset(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoadingGoogle(true);
    setLocalError(null);
    setResetNotice(null);
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
      setLoadingGoogle(false);
    }
  };

  const handleRedirectLogin = async () => {
    setLoadingGoogle(true);
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
      setLoadingGoogle(false);
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

  const pendingDisplayAccount = user
    ? formatStaffDisplayLogin({ email: user.email || '' })
    : '';

  return (
    <div className="min-h-dvh pt-safe pb-safe bg-[#EDF2F7] dark:bg-slate-950 flex flex-col justify-between p-4 sm:p-6 transition-colors duration-200">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <img
            src="/assets/cabinet/logo_Dr_sara_50e1a027.png"
            alt="Cabinet Dentaire Dr. Sara Bchi"
            width={58}
            height={43}
            className="h-9 sm:h-10 w-auto shrink-0 object-contain dark:invert"
          />
          <div className="min-w-0">
            <span className="block font-display text-sm sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-tight truncate">
              Cabinet Dentaire Dr. Sara Bchi
            </span>
            <span className="hidden sm:block text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Chirurgien - Dentiste · Tél. <span className="font-mono tabular-nums">+212 532 101 351</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton variant="header" openModalOnClick />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto my-auto w-full max-w-md py-4 sm:py-6">
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-8 shadow-sm">
          {accessPending && user ? (
            <div className="space-y-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <Lock className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {authError ? 'Accès suspendu ou non autorisé' : "Accès en attente d'autorisation"}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Le compte{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {pendingDisplayAccount}
                </strong>{' '}
                est authentifié, mais ne dispose pas d'un profil actif dans l'équipe du cabinet.
              </p>
              {displayedError && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                  {displayedError}
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Demandez au Praticien Titulaire d'activer ou de créer votre accès dans <strong>Équipe &amp; Rôles</strong>.
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
                  <span>Changer de compte</span>
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
                <strong className="text-slate-900 dark:text-slate-100">
                  {pendingDisplayAccount}
                </strong>
                , mais l'initialisation du dossier cabinet a échoué.
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
            <div className="space-y-5">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                  Connexion au cabinet
                </h1>
                <p className="mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Saisissez votre identifiant personnel et votre mot de passe créés pour le cabinet.
                </p>
              </div>

              <form onSubmit={handleCredentialsSubmit} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Identifiant (Login) ou Email
                  </label>
                  <div className="relative">
                    <UserIcon className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-identifier"
                      type="text"
                      required
                      autoComplete="username"
                      value={loginInput}
                      onChange={(e) => setLoginInput(e.target.value)}
                      placeholder="ex : dr.sara ou dr.amine@cabinet.ma"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      Mot de passe
                    </label>
                    <button
                      type="button"
                      disabled={sendingReset}
                      onClick={handleForgotPassword}
                      className="text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline disabled:opacity-60"
                    >
                      {sendingReset ? 'Envoi...' : 'Mot de passe oublié ?'}
                    </button>
                  </div>
                  <div className="relative">
                    <KeyRound className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Votre mot de passe"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-10 pr-10 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {displayedError && (
                  <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 leading-relaxed space-y-2">
                    <p>{displayedError}</p>
                    {displayedError.includes('console Firebase') && (
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 dark:bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-800 dark:hover:bg-red-500 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Activer dans Firebase Console</span>
                      </a>
                    )}
                  </div>
                )}

                {resetNotice && (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
                    {resetNotice}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loadingCredentials || loadingGoogle}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#163B63] dark:bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 transition-colors shadow-sm"
                >
                  <Lock className="h-4 w-4" />
                  <span>{loadingCredentials ? 'Connexion en cours...' : 'Se connecter'}</span>
                </button>
              </form>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="mx-3 shrink-0 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  ou
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={loadingGoogle || loadingCredentials}
                  onClick={handleGoogleLogin}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors"
                >
                  <span>{loadingGoogle ? 'Connexion Google...' : 'Continuer avec Google'}</span>
                </button>

                {(displayedError || isEmbeddedIframe) && (
                  <div className="flex flex-col gap-2 pt-1">
                    {isEmbeddedIframe && (
                      <a
                        href={currentHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 px-4 py-2 text-xs font-semibold text-[#163B63] dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950/70 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Ouvrir dans un nouvel onglet</span>
                      </a>
                    )}
                    {displayedError && (
                      <button
                        type="button"
                        disabled={loadingGoogle || loadingCredentials}
                        onClick={handleRedirectLogin}
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        <span>Essayer Google par redirection</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4 text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#1598C7] dark:text-sky-400 shrink-0" />
                  <span>Accès individuel sécurisé par rôle (Titulaire, Collaborateur, Secrétaire, Assistant)</span>
                </div>
                <div className="flex items-center gap-2">
                  <WifiOff className="h-3.5 w-3.5 text-[#1598C7] dark:text-sky-400 shrink-0" />
                  <span>Synchronisation temps réel et continuité hors ligne (PC, Mac, Android &amp; iOS)</span>
                </div>
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
