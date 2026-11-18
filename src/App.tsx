/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, lazy, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BellOff,
  Calendar,
  CalendarPlus,
  ChevronDown,
  Clock,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Stethoscope,
  UserCog,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { ClinicProvider, useClinic } from './context/ClinicContext';
import { AppSection, canAccessSection, Patient, ROLE_LABELS, StaffRole } from './types/dental';
import { LoginScreen } from './components/LoginScreen';
import { AccessDeniedView } from './components/AccessDeniedView';
import { PrintModal } from './components/PrintModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAControls';
import { ActivityDrawer } from './components/ActivityDrawer';
import { QuickAppointmentModal } from './components/QuickAppointmentModal';
import { SectionSkeleton } from './components/SectionSkeleton';
import { ClinicSplashLoader } from './components/ClinicSplashLoader';

const DashboardView = lazy(() =>
  import('./components/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const AppointmentsView = lazy(() =>
  import('./components/AppointmentsView').then((m) => ({ default: m.AppointmentsView }))
);
const PatientsView = lazy(() =>
  import('./components/PatientsView').then((m) => ({ default: m.PatientsView }))
);
const TreatmentPlansView = lazy(() =>
  import('./components/TreatmentPlansView').then((m) => ({ default: m.TreatmentPlansView }))
);
const InvoicesView = lazy(() =>
  import('./components/FinanceViews').then((m) => ({ default: m.InvoicesView }))
);
const PaymentsView = lazy(() =>
  import('./components/FinanceViews').then((m) => ({ default: m.PaymentsView }))
);
const InsuranceARView = lazy(() =>
  import('./components/FinanceViews').then((m) => ({ default: m.InsuranceARView }))
);
const RecallsView = lazy(() =>
  import('./components/FinanceViews').then((m) => ({ default: m.RecallsView }))
);
const LabOrdersView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.LabOrdersView }))
);
const DocumentsView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.DocumentsView }))
);
const CashExpensesView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.CashExpensesView }))
);
const InventoryView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.InventoryView }))
);
const StaffView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.StaffView }))
);
const ReportsView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.ReportsView }))
);
const SettingsView = lazy(() =>
  import('./components/OperationsViews').then((m) => ({ default: m.SettingsView }))
);
import { ThemeToggle } from './components/ThemeToggle';
import { ThemeProvider } from './context/ThemeContext';
import { useAppointmentNotifications } from './hooks/useAppointmentNotifications';
import { useFullscreen } from './hooks/useFullscreen';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { formatDateFR, formatMAD, todayISO } from './lib/formatters';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ClinicErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message || 'Erreur inattendue.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur applicative Gestion de cabinet dentaire Dr. Sara Bchi:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh pt-safe pb-safe bg-[#EDF2F7] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-sm">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Interruption de session clinique</h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Une erreur de sécurité ou de synchronisation s'est produite : {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-full bg-[#163B63] dark:bg-sky-600 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-sky-500"
            >
              Recharger l'application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface NavItem {
  id: AppSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'Clinique' | 'Financier' | 'Logistique & Docs' | 'Administration';
  roles: StaffRole[];
  primary?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    icon: LayoutDashboard,
    group: 'Clinique',
    roles: ['titulaire', 'collaborateur', 'secretaire', 'assistant'],
    primary: true,
  },
  {
    id: 'patients',
    label: 'Patients',
    icon: Users,
    group: 'Clinique',
    roles: ['titulaire', 'collaborateur', 'secretaire', 'assistant'],
    primary: true,
  },
  {
    id: 'appointments',
    label: 'Rendez-vous',
    icon: Calendar,
    group: 'Clinique',
    roles: ['titulaire', 'collaborateur', 'secretaire', 'assistant'],
    primary: true,
  },
  {
    id: 'treatment-plans',
    label: 'Plans & Devis',
    icon: Stethoscope,
    group: 'Clinique',
    roles: ['titulaire', 'collaborateur', 'secretaire'],
  },
  {
    id: 'recalls',
    label: 'Rappels & Relances',
    icon: Clock,
    group: 'Clinique',
    roles: ['titulaire', 'collaborateur', 'secretaire'],
  },
  {
    id: 'invoices',
    label: 'Factures',
    icon: FileText,
    group: 'Financier',
    roles: ['titulaire', 'collaborateur', 'secretaire'],
    primary: true,
  },
  {
    id: 'payments',
    label: 'Paiements',
    icon: CreditCard,
    group: 'Financier',
    roles: ['titulaire', 'collaborateur', 'secretaire'],
  },
  {
    id: 'insurance',
    label: 'Mutuelles (AMO/CNSS)',
    icon: ShieldCheck,
    group: 'Financier',
    roles: ['titulaire', 'collaborateur', 'secretaire'],
  },
  {
    id: 'cash-expenses',
    label: 'Caisse & Charges',
    icon: Wallet,
    group: 'Financier',
    roles: ['titulaire', 'secretaire'],
  },
  {
    id: 'lab-orders',
    label: 'Prothèses & Labo',
    icon: FlaskConical,
    group: 'Logistique & Docs',
    roles: ['titulaire', 'collaborateur', 'secretaire', 'assistant'],
  },
  {
    id: 'documents',
    label: 'Ordonnances & Docs',
    icon: FileSpreadsheet,
    group: 'Logistique & Docs',
    roles: ['titulaire', 'collaborateur', 'secretaire'],
  },
  {
    id: 'inventory',
    label: 'Stock & Consommables',
    icon: Package,
    group: 'Logistique & Docs',
    roles: ['titulaire', 'assistant'],
  },
  {
    id: 'staff',
    label: 'Équipe & Rôles',
    icon: UserCog,
    group: 'Administration',
    roles: ['titulaire'],
  },
  {
    id: 'reports',
    label: 'Rapports',
    icon: BarChart3,
    group: 'Administration',
    roles: ['titulaire', 'collaborateur'],
    primary: true,
  },
  {
    id: 'settings',
    label: 'Paramètres',
    icon: Settings,
    group: 'Administration',
    roles: ['titulaire'],
  },
];

