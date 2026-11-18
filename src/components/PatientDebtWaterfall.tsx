import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  FileText,
  Layers,
  ShieldCheck,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { formatDateFR, formatMAD } from '../lib/formatters';
import { Invoice, Patient, PatientClinicalAct, Payment } from '../types/dental';

interface PatientDebtWaterfallProps {
  patient: Patient;
  invoices: Invoice[];
  payments: Payment[];
  clinicalActs?: PatientClinicalAct[];
  canNavigateFinance?: boolean;
  onNavigateInvoices?: () => void;
  onNavigatePayments?: () => void;
}

type ScopeMode = 'patient' | 'global';

type WaterfallKind = 'charge' | 'payment' | 'insurance' | 'total';

interface LedgerEvent {
  id: string;
  date: string;
  orderRank: number;
  sortKey: string;
  kind: 'charge' | 'payment' | 'insurance';
  reference: string;
  label: string;
  detail: string;
  delta: number;
  invoiceId?: string;
}

interface WaterfallStep {
  id: string;
  date: string;
  kind: WaterfallKind;
  reference: string;
  shortLabel: string;
  label: string;
  detail: string;
  delta: number;
  start: number;
  end: number;
}

function toTimestampKey(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return '';
    }
  }
  if (typeof value === 'string') return value;
  return '';
}

function formatCompactMAD(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const formatted = new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(abs);
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return '0';
}

