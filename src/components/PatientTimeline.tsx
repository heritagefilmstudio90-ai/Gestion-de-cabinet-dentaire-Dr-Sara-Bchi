import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Calendar,
  Camera,
  ChevronDown,
  ChevronUp,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  MessageSquare,
  Printer,
  Receipt,
  Search,
  Stethoscope,
} from 'lucide-react';
import { formatDateFR, formatMAD } from '../lib/formatters';
import { formatSentDateTimeFR, stripRecallAppointmentTag } from '../lib/smsReminders';
import {
  Appointment,
  ClinicalNote,
  LabOrder,
  MedicalDocument,
  PatientClinicalAct,
  PatientImaging,
  Payment,
  Invoice,
  Recall,
  TreatmentPlan,
} from '../types/dental';

type TimelineCategory = 'act' | 'document' | 'finance' | 'quote_lab' | 'rdv_sms';

interface TimelineEntry {
  id: string;
  category: TimelineCategory;
  dateSort: string;
  dateLabel: string;
  typeLabel: string;
  title: string;
  subtitle: string;
  statusText?: string;
  statusTone?: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
  amountText?: string;
  detailsText?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

interface PatientTimelineProps {
  clinicalNotes: ClinicalNote[];
  clinicalActs: PatientClinicalAct[];
  medicalDocuments: MedicalDocument[];
  imagingList: PatientImaging[];
  treatmentPlans: TreatmentPlan[];
  invoices: Invoice[];
  payments: Payment[];
  labOrders: LabOrder[];
  appointments: Appointment[];
  recalls: Recall[];
  canViewFinancialTotals: boolean;
  onOpenTab: (tab: 'odontogram' | 'timeline' | 'notes' | 'history' | 'imaging' | 'finance' | 'sms') => void;
  onPrintMedicalDocument: (doc: MedicalDocument) => void;
  onPrintTreatmentPlan: (plan: TreatmentPlan) => void;
  onSelectImaging: (img: PatientImaging) => void;
}

const CATEGORY_META: Record<
  TimelineCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; badgeClass: string }
> = {
  act: {
    label: 'Actes cliniques',
    icon: Stethoscope,
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
  },
  document: {
    label: 'Documents & Imagerie',
    icon: FileText,
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800',
  },
  quote_lab: {
    label: 'Devis & Prothèses',
    icon: FileSpreadsheet,
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800',
  },
  finance: {
    label: 'Factures & Paiements',
    icon: CreditCard,
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  },
  rdv_sms: {
    label: 'RDV & Rappels SMS',
    icon: Calendar,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  },
};

function normalizeSortKey(dateStr?: string, timeStr?: string): string {
  if (!dateStr) return '0000-00-00T00:00:00';
  if (dateStr.includes('T')) return dateStr;
  return `${dateStr.slice(0, 10)}T${timeStr ? timeStr.slice(0, 5) : '00:00'}:00`;
}

