import React from 'react';

interface ClinicSplashLoaderProps {
  fadingOut?: boolean;
  subtitle?: string;
}

export const ClinicSplashLoader: React.FC<ClinicSplashLoaderProps> = ({
  fadingOut = false,
  subtitle = 'Ouverture du cabinet...',
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Chargement du logiciel Cabinet Dentaire Dr. Sara Bchi"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#EDF2F7] dark:bg-slate-950 p-6 transition-opacity duration-300 ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="animate-clinic-enter flex flex-col items-center text-center">
        {/* Animated Logo Stage (transparent background, no box) */}
        <div className="relative flex h-40 w-48 items-center justify-center">
          {/* Soft ambient medical glow */}
          <div className="animate-clinic-halo absolute inset-3 rounded-full bg-sky-400/20 dark:bg-sky-500/20 blur-2xl" />

          {/* Precision rotating subtle ring */}
          <div className="animate-clinic-ring absolute h-36 w-36 rounded-full border-2 border-slate-300/60 dark:border-slate-800 border-t-[#1598C7] dark:border-t-sky-400" />

          {/* Official Clinic Logo without background */}
          <img
            src="/assets/cabinet/logo_Dr_sara_50e1a027.png"
            alt="Logo Cabinet Dentaire Dr. Sara Bchi"
            width={132}
            height={97}
            className="animate-clinic-breathe relative z-10 h-24 w-auto object-contain dark:invert drop-shadow-sm select-none"
          />
        </div>

        {/* Clinic Identity */}
        <div className="mt-4 space-y-1">
          <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Cabinet Dentaire Dr. Sara Bchi
          </h1>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {subtitle}
          </p>
        </div>

        {/* Slim loading bar */}
        <div className="mt-5 h-1 w-44 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div className="animate-clinic-bar h-full w-20 rounded-full bg-gradient-to-r from-[#163B63] via-[#1598C7] to-sky-400" />
        </div>
      </div>
    </div>
  );
};
