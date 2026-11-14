import React, { useMemo, useState } from 'react';
import {
  Calendar,
  FileDown,
  FileSpreadsheet,
  MoreHorizontal,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { exportToCsv, formatMAD, todayISO } from '../lib/formatters';
import {
  ExpenseCategoryReportRow,
  exportFinancialReportPdf,
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
    invoices,
    payments,
    treatmentPlans,
    appointments,
    expenses,
    clinicSettings,
    staffProfile,
    showToast,
  } = useClinic();

  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [monthlyDisplayMode, setMonthlyDisplayMode] = useState<'chart' | 'table'>('chart');
  const [chartMetric, setChartMetric] = useState<'billed' | 'collected' | 'expenses'>('collected');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    keys.add(todayISO().slice(0, 7));
    invoices.forEach((i) => i.issueDate && keys.add(i.issueDate.slice(0, 7)));
    payments.forEach((p) => p.date && keys.add(p.date.slice(0, 7)));
    expenses.forEach((e) => e.date && keys.add(e.date.slice(0, 7)));
    appointments.forEach((a) => a.date && keys.add(a.date.slice(0, 7)));
    return Array.from(keys)
      .filter((k) => /^\d{4}-\d{2}$/.test(k))
      .sort((a, b) => b.localeCompare(a));
  }, [invoices, payments, expenses, appointments]);

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
    const methods = ['Espèces', 'Carte bancaire', 'Virement', 'Chèque'];
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

  const handleExportPdf = () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
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
      });
      showToast(`Rapport PDF généré (${fileName}).`, 'success');
    } catch (error) {
      console.error('Erreur export PDF:', error);
      showToast('Impossible de générer le rapport PDF.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

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
            onClick={() =>
              exportToCsv(
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
              )
            }
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
            <span>{isExportingPdf ? 'Génération...' : 'Exporter PDF'}</span>
          </button>
        </div>
      </div>

      {/* Top 3-Column Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Column 1: Stacked Dark Navy CA Facturé + White Charges */}
        <div className="lg:col-span-4 flex flex-col gap-4">
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
        <div className="lg:col-span-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
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
        <div className="lg:col-span-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] flex flex-col justify-between">
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
        <div className="lg:col-span-7 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-4">
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
        <div className="lg:col-span-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-sky-50/80 via-white to-cyan-50/70 dark:from-slate-900 dark:via-slate-900 dark:to-sky-950/30 p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] space-y-3">
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
    </div>
  );
};
