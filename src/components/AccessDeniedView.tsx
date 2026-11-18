import React from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { ROLE_LABELS } from '../types/dental';

interface AccessDeniedViewProps {
  sectionLabel?: string;
  reason?: string;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  sectionLabel,
  reason,
}) => {
  const { activeRole, setActiveSection } = useClinic();

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Accès restreint (RBAC)
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {reason ||
              `Le module${sectionLabel ? ` « ${sectionLabel} »` : ''} n'est pas autorisé pour le profil ${ROLE_LABELS[activeRole]}.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveSection('dashboard')}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Retour au Tableau de bord</span>
        </button>
      </div>
    </div>
  );
};
