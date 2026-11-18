import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Maximize2,
  MessageCircle,
  MessageSquare,
  Minimize2,
  Monitor,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import firebaseConfig from '../../firebase-applet-config.json';
import { useFullscreen } from '../hooks/useFullscreen';
import { AccessDeniedView } from './AccessDeniedView';
import {
  fetchSystemHealth,
  GatewayVerificationReport,
  sendSmsViaGateway,
  sendWhatsAppViaGateway,
  SystemHealthReport,
  verifyMessagingGateways,
} from '../lib/smsGateway';
import { formatStaffDisplayLogin, generateSecurePassword } from '../lib/authIdentifier';
import { DOCUMENT_TEMPLATES, STOMATOLOGY_MOLECULES } from '../data/dentalCatalog';
import { formatDateFR, formatMAD, generateSafeId, todayISO } from '../lib/formatters';
import {
  DEFAULT_SMS_REMINDER_SETTINGS,
  formatSmsReminderMessage,
  isAppointmentDueForSmsReminder,
  resolveSmsReminderSettings,
} from '../lib/smsReminders';
import {
  canAccessSection,
  Expense,
  InventoryItem,
  LabOrder,
  LabOrderStatus,
  MedicalDocType,
  PrescriptionLine,
  ROLE_LABELS,
  StaffRole,
} from '../types/dental';

