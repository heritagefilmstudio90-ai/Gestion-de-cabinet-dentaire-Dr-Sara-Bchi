import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  MessageCircle,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import {
  addDaysISO,
  computeWaitingMinutes,
  formatDateFR,
  formatMAD,
  generateSafeId,
  todayISO,
} from '../lib/formatters';
import { ActCategory, AdminDocument, AdminDocumentCategory, CatalogAct } from '../types/dental';
import {
  GradientProgressBar,
  SegmentedArcGauge,
  StatBarColumns,
  StatColumnItem,
} from './AnalyticsPrimitives';

function addMinutesToTime(startTime: string, durationMinutes: number): string {
  const [hRaw, mRaw] = (startTime || '09:00').split(':').map(Number);
  const total = (Number.isFinite(hRaw) ? hRaw : 9) * 60 + (Number.isFinite(mRaw) ? mRaw : 0) + (durationMinutes || 30);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function computeDaysUntilISO(targetIso: string, baseIso: string): number {
  const tParts = (targetIso || '').slice(0, 10).split('-').map(Number);
  const bParts = (baseIso || '').slice(0, 10).split('-').map(Number);
  if (tParts.length !== 3 || bParts.length !== 3 || tParts.some(Number.isNaN) || bParts.some(Number.isNaN)) {
    return 0;
  }
  const targetMs = Date.UTC(tParts[0], tParts[1] - 1, tParts[2]);
  const baseMs = Date.UTC(bParts[0], bParts[1] - 1, bParts[2]);
  return Math.round((targetMs - baseMs) / 86400000);
}

function addOneYearISO(isoDate: string): string {
  const parts = (isoDate || '').slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return addDaysISO(todayISO(), 365);
  }
  const dt = new Date(parts[0] + 1, parts[1] - 1, parts[2]);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function mapActCategoryLabel(cat: ActCategory): string {
  if (cat === 'ODF') return 'Orthodontie';
  if (cat === 'Prothèse fixe' || cat === 'Prothèse amovible') return 'Prothèse';
  return cat;
}

function resolveCareCategory(
  actLabelOrCode: string,
  catalog: CatalogAct[]
): string {
  const normalized = (actLabelOrCode || '').trim().toLowerCase();
  if (!normalized) return 'Consultations';

  const catalogMatch = catalog.find(
    (c) =>
      c.code.toLowerCase() === normalized ||
      c.name.toLowerCase() === normalized ||
      normalized.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(normalized)
  );
  if (catalogMatch) {
    return mapActCategoryLabel(catalogMatch.category);
  }

  if (
    normalized.includes('orthodont') ||
    normalized.includes('odf') ||
    normalized.includes('multi-attache') ||
    normalized.includes('aligneur') ||
    normalized.includes('gouttière')
  ) {
    return 'Orthodontie';
  }
  if (
    normalized.includes('composite') ||
    normalized.includes('obturation') ||
    normalized.includes('carie') ||
    normalized.includes('amalgame') ||
    normalized.includes('soin')
  ) {
    return 'Soins conservateurs';
  }
  if (
    normalized.includes('chirurg') ||
    normalized.includes('extraction') ||
    normalized.includes('sagesse') ||
    normalized.includes('résection')
  ) {
    return 'Chirurgie';
  }
  if (
    normalized.includes('endodont') ||
    normalized.includes('dévitalis') ||
    normalized.includes('canal')
  ) {
    return 'Endodontie';
  }
  if (normalized.includes('implant')) {
    return 'Implantologie';
  }
  if (
    normalized.includes('couronne') ||
    normalized.includes('zircone') ||
    normalized.includes('céramo') ||
    normalized.includes('prothèse') ||
    normalized.includes('bridge') ||
    normalized.includes('stellite')
  ) {
    return 'Prothèse';
  }
  if (
    normalized.includes('détartrage') ||
    normalized.includes('parodont') ||
    normalized.includes('surfaçage')
  ) {
    return 'Parodontologie';
  }
  if (normalized.includes('consult') || normalized.includes('bilan') || normalized.includes('urgence')) {
    return 'Consultations';
  }
  return 'Soins conservateurs';
}

export const DashboardView: React.FC = () => {
  const {
    user,
    actualRole,
    patients,
    appointments,
    actsCatalog,
    invoices,
    payments,
    recalls,
    expenses,
    labOrders,
    inventory,
    adminDocuments,
    favoritePatientIds,
    toggleFavoritePatient,
    permissions,
    setActiveSection,
    openPatientFile,
    saveRecord,
    removeRecord,
    showToast,
  } = useClinic();

  const [growthRange, setGrowthRange] = useState<'today' | '7d' | 'month' | 'all'>('month');
  const [statTab, setStatTab] = useState<'appointments' | 'payments'>('appointments');
  const [listTab, setListTab] = useState<'today' | 'next7' | 'recalls'>('today');
  const [timelineFilter, setTimelineFilter] = useState<'upcoming' | 'all'>('upcoming');
  const [careChartScope, setCareChartScope] = useState<'performed' | 'all'>('performed');
  const [adminDocFilter, setAdminDocFilter] = useState<'expiring' | 'all'>('expiring');
  const [adminDocCategoryFilter, setAdminDocCategoryFilter] = useState<'all' | AdminDocumentCategory>('all');
  const [showAdminDocModal, setShowAdminDocModal] = useState(false);
  const [editingAdminDoc, setEditingAdminDoc] = useState<AdminDocument | null>(null);
  const [savingAdminDoc, setSavingAdminDoc] = useState(false);
  const [adminDocForm, setAdminDocForm] = useState<{
    title: string;
    category: AdminDocumentCategory;
    provider: string;
    reference: string;
    expiryDate: string;
    alertDaysBefore: number;
    notes: string;
  }>({
    title: '',
    category: 'Licence logicielle',
    provider: '',
    reference: '',
    expiryDate: addDaysISO(todayISO(), 30),
    alertDaysBefore: 45,
    notes: '',
  });
  const [stockThresholdMode, setStockThresholdMode] = useState<'item' | 'custom'>('item');
  const [customStockThreshold, setCustomStockThreshold] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('dentaflow_stock_alert_threshold');
      const parsed = saved ? Number(saved) : 5;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
    } catch {
      return 5;
    }
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dentaflow_stock_alert_threshold' && e.newValue) {
        const parsed = Number(e.newValue);
        if (Number.isFinite(parsed) && parsed > 0) {
          setCustomStockThreshold(parsed);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const in7Days = addDaysISO(today, 7);
  const currentMonthLabel = useMemo(() => {
    const dt = new Date(`${today}T00:00:00`);
    return dt.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }, [today]);

  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter((a) => a.date === today && a.status !== 'Annulé')
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [appointments, today]
  );

  const next7Appointments = useMemo(
    () =>
      appointments
        .filter((a) => a.date > today && a.date <= in7Days && a.status !== 'Annulé')
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)),
    [appointments, today, in7Days]
  );

  const activePatientsCount = useMemo(() => patients.filter((p) => p.active).length, [patients]);

  const monthPayments = useMemo(
    () => payments.filter((p) => p.date.startsWith(currentMonth)),
    [payments, currentMonth]
  );

  const revenueThisMonth = useMemo(
    () => monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [monthPayments]
  );

  const expensesThisMonth = useMemo(
    () =>
      expenses
        .filter((e) => e.date.startsWith(currentMonth))
        .reduce((sum, e) => sum + Number(e.amount || 0), 0),
    [expenses, currentMonth]
  );

  const netThisMonth = revenueThisMonth - expensesThisMonth;

  const billedThisMonth = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status !== 'Annulée' && inv.issueDate.startsWith(currentMonth))
        .reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0),
    [invoices, currentMonth]
  );

  const insuranceOutstanding = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status !== 'Annulée')
        .reduce(
          (sum, inv) =>
            sum + Math.max(0, Number(inv.insuranceShare || 0) - Number(inv.insurancePaidAmount || 0)),
          0
        ),
    [invoices]
  );

  const unpaidPatientBalances = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status !== 'Annulée')
        .reduce(
          (sum, inv) =>
            sum + Math.max(0, Number(inv.patientShare || 0) - Number(inv.paidAmount || 0)),
          0
        ),
    [invoices]
  );

  const overdueRecalls = useMemo(
    () => recalls.filter((r) => r.status === 'En retard' || (r.status === 'À faire' && r.dueDate < today)),
    [recalls, today]
  );
  const dueIn30Recalls = useMemo(
    () =>
      recalls.filter(
        (r) => r.status === 'À faire' && r.dueDate >= today && r.dueDate <= addDaysISO(today, 30)
      ),
    [recalls, today]
  );

  const completedTodayCount = useMemo(
    () => todaysAppointments.filter((a) => a.status === 'Terminé').length,
    [todaysAppointments]
  );

  const inChairTodayCount = useMemo(
    () => todaysAppointments.filter((a) => a.status === 'Au fauteuil').length,
    [todaysAppointments]
  );

  const patientsSeenToday = useMemo(() => {
    const seenIds = new Set(
      todaysAppointments
        .filter((a) => a.status === 'Terminé' || a.status === 'Au fauteuil')
        .map((a) => a.patientId)
    );
    return seenIds.size;
  }, [todaysAppointments]);

  const lowStockCount = useMemo(
    () => inventory.filter((item) => item.quantity <= item.minThreshold).length,
    [inventory]
  );

  const criticalStockItems = useMemo(() => {
    return inventory
      .map((item) => {
        const threshold =
          stockThresholdMode === 'item'
            ? Number(item.minThreshold || 0)
            : Number(customStockThreshold || 0);
        return { item, threshold, deficit: threshold - Number(item.quantity || 0) };
      })
      .filter(({ item, threshold }) => Number(item.quantity || 0) < threshold)
      .sort((a, b) => b.deficit - a.deficit || a.item.quantity - b.item.quantity);
  }, [inventory, stockThresholdMode, customStockThreshold]);

  const lateLabOrders = useMemo(
    () =>
      labOrders.filter(
        (o) => o.dueDate && o.dueDate < today && o.status !== 'Reçu au cabinet' && o.status !== 'Validé posé'
      ),
    [labOrders, today]
  );

  const favoritePatients = useMemo(
    () => patients.filter((p) => favoritePatientIds.includes(p.id)),
    [patients, favoritePatientIds]
  );

  const canManageAdminDocs =
    permissions.canManageStaffAndSettings || permissions.canCreateInvoicesAndPayments;
  const canDeleteAdminDocs = permissions.canManageStaffAndSettings;

  const annotatedAdminDocs = useMemo(() => {
    return adminDocuments
      .map((docItem) => {
        const daysRemaining = computeDaysUntilISO(docItem.expiryDate, today);
        const alertWindow = Math.max(1, Number(docItem.alertDaysBefore || 45));
        const isExpired = daysRemaining < 0;
        const isExpiringSoon = daysRemaining >= 0 && daysRemaining <= alertWindow;
        const needsRenewal = isExpired || isExpiringSoon;
        return {
          doc: docItem,
          daysRemaining,
          isExpired,
          isExpiringSoon,
          needsRenewal,
        };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [adminDocuments, today]);

  const expiringAdminDocs = useMemo(
    () => annotatedAdminDocs.filter((entry) => entry.needsRenewal),
    [annotatedAdminDocs]
  );

  const visibleAdminDocs = useMemo(() => {
    const base = adminDocFilter === 'expiring' ? expiringAdminDocs : annotatedAdminDocs;
    if (adminDocCategoryFilter === 'all') return base;
    return base.filter((entry) => entry.doc.category === adminDocCategoryFilter);
  }, [adminDocFilter, adminDocCategoryFilter, expiringAdminDocs, annotatedAdminDocs]);

  const upcomingTodayAppointments = useMemo(() => {
    const now = new Date();
    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return todaysAppointments.filter((a) => {
      if (a.status === 'Terminé' || a.status === 'Absent') return false;
      if (a.status === 'Au fauteuil' || a.status === "Arrivé en salle d'attente") return true;
      return addMinutesToTime(a.startTime, a.durationMinutes) >= nowHHMM;
    });
  }, [todaysAppointments]);

  const timelineAppointments =
    timelineFilter === 'upcoming' ? upcomingTodayAppointments : todaysAppointments;

  const monthlyCareDistribution = useMemo(() => {
    const counts = new Map<string, number>([
      ['Orthodontie', 0],
      ['Soins conservateurs', 0],
      ['Chirurgie', 0],
    ]);
    const dedupKeys = new Set<string>();

    const incrementCategory = (cat: string, dedupKey?: string) => {
      if (dedupKey) {
        if (dedupKeys.has(dedupKey)) return;
        dedupKeys.add(dedupKey);
      }
      counts.set(cat, (counts.get(cat) || 0) + 1);
    };

    for (const apt of appointments) {
      if (!apt.date.startsWith(currentMonth) || apt.status === 'Annulé' || apt.status === 'Absent') {
        continue;
      }
      if (
        careChartScope === 'performed' &&
        apt.status !== 'Terminé' &&
        apt.status !== 'Au fauteuil'
      ) {
        continue;
      }
      const cat = resolveCareCategory(apt.actType, actsCatalog);
      incrementCategory(cat, `${apt.patientId}|${apt.date}|${cat}`);
    }

    for (const inv of invoices) {
      if (inv.status === 'Annulée' || !inv.issueDate.startsWith(currentMonth)) continue;
      for (const item of inv.items || []) {
        const cat = resolveCareCategory(item.actName || item.actCode, actsCatalog);
        const qty = Math.max(1, Number(item.quantity) || 1);
        const key = `${inv.patientId}|${inv.issueDate}|${cat}`;
        if (!dedupKeys.has(key)) {
          dedupKeys.add(key);
          counts.set(cat, (counts.get(cat) || 0) + qty);
        }
      }
    }

    const coreOrder = [
      'Orthodontie',
      'Soins conservateurs',
      'Chirurgie',
      'Endodontie',
      'Prothèse',
      'Implantologie',
      'Parodontologie',
      'Consultations',
    ];

    const entries = Array.from(counts.entries())
      .filter(([cat, count]) => count > 0 || coreOrder.slice(0, 3).includes(cat))
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return coreOrder.indexOf(a[0]) - coreOrder.indexOf(b[0]);
      });

    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    const maxCount = Math.max(1, ...entries.map(([, count]) => count));

    return {
      total,
      maxCount,
      items: entries.map(([category, count]) => ({
        category,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      })),
    };
  }, [appointments, invoices, actsCatalog, currentMonth, careChartScope]);

  // Interactive middle card metrics ("User Growth" style)
  const growthMetrics = useMemo(() => {
    if (growthRange === 'today') {
      const todayPay = payments
        .filter((p) => p.date === today)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const count = todaysAppointments.length;
      const done = todaysAppointments.filter(
        (a) => a.status === 'Terminé' || a.status === 'Au fauteuil'
      ).length;
      const pct = count > 0 ? Math.round((done / count) * 100) : 0;
      return {
        headline: permissions.canViewFinancialTotals ? formatMAD(todayPay) : `${count} RDV`,
        badge: `${count} RDV aujourd'hui`,
        percent: pct,
        leftLabel: `En salle : ${todaysAppointments.filter((a) => a.status === "Arrivé en salle d'attente").length}`,
        rightLabel: `${done} pris en charge`,
      };
    }
    if (growthRange === '7d') {
      const weekPay = payments
        .filter((p) => p.date >= addDaysISO(today, -6) && p.date <= today)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const confirmed7d = next7Appointments.filter((a) => a.status === 'Confirmé').length;
      const pct7d =
        next7Appointments.length > 0
          ? Math.round((confirmed7d / next7Appointments.length) * 100)
          : 0;
      return {
        headline: permissions.canViewFinancialTotals
          ? formatMAD(weekPay)
          : `${next7Appointments.length} RDV`,
        badge: `${next7Appointments.length} RDV à 7j`,
        percent: pct7d,
        leftLabel: `Rappels retard : ${overdueRecalls.length}`,
        rightLabel: `À venir (30j) : ${dueIn30Recalls.length}`,
      };
    }
    if (growthRange === 'all') {
      const allCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const allBilled = invoices
        .filter((i) => i.status !== 'Annulée')
        .reduce((s, i) => s + Number(i.totalAmount || 0), 0);
      const pct = allBilled > 0 ? Math.min(100, Math.round((allCollected / allBilled) * 100)) : 0;
      return {
        headline: permissions.canViewFinancialTotals
          ? formatMAD(allCollected)
          : `${appointments.length} RDV`,
        badge: `${pct}% recouvré`,
        percent: pct,
        leftLabel: `Mutuelles : ${formatMAD(insuranceOutstanding)}`,
        rightLabel: `Impayés : ${formatMAD(unpaidPatientBalances)}`,
      };
    }
    // month (default)
    const pct =
      billedThisMonth > 0
        ? Math.min(100, Math.round((revenueThisMonth / billedThisMonth) * 100))
        : 0;
    return {
      headline: permissions.canViewFinancialTotals
        ? formatMAD(revenueThisMonth)
        : `${appointments.filter((a) => a.date.startsWith(currentMonth)).length} RDV`,
      badge: `${pct}% encaissé`,
      percent: pct,
      leftLabel: `Mutuelles : ${formatMAD(insuranceOutstanding)}`,
      rightLabel: `+${todaysAppointments.length} RDV ce jour`,
    };
  }, [
    growthRange,
    payments,
    today,
    todaysAppointments,
    permissions.canViewFinancialTotals,
    next7Appointments,
    overdueRecalls.length,
    dueIn30Recalls.length,
    invoices,
    appointments,
    billedThisMonth,
    revenueThisMonth,
    currentMonth,
    insuranceOutstanding,
    unpaidPatientBalances,
  ]);

  // Gauge metric ("Customers Volume" style)
  const monthAppointmentsCount = useMemo(
    () => appointments.filter((a) => a.date.startsWith(currentMonth) && a.status !== 'Annulé').length,
    [appointments, currentMonth]
  );
  const attendancePct = useMemo(() => {
    if (appointments.length === 0) return 0;
    const absentCount = appointments.filter((a) => a.status === 'Absent').length;
    return Math.round(((appointments.length - absentCount) / appointments.length) * 100);
  }, [appointments]);

  // 7-day bar chart items ("Statistics" style)
  const statColumns: StatColumnItem[] = useMemo(() => {
    const days = Array.from({ length: 7 }).map((_, i) =>
      statTab === 'appointments' ? addDaysISO(today, i) : addDaysISO(today, i - 6)
    );

    const raw = days.map((iso) => {
      const dtParts = iso.split('-').map(Number);
      const dt = new Date(dtParts[0], dtParts[1] - 1, dtParts[2]);
      const dayShort = dt
        .toLocaleDateString('fr-FR', { weekday: 'short' })
        .replace('.', '');
      const label = dayShort.charAt(0).toUpperCase() + dayShort.slice(1);

      if (statTab === 'appointments') {
        const count = appointments.filter((a) => a.date === iso && a.status !== 'Annulé').length;
        return { key: iso, label, val: count, badge: `${count} RDV` };
      }
      const amt = payments
        .filter((p) => p.date === iso)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      return {
        key: iso,
        label,
        val: amt,
        badge: amt > 0 ? `${Math.round(amt / 1000) || '<1'}k` : '0',
      };
    });

    const maxVal = Math.max(0, ...raw.map((r) => r.val));
    return raw.map((r) => ({
      key: r.key,
      label: r.label,
      value: Math.max(r.val, maxVal > 0 ? maxVal * 0.12 : 1),
      badgeText: r.badge,
      isHighlighted: r.val > 0 && r.val === maxVal,
      isMuted: r.val === 0,
    }));
  }, [statTab, today, appointments, payments]);

  const handleSendWhatsAppRecall = async (recallId: string, patientName: string) => {
    await saveRecord('recalls', recallId, {
      status: 'Envoyé',
      deliveryStatus: 'Délivré',
      lastSentAt: new Date().toISOString(),
    });
    showToast(`Rappel WhatsApp envoyé à ${patientName}.`, 'success');
  };

  const openNewAdminDocModal = () => {
    setEditingAdminDoc(null);
    setAdminDocForm({
      title: '',
      category: 'Licence logicielle',
      provider: '',
      reference: '',
      expiryDate: addDaysISO(today, 30),
      alertDaysBefore: 45,
      notes: '',
    });
    setShowAdminDocModal(true);
  };

  const openRenewAdminDocModal = (docItem: AdminDocument) => {
    setEditingAdminDoc(docItem);
    const baseIso = docItem.expiryDate >= today ? docItem.expiryDate : today;
    setAdminDocForm({
      title: docItem.title,
      category: docItem.category,
      provider: docItem.provider,
      reference: docItem.reference || '',
      expiryDate: addOneYearISO(baseIso),
      alertDaysBefore: docItem.alertDaysBefore || 45,
      notes: docItem.notes || '',
    });
    setShowAdminDocModal(true);
  };

  const handleSaveAdminDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!adminDocForm.title.trim() || !adminDocForm.provider.trim() || !adminDocForm.expiryDate) {
      showToast("Veuillez remplir l'intitulé, le prestataire et la date d'échéance.", 'error');
      return;
    }
    setSavingAdminDoc(true);
    try {
      const daysRemaining = computeDaysUntilISO(adminDocForm.expiryDate, today);
      const alertDays = Math.max(1, Math.min(365, Number(adminDocForm.alertDaysBefore) || 45));
      const computedStatus: AdminDocument['status'] =
        daysRemaining <= alertDays ? 'À renouveler' : 'Actif';

      if (editingAdminDoc) {
        await saveRecord('adminDocuments', editingAdminDoc.id, {
          title: adminDocForm.title.trim().slice(0, 160),
          category: adminDocForm.category,
          provider: adminDocForm.provider.trim().slice(0, 120),
          reference: adminDocForm.reference.trim().slice(0, 80),
          expiryDate: adminDocForm.expiryDate.slice(0, 20),
          alertDaysBefore: alertDays,
          status: computedStatus,
          notes: adminDocForm.notes.trim().slice(0, 300),
        });
        showToast(`Échéance mise à jour pour « ${adminDocForm.title.trim()} ».`, 'success');
      } else {
        await saveRecord(
          'adminDocuments',
          generateSafeId('adm'),
          {
            title: adminDocForm.title.trim().slice(0, 160),
            category: adminDocForm.category,
            provider: adminDocForm.provider.trim().slice(0, 120),
            reference: adminDocForm.reference.trim().slice(0, 80),
            expiryDate: adminDocForm.expiryDate.slice(0, 20),
            alertDaysBefore: alertDays,
            status: computedStatus,
            notes: adminDocForm.notes.trim().slice(0, 300),
            createdBy: user.uid,
          },
          true
        );
        showToast(`Document « ${adminDocForm.title.trim()} » ajouté au suivi.`, 'success');
      }
      setShowAdminDocModal(false);
      setEditingAdminDoc(null);
    } finally {
      setSavingAdminDoc(false);
    }
  };

  const handleDeleteAdminDoc = async (docItem: AdminDocument) => {
    await removeRecord('adminDocuments', docItem.id);
    showToast(`Document « ${docItem.title} » supprimé.`, 'info');
  };

  return (
    <div className="space-y-5">
      {/* Reference Overview Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Aperçu du Cabinet
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Synthèse clinique, planning et suivi financier du {formatDateFR(today)}
            {(lateLabOrders.length > 0 || lowStockCount > 0) && (
              <span className="ml-2 text-amber-700 dark:text-amber-400 font-medium">
                · {lateLabOrders.length} prothèse(s) en retard · {lowStockCount} stock bas
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {permissions.canEditPatientsIdentity && (
            <button
              type="button"
              onClick={() => setActiveSection('patients')}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Patient</span>
            </button>
          )}
          {permissions.canCreateInvoicesAndPayments && (
            <button
              type="button"
              onClick={() => setActiveSection('invoices')}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-[0_1px_4px_rgba(15,23,42,0.04)] transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Facture</span>
            </button>
          )}
          {permissions.canEditAppointments && (
            <button
              type="button"
              onClick={() => setActiveSection('appointments')}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1598C7] hover:bg-[#1082AC] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors whitespace-nowrap"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Nouveau RDV</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Summary & Critical Stock Alerts Widget */}
      <section
        aria-label="Résumé rapide du jour et alertes stock critique"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 dark:divide-slate-800">
          {/* Patients vus aujourd'hui */}
          <div className="lg:col-span-3 p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <Users className="h-3.5 w-3.5 text-[#1598C7] dark:text-sky-400 shrink-0" />
                <span>Patients vus aujourd'hui</span>
              </span>
              <button
                type="button"
                onClick={() => setActiveSection('appointments')}
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#1598C7] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
              >
                <span>Agenda</span>
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>

            <div>
              <p className="font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                {patientsSeenToday}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {completedTodayCount} terminé(s) · {inChairTodayCount} au fauteuil · {todaysAppointments.length} RDV prévus
              </p>
            </div>
          </div>

          {/* Chiffre d'affaires cumulé du mois en cours */}
          <div className="lg:col-span-4 p-5 flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <Wallet className="h-3.5 w-3.5 text-[#1598C7] dark:text-sky-400 shrink-0" />
                <span className="truncate">CA cumulé ({currentMonthLabel})</span>
              </span>
              {permissions.canViewFinancialTotals && (
                <button
                  type="button"
                  onClick={() => setActiveSection('reports')}
                  className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#1598C7] dark:text-sky-400 hover:underline whitespace-nowrap shrink-0"
                >
                  <span>Rapports</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              )}
            </div>

            <div>
              <p className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                {permissions.canViewFinancialTotals
                  ? formatMAD(revenueThisMonth)
                  : 'Accès restreint'}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {permissions.canViewFinancialTotals
                  ? `Facturé : ${formatMAD(billedThisMonth)} · ${monthPayments.length} encaissement(s)`
                  : 'Données financières réservées aux praticiens et au secrétariat'}
              </p>
            </div>
          </div>

          {/* Alertes Stock Critique */}
          <div className="lg:col-span-5 p-5 flex flex-col justify-between gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Package className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  Alertes Stock Critique
                </h2>
                {permissions.canManageInventory && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    · {criticalStockItems.length} produit(s)
                  </span>
                )}
              </div>

              {permissions.canManageInventory && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setStockThresholdMode('item')}
                      className={`rounded-md px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                        stockThresholdMode === 'item'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Seuil fiche
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockThresholdMode('custom')}
                      className={`rounded-md px-2 py-0.5 font-medium transition-colors whitespace-nowrap ${
                        stockThresholdMode === 'custom'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Seuil fixe
                    </button>
                  </div>

                  {stockThresholdMode === 'custom' && (
                    <input
                      type="number"
                      min={1}
                      max={999}
                      aria-label="Seuil critique personnalisé"
                      value={customStockThreshold}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value) || 1);
                        setCustomStockThreshold(val);
                        try {
                          window.localStorage.setItem('dentaflow_stock_alert_threshold', String(val));
                        } catch {
                          // Ignore storage errors
                        }
                      }}
                      className="w-14 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-[11px] font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveSection('inventory')}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#1598C7] dark:text-sky-400 hover:underline whitespace-nowrap"
                  >
                    <span>Stock</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {!permissions.canManageInventory ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Le suivi des consommables est accessible aux profils Titulaire et Assistant(e).
              </p>
            ) : criticalStockItems.length === 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                Aucun produit sous le seuil défini ({stockThresholdMode === 'item' ? 'seuils fiches produits' : `< ${customStockThreshold}`}).
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-36 overflow-y-auto pr-1">
                {criticalStockItems.map(({ item, threshold }) => {
                  const isOut = item.quantity <= 0;
                  return (
                    <div
                      key={item.id}
                      className="py-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {item.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                          {item.sku} · {item.category}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-right">
                        <span className="font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {item.quantity} / {threshold} {item.unit}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${
                            isOut
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span>{isOut ? 'Rupture' : 'Critique'}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Section Patients favoris intégrée au widget */}
        <div className="border-t border-slate-100 dark:border-slate-800 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-400 shrink-0" />
              <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Patients favoris
              </h2>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                · {favoritePatients.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('patients')}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#1598C7] dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              <span>Répertoire patients</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>

          {favoritePatients.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Aucun patient favori épinglé. Cliquez sur l'icône étoile dans la recherche rapide pour retrouver vos dossiers prioritaires ici.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {favoritePatients.map((pat) => (
                <div
                  key={pat.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => openPatientFile(pat.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-400 truncate">
                      {pat.firstName} {pat.lastName}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                      {pat.fileNumber} · {pat.phone}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavoritePatient(pat.id)}
                    aria-label={`Retirer ${pat.firstName} ${pat.lastName} des favoris`}
                    title="Retirer des favoris"
                    className="rounded-lg p-1 text-amber-500 hover:bg-amber-100/70 dark:hover:bg-amber-950/60 transition-colors shrink-0"
                  >
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Widget Planning du jour (Timeline horizontale) */}
      <section
        aria-label="Planning du jour"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Planning du jour
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {upcomingTodayAppointments.length} rendez-vous à venir · {todaysAppointments.length} prévu(s) aujourd'hui
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setTimelineFilter('upcoming')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  timelineFilter === 'upcoming'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                À venir ({upcomingTodayAppointments.length})
              </button>
              <button
                type="button"
                onClick={() => setTimelineFilter('all')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  timelineFilter === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Toute la journée ({todaysAppointments.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveSection('appointments')}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-[#1598C7] dark:text-sky-400 hover:underline whitespace-nowrap"
            >
              <span>Agenda complet</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {timelineAppointments.length === 0 ? (
          <div className="py-5 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
            <p>
              {timelineFilter === 'upcoming' && todaysAppointments.length > 0
                ? 'Tous les rendez-vous du jour ont déjà été pris en charge.'
                : "Aucun rendez-vous programmé aujourd'hui."}
            </p>
            {timelineFilter === 'upcoming' && todaysAppointments.length > 0 && (
              <button
                type="button"
                onClick={() => setTimelineFilter('all')}
                className="text-xs font-semibold text-[#1598C7] dark:text-sky-400 hover:underline"
              >
                Voir toute la journée ({todaysAppointments.length})
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="relative flex items-stretch gap-3 min-w-max pt-1">
              {timelineAppointments.map((apt, index) => {
                const endTime = addMinutesToTime(apt.startTime, apt.durationMinutes);
                const isNext = index === 0 && timelineFilter === 'upcoming';
                const statusColorClass =
                  apt.status === 'Au fauteuil'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : apt.status === "Arrivé en salle d'attente"
                    ? 'text-sky-700 dark:text-sky-400'
                    : apt.status === 'Terminé'
                    ? 'text-slate-500 dark:text-slate-400'
                    : 'text-amber-700 dark:text-amber-400';

                return (
                  <div
                    key={apt.id}
                    className="relative w-56 shrink-0 flex flex-col"
                  >
                    {/* Timeline axis header */}
                    <div className="flex items-center gap-2 mb-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                          isNext
                            ? 'bg-[#1598C7]'
                            : apt.status === 'Terminé'
                            ? 'bg-slate-300 dark:bg-slate-600'
                            : 'bg-[#163B63] dark:bg-sky-400'
                        }`}
                      />
                      <span className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                        {apt.startTime} – {endTime}
                      </span>
                      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                    </div>

                    {/* Timeline slot card */}
                    <div
                      className={`flex-1 rounded-xl border px-3.5 py-2.5 flex flex-col justify-between gap-1.5 transition-colors ${
                        isNext
                          ? 'border-sky-300 dark:border-sky-700 bg-sky-50/70 dark:bg-sky-950/30'
                          : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => openPatientFile(apt.patientId)}
                          className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-400 truncate block text-left w-full"
                        >
                          {apt.patientName}
                        </button>
                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                          {apt.actType}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
                        <span className="text-slate-500 dark:text-slate-400 truncate">
                          {apt.chair}
                        </span>
                        <span className={`font-semibold whitespace-nowrap ${statusColorClass}`}>
                          {apt.status === "Arrivé en salle d'attente" ? 'En salle' : apt.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Top 3-Column Bento Grid (mirrors Sales Overview) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Column 1: Stacked Primary Navy Card + Secondary White Card */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <button
            type="button"
            onClick={() =>
              setActiveSection(permissions.canViewFinancialTotals ? 'payments' : 'appointments')
            }
            className="text-left rounded-2xl bg-gradient-to-br from-[#163B63] to-[#0D2540] dark:from-[#163B63] dark:to-[#0A1E34] p-5 text-white shadow-[0_6px_20px_rgba(15,37,64,0.14)] hover:brightness-105 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-sky-100">
                {permissions.canViewFinancialTotals
                  ? 'Encaissements ce mois'
                  : "Rendez-vous aujourd'hui"}
              </span>
              <MoreHorizontal className="h-4 w-4 text-sky-200/80" />
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-2.5">
              <span className="font-display text-2xl sm:text-3xl font-bold tracking-tight font-mono tabular-nums">
                {permissions.canViewFinancialTotals
                  ? formatMAD(revenueThisMonth)
                  : todaysAppointments.length}
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200 tabular-nums">
                {permissions.canViewFinancialTotals
                  ? `${monthPayments.length} règlements`
                  : `${next7Appointments.length} à 7 jours`}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveSection(
                permissions.canManageExpensesAndClosures
                  ? 'cash-expenses'
                  : permissions.canViewFinancialTotals
                  ? 'invoices'
                  : 'inventory'
              )
            }
            className="flex-1 text-left rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {permissions.canManageExpensesAndClosures
                  ? 'Charges ce mois'
                  : permissions.canViewFinancialTotals
                  ? 'Soldes patients impayés'
                  : 'Alertes stock consommables'}
              </span>
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-2.5">
              <span className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                {permissions.canManageExpensesAndClosures
                  ? formatMAD(expensesThisMonth)
                  : permissions.canViewFinancialTotals
                  ? formatMAD(unpaidPatientBalances)
                  : lowStockCount}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${
                  netThisMonth >= 0
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                }`}
              >
                {permissions.canManageExpensesAndClosures
                  ? `Net : ${formatMAD(netThisMonth)}`
                  : permissions.canViewFinancialTotals
                  ? `Mutuelles : ${formatMAD(insuranceOutstanding)}`
                  : 'Sous seuil min'}
              </span>
            </div>
          </button>
        </div>

        {/* Column 2: Progress / Growth Card */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {permissions.canViewFinancialTotals ? 'Trésorerie & Recouvrement' : 'Activité Fauteuils'}
              </h2>
              <button
                type="button"
                onClick={() => setActiveSection(permissions.canViewFinancialTotals ? 'reports' : 'appointments')}
                aria-label="Ouvrir la vue détaillée"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'today', label: "Aujourd'hui" },
                  { id: '7d', label: '7 jours' },
                  { id: 'month', label: 'Ce mois' },
                  { id: 'all', label: 'Cumul' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setGrowthRange(tab.id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    growthRange === tab.id
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="my-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                {growthMetrics.headline}
              </span>
              <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {growthMetrics.badge}
              </span>
            </div>

            <GradientProgressBar
              percent={growthMetrics.percent}
              label="Recouvrement et activité"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <span>{growthMetrics.leftLabel}</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {growthMetrics.rightLabel}
            </span>
          </div>
        </div>

        {/* Column 3: Segmented Arc Gauge Card ("Customers Volume") */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Volume Patients
            </h2>
            <button
              type="button"
              onClick={() => setActiveSection('patients')}
              aria-label="Voir les patients"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>

          <div className="my-2">
            <SegmentedArcGauge
              value={activePatientsCount}
              subtitle="Patients actifs"
              percentage={attendancePct}
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400 tabular-nums">
              {monthAppointmentsCount} RDV enregistrés ce mois
            </span>
            <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums whitespace-nowrap">
              {attendancePct}% présence
            </span>
          </div>
        </div>
      </div>

      {/* Bottom 2-Column Split: Statistics Columns + Operational Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Bottom-Left: Gradient Bar Chart ("Statistics") */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Statistiques</h2>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStatTab('appointments')}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  statTab === 'appointments'
                    ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                }`}
              >
                Rendez-vous (7j)
              </button>
              {permissions.canViewFinancialTotals && (
                <button
                  type="button"
                  onClick={() => setStatTab('payments')}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    statTab === 'payments'
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                  }`}
                >
                  Encaissements (7j)
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setActiveSection(statTab === 'appointments' ? 'appointments' : 'reports')
                }
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>Détails</span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
            <div className="sm:col-span-4 space-y-1.5 pb-2">
              <p className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                {statTab === 'appointments'
                  ? `${todaysAppointments.length + next7Appointments.length} RDV`
                  : formatMAD(revenueThisMonth)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {statTab === 'appointments'
                  ? 'Charge prévisionnelle des consultations sur les 7 prochains jours.'
                  : 'Volume des encaissements patients & mutuelles sur le mois en cours.'}
              </p>
            </div>

            <div className="sm:col-span-8">
              <StatBarColumns items={statColumns} />
            </div>
          </div>
        </div>

        {/* Bottom-Right: Live Appointments & Recalls Card (soft cyan backdrop like "Most Order by Country") */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-sky-50/80 via-white to-cyan-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950/30 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Activité & Relances en Direct
              </h2>
              <div className="flex items-center gap-1 rounded-full bg-white/80 dark:bg-slate-800 p-0.5 border border-slate-200/70 dark:border-slate-700 text-[11px]">
                <button
                  type="button"
                  onClick={() => setListTab('today')}
                  className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                    listTab === 'today'
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Jour ({todaysAppointments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setListTab('next7')}
                  className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                    listTab === 'next7'
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  7j ({next7Appointments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setListTab('recalls')}
                  className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                    listTab === 'recalls'
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Relances ({overdueRecalls.length})
                </button>
              </div>
            </div>

            {listTab === 'today' && (
              <div className="space-y-2.5">
                {todaysAppointments.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Aucun rendez-vous prévu aujourd'hui.
                  </p>
                ) : (
                  todaysAppointments.slice(0, 4).map((apt) => {
                    const waitingMin =
                      apt.status === "Arrivé en salle d'attente"
                        ? computeWaitingMinutes(apt.arrivedAt)
                        : 0;
                    return (
                      <div
                        key={apt.id}
                        className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/95 dark:bg-slate-800/90 px-3.5 py-2.5 shadow-[0_2px_6px_rgba(15,23,42,0.03)]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-8 w-8 rounded-full bg-sky-100 dark:bg-sky-900/60 text-[#163B63] dark:text-sky-300 font-bold text-[11px] flex items-center justify-center shrink-0">
                            {apt.patientName.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openPatientFile(apt.patientId)}
                              className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-400 truncate block text-left"
                            >
                              {apt.patientName}
                            </button>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {apt.actType} · {apt.chair}
                              {waitingMin > 0 ? ` · ${waitingMin} min` : ''}
                            </p>
                          </div>
                        </div>
                        <span className="rounded-full bg-[#1598C7] px-3 py-1 text-[11px] font-semibold text-white font-mono tabular-nums shrink-0">
                          {apt.startTime}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {listTab === 'next7' && (
              <div className="space-y-2.5">
                {next7Appointments.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Aucun rendez-vous sur les 7 prochains jours.
                  </p>
                ) : (
                  next7Appointments.slice(0, 4).map((apt) => (
                    <div
                      key={apt.id}
                      className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/95 dark:bg-slate-800/90 px-3.5 py-2.5 shadow-[0_2px_6px_rgba(15,23,42,0.03)]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center justify-center shrink-0">
                          {apt.patientName.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => openPatientFile(apt.patientId)}
                            className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-400 truncate block text-left"
                          >
                            {apt.patientName}
                          </button>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {formatDateFR(apt.date)} · {apt.actType}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-[#1598C7] px-3 py-1 text-[11px] font-semibold text-white font-mono tabular-nums shrink-0">
                        {apt.startTime}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {listTab === 'recalls' && (
              <div className="space-y-2.5">
                {overdueRecalls.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    Aucun rappel en retard.
                  </p>
                ) : (
                  overdueRecalls.slice(0, 4).map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/95 dark:bg-slate-800/90 px-3.5 py-2.5 shadow-[0_2px_6px_rgba(15,23,42,0.03)]"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => openPatientFile(rec.patientId)}
                          className="text-xs font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-700 dark:hover:text-sky-400 truncate block text-left"
                        >
                          {rec.patientName}
                        </button>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {rec.reason} · {formatDateFR(rec.dueDate)}
                        </p>
                      </div>
                      {actualRole !== 'assistant' && (
                        <button
                          type="button"
                          onClick={() => handleSendWhatsAppRecall(rec.id, rec.patientName)}
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-600 hover:bg-emerald-700 px-3 py-1 text-[11px] font-semibold text-white shrink-0"
                        >
                          <MessageCircle className="h-3 w-3" />
                          <span>WhatsApp</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="mt-3 pt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 dark:text-slate-400">
              {listTab === 'recalls'
                ? `${dueIn30Recalls.length} relance(s) à venir sous 30 jours`
                : 'Cliquez sur un patient pour ouvrir son dossier 360°'}
            </span>
            <button
              type="button"
              onClick={() =>
                setActiveSection(listTab === 'recalls' ? 'recalls' : 'appointments')
              }
              className="font-semibold text-[#1598C7] dark:text-sky-400 hover:underline"
            >
              Tout afficher
            </button>
          </div>
        </div>
      </div>

      {/* Widget Graphique à barres : Répartition des types de soins du mois */}
      <section
        aria-label="Répartition des types de soins du mois"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Répartition des types de soins ({currentMonthLabel})
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {monthlyCareDistribution.total} acte(s) comptabilisé(s) sur le mois en cours
              </p>
            </div>
          </div>

          <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setCareChartScope('performed')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                careChartScope === 'performed'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Réalisés & facturés
            </button>
            <button
              type="button"
              onClick={() => setCareChartScope('all')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                careChartScope === 'all'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Tous les soins du mois
            </button>
          </div>
        </div>

        {monthlyCareDistribution.total === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Aucun soin enregistré pour ce mois avec le filtre sélectionné.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            {/* Graphique à barres verticales */}
            <div className="lg:col-span-8">
              <div className="flex items-end gap-3 sm:gap-4 h-48 pt-4 pb-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
                {monthlyCareDistribution.items.map((item, idx) => {
                  const heightPct =
                    item.count > 0
                      ? Math.max(14, Math.round((item.count / monthlyCareDistribution.maxCount) * 100))
                      : 4;
                  const isTop = idx === 0 && item.count > 0;
                  return (
                    <div
                      key={item.category}
                      className="flex-1 min-w-[78px] h-full flex flex-col items-center justify-end gap-1.5"
                    >
                      <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {item.count} · {item.percent}%
                      </span>
                      <div className="w-full max-w-[46px] flex-1 flex items-end justify-center">
                        <svg
                          viewBox="0 0 44 100"
                          className="w-full h-32"
                          role="img"
                          aria-label={`${item.category} : ${item.count} acte(s) (${item.percent}%)`}
                        >
                          <defs>
                            <linearGradient id={`care-grad-${idx}`} x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor={isTop ? '#1598C7' : '#38C8B8'} />
                              <stop offset="100%" stopColor={isTop ? '#163B63' : '#1598C7'} />
                            </linearGradient>
                          </defs>
                          <rect
                            x="4"
                            y={100 - heightPct}
                            width="36"
                            height={heightPct}
                            rx="7"
                            fill={item.count === 0 ? '#CBD5E1' : `url(#care-grad-${idx})`}
                            className={item.count === 0 ? 'dark:fill-slate-800' : ''}
                          />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-start gap-3 sm:gap-4 pt-2 overflow-x-auto">
                {monthlyCareDistribution.items.map((item) => (
                  <div key={item.category} className="flex-1 min-w-[78px] text-center">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-tight block">
                      {item.category}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Synthèse chiffrée par type de soin */}
            <div className="lg:col-span-4 divide-y divide-slate-100 dark:divide-slate-800 border-t lg:border-t-0 lg:border-l border-slate-100 dark:border-slate-800 pt-3 lg:pt-0 lg:pl-5">
              {monthlyCareDistribution.items.map((item) => (
                <div
                  key={item.category}
                  className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
                >
                  <span className="font-medium text-slate-700 dark:text-slate-200 truncate">
                    {item.category}
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {item.count} acte{item.count > 1 ? 's' : ''} ({item.percent}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section Documents administratifs à renouveler */}
      <section
        aria-label="Documents administratifs à renouveler"
        className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Documents administratifs à renouveler
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {expiringAdminDocs.length} alerte{expiringAdminDocs.length > 1 ? 's' : ''} d'expiration · {adminDocuments.length} licence{adminDocuments.length > 1 ? 's' : ''} et contrat{adminDocuments.length > 1 ? 's' : ''} suivi{adminDocuments.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setAdminDocFilter('expiring')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  adminDocFilter === 'expiring'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                À renouveler ({expiringAdminDocs.length})
              </button>
              <button
                type="button"
                onClick={() => setAdminDocFilter('all')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  adminDocFilter === 'all'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Tous ({adminDocuments.length})
              </button>
            </div>

            <select
              aria-label="Filtrer par catégorie administrative"
              value={adminDocCategoryFilter}
              onChange={(e) =>
                setAdminDocCategoryFilter(e.target.value as 'all' | AdminDocumentCategory)
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-700 dark:text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="all">Toutes catégories</option>
              <option value="Licence logicielle">Licences logicielles</option>
              <option value="Contrat d'entretien">Contrats d'entretien</option>
              <option value="Assurance & Conformité">Assurance & Conformité</option>
              <option value="Autre">Autre</option>
            </select>

            {canManageAdminDocs && (
              <button
                type="button"
                onClick={openNewAdminDocModal}
                className="inline-flex items-center gap-1 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>Ajouter</span>
              </button>
            )}
          </div>
        </div>

        {visibleAdminDocs.length === 0 ? (
          <div className="py-6 text-center space-y-1.5">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {adminDocuments.length === 0
                ? 'Aucun contrat ou licence administrative enregistré pour le moment.'
                : 'Aucune licence logicielle ni contrat d’entretien à renouveler dans la fenêtre d’alerte.'}
            </p>
            {adminDocuments.length > 0 && adminDocFilter === 'expiring' && (
              <button
                type="button"
                onClick={() => setAdminDocFilter('all')}
                className="text-xs font-semibold text-[#1598C7] dark:text-sky-400 hover:underline"
              >
                Afficher tous les documents ({adminDocuments.length})
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleAdminDocs.map(({ doc: docItem, daysRemaining, isExpired, isExpiringSoon }) => {
              const isUrgent = isExpired || daysRemaining <= 15;
              const statusToneClass = isUrgent
                ? 'text-red-700 dark:text-red-400'
                : isExpiringSoon
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-700 dark:text-emerald-400';

              const statusText = isExpired
                ? `Expiré depuis ${Math.abs(daysRemaining)} j`
                : daysRemaining === 0
                ? "Expire aujourd'hui"
                : isExpiringSoon
                ? `Expire dans ${daysRemaining} j`
                : `Valide (${daysRemaining} j)`;

              return (
                <div
                  key={docItem.id}
                  className="py-3 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {docItem.title}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      <span>{docItem.category}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{docItem.provider}</span>
                      {docItem.reference && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono tabular-nums">Réf. {docItem.reference}</span>
                        </>
                      )}
                      {docItem.notes && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span>{docItem.notes}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <div className="text-left sm:text-right">
                      <p className="font-mono text-[11px] font-medium tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        Échéance : {formatDateFR(docItem.expiryDate)}
                      </p>
                      <p
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold font-mono tabular-nums whitespace-nowrap ${statusToneClass}`}
                      >
                        {isExpired || isExpiringSoon ? (
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                        )}
                        <span>{statusText}</span>
                      </p>
                    </div>

                    {canManageAdminDocs && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openRenewAdminDocModal(docItem)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                        >
                          <RefreshCw className="h-3 w-3 shrink-0" />
                          <span>Renouveler</span>
                        </button>
                        {canDeleteAdminDocs && (
                          <button
                            type="button"
                            onClick={() => handleDeleteAdminDoc(docItem)}
                            aria-label={`Supprimer ${docItem.title}`}
                            title="Supprimer ce suivi"
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modale Ajout / Renouvellement document administratif */}
      {showAdminDocModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            editingAdminDoc
              ? 'Renouveler un document administratif'
              : 'Ajouter un document administratif'
          }
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[#1598C7] dark:text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {editingAdminDoc
                    ? 'Renouveler / Mettre à jour l’échéance'
                    : 'Nouvelle licence ou contrat d’entretien'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAdminDocModal(false);
                  setEditingAdminDoc(null);
                }}
                aria-label="Fermer"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdminDoc} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Intitulé du contrat ou de la licence *
                </label>
                <input
                  required
                  maxLength={160}
                  value={adminDocForm.title}
                  onChange={(e) => setAdminDocForm({ ...adminDocForm, title: e.target.value })}
                  placeholder="Ex: Licence imagerie radio CBCT ou Contrat entretien fauteuil"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={adminDocForm.category}
                    onChange={(e) =>
                      setAdminDocForm({
                        ...adminDocForm,
                        category: e.target.value as AdminDocumentCategory,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    <option value="Licence logicielle">Licence logicielle</option>
                    <option value="Contrat d'entretien">Contrat d'entretien</option>
                    <option value="Assurance & Conformité">Assurance & Conformité</option>
                    <option value="Autre">Autre</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Éditeur / Prestataire *
                  </label>
                  <input
                    required
                    maxLength={120}
                    value={adminDocForm.provider}
                    onChange={(e) =>
                      setAdminDocForm({ ...adminDocForm, provider: e.target.value })
                    }
                    placeholder="Ex: Maghreb Dental Tech"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Référence / N° contrat
                  </label>
                  <input
                    maxLength={80}
                    value={adminDocForm.reference}
                    onChange={(e) =>
                      setAdminDocForm({ ...adminDocForm, reference: e.target.value })
                    }
                    placeholder="CTR-2026-01"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date d'expiration *
                  </label>
                  <input
                    required
                    type="date"
                    value={adminDocForm.expiryDate}
                    onChange={(e) =>
                      setAdminDocForm({ ...adminDocForm, expiryDate: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Alerte avant (jours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={adminDocForm.alertDaysBefore}
                    onChange={(e) =>
                      setAdminDocForm({
                        ...adminDocForm,
                        alertDaysBefore: Math.max(1, Math.min(365, Number(e.target.value) || 45)),
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes / Détails d'équipement
                </label>
                <input
                  maxLength={300}
                  value={adminDocForm.notes}
                  onChange={(e) => setAdminDocForm({ ...adminDocForm, notes: e.target.value })}
                  placeholder="Ex: Couvre le fauteuil 1, compresseur et capteur RVG"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminDocModal(false);
                    setEditingAdminDoc(null);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingAdminDoc}
                  className="rounded-lg bg-[#1598C7] hover:bg-[#1082AC] px-4 py-2 font-semibold text-white disabled:opacity-60 whitespace-nowrap"
                >
                  {savingAdminDoc
                    ? 'Enregistrement...'
                    : editingAdminDoc
                    ? 'Valider le renouvellement'
                    : 'Ajouter au suivi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
