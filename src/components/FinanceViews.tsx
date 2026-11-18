import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Eye,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  Search,
  Send,
  Settings,
  X,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { addDaysISO, exportToCsv, formatDateFR, formatMAD, generateSafeId, todayISO } from '../lib/formatters';
import {
  formatSentDateTimeFR,
  formatSmsReminderMessage,
  getAppointmentDateTime,
  isAppointmentDueForSmsReminder,
  resolveSmsReminderSettings,
  stripRecallAppointmentTag,
} from '../lib/smsReminders';
import { canAccessSection, ClaimStatus, Invoice, InvoiceStatus, Payment, PaymentMethod, Recall } from '../types/dental';
import { AccessDeniedView } from './AccessDeniedView';

export const InvoicesView: React.FC = () => {
  const {
    user,
    staffProfile,
    staffList,
    activeRole,
    patients,
    actsCatalog,
    treatmentPlans,
    invoices,
    permissions,
    saveRecord,
    incrementCounter,
    setPrintableDoc,
    openPatientFile,
    showToast,
  } = useClinic();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailInvoice, setDetailInvoice] = useState<Invoice | null>(null);
  const [showNewInvModal, setShowNewInvModal] = useState(false);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const PAGE_SIZE = 50;

  const [invForm, setInvForm] = useState({
    patientId: '',
    actName: actsCatalog[0]?.name || 'Consultation & Bilan complet',
    actCode: actsCatalog[0]?.code || 'C01',
    unitPrice: actsCatalog[0]?.defaultPrice || 300,
    tooth: '',
  });

  const [payForm, setPayForm] = useState({
    amount: 0,
    method: 'Espèces' as PaymentMethod,
    payerType: 'Patient' as 'Patient' | 'Mutuelle',
    isAdvance: false,
    chequeNumber: '',
    bankName: '',
    chequeDepositDate: todayISO(),
    notes: '',
  });

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (q) {
        const haystack = [
          inv.invoiceNumber,
          inv.patientName,
          inv.patientFileNumber,
          inv.practitionerName,
          inv.rawActsText,
          ...(inv.items || []).map((it) => it.actName),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  const totalInvPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const safeInvPage = Math.min(page, totalInvPages);
  const paginatedInvoices = useMemo(() => {
    const start = (safeInvPage - 1) * PAGE_SIZE;
    return filteredInvoices.slice(start, start + PAGE_SIZE);
  }, [filteredInvoices, safeInvPage]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || savingInvoice) return;
    const pat = patients.find((p) => p.id === invForm.patientId) || patients[0];
    if (!pat) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    const total = Number(invForm.unitPrice);
    if (!Number.isFinite(total) || total <= 0) {
      showToast('Veuillez saisir un montant de facture supérieur à 0 MAD.', 'error');
      return;
    }
    setSavingInvoice(true);
    try {
      const num = await incrementCounter('invoiceCounter');
      const insuranceShare = Math.round((total * (pat.coverageRate || 0)) / 100);
      const patientShare = Math.max(0, total - insuranceShare);
      const assignedPrac = staffList.find(
        (s) => s.uid === pat.assignedPractitionerId || s.id === pat.assignedPractitionerId
      );

      await saveRecord(
        'invoices',
        generateSafeId('inv'),
        {
          invoiceNumber: `FAC-${new Date().getFullYear()}-${String(num).padStart(3, '0')}`,
          patientId: pat.id,
          patientName: `${pat.firstName} ${pat.lastName}`.trim().slice(0, 150),
          practitionerId: pat.assignedPractitionerId || user.uid,
          practitionerName: (assignedPrac?.displayName || staffProfile?.displayName || 'Praticien').slice(0, 120),
          planId: '',
          issueDate: todayISO(),
          dueDate: addDaysISO(todayISO(), 15),
          items: [
            {
              actCode: invForm.actCode.trim().slice(0, 30),
              actName: invForm.actName.trim().slice(0, 150) || 'Consultation',
              tooth: invForm.tooth.trim().slice(0, 20),
              quantity: 1,
              unitPrice: total,
              total,
            },
          ],
          totalAmount: total,
          insuranceType: pat.insuranceType,
          insuranceShare,
          patientShare,
          paidAmount: 0,
          insurancePaidAmount: 0,
          status: 'Émise',
          insuranceClaimStatus: pat.insuranceType !== 'Aucune' ? 'Dossier déposé' : 'Aucune',
          createdBy: user.uid,
        },
        true
      );
      setShowNewInvModal(false);
      showToast('Facture officielle émise avec numérotation séquentielle.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'émission de la facture.", 'error');
    } finally {
      setSavingInvoice(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payTarget || savingPayment) return;
    const amt = Number(payForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Le montant encaissé doit être supérieur à 0 MAD.', 'error');
      return;
    }
    const totalRemaining = Math.max(
      0,
      Number(payTarget.totalAmount || 0) -
        Number(payTarget.paidAmount || 0) -
        Number(payTarget.insurancePaidAmount || 0)
    );
    if (amt > totalRemaining + 0.01) {
      showToast(`Le montant saisi dépasse le reste dû (${formatMAD(totalRemaining)}).`, 'error');
      return;
    }
    setSavingPayment(true);
    try {
      const recNum = await incrementCounter('receiptCounter');

      await saveRecord(
        'payments',
        generateSafeId('pay'),
        {
          receiptNumber: `REC-${new Date().getFullYear()}-${String(recNum).padStart(3, '0')}`,
          invoiceId: payTarget.id,
          patientId: payTarget.patientId,
          patientName: payTarget.patientName.slice(0, 150),
          practitionerId: payTarget.practitionerId,
          date: todayISO(),
          amount: amt,
          method: payForm.method,
          payerType: payForm.payerType,
          isAdvance: payForm.isAdvance,
          chequeNumber: payForm.method === 'Chèque' ? payForm.chequeNumber.trim().slice(0, 60) : '',
          bankName: payForm.method === 'Chèque' ? payForm.bankName.trim().slice(0, 80) : '',
          chequeDepositDate: payForm.method === 'Chèque' ? payForm.chequeDepositDate : '',
          notes: payForm.notes.trim().slice(0, 250),
          createdBy: user.uid,
        },
        true
      );

      const nextPaid =
        payForm.payerType === 'Patient'
          ? Number(payTarget.paidAmount || 0) + amt
          : Number(payTarget.paidAmount || 0);
      const nextInsPaid =
        payForm.payerType === 'Mutuelle'
          ? Number(payTarget.insurancePaidAmount || 0) + amt
          : Number(payTarget.insurancePaidAmount || 0);

      const totalPaidOverall = nextPaid + nextInsPaid;
      let nextStatus: InvoiceStatus = payTarget.status;
      if (totalPaidOverall >= payTarget.totalAmount - 0.01) {
        nextStatus = 'Payée';
      } else if (totalPaidOverall > 0.01) {
        nextStatus = 'Partiellement payée';
      }

      const nextClaimStatus =
        payForm.payerType === 'Mutuelle'
          ? nextInsPaid >= (payTarget.insuranceShare || 0) - 0.01
            ? 'Remboursée'
            : 'En attente remboursement'
          : payTarget.insuranceClaimStatus || 'Aucune';

      await saveRecord(
        'invoices',
        payTarget.id,
        {
          paidAmount: nextPaid,
          insurancePaidAmount: nextInsPaid,
          status: nextStatus,
          insuranceClaimStatus: nextClaimStatus,
        },
        false
      );

      if (nextStatus === 'Payée' && payTarget.planId) {
        const linkedPlan = treatmentPlans.find((pl) => pl.id === payTarget.planId);
        if (linkedPlan) {
          await saveRecord(
            'treatmentPlans',
            linkedPlan.id,
            {
              items: linkedPlan.items.map((it) => ({ ...it, status: 'Payé' })),
              status: 'Terminé',
            },
            false
          );
        }
      }

      setPayTarget(null);
      showToast('Encaissement et reçu enregistrés.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement du paiement.", 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handlePrintInvoice = (inv: Invoice) => {
    const pat = patients.find((p) => p.id === inv.patientId);
    setPrintableDoc({
      kind: 'invoice',
      title: 'Facture / Note d\'Honoraires',
      reference: inv.invoiceNumber,
      date: inv.issueDate,
      patientName: inv.patientName,
      patientCin: pat?.cin,
      patientPhone: pat?.phone,
      patientInsurance: inv.insuranceType || pat?.insuranceType,
      patientInsuranceNumber: pat?.insuranceNumber,
      practitionerName: inv.practitionerName || 'Praticien',
      items: inv.items.map((it) => ({
        label: it.actName,
        tooth: it.tooth,
        qty: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total,
      })),
      totalAmount: inv.totalAmount,
      insuranceShare: inv.insuranceShare,
      patientShare: inv.patientShare,
      paidAmount: Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0),
    });
  };

  if (!canAccessSection(activeRole, 'invoices')) {
    return <AccessDeniedView sectionLabel="Factures" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-3 w-full sm:flex-1">
          <div className="relative w-full sm:min-w-[240px] sm:max-w-md sm:flex-1">
            <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° facture, patient, N° Patient, actes, praticien..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-2 text-xs"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
          >
            <option value="all">Tous les statuts ({invoices.length})</option>
            {(['Émise', 'Partiellement payée', 'Payée', 'En retard', 'Annulée'] as InvoiceStatus[]).map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              )
            )}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `factures-${todayISO()}.csv`,
                [
                  'Numéro',
                  'Date',
                  'Montant MAD',
                  'Patient',
                  'Num Patient',
                  'Praticien',
                  'Actes',
                  'Créé le',
                  'Dernière mise à jour le',
                  'Encaissé Total',
                  'Reste dû',
                  'Statut',
                ],
                filteredInvoices.map((i) => {
                  const totalPaid = Number(i.paidAmount || 0) + Number(i.insurancePaidAmount || 0);
                  const totalRem = Math.max(0, Number(i.totalAmount || 0) - totalPaid);
                  return [
                    i.invoiceNumber,
                    i.issueDate,
                    i.totalAmount,
                    i.patientName,
                    i.patientFileNumber || '',
                    i.practitionerName || '',
                    i.rawActsText || (i.items || []).map((it) => it.actName).join(' | '),
                    i.csvCreatedAt || '',
                    i.csvUpdatedAt || '',
                    totalPaid,
                    totalRem,
                    i.status,
                  ];
                })
              )
            }
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Export CSV
          </button>
          {permissions.canCreateInvoicesAndPayments && (
            <button
              type="button"
              onClick={() => {
                if (patients.length === 0) {
                  showToast("Créez d'abord un dossier patient.", 'error');
                  return;
                }
                setInvForm({
                  patientId: patients[0]?.id || '',
                  actName: actsCatalog[0]?.name || 'Consultation & Bilan complet',
                  actCode: actsCatalog[0]?.code || 'C01',
                  unitPrice: actsCatalog[0]?.defaultPrice || 300,
                  tooth: '',
                });
                setShowNewInvModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nouvelle Facture</span>
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-3 py-3 font-medium whitespace-nowrap">Numéro</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Date</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">N° Patient</th>
                <th className="px-3 py-3 font-medium">Patient</th>
                <th className="px-3 py-3 font-medium">Praticien</th>
                <th className="px-3 py-3 font-medium min-w-[220px]">Actes</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Montant</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Encaissé</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Reste dû</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Créé / MAJ</th>
                <th className="px-3 py-3 font-medium">Statut</th>
                <th className="px-3 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedInvoices.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Aucune facture correspondante.
                  </td>
                </tr>
              ) : (
                paginatedInvoices.map((inv) => {
                  const totalPaid = Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0);
                  const patientRemaining = Math.max(0, Number(inv.patientShare || 0) - Number(inv.paidAmount || 0));
                  const insuranceRemaining = Math.max(0, Number(inv.insuranceShare || 0) - Number(inv.insurancePaidAmount || 0));
                  const remaining = Math.max(0, Number(inv.totalAmount || 0) - totalPaid);
                  const defaultPayerType: 'Patient' | 'Mutuelle' =
                    patientRemaining > 0 ? 'Patient' : insuranceRemaining > 0 ? 'Mutuelle' : 'Patient';
                  const defaultAmount =
                    defaultPayerType === 'Patient' ? patientRemaining : insuranceRemaining;
                  const actsPreview =
                    inv.rawActsText || (inv.items || []).map((it) => it.actName).join('\n');

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                      <td className="px-3 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {inv.invoiceNumber}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatDateFR(inv.issueDate)}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {inv.patientFileNumber || '—'}
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-900 dark:text-slate-100">
                        <button
                          type="button"
                          onClick={() => openPatientFile(inv.patientId)}
                          className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                          title="Ouvrir le dossier patient 360°"
                        >
                          {inv.patientName}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {inv.practitionerName || '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300 max-w-xs">
                        <p className="whitespace-pre-line line-clamp-3 text-[11px] leading-snug">
                          {actsPreview || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100 whitespace-nowrap">
                        {formatMAD(inv.totalAmount)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {formatMAD(totalPaid)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-red-700 dark:text-red-400 whitespace-nowrap">
                        <span>{formatMAD(remaining)}</span>
                        {insuranceRemaining > 0 && (
                          <span className="block text-[10px] font-normal text-sky-600 dark:text-sky-400">
                            dont {formatMAD(insuranceRemaining)} mutuelle
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[11px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <div>{inv.csvCreatedAt || formatDateFR(inv.issueDate)}</div>
                        {inv.csvUpdatedAt && (
                          <div className="text-[10px] text-slate-400">MAJ : {inv.csvUpdatedAt}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 font-medium whitespace-nowrap">
                        <span
                          className={
                            inv.status === 'Payée'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : inv.status === 'En retard'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDetailInvoice(inv)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                          title="Voir tous les champs de la facture"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Détails</span>
                        </button>
                        {permissions.canCreateInvoicesAndPayments && remaining > 0 && inv.status !== 'Annulée' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayTarget(inv);
                              setPayForm({
                                amount: defaultAmount > 0 ? defaultAmount : remaining,
                                method: 'Espèces',
                                payerType: defaultPayerType,
                                isAdvance: false,
                                chequeNumber: '',
                                bankName: '',
                                chequeDepositDate: todayISO(),
                                notes: '',
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                          >
                            <CreditCard className="h-3 w-3" />
                            <span>Encaisser</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePrintInvoice(inv)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <Printer className="h-3 w-3" />
                          <span>Imprimer</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Factures */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-2.5 text-xs">
          <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
            {filteredInvoices.length === 0
              ? '0 facture'
              : `${(safeInvPage - 1) * PAGE_SIZE + 1}–${Math.min(
                  safeInvPage * PAGE_SIZE,
                  filteredInvoices.length
                )} sur ${filteredInvoices.length} facture(s)`}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeInvPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Précédent</span>
            </button>
            <span className="px-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
              Page {safeInvPage} / {totalInvPages}
            </span>
            <button
              type="button"
              disabled={safeInvPage >= totalInvPages}
              onClick={() => setPage((p) => Math.min(totalInvPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <span>Suivant</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Invoice Full Details Modal */}
      {detailInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto"
          onClick={() => setDetailInvoice(null)}
        >
          <div
            className="my-auto w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl space-y-4 text-xs max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Détails complets · Facture {detailInvoice.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {detailInvoice.patientName} {detailInvoice.patientFileNumber ? `(N° Patient : ${detailInvoice.patientFileNumber})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailInvoice(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200/80 dark:border-slate-700">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Numéro</span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">{detailInvoice.invoiceNumber}</strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Date</span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">{formatDateFR(detailInvoice.issueDate)}</strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Montant</span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">{formatMAD(detailInvoice.totalAmount)}</strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Patient</span>
                <strong className="text-slate-900 dark:text-slate-100">{detailInvoice.patientName}</strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Num Patient</span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">{detailInvoice.patientFileNumber || '—'}</strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Praticien</span>
                <strong className="text-slate-900 dark:text-slate-100">{detailInvoice.practitionerName || '—'}</strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Créé le</span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">{detailInvoice.csvCreatedAt || formatDateFR(detailInvoice.issueDate)}</strong>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 dark:text-slate-400 block">Dernière mise à jour le</span>
                <strong className="font-mono text-slate-900 dark:text-slate-100">{detailInvoice.csvUpdatedAt || '—'}</strong>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Actes facturés</p>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3 whitespace-pre-line text-slate-800 dark:text-slate-200 leading-relaxed">
                {detailInvoice.rawActsText ||
                  (detailInvoice.items || []).map((it) => `• ${it.actName} (${formatMAD(it.total)})`).join('\n') ||
                  '—'}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const target = detailInvoice;
                  setDetailInvoice(null);
                  handlePrintInvoice(target);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 font-medium text-white hover:bg-sky-700"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Imprimer la facture</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Invoice Modal */}
      {showNewInvModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Émettre une Facture</h3>
              <button type="button" onClick={() => setShowNewInvModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Patient</label>
                <select
                  value={invForm.patientId}
                  onChange={(e) => setInvForm({ ...invForm, patientId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} ({p.insuranceType} {p.coverageRate}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Acte</label>
                <select
                  value={invForm.actName}
                  onChange={(e) => {
                    const act = actsCatalog.find((a) => a.name === e.target.value);
                    setInvForm({
                      ...invForm,
                      actName: e.target.value,
                      actCode: act?.code || '',
                      unitPrice: act?.defaultPrice || invForm.unitPrice,
                    });
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {actsCatalog.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.code} — {a.name} ({formatMAD(a.defaultPrice)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Dent</label>
                  <input
                    value={invForm.tooth}
                    onChange={(e) => setInvForm({ ...invForm, tooth: e.target.value })}
                    placeholder="Ex: 16"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Montant (MAD)</label>
                  <input
                    type="number"
                    min={0}
                    value={invForm.unitPrice}
                    onChange={(e) => setInvForm({ ...invForm, unitPrice: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingInvoice}
                  onClick={() => setShowNewInvModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingInvoice}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingInvoice ? 'Émission...' : 'Émettre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Encaisser {payTarget.invoiceNumber} — {payTarget.patientName}
              </h3>
              <button type="button" onClick={() => setPayTarget(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Montant (MAD)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Mode de règlement</label>
                  <select
                    value={payForm.method}
                    onChange={(e) => setPayForm({ ...payForm, method: e.target.value as PaymentMethod })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    <option value="Espèces">Espèces</option>
                    <option value="Carte bancaire">Carte bancaire</option>
                    <option value="Virement">Virement</option>
                    <option value="Chèque">Chèque</option>
                  </select>
                </div>
              </div>

              {payForm.method === 'Chèque' && (
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-200 dark:border-slate-700">
                  <input
                    required
                    placeholder="N° Chèque"
                    value={payForm.chequeNumber}
                    onChange={(e) => setPayForm({ ...payForm, chequeNumber: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-1.5 font-mono"
                  />
                  <input
                    required
                    placeholder="Banque"
                    value={payForm.bankName}
                    onChange={(e) => setPayForm({ ...payForm, bankName: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-1.5"
                  />
                  <input
                    type="date"
                    value={payForm.chequeDepositDate}
                    onChange={(e) => setPayForm({ ...payForm, chequeDepositDate: e.target.value })}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <select
                  value={payForm.payerType}
                  onChange={(e) => {
                    const nextType = e.target.value as 'Patient' | 'Mutuelle';
                    const patDue = Math.max(0, Number(payTarget.patientShare || 0) - Number(payTarget.paidAmount || 0));
                    const insDue = Math.max(0, Number(payTarget.insuranceShare || 0) - Number(payTarget.insurancePaidAmount || 0));
                    const suggested = nextType === 'Patient' ? patDue : insDue;
                    setPayForm({
                      ...payForm,
                      payerType: nextType,
                      amount: suggested > 0 ? suggested : payForm.amount,
                    });
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  <option value="Patient">Règlement Patient</option>
                  <option value="Mutuelle">Remboursement Mutuelle</option>
                </select>
                <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={payForm.isAdvance}
                    onChange={(e) => setPayForm({ ...payForm, isAdvance: e.target.checked })}
                  />
                  <span>Acompte / Avance prothèse</span>
                </label>
              </div>

              <input
                placeholder="Notes ou référence..."
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingPayment}
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingPayment}
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingPayment ? 'Validation...' : "Valider l'encaissement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export const PaymentsView: React.FC = () => {
  const { activeRole, payments, patients, invoices, staffList, clinicSettings, setPrintableDoc, openPatientFile } = useClinic();
  const [methodFilter, setMethodFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailPayment, setDetailPayment] = useState<Payment | null>(null);
  const PAGE_SIZE = 50;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter((p) => {
      if (methodFilter !== 'all' && p.method !== methodFilter) return false;
      if (q) {
        const haystack = [
          p.receiptNumber,
          p.patientName,
          p.patientFileNumber,
          p.actCode,
          p.actName,
          p.actIdRef,
          p.practitionerName,
          p.enteredBy,
          p.notes,
          p.chequeNumber,
          p.rawMethod,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [payments, methodFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [methodFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedPayments = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const totalFilteredAmount = useMemo(
    () => filtered.reduce((s, p) => s + Number(p.amount || 0), 0),
    [filtered]
  );

  const printReceipt = (pay: Payment) => {
    const pat = patients.find((p) => p.id === pay.patientId);
    const linkedInvoice = invoices.find((i) => i.id === pay.invoiceId);
    const linkedPrac = staffList.find((s) => s.uid === pay.practitionerId || s.id === pay.practitionerId);
    setPrintableDoc({
      kind: 'receipt',
      title: 'Reçu de Paiement',
      subtitle: pay.actName ? `${pay.actCode ? `${pay.actCode} — ` : ''}${pay.actName}` : undefined,
      reference: pay.receiptNumber,
      date: pay.date,
      patientName: pay.patientName,
      patientCin: pat?.cin,
      patientPhone: pat?.phone,
      practitionerName:
        pay.practitionerName ||
        linkedInvoice?.practitionerName ||
        linkedPrac?.displayName ||
        clinicSettings?.clinicName ||
        'Cabinet Dentaire',
      totalAmount: pay.actFees && pay.actFees > 0 ? pay.actFees : pay.amount,
      paidAmount: pay.amount,
      paymentMethod: `${pay.rawMethod || pay.method}${pay.chequeNumber ? ` N° ${pay.chequeNumber}` : ''}`,
      bodyText: pay.notes || 'Paiement reçu avec remerciements.',
    });
  };

  if (!canAccessSection(activeRole, 'payments')) {
    return <AccessDeniedView sectionLabel="Paiements" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-3 w-full sm:flex-1">
          <div className="relative w-full sm:min-w-[240px] sm:max-w-md sm:flex-1">
            <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Patient, N° P, Code/Acte, ID Acte, saisi par, note..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-2 text-xs"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
          >
            <option value="all">Tous modes ({payments.length})</option>
            <option value="Espèces">Espèces</option>
            <option value="Virement">Virement bancaire</option>
            <option value="Solde Portefeuille">Solde Portefeuille</option>
            <option value="Carte bancaire">Carte bancaire</option>
            <option value="Chèque">Chèque</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {filtered.length} encaissement(s) · Total : {formatMAD(totalFilteredAmount)}
          </p>
          <button
            type="button"
            onClick={() =>
              exportToCsv(
                `paiements-${todayISO()}.csv`,
                [
                  'Date',
                  'Num P',
                  'Patient',
                  'Code Acte',
                  'Acte',
                  'Honoraires',
                  'Ancien Paiement',
                  'Montant encaissé',
                  'Type',
                  'Reste',
                  'Chéque date',
                  'Chéque référence',
                  'Chéque montant',
                  'Chéque statut',
                  'Chéque date de depot',
                  "Chéque date d'encaissement",
                  'Chéque de garantie',
                  'Praticien',
                  'Note',
                  'Saisi par',
                  'Créé à',
                  'ID Acte',
                ],
                filtered.map((p) => [
                  p.date,
                  p.patientFileNumber || '',
                  p.patientName,
                  p.actCode || '',
                  p.actName || '',
                  p.actFees ?? '',
                  p.previousPayment ?? '',
                  p.amount,
                  p.rawMethod || p.method,
                  p.remainingBalance ?? '',
                  p.chequeDate || '',
                  p.chequeNumber || '',
                  p.chequeAmount ?? '',
                  p.chequeStatus || '',
                  p.chequeDepositDate || '',
                  p.chequeEncashmentDate || '',
                  p.chequeGuarantee || '',
                  p.practitionerName || '',
                  p.notes || '',
                  p.enteredBy || '',
                  p.csvCreatedAt || '',
                  p.actIdRef || '',
                ])
              )
            }
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Export CSV (22 col.)
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-3 py-3 font-medium whitespace-nowrap">Date</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Num P</th>
                <th className="px-3 py-3 font-medium">Patient</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Code Acte</th>
                <th className="px-3 py-3 font-medium min-w-[170px]">Acte</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Honoraires</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Anc. Paiement</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Encaissé</th>
                <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Reste</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Type</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Praticien</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Saisi par</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">ID Acte</th>
                <th className="px-3 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedPayments.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Aucun paiement correspondant.
                  </td>
                </tr>
              ) : (
                paginatedPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {formatDateFR(p.date)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {p.patientFileNumber || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openPatientFile(p.patientId)}
                        className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                        title="Ouvrir le dossier patient 360°"
                      >
                        {p.patientName}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sky-700 dark:text-sky-400 whitespace-nowrap">
                      {p.actCode || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 max-w-[220px] truncate" title={p.actName || ''}>
                      {p.actName || '—'}
                      {p.notes ? (
                        <span className="block text-[10px] text-slate-400 truncate" title={p.notes}>
                          Note : {p.notes}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {typeof p.actFees === 'number' ? formatMAD(p.actFees) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {typeof p.previousPayment === 'number' ? formatMAD(p.previousPayment) : '—'}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        p.amount < 0
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatMAD(p.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      {typeof p.remainingBalance === 'number' ? formatMAD(p.remainingBalance) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {p.rawMethod || p.method}
                      {p.chequeNumber ? ` · Chq ${p.chequeNumber}` : ''}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {p.practitionerName || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {p.enteredBy || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {p.actIdRef || p.receiptNumber}
                    </td>
                    <td className="px-3 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setDetailPayment(p)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        title="Afficher les 22 colonnes de l'encaissement"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Détails</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => printReceipt(p)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Printer className="h-3 w-3" />
                        <span>Reçu</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Paiements */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-2.5 text-xs">
          <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
            {filtered.length === 0
              ? '0 paiement'
              : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(
                  safePage * PAGE_SIZE,
                  filtered.length
                )} sur ${filtered.length} encaissement(s)`}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Précédent</span>
            </button>
            <span className="px-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
            >
              <span>Suivant</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Payment 22-column Full Detail Modal */}
      {detailPayment && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto"
          onClick={() => setDetailPayment(null)}
        >
          <div
            className="my-auto w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl space-y-4 text-xs max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Fiche complète d'encaissement · {detailPayment.actIdRef || detailPayment.receiptNumber}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {detailPayment.patientName} (Num P : {detailPayment.patientFileNumber || '—'})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailPayment(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-4 border border-slate-200/80 dark:border-slate-700">
              {[
                ['Date', formatDateFR(detailPayment.date)],
                ['Num P', detailPayment.patientFileNumber || '—'],
                ['Patient', detailPayment.patientName],
                ['Code Acte', detailPayment.actCode || '—'],
                ['Acte', detailPayment.actName || '—'],
                ['Honoraires', typeof detailPayment.actFees === 'number' ? formatMAD(detailPayment.actFees) : '—'],
                ['Ancien Paiement', typeof detailPayment.previousPayment === 'number' ? formatMAD(detailPayment.previousPayment) : '—'],
                ['Montant encaissé', formatMAD(detailPayment.amount)],
                ['Type', detailPayment.rawMethod || detailPayment.method],
                ['Reste', typeof detailPayment.remainingBalance === 'number' ? formatMAD(detailPayment.remainingBalance) : '—'],
                ['Chéque date', detailPayment.chequeDate ? formatDateFR(detailPayment.chequeDate) : '—'],
                ['Chéque référence', detailPayment.chequeNumber || '—'],
                ['Chéque montant', typeof detailPayment.chequeAmount === 'number' ? formatMAD(detailPayment.chequeAmount) : '—'],
                ['Chéque statut', detailPayment.chequeStatus || '—'],
                ['Chéque date de depot', detailPayment.chequeDepositDate ? formatDateFR(detailPayment.chequeDepositDate) : '—'],
                ["Chéque date d'encaissement", detailPayment.chequeEncashmentDate ? formatDateFR(detailPayment.chequeEncashmentDate) : '—'],
                ['Chéque de garantie', detailPayment.chequeGuarantee || '—'],
                ['Praticien', detailPayment.practitionerName || '—'],
                ['Note', detailPayment.notes || '—'],
                ['Saisi par', detailPayment.enteredBy || '—'],
                ['Créé à', detailPayment.csvCreatedAt || '—'],
                ['ID Acte', detailPayment.actIdRef || detailPayment.receiptNumber],
              ].map(([label, val]) => (
                <div key={label} className={label === 'Acte' || label === 'Note' ? 'sm:col-span-2' : ''}>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">{label}</span>
                  <strong className="text-slate-900 dark:text-slate-100 font-medium break-words">{val}</strong>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  const target = detailPayment;
                  setDetailPayment(null);
                  printReceipt(target);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 font-medium text-white hover:bg-sky-700"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Imprimer le reçu</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const InsuranceARView: React.FC = () => {
  const { activeRole, invoices, treatmentPlans, saveRecord, openPatientFile, showToast, permissions } = useClinic();
  const [page, setPage] = useState(1);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  const claims = useMemo(
    () => invoices.filter((i) => (i.insuranceShare || 0) > 0 && i.status !== 'Annulée'),
    [invoices]
  );

  const totalOpenClaims = useMemo(
    () =>
      claims.reduce(
        (s, c) => s + Math.max(0, Number(c.insuranceShare || 0) - Number(c.insurancePaidAmount || 0)),
        0
      ),
    [claims]
  );

  const totalPages = Math.max(1, Math.ceil(claims.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedClaims = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return claims.slice(start, start + PAGE_SIZE);
  }, [claims, safePage]);

  const updateClaimStatus = async (inv: Invoice, status: ClaimStatus) => {
    if (!permissions.canCreateInvoicesAndPayments || busyClaimId === inv.id) return;
    setBusyClaimId(inv.id);
    try {
      const nextInsPaid =
        status === 'Remboursée' ? Number(inv.insuranceShare || 0) : 0;
      const totalPaidOverall = Number(inv.paidAmount || 0) + nextInsPaid;
      const nextInvoiceStatus: InvoiceStatus =
        totalPaidOverall >= Number(inv.totalAmount || 0) - 0.01
          ? 'Payée'
          : totalPaidOverall > 0.01
          ? 'Partiellement payée'
          : 'Émise';

      await saveRecord(
        'invoices',
        inv.id,
        {
          insuranceClaimStatus: status,
          insurancePaidAmount: nextInsPaid,
          status: nextInvoiceStatus,
        },
        false
      );

      if (nextInvoiceStatus === 'Payée' && inv.planId) {
        const linkedPlan = treatmentPlans.find((pl) => pl.id === inv.planId);
        if (linkedPlan) {
          await saveRecord(
            'treatmentPlans',
            linkedPlan.id,
            {
              items: linkedPlan.items.map((it) => ({ ...it, status: 'Payé' })),
              status: 'Terminé',
            },
            false
          );
        }
      }

      showToast(`Dossier mutuelle mis à jour : ${status}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour du dossier mutuelle.', 'error');
    } finally {
      setBusyClaimId(null);
    }
  };

  if (!canAccessSection(activeRole, 'insurance')) {
    return <AccessDeniedView sectionLabel="Mutuelles (AMO/CNSS)" />;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Suivi des Créances Mutuelles (AMO / CNSS / CNOPS / Privées)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dossiers de tiers-payant et remboursements en attente ({claims.length})
            </p>
          </div>
          <p className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400 tabular-nums">
            Total créances ouvertes : {formatMAD(totalOpenClaims)}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">Facture</th>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Organisme</th>
                <th className="px-4 py-3 font-medium text-right">Part Mutuelle</th>
                <th className="px-4 py-3 font-medium text-right">Remboursé</th>
                <th className="px-4 py-3 font-medium">Statut Dossier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedClaims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    Aucune créance mutuelle active.
                  </td>
                </tr>
              ) : (
                paginatedClaims.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">{c.invoiceNumber}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      <button
                        type="button"
                        onClick={() => openPatientFile(c.patientId)}
                        className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                        title="Ouvrir le dossier patient 360°"
                      >
                        {c.patientName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{c.insuranceType || 'Mutuelle'}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">{formatMAD(c.insuranceShare)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMAD(c.insurancePaidAmount || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        disabled={!permissions.canCreateInvoicesAndPayments || busyClaimId === c.id}
                        value={c.insuranceClaimStatus || 'Dossier déposé'}
                        onChange={(e) => void updateClaimStatus(c, e.target.value as ClaimStatus)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 text-xs disabled:opacity-60"
                      >
                        <option value="Dossier déposé">Dossier déposé</option>
                        <option value="En attente remboursement">En attente remboursement</option>
                        <option value="Remboursée">Remboursée</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-2.5 text-xs">
            <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, claims.length)} sur {claims.length} dossier(s)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Précédent</span>
              </button>
              <span className="px-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <span>Suivant</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const RecallsView: React.FC = () => {
  const {
    user,
    activeRole,
    patients,
    appointments,
    recalls,
    clinicSettings,
    permissions,
    saveRecord,
    openPatientFile,
    setActiveSection,
    sendAppointmentReminder,
    dispatchRecallNotification,
    runDueSmsReminders,
    showToast,
  } = useClinic();

  const canManageRecalls = permissions.canManageRecalls;
  const [activeSubTab, setActiveSubTab] = useState<'sms-queue' | 'history'>('sms-queue');
  const [windowFilter, setWindowFilter] = useState<'due' | '48h' | '7d' | 'all'>('48h');
  const [channelFilter, setChannelFilter] = useState<'all' | 'SMS' | 'WhatsApp' | 'Appel'>('all');
  const [sendingAptAction, setSendingAptAction] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [savingRecall, setSavingRecall] = useState(false);
  const [busyRecallId, setBusyRecallId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    patientId: '',
    reason: 'Contrôle semestriel & Détartrage',
    dueDate: todayISO(),
    channel: 'SMS' as 'WhatsApp' | 'SMS' | 'Appel',
    notes: '',
  });

  const smsConfig = useMemo(() => resolveSmsReminderSettings(clinicSettings), [clinicSettings]);
  const patientById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    const today = todayISO();
    return appointments
      .filter((apt) => {
        if (apt.status !== 'En attente' && apt.status !== 'Confirmé') return false;
        if (apt.date < today) return false;
        const dt = getAppointmentDateTime(apt.date, apt.startTime);
        if (!dt) return false;
        const diffHours = (dt.getTime() - now.getTime()) / 3600000;
        if (diffHours <= 0) return false;
        if (windowFilter === 'due') {
          return isAppointmentDueForSmsReminder(apt, smsConfig.hoursBefore, now);
        }
        if (windowFilter === '48h') return diffHours <= 48;
        if (windowFilter === '7d') return diffHours <= 24 * 7;
        return true;
      })
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  }, [appointments, windowFilter, smsConfig.hoursBefore]);

  const dueAppointmentsCount = useMemo(() => {
    const now = new Date();
    return appointments.filter((apt) =>
      isAppointmentDueForSmsReminder(apt, smsConfig.hoursBefore, now)
    ).length;
  }, [appointments, smsConfig.hoursBefore]);

  const sentSmsCount = useMemo(
    () => recalls.filter((r) => r.channel === 'SMS' && r.status === 'Envoyé').length,
    [recalls]
  );

  const filteredRecalls = useMemo(
    () =>
      recalls
        .filter((r) => channelFilter === 'all' || r.channel === channelFilter)
        .sort((a, b) =>
          (b.lastSentAt || `${b.dueDate}T00:00:00`).localeCompare(
            a.lastSentAt || `${a.dueDate}T00:00:00`
          )
        ),
    [recalls, channelFilter]
  );

  const handleRunDueBatch = async () => {
    if (!canManageRecalls || batchRunning) return;
    setBatchRunning(true);
    try {
      const count = await runDueSmsReminders(true);
      if (count > 0) {
        showToast(`${count} rappel(s) SMS J-${smsConfig.hoursBefore}h envoyé(s).`, 'success');
      } else {
        showToast('Aucun rappel SMS en attente dans la fenêtre configurée.', 'info');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec de l'envoi groupé des rappels SMS.", 'error');
    } finally {
      setBatchRunning(false);
    }
  };

  const handleSendAppointmentChannel = async (
    aptId: string,
    channel: 'SMS' | 'WhatsApp' | 'Appel'
  ) => {
    const apt = appointments.find((a) => a.id === aptId);
    const actionKey = `${aptId}:${channel}`;
    if (!apt || !canManageRecalls || sendingAptAction === actionKey) return;
    setSendingAptAction(actionKey);
    try {
      const ok = await sendAppointmentReminder(apt, channel, { isAuto: false });
      if (ok) {
        if (channel === 'SMS') {
          showToast(`Rappel SMS envoyé à ${apt.patientName}.`, 'success');
        } else if (channel === 'WhatsApp') {
          showToast(`WhatsApp ouvert pour ${apt.patientName}.`, 'success');
        } else {
          showToast(`Appel lancé vers ${apt.patientName}.`, 'success');
        }
      } else {
        showToast('Numéro de téléphone patient manquant ou rôle non autorisé.', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Échec du rappel ${channel}.`, 'error');
    } finally {
      setSendingAptAction(null);
    }
  };

  const handleCreateRecall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManageRecalls || savingRecall) return;
    const pat = patients.find((p) => p.id === form.patientId) || patients[0];
    if (!pat) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    setSavingRecall(true);
    try {
      await saveRecord(
        'recalls',
        generateSafeId('rec'),
        {
          patientId: pat.id,
          patientName: `${pat.firstName} ${pat.lastName}`.trim().slice(0, 150),
          patientPhone: (pat.phone || '').slice(0, 40),
          practitionerId: pat.assignedPractitionerId || user.uid,
          reason: form.reason.trim().slice(0, 160) || 'Rappel patient',
          dueDate: form.dueDate,
          channel: form.channel,
          status: form.dueDate < todayISO() ? 'En retard' : 'À faire',
          deliveryStatus: 'Non envoyé',
          notes: form.notes.trim().slice(0, 290),
          createdBy: user.uid,
        },
        true
      );
      setShowModal(false);
      setForm({
        patientId: pat.id,
        reason: 'Contrôle semestriel & Détartrage',
        dueDate: todayISO(),
        channel: form.channel,
        notes: '',
      });
      showToast(`Rappel ${form.channel} programmé.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la création du rappel.', 'error');
    } finally {
      setSavingRecall(false);
    }
  };

  const triggerSend = async (
    recall: Recall,
    channelOverride?: 'SMS' | 'WhatsApp' | 'Appel'
  ) => {
    if (!canManageRecalls || busyRecallId === recall.id) return;
    const effectiveChannel = channelOverride || recall.channel || 'SMS';
    setBusyRecallId(recall.id);
    try {
      await dispatchRecallNotification(recall, effectiveChannel);
      if (effectiveChannel === 'SMS') {
        showToast(`Rappel SMS envoyé à ${recall.patientName}.`, 'success');
      } else if (effectiveChannel === 'WhatsApp') {
        showToast(`WhatsApp ouvert pour ${recall.patientName}.`, 'success');
      } else {
        showToast(`Appel lancé vers ${recall.patientName}.`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Échec du rappel ${effectiveChannel}.`, 'error');
    } finally {
      setBusyRecallId(null);
    }
  };

  if (!canAccessSection(activeRole, 'recalls')) {
    return <AccessDeniedView sectionLabel="Rappels & Relances" />;
  }

  return (
    <div className="space-y-5">
      {/* Header & Automation Banner */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Rappels &amp; Relances Patients — SMS, WhatsApp &amp; Appel
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Envoi SMS automatisé {smsConfig.hoursBefore}h avant le RDV · Relance manuelle par SMS, WhatsApp ou Appel ·{' '}
              <span
                className={
                  smsConfig.enabled
                    ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                    : 'font-semibold text-amber-700 dark:text-amber-400'
                }
              >
                Automatisation {smsConfig.enabled ? 'active' : 'en pause'}
              </span>{' '}
              · <span className="font-mono tabular-nums">{dueAppointmentsCount}</span> à envoyer maintenant ·{' '}
              <span className="font-mono tabular-nums">{sentSmsCount}</span> SMS délivrés
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {permissions.canManageStaffAndSettings && (
              <button
                type="button"
                onClick={() => setActiveSection('settings')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Modèle &amp; Délai SMS</span>
              </button>
            )}
            {canManageRecalls && (
              <>
                <button
                  type="button"
                  disabled={batchRunning}
                  onClick={handleRunDueBatch}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 whitespace-nowrap"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {batchRunning
                      ? 'Envoi en cours...'
                      : `Envoyer rappels J-${smsConfig.hoursBefore}h (${dueAppointmentsCount})`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (patients.length === 0) {
                      showToast("Créez d'abord un dossier patient.", 'error');
                      return;
                    }
                    setForm({ ...form, patientId: patients[0]?.id || '' });
                    setShowModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nouveau Rappel</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveSubTab('sms-queue')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                activeSubTab === 'sms-queue'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>File d&apos;envoi RDV ({upcomingAppointments.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('history')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
                activeSubTab === 'history'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Journal des rappels ({recalls.length})</span>
            </button>
          </div>

          {activeSubTab === 'sms-queue' ? (
            <select
              aria-label="Fenêtre des rendez-vous à rappeler"
              value={windowFilter}
              onChange={(e) => setWindowFilter(e.target.value as 'due' | '48h' | '7d' | 'all')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200"
            >
              <option value="due">Éligibles J-{smsConfig.hoursBefore}h uniquement</option>
              <option value="48h">Rendez-vous sous 48 heures</option>
              <option value="7d">7 prochains jours</option>
              <option value="all">Tous les rendez-vous à venir</option>
            </select>
          ) : (
            <select
              aria-label="Filtrer par canal"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as 'all' | 'SMS' | 'WhatsApp' | 'Appel')}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200"
            >
              <option value="all">Tous les canaux</option>
              <option value="SMS">SMS uniquement</option>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Appel">Appel</option>
            </select>
          )}
        </div>
      </div>

      {/* SMS Appointment Queue */}
      {activeSubTab === 'sms-queue' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Date &amp; Heure RDV</th>
                  <th className="px-4 py-3 font-medium">Patient &amp; Tél</th>
                  <th className="px-4 py-3 font-medium">Acte / Praticien</th>
                  <th className="px-4 py-3 font-medium">Aperçu du message (SMS / WhatsApp)</th>
                  <th className="px-4 py-3 font-medium">Statut J-{smsConfig.hoursBefore}h</th>
                  <th className="px-4 py-3 font-medium text-right">Rappels (SMS · WhatsApp · Appel)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {upcomingAppointments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      Aucun rendez-vous à venir dans cette fenêtre.
                    </td>
                  </tr>
                ) : (
                  upcomingAppointments.map((apt) => {
                    const pat = patientById.get(apt.patientId);
                    const phone = (apt.patientPhone || pat?.phone || '').trim();
                    const normalizedReminder = (apt.reminderStatus || '').toUpperCase();
                    const reminderAlreadySent =
                      normalizedReminder.startsWith('SMS') ||
                      normalizedReminder.startsWith('WHATSAPP') ||
                      normalizedReminder.startsWith('APPEL');
                    const isDueNow = isAppointmentDueForSmsReminder(apt, smsConfig.hoursBefore);
                    const previewMsg = formatSmsReminderMessage(smsConfig.template, apt, clinicSettings);
                    const isRowBusy =
                      sendingAptAction === `${apt.id}:SMS` ||
                      sendingAptAction === `${apt.id}:WhatsApp` ||
                      sendingAptAction === `${apt.id}:Appel`;

                    return (
                      <tr key={apt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                        <td className="px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatDateFR(apt.date)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{apt.startTime}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openPatientFile(apt.patientId)}
                            className="font-semibold text-sky-700 dark:text-sky-400 hover:underline text-left"
                          >
                            {apt.patientName}
                          </button>
                          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                            {phone || 'Tél manquant'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 dark:text-slate-100">{apt.actType}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {apt.practitionerName} · {apt.chair}
                          </p>
                        </td>
                        <td className="px-4 py-3 max-w-sm">
                          <p className="rounded-md bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                            « {previewMsg} »
                          </p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {reminderAlreadySent ? (
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>{apt.reminderStatus}</span>
                            </span>
                          ) : !phone ? (
                            <span className="font-medium text-rose-700 dark:text-rose-400">
                              Numéro manquant
                            </span>
                          ) : isDueNow ? (
                            <span className="font-semibold text-amber-700 dark:text-amber-400">
                              Éligible J-{smsConfig.hoursBefore}h
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">
                              Programmé ({apt.status})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {canManageRecalls ? (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={!phone || isRowBusy}
                                onClick={() => void handleSendAppointmentChannel(apt.id, 'SMS')}
                                className="inline-flex items-center gap-1 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-2.5 py-1.5 text-[11px] font-medium text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 disabled:opacity-50"
                                title="Envoyer un SMS"
                              >
                                <Send className="h-3 w-3" />
                                <span>{sendingAptAction === `${apt.id}:SMS` ? 'Envoi...' : 'SMS'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={!phone || isRowBusy}
                                onClick={() => void handleSendAppointmentChannel(apt.id, 'WhatsApp')}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-50"
                                title="Contacter sur WhatsApp"
                              >
                                <MessageCircle className="h-3 w-3" />
                                <span>WhatsApp</span>
                              </button>
                              <button
                                type="button"
                                disabled={!phone || isRowBusy}
                                onClick={() => void handleSendAppointmentChannel(apt.id, 'Appel')}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 disabled:opacity-50"
                                title="Appeler le patient"
                              >
                                <Phone className="h-3 w-3" />
                                <span>Appel</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">Lecture seule</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical Recalls Log */}
      {activeSubTab === 'history' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Téléphone</th>
                  <th className="px-4 py-3 font-medium">Motif &amp; Message</th>
                  <th className="px-4 py-3 font-medium">Date / Envoi</th>
                  <th className="px-4 py-3 font-medium">Canal</th>
                  <th className="px-4 py-3 font-medium">Statut Envoi</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRecalls.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      Aucun rappel enregistré pour ce filtre.
                    </td>
                  </tr>
                ) : (
                  filteredRecalls.map((r) => {
                    const cleanMsg = stripRecallAppointmentTag(r.notes);
                    const patPhone = (r.patientPhone || patientById.get(r.patientId)?.phone || '').trim();
                    const isBusy = busyRecallId === r.id;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openPatientFile(r.patientId)}
                            className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                            title="Ouvrir le dossier patient 360°"
                          >
                            {r.patientName}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {patPhone || '—'}
                        </td>
                        <td className="px-4 py-3 max-w-md space-y-1">
                          <p className="font-medium text-slate-800 dark:text-slate-200">{r.reason}</p>
                          {cleanMsg && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              « {cleanMsg} »
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatSentDateTimeFR(r.lastSentAt || r.dueDate)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                              r.channel === 'WhatsApp'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : r.channel === 'Appel'
                                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                            }`}
                          >
                            {r.channel === 'WhatsApp' ? (
                              <MessageCircle className="h-3 w-3" />
                            ) : r.channel === 'Appel' ? (
                              <Phone className="h-3 w-3" />
                            ) : (
                              <MessageSquare className="h-3 w-3" />
                            )}
                            <span>{r.channel}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium whitespace-nowrap">
                          <span
                            className={
                              r.deliveryStatus === 'Délivré' || r.deliveryStatus === 'Lu'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : r.deliveryStatus === 'Échec'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }
                          >
                            {r.deliveryStatus} ({r.status})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {canManageRecalls ? (
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                disabled={!patPhone || isBusy}
                                onClick={() => void triggerSend(r, 'SMS')}
                                title="Envoyer par SMS"
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                  r.channel === 'SMS'
                                    ? 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 hover:bg-sky-100'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                <Send className="h-3 w-3" />
                                <span>SMS</span>
                              </button>
                              <button
                                type="button"
                                disabled={!patPhone || isBusy}
                                onClick={() => void triggerSend(r, 'WhatsApp')}
                                title="Envoyer par WhatsApp"
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                  r.channel === 'WhatsApp'
                                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                <MessageCircle className="h-3 w-3" />
                                <span>WhatsApp</span>
                              </button>
                              <button
                                type="button"
                                disabled={!patPhone || isBusy}
                                onClick={() => void triggerSend(r, 'Appel')}
                                title="Appeler le patient"
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                  r.channel === 'Appel'
                                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                <Phone className="h-3 w-3" />
                                <span>Appel</span>
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">Lecture seule</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Programmer un Rappel</h3>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateRecall} className="mt-4 space-y-3 text-xs">
              <select
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
              <input
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
                <select
                  value={form.channel}
                  onChange={(e) =>
                    setForm({ ...form, channel: e.target.value as 'WhatsApp' | 'SMS' | 'Appel' })
                  }
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  <option value="SMS">SMS</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Appel">Appel</option>
                </select>
              </div>
              <textarea
                rows={3}
                maxLength={290}
                placeholder="Message personnalisé pour SMS / WhatsApp ou note d'appel (optionnel)"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingRecall}
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingRecall}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingRecall ? 'Enregistrement...' : 'Programmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