// ============================================================================
// MODULE 6 : SUIVI DES TRAVAUX DE LABORATOIRE (PROTHÈSES)
// ============================================================================
export const LabOrdersView: React.FC = () => {
  const { user, activeRole, staffProfile, patients, labOrders, permissions, saveRecord, openPatientFile, showToast } = useClinic();
  const [showModal, setShowModal] = useState(false);
  const [labSearch, setLabSearch] = useState('');
  const [savingLabOrder, setSavingLabOrder] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [form, setForm] = useState({
    patientId: '',
    labName: 'Laboratoire Atlas Prothèse',
    prosthesisType: 'Zircone' as LabOrder['prosthesisType'],
    shadeVita: 'A2',
    teeth: '16',
    impressionType: 'Fichier numérique STL' as 'Empreinte physique' | 'Fichier numérique STL',
    dueDate: todayISO(),
    nextAppointmentDate: todayISO(),
    labCost: 900,
    supplierInvoiceRef: '',
    notes: '',
  });

  const today = todayISO();

  const filteredLabOrders = useMemo(() => {
    const q = labSearch.trim().toLowerCase();
    if (!q) return labOrders;
    return labOrders.filter((o) =>
      `${o.orderNumber} ${o.patientName} ${o.patientFileNumber || ''} ${o.practitionerName || ''} ${o.labName} ${o.labPhone || ''} ${o.prosthesisType} ${o.shadeVita || ''} ${o.teeth || ''} ${o.notes || ''} ${o.status}`
        .toLowerCase()
        .includes(q)
    );
  }, [labOrders, labSearch]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !permissions.canManageLabOrders || savingLabOrder) return;
    const pat = patients.find((p) => p.id === form.patientId) || patients[0];
    if (!pat) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    const safeLabName = form.labName.trim().slice(0, 120);
    if (!safeLabName) {
      showToast('Veuillez saisir le nom du laboratoire.', 'error');
      return;
    }
    const year = new Date().getFullYear();
    const maxSeq = labOrders.reduce((max, o) => {
      const m = /-(\d+)$/.exec(o.orderNumber || '');
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    setSavingLabOrder(true);
    try {
      await saveRecord(
        'labOrders',
        generateSafeId('lab'),
        {
          orderNumber: `LAB-${year}-${String(maxSeq + 1).padStart(3, '0')}`,
          patientId: pat.id,
          patientName: `${pat.firstName} ${pat.lastName}`.trim().slice(0, 150),
          practitionerId: user.uid,
          practitionerName: (staffProfile?.displayName || 'Praticien').slice(0, 120),
          labName: safeLabName,
          prosthesisType: form.prosthesisType,
          shadeVita: form.shadeVita.trim().slice(0, 20),
          teeth: form.teeth.trim().slice(0, 60),
          impressionType: form.impressionType,
          sentDate: today,
          dueDate: form.dueDate,
          nextAppointmentDate: form.nextAppointmentDate,
          status: 'Envoyé',
          labCost: Math.max(0, Number(form.labCost) || 0),
          supplierInvoiceRef: form.supplierInvoiceRef.trim().slice(0, 60),
          supplierPaid: false,
          notes: form.notes.trim().slice(0, 400),
          createdBy: user.uid,
        },
        true
      );
      setShowModal(false);
      showToast('Ordre de fabrication prothétique enregistré.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement de la fiche prothétique.", 'error');
    } finally {
      setSavingLabOrder(false);
    }
  };

  const updateOrderStatus = async (order: LabOrder, status: LabOrderStatus) => {
    if (!permissions.canManageLabOrders || busyOrderId === order.id) return;
    setBusyOrderId(order.id);
    try {
      await saveRecord('labOrders', order.id, { status }, false);
      showToast(`Statut prothèse : ${status}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour du statut.', 'error');
    } finally {
      setBusyOrderId(null);
    }
  };

  const toggleSupplierPaid = async (order: LabOrder) => {
    if (!permissions.canManageLabOrders || busyOrderId === order.id) return;
    setBusyOrderId(order.id);
    try {
      await saveRecord(
        'labOrders',
        order.id,
        { supplierPaid: !order.supplierPaid },
        false
      );
      showToast(
        !order.supplierPaid ? 'Facture laboratoire marquée payée.' : 'Paiement laboratoire marqué non réglé.',
        'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour du paiement labo.', 'error');
    } finally {
      setBusyOrderId(null);
    }
  };

  if (!canAccessSection(activeRole, 'lab-orders')) {
    return <AccessDeniedView sectionLabel="Laboratoire de Prothèses" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Laboratoire de Prothèses & Contrôle Fournisseurs ({labOrders.length})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Suivi complet des prothèses (Patient, N° P, Praticien, Laboratoire, Tél, Dates envoi/retour/pose, Type, Teinte, Dents, Payé, Statut, Observation)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={labSearch}
              onChange={(e) => setLabSearch(e.target.value)}
              placeholder="Patient, N° P, labo, teinte..."
              className="w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
          {permissions.canManageLabOrders && (
            <button
              type="button"
              onClick={() => {
                if (patients.length === 0) {
                  showToast("Créez d'abord un dossier patient.", 'error');
                  return;
                }
                setForm({ ...form, patientId: patients[0]?.id || '', supplierInvoiceRef: '' });
                setShowModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nouvelle Fiche Prothétique</span>
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-3 py-3 font-medium">Patient</th>
                <th className="px-3 py-3 font-medium">Num P</th>
                <th className="px-3 py-3 font-medium">Praticien</th>
                <th className="px-3 py-3 font-medium">Laboratoire</th>
                <th className="px-3 py-3 font-medium">Laboratoire tel</th>
                <th className="px-3 py-3 font-medium">Date d'envoi</th>
                <th className="px-3 py-3 font-medium">Date de retour</th>
                <th className="px-3 py-3 font-medium">Date de pose</th>
                <th className="px-3 py-3 font-medium">Types de prothèse</th>
                <th className="px-3 py-3 font-medium">Teinte</th>
                <th className="px-3 py-3 font-medium">Dents</th>
                <th className="px-3 py-3 font-medium text-center">Payé</th>
                <th className="px-3 py-3 font-medium">Statut</th>
                <th className="px-3 py-3 font-medium">Observation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLabOrders.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400 whitespace-normal">
                    {labOrders.length === 0
                      ? 'Aucune prothèse enregistrée dans le fichier importé (protheses_5a69e534.csv contient 0 ligne de données). Cliquez sur « Nouvelle Fiche Prothétique » pour ajouter une commande.'
                      : 'Aucune commande prothétique ne correspond à votre recherche.'}
                  </td>
                </tr>
              ) : (
                filteredLabOrders.map((o) => {
                  const returnIso = o.returnDate || o.dueDate || '';
                  const fittingIso = o.fittingDate || o.nextAppointmentDate || '';
                  const isLate =
                    Boolean(returnIso && returnIso < today) &&
                    o.status !== 'Reçu au cabinet' &&
                    o.status !== 'Validé posé';
                  return (
                    <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => openPatientFile(o.patientId)}
                          className="font-semibold text-sky-700 dark:text-sky-400 hover:underline text-left"
                          title="Ouvrir le dossier patient 360°"
                        >
                          {o.patientName}
                        </button>
                        <p className="text-[11px] font-mono text-slate-400">{o.orderNumber}</p>
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-600 dark:text-slate-300">
                        {o.patientFileNumber || '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">
                        {o.practitionerName || '—'}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {o.labName}
                        {permissions.canViewFinancialTotals && o.labCost > 0 && (
                          <span className="ml-1.5 text-[11px] font-mono text-slate-500">({formatMAD(o.labCost)})</span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-600 dark:text-slate-300">
                        {o.labPhone || '—'}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {o.sentDate ? formatDateFR(o.sentDate) : '—'}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums">
                        <span className="text-slate-800 dark:text-slate-200">
                          {returnIso ? formatDateFR(returnIso) : '—'}
                        </span>
                        {isLate && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-sans font-semibold text-red-700 dark:text-red-400">
                            <AlertTriangle className="h-3 w-3" /> Retard
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {fittingIso ? formatDateFR(fittingIso) : '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                        {o.prosthesisType}
                        {o.impressionType ? (
                          <span className="block text-[10px] text-slate-400">{o.impressionType}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {o.shadeVita || '—'}
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-700 dark:text-slate-300">
                        {o.teeth || '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <button
                          type="button"
                          disabled={!permissions.canManageLabOrders || busyOrderId === o.id}
                          onClick={() => void toggleSupplierPaid(o)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium border disabled:opacity-60 disabled:cursor-not-allowed ${
                            o.supplierPaid
                              ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                              : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {o.supplierPaid ? 'Oui (Payé)' : 'Non'}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          disabled={!permissions.canManageLabOrders || busyOrderId === o.id}
                          value={o.status}
                          onChange={(e) => void updateOrderStatus(o, e.target.value as LabOrderStatus)}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 text-xs disabled:opacity-60"
                        >
                          {(
                            [
                              'Envoyé',
                              'Au labo',
                              'Reçu au cabinet',
                              'En essayage',
                              'Validé posé',
                              'Retour pour correction',
                            ] as LabOrderStatus[]
                          ).map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300 max-w-xs truncate whitespace-normal">
                        {o.notes || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Nouvelle Commande Prothétique</h3>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateOrder} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={form.patientId}
                  onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                  className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
                <input
                  required
                  placeholder="Nom du laboratoire"
                  value={form.labName}
                  onChange={(e) => setForm({ ...form, labName: e.target.value })}
                  className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={form.prosthesisType}
                  onChange={(e) =>
                    setForm({ ...form, prosthesisType: e.target.value as LabOrder['prosthesisType'] })
                  }
                  className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {['Zircone', 'Céramo-métallique', 'E-max', 'Squeletté', 'Résine amovible', 'Gouttière', 'Sur implant'].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    )
                  )}
                </select>
                <input
                  placeholder="Teinte VITA (A2)"
                  value={form.shadeVita}
                  onChange={(e) => setForm({ ...form, shadeVita: e.target.value })}
                  className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                />
                <input
                  placeholder="Dents (16, 26)"
                  value={form.teeth}
                  onChange={(e) => setForm({ ...form, teeth: e.target.value })}
                  className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Flux d'empreinte</label>
                  <select
                    value={form.impressionType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        impressionType: e.target.value as 'Empreinte physique' | 'Fichier numérique STL',
                      })
                    }
                    className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    <option value="Fichier numérique STL">Fichier STL</option>
                    <option value="Empreinte physique">Empreinte physique</option>
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Coût labo (MAD)</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Coût MAD"
                    value={form.labCost}
                    onChange={(e) => setForm({ ...form, labCost: Number(e.target.value) })}
                    className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="min-w-0">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Livraison souhaitée</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-2 font-mono"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">RDV essayage patient</label>
                  <input
                    type="date"
                    value={form.nextAppointmentDate}
                    onChange={(e) => setForm({ ...form, nextAppointmentDate: e.target.value })}
                    className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-2 font-mono"
                  />
                </div>
                <div className="min-w-0">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Réf. facture labo</label>
                  <input
                    placeholder="Optionnel"
                    value={form.supplierInvoiceRef}
                    onChange={(e) => setForm({ ...form, supplierInvoiceRef: e.target.value })}
                    className="w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-2 font-mono"
                  />
                </div>
              </div>
              <textarea
                rows={2}
                placeholder="Instructions prothésiste..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingLabOrder}
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingLabOrder}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingLabOrder ? 'Création...' : 'Créer la fiche'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MODULE 7 : DOCUMENTS MÉDICAUX, ORDONNANCES & FEUILLES DE SOINS
// ============================================================================
export const DocumentsView: React.FC = () => {
  const {
    user,
    activeRole,
    staffProfile,
    patients,
    selectedPatientId: contextSelectedPatientId,
    medicalDocuments,
    invoices,
    permissions,
    saveRecord,
    setPrintableDoc,
    openPatientFile,
    showToast,
  } = useClinic();

  const [selectedPatientId, setSelectedPatientId] = useState(
    contextSelectedPatientId || patients[0]?.id || ''
  );
  const [docType, setDocType] = useState<MedicalDocType>('Ordonnance');
  const [title, setTitle] = useState('Ordonnance Stomatologique');
  const [bodyText, setBodyText] = useState('');
  const [prescriptions, setPrescriptions] = useState<PrescriptionLine[]>([
    STOMATOLOGY_MOLECULES[0].items[0],
  ]);
  const [certDurationDays, setCertDurationDays] = useState<number>(2);
  const [certCategory, setCertCategory] = useState<'Initial' | 'Prolongation'>('Initial');
  const [feeNoteAmount, setFeeNoteAmount] = useState<number>(300);
  const [feeNoteMethod, setFeeNoteMethod] = useState<string>('Espèce');

  const [historyCategory, setHistoryCategory] = useState<'ALL' | 'Ordonnance' | 'Certificat médical' | 'Feuille de soins' | "Note d'honoraires">('ALL');
  const [historySearch, setHistorySearch] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);
  const [docPage, setDocPage] = useState(1);
  const DOC_PAGE_SIZE = 30;

  useEffect(() => {
    if (contextSelectedPatientId && patients.some((p) => p.id === contextSelectedPatientId)) {
      setSelectedPatientId(contextSelectedPatientId);
    } else if (!selectedPatientId && patients[0]?.id) {
      setSelectedPatientId(patients[0].id);
    }
  }, [contextSelectedPatientId, patients, selectedPatientId]);

  const activePatient = patients.find((p) => p.id === selectedPatientId) || patients[0];

  const handleSelectDocType = (type: MedicalDocType) => {
    setDocType(type);
    if (type === 'Ordonnance') {
      setTitle('Ordonnance Médicamenteuse');
      setBodyText('');
    } else if (type === 'Certificat médical') {
      setTitle(`Certificat médical (${certCategory}) · ${certDurationDays} jour${certDurationDays > 1 ? 's' : ''}`);
      setBodyText(
        `Je soussigné(e), Docteur en Chirurgie Dentaire, certifie après examen clinique que l'état bucco-dentaire du/de la patient(e) nécessite un repos / arrêt de ${certDurationDays} jour(s) à compter de ce jour (Type : ${certCategory}).`
      );
    } else if (type === "Note d'honoraires") {
      setTitle(`Note d'honoraires · ${feeNoteAmount.toLocaleString('fr-FR')} MAD (${feeNoteMethod})`);
      setBodyText('Consultation & soins bucco-dentaires réalisés au cabinet.');
    } else {
      const tpl = DOCUMENT_TEMPLATES[type];
      setTitle(tpl?.title || type);
      setBodyText(tpl?.body || '');
    }
  };

  const addMolecule = (line: PrescriptionLine) => {
    if (prescriptions.length >= 20) {
      showToast('Limite maximale de 20 lignes par ordonnance atteinte.', 'info');
      return;
    }
    setPrescriptions((prev) => [...prev, { ...line }]);
  };

  const handleSaveAndPrint = async () => {
    if (!user || savingDoc) return;
    if (!activePatient) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    const safeTitle = title.trim().slice(0, 160) || docType;
    const safeBodyText = bodyText.trim().slice(0, 3000);
    const safePrescriptions = docType === 'Ordonnance' ? prescriptions.slice(0, 20) : [];

    setSavingDoc(true);
    try {
      if (permissions.canCreateMedicalDocs) {
        await saveRecord(
          'medicalDocuments',
          generateSafeId('doc'),
          {
            patientId: activePatient.id,
            patientName: `${activePatient.firstName} ${activePatient.lastName}`.trim().slice(0, 150),
            practitionerId: user.uid,
            practitionerName: (staffProfile?.displayName || 'Praticien').slice(0, 120),
            docType,
            date: todayISO(),
            title: safeTitle,
            prescriptions: safePrescriptions,
            bodyText: safeBodyText,
            createdBy: user.uid,
          },
          true
        );
      }

      const patientLastInv = invoices
        .filter((i) => i.patientId === activePatient.id && i.status !== 'Annulée')
        .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))[0];
      setPrintableDoc({
        kind:
          docType === 'Ordonnance'
            ? 'prescription'
            : docType === 'Feuille de soins'
            ? 'care-sheet'
            : docType === "Note d'honoraires"
            ? 'fee-note'
            : 'certificate',
        title: safeTitle,
        subtitle:
          docType === 'Certificat médical'
            ? `Type : ${certCategory} · Durée : ${certDurationDays} jour(s)`
            : undefined,
        reference: activePatient.fileNumber ? `P.${activePatient.fileNumber}` : undefined,
        date: todayISO(),
        patientName: `${activePatient.firstName} ${activePatient.lastName}`,
        patientCin: activePatient.cin,
        patientPhone: activePatient.phone,
        patientInsurance: `${activePatient.insuranceType} (${activePatient.coverageRate}%)`,
        patientInsuranceNumber: activePatient.insuranceNumber,
        practitionerName: staffProfile?.displayName || 'Chirurgien-Dentiste',
        prescriptions: docType === 'Ordonnance' ? safePrescriptions : undefined,
        bodyText: safeBodyText,
        items:
          docType === 'Feuille de soins' && patientLastInv
            ? patientLastInv.items.map((it) => ({
                label: it.actName,
                tooth: it.tooth,
                qty: it.quantity,
                unitPrice: it.unitPrice,
                total: it.total,
              }))
            : undefined,
        totalAmount:
          docType === "Note d'honoraires"
            ? feeNoteAmount
            : docType === 'Feuille de soins' && patientLastInv
            ? patientLastInv.totalAmount
            : undefined,
        paidAmount: docType === "Note d'honoraires" ? feeNoteAmount : undefined,
        paymentMethod: docType === "Note d'honoraires" ? feeNoteMethod : undefined,
      });
      showToast(
        permissions.canCreateMedicalDocs
          ? 'Document généré et archivé.'
          : 'Aperçu A4 généré pour impression.',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la génération du document.', 'error');
    } finally {
      setSavingDoc(false);
    }
  };

  const docTypeCounts = useMemo(() => {
    const counts = {
      ALL: medicalDocuments.length,
      Ordonnance: 0,
      'Certificat médical': 0,
      'Feuille de soins': 0,
      "Note d'honoraires": 0,
    };
    medicalDocuments.forEach((d) => {
      if (d.docType === 'Ordonnance') counts.Ordonnance += 1;
      else if (d.docType === 'Certificat médical') counts['Certificat médical'] += 1;
      else if (d.docType === 'Feuille de soins') counts['Feuille de soins'] += 1;
      else if (d.docType === "Note d'honoraires") counts["Note d'honoraires"] += 1;
    });
    return counts;
  }, [medicalDocuments]);

  const filteredDocuments = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return medicalDocuments.filter((d) => {
      if (historyCategory !== 'ALL' && d.docType !== historyCategory) return false;
      if (!q) return true;
      return `${d.title} ${d.docType} ${d.patientName} ${d.patientFileNumber || ''} ${d.practitionerName || ''} ${d.actsText || ''} ${d.medicationsText || ''} ${d.bodyText || ''} ${d.certificateType || ''} ${d.careSheetFund || ''} ${d.paymentMethod || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [medicalDocuments, historyCategory, historySearch]);

  useEffect(() => {
    setDocPage(1);
  }, [historyCategory, historySearch]);

  const totalDocPages = Math.max(1, Math.ceil(filteredDocuments.length / DOC_PAGE_SIZE));
  const safeDocPage = Math.min(docPage, totalDocPages);
  const paginatedDocuments = useMemo(() => {
    const start = (safeDocPage - 1) * DOC_PAGE_SIZE;
    return filteredDocuments.slice(start, start + DOC_PAGE_SIZE);
  }, [filteredDocuments, safeDocPage]);

  if (!canAccessSection(activeRole, 'documents')) {
    return <AccessDeniedView sectionLabel="Documents Médicaux & Ordonnances" />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-5 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Éditeur d'Ordonnances, Certificats, Feuilles & Notes
          </h2>
          <button
            type="button"
            disabled={savingDoc}
            onClick={() => void handleSaveAndPrint()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>
              {savingDoc
                ? 'Génération...'
                : permissions.canCreateMedicalDocs
                ? 'Enregistrer & Imprimer A4'
                : 'Imprimer A4'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Patient</label>
            <select
              value={activePatient?.id || ''}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fileNumber ? `${p.fileNumber} · ` : ''}{p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Type de document</label>
            <select
              value={docType}
              onChange={(e) => handleSelectDocType(e.target.value as MedicalDocType)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            >
              <option value="Ordonnance">Ordonnance Médicamenteuse</option>
              <option value="Certificat médical">Certificat médical</option>
              <option value="Feuille de soins">Feuille de Soins CNSS / CNOPS / AMO</option>
              <option value="Note d'honoraires">Note d'honoraires</option>
              <option value="Certificat de présence">Certificat de présence</option>
              <option value="Dispense">Dispense scolaire / professionnelle</option>
              <option value="Attestation de soins">Attestation de soins</option>
              <option value="Consentement éclairé">Consentement éclairé</option>
              <option value="Lettre confrère">Lettre d'adressage confrère</option>
            </select>
          </div>
        </div>

        {docType === 'Certificat médical' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Durée (Jours)</label>
              <input
                type="number"
                min={1}
                value={certDurationDays}
                onChange={(e) => {
                  const days = Math.max(1, Number(e.target.value) || 1);
                  setCertDurationDays(days);
                  setTitle(`Certificat médical (${certCategory}) · ${days} jour${days > 1 ? 's' : ''}`);
                  setBodyText(
                    `Je soussigné(e), Docteur en Chirurgie Dentaire, certifie après examen clinique que l'état bucco-dentaire du/de la patient(e) nécessite un repos / arrêt de ${days} jour(s) à compter de ce jour (Type : ${certCategory}).`
                  );
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Type</label>
              <select
                value={certCategory}
                onChange={(e) => {
                  const nextCat = e.target.value as 'Initial' | 'Prolongation';
                  setCertCategory(nextCat);
                  setTitle(`Certificat médical (${nextCat}) · ${certDurationDays} jour${certDurationDays > 1 ? 's' : ''}`);
                  setBodyText(
                    `Je soussigné(e), Docteur en Chirurgie Dentaire, certifie après examen clinique que l'état bucco-dentaire du/de la patient(e) nécessite un repos / arrêt de ${certDurationDays} jour(s) à compter de ce jour (Type : ${nextCat}).`
                  );
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5"
              >
                <option value="Initial">Initial</option>
                <option value="Prolongation">Prolongation</option>
              </select>
            </div>
          </div>
        )}

        {docType === "Note d'honoraires" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Montant (MAD)</label>
              <input
                type="number"
                min={0}
                value={feeNoteAmount}
                onChange={(e) => {
                  const amt = Math.max(0, Number(e.target.value) || 0);
                  setFeeNoteAmount(amt);
                  setTitle(`Note d'honoraires · ${amt.toLocaleString('fr-FR')} MAD (${feeNoteMethod})`);
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Moyen de paiement</label>
              <select
                value={feeNoteMethod}
                onChange={(e) => {
                  const method = e.target.value;
                  setFeeNoteMethod(method);
                  setTitle(`Note d'honoraires · ${feeNoteAmount.toLocaleString('fr-FR')} MAD (${method})`);
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-1.5"
              >
                <option value="Espèce">Espèce</option>
                <option value="Virement bancaire">Virement bancaire</option>
                <option value="Carte bancaire">Carte bancaire</option>
                <option value="Chèque">Chèque</option>
              </select>
            </div>
          </div>
        )}

        <div className="text-xs">
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Titre du document</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
          />
        </div>

        {docType === 'Ordonnance' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Bibliothèque Stomatologique (Clic pour ajouter)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STOMATOLOGY_MOLECULES.flatMap((cat) => cat.items).map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => addMolecule(item)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-sky-400 dark:hover:border-sky-500 hover:text-sky-700 dark:hover:text-sky-300"
                  >
                    + {item.molecule.split('(')[0].trim()}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {prescriptions.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/40 p-2.5 text-xs items-center"
                >
                  <input
                    value={line.molecule}
                    onChange={(e) => {
                      const next = [...prescriptions];
                      next[idx] = { ...next[idx], molecule: e.target.value };
                      setPrescriptions(next);
                    }}
                    className="sm:col-span-4 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5 font-medium"
                  />
                  <input
                    value={line.dosage}
                    onChange={(e) => {
                      const next = [...prescriptions];
                      next[idx] = { ...next[idx], dosage: e.target.value };
                      setPrescriptions(next);
                    }}
                    className="sm:col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5"
                  />
                  <input
                    value={line.frequency}
                    onChange={(e) => {
                      const next = [...prescriptions];
                      next[idx] = { ...next[idx], frequency: e.target.value };
                      setPrescriptions(next);
                    }}
                    className="sm:col-span-3 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5"
                  />
                  <input
                    value={line.duration}
                    onChange={(e) => {
                      const next = [...prescriptions];
                      next[idx] = { ...next[idx], duration: e.target.value };
                      setPrescriptions(next);
                    }}
                    className="sm:col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => setPrescriptions(prescriptions.filter((_, i) => i !== idx))}
                    className="sm:col-span-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 flex justify-center"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <textarea
            rows={7}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Contenu détaillé / actes figurant sur le document..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs leading-relaxed"
          />
        )}
      </div>

      {/* Saved & CSV Documents History — Full Column Display */}
      <div className="lg:col-span-7 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Historique des Documents Émis ({filteredDocuments.length} / {medicalDocuments.length})
          </h3>
          <div className="relative w-full sm:w-auto">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Patient, N° P, actes, médicaments..."
              className="w-full sm:w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'ALL', label: `Tous (${docTypeCounts.ALL})` },
              { id: 'Certificat médical', label: `Certificats médicaux (${docTypeCounts['Certificat médical']})` },
              { id: 'Ordonnance', label: `Ordonnances (${docTypeCounts.Ordonnance})` },
              { id: 'Feuille de soins', label: `Feuilles de soins (${docTypeCounts['Feuille de soins']})` },
              { id: "Note d'honoraires", label: `Notes d'honoraires (${docTypeCounts["Note d'honoraires"]})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setHistoryCategory(tab.id)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                historyCategory === tab.id
                  ? 'bg-sky-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredDocuments.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Aucun document ne correspond à ce filtre.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[680px] overflow-y-auto pr-1">
            {paginatedDocuments.map((d) => (
              <div key={d.id} className="py-3.5 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:text-sky-300">
                        {d.docType}
                      </span>
                      <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        Le : {formatDateFR(d.date)}
                      </span>
                      {d.patientFileNumber && (
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                          N° Patient : {d.patientFileNumber}
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{d.title}</p>
                    <p className="text-slate-500 dark:text-slate-400">
                      Patient :{' '}
                      <button
                        type="button"
                        onClick={() => openPatientFile(d.patientId)}
                        className="font-semibold text-sky-700 dark:text-sky-400 hover:underline"
                        title="Ouvrir le dossier patient 360°"
                      >
                        {d.patientName}
                      </button>{' '}
                      · Praticien : <span className="text-slate-700 dark:text-slate-200">{d.practitionerName || '—'}</span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const pat = patients.find((p) => p.id === d.patientId);
                      const patInv = invoices
                        .filter((i) => i.patientId === d.patientId && i.status !== 'Annulée')
                        .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))[0];
                      setPrintableDoc({
                        kind:
                          d.docType === 'Ordonnance'
                            ? 'prescription'
                            : d.docType === 'Feuille de soins'
                            ? 'care-sheet'
                            : d.docType === "Note d'honoraires"
                            ? 'fee-note'
                            : 'certificate',
                        title: d.title,
                        subtitle:
                          d.docType === 'Certificat médical' && (d.certificateType || typeof d.durationDays === 'number')
                            ? `Type : ${d.certificateType || '—'}${typeof d.durationDays === 'number' ? ` · Durée : ${d.durationDays} jour(s)` : ''}`
                            : d.docType === 'Feuille de soins' && d.careSheetFund
                            ? `${d.careSheetFund}${d.careSheetExecutionType ? ` · ${d.careSheetExecutionType}` : ''}`
                            : undefined,
                        reference: d.patientFileNumber ? `P.${d.patientFileNumber}` : pat?.fileNumber,
                        date: d.date,
                        patientName: d.patientName,
                        patientCin: pat?.cin,
                        patientPhone: pat?.phone,
                        patientInsurance: pat ? `${pat.insuranceType} (${pat.coverageRate}%)` : undefined,
                        patientInsuranceNumber: pat?.insuranceNumber,
                        practitionerName: d.practitionerName || 'Praticien',
                        prescriptions: d.prescriptions,
                        bodyText: d.actsText || d.bodyText || d.medicationsText,
                        items:
                          d.docType === 'Feuille de soins' && !d.actsText && patInv
                            ? patInv.items.map((it) => ({
                                label: it.actName,
                                tooth: it.tooth,
                                qty: it.quantity,
                                unitPrice: it.unitPrice,
                                total: it.total,
                              }))
                            : undefined,
                        totalAmount:
                          typeof d.amount === 'number'
                            ? d.amount
                            : d.docType === 'Feuille de soins' && patInv
                            ? patInv.totalAmount
                            : undefined,
                        paidAmount: d.docType === "Note d'honoraires" && typeof d.amount === 'number' ? d.amount : undefined,
                        paymentMethod: d.paymentMethod,
                      });
                    }}
                    className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Réimprimer
                  </button>
                </div>

                {/* Type-specific structured CSV metadata */}
                {d.docType === 'Certificat médical' && (typeof d.durationDays === 'number' || d.certificateType) && (
                  <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] text-slate-700 dark:text-slate-300">
                    <span>
                      Durée (Jours) : <strong className="font-mono">{d.durationDays ?? '—'}</strong>
                    </span>
                    <span>
                      Type : <strong>{d.certificateType || '—'}</strong>
                    </span>
                  </div>
                )}

                {d.docType === 'Feuille de soins' && (
                  <div className="space-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300">
                    <div className="flex flex-wrap gap-3">
                      <span>
                        Feuille de soins : <strong>{d.careSheetFund || '—'}</strong>
                      </span>
                      <span>
                        Type : <strong>{d.careSheetExecutionType || '—'}</strong>
                      </span>
                      <span>
                        Montant : <strong className="font-mono">{typeof d.amount === 'number' ? formatMAD(d.amount) : '—'}</strong>
                      </span>
                    </div>
                    {(d.actsText || d.bodyText) && (
                      <p className="whitespace-pre-line text-slate-600 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-700 pt-1">
                        Actes : {d.actsText || d.bodyText}
                      </p>
                    )}
                  </div>
                )}

                {d.docType === "Note d'honoraires" && (
                  <div className="space-y-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300">
                    <div className="flex flex-wrap gap-3">
                      <span>
                        Montant : <strong className="font-mono">{typeof d.amount === 'number' ? formatMAD(d.amount) : '—'}</strong>
                      </span>
                      <span>
                        Moyen de paiement : <strong>{d.paymentMethod || '—'}</strong>
                      </span>
                    </div>
                    {(d.actsText || d.bodyText) && (
                      <p className="whitespace-pre-line text-slate-600 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-700 pt-1">
                        Actes : {d.actsText || d.bodyText}
                      </p>
                    )}
                  </div>
                )}

                {d.docType === 'Ordonnance' && (d.medicationsText || (d.prescriptions && d.prescriptions.length > 0)) && (
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-line">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-0.5">Les médicaments :</span>
                    {d.medicationsText ||
                      d.prescriptions?.map((p, i) => `${i + 1}. ${p.molecule} (${p.dosage} · ${p.frequency} · ${p.duration})`).join('\n')}
                  </div>
                )}

                {(d.csvCreatedAt || d.csvCreatedBy || d.csvUpdatedAt || d.csvUpdatedBy) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                    {d.csvCreatedAt && <span>Créé le : {d.csvCreatedAt}</span>}
                    {d.csvCreatedBy && <span>Créé par : {d.csvCreatedBy}</span>}
                    {d.csvUpdatedAt && <span>Dernière MAJ le : {d.csvUpdatedAt}</span>}
                    {d.csvUpdatedBy && <span>MAJ par : {d.csvUpdatedBy}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {totalDocPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-3 text-xs">
            <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
              {(safeDocPage - 1) * DOC_PAGE_SIZE + 1}–{Math.min(safeDocPage * DOC_PAGE_SIZE, filteredDocuments.length)} sur {filteredDocuments.length} document(s)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safeDocPage <= 1}
                onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Précédent</span>
              </button>
              <span className="px-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                Page {safeDocPage} / {totalDocPages}
              </span>
              <button
                type="button"
                disabled={safeDocPage >= totalDocPages}
                onClick={() => setDocPage((p) => Math.min(totalDocPages, p + 1))}
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

// ============================================================================
// MODULE 8 : CAISSE JOURNALIÈRE & CHARGES ANALYTIQUES
// ============================================================================
export const CashExpensesView: React.FC = () => {
  const { user, activeRole, staffProfile, payments, expenses, cashClosures, permissions, saveRecord, showToast } =
    useClinic();
  const [tab, setTab] = useState<'cash' | 'expenses'>('cash');
  const today = todayISO();

  const todayCashIn = useMemo(
    () =>
      payments
        .filter((p) => p.date === today && p.method === 'Espèces')
        .reduce((s, p) => s + p.amount, 0),
    [payments, today]
  );

  const todayCashOut = useMemo(
    () =>
      expenses
        .filter((e) => e.date === today && e.paymentMethod === 'Espèces')
        .reduce((s, e) => s + e.amount, 0),
    [expenses, today]
  );

  const existingTodayClosure = useMemo(
    () => cashClosures.find((c) => c.date === today) || null,
    [cashClosures, today]
  );
  const previousClosure = useMemo(
    () => cashClosures.find((c) => c.date < today) || null,
    [cashClosures, today]
  );

  const [openingBalance, setOpeningBalance] = useState<number>(
    () => existingTodayClosure?.openingBalance ?? previousClosure?.countedBalance ?? 0
  );
  const [openingEdited, setOpeningEdited] = useState(false);
  const expectedBalance = openingBalance + todayCashIn - todayCashOut;
  const [countedBalance, setCountedBalance] = useState<number>(
    () => existingTodayClosure?.countedBalance ?? expectedBalance
  );
  const [countedEdited, setCountedEdited] = useState(false);
  const [closureNotes, setClosureNotes] = useState(() => existingTodayClosure?.notes || '');
  const [notesEdited, setNotesEdited] = useState(false);
  const [savingClosure, setSavingClosure] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [expSearch, setExpSearch] = useState('');
  const [expPage, setExpPage] = useState(1);
  const EXP_PAGE_SIZE = 50;

  useEffect(() => {
    if (!openingEdited) {
      setOpeningBalance(existingTodayClosure?.openingBalance ?? previousClosure?.countedBalance ?? 0);
    }
  }, [existingTodayClosure, previousClosure, openingEdited]);

  useEffect(() => {
    if (!countedEdited) {
      setCountedBalance(existingTodayClosure?.countedBalance ?? expectedBalance);
    }
  }, [existingTodayClosure, expectedBalance, countedEdited]);

  useEffect(() => {
    if (!notesEdited) {
      setClosureNotes(existingTodayClosure?.notes || '');
    }
  }, [existingTodayClosure, notesEdited]);

  const filteredExpenses = useMemo(() => {
    const q = expSearch.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) =>
      `${e.date} ${e.category} ${e.expenseType} ${e.rawType || ''} ${e.label} ${e.description || ''} ${e.supplier || ''} ${e.practitionerName || ''} ${e.enteredBy || ''} ${e.rawPaymentMethod || e.paymentMethod}`
        .toLowerCase()
        .includes(q)
    );
  }, [expenses, expSearch]);

  useEffect(() => {
    setExpPage(1);
  }, [expSearch]);

  const totalFilteredExpenses = useMemo(
    () => filteredExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [filteredExpenses]
  );

  const totalExpPages = Math.max(1, Math.ceil(filteredExpenses.length / EXP_PAGE_SIZE));
  const safeExpPage = Math.min(expPage, totalExpPages);
  const paginatedExpenses = useMemo(() => {
    const start = (safeExpPage - 1) * EXP_PAGE_SIZE;
    return filteredExpenses.slice(start, start + EXP_PAGE_SIZE);
  }, [filteredExpenses, safeExpPage]);

  const isClosureLockedForRole = Boolean(
    existingTodayClosure && !permissions.canManageExpensesAndClosures
  );

  const [expForm, setExpForm] = useState({
    date: today,
    category: 'Fournitures' as Expense['category'],
    expenseType: 'Dépense variable' as Expense['expenseType'],
    label: '',
    supplier: '',
    amount: 0,
    paymentMethod: 'Espèces' as Expense['paymentMethod'],
    receiptRef: '',
  });

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || savingClosure) return;
    if (existingTodayClosure && !permissions.canManageExpensesAndClosures) {
      showToast('Clôture déjà verrouillée (modification réservée au Praticien Titulaire).', 'error');
      return;
    }
    setSavingClosure(true);
    try {
      const safeCounted = Number(countedBalance) || 0;
      const safeNotes = closureNotes.trim().slice(0, 400);
      if (existingTodayClosure) {
        const discrepancy = safeCounted - existingTodayClosure.expectedBalance;
        await saveRecord(
          'cashClosures',
          existingTodayClosure.id,
          {
            countedBalance: safeCounted,
            discrepancy,
            notes: safeNotes,
            locked: true,
          },
          false
        );
      } else {
        const discrepancy = safeCounted - expectedBalance;
        await saveRecord(
          'cashClosures',
          `close_${today}`,
          {
            date: today,
            openingBalance: Number(openingBalance) || 0,
            cashInflows: todayCashIn,
            cashOutflows: todayCashOut,
            expectedBalance,
            countedBalance: safeCounted,
            discrepancy,
            notes: safeNotes,
            locked: true,
            closedByUid: user.uid,
            closedByName: (staffProfile?.displayName || 'Responsable').slice(0, 120),
          },
          true
        );
      }
      showToast('Clôture journalière de caisse verrouillée.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la clôture de caisse.', 'error');
    } finally {
      setSavingClosure(false);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !expForm.label.trim() || savingExpense) return;
    const amt = Number(expForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Veuillez saisir un montant supérieur à 0 MAD.', 'error');
      return;
    }
    setSavingExpense(true);
    try {
      await saveRecord(
        'expenses',
        generateSafeId('exp'),
        {
          date: expForm.date,
          category: expForm.category,
          expenseType: expForm.expenseType,
          label: expForm.label.trim().slice(0, 180),
          supplier: expForm.supplier.trim().slice(0, 120),
          amount: amt,
          paymentMethod: expForm.paymentMethod,
          receiptRef: expForm.receiptRef.trim().slice(0, 80),
          createdBy: user.uid,
        },
        true
      );
      setExpForm({ ...expForm, label: '', supplier: '', amount: 0, receiptRef: '' });
      showToast('Charge enregistrée dans la comptabilité analytique.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement de la charge.", 'error');
    } finally {
      setSavingExpense(false);
    }
  };

  if (!canAccessSection(activeRole, 'cash-expenses')) {
    return <AccessDeniedView sectionLabel="Caisse & Dépenses" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setTab('cash')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium ${
              tab === 'cash'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Livre de Caisse & Clôture
          </button>
          {permissions.canManageExpensesAndClosures && (
            <button
              type="button"
              onClick={() => setTab('expenses')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium ${
                tab === 'expenses'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Charges Fixes & Dépenses ({expenses.length})
            </button>
          )}
        </div>
      </div>

      {tab === 'cash' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleCloseDay}
            className="lg:col-span-5 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 text-xs"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Clôture Journalière des Espèces — {formatDateFR(today)}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 mb-1">Fond de caisse initial (MAD)</label>
                <input
                  type="number"
                  disabled={Boolean(existingTodayClosure)}
                  value={openingBalance}
                  onChange={(e) => {
                    setOpeningEdited(true);
                    setOpeningBalance(Number(e.target.value));
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-slate-600 dark:text-slate-300 mb-1">Solde compté en caisse (MAD)</label>
                <input
                  type="number"
                  disabled={isClosureLockedForRole}
                  value={countedBalance}
                  onChange={(e) => {
                    setCountedEdited(true);
                    setCountedBalance(Number(e.target.value));
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono font-semibold disabled:opacity-60"
                />
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">Entrées espèces du jour</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400 font-semibold">+ {formatMAD(todayCashIn)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">Sorties espèces du jour</span>
                <span className="font-mono text-red-700 dark:text-red-400 font-semibold">- {formatMAD(todayCashOut)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-1.5 font-semibold text-slate-900 dark:text-slate-100">
                <span>Solde théorique attendu</span>
                <span className="font-mono">{formatMAD(expectedBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-700 dark:text-slate-300">Écart constaté</span>
                <span
                  className={`font-mono font-bold ${
                    Number(countedBalance) - expectedBalance === 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {formatMAD(Number(countedBalance) - expectedBalance)}
                </span>
              </div>
            </div>

            <textarea
              rows={2}
              disabled={isClosureLockedForRole}
              placeholder="Justification éventuelle d'écart de caisse..."
              value={closureNotes}
              onChange={(e) => {
                setNotesEdited(true);
                setClosureNotes(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={isClosureLockedForRole || savingClosure}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B2239] dark:bg-sky-600 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>
                {savingClosure
                  ? 'Enregistrement...'
                  : isClosureLockedForRole
                  ? 'Caisse verrouillée (modification réservée au Titulaire)'
                  : existingTodayClosure
                  ? 'Mettre à jour la Clôture du Jour'
                  : 'Valider & Verrouiller la Caisse du Jour'}
              </span>
            </button>
          </form>

          <div className="lg:col-span-7 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 sm:px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Historique des Clôtures</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium text-right">Attendu</th>
                    <th className="px-4 py-2.5 font-medium text-right">Compté</th>
                    <th className="px-4 py-2.5 font-medium text-right">Écart</th>
                    <th className="px-4 py-2.5 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {cashClosures.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">{formatDateFR(c.date)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">{formatMAD(c.expectedBalance)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">{formatMAD(c.countedBalance)}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">{formatMAD(c.discrepancy)}</td>
                      <td className="px-4 py-3 text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap">
                        {c.locked ? 'Verrouillée' : 'Ouverte'} · {c.closedByName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <form
            onSubmit={handleAddExpense}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs"
          >
            <input
              type="date"
              required
              value={expForm.date}
              onChange={(e) => setExpForm({ ...expForm, date: e.target.value })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
            />
            <select
              value={expForm.expenseType}
              onChange={(e) =>
                setExpForm({ ...expForm, expenseType: e.target.value as Expense['expenseType'] })
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            >
              <option value="Charge fixe">Charge fixe</option>
              <option value="Dépense variable">Dépense variable</option>
            </select>
            <select
              value={expForm.category}
              onChange={(e) => setExpForm({ ...expForm, category: e.target.value as Expense['category'] })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            >
              {['Loyer', 'Salaires', 'Maintenance', 'Leasing', 'Fournitures', 'Laboratoire', 'Réparations', 'Électricité/Eau', 'Autre'].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                )
              )}
            </select>
            <input
              required
              placeholder="Libellé de la dépense"
              value={expForm.label}
              onChange={(e) => setExpForm({ ...expForm, label: e.target.value })}
              className="lg:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
            />
            <input
              placeholder="Fournisseur (optionnel)"
              value={expForm.supplier}
              onChange={(e) => setExpForm({ ...expForm, supplier: e.target.value })}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
            />
            <div className="flex gap-2">
              <select
                value={expForm.paymentMethod}
                onChange={(e) =>
                  setExpForm({ ...expForm, paymentMethod: e.target.value as Expense['paymentMethod'] })
                }
                aria-label="Mode de règlement"
                className="w-28 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-2"
              >
                <option value="Espèces">Espèces</option>
                <option value="Virement">Virement</option>
                <option value="Carte bancaire">Carte</option>
                <option value="Chèque">Chèque</option>
              </select>
              <input
                type="number"
                min={1}
                required
                placeholder="MAD"
                value={expForm.amount || ''}
                onChange={(e) => setExpForm({ ...expForm, amount: Number(e.target.value) })}
                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-2 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={savingExpense}
              className="rounded-lg bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60 whitespace-nowrap"
            >
              {savingExpense ? 'Ajout...' : '+ Enregistrer'}
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40 text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Registre complet des Charges ({filteredExpenses.length} / {expenses.length}) · Total :{' '}
                <span className="font-mono text-red-700 dark:text-red-400">
                  {formatMAD(totalFilteredExpenses)}
                </span>
              </span>
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={expSearch}
                  onChange={(e) => setExpSearch(e.target.value)}
                  placeholder="Filtrer par libellé, type, fournisseur..."
                  className="w-60 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-3 font-medium">Date</th>
                    <th className="px-3 py-3 font-medium text-right">Montant</th>
                    <th className="px-3 py-3 font-medium">Type</th>
                    <th className="px-3 py-3 font-medium">Description</th>
                    <th className="px-3 py-3 font-medium">Praticien</th>
                    <th className="px-3 py-3 font-medium">Saisi par</th>
                    <th className="px-3 py-3 font-medium">Moyen de paiement</th>
                    <th className="px-3 py-3 font-medium">Date de règlement</th>
                    <th className="px-3 py-3 font-medium text-center">Declaré</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Aucune charge correspondante.
                      </td>
                    </tr>
                  ) : (
                    paginatedExpenses.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {formatDateFR(e.date)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
                          {formatMAD(e.amount)}
                        </td>
                        <td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-200">
                          {e.rawType || `${e.category} (${e.expenseType})`}
                        </td>
                        <td className="px-3 py-3 text-slate-900 dark:text-slate-100 whitespace-normal min-w-[200px]">
                          <span className="font-semibold">{e.description || e.label}</span>
                          {e.supplier ? (
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                              Fournisseur : {e.supplier}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">
                          {e.practitionerName || '—'}
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-400">
                          {e.enteredBy || '—'}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">
                          {e.rawPaymentMethod || e.paymentMethod}
                        </td>
                        <td className="px-3 py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {e.settlementDate ? formatDateFR(e.settlementDate) : '—'}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              (e.declared || '').toLowerCase() === 'oui'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {e.declared || '—'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalExpPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-2.5 text-xs">
                <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                  {(safeExpPage - 1) * EXP_PAGE_SIZE + 1}–{Math.min(safeExpPage * EXP_PAGE_SIZE, filteredExpenses.length)} sur {filteredExpenses.length} charge(s)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safeExpPage <= 1}
                    onClick={() => setExpPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium text-slate-700 dark:text-slate-200 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Précédent</span>
                  </button>
                  <span className="px-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                    Page {safeExpPage} / {totalExpPages}
                  </span>
                  <button
                    type="button"
                    disabled={safeExpPage >= totalExpPages}
                    onClick={() => setExpPage((p) => Math.min(totalExpPages, p + 1))}
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
      )}
    </div>
  );
};

// ============================================================================
// MODULE 9 : GESTION SIMPLIFIÉE DU STOCK & CONSOMMABLES
// ============================================================================
export const InventoryView: React.FC = () => {
  const { user, activeRole, inventory, stockMovements, saveRecord, showToast } = useClinic();
  const [showModal, setShowModal] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [form, setForm] = useState({
    sku: '',
    name: '',
    category: 'Consommables' as InventoryItem['category'],
    unit: 'Boîtes',
    quantity: 10,
    minThreshold: 5,
    unitCost: 100,
    supplier: '',
  });

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingItem) return;
    const safeSku = form.sku.trim().toUpperCase().slice(0, 40);
    const safeName = form.name.trim().slice(0, 150);
    const safeUnit = form.unit.trim().slice(0, 30) || 'Boîtes';
    if (!safeSku || !safeName) {
      showToast('Veuillez renseigner le code SKU et la désignation.', 'error');
      return;
    }
    setSavingItem(true);
    try {
      await saveRecord(
        'inventory',
        generateSafeId('inv'),
        {
          sku: safeSku,
          name: safeName,
          category: form.category,
          unit: safeUnit,
          quantity: Math.max(0, Number(form.quantity) || 0),
          minThreshold: Math.max(0, Number(form.minThreshold) || 0),
          unitCost: Math.max(0, Number(form.unitCost) || 0),
          supplier: form.supplier.trim().slice(0, 120),
          expiryDate: '',
        },
        true
      );
      setForm({
        sku: '',
        name: '',
        category: 'Consommables',
        unit: 'Boîtes',
        quantity: 10,
        minThreshold: 5,
        unitCost: 100,
        supplier: '',
      });
      setShowModal(false);
      showToast('Article ajouté au stock.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'ajout au stock.", 'error');
    } finally {
      setSavingItem(false);
    }
  };

  const adjustStock = async (item: InventoryItem, type: 'Entrée' | 'Sortie', delta: number) => {
    if (!user || busyItemId === item.id) return;
    if (type === 'Sortie' && item.quantity <= 0) {
      showToast(`Stock déjà épuisé pour ${item.name}.`, 'info');
      return;
    }
    setBusyItemId(item.id);
    try {
      const nextQty = Math.max(0, item.quantity + (type === 'Entrée' ? delta : -delta));
      await saveRecord('inventory', item.id, { quantity: nextQty }, false);
      await saveRecord(
        'stockMovements',
        generateSafeId('mvt'),
        {
          itemId: item.id,
          itemName: item.name.slice(0, 150),
          type,
          quantity: Math.max(1, delta),
          reason: type === 'Entrée' ? 'Réception fournisseur' : 'Consommation fauteuil',
          date: todayISO(),
          createdBy: user.uid,
        },
        true
      );
      showToast(`Stock mis à jour (${type} ${delta} ${item.unit}).`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors du mouvement de stock.', 'error');
    } finally {
      setBusyItemId(null);
    }
  };

  if (!canAccessSection(activeRole, 'inventory')) {
    return <AccessDeniedView sectionLabel="Stock & Consommables" />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Stock & Consommables Dentaires</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mouvements manuels d'entrée/sortie et alertes visuelles sous le seuil minimum de réapprovisionnement
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Nouvel Article</span>
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
              <th className="px-4 py-3 font-medium">Réf.</th>
              <th className="px-4 py-3 font-medium">Fourniture</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium text-right">Stock actuel</th>
              <th className="px-4 py-3 font-medium text-right">Seuil alerte</th>
              <th className="px-4 py-3 font-medium">État</th>
              <th className="px-4 py-3 font-medium text-right">Mouvements</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {inventory.map((item) => {
              const isLow = item.quantity <= item.minThreshold;
              return (
                <tr key={item.id} className={isLow ? 'bg-red-50/40 dark:bg-red-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-300">{item.sku}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{item.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{item.category}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {item.minThreshold}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {isLow ? (
                      <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                        <AlertTriangle className="h-3.5 w-3.5" /> Commander
                      </span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400">Nominal</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busyItemId === item.id}
                      onClick={() => void adjustStock(item, 'Entrée', 1)}
                      className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-40"
                    >
                      +1 Entrée
                    </button>
                    <button
                      type="button"
                      disabled={item.quantity <= 0 || busyItemId === item.id}
                      onClick={() => void adjustStock(item, 'Sortie', 1)}
                      className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      -1 Sortie
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {stockMovements.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Derniers Mouvements d'Inventaire</h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {stockMovements.slice(0, 8).map((m) => (
              <div key={m.id} className="py-2 flex justify-between text-slate-700 dark:text-slate-300">
                <span>
                  <strong className={m.type === 'Entrée' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                    {m.type}
                  </strong>{' '}
                  · {m.itemName} ({m.quantity}) — {m.reason}
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">{formatDateFR(m.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Nouvel Article de Stock</h3>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleAddItem} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  placeholder="Code SKU (ex: CONS-09)"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                />
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as InventoryItem['category'] })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  {['Consommables', 'Désinfection', 'Résines & Composites', 'Ciments', 'Anesthésie', 'Implants & Chirurgie', 'Autre'].map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    )
                  )}
                </select>
              </div>
              <input
                required
                placeholder="Désignation de la fourniture"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  placeholder="Qté"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="Seuil min"
                  value={form.minThreshold}
                  onChange={(e) => setForm({ ...form, minThreshold: Number(e.target.value) })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
                <input
                  placeholder="Unité (Boîtes)"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingItem}
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingItem}
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingItem ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ============================================================================
// ÉQUIPE, COMPTES UTILISATEURS (LOGIN / MOT DE PASSE) & RÔLES RBAC
// ============================================================================
export const StaffView: React.FC = () => {
  const {
    user,
    staffProfile,
    activeRole,
    actualRole,
    clinicSettings,
    staffList,
    createStaffAccount,
    setOwnPassword,
    saveRecord,
    removeRecord,
    showToast,
  } = useClinic();
  const chairOptions = useMemo(() => {
    const base = clinicSettings?.chairs?.length ? clinicSettings.chairs : ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3'];
    return Array.from(new Set([...base, 'Accueil', 'Multi-fauteuils']));
  }, [clinicSettings]);

  const [accountForm, setAccountForm] = useState({
    login: '',
    password: '',
    displayName: '',
    role: 'collaborateur' as StaffRole,
    specialty: '',
    chairName: chairOptions[0] || 'Fauteuil 2',
  });
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    displayName: string;
    login: string;
    password: string;
    role: StaffRole;
  } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  const [ownPassword, setOwnPasswordInput] = useState('');
  const [ownPasswordConfirm, setOwnPasswordConfirm] = useState('');
  const [showOwnPassword, setShowOwnPassword] = useState(false);
  const [savingOwnPassword, setSavingOwnPassword] = useState(false);
  const [ownPasswordError, setOwnPasswordError] = useState<string | null>(null);
  const [justLinkedPassword, setJustLinkedPassword] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyStaffId, setBusyStaffId] = useState<string | null>(null);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreatedCredentials(null);
    setCopiedCredentials(false);
    setCreatingAccount(true);
    try {
      const created = await createStaffAccount({
        login: accountForm.login,
        password: accountForm.password,
        displayName: accountForm.displayName,
        role: accountForm.role,
        specialty: accountForm.specialty,
        chairName: accountForm.chairName,
      });
      setCreatedCredentials({
        displayName: accountForm.displayName.trim(),
        login: created.login,
        password: accountForm.password,
        role: accountForm.role,
      });
      setAccountForm({
        login: '',
        password: '',
        displayName: '',
        role: 'collaborateur',
        specialty: '',
        chairName: chairOptions[0] || 'Fauteuil 2',
      });
      showToast(`Compte créé pour ${created.login}.`, 'success');
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Erreur lors de la création du compte.'
      );
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!createdCredentials) return;
    const text = [
      `Accès — Gestion de cabinet dentaire Dr. Sara Bchi`,
      `Utilisateur : ${createdCredentials.displayName} (${ROLE_LABELS[createdCredentials.role]})`,
      `Identifiant (Login) : ${createdCredentials.login}`,
      `Mot de passe : ${createdCredentials.password}`,
      `Lien : ${typeof window !== 'undefined' ? window.location.origin : ''}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCredentials(true);
      setTimeout(() => setCopiedCredentials(false), 2500);
    } catch {
      // Clipboard fallback unavailable
    }
  };

  const handleSaveOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setOwnPasswordError(null);
    if (ownPassword.length < 6) {
      setOwnPasswordError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (ownPassword !== ownPasswordConfirm) {
      setOwnPasswordError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setSavingOwnPassword(true);
    try {
      await setOwnPassword(ownPassword);
      setJustLinkedPassword(true);
      setOwnPasswordInput('');
      setOwnPasswordConfirm('');
    } catch (err) {
      setOwnPasswordError(
        err instanceof Error ? err.message : 'Impossible de mettre à jour votre mot de passe.'
      );
    } finally {
      setSavingOwnPassword(false);
    }
  };

  const handleToggleStaffActive = async (memberId: string, uid: string, currentActive: boolean, displayName: string) => {
    if (actualRole !== 'titulaire' || busyStaffId === memberId) return;
    if (uid === user?.uid) {
      showToast('Vous ne pouvez pas suspendre votre propre compte Titulaire.', 'error');
      return;
    }
    setBusyStaffId(memberId);
    try {
      await saveRecord('staff', memberId, { active: !currentActive }, false);
      showToast(
        !currentActive ? `Accès réactivé pour ${displayName}.` : `Accès suspendu pour ${displayName}.`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la modification du statut.', 'error');
    } finally {
      setBusyStaffId(null);
    }
  };

  const handleUpdateStaffRole = async (memberId: string, uid: string, nextRole: StaffRole, displayName: string) => {
    if (actualRole !== 'titulaire' || uid === user?.uid || busyStaffId === memberId) return;
    setBusyStaffId(memberId);
    try {
      await saveRecord('staff', memberId, { role: nextRole }, false);
      showToast(`Rôle mis à jour pour ${displayName} (${ROLE_LABELS[nextRole]}).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour du rôle.', 'error');
    } finally {
      setBusyStaffId(null);
    }
  };

  const handleUpdateStaffChair = async (memberId: string, nextChair: string) => {
    if (actualRole !== 'titulaire' || busyStaffId === memberId) return;
    setBusyStaffId(memberId);
    try {
      await saveRecord('staff', memberId, { chairName: nextChair.slice(0, 60) }, false);
      showToast(`Fauteuil mis à jour (${nextChair}).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la mise à jour du fauteuil.', 'error');
    } finally {
      setBusyStaffId(null);
    }
  };

  const handleDeleteStaffMember = async (memberId: string, uid: string, displayName: string) => {
    if (actualRole !== 'titulaire' || uid === user?.uid || busyStaffId === memberId) return;
    setBusyStaffId(memberId);
    try {
      await removeRecord('staff', memberId);
      setConfirmDeleteId(null);
      showToast(`Accès supprimé pour ${displayName}.`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la suppression du membre.', 'error');
    } finally {
      setBusyStaffId(null);
    }
  };

  const currentLoginLabel = formatStaffDisplayLogin({
    login: staffProfile?.login,
    email: user?.email || staffProfile?.email || '',
  });
  const hasPasswordLinked =
    justLinkedPassword ||
    Boolean(user?.providerData?.some((p) => p.providerId === 'password'));

  if (!canAccessSection(activeRole, 'staff')) {
    return <AccessDeniedView sectionLabel="Équipe & Accès" />;
  }

  return (
    <div className="space-y-5">
      {/* Création de compte avec Login et Mot de passe */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
            <UserPlus className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
            <span>Créer un accès utilisateur (Login &amp; Mot de passe)</span>
          </div>
        </div>

        <form onSubmit={handleCreateAccount} className="space-y-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Créez un identifiant personnel (ex : <code className="font-mono">dr.amine</code> ou{' '}
              <code className="font-mono">amina.accueil</code> ou une adresse email) et un mot de passe pour chaque membre du cabinet.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <input
                required
                placeholder="Nom complet (ex : Dr. Amine)"
                value={accountForm.displayName}
                onChange={(e) => setAccountForm({ ...accountForm, displayName: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />
              <input
                required
                type="text"
                placeholder="Identifiant ou Email (ex : dr.amine)"
                value={accountForm.login}
                onChange={(e) => setAccountForm({ ...accountForm, login: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
              />
              <div className="relative flex items-center md:col-span-2 gap-1.5">
                <div className="relative flex-1">
                  <input
                    required
                    minLength={6}
                    type={showCreatePassword ? 'text' : 'password'}
                    placeholder="Mot de passe (min. 6 car.)"
                    value={accountForm.password}
                    onChange={(e) => setAccountForm({ ...accountForm, password: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 pl-3 pr-8 py-2 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((prev) => !prev)}
                    aria-label={showCreatePassword ? 'Masquer' : 'Afficher'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showCreatePassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAccountForm((prev) => ({
                      ...prev,
                      password: generateSecurePassword(10),
                    }));
                    setShowCreatePassword(true);
                  }}
                  title="Générer un mot de passe aléatoire"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Générer</span>
                </button>
              </div>
              <select
                value={accountForm.role}
                onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value as StaffRole })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              >
                <option value="titulaire">Praticien Titulaire</option>
                <option value="collaborateur">Praticien Collaborateur</option>
                <option value="secretaire">Secrétaire / Accueil</option>
                <option value="assistant">Assistant(e) Dentaire</option>
              </select>
              <select
                value={accountForm.chairName}
                onChange={(e) => setAccountForm({ ...accountForm, chairName: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              >
                {chairOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <input
                placeholder="Spécialité (optionnel, ex : Orthodontie, Endodontie)"
                value={accountForm.specialty}
                onChange={(e) => setAccountForm({ ...accountForm, specialty: e.target.value })}
                className="w-full sm:w-80 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />
              <button
                type="submit"
                disabled={creatingAccount}
                className="inline-flex items-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 transition-colors"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>
                  {creatingAccount ? 'Création en cours...' : 'Créer le compte utilisateur'}
                </span>
              </button>
            </div>

            {createError && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-[11px] text-red-800 dark:text-red-200 leading-relaxed space-y-2">
                <p>{createError}</p>
                {createError.includes('console Firebase') && (
                  <a
                    href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 dark:bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-800 dark:hover:bg-red-500 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Activer Adresse e-mail/Mot de passe dans Firebase Console</span>
                  </a>
                )}
              </div>
            )}

            {createdCredentials && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/90 dark:bg-emerald-950/40 p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>
                      Compte prêt pour {createdCredentials.displayName} ({ROLE_LABELS[createdCredentials.role]})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyCredentials}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                    >
                      {copiedCredentials ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedCredentials ? 'Copié !' : 'Copier les identifiants'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreatedCredentials(null)}
                      aria-label="Fermer"
                      className="rounded-lg p-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 px-3 py-1.5 border border-emerald-200/80 dark:border-emerald-800/70">
                    <span className="text-slate-500 dark:text-slate-400">Identifiant : </span>
                    <strong className="font-mono">{createdCredentials.login}</strong>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-slate-900/70 px-3 py-1.5 border border-emerald-200/80 dark:border-emerald-800/70">
                    <span className="text-slate-500 dark:text-slate-400">Mot de passe : </span>
                    <strong className="font-mono">{createdCredentials.password}</strong>
                  </div>
                </div>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                  Notez ou copiez ce mot de passe maintenant pour le remettre au collaborateur (il n'est jamais stocké en clair dans la base).
                </p>
              </div>
            )}
            </form>
      </div>

      {/* Mon accès par mot de passe (permet aussi au Titulaire connecté via Google de définir son mot de passe) */}
      <form
        onSubmit={handleSaveOwnPassword}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <KeyRound className="h-4 w-4 text-[#1598C7] dark:text-sky-400 shrink-0" />
            <span>
              {hasPasswordLinked
                ? 'Modifier mon mot de passe de connexion'
                : 'Définir un mot de passe pour mon compte'}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Identifiant : <strong className="font-mono text-slate-800 dark:text-slate-200">{currentLoginLabel}</strong>
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          <div className="relative">
            <input
              type={showOwnPassword ? 'text' : 'password'}
              minLength={6}
              required
              placeholder="Nouveau mot de passe (min. 6 car.)"
              value={ownPassword}
              onChange={(e) => setOwnPasswordInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 pl-3 pr-9 py-2"
            />
            <button
              type="button"
              onClick={() => setShowOwnPassword((prev) => !prev)}
              aria-label={showOwnPassword ? 'Masquer' : 'Afficher'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {showOwnPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <input
            type={showOwnPassword ? 'text' : 'password'}
            minLength={6}
            required
            placeholder="Confirmer le mot de passe"
            value={ownPasswordConfirm}
            onChange={(e) => setOwnPasswordConfirm(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
          />
          <button
            type="submit"
            disabled={savingOwnPassword}
            className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-4 py-2 font-semibold text-[#163B63] dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 disabled:opacity-60 transition-colors"
          >
            {savingOwnPassword
              ? 'Enregistrement...'
              : hasPasswordLinked
              ? 'Mettre à jour mon mot de passe'
              : 'Activer mon mot de passe'}
          </button>
        </div>
        {ownPasswordError && (
          <p className="text-[11px] text-red-600 dark:text-red-400">{ownPasswordError}</p>
        )}
      </form>

      {/* Tableau des Membres Actifs */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Membres du Cabinet ({staffList.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Identifiant / Email</th>
                <th className="px-4 py-3 font-medium">Rôle RBAC</th>
                <th className="px-4 py-3 font-medium">Spécialité &amp; Fauteuil</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                {actualRole === 'titulaire' && <th className="px-4 py-3 font-medium text-right">Gestion</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {staffList.map((s) => {
                const displayLogin = formatStaffDisplayLogin(s);
                const isSelf = s.uid === user?.uid;
                return (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {s.displayName}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                          {displayLogin}
                        </span>
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          {s.inviteId === 'direct' ? 'Login/Mdp' : 'Google'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-sky-800 dark:text-sky-400">
                      {actualRole === 'titulaire' && !isSelf ? (
                        <select
                          aria-label={`Rôle de ${s.displayName}`}
                          disabled={busyStaffId === s.id}
                          value={s.role}
                          onChange={(e) =>
                            void handleUpdateStaffRole(
                              s.id,
                              s.uid,
                              e.target.value as StaffRole,
                              s.displayName
                            )
                          }
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-sky-800 dark:text-sky-300 disabled:opacity-60"
                        >
                          <option value="titulaire">Praticien Titulaire</option>
                          <option value="collaborateur">Praticien Collaborateur</option>
                          <option value="secretaire">Secrétaire / Accueil</option>
                          <option value="assistant">Assistant(e) Dentaire</option>
                        </select>
                      ) : (
                        ROLE_LABELS[s.role]
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{s.specialty || '—'}</span>
                        {actualRole === 'titulaire' ? (
                          <select
                            disabled={busyStaffId === s.id}
                            value={s.chairName || chairOptions[0]}
                            onChange={(e) => void handleUpdateStaffChair(s.id, e.target.value)}
                            className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200 disabled:opacity-60"
                          >
                            {Array.from(new Set([...chairOptions, ...(s.chairName ? [s.chairName] : [])])).map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>· {s.chairName || '—'}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className={s.active ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                        {s.active ? 'Actif' : 'Suspendu'}
                      </span>
                    </td>
                    {actualRole === 'titulaire' && (
                      <td className="px-4 py-3 text-right">
                        {!isSelf ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyStaffId === s.id}
                              onClick={() => void handleToggleStaffActive(s.id, s.uid, s.active, s.displayName)}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                                s.active
                                  ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
                                  : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                              }`}
                            >
                              {s.active ? 'Suspendre' : 'Réactiver'}
                            </button>
                            {confirmDeleteId === s.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busyStaffId === s.id}
                                  onClick={() => void handleDeleteStaffMember(s.id, s.uid, s.displayName)}
                                  className="rounded-lg bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-60"
                                >
                                  Confirmer
                                </button>
                                <button
                                  type="button"
                                  disabled={busyStaffId === s.id}
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 disabled:opacity-60"
                                >
                                  Annuler
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={busyStaffId === s.id}
                                onClick={() => setConfirmDeleteId(s.id)}
                                title="Supprimer l'accès"
                                className="rounded-lg border border-red-200 dark:border-red-900/60 p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Titulaire principal</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// RAPPORTS & INDICATEURS DIRECTIONNELS (KPIs)
// ============================================================================
export { ReportsView } from './ReportsView';

// ============================================================================
// PARAMÈTRES DU CABINET
// ============================================================================
export const SettingsView: React.FC = () => {
  const {
    activeRole,
    clinicSettings,
    patients,
    appointments,
    recalls,
    saveRecord,
    runDueSmsReminders,
    checkServerConnection,
    logActivity,
    showToast,
  } = useClinic();
  const initialSms = resolveSmsReminderSettings(clinicSettings);
  const { isFullscreen, isNativeFullscreen, isExpanded, toggleFullscreen, toggleExpanded } =
    useFullscreen();
  const [activeTab, setActiveTab] = useState<'general' | 'sms'>('general');
  const [sendingNow, setSendingNow] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingWhatsAppTest, setSendingWhatsAppTest] = useState(false);
  const [verifyingGateways, setVerifyingGateways] = useState(false);
  const [gatewayVerifyReport, setGatewayVerifyReport] =
    useState<GatewayVerificationReport | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [checkingDiagnostics, setCheckingDiagnostics] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealthReport | null>(null);
  const [firestoreCheck, setFirestoreCheck] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  } | null>(null);
  const [testPatientId, setTestPatientId] = useState<string>('');
  const [testPhone, setTestPhone] = useState<string>(
    clinicSettings?.phone || '+212 661 00 00 00'
  );
  const [testResult, setTestResult] = useState<{
    channel: 'SMS' | 'WhatsApp';
    phone: string;
    patientName: string;
    message: string;
    sentAt: string;
    segments: number;
    mode: string;
    delivered: boolean;
    providerId?: string | null;
    waUrl?: string | null;
    detail?: string;
  } | null>(null);
  const [form, setForm] = useState({
    clinicName: clinicSettings?.clinicName || 'Cabinet Dentaire Dr. Sara Bchi',
    subtitle: clinicSettings?.subtitle || 'Chirurgien - Dentiste',
    address: clinicSettings?.address || '',
    phone: clinicSettings?.phone || '+212 532 101 351',
    email: clinicSettings?.email || '',
    ice: clinicSettings?.ice || '',
    ifNumber: clinicSettings?.ifNumber || '',
    patente: clinicSettings?.patente || '',
    inpe: clinicSettings?.inpe || '',
    chairsText: (clinicSettings?.chairs || ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3']).join(', '),
    start: clinicSettings?.workingHours?.start || '09:00',
    lunchStart: clinicSettings?.workingHours?.lunchStart || '13:00',
    lunchEnd: clinicSettings?.workingHours?.lunchEnd || '15:00',
    end: clinicSettings?.workingHours?.end || '18:00',
    saturdayStart: clinicSettings?.workingHours?.saturdayStart || '09:00',
    saturdayEnd: clinicSettings?.workingHours?.saturdayEnd || '13:00',
    smsEnabled: initialSms.enabled,
    smsHoursBefore: initialSms.hoursBefore,
    smsTemplate: initialSms.template,
  });

  useEffect(() => {
    if (!clinicSettings) return;
    const resolvedSms = resolveSmsReminderSettings(clinicSettings);
    setForm({
      clinicName: clinicSettings.clinicName || 'Cabinet Dentaire Dr. Sara Bchi',
      subtitle: clinicSettings.subtitle || 'Chirurgien - Dentiste',
      address: clinicSettings.address || '',
      phone: clinicSettings.phone || '+212 532 101 351',
      email: clinicSettings.email || '',
      ice: clinicSettings.ice || '',
      ifNumber: clinicSettings.ifNumber || '',
      patente: clinicSettings.patente || '',
      inpe: clinicSettings.inpe || '',
      chairsText: (clinicSettings.chairs || ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3']).join(', '),
      start: clinicSettings.workingHours?.start || '09:00',
      lunchStart: clinicSettings.workingHours?.lunchStart || '13:00',
      lunchEnd: clinicSettings.workingHours?.lunchEnd || '15:00',
      end: clinicSettings.workingHours?.end || '18:00',
      saturdayStart: clinicSettings.workingHours?.saturdayStart || '09:00',
      saturdayEnd: clinicSettings.workingHours?.saturdayEnd || '13:00',
      smsEnabled: resolvedSms.enabled,
      smsHoursBefore: resolvedSms.hoursBefore,
      smsTemplate: resolvedSms.template,
    });
    if (clinicSettings.phone) {
      setTestPhone((prev) =>
        !prev || prev === '+212 661 00 00 00' ? clinicSettings.phone! : prev
      );
    }
  }, [clinicSettings]);

  const dueSmsAppointments = useMemo(() => {
    const now = new Date();
    const hours = Math.max(1, Math.min(72, Number(form.smsHoursBefore) || 24));
    return appointments.filter((apt) => {
      if (!isAppointmentDueForSmsReminder(apt, hours, now)) return false;
      return !recalls.some(
        (r) => r.channel === 'SMS' && (r.notes || '').includes(`[RDV:${apt.id}]`)
      );
    });
  }, [appointments, recalls, form.smsHoursBefore]);

  const selectedTestPatient = useMemo(
    () => patients.find((p) => p.id === testPatientId) || null,
    [patients, testPatientId]
  );

  const selectedTestPatientName = selectedTestPatient
    ? `${selectedTestPatient.firstName} ${selectedTestPatient.lastName}`.trim()
    : '';

  const smsPreview = useMemo(
    () =>
      formatSmsReminderMessage(
        form.smsTemplate,
        {
          patientName: selectedTestPatientName || 'Kenza El Fassi',
          date: todayISO(),
          startTime: '10:30',
          actType: 'Consultation de contrôle',
          practitionerName: 'Dr. Sara Bchi',
        },
        {
          ...(clinicSettings || {
            id: 'clinic',
            clinicName: form.clinicName,
            currency: 'MAD',
            chairs: ['Fauteuil 1'],
            invoiceCounter: 0,
            quoteCounter: 0,
            receiptCounter: 0,
          }),
          clinicName: form.clinicName || 'Cabinet Dentaire Dr. Sara Bchi',
          phone: form.phone || '+212 532 101 351',
        }
      ),
    [form.smsTemplate, form.clinicName, form.phone, clinicSettings, selectedTestPatientName]
  );

  const smsSegmentCount = Math.max(1, Math.ceil(smsPreview.length / 160));

  const runFullDiagnostics = async (silent = false) => {
    setCheckingDiagnostics(true);
    try {
      const [health, fsRes] = await Promise.all([
        fetchSystemHealth(),
        checkServerConnection(),
      ]);
      setSystemHealth(health);
      setFirestoreCheck(fsRes);
      if (!silent) {
        if (health?.ok && fsRes.ok) {
          showToast(`Consoles connectées · Firestore ${fsRes.latencyMs} ms`, 'success');
        } else {
          showToast(
            fsRes.error || 'Vérification terminée : consultez les statuts ci-dessous.',
            'info'
          );
        }
      }
    } finally {
      setCheckingDiagnostics(false);
    }
  };

  useEffect(() => {
    void fetchSystemHealth().then(setSystemHealth);
  }, []);

  const handleSelectTestPatient = (patientId: string) => {
    setTestPatientId(patientId);
    const pat = patients.find((p) => p.id === patientId);
    if (pat?.phone) {
      setTestPhone(pat.phone);
    }
  };

  const handleSendTestSms = async () => {
    const cleanedPhone = testPhone.trim();
    if (cleanedPhone.replace(/\D/g, '').length < 6) {
      showToast('Veuillez saisir un numéro de téléphone valide pour le test.', 'error');
      return;
    }
    setSendingTest(true);
    try {
      const targetName = selectedTestPatientName || 'Patient Test';
      const gwRes = await sendSmsViaGateway({
        to: cleanedPhone,
        message: smsPreview,
        patientName: targetName,
        clinicName: form.clinicName || clinicSettings?.clinicName,
      });
      const nowTime = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      if (!gwRes.ok) {
        showToast(gwRes.error || "Erreur lors du test d'envoi SMS.", 'error');
        return;
      }
      setTestResult({
        channel: 'SMS',
        phone: cleanedPhone,
        patientName: targetName,
        message: smsPreview,
        sentAt: nowTime,
        segments: smsSegmentCount,
        mode: gwRes.mode,
        delivered: gwRes.delivered,
        providerId: gwRes.providerId,
        detail: gwRes.detail,
      });
      logActivity({
        category: 'administration',
        title: gwRes.delivered
          ? `Test SMS réel envoyé (${gwRes.mode})`
          : "Test d'envoi SMS effectué (mode test)",
        detail: `Destinataire : ${cleanedPhone} (${targetName}) · ${smsPreview}`,
        section: 'settings',
      });
      showToast(
        gwRes.delivered
          ? `SMS réel expédié vers ${cleanedPhone} (${gwRes.mode}).`
          : `Test vérifié pour ${cleanedPhone} (passerelle en mode simulation).`,
        'success'
      );
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendTestWhatsApp = async () => {
    const cleanedPhone = testPhone.trim();
    if (cleanedPhone.replace(/\D/g, '').length < 6) {
      showToast('Veuillez saisir un numéro WhatsApp valide pour le test.', 'error');
      return;
    }
    setSendingWhatsAppTest(true);
    try {
      const targetName = selectedTestPatientName || 'Patient Test';
      const gwRes = await sendWhatsAppViaGateway({
        to: cleanedPhone,
        message: smsPreview,
        patientName: targetName,
        appointmentDate: formatDateFR(todayISO()),
        appointmentTime: '10:30',
        actType: 'Consultation de contrôle',
        clinicName: form.clinicName || clinicSettings?.clinicName,
      });
      const nowTime = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      if (!gwRes.ok) {
        showToast(gwRes.error || "Erreur lors du test d'envoi WhatsApp.", 'error');
        return;
      }
      setTestResult({
        channel: 'WhatsApp',
        phone: cleanedPhone,
        patientName: targetName,
        message: smsPreview,
        sentAt: nowTime,
        segments: smsSegmentCount,
        mode: gwRes.mode,
        delivered: gwRes.delivered,
        providerId: gwRes.providerId,
        waUrl: gwRes.waUrl,
        detail: gwRes.detail,
      });
      logActivity({
        category: 'administration',
        title: gwRes.delivered
          ? `Test WhatsApp Business réel envoyé (${gwRes.mode})`
          : 'Test WhatsApp généré (lien direct wa.me)',
        detail: `Destinataire : ${cleanedPhone} (${targetName}) · ${smsPreview}`,
        section: 'settings',
      });
      showToast(
        gwRes.delivered
          ? `Message WhatsApp réel expédié vers ${cleanedPhone} via Meta Cloud API.`
          : `Lien WhatsApp prêt pour ${cleanedPhone} (API Meta non encore configurée).`,
        'success'
      );
    } finally {
      setSendingWhatsAppTest(false);
    }
  };

  const handleVerifyGateways = async () => {
    setVerifyingGateways(true);
    try {
      const report = await verifyMessagingGateways();
      if (!report) {
        showToast('Impossible de vérifier les passerelles serveur pour le moment.', 'error');
        return;
      }
      setGatewayVerifyReport(report);
      setSystemHealth((prev) =>
        prev
          ? {
              ...prev,
              smsGateway: report.smsGateway,
              whatsappGateway: report.whatsappGateway,
            }
          : prev
      );
      if (report.twilio.reachable && report.metaWhatsApp.reachable) {
        showToast('Twilio SMS et Meta WhatsApp Cloud API vérifiés avec succès.', 'success');
      } else if (report.twilio.reachable || report.metaWhatsApp.reachable) {
        showToast('Vérification terminée : une passerelle est active, consultez les détails ci-dessous.', 'info');
      } else {
        showToast('Variables Twilio / Meta manquantes ou invalides côté serveur.', 'info');
      }
    } finally {
      setVerifyingGateways(false);
    }
  };

  const handleTriggerSmsNow = async () => {
    if (sendingNow) return;
    setSendingNow(true);
    try {
      const count = await runDueSmsReminders(true);
      showToast(
        count > 0 ? `${count} rappel(s) SMS envoyé(s).` : 'Aucun rappel SMS en attente dans cette fenêtre.',
        count > 0 ? 'success' : 'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'envoi des rappels SMS.", 'error');
    } finally {
      setSendingNow(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSettings) return;
    if (!form.clinicName.trim()) {
      setActiveTab('general');
      showToast('Veuillez renseigner le nom du cabinet.', 'error');
      return;
    }
    const chairs = form.chairsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    setSavingSettings(true);
    try {
      await saveRecord(
        'settings',
        'clinic',
        {
          clinicName: form.clinicName.trim().slice(0, 150),
          subtitle: form.subtitle.trim().slice(0, 150),
          address: form.address.trim().slice(0, 250),
          phone: form.phone.trim().slice(0, 40),
          email: form.email.trim().slice(0, 150),
          ice: form.ice.trim().slice(0, 40),
          ifNumber: form.ifNumber.trim().slice(0, 40),
          patente: form.patente.trim().slice(0, 40),
          inpe: form.inpe.trim().slice(0, 40),
          currency: 'MAD',
          chairs: chairs.length > 0 ? chairs : ['Fauteuil 1'],
          workingHours: {
            start: form.start || '09:00',
            end: form.end || '18:00',
            lunchStart: form.lunchStart || '13:00',
            lunchEnd: form.lunchEnd || '15:00',
            saturdayStart: form.saturdayStart || '09:00',
            saturdayEnd: form.saturdayEnd || '13:00',
          },
          smsReminders: {
            enabled: form.smsEnabled,
            hoursBefore: Math.max(1, Math.min(72, Number(form.smsHoursBefore) || 24)),
            template:
              form.smsTemplate.trim().slice(0, 260) || DEFAULT_SMS_REMINDER_SETTINGS.template,
          },
          ...(!clinicSettings
            ? {
                invoiceCounter: 0,
                quoteCounter: 0,
                receiptCounter: 0,
                betaZeroInitialized: true,
              }
            : {}),
        },
        !clinicSettings
      );
      showToast(
        activeTab === 'sms'
          ? 'Paramètres SMS enregistrés.'
          : 'Paramètres du cabinet enregistrés.',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement des paramètres.", 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  if (!canAccessSection(activeRole, 'settings')) {
    return <AccessDeniedView sectionLabel="Paramètres du Cabinet" />;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div
        role="tablist"
        aria-label="Sections des paramètres"
        className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900 p-1 gap-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'general'}
          onClick={() => setActiveTab('general')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'general'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span>Paramètres du Cabinet</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sms'}
          onClick={() => setActiveTab('sms')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'sms'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span>SMS &amp; WhatsApp</span>
          {dueSmsAppointments.length > 0 && (
            <span className="font-mono tabular-nums text-[11px] text-[#1598C7] dark:text-sky-400">
              ({dueSmsAppointments.length})
            </span>
          )}
        </button>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5 text-xs"
      >
        {activeTab === 'general' ? (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Paramètres du Cabinet & Identifiants Fiscaux
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nom du cabinet
                </label>
                <input
                  value={form.clinicName}
                  onChange={(e) => setForm({ ...form, clinicName: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Sous-titre / Spécialité
                </label>
                <input
                  value={form.subtitle}
                  onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Téléphone
                </label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email
                </label>
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Adresse complète
              </label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-3">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                Horaires de consultation sur rendez-vous
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Lun–Ven ouverture
                  </label>
                  <input
                    type="time"
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Pause début
                  </label>
                  <input
                    type="time"
                    value={form.lunchStart}
                    onChange={(e) => setForm({ ...form, lunchStart: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Reprise après-midi
                  </label>
                  <input
                    type="time"
                    value={form.lunchEnd}
                    onChange={(e) => setForm({ ...form, lunchEnd: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Lun–Ven fermeture
                  </label>
                  <input
                    type="time"
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Samedi ouverture
                  </label>
                  <input
                    type="time"
                    value={form.saturdayStart}
                    onChange={(e) => setForm({ ...form, saturdayStart: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Samedi fermeture
                  </label>
                  <input
                    type="time"
                    value={form.saturdayEnd}
                    onChange={(e) => setForm({ ...form, saturdayEnd: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                placeholder="ICE"
                value={form.ice}
                onChange={(e) => setForm({ ...form, ice: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
              />
              <input
                placeholder="Identifiant Fiscal (IF)"
                value={form.ifNumber}
                onChange={(e) => setForm({ ...form, ifNumber: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
              />
              <input
                placeholder="Patente"
                value={form.patente}
                onChange={(e) => setForm({ ...form, patente: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
              />
              <input
                placeholder="Code INPE"
                value={form.inpe}
                onChange={(e) => setForm({ ...form, inpe: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Fauteuils cliniques (séparés par des virgules)
              </label>
              <input
                value={form.chairsText}
                onChange={(e) => setForm({ ...form, chairsText: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-start gap-2.5">
                <MessageSquare className="h-4 w-4 text-[#1598C7] dark:text-sky-400 mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Configuration des rappels SMS
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Personnalisez le modèle de rappel automatique et testez l'envoi avant activation
                  </p>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer select-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5">
                <input
                  type="checkbox"
                  checked={form.smsEnabled}
                  onChange={(e) => setForm({ ...form, smsEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {form.smsEnabled ? 'Rappels activés' : 'Rappels désactivés'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Délai avant rendez-vous (heures)
                </label>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={form.smsHoursBefore}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      smsHoursBefore: Math.max(1, Math.min(72, Number(e.target.value) || 24)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono tabular-nums"
                />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Recommandé : 24h avant l'heure du rendez-vous. Chaque envoi est archivé dans la fiche patient.
                </p>
              </div>

              <div className="sm:col-span-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300">
                    Modèle du message de rappel
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, smsTemplate: DEFAULT_SMS_REMINDER_SETTINGS.template })
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Réinitialiser le modèle</span>
                  </button>
                </div>

                <textarea
                  rows={3}
                  maxLength={250}
                  value={form.smsTemplate}
                  onChange={(e) => setForm({ ...form, smsTemplate: e.target.value })}
                  placeholder={DEFAULT_SMS_REMINDER_SETTINGS.template}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs leading-relaxed"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Variables :</span>
                    {['{patient}', '{date}', '{heure}', '{acte}', '{praticien}', '{cabinet}', '{tel}'].map(
                      (token) => (
                        <button
                          key={token}
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              smsTemplate: `${prev.smsTemplate}${prev.smsTemplate.endsWith(' ') || prev.smsTemplate.length === 0 ? '' : ' '}${token}`.slice(
                                0,
                                250
                              ),
                            }))
                          }
                          className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          {token}
                        </button>
                      )
                    )}
                  </div>
                  <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {smsPreview.length} car. · {smsSegmentCount} SMS
                  </span>
                </div>
              </div>
            </div>

            {/* Aperçu en direct */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3.5 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Aperçu du SMS généré
              </p>
              <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                {smsPreview}
              </p>
            </div>

            {/* Test d'envoi SMS & WhatsApp */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-4 space-y-3">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Test d'envoi direct (Twilio SMS &amp; Meta WhatsApp)
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Testez l'expédition réelle SMS (Twilio) ou WhatsApp (Meta Cloud API) sur un numéro sans impacter les rappels planifiés
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Patient exemple (optionnel)
                  </label>
                  <select
                    value={testPatientId}
                    onChange={(e) => handleSelectTestPatient(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
                  >
                    <option value="">Patient Test (Kenza El Fassi)</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName} {p.phone ? `(${p.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Numéro de téléphone de test
                  </label>
                  <input
                    type="tel"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="+212 6XX XX XX XX"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono text-xs"
                  />
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="button"
                    disabled={sendingTest || sendingWhatsAppTest}
                    onClick={handleSendTestSms}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1598C7] hover:bg-[#117fa7] px-3 py-2 text-xs font-medium text-white disabled:opacity-60 whitespace-nowrap"
                  >
                    <Send className="h-3.5 w-3.5 shrink-0" />
                    <span>{sendingTest ? 'SMS...' : 'Tester SMS'}</span>
                  </button>
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="button"
                    disabled={sendingWhatsAppTest || sendingTest}
                    onClick={handleSendTestWhatsApp}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-60 whitespace-nowrap"
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{sendingWhatsAppTest ? 'Meta...' : 'Tester WA'}</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div
                  className={`rounded-lg border p-3 space-y-1.5 ${
                    testResult.delivered
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 font-semibold ${
                        testResult.delivered
                          ? 'text-emerald-800 dark:text-emerald-300'
                          : 'text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {testResult.delivered
                          ? `${testResult.channel} réel envoyé (${testResult.mode}) vers ${testResult.phone}`
                          : `Test ${testResult.channel} vérifié (${testResult.mode}) pour ${testResult.phone}`}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                      {testResult.sentAt} · {testResult.segments} seg.
                      {testResult.providerId ? ` · Réf ${testResult.providerId}` : ''}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-800 dark:text-slate-200 leading-relaxed">
                    {testResult.message}
                  </p>
                  {testResult.detail && (
                    <p className="text-[11px] text-amber-800 dark:text-amber-300">
                      {testResult.detail}
                    </p>
                  )}
                  {testResult.waUrl && (
                    <a
                      href={testResult.waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span>Ouvrir le lien WhatsApp généré (wa.me)</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Configuration Twilio & Meta WhatsApp Business Cloud API (Variables serveur sécurisées) */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Passerelles Opérateur : Twilio SMS &amp; Meta WhatsApp Cloud API
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Par sécurité, vos jetons et secrets API sont lus uniquement côté serveur (Variables d'environnement / Secrets).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={verifyingGateways}
                  onClick={() => void handleVerifyGateways()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${verifyingGateways ? 'animate-spin' : ''}`} />
                  <span>{verifyingGateways ? 'Vérification...' : 'Vérifier Twilio & Meta'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Twilio Checklist */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      1. Twilio SMS
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        systemHealth?.smsGateway.provider === 'twilio'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {systemHealth?.smsGateway.provider === 'twilio'
                        ? 'Actif côté serveur'
                        : 'En attente de clés'}
                    </span>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    {[
                      {
                        key: 'TWILIO_ACCOUNT_SID',
                        ok: Boolean(systemHealth?.smsGateway.envChecklist?.accountSid),
                        note: 'ACxxxxxxxx...',
                      },
                      {
                        key: 'TWILIO_AUTH_TOKEN',
                        ok: Boolean(systemHealth?.smsGateway.envChecklist?.authToken),
                        note: 'Secret Twilio Console',
                      },
                      {
                        key: 'TWILIO_FROM_NUMBER',
                        ok: Boolean(systemHealth?.smsGateway.envChecklist?.senderNumberOrService),
                        note: '+212... ou TWILIO_MESSAGING_SERVICE_SID',
                      },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center justify-between gap-2">
                        <code className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                          {item.key}
                        </code>
                        <span
                          className={`text-[10px] font-medium whitespace-nowrap ${
                            item.ok
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {item.ok ? '✓ Configurée' : `Manquante (${item.note})`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {gatewayVerifyReport?.twilio && (
                    <p
                      className={`text-[11px] pt-1 border-t border-slate-200/70 dark:border-slate-700/60 ${
                        gatewayVerifyReport.twilio.reachable
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {gatewayVerifyReport.twilio.reachable
                        ? `Connecté : ${gatewayVerifyReport.twilio.accountName} (${gatewayVerifyReport.twilio.accountStatus} · ${gatewayVerifyReport.twilio.accountType})`
                        : gatewayVerifyReport.twilio.error ||
                          'Ajoutez vos 3 variables Twilio dans Secrets puis cliquez sur Vérifier.'}
                    </p>
                  )}
                </div>

                {/* Meta WhatsApp Checklist */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      2. Meta WhatsApp Cloud API
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        systemHealth?.whatsappGateway?.provider === 'whatsapp_cloud_api'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {systemHealth?.whatsappGateway?.provider === 'whatsapp_cloud_api'
                        ? 'Actif côté serveur'
                        : 'En attente de clés'}
                    </span>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    {[
                      {
                        key: 'WHATSAPP_BUSINESS_TOKEN',
                        ok: Boolean(systemHealth?.whatsappGateway?.envChecklist?.accessToken),
                        note: 'Token System User Meta',
                      },
                      {
                        key: 'WHATSAPP_PHONE_NUMBER_ID',
                        ok: Boolean(systemHealth?.whatsappGateway?.envChecklist?.phoneNumberId),
                        note: 'ID numéro WhatsApp Business',
                      },
                      {
                        key: 'WHATSAPP_TEMPLATE_NAME',
                        ok: Boolean(systemHealth?.whatsappGateway?.envChecklist?.templateName),
                        note: 'Optionnel (ex. hello_world)',
                      },
                      {
                        key: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
                        ok: Boolean(systemHealth?.whatsappGateway?.envChecklist?.webhookVerifyToken),
                        note: 'Optionnel (Webhook Meta)',
                      },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center justify-between gap-2">
                        <code className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                          {item.key}
                        </code>
                        <span
                          className={`text-[10px] font-medium whitespace-nowrap ${
                            item.ok
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {item.ok ? '✓ Configurée' : item.note}
                        </span>
                      </div>
                    ))}
                  </div>
                  {gatewayVerifyReport?.metaWhatsApp && (
                    <p
                      className={`text-[11px] pt-1 border-t border-slate-200/70 dark:border-slate-700/60 ${
                        gatewayVerifyReport.metaWhatsApp.reachable
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {gatewayVerifyReport.metaWhatsApp.reachable
                        ? `Connecté : ${gatewayVerifyReport.metaWhatsApp.verifiedName} (${gatewayVerifyReport.metaWhatsApp.displayPhoneNumber || 'numéro vérifié'})`
                        : gatewayVerifyReport.metaWhatsApp.error ||
                          'Ajoutez WHATSAPP_BUSINESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID dans Secrets.'}
                    </p>
                  )}
                </div>
              </div>

              {typeof window !== 'undefined' && (() => {
                const isPrivateDevPreview = window.location.origin.includes('://ais-dev-');
                const publicOrigin = isPrivateDevPreview
                  ? window.location.origin.replace('://ais-dev-', '://ais-pre-')
                  : window.location.origin;
                const publicWebhookUrl = `${publicOrigin}/api/whatsapp/webhook`;
                return (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5 space-y-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          URL publique Callback Webhook Meta WhatsApp :{' '}
                        </span>
                        <code className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                          {publicWebhookUrl}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(publicWebhookUrl).then(() => {
                            showToast('URL publique Webhook Meta copiée.', 'success');
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copier URL publique</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {isPrivateDevPreview
                        ? "L’URL privée ais-dev-... est protégée par connexion Google et bloquée pour Meta : publiez/partagez l’application (bouton Share) pour activer l’URL publique ais-pre-... ci-dessus. Note : l’envoi sortant SMS (Twilio) et WhatsApp (Meta) fonctionne sans Webhook."
                        : "Note : le Webhook est optionnel et sert uniquement à recevoir les accusés/réponses entrants depuis Meta."}
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Envoi groupé des rappels dus */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  File des rappels automatiques ({form.smsHoursBefore}h avant RDV)
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {dueSmsAppointments.length === 0
                    ? 'Aucun rendez-vous en attente de rappel dans cette fenêtre.'
                    : `${dueSmsAppointments.length} rendez-vous éligible${dueSmsAppointments.length > 1 ? 's' : ''} prêt${dueSmsAppointments.length > 1 ? 's' : ''} pour l'envoi.`}
                </p>
              </div>
              <button
                type="button"
                disabled={sendingNow}
                onClick={handleTriggerSmsNow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/60 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {sendingNow
                    ? 'Envoi en cours...'
                    : `Envoyer rappels dus (${dueSmsAppointments.length})`}
                </span>
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 self-center">
            {activeTab === 'general'
              ? "Les paramètres fiscaux et horaires s'appliquent à l'ensemble du cabinet."
              : "Les modifications du modèle s'appliquent aux prochains rappels automatiques."}
          </span>
          <button
            type="submit"
            disabled={savingSettings}
            className="rounded-lg bg-sky-600 px-5 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60 whitespace-nowrap"
          >
            {savingSettings ? 'Enregistrement...' : 'Enregistrer les paramètres'}
          </button>
        </div>
      </form>

      {/* Affichage & Espace de travail (Plein écran) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-sky-50 dark:bg-sky-950/60 p-2 text-[#1598C7] dark:text-sky-400 shrink-0">
              <Monitor className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                Affichage &amp; Espace de travail (Plein écran)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Maximisez la surface utile sur tablette et PC en masquant les barres du navigateur et en étendant l'espace de travail sur toute la largeur de l'écran.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-pressed={isFullscreen}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors whitespace-nowrap shrink-0 ${
              isFullscreen
                ? 'bg-[#163B63] dark:bg-sky-600 text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500'
                : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Quitter le mode Plein écran</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Activer le mode Plein écran</span>
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            État actuel :{' '}
            <strong
              className={
                isFullscreen
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-700 dark:text-slate-300'
              }
            >
              {isNativeFullscreen
                ? 'Plein écran natif actif'
                : isExpanded
                ? 'Espace de travail pleine largeur actif'
                : 'Mode standard (largeur encadrée)'}
            </strong>
          </span>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[11px] text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={isExpanded}
              onChange={toggleExpanded}
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            <span>Toujours maximiser la largeur de l'espace de travail</span>
          </label>
        </div>
      </div>

      {/* Console de Connectivité & Diagnostic des Consoles */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/60 p-2 text-emerald-700 dark:text-emerald-400 shrink-0">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                Console de Connectivité &amp; Passerelles Serveur
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                État en direct de votre base Firestore, du serveur API backend et de la passerelle d'envoi SMS.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={checkingDiagnostics}
            onClick={() => void runFullDiagnostics(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingDiagnostics ? 'animate-spin' : ''}`} />
            <span>{checkingDiagnostics ? 'Test en cours...' : 'Tester les consoles'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Base Firestore Cloud</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {firestoreCheck
                  ? firestoreCheck.ok
                    ? `Connectée (${firestoreCheck.latencyMs} ms)`
                    : 'Hors ligne / Erreur'
                  : systemHealth?.firebase.configured
                  ? 'Configurée & active'
                  : 'Vérification requise'}
              </span>
            </p>
            {systemHealth?.firebase.projectId && (
              <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {systemHealth.firebase.projectId}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">API WhatsApp Business</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {systemHealth?.whatsappGateway?.configured
                ? `Connectée (${systemHealth.whatsappGateway.provider === 'whatsapp_cloud_api' ? 'Meta Cloud' : 'Webhook'})`
                : 'Prête · Lien direct'}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {systemHealth?.whatsappGateway?.senderLabel ||
                'Ajoutez WHATSAPP_BUSINESS_TOKEN et WHATSAPP_PHONE_NUMBER_ID dans Secrets.'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Passerelle SMS Opérateur</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {systemHealth?.smsGateway.configured
                ? `Connectée (${systemHealth.smsGateway.provider})`
                : 'Prête · Mode Test'}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {systemHealth?.smsGateway.senderLabel ||
                'Ajoutez TWILIO_* ou SMS_WEBHOOK_URL dans Secrets pour expédier en réel.'}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Hors-ligne &amp; Mobile (PWA)</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {typeof navigator !== 'undefined' && 'serviceWorker' in navigator
                ? 'Service Worker actif'
                : 'Navigateur standard'}
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Compatible Windows, Mac, iOS &amp; Android
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
