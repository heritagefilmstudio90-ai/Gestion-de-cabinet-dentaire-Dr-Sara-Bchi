import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Lock, Plus, Printer, Search, Trash2, X } from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { addDaysISO, formatDateFR, formatMAD, generateSafeId, todayISO } from '../lib/formatters';
import { ActCategory, canAccessSection, PlanItemStatus, TreatmentPlan, TreatmentPlanItem } from '../types/dental';
import { AccessDeniedView } from './AccessDeniedView';

type PlanStatus = TreatmentPlan['status'];

const PHASES: TreatmentPlanItem['phase'][] = [
  'Phase 1 : Assainissement',
  'Phase 2 : Soins chirurgicaux',
  'Phase 3 : Réhabilitation prothétique',
];

const ITEM_STATUSES: PlanItemStatus[] = ['Prévu', 'En cours', 'Réalisé', 'Facturé', 'Payé'];
const PLAN_STATUSES: PlanStatus[] = [
  'Brouillon',
  'Noveaux',
  'Imprimé',
  'Devis envoyé',
  'Accepté',
  'En cours',
  'Terminé',
  'Refusé',
];

export const TreatmentPlansView: React.FC = () => {
  const {
    user,
    activeRole,
    staffProfile,
    staffList,
    patients,
    actsCatalog,
    treatmentPlans,
    invoices,
    permissions,
    saveRecord,
    incrementCounter,
    setPrintableDoc,
    setActiveSection,
    openPatientFile,
    showToast,
  } = useClinic();

  const [tab, setTab] = useState<'plans' | 'catalog'>('plans');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planSearch, setPlanSearch] = useState('');
  const [planStatusFilter, setPlanStatusFilter] = useState<string>('all');
  const [showNewPlanModal, setShowNewPlanModal] = useState(false);
  const [showNewActModal, setShowNewActModal] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<string>('all');
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingAct, setSavingAct] = useState(false);
  const [busyPlanAction, setBusyPlanAction] = useState(false);

  const [planForm, setPlanForm] = useState({
    patientId: '',
    title: 'Plan de traitement dentaire complet',
    isAlternative: false,
  });

  const [newItemForm, setNewItemForm] = useState({
    phase: PHASES[0],
    tooth: '16',
    actCode: actsCatalog[0]?.code || 'C01',
    actName: actsCatalog[0]?.name || 'Consultation & Bilan complet',
    unitPrice: actsCatalog[0]?.defaultPrice || 300,
    quantity: 1,
    discount: 0,
  });

  const [actForm, setActForm] = useState({
    code: '',
    category: 'Soins conservateurs' as ActCategory,
    name: '',
    defaultDuration: 30,
    minPrice: 300,
    maxPrice: 700,
    defaultPrice: 450,
  });

  useEffect(() => {
    if (actsCatalog.length > 0 && !actsCatalog.some((a) => a.name === newItemForm.actName)) {
      setNewItemForm((prev) => ({
        ...prev,
        actCode: actsCatalog[0].code,
        actName: actsCatalog[0].name,
        unitPrice: actsCatalog[0].defaultPrice,
      }));
    }
  }, [actsCatalog, newItemForm.actName]);

  const filteredPlans = useMemo(() => {
    const q = planSearch.trim().toLowerCase();
    return treatmentPlans.filter((pl) => {
      if (planStatusFilter !== 'all' && pl.status !== planStatusFilter) return false;
      if (!q) return true;
      const haystack = [
        pl.quoteNumber,
        pl.patientName,
        pl.patientFileNumber,
        pl.practitionerName,
        pl.title,
        pl.rawActsText,
        pl.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [treatmentPlans, planSearch, planStatusFilter]);

  const selectedPlan = useMemo(
    () =>
      filteredPlans.find((p) => p.id === selectedPlanId) ||
      filteredPlans[0] ||
      treatmentPlans.find((p) => p.id === selectedPlanId) ||
      null,
    [filteredPlans, treatmentPlans, selectedPlanId]
  );

  const existingPlanInvoice = useMemo(
    () =>
      selectedPlan
        ? invoices.find((inv) => inv.planId === selectedPlan.id && inv.status !== 'Annulée') || null
        : null,
    [invoices, selectedPlan]
  );

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || savingPlan) return;
    const pat = patients.find((p) => p.id === planForm.patientId) || patients[0];
    if (!pat) {
      showToast('Créez d\'abord un patient.', 'error');
      return;
    }
    setSavingPlan(true);
    try {
      const qNum = await incrementCounter('quoteCounter');
      const id = generateSafeId('plan');
      const assignedPrac = staffList.find(
        (s) => s.uid === pat.assignedPractitionerId || s.id === pat.assignedPractitionerId
      );
      const practitionerId = pat.assignedPractitionerId || user.uid;
      const practitionerName = (assignedPrac?.displayName || staffProfile?.displayName || 'Praticien').slice(0, 120);
      await saveRecord(
        'treatmentPlans',
        id,
        {
          quoteNumber: `DEV-${new Date().getFullYear()}-${String(qNum).padStart(3, '0')}`,
          patientId: pat.id,
          patientName: `${pat.firstName} ${pat.lastName}`.slice(0, 150),
          practitionerId,
          practitionerName,
          title: (planForm.title.trim() || 'Plan de traitement dentaire').slice(0, 180),
          isAlternative: planForm.isAlternative,
          status: 'Brouillon',
          items: [],
          totalAmount: 0,
          insuranceEstimated: 0,
          consentSigned: false,
          lockedVersion: false,
          createdBy: user.uid,
        },
        true
      );
      setSelectedPlanId(id);
      setShowNewPlanModal(false);
      showToast('Nouveau devis & plan de traitement créé.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la création du devis.', 'error');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleAddItemToPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || selectedPlan.lockedVersion || busyPlanAction) return;
    if ((selectedPlan.items || []).length >= 40) {
      showToast('Limite maximale de 40 actes atteinte pour ce devis.', 'info');
      return;
    }
    const qty = Number(newItemForm.quantity);
    const price = Number(newItemForm.unitPrice);
    const discount = Math.max(0, Number(newItemForm.discount) || 0);
    if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(price) || price < 0) {
      showToast('Veuillez saisir une quantité (>= 1) et un tarif valide.', 'error');
      return;
    }
    const pat = patients.find((p) => p.id === selectedPlan.patientId);
    const rate = pat ? pat.coverageRate : 0;

    const item: TreatmentPlanItem = {
      id: generateSafeId('it'),
      phase: newItemForm.phase,
      tooth: newItemForm.tooth.trim().slice(0, 40),
      actCode: newItemForm.actCode.trim().slice(0, 30),
      actName: newItemForm.actName.trim().slice(0, 160),
      unitPrice: price,
      quantity: qty,
      discount,
      status: 'Prévu',
    };
    const nextItems = [...(selectedPlan.items || []), item];
    const totalAmount = nextItems.reduce(
      (s, i) => s + Math.max(0, i.unitPrice * i.quantity - i.discount),
      0
    );
    const insuranceEstimated = Math.round((totalAmount * rate) / 100);

    setBusyPlanAction(true);
    try {
      await saveRecord(
        'treatmentPlans',
        selectedPlan.id,
        {
          items: nextItems,
          totalAmount,
          insuranceEstimated,
        },
        false
      );
      showToast('Acte ajouté au plan de traitement.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Impossible d'ajouter l'acte au plan.", 'error');
    } finally {
      setBusyPlanAction(false);
    }
  };

  const handleUpdateItemStatus = async (itemId: string, nextStatus: PlanItemStatus) => {
    if (!selectedPlan || !permissions.canCreatePlansAndQuotes || busyPlanAction) return;
    const nextItems = selectedPlan.items.map((it) =>
      it.id === itemId ? { ...it, status: nextStatus } : it
    );
    setBusyPlanAction(true);
    try {
      await saveRecord('treatmentPlans', selectedPlan.id, { items: nextItems }, false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Impossible de mettre à jour le statut de l'acte.", 'error');
    } finally {
      setBusyPlanAction(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedPlan || selectedPlan.lockedVersion || !permissions.canCreatePlansAndQuotes || busyPlanAction) return;
    const pat = patients.find((p) => p.id === selectedPlan.patientId);
    const rate = pat ? pat.coverageRate : 0;
    const nextItems = selectedPlan.items.filter((it) => it.id !== itemId);
    const totalAmount = nextItems.reduce(
      (s, i) => s + Math.max(0, i.unitPrice * i.quantity - i.discount),
      0
    );
    const insuranceEstimated = Math.round((totalAmount * rate) / 100);
    setBusyPlanAction(true);
    try {
      await saveRecord(
        'treatmentPlans',
        selectedPlan.id,
        { items: nextItems, totalAmount, insuranceEstimated },
        false
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Impossible de retirer l'acte du devis.", 'error');
    } finally {
      setBusyPlanAction(false);
    }
  };

  const handleUpdatePlanStatus = async (planId: string, nextStatus: PlanStatus) => {
    if (busyPlanAction) return;
    setBusyPlanAction(true);
    try {
      await saveRecord('treatmentPlans', planId, { status: nextStatus }, false);
      showToast(`Statut du devis mis à jour : ${nextStatus}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Impossible de mettre à jour le statut du devis.', 'error');
    } finally {
      setBusyPlanAction(false);
    }
  };

  const handleLockAndConsent = async (plan: TreatmentPlan) => {
    if (busyPlanAction) return;
    setBusyPlanAction(true);
    try {
      await saveRecord(
        'treatmentPlans',
        plan.id,
        {
          consentSigned: true,
          lockedVersion: true,
          status: 'Accepté',
        },
        false
      );
      showToast('Devis archivé, verrouillé et consentement patient validé.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Impossible de verrouiller ce devis.', 'error');
    } finally {
      setBusyPlanAction(false);
    }
  };

  const handleConvertPlanToInvoice = async (plan: TreatmentPlan) => {
    if (!user || plan.items.length === 0 || busyPlanAction) return;
    const existingInv = invoices.find((inv) => inv.planId === plan.id && inv.status !== 'Annulée');
    if (existingInv) {
      showToast(`Ce devis a déjà été converti en facture (${existingInv.invoiceNumber}).`, 'info');
      setActiveSection('invoices');
      return;
    }

    setBusyPlanAction(true);
    try {
      const pat = patients.find((p) => p.id === plan.patientId);
      const invNum = await incrementCounter('invoiceCounter');
      const total = plan.totalAmount;
      const insuranceShare = pat ? Math.round((total * pat.coverageRate) / 100) : 0;
      const patientShare = Math.max(0, total - insuranceShare);

      await saveRecord(
        'invoices',
        generateSafeId('inv'),
        {
          invoiceNumber: `FAC-${new Date().getFullYear()}-${String(invNum).padStart(3, '0')}`,
          patientId: plan.patientId,
          patientName: plan.patientName,
          practitionerId: plan.practitionerId,
          practitionerName: plan.practitionerName,
          planId: plan.id,
          issueDate: todayISO(),
          dueDate: addDaysISO(todayISO(), 15),
          items: plan.items.map((it) => ({
            actCode: it.actCode,
            actName: it.actName,
            tooth: it.tooth,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            total: Math.max(0, it.unitPrice * it.quantity - it.discount),
          })),
          totalAmount: total,
          insuranceType: pat?.insuranceType || 'Aucune',
          insuranceShare,
          patientShare,
          paidAmount: 0,
          insurancePaidAmount: 0,
          status: 'Émise',
          insuranceClaimStatus: pat?.insuranceType && pat.insuranceType !== 'Aucune' ? 'Dossier déposé' : 'Aucune',
          createdBy: user.uid,
        },
        true
      );

      const updatedItems = plan.items.map((it) =>
        it.status === 'Payé' ? it : { ...it, status: 'Facturé' as PlanItemStatus }
      );
      await saveRecord(
        'treatmentPlans',
        plan.id,
        {
          status: plan.status === 'Terminé' ? 'Terminé' : 'En cours',
          items: updatedItems,
        },
        false
      );

      showToast('Facture générée depuis le plan de traitement.', 'success');
      setActiveSection('invoices');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Impossible de convertir le devis en facture.', 'error');
    } finally {
      setBusyPlanAction(false);
    }
  };

  const handlePrintQuote = (plan: TreatmentPlan) => {
    const pat = patients.find((p) => p.id === plan.patientId);
    setPrintableDoc({
      kind: 'quote',
      title: `Devis & Plan de Traitement ${plan.isAlternative ? '(Option Alternative)' : ''}`,
      subtitle: plan.title,
      reference: plan.quoteNumber,
      date: plan.quoteDate || todayISO(),
      patientName: plan.patientName,
      patientCin: pat?.cin,
      patientPhone: pat?.phone,
      patientInsurance: pat ? `${pat.insuranceType} (${pat.coverageRate}%)` : 'Aucune',
      patientInsuranceNumber: pat?.insuranceNumber,
      practitionerName: plan.practitionerName,
      items: plan.items.map((it) => ({
        label: `${it.phase} — ${it.actName}`,
        tooth: it.tooth,
        qty: it.quantity,
        unitPrice: it.unitPrice,
        total: Math.max(0, it.unitPrice * it.quantity - it.discount),
      })),
      totalAmount: plan.totalAmount,
      insuranceShare: plan.insuranceEstimated || 0,
      patientShare: Math.max(0, plan.totalAmount - (plan.insuranceEstimated || 0)),
      consentText:
        'Je déclare avoir été informé(e) des alternatives thérapeutiques, des délais et des honoraires prévisionnels exposés dans le présent devis. Validité du devis : 60 jours.',
    });
  };

  const handleCreateCatalogAct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingAct) return;
    const code = actForm.code.trim().toUpperCase().slice(0, 30);
    const name = actForm.name.trim().slice(0, 160);
    if (!code || !name) {
      showToast("Veuillez saisir le code et le libellé de l'acte.", 'error');
      return;
    }
    setSavingAct(true);
    try {
      await saveRecord(
        'actsCatalog',
        generateSafeId('act'),
        {
          code,
          category: actForm.category,
          name,
          defaultDuration: Math.max(5, Math.min(480, Number(actForm.defaultDuration) || 30)),
          minPrice: Math.max(0, Number(actForm.minPrice) || 0),
          maxPrice: Math.max(0, Number(actForm.maxPrice) || 0),
          defaultPrice: Math.max(0, Number(actForm.defaultPrice) || 0),
          color: '#0284C7',
        },
        true
      );
      setShowNewActModal(false);
      showToast('Acte ajouté au catalogue du cabinet.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Impossible d'ajouter l'acte au catalogue.", 'error');
    } finally {
      setSavingAct(false);
    }
  };

  const filteredCatalog = useMemo(
    () =>
      catalogCategory === 'all'
        ? actsCatalog
        : actsCatalog.filter((a) => a.category === catalogCategory),
    [actsCatalog, catalogCategory]
  );

  if (!canAccessSection(activeRole, 'treatment-plans')) {
    return <AccessDeniedView sectionLabel="Plans & Devis" />;
  }

  return (
    <div className="space-y-5">
      {/* Header tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setTab('plans')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium ${
              tab === 'plans' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Plans Multi-Phases & Devis ({treatmentPlans.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium ${
              tab === 'catalog' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Catalogue des Actes ({actsCatalog.length})
          </button>
        </div>

        {tab === 'plans' && permissions.canCreatePlansAndQuotes && (
          <button
            type="button"
            onClick={() => {
              if (patients.length === 0) {
                showToast("Créez d'abord un dossier patient.", 'error');
                return;
              }
              setPlanForm({
                patientId: patients[0]?.id || '',
                title: 'Plan de traitement dentaire',
                isAlternative: false,
              });
              setShowNewPlanModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nouveau Devis / Plan</span>
          </button>
        )}

        {tab === 'catalog' && permissions.canManageStaffAndSettings && (
          <button
            type="button"
            onClick={() => setShowNewActModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Ajouter un acte</span>
          </button>
        )}
      </div>

      {tab === 'plans' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left list */}
          <div className="lg:col-span-4 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-2 bg-slate-50/70 dark:bg-slate-800/40">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={planSearch}
                  onChange={(e) => setPlanSearch(e.target.value)}
                  placeholder="N° devis, patient, N° P, actes..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 pl-8 pr-3 py-1.5 text-xs"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <select
                  value={planStatusFilter}
                  onChange={(e) => setPlanStatusFilter(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-xs"
                >
                  <option value="all">Tous statuts ({treatmentPlans.length})</option>
                  {PLAN_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                  {filteredPlans.length} devis
                </span>
              </div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[680px] overflow-y-auto">
              {filteredPlans.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  Aucun devis ou plan de traitement correspondant.
                </p>
              ) : (
                filteredPlans.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => setSelectedPlanId(pl.id)}
                    className={`w-full p-3.5 text-left transition-colors ${
                      selectedPlan?.id === pl.id
                        ? 'bg-sky-50/70 dark:bg-sky-950/50'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">
                        N° {pl.quoteNumber}
                        {pl.patientFileNumber ? ` · P.${pl.patientFileNumber}` : ''}
                      </span>
                      <span
                        className={`font-medium ${
                          pl.status === 'Accepté' || pl.status === 'Terminé'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : pl.status === 'Imprimé'
                            ? 'text-sky-700 dark:text-sky-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {pl.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {pl.patientName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {pl.title}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[11px] gap-2">
                      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {pl.quoteDate ? `Du ${formatDateFR(pl.quoteDate)}` : pl.lockedVersion ? 'Verrouillé' : 'Édition ouverte'}
                        {pl.validityDate ? ` → ${formatDateFR(pl.validityDate)}` : ''}
                      </span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatMAD(pl.totalAmount)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right detail */}
          <div className="lg:col-span-8 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-5 space-y-5">
            {selectedPlan ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-sky-700 dark:text-sky-400">
                        Devis N° {selectedPlan.quoteNumber}
                      </span>
                      {selectedPlan.patientFileNumber && (
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          · N° Patient : {selectedPlan.patientFileNumber}
                        </span>
                      )}
                      {selectedPlan.lockedVersion && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <Lock className="h-3 w-3" /> Version immuable
                        </span>
                      )}
                    </div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      <button
                        type="button"
                        onClick={() => openPatientFile(selectedPlan.patientId)}
                        className="text-sky-700 dark:text-sky-400 hover:underline text-left"
                        title="Ouvrir le dossier patient 360°"
                      >
                        {selectedPlan.patientName}
                      </button>{' '}
                      — {selectedPlan.title}
                    </h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>Praticien : <strong className="text-slate-700 dark:text-slate-200">{selectedPlan.practitionerName}</strong></span>
                      {selectedPlan.quoteDate && (
                        <span className="font-mono tabular-nums">Date : {formatDateFR(selectedPlan.quoteDate)}</span>
                      )}
                      {selectedPlan.validityDate && (
                        <span className="font-mono tabular-nums">Date de validité : {formatDateFR(selectedPlan.validityDate)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {permissions.canCreatePlansAndQuotes && (
                      <select
                        disabled={busyPlanAction}
                        value={selectedPlan.status}
                        onChange={(e) => handleUpdatePlanStatus(selectedPlan.id, e.target.value as PlanStatus)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-100 disabled:opacity-60"
                      >
                        {PLAN_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      type="button"
                      onClick={() => handlePrintQuote(selectedPlan)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>Imprimer Devis</span>
                    </button>

                    {!selectedPlan.lockedVersion && permissions.canCreatePlansAndQuotes && (
                      <button
                        type="button"
                        disabled={busyPlanAction}
                        onClick={() => handleLockAndConsent(selectedPlan)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Valider & Verrouiller</span>
                      </button>
                    )}

                    {permissions.canCreateInvoicesAndPayments && selectedPlan.items.length > 0 && (
                      <button
                        type="button"
                        disabled={busyPlanAction}
                        onClick={() => handleConvertPlanToInvoice(selectedPlan)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>
                          {existingPlanInvoice
                            ? `Voir Facture (${existingPlanInvoice.invoiceNumber})`
                            : busyPlanAction
                            ? 'Conversion...'
                            : 'Convertir en Facture'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Add Act to Plan */}
                {!selectedPlan.lockedVersion && permissions.canCreatePlansAndQuotes && (
                  <form
                    onSubmit={handleAddItemToPlan}
                    className="grid grid-cols-2 md:grid-cols-12 gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 text-xs"
                  >
                    <select
                      value={newItemForm.phase}
                      onChange={(e) =>
                        setNewItemForm({
                          ...newItemForm,
                          phase: e.target.value as TreatmentPlanItem['phase'],
                        })
                      }
                      className="col-span-2 md:col-span-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-2"
                    >
                      {PHASES.map((ph) => (
                        <option key={ph} value={ph}>
                          {ph}
                        </option>
                      ))}
                    </select>
                    <select
                      value={newItemForm.actName}
                      onChange={(e) => {
                        const act = actsCatalog.find((a) => a.name === e.target.value);
                        setNewItemForm({
                          ...newItemForm,
                          actName: e.target.value,
                          actCode: act?.code || '',
                          unitPrice: act?.defaultPrice || newItemForm.unitPrice,
                        });
                      }}
                      className="col-span-2 md:col-span-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2.5 py-2"
                    >
                      {actsCatalog.map((a) => (
                        <option key={a.id} value={a.name}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={newItemForm.tooth}
                      onChange={(e) => setNewItemForm({ ...newItemForm, tooth: e.target.value })}
                      placeholder="Dent"
                      className="col-span-1 md:col-span-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 py-2 font-mono"
                    />
                    <input
                      type="number"
                      min={1}
                      value={newItemForm.quantity}
                      onChange={(e) => setNewItemForm({ ...newItemForm, quantity: Math.max(1, Number(e.target.value)) })}
                      title="Quantité"
                      placeholder="Qté"
                      className="col-span-1 md:col-span-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 py-2 font-mono"
                    />
                    <input
                      type="number"
                      min={0}
                      value={newItemForm.unitPrice}
                      onChange={(e) => setNewItemForm({ ...newItemForm, unitPrice: Math.max(0, Number(e.target.value)) })}
                      title="Tarif unitaire MAD"
                      placeholder="MAD"
                      className="col-span-1 md:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 py-2 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={busyPlanAction}
                      className="col-span-1 md:col-span-1 rounded-lg bg-slate-900 dark:bg-sky-600 px-3 py-2 font-medium text-white hover:bg-slate-800 dark:hover:bg-sky-500 disabled:opacity-60"
                    >
                      +
                    </button>
                  </form>
                )}

                {/* Texte intégral des actes (devis CSV) */}
                {selectedPlan.rawActsText && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-3.5 text-xs space-y-1">
                    <p className="font-semibold text-slate-700 dark:text-slate-200">
                      Actes figurant sur le devis
                    </p>
                    <p className="whitespace-pre-line text-slate-700 dark:text-slate-300 leading-relaxed">
                      {selectedPlan.rawActsText}
                    </p>
                  </div>
                )}

                {/* Items grouped by phase */}
                <div className="space-y-4">
                  {PHASES.map((phase) => {
                    const phaseItems = selectedPlan.items.filter((i) => i.phase === phase);
                    if (phaseItems.length === 0) return null;
                    return (
                      <div key={phase} className="space-y-2">
                        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-1">
                          {phase}
                        </h4>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {phaseItems.map((it) => (
                            <div
                              key={it.id}
                              className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
                            >
                              <div>
                                <p className="font-semibold text-slate-900 dark:text-slate-100">
                                  {it.actName}{' '}
                                  <span className="font-mono text-sky-700 dark:text-sky-400">Dent {it.tooth || '—'}</span>
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                  {it.actCode} · Qté {it.quantity} × {formatMAD(it.unitPrice)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  disabled={!permissions.canCreatePlansAndQuotes || busyPlanAction}
                                  value={it.status}
                                  onChange={(e) =>
                                    handleUpdateItemStatus(it.id, e.target.value as PlanItemStatus)
                                  }
                                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-[11px] disabled:opacity-60"
                                >
                                  {ITEM_STATUSES.map((st) => (
                                    <option key={st} value={st}>
                                      {st}
                                    </option>
                                  ))}
                                </select>
                                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums w-28 text-right">
                                  {formatMAD(it.unitPrice * it.quantity - it.discount)}
                                </span>
                                {!selectedPlan.lockedVersion && permissions.canCreatePlansAndQuotes && (
                                  <button
                                    type="button"
                                    disabled={busyPlanAction}
                                    onClick={() => handleRemoveItem(it.id)}
                                    className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap justify-between items-center border-t border-slate-200 dark:border-slate-800 pt-4 text-xs tabular-nums">
                  <span className="text-slate-600 dark:text-slate-300">
                    Prise en charge mutuelle estimée :{' '}
                    <strong className="font-mono text-slate-900 dark:text-slate-100">
                      {formatMAD(selectedPlan.insuranceEstimated || 0)}
                    </strong>
                  </span>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">
                    Total Devis : {formatMAD(selectedPlan.totalAmount)}
                  </span>
                </div>
              </>
            ) : (
              <p className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                Sélectionnez ou créez un plan de traitement.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Nomenclature Hiérarchisée des Actes (Tarifs Plancher / Plafond MAD)
            </h3>
            <select
              value={catalogCategory}
              onChange={(e) => setCatalogCategory(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
            >
              <option value="all">Toutes spécialités</option>
              {[
                'Consultations',
                'Soins conservateurs',
                'Endodontie',
                'Parodontologie',
                'Chirurgie',
                'Implantologie',
                'Prothèse fixe',
                'Prothèse amovible',
                'ODF',
              ].map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2.5 font-medium">Code</th>
                  <th className="px-3 py-2.5 font-medium">Spécialité</th>
                  <th className="px-3 py-2.5 font-medium">Libellé de l'acte</th>
                  <th className="px-3 py-2.5 font-medium text-right">Durée</th>
                  <th className="px-3 py-2.5 font-medium text-right">Plancher</th>
                  <th className="px-3 py-2.5 font-medium text-right">Plafond</th>
                  <th className="px-3 py-2.5 font-medium text-right">Tarif Standard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredCatalog.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2.5 font-mono font-semibold text-sky-700 dark:text-sky-400">{a.code}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{a.category}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100">{a.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">{a.defaultDuration} min</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatMAD(a.minPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatMAD(a.maxPrice)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatMAD(a.defaultPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Plan Modal */}
      {showNewPlanModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-black/70 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Nouveau Plan de Traitement / Devis</h3>
              <button type="button" onClick={() => setShowNewPlanModal(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreatePlan} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Patient</label>
                <select
                  required
                  value={planForm.patientId}
                  onChange={(e) => setPlanForm({ ...planForm, patientId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fileNumber} — {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Intitulé du plan</label>
                <input
                  required
                  value={planForm.title}
                  onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={planForm.isAlternative}
                  onChange={(e) => setPlanForm({ ...planForm, isAlternative: e.target.checked })}
                />
                <span>Option de traitement alternative</span>
              </label>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingPlan}
                  onClick={() => setShowNewPlanModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingPlan ? 'Création...' : 'Créer le devis'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Catalog Act Modal */}
      {showNewActModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-black/70 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Nouvel Acte au Catalogue</h3>
              <button type="button" onClick={() => setShowNewActModal(false)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateCatalogAct} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  placeholder="Code (ex: PF05)"
                  value={actForm.code}
                  onChange={(e) => setActForm({ ...actForm, code: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
                <select
                  value={actForm.category}
                  onChange={(e) => setActForm({ ...actForm, category: e.target.value as ActCategory })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {[
                    'Consultations',
                    'Soins conservateurs',
                    'Endodontie',
                    'Parodontologie',
                    'Chirurgie',
                    'Implantologie',
                    'Prothèse fixe',
                    'Prothèse amovible',
                    'ODF',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <input
                required
                placeholder="Libellé de l'acte"
                value={actForm.name}
                onChange={(e) => setActForm({ ...actForm, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  placeholder="Plancher MAD"
                  value={actForm.minPrice}
                  onChange={(e) => setActForm({ ...actForm, minPrice: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
                <input
                  type="number"
                  placeholder="Plafond MAD"
                  value={actForm.maxPrice}
                  onChange={(e) => setActForm({ ...actForm, maxPrice: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
                <input
                  type="number"
                  placeholder="Standard MAD"
                  value={actForm.defaultPrice}
                  onChange={(e) => setActForm({ ...actForm, defaultPrice: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingAct}
                  onClick={() => setShowNewActModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingAct}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingAct ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