export const PatientDebtWaterfall: React.FC<PatientDebtWaterfallProps> = ({
  patient,
  invoices,
  payments,
  clinicalActs = [],
  canNavigateFinance = false,
  onNavigateInvoices,
  onNavigatePayments,
}) => {
  const activeInvoices = useMemo(
    () => invoices.filter((inv) => inv.patientId === patient.id && inv.status !== 'Annulée'),
    [invoices, patient.id]
  );

  const patientActs = useMemo(
    () => clinicalActs.filter((a) => a.patientId === patient.id),
    [clinicalActs, patient.id]
  );

  const cancelledInvoiceIds = useMemo(
    () =>
      new Set(
        invoices
          .filter((inv) => inv.patientId === patient.id && inv.status === 'Annulée')
          .map((inv) => inv.id)
      ),
    [invoices, patient.id]
  );

  const activePayments = useMemo(
    () =>
      payments.filter(
        (p) => p.patientId === patient.id && !cancelledInvoiceIds.has(p.invoiceId)
      ),
    [payments, patient.id, cancelledInvoiceIds]
  );

  const hasInsuranceActivity = useMemo(
    () =>
      activeInvoices.some(
        (inv) => Number(inv.insuranceShare || 0) > 0 || Number(inv.insurancePaidAmount || 0) > 0
      ) || activePayments.some((p) => p.payerType === 'Mutuelle'),
    [activeInvoices, activePayments]
  );

  const [scopeMode, setScopeMode] = useState<ScopeMode>('patient');
  const effectiveScope: ScopeMode = hasInsuranceActivity ? scopeMode : 'patient';

  const summary = useMemo(() => {
    const actsTotal = patientActs.reduce((s, a) => s + Number(a.price || 0), 0);
    const paymentsNet = activePayments
      .filter((p) => p.payerType === 'Patient')
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    if (activeInvoices.length === 0 && (patientActs.length > 0 || activePayments.length > 0 || patient.isCsvArchive)) {
      const totalBilled = Number(patient.totalBilled ?? actsTotal) || actsTotal;
      const totalPatientPaid = paymentsNet || patientActs.reduce((s, a) => s + Number(a.receivedAmount || 0), 0);
      const patientBalanceDue =
        patient.remainingDue !== undefined
          ? Number(patient.remainingDue)
          : Math.max(0, totalBilled - totalPatientPaid);
      return {
        totalBilled,
        totalPatientShare: totalBilled,
        totalInsuranceShare: 0,
        totalPatientPaid,
        totalInsurancePaid: 0,
        patientBalanceDue,
        insuranceBalanceDue: 0,
        totalRemainingDue: patientBalanceDue,
      };
    }

    const totalBilled = Math.max(
      activeInvoices.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0),
      Number(patient.totalBilled || 0)
    );
    const totalPatientShare = activeInvoices.reduce(
      (s, inv) => s + Number(inv.patientShare || 0),
      0
    );
    const totalInsuranceShare = activeInvoices.reduce(
      (s, inv) => s + Number(inv.insuranceShare || 0),
      0
    );
    const totalPatientPaid = Math.max(
      activeInvoices.reduce((s, inv) => s + Number(inv.paidAmount || 0), 0),
      paymentsNet
    );
    const totalInsurancePaid = activeInvoices.reduce(
      (s, inv) => s + Number(inv.insurancePaidAmount || 0),
      0
    );
    const invoiceDue = activeInvoices.reduce(
      (s, inv) => s + Math.max(0, Number(inv.patientShare || 0) - Number(inv.paidAmount || 0)),
      0
    );
    const patientBalanceDue = patient.isCsvArchive && patient.remainingDue !== undefined
      ? Math.max(invoiceDue, Number(patient.remainingDue))
      : invoiceDue;
    const insuranceBalanceDue = activeInvoices.reduce(
      (s, inv) =>
        s + Math.max(0, Number(inv.insuranceShare || 0) - Number(inv.insurancePaidAmount || 0)),
      0
    );
    const totalRemainingDue = Math.max(patientBalanceDue + insuranceBalanceDue, 0);

    return {
      totalBilled,
      totalPatientShare: totalPatientShare || totalBilled,
      totalInsuranceShare,
      totalPatientPaid,
      totalInsurancePaid,
      patientBalanceDue,
      insuranceBalanceDue,
      totalRemainingDue,
    };
  }, [activeInvoices, activePayments, patient, patientActs]);

  const { steps, ledgerRows } = useMemo(() => {
    const events: LedgerEvent[] = [];
    const invoiceById = new Map<string, Invoice>(activeInvoices.map((inv) => [inv.id, inv]));

    // 1) Factures émises (+ dette) ou Actes CSV si aucune facture formalisée
    if (activeInvoices.length > 0) {
      for (const inv of activeInvoices) {
        const chargeAmount =
          effectiveScope === 'patient'
            ? Number(inv.patientShare ?? inv.totalAmount ?? 0)
            : Number(inv.totalAmount || 0);

        const firstAct = inv.items?.[0]?.actName || 'Soins dentaires';
        const extraCount = (inv.items?.length || 0) > 1 ? ` (+${inv.items.length - 1})` : '';
        const detail =
          effectiveScope === 'patient' && Number(inv.insuranceShare || 0) > 0
            ? `${firstAct}${extraCount} · Total ${formatMAD(inv.totalAmount)} (Mutuelle ${formatMAD(inv.insuranceShare)})`
            : `${firstAct}${extraCount} · Statut : ${inv.status}`;

        events.push({
          id: `inv-${inv.id}`,
          date: inv.issueDate || '',
          orderRank: 0,
          sortKey: toTimestampKey(inv.createdAt) || inv.invoiceNumber || inv.id,
          kind: 'charge',
          reference: inv.invoiceNumber,
          label: `Facture ${inv.invoiceNumber}`,
          detail,
          delta: chargeAmount,
          invoiceId: inv.id,
        });
      }
    } else {
      for (const act of patientActs) {
        if (Number(act.price || 0) <= 0) continue;
        events.push({
          id: `act-${act.id}`,
          date: act.realizationDate || act.date || '',
          orderRank: 0,
          sortKey: act.id,
          kind: 'charge',
          reference: act.teeth ? `D.${act.teeth}` : 'ACTE',
          label: act.actName,
          detail: `${act.practitionerName} · Statut : ${act.status}`,
          delta: Number(act.price || 0),
        });
      }
    }

    // 2) Paiements enregistrés (- dette)
    const recordedPatientByInv = new Map<string, number>();
    const recordedInsuranceByInv = new Map<string, number>();

    for (const pay of activePayments) {
      if (pay.payerType === 'Patient') {
        recordedPatientByInv.set(
          pay.invoiceId,
          (recordedPatientByInv.get(pay.invoiceId) || 0) + Number(pay.amount || 0)
        );
      } else if (pay.payerType === 'Mutuelle') {
        recordedInsuranceByInv.set(
          pay.invoiceId,
          (recordedInsuranceByInv.get(pay.invoiceId) || 0) + Number(pay.amount || 0)
        );
      }

      if (effectiveScope === 'patient' && pay.payerType !== 'Patient') {
        continue;
      }

      const linkedInv = invoiceById.get(pay.invoiceId);
      const isInsurance = pay.payerType === 'Mutuelle';
      const methodDetail = `${pay.rawMethod || pay.method}${pay.chequeNumber ? ` N° ${pay.chequeNumber}` : ''}${
        pay.isAdvance ? ' · Acompte' : ''
      }`;

      events.push({
        id: `pay-${pay.id}`,
        date: pay.date || linkedInv?.issueDate || '',
        orderRank: isInsurance ? 2 : 1,
        sortKey: toTimestampKey(pay.createdAt) || pay.receiptNumber || pay.id,
        kind: isInsurance ? 'insurance' : 'payment',
        reference: pay.receiptNumber,
        label: isInsurance
          ? `Remboursement mutuelle (${pay.receiptNumber})`
          : `Paiement ${pay.receiptNumber}${pay.actName ? ` · ${pay.actName}` : ''}`,
        detail: `${methodDetail}${linkedInv ? ` · Sur ${linkedInv.invoiceNumber}` : ''}`,
        delta: -Number(pay.amount || 0),
        invoiceId: pay.invoiceId,
      });
    }

    // 3) Réconciliation des remboursements mutuelle ou règlements marqués directement sur facture
    for (const inv of activeInvoices) {
      const recordedPat = recordedPatientByInv.get(inv.id) || 0;
      const diffPat = Number(inv.paidAmount || 0) - recordedPat;
      if (diffPat > 0.01 && activePayments.length === 0) {
        events.push({
          id: `adj-pat-${inv.id}`,
          date: inv.issueDate || '',
          orderRank: 1,
          sortKey: `${inv.invoiceNumber}-adj-pat`,
          kind: 'payment',
          reference: inv.invoiceNumber,
          label: `Règlement patient (${inv.invoiceNumber})`,
          detail: 'Régularisation enregistrée sur la facture',
          delta: -diffPat,
          invoiceId: inv.id,
        });
      }

      if (effectiveScope === 'global') {
        const recordedIns = recordedInsuranceByInv.get(inv.id) || 0;
        const diffIns = Number(inv.insurancePaidAmount || 0) - recordedIns;
        if (diffIns > 0.01) {
          events.push({
            id: `adj-ins-${inv.id}`,
            date: inv.issueDate || '',
            orderRank: 2,
            sortKey: `${inv.invoiceNumber}-adj-ins`,
            kind: 'insurance',
            reference: inv.invoiceNumber,
            label: `Remboursement ${inv.insuranceType || 'Mutuelle'}`,
            detail: `Dossier tiers-payant remboursé · ${inv.invoiceNumber}`,
            delta: -diffIns,
            invoiceId: inv.id,
          });
        }
      }
    }

    // Tri chronologique déterministe
    events.sort((a, b) => {
      const dateCmp = (a.date || '').localeCompare(b.date || '');
      if (dateCmp !== 0) return dateCmp;
      if (a.orderRank !== b.orderRank) return a.orderRank - b.orderRank;
      return a.sortKey.localeCompare(b.sortKey);
    });

    let runningDebt = 0;
    const builtSteps: WaterfallStep[] = [];
    const builtLedger: Array<LedgerEvent & { balanceBefore: number; balanceAfter: number }> = [];

    for (const ev of events) {
      const start = runningDebt;
      const end = runningDebt + ev.delta;
      runningDebt = end;

      builtSteps.push({
        id: ev.id,
        date: ev.date,
        kind: ev.kind,
        reference: ev.reference,
        shortLabel: ev.reference || formatDateFR(ev.date),
        label: ev.label,
        detail: ev.detail,
        delta: ev.delta,
        start,
        end,
      });

      builtLedger.push({
        ...ev,
        balanceBefore: start,
        balanceAfter: end,
      });
    }

    if (builtSteps.length > 0) {
      builtSteps.push({
        id: 'final-balance',
        date: '',
        kind: 'total',
        reference: 'SOLDE',
        shortLabel: 'Reste à payer',
        label:
          effectiveScope === 'patient'
            ? 'Reste à payer patient actuel'
            : 'Reste à payer global actuel',
        detail:
          runningDebt <= 0.01
            ? 'Compte soldé — aucune dette restante'
            : 'Solde débiteur cumulé après tous les règlements',
        delta: runningDebt,
        start: 0,
        end: runningDebt,
      });
    }

    return { steps: builtSteps, ledgerRows: builtLedger };
  }, [activeInvoices, activePayments, patientActs, effectiveScope]);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const activeStep = useMemo(
    () => steps.find((s) => s.id === selectedStepId) || steps[steps.length - 1] || null,
    [steps, selectedStepId]
  );

  // Calcul de l'échelle SVG du graphique en cascade
  const chartGeometry = useMemo(() => {
    if (steps.length === 0) return null;

    const allValues = steps.flatMap((s) => [0, s.start, s.end]);
    const rawMin = Math.min(0, ...allValues);
    const rawMax = Math.max(0, ...allValues);
    const span = Math.max(100, rawMax - rawMin);
    const paddedMax = rawMax + span * 0.14;
    const paddedMin = rawMin < 0 ? rawMin - span * 0.1 : 0;
    const totalRange = Math.max(1, paddedMax - paddedMin);

    const padLeft = 68;
    const padRight = 24;
    const padTop = 28;
    const padBottom = 54;
    const stepSlot = steps.length <= 6 ? 96 : steps.length <= 10 ? 78 : 66;
    const plotWidth = Math.max(520, steps.length * stepSlot);
    const svgWidth = padLeft + plotWidth + padRight;
    const plotHeight = 200;
    const svgHeight = padTop + plotHeight + padBottom;

    const yFor = (val: number) =>
      padTop + ((paddedMax - val) / totalRange) * plotHeight;

    const baselineY = yFor(0);

    // 4 graduations Y propres
    const tickCount = 4;
    const ticks = Array.from({ length: tickCount + 1 }).map((_, idx) => {
      const ratio = idx / tickCount;
      const value = paddedMin + (paddedMax - paddedMin) * ratio;
      return {
        value,
        y: yFor(value),
        label: new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(
          Math.round(value)
        ),
      };
    });

    const barWidth = Math.min(44, Math.max(26, stepSlot * 0.56));
    const bars = steps.map((step, index) => {
      const centerX = padLeft + (index + 0.5) * (plotWidth / steps.length);
      const x = centerX - barWidth / 2;
      const yTop = yFor(Math.max(step.start, step.end));
      const yBottom = yFor(Math.min(step.start, step.end));
      const height = Math.max(4, yBottom - yTop);
      const endY = yFor(step.end);
      return {
        step,
        index,
        x,
        centerX,
        barWidth,
        yTop,
        yBottom,
        height,
        endY,
      };
    });

    return {
      svgWidth,
      svgHeight,
      padLeft,
      padRight,
      padTop,
      plotWidth,
      plotHeight,
      baselineY,
      ticks,
      bars,
    };
  }, [steps]);

  const currentScopeBalance =
    effectiveScope === 'patient' ? summary.patientBalanceDue : summary.totalRemainingDue;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
      {/* En-tête de la section */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Résumé des paiements et restes à payer
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Graphique en cascade retraçant l'évolution chronologique de la dette patient : facturations (+), encaissements (-) et solde restant dû.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasInsuranceActivity && (
            <div
              role="group"
              aria-label="Périmètre du graphique en cascade"
              className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5 text-[11px]"
            >
              <button
                type="button"
                onClick={() => setScopeMode('patient')}
                aria-pressed={effectiveScope === 'patient'}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  effectiveScope === 'patient'
                    ? 'bg-[#163B63] dark:bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Part patient
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('global')}
                aria-pressed={effectiveScope === 'global'}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                  effectiveScope === 'global'
                    ? 'bg-[#163B63] dark:bg-sky-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Global (Patient + Mutuelle)
              </button>
            </div>
          )}

          {canNavigateFinance && onNavigateInvoices && (
            <button
              type="button"
              onClick={onNavigateInvoices}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50 whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Factures</span>
            </button>
          )}
          {canNavigateFinance && onNavigatePayments && (
            <button
              type="button"
              onClick={onNavigatePayments}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 whitespace-nowrap"
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>Paiements</span>
            </button>
          )}
        </div>
      </div>

      {/* Cartes KPI de synthèse financière */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>{effectiveScope === 'patient' ? 'Total part patient' : 'Total facturé'}</span>
            <FileText className="h-3.5 w-3.5 text-rose-500" />
          </div>
          <p className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatMAD(
              effectiveScope === 'patient' ? summary.totalPatientShare : summary.totalBilled
            )}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            {activeInvoices.length} facture{activeInvoices.length > 1 ? 's' : ''} active
            {activeInvoices.length > 1 ? 's' : ''}
            {effectiveScope === 'patient' && summary.totalBilled !== summary.totalPatientShare
              ? ` · Brut ${formatMAD(summary.totalBilled)}`
              : ''}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Paiements patient</span>
            <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <p className="font-mono text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {formatMAD(summary.totalPatientPaid)}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            {activePayments.filter((p) => p.payerType === 'Patient').length} reçu(s) encaissé(s)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Couverture mutuelle</span>
            <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
          </div>
          <p className="font-mono text-base font-bold text-sky-700 dark:text-sky-400 tabular-nums">
            {formatMAD(summary.totalInsurancePaid)}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
            Sur {formatMAD(summary.totalInsuranceShare)} pris en charge
          </p>
        </div>

        <div
          className={`rounded-xl border p-3.5 space-y-1 ${
            currentScopeBalance > 0.01
              ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30'
              : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
            <span>
              {effectiveScope === 'patient' ? 'Reste à payer patient' : 'Reste à payer global'}
            </span>
            {currentScopeBalance > 0.01 ? (
              <Wallet className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <p
            className={`font-mono text-base font-bold tabular-nums ${
              currentScopeBalance > 0.01
                ? 'text-red-700 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {formatMAD(currentScopeBalance)}
          </p>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">
            {effectiveScope === 'patient' && summary.insuranceBalanceDue > 0
              ? `+ ${formatMAD(summary.insuranceBalanceDue)} en attente mutuelle`
              : currentScopeBalance <= 0.01
              ? 'Dossier intégralement réglé'
              : 'Solde dû exigible'}
          </p>
        </div>
      </div>

      {/* Graphique en cascade */}
      {!chartGeometry || steps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 py-10 px-4 text-center space-y-1.5">
          <Layers className="h-6 w-6 mx-auto text-slate-300 dark:text-slate-600" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Aucun mouvement financier enregistré pour ce patient
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Le graphique en cascade se construira automatiquement dès qu'une facture ou un encaissement sera créé.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Évolution de la dette patient (en cascade · MAD)
            </span>
            <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-rose-600" />
                <span>Facturation (+ dette)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                <span>Paiement patient (-)</span>
              </span>
              {effectiveScope === 'global' && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-sky-500" />
                  <span>Mutuelle (-)</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#163B63] dark:bg-amber-500" />
                <span>Reste à payer</span>
              </span>
            </div>
          </div>

          {/* Zone SVG responsive avec défilement horizontal si de nombreuses opérations */}
          <div className="overflow-x-auto pb-1">
            <svg
              viewBox={`0 0 ${chartGeometry.svgWidth} ${chartGeometry.svgHeight}`}
              style={{ minWidth: `${Math.min(chartGeometry.svgWidth, 680)}px` }}
              className="w-full h-auto max-h-[300px] select-none"
              role="img"
              aria-label="Graphique en cascade de l'évolution de la dette patient"
            >
              {/* Lignes horizontales de grille */}
              {chartGeometry.ticks.map((tick, i) => (
                <g key={i}>
                  <line
                    x1={chartGeometry.padLeft}
                    y1={tick.y}
                    x2={chartGeometry.svgWidth - chartGeometry.padRight}
                    y2={tick.y}
                    className="stroke-slate-200 dark:stroke-slate-800"
                    strokeDasharray={Math.abs(tick.value) < 0.5 ? undefined : '3 3'}
                    strokeWidth={Math.abs(tick.value) < 0.5 ? 1.2 : 1}
                  />
                  <text
                    x={chartGeometry.padLeft - 8}
                    y={tick.y + 3.5}
                    textAnchor="end"
                    className="fill-slate-400 dark:fill-slate-500 font-mono text-[10px]"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Ligne zéro explicite */}
              <line
                x1={chartGeometry.padLeft}
                y1={chartGeometry.baselineY}
                x2={chartGeometry.svgWidth - chartGeometry.padRight}
                y2={chartGeometry.baselineY}
                className="stroke-slate-300 dark:stroke-slate-700"
                strokeWidth={1.2}
              />

              {/* Connecteurs pointillés entre opérations successives */}
              {chartGeometry.bars.map((bar, idx) => {
                if (idx >= chartGeometry.bars.length - 1) return null;
                const nextBar = chartGeometry.bars[idx + 1];
                return (
                  <line
                    key={`conn-${bar.step.id}`}
                    x1={bar.x + bar.barWidth}
                    y1={bar.endY}
                    x2={nextBar.x}
                    y2={bar.endY}
                    className="stroke-slate-400/70 dark:stroke-slate-600"
                    strokeDasharray="3 3"
                    strokeWidth={1.1}
                  />
                );
              })}

              {/* Barres de la cascade */}
              {chartGeometry.bars.map(({ step, x, centerX, barWidth, yTop, yBottom, height }) => {
                const isSelected = activeStep?.id === step.id;
                const isTotal = step.kind === 'total';
                const isCharge = step.kind === 'charge';
                const isInsurance = step.kind === 'insurance';

                const fillClass = isTotal
                  ? step.end > 0.01
                    ? 'fill-[#163B63] dark:fill-amber-500'
                    : 'fill-emerald-600 dark:fill-emerald-500'
                  : isCharge
                  ? 'fill-rose-600 dark:fill-rose-500'
                  : isInsurance
                  ? 'fill-sky-500 dark:fill-sky-400'
                  : 'fill-emerald-600 dark:fill-emerald-500';

                const labelClass = isTotal
                  ? step.end > 0.01
                    ? 'fill-slate-900 dark:fill-amber-300'
                    : 'fill-emerald-700 dark:fill-emerald-300'
                  : isCharge
                  ? 'fill-rose-700 dark:fill-rose-300'
                  : isInsurance
                  ? 'fill-sky-700 dark:fill-sky-300'
                  : 'fill-emerald-700 dark:fill-emerald-300';

                const valueLabel = isTotal
                  ? `${new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(
                      Math.round(step.end)
                    )}`
                  : formatCompactMAD(step.delta);

                const isPositiveMove = isTotal ? step.end >= 0 : step.delta >= 0;
                const valueLabelY = isPositiveMove ? yTop - 6 : yBottom + 12;

                return (
                  <g
                    key={step.id}
                    onMouseEnter={() => setSelectedStepId(step.id)}
                    onClick={() => setSelectedStepId(step.id)}
                    className="cursor-pointer group"
                  >
                    {/* Surbrillance colonne sélectionnée */}
                    {isSelected && (
                      <rect
                        x={x - 5}
                        y={chartGeometry.padTop - 8}
                        width={barWidth + 10}
                        height={chartGeometry.plotHeight + 16}
                        rx={8}
                        className="fill-sky-500/8 dark:fill-sky-400/10 stroke-sky-500/40"
                        strokeWidth={1}
                      />
                    )}

                    <rect
                      x={x}
                      y={yTop}
                      width={barWidth}
                      height={height}
                      rx={5}
                      className={`${fillClass} transition-opacity group-hover:opacity-90`}
                    />

                    {/* Valeur numérique au-dessus/dessous de la barre */}
                    <text
                      x={centerX}
                      y={valueLabelY}
                      textAnchor="middle"
                      className={`font-mono text-[10px] font-bold tabular-nums ${labelClass}`}
                    >
                      {valueLabel}
                    </text>

                    {/* Étiquette axe X (référence + date) */}
                    <text
                      x={centerX}
                      y={chartGeometry.padTop + chartGeometry.plotHeight + 20}
                      textAnchor="middle"
                      className="fill-slate-700 dark:fill-slate-200 font-semibold text-[10px]"
                    >
                      {step.shortLabel.length > 13
                        ? `${step.shortLabel.slice(0, 12)}…`
                        : step.shortLabel}
                    </text>
                    <text
                      x={centerX}
                      y={chartGeometry.padTop + chartGeometry.plotHeight + 34}
                      textAnchor="middle"
                      className="fill-slate-400 dark:fill-slate-500 font-mono text-[9px] tabular-nums"
                    >
                      {step.date ? formatDateFR(step.date) : 'Actuel'}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Bandeau de détail de l'étape sélectionnée / survolée */}
          {activeStep && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`inline-flex items-center justify-center h-6 w-6 rounded-md shrink-0 ${
                    activeStep.kind === 'charge'
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                      : activeStep.kind === 'total'
                      ? 'bg-sky-50 dark:bg-sky-950/60 text-[#163B63] dark:text-sky-400'
                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {activeStep.kind === 'charge' ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : activeStep.kind === 'total' ? (
                    <Wallet className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {activeStep.label}
                    {activeStep.date ? (
                      <span className="ml-2 font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                        · {formatDateFR(activeStep.date)}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {activeStep.detail}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 font-mono tabular-nums text-[11px] shrink-0">
                {activeStep.kind !== 'total' ? (
                  <>
                    <div className="text-right">
                      <p className="text-[10px] font-sans text-slate-400">Variation</p>
                      <p
                        className={`font-bold ${
                          activeStep.delta >= 0
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {activeStep.delta >= 0 ? '+' : ''}
                        {formatMAD(activeStep.delta)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-sans text-slate-400">Dette après opération</p>
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        {formatMAD(activeStep.end)}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="text-right">
                    <p className="text-[10px] font-sans text-slate-400">Solde final dû</p>
                    <p
                      className={`font-bold ${
                        activeStep.end > 0.01
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatMAD(activeStep.end)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Grand livre chronologique détaillé des mouvements */}
      {ledgerRows.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Détail chronologique des écritures ({ledgerRows.length})
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              Solde final : {formatMAD(currentScopeBalance)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Référence</th>
                  <th className="px-4 py-2.5 font-medium">Opération & Détails</th>
                  <th className="px-4 py-2.5 font-medium text-right">Variation dette</th>
                  <th className="px-4 py-2.5 font-medium text-right">Reste cumulé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ledgerRows.map((row) => (
                  <tr
                    key={row.id}
                    onMouseEnter={() => setSelectedStepId(row.id)}
                    className={`transition-colors ${
                      activeStep?.id === row.id
                        ? 'bg-sky-50/70 dark:bg-sky-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {row.date ? formatDateFR(row.date) : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {row.reference}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{row.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{row.detail}</p>
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        row.delta >= 0
                          ? 'text-rose-700 dark:text-rose-400'
                          : row.kind === 'insurance'
                          ? 'text-sky-700 dark:text-sky-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {row.delta >= 0 ? '+' : ''}
                      {formatMAD(row.delta)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatMAD(row.balanceAfter)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
