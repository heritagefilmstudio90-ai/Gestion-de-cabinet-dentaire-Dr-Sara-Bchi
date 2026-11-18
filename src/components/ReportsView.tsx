import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  ClipboardList,
  Copy,
  FileArchive,
  FileDown,
  FileSpreadsheet,
  Lock,
  MoreHorizontal,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { exportSecureCsv, formatMAD, todayISO } from '../lib/formatters';
import { canAccessSection, ClinicalNote, TOOTH_STATUS_META } from '../types/dental';
import { AccessDeniedView } from './AccessDeniedView';
import type {
  ExpenseCategoryReportRow,
  FinancialInvoiceRow,
  MonthlyStatRow,
  PaymentMethodReportRow,
  PractitionerReportRow,
} from '../lib/reportPdf';
import {
  GradientProgressBar,
  SegmentedArcGauge,
  StatBarColumns,
  StatColumnItem,
} from './AnalyticsPrimitives';

function formatMonthLabelFR(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const dt = new Date(y, m - 1, 1);
  const formatted = dt.toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortMonthFR(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const dt = new Date(y, m - 1, 1);
  const short = dt.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  return `${short.charAt(0).toUpperCase() + short.slice(1)} ${String(y).slice(-2)}`;
}

export const ReportsView: React.FC = () => {
  const {
    activeRole,
    patients,
    staffList,
    invoices,
    payments,
    clinicalActs,
    treatmentPlans,
    appointments,
    expenses,
    clinicSettings,
    staffProfile,
    fetchClinicalNotesForExport,
    logActivity,
    showToast,
  } = useClinic();

  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [monthlyDisplayMode, setMonthlyDisplayMode] = useState<'chart' | 'table'>('chart');
  const [chartMetric, setChartMetric] = useState<'billed' | 'collected' | 'expenses'>('collected');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const [csvSecurityMode, setCsvSecurityMode] = useState<'complete' | 'pseudonymized'>('complete');
  const [archiveScope, setArchiveScope] = useState<'all' | 'period'>('all');
  const [exportingArchive, setExportingArchive] = useState<null | 'patients' | 'treatments' | 'both'>(null);
  const [copiedHashFile, setCopiedHashFile] = useState<string | null>(null);
  const [lastArchiveReceipt, setLastArchiveReceipt] = useState<{
    files: Array<{ name: string; rows: number; sha256: string; byteSize: number }>;
    mode: 'complete' | 'pseudonymized';
    exportedAt: string;
  } | null>(null);

  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    keys.add(todayISO().slice(0, 7));
    invoices.forEach((i) => i.issueDate && keys.add(i.issueDate.slice(0, 7)));
    payments.forEach((p) => p.date && keys.add(p.date.slice(0, 7)));
    clinicalActs.forEach((a) => a.date && keys.add(a.date.slice(0, 7)));
    expenses.forEach((e) => e.date && keys.add(e.date.slice(0, 7)));
    appointments.forEach((a) => a.date && keys.add(a.date.slice(0, 7)));
    return Array.from(keys)
      .filter((k) => /^\d{4}-\d{2}$/.test(k))
      .sort((a, b) => b.localeCompare(a));
  }, [invoices, payments, clinicalActs, expenses, appointments]);

  const periodLabel =
    selectedMonth === 'all' ? 'Toutes les périodes (Cumul)' : formatMonthLabelFR(selectedMonth);
  const periodSlug = selectedMonth === 'all' ? 'cumul' : selectedMonth;

  const activeInvoices = useMemo(
    () =>
      invoices.filter(
        (i) =>
          i.status !== 'Annulée' &&
          (selectedMonth === 'all' || (i.issueDate || '').startsWith(selectedMonth))
      ),
    [invoices, selectedMonth]
  );

  const filteredPayments = useMemo(
    () =>
      payments.filter(
        (p) => selectedMonth === 'all' || (p.date || '').startsWith(selectedMonth)
      ),
    [payments, selectedMonth]
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter(
        (e) => selectedMonth === 'all' || (e.date || '').startsWith(selectedMonth)
      ),
    [expenses, selectedMonth]
  );

  const filteredAppointments = useMemo(
    () =>
      appointments.filter(
        (a) => selectedMonth === 'all' || (a.date || '').startsWith(selectedMonth)
      ),
    [appointments, selectedMonth]
  );

  const filteredClinicalActs = useMemo(
    () =>
      clinicalActs.filter(
        (a) => selectedMonth === 'all' || (a.date || '').startsWith(selectedMonth)
      ),
    [clinicalActs, selectedMonth]
  );

  const clinicalActsTotals = useMemo(() => {
    let price = 0;
    let received = 0;
    let remaining = 0;
    let finished = 0;
    for (const act of filteredClinicalActs) {
      price += Number(act.price || 0);
      received += Number(act.receivedAmount || 0);
      remaining += Number(act.remainingAmount || 0);
      if (act.status === 'Fini') finished += 1;
    }
    return { price, received, remaining, finished };
  }, [filteredClinicalActs]);

  const totalBilled = useMemo(
    () => activeInvoices.reduce((s, i) => s + i.totalAmount, 0),
    [activeInvoices]
  );

  const totalCollected = useMemo(
    () => filteredPayments.reduce((s, p) => s + p.amount, 0),
    [filteredPayments]
  );

  const totalExpenses = useMemo(
    () => filteredExpenses.reduce((s, e) => s + e.amount, 0),
    [filteredExpenses]
  );

  const netMargin = totalCollected - totalExpenses;

  const collectionRate =
    totalBilled > 0 ? Math.min(100, Math.round((totalCollected / totalBilled) * 100)) : 0;

  const { outstandingBalance, insurancePendingTotal, patientPendingTotal } = useMemo(() => {
    let totalRem = 0;
    let insRem = 0;
    let patRem = 0;
    for (const inv of activeInvoices) {
      const totalPaid = Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0);
      const rem = Math.max(0, Number(inv.totalAmount || 0) - totalPaid);
      const insDue = Math.max(0, Number(inv.insuranceShare || 0) - Number(inv.insurancePaidAmount || 0));
      const clampedIns = Math.min(rem, insDue);
      totalRem += rem;
      insRem += clampedIns;
      patRem += Math.max(0, rem - clampedIns);
    }
    return {
      outstandingBalance: totalRem,
      insurancePendingTotal: insRem,
      patientPendingTotal: patRem,
    };
  }, [activeInvoices]);

  const acceptedQuotesCount = treatmentPlans.filter(
    (p) => p.status === 'Accepté' || p.status === 'En cours' || p.status === 'Terminé'
  ).length;
  const quoteConversion =
    treatmentPlans.length > 0
      ? Math.round((acceptedQuotesCount / treatmentPlans.length) * 100)
      : 0;

  const avgBasket =
    activeInvoices.length > 0 ? Math.round(totalBilled / activeInvoices.length) : 0;
  const noShowCount = filteredAppointments.filter((a) => a.status === 'Absent').length;
  const noShowRate =
    filteredAppointments.length > 0
      ? Math.round((noShowCount / filteredAppointments.length) * 100)
      : 0;

  const monthlyStats: MonthlyStatRow[] = useMemo(() => {
    const keys = [...availableMonths].sort((a, b) => a.localeCompare(b));
    return keys.map((monthKey) => {
      const monthInvoices = invoices.filter(
        (i) => i.status !== 'Annulée' && (i.issueDate || '').startsWith(monthKey)
      );
      const monthPayments = payments.filter((p) => (p.date || '').startsWith(monthKey));
      const monthExpenses = expenses.filter((e) => (e.date || '').startsWith(monthKey));
      const monthApts = appointments.filter((a) => (a.date || '').startsWith(monthKey));

      const billed = monthInvoices.reduce((s, i) => s + i.totalAmount, 0);
      const collected = monthPayments.reduce((s, p) => s + p.amount, 0);
      const exp = monthExpenses.reduce((s, e) => s + e.amount, 0);
      const aptNoShow = monthApts.filter((a) => a.status === 'Absent').length;

      return {
        monthKey,
        monthLabel: formatShortMonthFR(monthKey),
        invoiceCount: monthInvoices.length,
        billed,
        collected,
        expenses: exp,
        netMargin: collected - exp,
        appointmentsTotal: monthApts.length,
        appointmentsNoShow: aptNoShow,
      };
    });
  }, [availableMonths, invoices, payments, expenses, appointments]);

  const chartMonths = useMemo(() => monthlyStats.slice(-7), [monthlyStats]);

  const statColumns: StatColumnItem[] = useMemo(() => {
    const values = chartMonths.map((m) =>
      chartMetric === 'billed' ? m.billed : chartMetric === 'expenses' ? m.expenses : m.collected
    );
    const maxVal = Math.max(0, ...values);

    return chartMonths.map((m, idx) => {
      const v = values[idx];
      return {
        key: m.monthKey,
        label: m.monthLabel,
        value: Math.max(v, maxVal > 0 ? maxVal * 0.14 : 1),
        badgeText: v > 0 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : '0',
        isHighlighted: v > 0 && v === maxVal,
        isMuted: v === 0,
      };
    });
  }, [chartMonths, chartMetric]);

  const byPractitioner: PractitionerReportRow[] = useMemo(() => {
    const map: Record<string, { name: string; billed: number; count: number }> = {};
    for (const inv of activeInvoices) {
      const key = inv.practitionerName || 'Praticien';
      if (!map[key]) map[key] = { name: key, billed: 0, count: 0 };
      map[key].billed += inv.totalAmount;
      map[key].count += 1;
    }
    return Object.values(map)
      .sort((a, b) => b.billed - a.billed)
      .map((item) => ({
        ...item,
        sharePercent: totalBilled > 0 ? Math.round((item.billed / totalBilled) * 100) : 0,
      }));
  }, [activeInvoices, totalBilled]);

  const byPaymentMethod: PaymentMethodReportRow[] = useMemo(() => {
    const methods = ['Espèces', 'Virement', 'Solde Portefeuille', 'Carte bancaire', 'Chèque'];
    const map: Record<string, { method: string; count: number; amount: number }> = {};
    methods.forEach((m) => {
      map[m] = { method: m, count: 0, amount: 0 };
    });
    for (const p of filteredPayments) {
      if (!map[p.method]) map[p.method] = { method: p.method, count: 0, amount: 0 };
      map[p.method].count += 1;
      map[p.method].amount += p.amount;
    }
    return Object.values(map)
      .filter((r) => r.count > 0 || methods.includes(r.method))
      .sort((a, b) => b.amount - a.amount)
      .map((r) => ({
        ...r,
        sharePercent: totalCollected > 0 ? Math.round((r.amount / totalCollected) * 100) : 0,
      }));
  }, [filteredPayments, totalCollected]);

  const byExpenseCategory: ExpenseCategoryReportRow[] = useMemo(() => {
    const map: Record<string, { category: string; count: number; amount: number }> = {};
    for (const exp of filteredExpenses) {
      if (!map[exp.category]) map[exp.category] = { category: exp.category, count: 0, amount: 0 };
      map[exp.category].count += 1;
      map[exp.category].amount += exp.amount;
    }
    return Object.values(map)
      .sort((a, b) => b.amount - a.amount)
      .map((r) => ({
        ...r,
        sharePercent: totalExpenses > 0 ? Math.round((r.amount / totalExpenses) * 100) : 0,
      }));
  }, [filteredExpenses, totalExpenses]);

  const invoicesForPdf: FinancialInvoiceRow[] = useMemo(
    () =>
      [...activeInvoices]
        .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
        .map((inv) => {
          const totalPaid = Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0);
          return {
            invoiceNumber: inv.invoiceNumber,
            issueDate: inv.issueDate,
            patientName: inv.patientName,
            insuranceType: inv.insuranceType || 'Aucune',
            totalAmount: inv.totalAmount,
            paidAmount: totalPaid,
            remainingAmount: Math.max(0, inv.totalAmount - totalPaid),
            status: inv.status,
          };
        }),
    [activeInvoices]
  );

  const topClinicalActs = useMemo(() => {
    const map: Record<string, { name: string; count: number; total: number }> = {};
    for (const act of filteredClinicalActs) {
      const name = act.actName || 'Acte clinique';
      if (!map[name]) map[name] = { name, count: 0, total: 0 };
      map[name].count += 1;
      map[name].total += Number(act.price || 0);
    }
    return Object.values(map)
      .sort((a, b) => b.total - a.total || b.count - a.count)
      .slice(0, 10);
  }, [filteredClinicalActs]);

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const { exportFinancialReportPdf } = await import('../lib/reportPdf');
      const fileName = exportFinancialReportPdf({
        clinicSettings,
        periodLabel,
        periodSlug,
        generatedBy: staffProfile?.displayName || 'Direction',
        summary: {
          totalBilled,
          totalCollected,
          totalExpenses,
          netMargin,
          outstandingBalance,
          collectionRate,
          quoteConversion,
          acceptedQuotesCount,
          totalQuotesCount: treatmentPlans.length,
          avgBasket,
          noShowRate,
          noShowCount,
          totalAppointments: filteredAppointments.length,
          insurancePendingTotal,
          patientPendingTotal,
        },
        monthlyStats,
        byPractitioner,
        byPaymentMethod,
        byExpenseCategory,
        invoicesList: invoicesForPdf,
        clinicalActivity: {
          totalActs: filteredClinicalActs.length,
          finishedActs: clinicalActsTotals.finished,
          totalHonoraires: clinicalActsTotals.price,
          totalReceived: clinicalActsTotals.received,
          totalRemaining: clinicalActsTotals.remaining,
          topActs: topClinicalActs,
        },
      });
      showToast(`Rapport PDF généré (${fileName}).`, 'success');
    } catch (error) {
      console.error('Erreur export PDF:', error);
      showToast('Impossible de générer le rapport PDF.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    staffList.forEach((s) => {
      if (s.uid) map.set(s.uid, s.displayName);
      if (s.id) map.set(s.id, s.displayName);
    });
    return map;
  }, [staffList]);

  const planItemsTotalCount = useMemo(
    () =>
      treatmentPlans.reduce(
        (sum, plan) => sum + (plan.items && plan.items.length > 0 ? plan.items.length : plan.rawActsText ? 1 : 0),
        0
      ),
    [treatmentPlans]
  );

  const buildPatientsArchivePayload = (mode: 'complete' | 'pseudonymized') => {
    const headers = [
      'N° Dossier',
      'Nom & Prénom',
      'Genre',
      mode === 'pseudonymized' ? 'Année Naissance' : 'Date Naissance',
      'CIN',
      'Téléphone',
      'Email',
      'Adresse',
      'Mutuelle',
      'N° Immatriculation',
      'Taux Couverture %',
      'Dentition',
      'Praticien Référent',
      'Dents Traitées (Odontogramme)',
      'Alertes Médicales / Anamnèse',
      'Total Facturé MAD',
      'Reste Dû MAD',
      'Dernier RDV',
      'Statut Dossier',
    ];

    const billingByPatient = new Map<string, { billed: number; paid: number }>();
    for (const inv of invoices) {
      if (inv.status === 'Annulée') continue;
      const prev = billingByPatient.get(inv.patientId) || { billed: 0, paid: 0 };
      prev.billed += Number(inv.totalAmount || 0);
      prev.paid += Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0);
      billingByPatient.set(inv.patientId, prev);
    }

    const lastAptByPatient = new Map<string, string>();
    for (const apt of appointments) {
      if (apt.status === 'Annulé') continue;
      const cur = lastAptByPatient.get(apt.patientId) || '';
      if ((apt.date || '') > cur) {
        lastAptByPatient.set(apt.patientId, apt.date || '');
      }
    }

    const rows: Array<Array<string | number>> = patients.map((p) => {
      const isPseudo = mode === 'pseudonymized';
      const displayName = isPseudo
        ? `Patient #${p.fileNumber || p.id.slice(-6)}`
        : p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();

      const odontogramSummary = Object.entries(p.odontogram || {})
        .filter(([, rec]) => rec && rec.status !== 'sain')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tooth, rec]) => {
          const meta = TOOTH_STATUS_META[rec.status];
          return `${tooth}:${meta?.short || rec.status}`;
        })
        .join(' | ');

      const medicalFlags: string[] = [];
      if (p.anamnesis?.cardiovascular) medicalFlags.push('Cardiovasculaire');
      if (p.anamnesis?.diabetes) medicalFlags.push('Diabète');
      if (p.anamnesis?.hemophilia) medicalFlags.push('Hémophilie/Anticoag.');
      if (p.anamnesis?.pregnancy) medicalFlags.push('Grossesse');
      if (p.anamnesis?.drugAllergies) medicalFlags.push(`Allergies: ${p.anamnesis.drugAllergies}`);
      if (p.anamnesis?.chronicConditions) medicalFlags.push(`Antécédents: ${p.anamnesis.chronicConditions}`);
      if (p.alertSummary && !medicalFlags.includes(p.alertSummary)) {
        medicalFlags.push(p.alertSummary);
      }

      const invStats = billingByPatient.get(p.id);
      const totalBilledVal = invStats ? invStats.billed : Number(p.totalBilled || 0);
      const remainingVal = invStats
        ? Math.max(0, invStats.billed - invStats.paid)
        : Number(p.remainingDue || 0);
      const lastApt = p.lastAppointmentDate || lastAptByPatient.get(p.id) || '';

      return [
        p.fileNumber || p.id,
        displayName,
        p.gender || '',
        isPseudo ? (p.birthDate ? p.birthDate.slice(0, 4) : '') : p.birthDate || '',
        isPseudo ? (p.cin ? 'MASQUÉ (RGPD)' : '') : p.cin || '',
        isPseudo ? (p.phone ? 'MASQUÉ (RGPD)' : '') : p.phone || '',
        isPseudo ? (p.email ? 'MASQUÉ (RGPD)' : '') : p.email || '',
        isPseudo ? (p.address ? 'MASQUÉ (RGPD)' : '') : p.address || '',
        p.insuranceType || 'Aucune',
        isPseudo ? (p.insuranceNumber ? 'MASQUÉ (RGPD)' : '') : p.insuranceNumber || '',
        Number(p.coverageRate || 0),
        p.dentitionMode || 'adulte',
        staffNameById.get(p.assignedPractitionerId) || p.assignedPractitionerId || '',
        odontogramSummary,
        medicalFlags.join(' · '),
        totalBilledVal,
        remainingVal,
        lastApt,
        p.active ? 'Actif' : 'Archivé',
      ];
    });

    return { headers, rows };
  };

  const buildTreatmentHistoryPayload = (
    mode: 'complete' | 'pseudonymized',
    fetchedNotes: ClinicalNote[]
  ) => {
    const isPseudo = mode === 'pseudonymized';
    const patientById = new Map(patients.map((p) => [p.id, p]));
    const filterByPeriod = archiveScope === 'period' && selectedMonth !== 'all';

    type TreatmentArchiveRow = {
      sortDate: string;
      cells: Array<string | number>;
    };
    const collected: TreatmentArchiveRow[] = [];

    const resolvePatientLabel = (patientId: string, fallbackName: string, fallbackFile?: string) => {
      const pat = patientById.get(patientId);
      const fileNum = fallbackFile || pat?.fileNumber || patientId.slice(-6);
      if (isPseudo) {
        return { fileNum, name: `Patient #${fileNum}` };
      }
      const full = pat?.fullName || (pat ? `${pat.firstName || ''} ${pat.lastName || ''}`.trim() : '') || fallbackName;
      return { fileNum, name: full };
    };

    // 1. Actes cliniques (actes.csv)
    for (const act of clinicalActs) {
      const dateVal = (act.realizationDate || act.date || '').slice(0, 10);
      if (filterByPeriod && !dateVal.startsWith(selectedMonth)) continue;
      const { fileNum, name } = resolvePatientLabel(act.patientId, act.patientName, act.patientFileNumber);
      collected.push({
        sortDate: dateVal,
        cells: [
          dateVal,
          'Acte Clinique',
          fileNum,
          name,
          act.id,
          act.teeth || '',
          act.actName || '',
          '',
          act.practitionerName || staffNameById.get(act.practitionerId) || '',
          Number(act.price || 0),
          Number(act.receivedAmount || 0),
          Number(act.remainingAmount || 0),
          act.status || 'En attente',
        ],
      });
    }

    // 2. Notes cliniques Firestore (patients/{id}/clinicalNotes)
    for (const note of fetchedNotes) {
      const dateVal = (note.date || '').slice(0, 10);
      if (filterByPeriod && !dateVal.startsWith(selectedMonth)) continue;
      const { fileNum, name } = resolvePatientLabel(note.patientId, 'Patient');
      const toothDisplay = note.tooth
        ? note.faces
          ? `${note.tooth} (${note.faces})`
          : note.tooth
        : '';
      const details = [
        note.materials ? `Matériaux: ${note.materials}` : '',
        note.report || '',
      ]
        .filter(Boolean)
        .join(' · ');
      const amountVal = Number(note.amount || 0);
      collected.push({
        sortDate: dateVal,
        cells: [
          dateVal,
          'Note Clinique Fauteuil',
          fileNum,
          name,
          note.actCode || note.id,
          toothDisplay,
          note.actName || '',
          details,
          note.practitionerName || staffNameById.get(note.practitionerId) || '',
          amountVal,
          note.billed ? amountVal : 0,
          note.billed ? 0 : amountVal,
          note.billed ? 'Facturé' : 'Non facturé',
        ],
      });
    }

    // 3. Lignes des plans de traitement / devis
    for (const plan of treatmentPlans) {
      const dateVal = (plan.quoteDate || '').slice(0, 10);
      if (filterByPeriod && !dateVal.startsWith(selectedMonth)) continue;
      const { fileNum, name } = resolvePatientLabel(
        plan.patientId,
        plan.patientName,
        plan.patientFileNumber
      );
      const practitioner = plan.practitionerName || staffNameById.get(plan.practitionerId) || '';

      if (plan.items && plan.items.length > 0) {
        for (const item of plan.items) {
          const toothDisplay = item.tooth
            ? item.faces
              ? `${item.tooth} (${item.faces})`
              : item.tooth
            : '';
          const lineTotal = Math.max(
            0,
            Math.round(Number(item.unitPrice || 0) * Number(item.quantity || 1) - Number(item.discount || 0))
          );
          const isPaid = item.status === 'Payé';
          const details = [
            item.phase,
            `Qté ${item.quantity || 1}`,
            item.discount ? `Remise ${formatMAD(item.discount)}` : '',
          ]
            .filter(Boolean)
            .join(' · ');

          collected.push({
            sortDate: dateVal,
            cells: [
              dateVal,
              'Plan de Traitement / Devis',
              fileNum,
              name,
              `${plan.quoteNumber}${item.actCode ? ` · ${item.actCode}` : ''}`,
              toothDisplay,
              `${item.actName} (${plan.title})`,
              details,
              practitioner,
              lineTotal,
              isPaid ? lineTotal : 0,
              isPaid ? 0 : lineTotal,
              `${item.status} (Devis: ${plan.status})`,
            ],
          });
        }
      } else if (plan.rawActsText) {
        collected.push({
          sortDate: dateVal,
          cells: [
            dateVal,
            'Plan de Traitement / Devis',
            fileNum,
            name,
            plan.quoteNumber,
            '',
            plan.title,
            plan.rawActsText,
            practitioner,
            Number(plan.totalAmount || 0),
            0,
            Number(plan.totalAmount || 0),
            `Devis: ${plan.status}`,
          ],
        });
      }
    }

    collected.sort((a, b) => (b.sortDate || '').localeCompare(a.sortDate || ''));

    const headers = [
      'Date',
      'Source',
      'N° Dossier',
      'Patient',
      'Code / Réf',
      'Dent(s)',
      'Acte / Traitement',
      'Détails / Matériaux / Compte-rendu',
      'Praticien',
      'Montant MAD',
      'Encaissé MAD',
      'Reste MAD',
      'Statut',
    ];

    return { headers, rows: collected.map((c) => c.cells) };
  };

  const handleExportPatientsArchive = async () => {
    if (exportingArchive) return;
    setExportingArchive('patients');
    try {
      const modeTag = csvSecurityMode === 'pseudonymized' ? 'rgpd' : 'complet';
      const filename = `archive-patients-${modeTag}-${todayISO()}.csv`;
      const { headers, rows } = buildPatientsArchivePayload(csvSecurityMode);
      const res = await exportSecureCsv(filename, headers, rows);
      setLastArchiveReceipt({
        files: [{ name: filename, rows: res.rowCount, sha256: res.sha256, byteSize: res.byteSize }],
        mode: csvSecurityMode,
        exportedAt: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      });
      logActivity({
        category: 'administration',
        title: 'Export CSV sécurisé — Liste des patients',
        detail: `${res.rowCount} dossier(s) exporté(s) (${modeTag}) · SHA-256 ${res.sha256.slice(0, 12)}…`,
        section: 'reports',
      });
      showToast(`Liste patients archivée (${res.rowCount} dossiers).`, 'success');
    } catch (error) {
      console.error('Erreur export archive patients CSV:', error);
      showToast("Impossible d'exporter la liste des patients.", 'error');
    } finally {
      setExportingArchive(null);
    }
  };

  const handleExportTreatmentsArchive = async () => {
    if (exportingArchive) return;
    setExportingArchive('treatments');
    try {
      const fetchedNotes = await fetchClinicalNotesForExport();
      const modeTag = csvSecurityMode === 'pseudonymized' ? 'rgpd' : 'complet';
      const scopeTag = archiveScope === 'period' && selectedMonth !== 'all' ? selectedMonth : 'complet';
      const filename = `archive-traitements-${scopeTag}-${modeTag}-${todayISO()}.csv`;
      const { headers, rows } = buildTreatmentHistoryPayload(csvSecurityMode, fetchedNotes);
      const res = await exportSecureCsv(filename, headers, rows);
      setLastArchiveReceipt({
        files: [{ name: filename, rows: res.rowCount, sha256: res.sha256, byteSize: res.byteSize }],
        mode: csvSecurityMode,
        exportedAt: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      });
      logActivity({
        category: 'administration',
        title: 'Export CSV sécurisé — Historique des traitements',
        detail: `${res.rowCount} ligne(s) exportée(s) (${modeTag}) · SHA-256 ${res.sha256.slice(0, 12)}…`,
        section: 'reports',
      });
      showToast(`Historique des traitements archivé (${res.rowCount} lignes).`, 'success');
    } catch (error) {
      console.error('Erreur export archive traitements CSV:', error);
      showToast("Impossible d'exporter l'historique des traitements.", 'error');
    } finally {
      setExportingArchive(null);
    }
  };

  const handleExportCompleteArchive = async () => {
    if (exportingArchive) return;
    setExportingArchive('both');
    try {
      const fetchedNotes = await fetchClinicalNotesForExport();
      const modeTag = csvSecurityMode === 'pseudonymized' ? 'rgpd' : 'complet';
      const scopeTag = archiveScope === 'period' && selectedMonth !== 'all' ? selectedMonth : 'complet';

      const patientsFilename = `archive-patients-${modeTag}-${todayISO()}.csv`;
      const patientsPayload = buildPatientsArchivePayload(csvSecurityMode);
      const patRes = await exportSecureCsv(
        patientsFilename,
        patientsPayload.headers,
        patientsPayload.rows
      );

      const treatmentsFilename = `archive-traitements-${scopeTag}-${modeTag}-${todayISO()}.csv`;
      const treatmentsPayload = buildTreatmentHistoryPayload(csvSecurityMode, fetchedNotes);
      const trtRes = await exportSecureCsv(
        treatmentsFilename,
        treatmentsPayload.headers,
        treatmentsPayload.rows
      );

      setLastArchiveReceipt({
        files: [
          { name: patientsFilename, rows: patRes.rowCount, sha256: patRes.sha256, byteSize: patRes.byteSize },
          { name: treatmentsFilename, rows: trtRes.rowCount, sha256: trtRes.sha256, byteSize: trtRes.byteSize },
        ],
        mode: csvSecurityMode,
        exportedAt: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      });
      logActivity({
        category: 'administration',
        title: 'Archivage CSV sécurisé complet (Patients + Traitements)',
        detail: `${patRes.rowCount} patients & ${trtRes.rowCount} traitements (${modeTag})`,
        section: 'reports',
      });
      showToast(
        `Archive complète générée : ${patRes.rowCount} patients et ${trtRes.rowCount} traitements.`,
        'success'
      );
    } catch (error) {
      console.error('Erreur export archive complète CSV:', error);
      showToast("Impossible de générer l'archive complète.", 'error');
    } finally {
      setExportingArchive(null);
    }
  };

  const handleCopySha256 = async (fileName: string, hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHashFile(fileName);
      window.setTimeout(() => setCopiedHashFile((cur) => (cur === fileName ? null : cur)), 2000);
      showToast('Empreinte SHA-256 copiée.', 'info');
    } catch {
      showToast('Copie automatique bloquée par le navigateur.', 'error');
    }
  };

  if (!canAccessSection(activeRole, 'reports')) {
    return <AccessDeniedView sectionLabel="Rapports" />;
  }

  return (
    <div className="space-y-5">
      {/* Top Overview Header (matches reference image top action cluster) */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Rapports & Suivi Financier
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Statistiques mensuelles, recouvrements et marges ·{' '}
            <span className="font-medium text-slate-700 dark:text-slate-200">{periodLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Calendar className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3.5 pointer-events-none" />
            <select
              aria-label="Filtrer par période mensuelle"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-[0_1px_4px_rgba(15,23,42,0.04)] focus:border-sky-500 focus:outline-none"
            >
              <option value="all">Vue globale (Cumul)</option>
              {availableMonths.map((mk) => (
                <option key={mk} value={mk}>
                  {formatMonthLabelFR(mk)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              void exportSecureCsv(
                `rapport-financier-${periodSlug}-${todayISO()}.csv`,
                ['Mois', 'Factures', 'CA Facturé MAD', 'Encaissé MAD', 'Charges MAD', 'Marge Nette MAD'],
                monthlyStats.map((m) => [
                  m.monthLabel,
                  m.invoiceCount,
                  m.billed,
                  m.collected,
                  m.expenses,
                  m.netMargin,
                ])
              ).then((res) => {
                showToast(`Bilan CSV sécurisé exporté (${res.rowCount} mois).`, 'success');
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-[0_1px_4px_rgba(15,23,42,0.04)] whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1598C7] hover:bg-[#1082AC] px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 whitespace-nowrap"
          >
            <FileDown className="h-3.5 w-3.5" />
            <span>{isExportingPdf ? 'Génération...' : 'Exporter en PDF'}</span>
          </button>
        </div>
      </div>

      {/* Top 3-Column Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Column 1: Stacked Dark Navy CA Facturé + White Charges */}
        <div className="lg:col-span-4 min-w-0 flex flex-col gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-[#163B63] to-[#0D2540] p-5 text-white shadow-[0_6px_20px_rgba(15,37,64,0.14)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-sky-100">CA Facturé Total</span>
              <MoreHorizontal className="h-4 w-4 text-sky-200/80" />
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-2.5">
              <span className="font-display text-2xl sm:text-3xl font-bold font-mono tabular-nums">
                {formatMAD(totalBilled)}
              </span>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200 tabular-nums">
                {activeInvoices.length} factures
              </span>
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Charges & Marge Nette
              </span>
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-2.5">
              <span
                className={`font-display text-2xl font-bold font-mono tabular-nums ${
                  netMargin >= 0
                    ? 'text-slate-900 dark:text-white'
                    : 'text-rose-700 dark:text-rose-400'
                }`}
              >
                {formatMAD(netMargin)}
              </span>
              <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 tabular-nums">
                Charges : {formatMAD(totalExpenses)}
              </span>
            </div>
          </div>
        </div>

        {/* Column 2: Encaissements & Recouvrement Progress Card */}
        <div className="lg:col-span-4 min-w-0 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Montant Encaissé & Recouvrement
              </h2>
              <MoreHorizontal className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Panier moyen : <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{formatMAD(avgBasket)}</span>
            </p>
          </div>

          <div className="my-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                {formatMAD(totalCollected)}
              </span>
              <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
                {collectionRate}% encaissé
              </span>
            </div>

            <GradientProgressBar
              percent={collectionRate}
              label="Taux d'encaissement"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <span>Mutuelles : {formatMAD(insurancePendingTotal)}</span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Patients : {formatMAD(patientPendingTotal)}
            </span>
          </div>
        </div>

        {/* Column 3: Segmented Arc Gauge (Concrétisation Devis) */}
        <div className="lg:col-span-4 min-w-0 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Concrétisation Devis
            </h2>
            <MoreHorizontal className="h-4 w-4 text-slate-400" />
          </div>

          <div className="my-2">
            <SegmentedArcGauge
              value={`${quoteConversion}%`}
              subtitle={`${acceptedQuotesCount} / ${treatmentPlans.length} devis acceptés`}
              percentage={quoteConversion}
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400 tabular-nums">
              Reste à recouvrer : {formatMAD(outstandingBalance)}
            </span>
            <span className="rounded-full bg-sky-50 dark:bg-sky-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300 tabular-nums whitespace-nowrap">
              Abs. RDV : {noShowRate}%
            </span>
          </div>
        </div>
      </div>

      {/* Bottom 2-Column Split: Monthly Statistics Chart/Table + Practitioner Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 min-w-0 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Statistiques Mensuelles
            </h2>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'collected', label: 'Encaissé' },
                  { id: 'billed', label: 'Facturé' },
                  { id: 'expenses', label: 'Charges' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setChartMetric(tab.id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                    chartMetric === tab.id
                      ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}

              <div className="ml-1 flex items-center rounded-full border border-slate-200 dark:border-slate-700 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setMonthlyDisplayMode('chart')}
                  className={`rounded-full px-2.5 py-0.5 font-medium ${
                    monthlyDisplayMode === 'chart'
                      ? 'bg-slate-900 dark:bg-slate-700 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Barres
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyDisplayMode('table')}
                  className={`rounded-full px-2.5 py-0.5 font-medium ${
                    monthlyDisplayMode === 'table'
                      ? 'bg-slate-900 dark:bg-slate-700 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Tableau
                </button>
              </div>
            </div>
          </div>

          {monthlyDisplayMode === 'chart' ? (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
              <div className="sm:col-span-4 space-y-1.5 pb-2">
                <p className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
                  {formatMAD(
                    chartMetric === 'billed'
                      ? totalBilled
                      : chartMetric === 'expenses'
                      ? totalExpenses
                      : totalCollected
                  )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Cliquez sur un mois pour filtrer tout le suivi financier et l'export PDF.
                </p>
              </div>

              <div className="sm:col-span-8">
                <StatBarColumns
                  items={statColumns}
                  selectedKey={selectedMonth === 'all' ? undefined : selectedMonth}
                  onSelectKey={(key) =>
                    setSelectedMonth((prev) => (prev === key ? 'all' : key))
                  }
                />
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2.5 font-medium">Mois</th>
                    <th className="px-3 py-2.5 font-medium text-center">Fact.</th>
                    <th className="px-3 py-2.5 font-medium text-right">Facturé</th>
                    <th className="px-3 py-2.5 font-medium text-right">Encaissé</th>
                    <th className="px-3 py-2.5 font-medium text-right">Charges</th>
                    <th className="px-3 py-2.5 font-medium text-right">Marge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                  {monthlyStats.map((m) => (
                    <tr key={m.monthKey} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        {m.monthLabel}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-slate-600 dark:text-slate-300">
                        {m.invoiceCount}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-200">
                        {formatMAD(m.billed)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatMAD(m.collected)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-rose-700 dark:text-rose-400">
                        {formatMAD(m.expenses)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                        {formatMAD(m.netMargin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bottom-Right: Practitioner Revenue (floating cyan-backdrop list matching reference) */}
        <div className="lg:col-span-5 min-w-0 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-sky-50/80 via-white to-cyan-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950/30 p-4 sm:p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Revenus par Praticien
            </h2>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Part du CA
            </span>
          </div>

          {byPractitioner.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Aucune facture émise sur la période sélectionnée.
            </p>
          ) : (
            <div className="space-y-2.5">
              {byPractitioner.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/95 dark:bg-slate-800/90 px-3.5 py-2.5 shadow-[0_2px_6px_rgba(15,23,42,0.03)]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-8 w-8 rounded-full bg-[#163B63] text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                      {p.name.replace(/^Dr\.?\s*/i, '').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {p.count} facture(s) · {p.sharePercent}%
                      </p>
                    </div>
                  </div>
                  <span className="rounded-full bg-[#1598C7] px-3 py-1 text-[11px] font-semibold text-white font-mono tabular-nums shrink-0">
                    {formatMAD(p.billed)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment Modes & Expenses Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-3 text-xs">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Encaissements par Mode de Règlement
          </h3>
          <div className="space-y-3">
            {byPaymentMethod.map((pm) => (
              <div key={pm.method} className="space-y-1.5">
                <div className="flex items-center justify-between tabular-nums">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {pm.method}{' '}
                    <span className="text-slate-400 dark:text-slate-500">({pm.count})</span>
                  </span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {formatMAD(pm.amount)} ({pm.sharePercent}%)
                  </span>
                </div>
                <GradientProgressBar percent={pm.sharePercent} label={pm.method} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-3 text-xs">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Ventilation des Charges par Catégorie
          </h3>
          {byExpenseCategory.length === 0 ? (
            <p className="py-6 text-center text-slate-500 dark:text-slate-400">
              Aucune charge enregistrée sur la période.
            </p>
          ) : (
            <div className="space-y-3">
              {byExpenseCategory.map((cat) => (
                <div key={cat.category} className="space-y-1.5">
                  <div className="flex items-center justify-between tabular-nums">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {cat.category}{' '}
                      <span className="text-slate-400 dark:text-slate-500">({cat.count})</span>
                    </span>
                    <span className="font-mono font-semibold text-rose-700 dark:text-rose-400">
                      {formatMAD(cat.amount)} ({cat.sharePercent}%)
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 100 4"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={Math.max(4, Math.min(100, cat.sharePercent))}
                      height="4"
                      rx="2"
                      className="fill-rose-500 dark:fill-rose-400"
                    />
                  </svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Synthèse des Actes Cliniques (actes.csv) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Activité Clinique & Actes Réalisés ({filteredClinicalActs.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Consolidation directe des fiches actes cliniques sur la période ({periodLabel})
            </p>
          </div>
          <span className="rounded-full bg-sky-50 dark:bg-sky-950/60 px-3 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300 tabular-nums">
            {clinicalActsTotals.finished} acte(s) terminé(s) (« Fini »)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs tabular-nums">
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
            <p className="text-slate-500 dark:text-slate-400">Volume des Actes</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
              {filteredClinicalActs.length}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
            <p className="text-slate-500 dark:text-slate-400">Total Honoraires Actes</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
              {formatMAD(clinicalActsTotals.price)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
            <p className="text-slate-500 dark:text-slate-400">Reçu sur Actes</p>
            <p className="mt-1 font-mono text-base font-bold text-emerald-700 dark:text-emerald-400">
              {formatMAD(clinicalActsTotals.received)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3">
            <p className="text-slate-500 dark:text-slate-400">Reste sur Actes</p>
            <p className="mt-1 font-mono text-base font-bold text-amber-700 dark:text-amber-400">
              {formatMAD(clinicalActsTotals.remaining)}
            </p>
          </div>
        </div>
      </div>

      {/* Archivage Externe Sécurisé (CSV) */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#163B63]/10 dark:bg-sky-500/15 text-[#163B63] dark:text-sky-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Archivage Externe Sécurisé (CSV)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Export chiffré en intégrité (empreinte SHA-256), neutralisation des formules Excel (anti-injection), encodage UTF-8 BOM et journalisation d'audit.
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            <Lock className="h-3 w-3" />
            <span>Protection anti-injection & SHA-256</span>
          </span>
        </div>

        {/* Configuration : Mode de confidentialité & Périmètre */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2">
            <p className="font-semibold text-slate-700 dark:text-slate-200">
              Niveau de confidentialité (RGPD)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCsvSecurityMode('complete')}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  csvSecurityMode === 'complete'
                    ? 'border-[#1598C7] bg-sky-50/90 dark:bg-sky-950/50 text-[#163B63] dark:text-sky-200 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs">Complet (Cabinet)</div>
                <div className="text-[10px] font-normal opacity-80 mt-0.5">
                  Identités & coordonnées complètes
                </div>
              </button>
              <button
                type="button"
                onClick={() => setCsvSecurityMode('pseudonymized')}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  csvSecurityMode === 'pseudonymized'
                    ? 'border-[#1598C7] bg-sky-50/90 dark:bg-sky-950/50 text-[#163B63] dark:text-sky-200 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs">Pseudonymisé RGPD</div>
                <div className="text-[10px] font-normal opacity-80 mt-0.5">
                  Masque nom, CIN, tél, email, adresse
                </div>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-2">
            <p className="font-semibold text-slate-700 dark:text-slate-200">
              Périmètre de l'historique des traitements
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setArchiveScope('all')}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  archiveScope === 'all'
                    ? 'border-[#1598C7] bg-sky-50/90 dark:bg-sky-950/50 text-[#163B63] dark:text-sky-200 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs">Historique complet</div>
                <div className="text-[10px] font-normal opacity-80 mt-0.5">
                  Tous les actes, notes & plans
                </div>
              </button>
              <button
                type="button"
                onClick={() => setArchiveScope('period')}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  archiveScope === 'period'
                    ? 'border-[#1598C7] bg-sky-50/90 dark:bg-sky-950/50 text-[#163B63] dark:text-sky-200 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="text-xs">Période active</div>
                <div className="text-[10px] font-normal opacity-80 mt-0.5 truncate">
                  {periodLabel}
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Boutons d'exportation sécurisée */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => void handleExportPatientsArchive()}
            disabled={exportingArchive !== null}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-[#1598C7] hover:bg-sky-50/40 dark:hover:bg-slate-800 px-4 py-3 text-left transition-colors disabled:opacity-60"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] flex items-center justify-center shrink-0">
                <Users className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {exportingArchive === 'patients' ? 'Export en cours...' : 'Liste des Patients (CSV)'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {patients.length} dossier(s) · Odontogramme & solde
                </p>
              </div>
            </div>
            <FileSpreadsheet className="h-4 w-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => void handleExportTreatmentsArchive()}
            disabled={exportingArchive !== null}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-[#1598C7] hover:bg-sky-50/40 dark:hover:bg-slate-800 px-4 py-3 text-left transition-colors disabled:opacity-60"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ClipboardList className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {exportingArchive === 'treatments'
                    ? 'Consolidation...'
                    : 'Historique Traitements (CSV)'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {clinicalActs.length + planItemsTotalCount}+ actes, notes & plans
                </p>
              </div>
            </div>
            <FileSpreadsheet className="h-4 w-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => void handleExportCompleteArchive()}
            disabled={exportingArchive !== null}
            className="flex items-center justify-between gap-3 rounded-xl bg-[#163B63] hover:bg-[#0D2540] text-white px-4 py-3 text-left shadow-sm transition-colors disabled:opacity-60"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-white/15 text-sky-200 flex items-center justify-center shrink-0">
                <FileArchive className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">
                  {exportingArchive === 'both'
                    ? 'Génération archive...'
                    : 'Archive Complète (2 CSV)'}
                </p>
                <p className="text-[11px] text-sky-200/90">
                  Patients + Traitements horodatés
                </p>
              </div>
            </div>
            <FileDown className="h-4 w-4 text-sky-200 shrink-0" />
          </button>
        </div>

        {/* Reçu d'intégrité cryptographique SHA-256 */}
        {lastArchiveReceipt && (
          <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Certificat d'intégrité de la dernière archive ({lastArchiveReceipt.exportedAt})
              </span>
              <span className="rounded-full bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                Mode : {lastArchiveReceipt.mode === 'pseudonymized' ? 'Pseudonymisé RGPD' : 'Complet Cabinet'}
              </span>
            </div>

            <div className="space-y-1.5">
              {lastArchiveReceipt.files.map((file) => (
                <div
                  key={file.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-emerald-100 dark:border-emerald-900/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {file.rows} ligne(s) · {(file.byteSize / 1024).toFixed(1)} Ko · SHA-256 :{' '}
                      <span className="text-slate-700 dark:text-slate-200 break-all">
                        {file.sha256}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopySha256(file.name, file.sha256)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                  >
                    {copiedHashFile === file.name ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span>Copié</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copier SHA-256</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
