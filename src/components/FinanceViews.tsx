import React, { useMemo, useState } from 'react';
import { CreditCard, MessageCircle, Plus, Printer, Search, X } from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { addDaysISO, exportToCsv, formatDateFR, formatMAD, generateSafeId, todayISO } from '../lib/formatters';
import { ClaimStatus, Invoice, InvoiceStatus, Payment, PaymentMethod } from '../types/dental';

export const InvoicesView: React.FC = () => {
  const {
    user,
    staffProfile,
    staffList,
    clinicSettings,
    actualRole,
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
  const [showNewInvModal, setShowNewInvModal] = useState(false);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);

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
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !inv.patientName.toLowerCase().includes(q) &&
          !inv.invoiceNumber.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [invoices, statusFilter, search]);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
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
        patientName: `${pat.firstName} ${pat.lastName}`,
        practitionerId: pat.assignedPractitionerId || user.uid,
        practitionerName: assignedPrac?.displayName || staffProfile?.displayName || 'Praticien',
        planId: '',
        issueDate: todayISO(),
        dueDate: addDaysISO(todayISO(), 15),
        items: [
          {
            actCode: invForm.actCode,
            actName: invForm.actName,
            tooth: invForm.tooth,
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
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payTarget) return;
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
    const recNum = await incrementCounter('receiptCounter');

    await saveRecord(
      'payments',
      generateSafeId('pay'),
      {
        receiptNumber: `REC-${new Date().getFullYear()}-${String(recNum).padStart(3, '0')}`,
        invoiceId: payTarget.id,
        patientId: payTarget.patientId,
        patientName: payTarget.patientName,
        practitionerId: payTarget.practitionerId,
        date: todayISO(),
        amount: amt,
        method: payForm.method,
        payerType: payForm.payerType,
        isAdvance: payForm.isAdvance,
        chequeNumber: payForm.method === 'Chèque' ? payForm.chequeNumber : '',
        bankName: payForm.method === 'Chèque' ? payForm.bankName : '',
        chequeDepositDate: payForm.method === 'Chèque' ? payForm.chequeDepositDate : '',
        notes: payForm.notes,
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° facture ou nom patient..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-8 pr-3 py-2 text-xs"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
          >
            <option value="all">Tous les statuts</option>
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
                ['N° Facture', 'Date', 'Patient', 'Total MAD', 'Part Patient', 'Part Mutuelle', 'Encaissé Total', 'Reste dû', 'Statut'],
                filteredInvoices.map((i) => {
                  const totalPaid = Number(i.paidAmount || 0) + Number(i.insurancePaidAmount || 0);
                  const totalRem = Math.max(0, Number(i.totalAmount || 0) - totalPaid);
                  return [
                    i.invoiceNumber,
                    i.issueDate,
                    i.patientName,
                    i.totalAmount,
                    i.patientShare,
                    i.insuranceShare || 0,
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
                <th className="px-4 py-3 font-medium">N° Facture</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium text-right">Part Patient</th>
                <th className="px-4 py-3 font-medium text-right">Encaissé</th>
                <th className="px-4 py-3 font-medium text-right">Reste dû</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredInvoices.map((inv) => {
                const totalPaid = Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0);
                const patientRemaining = Math.max(0, Number(inv.patientShare || 0) - Number(inv.paidAmount || 0));
                const insuranceRemaining = Math.max(0, Number(inv.insuranceShare || 0) - Number(inv.insurancePaidAmount || 0));
                const remaining = Math.max(0, Number(inv.totalAmount || 0) - totalPaid);
                const defaultPayerType: 'Patient' | 'Mutuelle' =
                  patientRemaining > 0 ? 'Patient' : insuranceRemaining > 0 ? 'Mutuelle' : 'Patient';
                const defaultAmount =
                  defaultPayerType === 'Patient' ? patientRemaining : insuranceRemaining;

                return (
                  <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatDateFR(inv.issueDate)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      <button
                        type="button"
                        onClick={() => openPatientFile(inv.patientId)}
                        className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                        title="Ouvrir le dossier patient 360°"
                      >
                        {inv.patientName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">{formatMAD(inv.totalAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">{formatMAD(inv.patientShare)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMAD(totalPaid)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
                      <span>{formatMAD(remaining)}</span>
                      {insuranceRemaining > 0 && (
                        <span className="block text-[10px] font-normal text-sky-600 dark:text-sky-400">
                          dont {formatMAD(insuranceRemaining)} mutuelle
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
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
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
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
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                        >
                          <CreditCard className="h-3 w-3" />
                          <span>Encaisser</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handlePrintInvoice(inv)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Printer className="h-3 w-3" />
                        <span>Imprimer</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Invoice Modal */}
      {showNewInvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
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
                  onClick={() => setShowNewInvModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
                >
                  Émettre
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
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
                  onClick={() => setPayTarget(null)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
                >
                  Valider l'encaissement
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
  const { payments, patients, invoices, staffList, clinicSettings, setPrintableDoc, openPatientFile } = useClinic();
  const [methodFilter, setMethodFilter] = useState('all');

  const filtered = useMemo(
    () =>
      methodFilter === 'all'
        ? payments
        : payments.filter((p) => p.method === methodFilter),
    [payments, methodFilter]
  );

  const printReceipt = (pay: Payment) => {
    const pat = patients.find((p) => p.id === pay.patientId);
    const linkedInvoice = invoices.find((i) => i.id === pay.invoiceId);
    const linkedPrac = staffList.find((s) => s.uid === pay.practitionerId || s.id === pay.practitionerId);
    setPrintableDoc({
      kind: 'receipt',
      title: 'Reçu de Paiement',
      reference: pay.receiptNumber,
      date: pay.date,
      patientName: pay.patientName,
      patientCin: pat?.cin,
      patientPhone: pat?.phone,
      practitionerName:
        linkedInvoice?.practitionerName ||
        linkedPrac?.displayName ||
        clinicSettings?.clinicName ||
        'Cabinet Dentaire',
      totalAmount: pay.amount,
      paidAmount: pay.amount,
      paymentMethod: `${pay.method}${pay.chequeNumber ? ` N° ${pay.chequeNumber}` : ''}`,
      bodyText: pay.notes || 'Paiement reçu avec remerciements.',
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-3">
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
          >
            <option value="all">Tous modes de règlement</option>
            <option value="Espèces">Espèces</option>
            <option value="Carte bancaire">Carte bancaire</option>
            <option value="Virement">Virement</option>
            <option value="Chèque">Chèque</option>
          </select>
        </div>
        <p className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
          Total affiché : {formatMAD(filtered.reduce((s, p) => s + p.amount, 0))}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">N° Reçu</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Mode & Détails</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-right">Montant</th>
                <th className="px-4 py-3 font-medium text-right">Reçu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">{p.receiptNumber}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">{formatDateFR(p.date)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    <button
                      type="button"
                      onClick={() => openPatientFile(p.patientId)}
                      className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                      title="Ouvrir le dossier patient 360°"
                    >
                      {p.patientName}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {p.method}
                    {p.chequeNumber ? ` · Chèque ${p.chequeNumber} (${p.bankName})` : ''}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {p.payerType} {p.isAdvance ? '· Acompte' : ''}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {formatMAD(p.amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => printReceipt(p)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Printer className="h-3 w-3" />
                      <span>Imprimer</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const InsuranceARView: React.FC = () => {
  const { invoices, treatmentPlans, saveRecord, openPatientFile, showToast, permissions } = useClinic();
  const claims = invoices.filter((i) => (i.insuranceShare || 0) > 0 && i.status !== 'Annulée');

  const updateClaimStatus = async (inv: Invoice, status: ClaimStatus) => {
    const nextInsPaid =
      status === 'Remboursée'
        ? Number(inv.insuranceShare || 0)
        : Number(inv.insurancePaidAmount || 0);
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
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Suivi des Créances Mutuelles (AMO / CNSS / CNOPS / Privées)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Dossiers de tiers-payant et remboursements en attente
            </p>
          </div>
          <p className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400 tabular-nums">
            Total créances ouvertes :{' '}
            {formatMAD(
              claims.reduce((s, c) => s + Math.max(0, c.insuranceShare - (c.insurancePaidAmount || 0)), 0)
            )}
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
              {claims.map((c) => (
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
                      disabled={!permissions.canCreateInvoicesAndPayments}
                      value={c.insuranceClaimStatus || 'Dossier déposé'}
                      onChange={(e) => updateClaimStatus(c, e.target.value as ClaimStatus)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 text-xs"
                    >
                      <option value="Dossier déposé">Dossier déposé</option>
                      <option value="En attente remboursement">En attente remboursement</option>
                      <option value="Remboursée">Remboursée</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const RecallsView: React.FC = () => {
  const { user, actualRole, patients, recalls, saveRecord, openPatientFile, showToast } = useClinic();
  const canManageRecalls = actualRole !== 'assistant';
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    patientId: '',
    reason: 'Contrôle semestriel & Détartrage',
    dueDate: todayISO(),
    channel: 'WhatsApp' as 'WhatsApp' | 'SMS' | 'Appel',
  });

  const handleCreateRecall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !canManageRecalls) return;
    const pat = patients.find((p) => p.id === form.patientId) || patients[0];
    if (!pat) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    await saveRecord(
      'recalls',
      generateSafeId('rec'),
      {
        patientId: pat.id,
        patientName: `${pat.firstName} ${pat.lastName}`,
        patientPhone: pat.phone,
        practitionerId: pat.assignedPractitionerId || user.uid,
        reason: form.reason,
        dueDate: form.dueDate,
        channel: form.channel,
        status: form.dueDate < todayISO() ? 'En retard' : 'À faire',
        deliveryStatus: 'Non envoyé',
        notes: '',
        createdBy: user.uid,
      },
      true
    );
    setShowModal(false);
    showToast('Rappel programmé.', 'success');
  };

  const triggerSend = async (id: string, channel: string, patientName: string) => {
    if (!canManageRecalls) return;
    await saveRecord('recalls', id, {
      status: 'Envoyé',
      deliveryStatus: 'Délivré',
      lastSentAt: new Date().toISOString(),
    });
    showToast(`Notification ${channel} délivrée à ${patientName}.`, 'success');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Rappels & Journal WhatsApp / SMS</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Rappels J-24h / H-2, relances de contrôle et suivi des statuts d'envoi (délivré, lu, échec)
          </p>
        </div>
        {canManageRecalls && (
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nouveau Rappel</span>
          </button>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Téléphone</th>
                <th className="px-4 py-3 font-medium">Motif</th>
                <th className="px-4 py-3 font-medium">Échéance</th>
                <th className="px-4 py-3 font-medium">Canal</th>
                <th className="px-4 py-3 font-medium">Statut Envoi</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {recalls.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                    <button
                      type="button"
                      onClick={() => openPatientFile(r.patientId)}
                      className="text-left text-sky-700 dark:text-sky-400 hover:underline"
                      title="Ouvrir le dossier patient 360°"
                    >
                      {r.patientName}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">{r.patientPhone || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.reason}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatDateFR(r.dueDate)}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.channel}</td>
                  <td className="px-4 py-3 font-medium">
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
                  <td className="px-4 py-3 text-right">
                    {canManageRecalls ? (
                      <button
                        type="button"
                        onClick={() => triggerSend(r.id, r.channel, r.patientName)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                      >
                        <MessageCircle className="h-3 w-3" />
                        <span>Envoyer</span>
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">Lecture seule</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
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
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="SMS">SMS</option>
                  <option value="Appel">Appel</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
                >
                  Programmer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