export const PatientTimeline: React.FC<PatientTimelineProps> = ({
  clinicalNotes,
  clinicalActs,
  medicalDocuments,
  imagingList,
  treatmentPlans,
  invoices,
  payments,
  labOrders,
  appointments,
  recalls,
  canViewFinancialTotals,
  onOpenTab,
  onPrintMedicalDocument,
  onPrintTreatmentPlan,
  onSelectImaging,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'all' | TimelineCategory>('all');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const allEntries = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];

    // 1. Clinical Notes
    clinicalNotes.forEach((n) => {
      entries.push({
        id: `note-${n.id}`,
        category: 'act',
        dateSort: normalizeSortKey(n.date),
        dateLabel: formatDateFR(n.date),
        typeLabel: 'Note clinique',
        title: n.actName,
        subtitle: [
          n.tooth ? `Dent #${n.tooth}` : null,
          n.faces ? `Faces ${n.faces}` : null,
          n.practitionerName,
        ]
          .filter(Boolean)
          .join(' · '),
        statusText: n.billed ? 'Facturé' : 'Saisi',
        statusTone: n.billed ? 'emerald' : 'sky',
        amountText: canViewFinancialTotals && n.amount > 0 ? formatMAD(n.amount) : undefined,
        detailsText: [
          n.materials ? `Matériaux : ${n.materials}` : '',
          n.report ? n.report : '',
        ]
          .filter(Boolean)
          .join('\n'),
        actionLabel: 'Voir Fil d’Actes',
        onAction: () => onOpenTab('notes'),
      });
    });

    // 2. Imported / Structured Clinical Acts
    clinicalActs.forEach((act) => {
      const displayDate = act.realizationDate || act.date;
      entries.push({
        id: `cact-${act.id}`,
        category: 'act',
        dateSort: normalizeSortKey(displayDate),
        dateLabel: formatDateFR(displayDate),
        typeLabel: 'Acte clinique',
        title: act.actName,
        subtitle: [
          act.teeth ? `Dents ${act.teeth}` : null,
          act.practitionerName,
        ]
          .filter(Boolean)
          .join(' · '),
        statusText: act.status,
        statusTone:
          act.status === 'Fini' ? 'emerald' : act.status === 'En cours' ? 'sky' : 'amber',
        amountText: canViewFinancialTotals ? formatMAD(act.price) : undefined,
        detailsText: canViewFinancialTotals
          ? `Honoraires : ${formatMAD(act.price)} · Reçu : ${formatMAD(act.receivedAmount)} · Reste : ${formatMAD(act.remainingAmount)}`
          : undefined,
        actionLabel: 'Voir Fil d’Actes',
        onAction: () => onOpenTab('notes'),
      });
    });

    // 3. Medical Documents
    medicalDocuments.forEach((docItem) => {
      const details =
        docItem.medicationsText ||
        docItem.actsText ||
        docItem.bodyText ||
        (docItem.prescriptions && docItem.prescriptions.length > 0
          ? docItem.prescriptions
              .map((p) => `${p.molecule} — ${p.dosage} · ${p.frequency} (${p.duration})`)
              .join('\n')
          : '');
      entries.push({
        id: `doc-${docItem.id}`,
        category: 'document',
        dateSort: normalizeSortKey(docItem.date),
        dateLabel: formatDateFR(docItem.date),
        typeLabel: docItem.docType,
        title: docItem.title || docItem.docType,
        subtitle: [
          docItem.practitionerName || 'Praticien',
          docItem.careSheetFund ? `Caisse ${docItem.careSheetFund}` : null,
          docItem.durationDays ? `${docItem.durationDays} jour(s)` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        statusText: 'Document',
        statusTone: 'sky',
        amountText:
          canViewFinancialTotals && typeof docItem.amount === 'number' && docItem.amount > 0
            ? formatMAD(docItem.amount)
            : undefined,
        detailsText: details,
        actionLabel: 'Imprimer A4',
        onAction: () => onPrintMedicalDocument(docItem),
      });
    });

    // 4. Imaging
    imagingList.forEach((img) => {
      entries.push({
        id: `img-${img.id}`,
        category: 'document',
        dateSort: normalizeSortKey(img.date),
        dateLabel: formatDateFR(img.date),
        typeLabel: img.category,
        title: img.title,
        subtitle: [img.toothRef ? `Dent #${img.toothRef}` : null, 'Imagerie diagnostique']
          .filter(Boolean)
          .join(' · '),
        statusText: 'Cliché',
        statusTone: 'slate',
        detailsText: img.notes || undefined,
        actionLabel: 'Ouvrir Négatoscope',
        onAction: () => {
          onSelectImaging(img);
          onOpenTab('imaging');
        },
      });
    });

    // 5. Treatment Plans / Quotes
    treatmentPlans.forEach((pl) => {
      const qDate = pl.quoteDate || (typeof pl.createdAt === 'string' ? pl.createdAt : '');
      const itemsText =
        pl.rawActsText ||
        (pl.items || [])
          .map((it) => `Dent ${it.tooth || '—'} : ${it.actName} (${formatMAD(it.unitPrice * it.quantity - it.discount)})`)
          .join('\n');
      entries.push({
        id: `plan-${pl.id}`,
        category: 'quote_lab',
        dateSort: normalizeSortKey(qDate),
        dateLabel: qDate ? formatDateFR(qDate) : 'Date N/R',
        typeLabel: `Devis ${pl.quoteNumber}`,
        title: pl.title || `Devis ${pl.quoteNumber}`,
        subtitle: [
          pl.practitionerName,
          pl.items?.length ? `${pl.items.length} acte(s)` : null,
          pl.validityDate ? `Valide jusqu'au ${formatDateFR(pl.validityDate)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        statusText: pl.status,
        statusTone:
          pl.status === 'Accepté' || pl.status === 'Terminé'
            ? 'emerald'
            : pl.status === 'Refusé'
            ? 'rose'
            : 'sky',
        amountText: canViewFinancialTotals ? formatMAD(pl.totalAmount) : undefined,
        detailsText: itemsText || undefined,
        actionLabel: 'Imprimer Devis',
        onAction: () => onPrintTreatmentPlan(pl),
      });
    });

    // 6. Lab Orders / Prostheses
    labOrders.forEach((lo) => {
      const d = lo.sentDate || lo.dueDate || lo.returnDate || '';
      entries.push({
        id: `lab-${lo.id}`,
        category: 'quote_lab',
        dateSort: normalizeSortKey(d),
        dateLabel: d ? formatDateFR(d) : 'Date N/R',
        typeLabel: `Prothèse ${lo.orderNumber}`,
        title: `${lo.prosthesisType} · ${lo.labName}`,
        subtitle: [
          lo.teeth ? `Dents ${lo.teeth}` : null,
          lo.shadeVita ? `Teinte ${lo.shadeVita}` : null,
          lo.practitionerName,
        ]
          .filter(Boolean)
          .join(' · '),
        statusText: lo.status,
        statusTone:
          lo.status === 'Validé posé' || lo.status === 'Reçu au cabinet'
            ? 'emerald'
            : lo.status === 'Retour pour correction'
            ? 'rose'
            : 'amber',
        detailsText: lo.notes || undefined,
      });
    });

    // 7. Invoices & Payments (only when role permits viewing financials)
    if (canViewFinancialTotals) {
      invoices.forEach((inv) => {
        const paid = Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0);
        const rem = Math.max(0, Number(inv.totalAmount || 0) - paid);
        entries.push({
          id: `inv-${inv.id}`,
          category: 'finance',
          dateSort: normalizeSortKey(inv.issueDate),
          dateLabel: formatDateFR(inv.issueDate),
          typeLabel: `Facture ${inv.invoiceNumber}`,
          title: `Facturation (${formatMAD(inv.totalAmount)})`,
          subtitle: [
            inv.practitionerName,
            `Réglé : ${formatMAD(paid)}`,
            rem > 0 ? `Reste : ${formatMAD(rem)}` : 'Soldée',
          ]
            .filter(Boolean)
            .join(' · '),
          statusText: inv.status,
          statusTone:
            inv.status === 'Payée'
              ? 'emerald'
              : inv.status === 'Annulée' || inv.status === 'En retard'
              ? 'rose'
              : 'amber',
          amountText: formatMAD(inv.totalAmount),
          detailsText:
            inv.rawActsText ||
            (inv.items || [])
              .map((it) => `${it.actName}${it.tooth ? ` (Dent ${it.tooth})` : ''} : ${formatMAD(it.total)}`)
              .join('\n'),
          actionLabel: 'Voir onglet Finances',
          onAction: () => onOpenTab('finance'),
        });
      });

      payments.forEach((pay) => {
        entries.push({
          id: `pay-${pay.id}`,
          category: 'finance',
          dateSort: normalizeSortKey(pay.date),
          dateLabel: formatDateFR(pay.date),
          typeLabel: `Reçu ${pay.receiptNumber}`,
          title: pay.actName ? `Règlement · ${pay.actName}` : `Encaissement (${pay.rawMethod || pay.method})`,
          subtitle: [
            pay.rawMethod || pay.method,
            pay.payerType,
            pay.enteredBy ? `Saisi par ${pay.enteredBy}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          statusText: pay.isAdvance ? 'Avance' : 'Encaissé',
          statusTone: pay.amount < 0 ? 'rose' : 'emerald',
          amountText: formatMAD(pay.amount),
          detailsText: pay.notes || undefined,
          actionLabel: 'Voir onglet Finances',
          onAction: () => onOpenTab('finance'),
        });
      });
    }

    // 8. Appointments & SMS Recalls
    appointments.forEach((apt) => {
      entries.push({
        id: `apt-${apt.id}`,
        category: 'rdv_sms',
        dateSort: normalizeSortKey(apt.date, apt.startTime),
        dateLabel: `${formatDateFR(apt.date)} · ${apt.startTime}`,
        typeLabel: 'Rendez-vous',
        title: apt.actType,
        subtitle: [
          apt.practitionerName,
          apt.chair,
          apt.reminderStatus ? `Rappel : ${apt.reminderStatus}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        statusText: apt.status,
        statusTone:
          apt.status === 'Terminé' || apt.status === 'Confirmé'
            ? 'emerald'
            : apt.status === 'Absent' || apt.status === 'Annulé'
            ? 'rose'
            : 'sky',
        detailsText: apt.notes || undefined,
        actionLabel: 'Voir Rappels SMS',
        onAction: () => onOpenTab('sms'),
      });
    });

    recalls.forEach((rec) => {
      const dt = rec.lastSentAt || rec.dueDate;
      const body = stripRecallAppointmentTag(rec.notes);
      entries.push({
        id: `rec-${rec.id}`,
        category: 'rdv_sms',
        dateSort: normalizeSortKey(dt),
        dateLabel: formatSentDateTimeFR(dt),
        typeLabel: `Rappel ${rec.channel}`,
        title: rec.reason,
        subtitle: [rec.patientPhone, rec.deliveryStatus].filter(Boolean).join(' · '),
        statusText: rec.status,
        statusTone:
          rec.deliveryStatus === 'Délivré' || rec.deliveryStatus === 'Lu'
            ? 'emerald'
            : rec.deliveryStatus === 'Échec'
            ? 'rose'
            : 'amber',
        detailsText: body ? `« ${body} »` : undefined,
        actionLabel: 'Voir onglet SMS',
        onAction: () => onOpenTab('sms'),
      });
    });

    return entries;
  }, [
    clinicalNotes,
    clinicalActs,
    medicalDocuments,
    imagingList,
    treatmentPlans,
    invoices,
    payments,
    labOrders,
    appointments,
    recalls,
    canViewFinancialTotals,
    onOpenTab,
    onPrintMedicalDocument,
    onPrintTreatmentPlan,
    onSelectImaging,
  ]);

  const countsByCategory = useMemo(() => {
    const counts: Record<TimelineCategory, number> = {
      act: 0,
      document: 0,
      quote_lab: 0,
      finance: 0,
      rdv_sms: 0,
    };
    allEntries.forEach((e) => {
      counts[e.category] += 1;
    });
    return counts;
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEntries
      .filter((entry) => {
        if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
        if (!q) return true;
        const hay = `${entry.typeLabel} ${entry.title} ${entry.subtitle} ${entry.detailsText || ''} ${entry.dateLabel}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) =>
        sortOrder === 'desc'
          ? b.dateSort.localeCompare(a.dateSort)
          : a.dateSort.localeCompare(b.dateSort)
      );
  }, [allEntries, categoryFilter, search, sortOrder]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filterOptions: Array<{ id: 'all' | TimelineCategory; label: string; count: number }> = [
    { id: 'all', label: 'Tout le parcours', count: allEntries.length },
    { id: 'act', label: 'Actes', count: countsByCategory.act },
    { id: 'document', label: 'Docs & Imagerie', count: countsByCategory.document },
    { id: 'quote_lab', label: 'Devis & Prothèses', count: countsByCategory.quote_lab },
    ...(canViewFinancialTotals
      ? [{ id: 'finance' as const, label: 'Factures & Paiements', count: countsByCategory.finance }]
      : []),
    { id: 'rdv_sms', label: 'RDV & SMS', count: countsByCategory.rdv_sms },
  ];

  const statusColorClass = (tone?: TimelineEntry['statusTone']) => {
    switch (tone) {
      case 'emerald':
        return 'text-emerald-700 dark:text-emerald-400';
      case 'rose':
        return 'text-rose-700 dark:text-rose-400';
      case 'amber':
        return 'text-amber-700 dark:text-amber-400';
      case 'sky':
        return 'text-sky-700 dark:text-sky-400';
      default:
        return 'text-slate-600 dark:text-slate-400';
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Ligne de Temps Interactive 360° ({filteredEntries.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Vue chronologique unifiée des actes, documents médicaux, clichés, devis, règlements et rendez-vous
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer (dent, acte, réf...)"
              className="w-52 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <ArrowDownUp className="h-3.5 w-3.5 text-slate-500" />
            <span>{sortOrder === 'desc' ? 'Plus récents' : 'Plus anciens'}</span>
          </button>
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-3">
        {filterOptions.map((opt) => {
          const active = categoryFilter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setCategoryFilter(opt.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700'
              }`}
            >
              <span>{opt.label}</span>
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  active ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {opt.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Chronological Timeline List */}
      {filteredEntries.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
          Aucun événement ne correspond aux filtres sélectionnés dans ce dossier patient.
        </div>
      ) : (
        <div className="relative pl-6 space-y-3">
          {/* Hairline vertical spine */}
          <div
            aria-hidden="true"
            className="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-800"
          />

          {filteredEntries.map((entry) => {
            const meta = CATEGORY_META[entry.category];
            const Icon =
              entry.id.startsWith('img-')
                ? Camera
                : entry.id.startsWith('lab-')
                ? FlaskConical
                : entry.id.startsWith('rec-')
                ? MessageSquare
                : entry.id.startsWith('pay-')
                ? Receipt
                : meta.icon;
            const isExpanded = Boolean(expandedIds[entry.id]);
            const hasDetails = Boolean(entry.detailsText);

            return (
              <div key={entry.id} className="relative">
                {/* Timeline node */}
                <span
                  aria-hidden="true"
                  className={`absolute -left-6 top-2.5 flex h-5 w-5 items-center justify-center rounded-full border ${meta.badgeClass}`}
                >
                  <Icon className="h-3 w-3" />
                </span>

                <div className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 px-4 py-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                          {entry.dateLabel}
                        </span>
                        <span>·</span>
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {entry.typeLabel}
                        </span>
                        {entry.statusText && (
                          <>
                            <span>·</span>
                            <span className={`font-semibold ${statusColorClass(entry.statusTone)}`}>
                              {entry.statusText}
                            </span>
                          </>
                        )}
                      </div>

                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {entry.title}
                      </p>
                      {entry.subtitle && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.subtitle}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {entry.amountText && (
                        <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {entry.amountText}
                        </span>
                      )}

                      {entry.actionLabel && entry.onAction && (
                        <button
                          type="button"
                          onClick={entry.onAction}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/60"
                        >
                          {entry.actionLabel.includes('Imprimer') && (
                            <Printer className="h-3 w-3" />
                          )}
                          <span>{entry.actionLabel}</span>
                        </button>
                      )}

                      {hasDetails && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(entry.id)}
                          aria-label={isExpanded ? 'Masquer les détails' : 'Afficher les détails'}
                          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {hasDetails && isExpanded && (
                    <div className="mt-2.5 border-t border-slate-200/70 dark:border-slate-700/70 pt-2 text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                      {entry.detailsText}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
