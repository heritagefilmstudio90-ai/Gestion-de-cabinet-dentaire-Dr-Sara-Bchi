import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FolderArchive,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  Monitor,
  Plus,
  Printer,
  Puzzle,
  RotateCcw,
  Send,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { useFullscreen } from '../hooks/useFullscreen';
import { PWAInstallButton } from './PWAControls';
import {
  downloadBrowserExtensionPackage,
  downloadMacAppPackage,
} from '../lib/macInstaller';
import { DOCUMENT_TEMPLATES, STOMATOLOGY_MOLECULES } from '../data/dentalCatalog';
import { formatDateFR, formatMAD, generateSafeId, todayISO } from '../lib/formatters';
import {
  DEFAULT_SMS_REMINDER_SETTINGS,
  formatSmsReminderMessage,
  isAppointmentDueForSmsReminder,
  resolveSmsReminderSettings,
} from '../lib/smsReminders';
import {
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
  const { user, staffProfile, patients, labOrders, permissions, saveRecord, openPatientFile, showToast } = useClinic();
  const [showModal, setShowModal] = useState(false);
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

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !permissions.canManageLabOrders) return;
    const pat = patients.find((p) => p.id === form.patientId) || patients[0];
    if (!pat) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    const year = new Date().getFullYear();
    const maxSeq = labOrders.reduce((max, o) => {
      const m = /-(\d+)$/.exec(o.orderNumber || '');
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    await saveRecord(
      'labOrders',
      generateSafeId('lab'),
      {
        orderNumber: `LAB-${year}-${String(maxSeq + 1).padStart(3, '0')}`,
        patientId: pat.id,
        patientName: `${pat.firstName} ${pat.lastName}`,
        practitionerId: user.uid,
        practitionerName: staffProfile?.displayName || 'Praticien',
        labName: form.labName.trim(),
        prosthesisType: form.prosthesisType,
        shadeVita: form.shadeVita,
        teeth: form.teeth,
        impressionType: form.impressionType,
        sentDate: today,
        dueDate: form.dueDate,
        nextAppointmentDate: form.nextAppointmentDate,
        status: 'Envoyé',
        labCost: Number(form.labCost),
        supplierInvoiceRef: form.supplierInvoiceRef.trim(),
        supplierPaid: false,
        notes: form.notes,
        createdBy: user.uid,
      },
      true
    );
    setShowModal(false);
    showToast('Ordre de fabrication prothétique enregistré.', 'success');
  };

  const updateOrderStatus = async (order: LabOrder, status: LabOrderStatus) => {
    if (!permissions.canManageLabOrders) return;
    await saveRecord('labOrders', order.id, { status }, false);
    showToast(`Statut prothèse : ${status}`, 'success');
  };

  const toggleSupplierPaid = async (order: LabOrder) => {
    if (!permissions.canManageLabOrders) return;
    await saveRecord(
      'labOrders',
      order.id,
      { supplierPaid: !order.supplierPaid },
      false
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Laboratoire de Prothèses & Contrôle Fournisseurs
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Fiches de commande, teinte VITA, flux STL/physique et alertes de retard par rapport au RDV patient
          </p>
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

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">N° Ordre</th>
                <th className="px-4 py-3 font-medium">Patient & Dents</th>
                <th className="px-4 py-3 font-medium">Laboratoire & Type</th>
                <th className="px-4 py-3 font-medium">Essayage / Délai</th>
                <th className="px-4 py-3 font-medium">Statut Production</th>
                <th className="px-4 py-3 font-medium text-right">Coût Labo</th>
                <th className="px-4 py-3 font-medium text-right">Facture Labo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {labOrders.map((o) => {
                const isLate =
                  Boolean(o.dueDate && o.dueDate < today) &&
                  o.status !== 'Reçu au cabinet' &&
                  o.status !== 'Validé posé';
                return (
                  <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">{o.orderNumber}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openPatientFile(o.patientId)}
                        className="font-semibold text-sky-700 dark:text-sky-400 hover:underline text-left"
                        title="Ouvrir le dossier patient 360°"
                      >
                        {o.patientName}
                      </button>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        Dents : {o.teeth || '—'} · Teinte {o.shadeVita || '—'}
                        {o.supplierInvoiceRef ? ` · Réf. ${o.supplierInvoiceRef}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{o.labName}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {o.prosthesisType} · {o.impressionType}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      <p className="text-slate-800 dark:text-slate-200">{formatDateFR(o.nextAppointmentDate)}</p>
                      {isLate && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold text-red-700 dark:text-red-400">
                          <AlertTriangle className="h-3 w-3" /> Retard livraison
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        disabled={!permissions.canManageLabOrders}
                        value={o.status}
                        onChange={(e) => updateOrderStatus(o, e.target.value as LabOrderStatus)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-1 text-xs"
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
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatMAD(o.labCost)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={!permissions.canManageLabOrders}
                        onClick={() => toggleSupplierPaid(o)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-medium border disabled:opacity-60 disabled:cursor-not-allowed ${
                          o.supplierPaid
                            ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                            : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {o.supplierPaid ? 'Contrôlée / Payée' : 'À rapprocher'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Nouvelle Commande Prothétique</h3>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <form onSubmit={handleCreateOrder} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.patientId}
                  onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
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
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={form.prosthesisType}
                  onChange={(e) =>
                    setForm({ ...form, prosthesisType: e.target.value as LabOrder['prosthesisType'] })
                  }
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
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
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                />
                <input
                  placeholder="Dents (16, 26)"
                  value={form.teeth}
                  onChange={(e) => setForm({ ...form, teeth: e.target.value })}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Flux d'empreinte</label>
                  <select
                    value={form.impressionType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        impressionType: e.target.value as 'Empreinte physique' | 'Fichier numérique STL',
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    <option value="Fichier numérique STL">Fichier STL</option>
                    <option value="Empreinte physique">Empreinte physique</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Coût labo (MAD)</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Coût MAD"
                    value={form.labCost}
                    onChange={(e) => setForm({ ...form, labCost: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Livraison souhaitée</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">RDV essayage patient</label>
                  <input
                    type="date"
                    value={form.nextAppointmentDate}
                    onChange={(e) => setForm({ ...form, nextAppointmentDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Réf. facture labo</label>
                  <input
                    placeholder="Optionnel"
                    value={form.supplierInvoiceRef}
                    onChange={(e) => setForm({ ...form, supplierInvoiceRef: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 py-2 font-mono"
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
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
                >
                  Créer la fiche
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
    } else {
      const tpl = DOCUMENT_TEMPLATES[type];
      setTitle(tpl?.title || type);
      setBodyText(tpl?.body || '');
    }
  };

  const addMolecule = (line: PrescriptionLine) => {
    setPrescriptions((prev) => [...prev, { ...line }]);
  };

  const handleSaveAndPrint = async () => {
    if (!user) return;
    if (!activePatient) {
      showToast("Créez d'abord un dossier patient.", 'error');
      return;
    }
    if (permissions.canCreateMedicalDocs) {
      await saveRecord(
        'medicalDocuments',
        generateSafeId('doc'),
        {
          patientId: activePatient.id,
          patientName: `${activePatient.firstName} ${activePatient.lastName}`,
          practitionerId: user.uid,
          practitionerName: staffProfile?.displayName || 'Praticien',
          docType,
          date: todayISO(),
          title,
          prescriptions: docType === 'Ordonnance' ? prescriptions : [],
          bodyText,
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
          : 'certificate',
      title,
      date: todayISO(),
      patientName: `${activePatient.firstName} ${activePatient.lastName}`,
      patientCin: activePatient.cin,
      patientPhone: activePatient.phone,
      patientInsurance: `${activePatient.insuranceType} (${activePatient.coverageRate}%)`,
      patientInsuranceNumber: activePatient.insuranceNumber,
      practitionerName: staffProfile?.displayName || 'Chirurgien-Dentiste',
      prescriptions: docType === 'Ordonnance' ? prescriptions : undefined,
      bodyText,
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
      totalAmount: docType === 'Feuille de soins' && patientLastInv ? patientLastInv.totalAmount : undefined,
    });
    showToast(
      permissions.canCreateMedicalDocs
        ? 'Document généré et archivé.'
        : 'Aperçu A4 généré pour impression.',
      'success'
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Éditeur d'Ordonnances, Certificats & Feuilles de Soins
          </h2>
          <button
            type="button"
            onClick={handleSaveAndPrint}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>{permissions.canCreateMedicalDocs ? 'Enregistrer & Imprimer A4' : 'Imprimer A4'}</span>
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
                  {p.firstName} {p.lastName} ({p.insuranceType})
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
              <option value="Feuille de soins">Feuille de Soins CNSS / CNOPS / AMO</option>
              <option value="Certificat de présence">Certificat de présence</option>
              <option value="Dispense">Dispense scolaire / professionnelle</option>
              <option value="Attestation de soins">Attestation de soins</option>
              <option value="Consentement éclairé">Consentement éclairé</option>
              <option value="Lettre confrère">Lettre d'adressage confrère</option>
            </select>
          </div>
        </div>

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
            rows={8}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs leading-relaxed"
          />
        )}
      </div>

      {/* Saved Documents History */}
      <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Historique des Documents Émis ({medicalDocuments.length})
        </h3>
        {medicalDocuments.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Aucun document archivé pour le moment.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {medicalDocuments.map((d) => (
              <div key={d.id} className="py-3 flex items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{d.title}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    <button
                      type="button"
                      onClick={() => openPatientFile(d.patientId)}
                      className="font-medium text-sky-700 dark:text-sky-400 hover:underline"
                      title="Ouvrir le dossier patient 360°"
                    >
                      {d.patientName}
                    </button>{' '}
                    · {d.docType} · {formatDateFR(d.date)}
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
                          : 'certificate',
                      title: d.title,
                      date: d.date,
                      patientName: d.patientName,
                      patientCin: pat?.cin,
                      patientPhone: pat?.phone,
                      patientInsurance: pat ? `${pat.insuranceType} (${pat.coverageRate}%)` : undefined,
                      patientInsuranceNumber: pat?.insuranceNumber,
                      practitionerName: d.practitionerName || 'Praticien',
                      prescriptions: d.prescriptions,
                      bodyText: d.bodyText,
                      items:
                        d.docType === 'Feuille de soins' && patInv
                          ? patInv.items.map((it) => ({
                              label: it.actName,
                              tooth: it.tooth,
                              qty: it.quantity,
                              unitPrice: it.unitPrice,
                              total: it.total,
                            }))
                          : undefined,
                      totalAmount: d.docType === 'Feuille de soins' && patInv ? patInv.totalAmount : undefined,
                    });
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Réimprimer
                </button>
              </div>
            ))}
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
  const { user, staffProfile, payments, expenses, cashClosures, permissions, saveRecord, showToast } =
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
    if (existingTodayClosure?.notes && !closureNotes) {
      setClosureNotes(existingTodayClosure.notes);
    }
  }, [existingTodayClosure, closureNotes]);

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
    if (!user) return;
    if (existingTodayClosure) {
      if (!permissions.canManageExpensesAndClosures) {
        showToast('Clôture déjà verrouillée (modification réservée au Praticien Titulaire).', 'error');
        return;
      }
      const discrepancy = Number(countedBalance) - existingTodayClosure.expectedBalance;
      await saveRecord(
        'cashClosures',
        existingTodayClosure.id,
        {
          countedBalance: Number(countedBalance),
          discrepancy,
          notes: closureNotes,
          locked: true,
        },
        false
      );
    } else {
      const discrepancy = Number(countedBalance) - expectedBalance;
      await saveRecord(
        'cashClosures',
        `close_${today}`,
        {
          date: today,
          openingBalance: Number(openingBalance),
          cashInflows: todayCashIn,
          cashOutflows: todayCashOut,
          expectedBalance,
          countedBalance: Number(countedBalance),
          discrepancy,
          notes: closureNotes,
          locked: true,
          closedByUid: user.uid,
          closedByName: staffProfile?.displayName || 'Responsable',
        },
        true
      );
    }
    showToast('Clôture journalière de caisse verrouillée.', 'success');
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !expForm.label.trim()) return;
    const amt = Number(expForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Veuillez saisir un montant supérieur à 0 MAD.', 'error');
      return;
    }
    await saveRecord(
      'expenses',
      generateSafeId('exp'),
      {
        ...expForm,
        label: expForm.label.trim(),
        supplier: expForm.supplier.trim(),
        amount: amt,
        createdBy: user.uid,
      },
      true
    );
    setExpForm({ ...expForm, label: '', supplier: '', amount: 0, receiptRef: '' });
    showToast('Charge enregistrée dans la comptabilité analytique.', 'success');
  };

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
            className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs"
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
              onChange={(e) => setClosureNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={isClosureLockedForRole}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B2239] dark:bg-sky-600 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>
                {isClosureLockedForRole
                  ? 'Caisse verrouillée (modification réservée au Titulaire)'
                  : existingTodayClosure
                  ? 'Mettre à jour la Clôture du Jour'
                  : 'Valider & Verrouiller la Caisse du Jour'}
              </span>
            </button>
          </form>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Historique des Clôtures</h3>
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
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
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatDateFR(c.date)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">{formatMAD(c.expectedBalance)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">{formatMAD(c.countedBalance)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">{formatMAD(c.discrepancy)}</td>
                    <td className="px-4 py-3 text-emerald-700 dark:text-emerald-400 font-medium">
                      {c.locked ? 'Verrouillée' : 'Ouverte'} · {c.closedByName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              className="rounded-lg bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-700 whitespace-nowrap"
            >
              + Enregistrer
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Nature</th>
                  <th className="px-4 py-3 font-medium">Catégorie</th>
                  <th className="px-4 py-3 font-medium">Libellé & Fournisseur</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">{formatDateFR(e.date)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.expenseType}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{e.category}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {e.label} {e.supplier ? `· ${e.supplier}` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.paymentMethod}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {formatMAD(e.amount)}
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

// ============================================================================
// MODULE 9 : GESTION SIMPLIFIÉE DU STOCK & CONSOMMABLES
// ============================================================================
export const InventoryView: React.FC = () => {
  const { user, inventory, stockMovements, saveRecord, showToast } = useClinic();
  const [showModal, setShowModal] = useState(false);
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
    await saveRecord(
      'inventory',
      generateSafeId('inv'),
      {
        sku: form.sku.trim().toUpperCase(),
        name: form.name.trim(),
        category: form.category,
        unit: form.unit,
        quantity: Number(form.quantity),
        minThreshold: Number(form.minThreshold),
        unitCost: Number(form.unitCost),
        supplier: form.supplier.trim(),
        expiryDate: '',
      },
      true
    );
    setShowModal(false);
    showToast('Article ajouté au stock.', 'success');
  };

  const adjustStock = async (item: InventoryItem, type: 'Entrée' | 'Sortie', delta: number) => {
    if (!user) return;
    if (type === 'Sortie' && item.quantity <= 0) {
      showToast(`Stock déjà épuisé pour ${item.name}.`, 'info');
      return;
    }
    const nextQty = Math.max(0, item.quantity + (type === 'Entrée' ? delta : -delta));
    await saveRecord('inventory', item.id, { quantity: nextQty }, false);
    await saveRecord(
      'stockMovements',
      generateSafeId('mvt'),
      {
        itemId: item.id,
        itemName: item.name,
        type,
        quantity: delta,
        reason: type === 'Entrée' ? 'Réception fournisseur' : 'Consommation fauteuil',
        date: todayISO(),
        createdBy: user.uid,
      },
      true
    );
    showToast(`Stock mis à jour (${type} ${delta} ${item.unit}).`, 'info');
  };

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
        <table className="w-full text-left text-xs">
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
                      onClick={() => adjustStock(item, 'Entrée', 1)}
                      className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 text-[11px] font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      +1 Entrée
                    </button>
                    <button
                      type="button"
                      disabled={item.quantity <= 0}
                      onClick={() => adjustStock(item, 'Sortie', 1)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
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
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
                >
                  Enregistrer
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
// ÉQUIPE, RÔLES RBAC & INVITATIONS
// ============================================================================
export const StaffView: React.FC = () => {
  const { user, actualRole, clinicSettings, staffList, staffInvites, saveRecord, removeRecord, showToast } =
    useClinic();
  const chairOptions = useMemo(() => {
    const base = clinicSettings?.chairs?.length ? clinicSettings.chairs : ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3'];
    return Array.from(new Set([...base, 'Accueil', 'Multi-fauteuils']));
  }, [clinicSettings]);

  const [inviteForm, setInviteForm] = useState({
    email: '',
    displayName: '',
    role: 'collaborateur' as StaffRole,
    specialty: '',
    chairName: chairOptions[0] || 'Fauteuil 2',
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    await saveRecord(
      'staffInvites',
      generateSafeId('inv'),
      {
        email: inviteForm.email.trim().toLowerCase(),
        displayName: inviteForm.displayName.trim(),
        role: inviteForm.role,
        specialty: inviteForm.specialty.trim(),
        chairName: inviteForm.chairName,
        color: '#0284C7',
        createdBy: user.uid,
      },
      true
    );
    setInviteForm({
      email: '',
      displayName: '',
      role: 'collaborateur',
      specialty: '',
      chairName: chairOptions[0] || 'Fauteuil 2',
    });
    showToast('Invitation RBAC créée. Le collaborateur recevra son rôle dès sa connexion Google.', 'success');
  };

  const handleToggleStaffActive = async (memberId: string, uid: string, currentActive: boolean, displayName: string) => {
    if (actualRole !== 'titulaire') return;
    if (uid === user?.uid) {
      showToast('Vous ne pouvez pas suspendre votre propre compte Titulaire.', 'error');
      return;
    }
    await saveRecord('staff', memberId, { active: !currentActive }, false);
    showToast(
      !currentActive ? `Accès réactivé pour ${displayName}.` : `Accès suspendu pour ${displayName}.`,
      'success'
    );
  };

  const handleUpdateStaffChair = async (memberId: string, nextChair: string) => {
    if (actualRole !== 'titulaire') return;
    await saveRecord('staff', memberId, { chairName: nextChair }, false);
    showToast(`Fauteuil mis à jour (${nextChair}).`, 'success');
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleInvite}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs"
      >
        <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
          <UserPlus className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <span>Inviter un Membre de l'Équipe (Attribution Rôle RBAC)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            required
            type="email"
            placeholder="Email Google du membre"
            value={inviteForm.email}
            onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
          />
          <input
            required
            placeholder="Nom complet (ex: Dr. Amine)"
            value={inviteForm.displayName}
            onChange={(e) => setInviteForm({ ...inviteForm, displayName: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
          />
          <select
            value={inviteForm.role}
            onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as StaffRole })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
          >
            <option value="titulaire">Praticien Titulaire</option>
            <option value="collaborateur">Praticien Collaborateur</option>
            <option value="secretaire">Secrétaire / Accueil</option>
            <option value="assistant">Assistant(e) Dentaire</option>
          </select>
          <input
            placeholder="Spécialité (ex: Orthodontie)"
            value={inviteForm.specialty}
            onChange={(e) => setInviteForm({ ...inviteForm, specialty: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
          />
          <select
            value={inviteForm.chairName}
            onChange={(e) => setInviteForm({ ...inviteForm, chairName: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
          >
            {chairOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
          >
            Autoriser l'accès
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Membres Actifs du Cabinet ({staffList.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Rôle RBAC</th>
                <th className="px-4 py-3 font-medium">Spécialité &amp; Fauteuil</th>
                <th className="px-4 py-3 font-medium">Statut</th>
                {actualRole === 'titulaire' && <th className="px-4 py-3 font-medium text-right">Gestion</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {staffList.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">{s.displayName}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.email}</td>
                  <td className="px-4 py-3 font-medium text-sky-800 dark:text-sky-400">{ROLE_LABELS[s.role]}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{s.specialty || '—'}</span>
                      {actualRole === 'titulaire' ? (
                        <select
                          value={s.chairName || chairOptions[0]}
                          onChange={(e) => handleUpdateStaffChair(s.id, e.target.value)}
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200"
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
                      {s.uid !== user?.uid ? (
                        <button
                          type="button"
                          onClick={() => handleToggleStaffActive(s.id, s.uid, s.active, s.displayName)}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            s.active
                              ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
                              : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                          }`}
                        >
                          {s.active ? 'Suspendre' : 'Réactiver'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Titulaire principal</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {staffInvites.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2 text-xs">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Invitations en attente</h3>
          {staffInvites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300">
              <span>
                <strong className="text-slate-900 dark:text-slate-100">{inv.displayName}</strong> ({inv.email}) — {ROLE_LABELS[inv.role]}
              </span>
              <button
                type="button"
                onClick={() => removeRecord('staffInvites', inv.id)}
                className="text-red-600 dark:text-red-400 hover:underline"
              >
                Révoquer
              </button>
            </div>
          ))}
        </div>
      )}
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
    clinicSettings,
    patients,
    appointments,
    recalls,
    saveRecord,
    runDemoSeed,
    resetBetaToZero,
    runDueSmsReminders,
    logActivity,
    showToast,
  } = useClinic();
  const initialSms = resolveSmsReminderSettings(clinicSettings);
  const { isFullscreen, isNativeFullscreen, isExpanded, toggleFullscreen, toggleExpanded } =
    useFullscreen();
  const [activeTab, setActiveTab] = useState<'general' | 'sms'>('general');
  const [sendingNow, setSendingNow] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [showBetaResetModal, setShowBetaResetModal] = useState(false);
  const [resettingBeta, setResettingBeta] = useState(false);
  const [testPatientId, setTestPatientId] = useState<string>('');
  const [testPhone, setTestPhone] = useState<string>(
    clinicSettings?.phone || '+212 661 00 00 00'
  );
  const [testResult, setTestResult] = useState<{
    phone: string;
    patientName: string;
    message: string;
    sentAt: string;
    segments: number;
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
      await new Promise((resolve) => setTimeout(resolve, 250));
      const targetName = selectedTestPatientName || 'Patient Test';
      const nowTime = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setTestResult({
        phone: cleanedPhone,
        patientName: targetName,
        message: smsPreview,
        sentAt: nowTime,
        segments: smsSegmentCount,
      });
      logActivity({
        category: 'administration',
        title: "Test d'envoi SMS effectué",
        detail: `Destinataire : ${cleanedPhone} (${targetName}) · ${smsPreview}`,
        section: 'settings',
      });
      showToast(`SMS de test simulé et vérifié pour ${cleanedPhone}.`, 'success');
    } finally {
      setSendingTest(false);
    }
  };

  const handleTriggerSmsNow = async () => {
    setSendingNow(true);
    try {
      await runDueSmsReminders(true);
    } finally {
      setSendingNow(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clinicName.trim()) {
      setActiveTab('general');
      showToast('Veuillez renseigner le nom du cabinet.', 'error');
      return;
    }
    const chairs = form.chairsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await saveRecord(
      'settings',
      'clinic',
      {
        clinicName: form.clinicName.trim(),
        subtitle: form.subtitle.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        ice: form.ice.trim(),
        ifNumber: form.ifNumber.trim(),
        patente: form.patente.trim(),
        inpe: form.inpe.trim(),
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
        invoiceCounter: clinicSettings?.invoiceCounter ?? 0,
        quoteCounter: clinicSettings?.quoteCounter ?? 0,
        receiptCounter: clinicSettings?.receiptCounter ?? 0,
        betaZeroInitialized: clinicSettings?.betaZeroInitialized ?? true,
      },
      !clinicSettings
    );
    showToast(
      activeTab === 'sms'
        ? 'Paramètres SMS enregistrés.'
        : 'Paramètres du cabinet enregistrés.',
      'success'
    );
  };

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
          <span>Paramètres SMS</span>
          {dueSmsAppointments.length > 0 && (
            <span className="font-mono tabular-nums text-[11px] text-[#1598C7] dark:text-sky-400">
              ({dueSmsAppointments.length})
            </span>
          )}
        </button>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 text-xs"
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

            {/* Test d'envoi SMS */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-4 space-y-3">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Test d'envoi SMS
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Vérifiez le rendu final de votre modèle sur un numéro de test sans impacter les rappels planifiés
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-5">
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

                <div className="sm:col-span-3">
                  <button
                    type="button"
                    disabled={sendingTest}
                    onClick={handleSendTestSms}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1598C7] hover:bg-[#117fa7] px-3 py-2 text-xs font-medium text-white disabled:opacity-60 whitespace-nowrap"
                  >
                    <Send className="h-3.5 w-3.5 shrink-0" />
                    <span>{sendingTest ? 'Envoi...' : "Tester l'envoi"}</span>
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>Test envoyé vers {testResult.phone}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-400">
                      {testResult.sentAt} · {testResult.segments} SMS
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-900 dark:text-emerald-200 leading-relaxed">
                    {testResult.message}
                  </p>
                </div>
              )}
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
          {activeTab === 'general' ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBetaResetModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50/80 dark:bg-red-950/40 px-4 py-2 font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/70 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Tout remettre à zéro (Test Bêta)</span>
              </button>
              <button
                type="button"
                onClick={runDemoSeed}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                Charger données démo
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 self-center">
              Les modifications du modèle s'appliquent aux prochains rappels automatiques.
            </span>
          )}
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-5 py-2 font-medium text-white hover:bg-sky-700 whitespace-nowrap"
          >
            Enregistrer les paramètres
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

      {/* Application multi-appareils (PC, Tablette, Android & iOS) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-sky-50 dark:bg-sky-950/60 p-2 text-[#1598C7] dark:text-sky-400 shrink-0">
            <Smartphone className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">
              Installation multi-appareils (Mac, PC, Tablette, Android &amp; iOS)
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              Téléchargez directement l'application Mac (.zip), l'extension Chrome/Edge ou installez la version PWA sur mobile et tablette.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void downloadMacAppPackage(window.location.origin)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
          >
            <FolderArchive className="h-3.5 w-3.5 shrink-0" />
            <span>App Mac (.zip)</span>
          </button>
          <button
            type="button"
            onClick={() => void downloadBrowserExtensionPackage(window.location.origin)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Puzzle className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            <span>Extension Chrome (.zip)</span>
          </button>
          <PWAInstallButton variant="header" alwaysShow />
        </div>
      </div>

      {showBetaResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <h3 className="text-sm font-semibold">Remise à zéro complète (Test Bêta)</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowBetaResetModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Cette action supprime tous les patients, rendez-vous, devis, factures, encaissements, dépenses, stocks, commandes laboratoire, documents et remet tous les compteurs séquentiels (factures, devis, reçus) à <strong>0</strong>. Votre compte praticien et le catalogue des actes restent conservés.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={resettingBeta}
                onClick={() => setShowBetaResetModal(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={resettingBeta}
                onClick={async () => {
                  setResettingBeta(true);
                  try {
                    await resetBetaToZero();
                    setShowBetaResetModal(false);
                  } finally {
                    setResettingBeta(false);
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {resettingBeta ? 'Réinitialisation...' : 'Confirmer la remise à zéro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