const NAV_GROUPS: Array<NavItem['group']> = [
  'Clinique',
  'Financier',
  'Logistique & Docs',
  'Administration',
];

const ClinicShell: React.FC = () => {
  const {
    user,
    authLoading,
    staffProfile,
    accessPending,
    actualRole,
    activeRole,
    permissions,
    setPreviewRole,
    activeSection,
    setActiveSection,
    clinicSettings,
    patients,
    appointments,
    treatmentPlans,
    invoices,
    openPatientFile,
    favoritePatientIds,
    toggleFavoritePatient,
    printableDoc,
    hasPendingSync,
    toastMessage,
    showToast,
    logout,
  } = useClinic();

  const isOnline = useOnlineStatus();
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const [modulesMenuOpen, setModulesMenuOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'favorites' | 'in_care' | 'unpaid'>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoveredBookingTooltip, setHoveredBookingTooltip] = useState<{
    patientId: string;
    patientName: string;
    top: number;
    bottom: number;
    right: number;
  } | null>(null);
  const [quickAppointmentPatient, setQuickAppointmentPatient] = useState<Patient | null>(null);
  const [minBootDone, setMinBootDone] = useState(false);
  const [splashPhase, setSplashPhase] = useState<'active' | 'fading' | 'done'>('active');
  const prevSectionRef = useRef<AppSection>(activeSection);
  const [isSectionTransitioning, setIsSectionTransitioning] = useState(false);
  const modulesMenuRef = useRef<HTMLDivElement>(null);
  const quickSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setMinBootDone(true), reducedMotion ? 80 : 200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!authLoading && minBootDone && splashPhase === 'active') {
      setSplashPhase('fading');
      const fadeTimer = window.setTimeout(() => setSplashPhase('done'), 220);
      return () => window.clearTimeout(fadeTimer);
    }
  }, [authLoading, minBootDone, splashPhase]);

  const {
    isSupported: notificationsSupported,
    permission: notificationPermission,
    isActive: notificationsActive,
    toggleNotifications,
  } = useAppointmentNotifications({
    appointments,
    enabledForSession: Boolean(user && staffProfile && !accessPending),
    onSelectAppointment: (apt) => {
      openPatientFile(apt.patientId);
    },
    onToast: showToast,
  });

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => canAccessSection(activeRole, item.id)),
    [activeRole]
  );

  const primaryNavItems = useMemo(
    () => visibleNavItems.filter((item) => item.primary),
    [visibleNavItems]
  );

  const secondaryNavItems = useMemo(
    () => visibleNavItems.filter((item) => !item.primary),
    [visibleNavItems]
  );

  const mobileBottomTabs = useMemo(() => primaryNavItems.slice(0, 4), [primaryNavItems]);

  useEffect(() => {
    if (!visibleNavItems.some((i) => i.id === activeSection)) {
      setActiveSection('dashboard');
    }
  }, [visibleNavItems, activeSection, setActiveSection]);

  useEffect(() => {
    if (!permissions.canViewFinancialTotals && quickFilter === 'unpaid') {
      setQuickFilter('all');
    }
  }, [permissions.canViewFinancialTotals, quickFilter]);

  useEffect(() => {
    if (!user || !staffProfile || accessPending) {
      prevSectionRef.current = activeSection;
      setIsSectionTransitioning(false);
      return;
    }
    if (prevSectionRef.current === activeSection) {
      return;
    }
    prevSectionRef.current = activeSection;
    setIsSectionTransitioning(true);
    const timer = window.setTimeout(() => {
      setIsSectionTransitioning(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeSection, user, staffProfile, accessPending]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (modulesMenuRef.current && !modulesMenuRef.current.contains(event.target as Node)) {
        setModulesMenuOpen(false);
      }
      if (quickSearchRef.current && !quickSearchRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
        setHoveredBookingTooltip(null);
        setQuickSearch('');
        setQuickFilter('all');
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        setModulesMenuOpen(false);
        setSearchOpen(false);
        setHoveredBookingTooltip(null);
        setQuickSearch('');
        setQuickFilter('all');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const inCarePatientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const plan of treatmentPlans) {
      if (
        plan.status === 'En cours' ||
        plan.status === 'Accepté' ||
        plan.items?.some((item) => item.status === 'En cours')
      ) {
        ids.add(plan.patientId);
      }
    }
    for (const apt of appointments) {
      if (apt.status === 'Au fauteuil' || apt.status === "Arrivé en salle d'attente") {
        ids.add(apt.patientId);
      }
    }
    return ids;
  }, [treatmentPlans, appointments]);

  const unpaidBalanceByPatient = useMemo(() => {
    const map = new Map<string, number>();
    const csvInvoicedByPatient = new Map<string, number>();
    for (const inv of invoices) {
      if (inv.status === 'Annulée') continue;
      const due = Math.max(0, Number(inv.patientShare || 0) - Number(inv.paidAmount || 0));
      if (due > 0) {
        map.set(inv.patientId, (map.get(inv.patientId) || 0) + due);
      }
      if (inv.isCsvArchive) {
        csvInvoicedByPatient.set(
          inv.patientId,
          (csvInvoicedByPatient.get(inv.patientId) || 0) + Number(inv.totalAmount || 0)
        );
      }
    }
    for (const p of patients) {
      if (p.isCsvArchive && typeof p.remainingDue === 'number' && p.remainingDue > 0) {
        const csvInvoiced = csvInvoicedByPatient.get(p.id) || 0;
        const unInvoicedDebt = Math.max(0, p.remainingDue - csvInvoiced);
        if (unInvoicedDebt > 0) {
          map.set(p.id, (map.get(p.id) || 0) + unInvoicedDebt);
        }
      }
    }
    return map;
  }, [invoices, patients]);

  const lastVisitDateByPatient = useMemo(() => {
    const today = todayISO();
    const latestByPatient = new Map<string, { date: string; startTime: string }>();
    for (const apt of appointments) {
      if (!apt.patientId || !apt.date) continue;
      if (apt.status === 'Annulé' || apt.status === 'Absent') continue;
      const isCompletedOrActiveVisit =
        apt.status === 'Terminé' ||
        apt.status === 'Au fauteuil' ||
        apt.status === "Arrivé en salle d'attente";
      const isPastAppointment = apt.date < today;
      if (!isCompletedOrActiveVisit && !isPastAppointment) continue;

      const current = latestByPatient.get(apt.patientId);
      const aptTime = apt.startTime || '00:00';
      if (
        !current ||
        apt.date > current.date ||
        (apt.date === current.date && aptTime > current.startTime)
      ) {
        latestByPatient.set(apt.patientId, { date: apt.date, startTime: aptTime });
      }
    }
    const result = new Map<string, string>();
    latestByPatient.forEach((val, key) => {
      result.set(key, val.date);
    });
    return result;
  }, [appointments]);

  const recentConsultationReasonsByPatient = useMemo(() => {
    const today = todayISO();
    const grouped = new Map<
      string,
      Array<{ id: string; date: string; startTime: string; actType: string; notes?: string }>
    >();

    for (const apt of appointments) {
      if (!apt.patientId || !apt.date || !apt.actType) continue;
      if (apt.status === 'Annulé' || apt.status === 'Absent') continue;

      const isCompletedOrActiveVisit =
        apt.status === 'Terminé' ||
        apt.status === 'Au fauteuil' ||
        apt.status === "Arrivé en salle d'attente";
      if (apt.date > today && !isCompletedOrActiveVisit) continue;

      const list = grouped.get(apt.patientId) || [];
      list.push({
        id: apt.id,
        date: apt.date,
        startTime: apt.startTime || '00:00',
        actType: apt.actType,
        notes: apt.notes,
      });
      grouped.set(apt.patientId, list);
    }

    grouped.forEach((list, key) => {
      list.sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`));
      grouped.set(key, list.slice(0, 3));
    });

    return grouped;
  }, [appointments]);

  const quickSearchBaseMatches = useMemo(() => {
    const q = quickSearch.trim().toLowerCase();
    const list = q
      ? patients.filter((p) =>
          `${p.fullName || ''} ${p.firstName} ${p.lastName} ${p.fileNumber} ${p.phone} ${p.cin || ''}`
            .toLowerCase()
            .includes(q)
        )
      : [...patients].sort((a, b) => {
          const aFav = favoritePatientIds.includes(a.id) ? 0 : 1;
          const bFav = favoritePatientIds.includes(b.id) ? 0 : 1;
          return aFav - bFav;
        });
    return list;
  }, [patients, quickSearch, favoritePatientIds]);

  const quickFilterCounts = useMemo(
    () => ({
      all: quickSearchBaseMatches.length,
      favorites: quickSearchBaseMatches.filter((p) => favoritePatientIds.includes(p.id)).length,
      in_care: quickSearchBaseMatches.filter((p) => inCarePatientIds.has(p.id)).length,
      unpaid: quickSearchBaseMatches.filter((p) => (unpaidBalanceByPatient.get(p.id) || 0) > 0).length,
    }),
    [quickSearchBaseMatches, favoritePatientIds, inCarePatientIds, unpaidBalanceByPatient]
  );

  const quickSearchMatches = useMemo(() => {
    const filtered = quickSearchBaseMatches.filter((p) => {
      if (quickFilter === 'favorites') return favoritePatientIds.includes(p.id);
      if (quickFilter === 'in_care') return inCarePatientIds.has(p.id);
      if (quickFilter === 'unpaid' && permissions.canViewFinancialTotals) {
        return (unpaidBalanceByPatient.get(p.id) || 0) > 0;
      }
      return true;
    });
    return filtered.slice(0, 8);
  }, [quickSearchBaseMatches, quickFilter, favoritePatientIds, inCarePatientIds, unpaidBalanceByPatient, permissions.canViewFinancialTotals]);

  if (authLoading) {
    return <ClinicSplashLoader subtitle="Initialisation sécurisée du cabinet..." />;
  }

  if (!user || !staffProfile || accessPending) {
    return (
      <>
        <LoginScreen />
        <OfflineIndicator />
        {splashPhase !== 'done' && (
          <ClinicSplashLoader
            fadingOut={splashPhase === 'fading'}
            subtitle="Ouverture du cabinet..."
          />
        )}
      </>
    );
  }

  const activeNavMeta = NAV_ITEMS.find((i) => i.id === activeSection) || NAV_ITEMS[0];
  const isSecondaryActive = secondaryNavItems.some((i) => i.id === activeSection);
  const isMobileMoreActive = !mobileBottomTabs.some((item) => item.id === activeSection);
  const MOBILE_SHORT_LABELS: Partial<Record<AppSection, string>> = {
    dashboard: 'Accueil',
    patients: 'Patients',
    appointments: 'Agenda',
    invoices: 'Factures',
    reports: 'Rapports',
  };
  const clinicTitle = clinicSettings?.clinicName || 'Cabinet Dentaire Dr. Sara Bchi';
  const initials = staffProfile.displayName
    .replace(/^Dr\.?\s*/i, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const renderSection = () => {
    if (!canAccessSection(activeRole, activeSection)) {
      return <AccessDeniedView sectionLabel={activeNavMeta?.label} />;
    }
    switch (activeSection) {
      case 'dashboard':
        return <DashboardView />;
      case 'appointments':
        return <AppointmentsView />;
      case 'patients':
        return <PatientsView />;
      case 'treatment-plans':
        return <TreatmentPlansView />;
      case 'recalls':
        return <RecallsView />;
      case 'invoices':
        return <InvoicesView />;
      case 'payments':
        return <PaymentsView />;
      case 'insurance':
        return <InsuranceARView />;
      case 'lab-orders':
        return <LabOrdersView />;
      case 'documents':
        return <DocumentsView />;
      case 'cash-expenses':
        return <CashExpensesView />;
      case 'inventory':
        return <InventoryView />;
      case 'staff':
        return <StaffView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
    }
  };

  const hasCustomOverviewHeader = activeSection === 'dashboard' || activeSection === 'reports';

  return (
    <div className="min-h-dvh bg-[#EDF2F7] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-200">
      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/50 dark:bg-black/70 lg:hidden"
        />
      )}
      <aside
        aria-label="Menu de navigation mobile"
        aria-hidden={!mobileMenuOpen}
        className={`no-print fixed inset-y-0 left-0 z-50 w-[84vw] max-w-72 pt-safe pb-safe pl-safe bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col overscroll-contain transition-transform duration-200 lg:hidden ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/assets/cabinet/logo_Dr_sara_50e1a027.png"
              alt="Logo Cabinet Dentaire Dr. Sara Bchi"
              width={52}
              height={38}
              className="h-9 w-auto shrink-0 object-contain dark:invert"
            />
            <p className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">
              {clinicTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fermer le menu"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-5">
          {NAV_GROUPS.map((groupName) => {
            const groupItems = visibleNavItems.filter((item) => item.group === groupName);
            if (groupItems.length === 0) return null;
            return (
              <div key={groupName} className="space-y-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {groupName}
                </p>
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveSection(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex w-full min-h-[44px] items-center gap-3 rounded-full px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-[#163B63] dark:bg-sky-600 text-white shadow-sm'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2.5">
          {actualRole === 'titulaire' && (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Aperçu rôle
              </span>
              <select
                aria-label="Aperçu du rôle mobile"
                value={activeRole}
                onChange={(e) => setPreviewRole(e.target.value as StaffRole)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="titulaire">Titulaire</option>
                <option value="collaborateur">Collaborateur</option>
                <option value="secretaire">Secrétaire</option>
                <option value="assistant">Assistant(e)</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setActivityDrawerOpen(true);
              }}
              className="flex flex-1 min-h-[40px] items-center justify-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <History className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
              <span>Journal</span>
            </button>
            {notificationsSupported && (
              <button
                type="button"
                onClick={toggleNotifications}
                aria-label="Rappels rendez-vous"
                className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full border transition-colors ${
                  notificationsActive
                    ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {notificationsActive || notificationPermission === 'default' ? (
                  <Bell className="h-4 w-4" />
                ) : (
                  <BellOff className="h-4 w-4" />
                )}
              </button>
            )}
            <ThemeToggle compact />
          </div>

          <PWAInstallButton variant="sidebar" />

          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {staffProfile.displayName}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {ROLE_LABELS[activeRole]}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Se déconnecter"
              aria-label="Se déconnecter"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Top Horizontal Navigation Header */}
      <header className="no-print sticky top-0 z-30 pt-safe border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md transition-colors duration-200">
        <div
          className={`${
            isFullscreen ? 'max-w-none px-3 sm:px-5' : 'max-w-[1440px] px-3 sm:px-6'
          } w-full mx-auto py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-3 transition-all duration-200`}
        >
          {/* Left: Hamburger (mobile) + Logo + Brand / Active Section */}
          <div className="flex items-center gap-2 min-w-0 flex-1 lg:flex-initial">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 lg:hidden shrink-0"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('dashboard')}
              className="flex items-center gap-2 text-left min-w-0 group"
              title={clinicTitle}
            >
              <img
                src="/assets/cabinet/logo_Dr_sara_50e1a027.png"
                alt="Logo Cabinet Dentaire Dr. Sara Bchi"
                width={54}
                height={40}
                className="h-8 sm:h-9 w-auto shrink-0 object-contain dark:invert transition-transform group-hover:scale-[1.03]"
              />
              <span className="sm:hidden font-display text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {activeNavMeta.label}
              </span>
              <span className="hidden sm:inline font-display text-sm font-bold tracking-tight text-slate-900 dark:text-white truncate max-w-[160px] xl:max-w-[200px]">
                {clinicTitle}
              </span>
            </button>
          </div>

          {/* Center: Clean Horizontal Pill Tabs + Modules Dropdown */}
          <nav className="hidden lg:flex items-center gap-1" aria-label="Navigation principale">
            {primaryNavItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(item.id);
                    setModulesMenuOpen(false);
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}

            {secondaryNavItems.length > 0 && (
              <div className="relative" ref={modulesMenuRef}>
                <button
                  type="button"
                  onClick={() => setModulesMenuOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    isSecondaryActive
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{isSecondaryActive ? activeNavMeta.label : 'Modules'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {modulesMenuOpen && (
                  <div className="absolute left-0 top-full mt-2 w-72 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl z-40 space-y-3">
                    {NAV_GROUPS.map((groupName) => {
                      const items = secondaryNavItems.filter((i) => i.group === groupName);
                      if (items.length === 0) return null;
                      return (
                        <div key={groupName} className="space-y-1">
                          <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            {groupName}
                          </p>
                          {items.map((item) => {
                            const Icon = item.icon;
                            const isActive = activeSection === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setActiveSection(item.id);
                                  setModulesMenuOpen(false);
                                }}
                                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                  isActive
                                    ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Right: Circular Utilities, Search, Theme, Profile */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Quick Search Popover */}
            <div className="relative shrink-0" ref={quickSearchRef}>
              <div className="hidden 2xl:block relative w-48">
                <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={quickSearch}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="Patient (Nom, CIN)..."
                  className="w-full rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setSearchOpen((prev) => !prev)}
                aria-label="Rechercher un patient"
                aria-expanded={searchOpen}
                className="2xl:hidden min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 flex items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Search className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              </button>

              {(searchOpen || quickSearch.trim().length > 0) && (
                <div
                  className={`${
                    searchOpen ? 'flex' : 'hidden 2xl:flex'
                  } flex-col fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.75rem)] max-h-[calc(100dvh-5.25rem)] sm:max-h-[75dvh] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[480px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden z-40`}
                >
                  {searchOpen && (
                    <div className="2xl:hidden border-b border-slate-100 dark:border-slate-800 p-2 shrink-0">
                      <input
                        autoFocus
                        type="text"
                        value={quickSearch}
                        onChange={(e) => setQuickSearch(e.target.value)}
                        placeholder="Nom, Tél ou CIN patient..."
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Boutons de filtre rapide */}
                  <div
                    role="group"
                    aria-label="Filtres rapides de recherche patient"
                    className="flex flex-wrap items-center gap-1 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-2 shrink-0"
                  >
                    {(
                      [
                        { id: 'all', label: 'Tout', count: quickFilterCounts.all },
                        { id: 'favorites', label: 'Favoris', count: quickFilterCounts.favorites },
                        { id: 'in_care', label: 'Avec soins en cours', count: quickFilterCounts.in_care },
                        ...(permissions.canViewFinancialTotals
                          ? [{ id: 'unpaid' as const, label: 'En attente de paiement', count: quickFilterCounts.unpaid }]
                          : []),
                      ] as Array<{ id: 'all' | 'favorites' | 'in_care' | 'unpaid'; label: string; count: number }>
                    ).map((tab) => {
                      const active = quickFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setQuickFilter(tab.id)}
                          aria-pressed={active}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                            active
                              ? 'bg-[#163B63] dark:bg-sky-600 text-white shadow-sm'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span
                            className={`font-mono text-[10px] tabular-nums ${
                              active ? 'text-sky-100' : 'text-slate-400 dark:text-slate-400'
                            }`}
                          >
                            ({tab.count})
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {quickSearchMatches.length > 0 ? (
                    <div
                      onScroll={() => setHoveredBookingTooltip(null)}
                      className="divide-y divide-slate-100 dark:divide-slate-800 flex-1 min-h-0 max-h-80 overflow-y-auto overscroll-contain"
                    >
                      {quickSearchMatches.map((pat) => {
                        const isFavorite = favoritePatientIds.includes(pat.id);
                        const isInCare = inCarePatientIds.has(pat.id);
                        const unpaidDue = unpaidBalanceByPatient.get(pat.id) || 0;
                        const lastVisitDate = lastVisitDateByPatient.get(pat.id);
                        return (
                          <div
                            key={pat.id}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavoritePatient(pat.id);
                              }}
                              aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                              title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                              className={`rounded-lg p-1 transition-colors shrink-0 ${
                                isFavorite
                                  ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/50'
                                  : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <Star
                                className={`h-4 w-4 ${
                                  isFavorite ? 'fill-amber-400 text-amber-500' : ''
                                }`}
                              />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                openPatientFile(pat.id);
                                setQuickSearch('');
                                setQuickFilter('all');
                                setHoveredBookingTooltip(null);
                                setSearchOpen(false);
                              }}
                              className="flex-1 min-w-0 text-left space-y-0.5"
                            >
                              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {pat.firstName} {pat.lastName}
                              </p>
                              <p className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                <Clock className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
                                <span className="truncate">
                                  Dernière visite :{' '}
                                  <span className="font-mono tabular-nums font-medium text-slate-700 dark:text-slate-200">
                                    {lastVisitDate ? formatDateFR(lastVisitDate) : 'Aucune'}
                                  </span>
                                </span>
                              </p>
                              <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                                {pat.fileNumber} · {pat.phone}
                                {isInCare && (
                                  <span className="font-sans font-medium text-sky-700 dark:text-sky-400">
                                    {' '}
                                    · Soins en cours
                                  </span>
                                )}
                                {permissions.canViewFinancialTotals && unpaidDue > 0 && (
                                  <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
                                    {' '}
                                    · {formatMAD(unpaidDue)} dû
                                  </span>
                                )}
                              </p>
                            </button>

                            {permissions.canEditAppointments && (
                              <button
                                type="button"
                                aria-describedby={
                                  hoveredBookingTooltip?.patientId === pat.id
                                    ? 'quick-booking-reasons-tooltip'
                                    : undefined
                                }
                                onMouseEnter={(e) => {
                                  if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredBookingTooltip({
                                    patientId: pat.id,
                                    patientName: `${pat.firstName} ${pat.lastName}`,
                                    top: rect.top,
                                    bottom: rect.bottom,
                                    right: Math.max(12, window.innerWidth - rect.right),
                                  });
                                }}
                                onMouseLeave={() => setHoveredBookingTooltip(null)}
                                onFocus={(e) => {
                                  if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredBookingTooltip({
                                    patientId: pat.id,
                                    patientName: `${pat.firstName} ${pat.lastName}`,
                                    top: rect.top,
                                    bottom: rect.bottom,
                                    right: Math.max(12, window.innerWidth - rect.right),
                                  });
                                }}
                                onBlur={() => setHoveredBookingTooltip(null)}
                                onClick={() => {
                                  setQuickAppointmentPatient(pat);
                                  setQuickSearch('');
                                  setQuickFilter('all');
                                  setHoveredBookingTooltip(null);
                                  setSearchOpen(false);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
                              >
                                <CalendarPlus className="h-3.5 w-3.5 shrink-0" />
                                <span className="sm:hidden">RDV</span>
                                <span className="hidden sm:inline">Prendre Rendez-vous</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-3.5 py-4 text-xs text-slate-500 dark:text-slate-400">
                      {quickSearch.trim().length > 0
                        ? `Aucun patient trouvé pour « ${quickSearch.trim()} » avec ce filtre.`
                        : 'Aucun patient ne correspond à ce filtre.'}
                    </div>
                  )}

                  {hoveredBookingTooltip && (() => {
                    const reasons =
                      recentConsultationReasonsByPatient.get(hoveredBookingTooltip.patientId) || [];
                    const showBelow = hoveredBookingTooltip.top < 200;
                    return (
                      <div
                        id="quick-booking-reasons-tooltip"
                        role="tooltip"
                        style={
                          showBelow
                            ? { top: hoveredBookingTooltip.bottom + 8, right: hoveredBookingTooltip.right }
                            : {
                                bottom: window.innerHeight - hoveredBookingTooltip.top + 8,
                                right: hoveredBookingTooltip.right,
                              }
                        }
                        className="fixed z-[70] w-72 sm:w-80 pointer-events-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl"
                      >
                        <div className="flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-1.5 mb-2">
                          <History className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                          <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                            3 derniers motifs · {hoveredBookingTooltip.patientName}
                          </p>
                        </div>
                        {reasons.length > 0 ? (
                          <ul className="space-y-1.5">
                            {reasons.map((item, idx) => (
                              <li key={item.id} className="flex items-start gap-2 text-[11px]">
                                <span className="font-mono text-[10px] font-semibold text-sky-600 dark:text-sky-400 mt-0.5 shrink-0">
                                  {idx + 1}.
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-slate-800 dark:text-slate-100 leading-snug">
                                    {item.actType}
                                  </p>
                                  <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                    {formatDateFR(item.date)} · {item.startTime}
                                  </p>
                                  {item.notes && (
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">
                                      {item.notes}
                                    </p>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Aucun motif de consultation récent enregistré.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Sync Status Pill */}
            <div
              title={
                !isOnline
                  ? 'Mode hors ligne actif'
                  : hasPendingSync
                  ? 'Synchronisation en cours...'
                  : 'Données synchronisées'
              }
              className={`hidden sm:flex items-center justify-center h-8 w-8 rounded-full border ${
                !isOnline
                  ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                  : hasPendingSync
                  ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            </div>

            {notificationsSupported && (
              <button
                type="button"
                onClick={toggleNotifications}
                aria-label={
                  notificationsActive
                    ? 'Mettre en pause les rappels locaux de rendez-vous'
                    : 'Activer les rappels locaux de rendez-vous (15 min avant)'
                }
                title={
                  notificationsActive
                    ? 'Rappels RDV actifs (15 min avant) — Cliquer pour mettre en pause'
                    : notificationPermission === 'denied'
                    ? 'Notifications bloquées par le navigateur'
                    : 'Activer les rappels locaux (15 min avant chaque RDV)'
                }
                className={`hidden sm:flex items-center justify-center h-8 w-8 rounded-full border transition-colors ${
                  notificationsActive
                    ? 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/60'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {notificationsActive || notificationPermission === 'default' ? (
                  <Bell className="h-3.5 w-3.5" />
                ) : (
                  <BellOff className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => setActivityDrawerOpen((prev) => !prev)}
              aria-label="Ouvrir le journal d'activité récent"
              aria-expanded={activityDrawerOpen}
              title="Journal d'activité récent (traçabilité cabinet)"
              className={`hidden sm:flex items-center justify-center h-8 w-8 rounded-full border transition-colors ${
                activityDrawerOpen
                  ? 'border-[#163B63] dark:border-sky-500 bg-[#163B63] dark:bg-sky-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <History className="h-3.5 w-3.5" />
            </button>

            <PWAInstallButton variant="header" openModalOnClick />

            <div className="hidden sm:block">
              <ThemeToggle compact />
            </div>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={
                isFullscreen
                  ? 'Quitter le mode Plein écran'
                  : "Activer le mode Plein écran pour maximiser l'espace de travail"
              }
              aria-pressed={isFullscreen}
              title={
                isFullscreen
                  ? 'Quitter le mode Plein écran'
                  : "Plein écran (maximiser l'espace de travail)"
              }
              className={`hidden sm:flex items-center justify-center gap-1.5 h-8 w-8 2xl:w-auto 2xl:px-3 rounded-full border transition-colors ${
                isFullscreen
                  ? 'border-[#163B63] dark:border-sky-500 bg-[#163B63] dark:bg-sky-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="hidden 2xl:inline text-[11px] font-medium whitespace-nowrap">
                {isFullscreen ? 'Réduire' : 'Plein écran'}
              </span>
            </button>

            {actualRole === 'titulaire' && (
              <select
                aria-label="Aperçu du rôle"
                value={activeRole}
                onChange={(e) => setPreviewRole(e.target.value as StaffRole)}
                className="hidden md:block rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:border-sky-500 focus:outline-none whitespace-nowrap"
              >
                <option value="titulaire">Titulaire</option>
                <option value="collaborateur">Collaborateur</option>
                <option value="secretaire">Secrétaire</option>
                <option value="assistant">Assistant(e)</option>
              </select>
            )}

            {/* User Profile Block */}
            <div className="flex items-center gap-2 sm:pl-1">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Profil et paramètres rapides"
                className="h-9 w-9 sm:h-8 sm:w-8 rounded-full bg-[#163B63] dark:bg-sky-600 text-white font-bold text-xs flex items-center justify-center shrink-0 lg:pointer-events-none"
              >
                {initials || 'DR'}
              </button>
              <div className="hidden sm:block leading-tight max-w-[130px]">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {staffProfile.displayName}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {ROLE_LABELS[activeRole]}
                </p>
              </div>
              <button
                type="button"
                onClick={logout}
                title="Se déconnecter"
                aria-label="Se déconnecter"
                className="hidden sm:flex rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main
        className={`relative flex-1 pl-safe pr-safe ${printableDoc ? 'no-print' : ''} ${
          isFullscreen
            ? 'max-w-none p-3 sm:p-4 pb-24 lg:pb-4'
            : 'max-w-[1440px] p-3.5 sm:p-6 pb-24 lg:pb-6'
        } w-full mx-auto transition-all duration-200`}
        aria-busy={isSectionTransitioning}
      >
        {isSectionTransitioning ? (
          <>
            <div
              role="progressbar"
              aria-label={`Progression du chargement : ${activeNavMeta.label}`}
              aria-valuetext="Chargement en cours"
              className="no-print absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-slate-200/80 dark:bg-slate-800"
            >
              <div className="h-full w-full bg-[#1598C7] dark:bg-sky-400 animate-section-progress" />
            </div>
            <SectionSkeleton section={activeSection} label={activeNavMeta.label} />
          </>
        ) : (
          <Suspense fallback={<SectionSkeleton section={activeSection} label={activeNavMeta.label} />}>
            {!hasCustomOverviewHeader && (
              <div className="mb-4 sm:mb-5 flex items-center justify-between gap-3">
                <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {activeNavMeta.label}
                </h1>
              </div>
            )}
            {renderSection()}
          </Suspense>
        )}
      </main>

      {/* Native-Style Mobile Bottom Tab Bar (iOS & Android thumb navigation) */}
      <nav
        aria-label="Navigation mobile rapide"
        className="no-print fixed bottom-0 inset-x-0 z-30 pb-safe pl-safe pr-safe border-t border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md lg:hidden"
      >
        <div className="flex items-stretch justify-around px-1">
          {mobileBottomTabs.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const shortLabel = MOBILE_SHORT_LABELS[item.id] || item.label;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileMenuOpen(false);
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex-1 min-w-0 min-h-[52px] flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors ${
                  isActive
                    ? 'text-[#163B63] dark:text-sky-400'
                    : 'text-slate-500 dark:text-slate-400 active:text-slate-800 dark:active:text-slate-200'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-[#1598C7] dark:bg-sky-400" />
                )}
                <Icon className="h-5 w-5 shrink-0" />
                <span className="text-[10px] font-semibold tracking-tight truncate max-w-full whitespace-nowrap">
                  {shortLabel}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Afficher tous les modules"
            className={`relative flex-1 min-w-0 min-h-[52px] flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors ${
              isMobileMoreActive
                ? 'text-[#163B63] dark:text-sky-400'
                : 'text-slate-500 dark:text-slate-400 active:text-slate-800 dark:active:text-slate-200'
            }`}
          >
            {isMobileMoreActive && (
              <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-[#1598C7] dark:bg-sky-400" />
            )}
            <Menu className="h-5 w-5 shrink-0" />
            <span className="text-[10px] font-semibold tracking-tight whitespace-nowrap">
              Menu
            </span>
          </button>
        </div>
      </nav>

      {/* Global Toast */}
      {toastMessage && (
        <div
          className={`no-print fixed top-[calc(env(safe-area-inset-top)+4rem)] inset-x-3 sm:inset-x-auto sm:right-4 z-50 rounded-2xl border px-4 py-2.5 text-xs font-medium shadow-lg ${
            toastMessage.tone === 'error'
              ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/90 text-red-900 dark:text-red-200'
              : toastMessage.tone === 'success'
              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/90 text-emerald-900 dark:text-emerald-200'
              : 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/90 text-sky-900 dark:text-sky-200'
          }`}
        >
          {toastMessage.text}
        </div>
      )}

      <ActivityDrawer
        isOpen={activityDrawerOpen}
        onClose={() => setActivityDrawerOpen(false)}
      />
      <QuickAppointmentModal
        patient={quickAppointmentPatient}
        onClose={() => setQuickAppointmentPatient(null)}
      />
      <PrintModal />
      <OfflineIndicator hasPendingSync={hasPendingSync} />
      {splashPhase !== 'done' && (
        <ClinicSplashLoader
          fadingOut={splashPhase === 'fading'}
          subtitle="Ouverture du cabinet..."
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <ClinicErrorBoundary>
        <ClinicProvider>
          <ClinicShell />
        </ClinicProvider>
      </ClinicErrorBoundary>
    </ThemeProvider>
  );
}
