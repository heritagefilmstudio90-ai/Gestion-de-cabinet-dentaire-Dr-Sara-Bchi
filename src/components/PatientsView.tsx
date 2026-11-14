import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Contrast,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Send,
  Sliders,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useClinic } from '../context/ClinicContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  compressImageToDataUrl,
  exportToCsv,
  formatDateFR,
  formatMAD,
  generateSafeId,
  todayISO,
} from '../lib/formatters';
import { formatSentDateTimeFR, stripRecallAppointmentTag } from '../lib/smsReminders';
import {
  ClinicalNote,
  DentitionMode,
  ImagingCategory,
  InsuranceType,
  Patient,
  PatientImaging,
  ToothRecord,
} from '../types/dental';
import { OdontogramFDI } from './OdontogramFDI';
import { ImagingComparePanel } from './ImagingComparePanel';
import { PatientDebtWaterfall } from './PatientDebtWaterfall';
import { QuickImagingCaptureModal } from './QuickImagingCaptureModal';

export const PatientsView: React.FC = () => {
  const {
    user,
    actualRole,
    staffProfile,
    patients,
    appointments,
    recalls,
    staffList,
    actsCatalog,
    treatmentPlans,
    invoices,
    payments,
    labOrders,
    selectedPatientId,
    setSelectedPatientId,
    permissions,
    saveRecord,
    sendAppointmentSmsReminder,
    setActiveSection,
    logActivity,
    showToast,
  } = useClinic();

  const [searchQuery, setSearchQuery] = useState('');
  const [insuranceFilter, setInsuranceFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<
    'odontogram' | 'notes' | 'history' | 'imaging' | 'finance' | 'sms'
  >('odontogram');
  const [sendingAptId, setSendingAptId] = useState<string | null>(null);
  const [showQuickCaptureModal, setShowQuickCaptureModal] = useState(false);

  // Subcollections for currently selected patient
  const [imagingList, setImagingList] = useState<PatientImaging[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<ClinicalNote[]>([]);

  // Patient form modal
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [patientForm, setPatientForm] = useState({
    firstName: '',
    lastName: '',
    birthDate: '',
    cin: '',
    profession: '',
    phone: '',
    email: '',
    address: '',
    referringDoctor: '',
    insuranceType: 'AMO' as InsuranceType,
    insuranceNumber: '',
    coverageRate: 70,
    assignedPractitionerId: '',
    cardiovascular: false,
    diabetes: false,
    hemophilia: false,
    pregnancy: false,
    drugAllergies: '',
    chronicConditions: '',
    anamnesisNotes: '',
    hasCriticalAlert: false,
    alertSummary: '',
  });

  // Clinical act modal
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteForm, setNoteForm] = useState({
    tooth: '',
    faces: '',
    actName: actsCatalog[0]?.name || 'Consultation & Bilan complet',
    actCode: actsCatalog[0]?.code || 'C01',
    materials: '',
    report: '',
    amount: actsCatalog[0]?.defaultPrice || 300,
  });

  // Imaging diagnostic viewer state
  const [selectedImage, setSelectedImage] = useState<PatientImaging | null>(null);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [invertNegatoscope, setInvertNegatoscope] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState<string>('');
  const [compareRightId, setCompareRightId] = useState<string>('');
  const [uploadCategory, setUploadCategory] = useState<ImagingCategory>('Panoramique');
  const [uploadToothRef, setUploadToothRef] = useState('');

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  useEffect(() => {
    if (actsCatalog.length > 0 && !actsCatalog.some((a) => a.name === noteForm.actName)) {
      setNoteForm((prev) => ({
        ...prev,
        actName: actsCatalog[0].name,
        actCode: actsCatalog[0].code,
        amount: actsCatalog[0].defaultPrice,
      }));
    }
  }, [actsCatalog, noteForm.actName]);

  useEffect(() => {
    setSelectedImage(null);
    setCompareLeftId('');
    setCompareRightId('');
    setShowQuickCaptureModal(false);
    if (!selectedPatient) {
      setImagingList([]);
      setClinicalNotes([]);
      return;
    }

    const unsubs: Array<() => void> = [];

    if (permissions.canUploadImaging || permissions.canEditOdontogramAndNotes) {
      unsubs.push(
        onSnapshot(
          collection(db, 'patients', selectedPatient.id, 'imaging'),
          (snap) => {
            setImagingList(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PatientImaging, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, `patients/${selectedPatient.id}/imaging`)
        )
      );
    }

    unsubs.push(
      onSnapshot(
        collection(db, 'patients', selectedPatient.id, 'clinicalNotes'),
        (snap) => {
          setClinicalNotes(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<ClinicalNote, 'id'>) }))
              .sort((a, b) => b.date.localeCompare(a.date))
          );
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `patients/${selectedPatient.id}/clinicalNotes`)
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [selectedPatient, permissions.canUploadImaging, permissions.canEditOdontogramAndNotes]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      if (insuranceFilter !== 'all' && p.insuranceType !== insuranceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${p.firstName} ${p.lastName} ${p.fileNumber} ${p.phone} ${p.cin || ''} ${p.insuranceNumber || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [patients, searchQuery, insuranceFilter]);

  const practitioners = useMemo(
    () => staffList.filter((s) => s.active && (s.role === 'titulaire' || s.role === 'collaborateur')),
    [staffList]
  );

  const lastVisitDateByPatient = useMemo(() => {
    const today = todayISO();
    const latestByPatient = new Map<string, { date: string; startTime: string }>();
    for (const apt of appointments) {
      if (!apt.patientId || !apt.date) continue;
      if (apt.status === 'Annulé' || apt.status === 'Absent') continue;
      const isCompletedOrActiveVisit =
        apt.status === 'Terminé' ||
        apt.status === 'Au fauteuil' ||
        apt.status === "Arrivé en salle d'attente";
      const isPastAppointment = apt.date < today;
      if (!isCompletedOrActiveVisit && !isPastAppointment) continue;

      const current = latestByPatient.get(apt.patientId);
      const aptTime = apt.startTime || '00:00';
      if (
        !current ||
        apt.date > current.date ||
        (apt.date === current.date && aptTime > current.startTime)
      ) {
        latestByPatient.set(apt.patientId, { date: apt.date, startTime: aptTime });
      }
    }
    const result = new Map<string, string>();
    latestByPatient.forEach((val, key) => {
      result.set(key, val.date);
    });
    return result;
  }, [appointments]);

  const openNewPatientModal = () => {
    setEditingPatient(null);
    setPatientForm({
      firstName: '',
      lastName: '',
      birthDate: '',
      cin: '',
      profession: '',
      phone: '+212 6',
      email: '',
      address: '',
      referringDoctor: '',
      insuranceType: 'AMO',
      insuranceNumber: '',
      coverageRate: 70,
      assignedPractitionerId: user?.uid || practitioners[0]?.uid || '',
      cardiovascular: false,
      diabetes: false,
      hemophilia: false,
      pregnancy: false,
      drugAllergies: '',
      chronicConditions: '',
      anamnesisNotes: '',
      hasCriticalAlert: false,
      alertSummary: '',
    });
    setShowPatientModal(true);
  };

  const openEditPatientModal = (p: Patient) => {
    setEditingPatient(p);
    setPatientForm({
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: p.birthDate || '',
      cin: p.cin || '',
      profession: p.profession || '',
      phone: p.phone,
      email: p.email || '',
      address: p.address || '',
      referringDoctor: p.referringDoctor || '',
      insuranceType: p.insuranceType,
      insuranceNumber: p.insuranceNumber || '',
      coverageRate: p.coverageRate,
      assignedPractitionerId: p.assignedPractitionerId,
      cardiovascular: Boolean(p.anamnesis?.cardiovascular),
      diabetes: Boolean(p.anamnesis?.diabetes),
      hemophilia: Boolean(p.anamnesis?.hemophilia),
      pregnancy: Boolean(p.anamnesis?.pregnancy),
      drugAllergies: p.anamnesis?.drugAllergies || '',
      chronicConditions: p.anamnesis?.chronicConditions || '',
      anamnesisNotes: p.anamnesis?.notes || '',
      hasCriticalAlert: p.hasCriticalAlert,
      alertSummary: p.alertSummary || '',
    });
    setShowPatientModal(true);
  };

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const autoAlert =
      patientForm.hasCriticalAlert ||
      patientForm.cardiovascular ||
      patientForm.diabetes ||
      patientForm.hemophilia ||
      Boolean(patientForm.drugAllergies.trim());

    const autoSummary =
      patientForm.alertSummary.trim() ||
      [
        patientForm.drugAllergies ? `Allergie : ${patientForm.drugAllergies}` : '',
        patientForm.diabetes ? 'Diabète' : '',
        patientForm.cardiovascular ? 'Antécédent cardiovasculaire' : '',
        patientForm.hemophilia ? 'Risque hémorragique / Hémophilie' : '',
      ]
        .filter(Boolean)
        .join(' · ');

    if (editingPatient) {
      // Secrétaire can only update identity & insurance fields per RBAC rules
      const identityPayload: Record<string, unknown> = {
        firstName: patientForm.firstName.trim(),
        lastName: patientForm.lastName.trim(),
        birthDate: patientForm.birthDate,
        cin: patientForm.cin.trim(),
        profession: patientForm.profession.trim(),
        phone: patientForm.phone.trim(),
        email: patientForm.email.trim(),
        address: patientForm.address.trim(),
        referringDoctor: patientForm.referringDoctor.trim(),
        insuranceType: patientForm.insuranceType,
        insuranceNumber: patientForm.insuranceNumber.trim(),
        coverageRate: Number(patientForm.coverageRate),
        assignedPractitionerId:
          actualRole === 'collaborateur'
            ? editingPatient.assignedPractitionerId
            : patientForm.assignedPractitionerId || editingPatient.assignedPractitionerId,
      };
      if (actualRole !== 'secretaire' && actualRole !== 'assistant' && permissions.canEditOdontogramAndNotes) {
        identityPayload.hasCriticalAlert = autoAlert;
        identityPayload.alertSummary = autoSummary;
        identityPayload.anamnesis = {
          cardiovascular: patientForm.cardiovascular,
          diabetes: patientForm.diabetes,
          hemophilia: patientForm.hemophilia,
          pregnancy: patientForm.pregnancy,
          drugAllergies: patientForm.drugAllergies.trim(),
          chronicConditions: patientForm.chronicConditions.trim(),
          notes: patientForm.anamnesisNotes.trim(),
        };
      }
      await saveRecord('patients', editingPatient.id, identityPayload, false);

      // Propagate identity changes across linked collections when Titulaire edits (per firestore.rules)
      if (actualRole === 'titulaire') {
        const nextFullName = `${patientForm.firstName.trim()} ${patientForm.lastName.trim()}`.trim();
        const prevFullName = `${editingPatient.firstName} ${editingPatient.lastName}`.trim();
        const nextPhone = patientForm.phone.trim();
        const nameChanged = Boolean(nextFullName && nextFullName !== prevFullName);
        const phoneChanged = nextPhone !== (editingPatient.phone || '').trim();

        if (nameChanged || phoneChanged) {
          const syncTasks: Array<Promise<void>> = [];
          appointments
            .filter((a) => a.patientId === editingPatient.id)
            .forEach((a) => {
              syncTasks.push(
                saveRecord(
                  'appointments',
                  a.id,
                  {
                    ...(nameChanged ? { patientName: nextFullName } : {}),
                    ...(phoneChanged ? { patientPhone: nextPhone } : {}),
                  },
                  false
                )
              );
            });
          if (nameChanged) {
            treatmentPlans
              .filter((pl) => pl.patientId === editingPatient.id)
              .forEach((pl) => {
                syncTasks.push(saveRecord('treatmentPlans', pl.id, { patientName: nextFullName }, false));
              });
            invoices
              .filter((inv) => inv.patientId === editingPatient.id)
              .forEach((inv) => {
                syncTasks.push(saveRecord('invoices', inv.id, { patientName: nextFullName }, false));
              });
            labOrders
              .filter((lo) => lo.patientId === editingPatient.id)
              .forEach((lo) => {
                syncTasks.push(saveRecord('labOrders', lo.id, { patientName: nextFullName }, false));
              });
          }
          if (syncTasks.length > 0) {
            await Promise.all(syncTasks);
          }
        }
      }

      showToast('Dossier patient mis à jour.', 'success');
    } else {
      const year = new Date().getFullYear();
      const maxSeq = patients.reduce((max, p) => {
        const m = /-(\d+)$/.exec(p.fileNumber || '');
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      const nextNum = String(maxSeq + 1).padStart(3, '0');
      const id = generateSafeId('pat');
      await saveRecord(
        'patients',
        id,
        {
          fileNumber: `DOS-${year}-${nextNum}`,
          firstName: patientForm.firstName.trim(),
          lastName: patientForm.lastName.trim(),
          birthDate: patientForm.birthDate,
          cin: patientForm.cin.trim(),
          profession: patientForm.profession.trim(),
          phone: patientForm.phone.trim(),
          email: patientForm.email.trim(),
          address: patientForm.address.trim(),
          referringDoctor: patientForm.referringDoctor.trim(),
          insuranceType: patientForm.insuranceType,
          insuranceNumber: patientForm.insuranceNumber.trim(),
          coverageRate: Number(patientForm.coverageRate),
          assignedPractitionerId: patientForm.assignedPractitionerId || user.uid,
          dentitionMode: 'adulte',
          odontogram: {},
          hasCriticalAlert: autoAlert,
          alertSummary: autoSummary,
          anamnesis: {
            cardiovascular: patientForm.cardiovascular,
            diabetes: patientForm.diabetes,
            hemophilia: patientForm.hemophilia,
            pregnancy: patientForm.pregnancy,
            drugAllergies: patientForm.drugAllergies.trim(),
            chronicConditions: patientForm.chronicConditions.trim(),
            notes: patientForm.anamnesisNotes.trim(),
          },
          active: true,
          createdBy: user.uid,
        },
        true
      );
      setSelectedPatientId(id);
      showToast('Nouveau dossier patient créé.', 'success');
    }
    setShowPatientModal(false);
  };

  const handleUpdateOdontogramTooth = async (toothId: string, record: ToothRecord) => {
    if (!selectedPatient) return;
    const nextOdontogram = {
      ...(selectedPatient.odontogram || {}),
      [toothId]: record,
    };
    await saveRecord('patients', selectedPatient.id, { odontogram: nextOdontogram }, false);
    showToast(`Dent #${toothId} enregistrée.`, 'success');
  };

  const handleChangeDentitionMode = async (mode: DentitionMode) => {
    if (!selectedPatient) return;
    await saveRecord('patients', selectedPatient.id, { dentitionMode: mode }, false);
  };

  const handleSaveClinicalNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !user) return;
    const noteId = generateSafeId('note');
    try {
      await setDoc(doc(db, 'patients', selectedPatient.id, 'clinicalNotes', noteId), {
        patientId: selectedPatient.id,
        date: todayISO(),
        practitionerId: user.uid,
        practitionerName: staffProfile?.displayName || 'Praticien',
        tooth: noteForm.tooth,
        faces: noteForm.faces,
        actCode: noteForm.actCode,
        actName: noteForm.actName,
        materials: noteForm.materials,
        report: noteForm.report,
        amount: Number(noteForm.amount),
        billed: false,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      logActivity({
        category: 'clinique',
        title: `Acte clinique ajouté : ${selectedPatient.firstName} ${selectedPatient.lastName}`,
        detail: `${noteForm.actName}${noteForm.tooth ? ` · Dent ${noteForm.tooth}` : ''}`,
        section: 'patients',
        patientId: selectedPatient.id,
      });
      setShowNoteModal(false);
      showToast('Acte clinique ajouté au dossier.', 'success');
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `patients/${selectedPatient.id}/clinicalNotes/${noteId}`
      );
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPatient || !user) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 1200, 0.8);
      if (dataUrl.length > 850000) {
        showToast('Image trop volumineuse après compression.', 'error');
        return;
      }
      const imgId = generateSafeId('img');
      await setDoc(doc(db, 'patients', selectedPatient.id, 'imaging', imgId), {
        patientId: selectedPatient.id,
        title: file.name.replace(/\.[^.]+$/, ''),
        category: uploadCategory,
        toothRef: uploadToothRef,
        date: todayISO(),
        dataUrl,
        notes: '',
        uploadedBy: user.uid,
        createdAt: serverTimestamp(),
      });
      logActivity({
        category: 'clinique',
        title: `Imagerie ajoutée : ${selectedPatient.firstName} ${selectedPatient.lastName}`,
        detail: `${uploadCategory} · ${file.name.replace(/\.[^.]+$/, '')}`,
        section: 'patients',
        patientId: selectedPatient.id,
      });
      showToast('Cliché importé et synchronisé.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erreur import image.', 'error');
    }
    e.target.value = '';
  };

  const patientPlans = selectedPatient
    ? treatmentPlans.filter((p) => p.patientId === selectedPatient.id)
    : [];
  const patientInvoices = selectedPatient
    ? invoices.filter((inv) => inv.patientId === selectedPatient.id)
    : [];
  const patientBalanceDue = patientInvoices
    .filter((i) => i.status !== 'Annulée')
    .reduce((sum, i) => sum + Math.max(0, i.patientShare - i.paidAmount), 0);

  const patientSmsHistory = useMemo(() => {
    if (!selectedPatient) return [];
    return recalls
      .filter((r) => r.patientId === selectedPatient.id && r.channel === 'SMS')
      .sort((a, b) =>
        (b.lastSentAt || `${b.dueDate}T00:00:00`).localeCompare(
          a.lastSentAt || `${a.dueDate}T00:00:00`
        )
      );
  }, [recalls, selectedPatient]);

  const patientUpcomingAppointments = useMemo(() => {
    if (!selectedPatient) return [];
    const today = todayISO();
    return appointments
      .filter(
        (a) =>
          a.patientId === selectedPatient.id &&
          a.date >= today &&
          a.status !== 'Annulé' &&
          a.status !== 'Terminé' &&
          a.status !== 'Absent'
      )
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  }, [appointments, selectedPatient]);

  const patientAppointmentHistory = useMemo(() => {
    if (!selectedPatient) return [];
    return appointments
      .filter((a) => a.patientId === selectedPatient.id)
      .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
  }, [appointments, selectedPatient]);

  const handleManualSmsSend = async (aptId: string) => {
    const apt = appointments.find((a) => a.id === aptId);
    if (!apt) return;
    setSendingAptId(aptId);
    try {
      const ok = await sendAppointmentSmsReminder(apt, { isAuto: false });
      if (ok) {
        showToast(`Rappel SMS envoyé à ${apt.patientName}.`, 'success');
      } else {
        showToast("Numéro de téléphone manquant ou rôle non autorisé.", 'error');
      }
    } finally {
      setSendingAptId(null);
    }
  };

  const handleExportPatientsCsv = (targetPatients: Patient[], singlePatient?: Patient) => {
    if (targetPatients.length === 0) {
      showToast('Aucun patient à exporter.', 'info');
      return;
    }

    const headers = [
      'Numéro de dossier',
      'Nom',
      'Prénom',
      'Téléphone',
      'CIN',
      'Date de dernière visite',
    ];

    const rows = targetPatients.map((p) => {
      const lastVisitIso = lastVisitDateByPatient.get(p.id);
      return [
        p.fileNumber,
        p.lastName,
        p.firstName,
        p.phone,
        p.cin || '',
        lastVisitIso ? formatDateFR(lastVisitIso) : 'Aucune',
      ];
    });

    const filename = singlePatient
      ? `patient-${singlePatient.fileNumber || singlePatient.id}-${todayISO()}.csv`
      : `patients-${todayISO()}.csv`;

    exportToCsv(filename, headers, rows);

    void logActivity({
      category: 'patient',
      title: singlePatient ? 'Export CSV fiche patient' : 'Export CSV des patients',
      detail: singlePatient
        ? `${singlePatient.firstName} ${singlePatient.lastName} (${singlePatient.fileNumber})`
        : `${targetPatients.length} dossier(s) patient exporté(s)`,
      section: 'patients',
      patientId: singlePatient?.id,
    });

    showToast(
      singlePatient
        ? `Fiche de ${singlePatient.firstName} ${singlePatient.lastName} exportée en CSV.`
        : `${targetPatients.length} dossier(s) patient exporté(s) en CSV.`,
      'success'
    );
  };

  if (!selectedPatient) {
    return (
      <div className="space-y-5">
        {/* Directory Search & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Recherche instantanée : Nom, N° Dossier, Téléphone, CIN..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <select
              value={insuranceFilter}
              onChange={(e) => setInsuranceFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-200"
            >
              <option value="all">Toutes couvertures (AMO / CNSS / CNOPS)</option>
              <option value="AMO">AMO</option>
              <option value="CNSS">CNSS</option>
              <option value="CNOPS">CNOPS</option>
              <option value="Mutuelle Privée">Mutuelle Privée</option>
              <option value="Aucune">Sans mutuelle</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleExportPatientsCsv(patients)}
              disabled={patients.length === 0}
              title="Exporter la liste complète des patients au format CSV"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exporter CSV</span>
            </button>
            {permissions.canEditPatientsIdentity && (
              <button
                type="button"
                onClick={openNewPatientModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nouveau Patient</span>
              </button>
            )}
          </div>
        </div>

        {/* Patients Table */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-medium">N° Dossier</th>
                  <th className="px-4 py-3 font-medium">Patient & CIN</th>
                  <th className="px-4 py-3 font-medium">Téléphone</th>
                  <th className="px-4 py-3 font-medium">Couverture</th>
                  <th className="px-4 py-3 font-medium">Alerte Médicale</th>
                  <th className="px-4 py-3 font-medium text-right">Dossier 360°</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredPatients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      Aucun patient ne correspond à votre recherche.
                    </td>
                  </tr>
                ) : (
                  filteredPatients.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedPatientId(p.id)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {p.fileNumber}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {p.firstName} {p.lastName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          CIN : {p.cin || '—'} · {p.profession || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300 tabular-nums">{p.phone}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {p.insuranceType} ({p.coverageRate}%)
                      </td>
                      <td className="px-4 py-3">
                        {p.hasCriticalAlert ? (
                          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span>{p.alertSummary || 'Alerte médicale'}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Aucune</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPatientId(p.id);
                          }}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/60"
                        >
                          Ouvrir
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Patient Modal */}
        {showPatientModal && (
          <PatientModal
            editing={!!editingPatient}
            form={patientForm}
            setForm={setPatientForm}
            practitioners={practitioners}
            disablePractitionerSelect={actualRole === 'collaborateur'}
            canEditMedical={permissions.canEditOdontogramAndNotes || !editingPatient}
            onClose={() => setShowPatientModal(false)}
            onSubmit={handleSavePatient}
          />
        )}
      </div>
    );
  }

  // Patient 360° Workspace
  return (
    <div className="space-y-5">
      {/* Persistent Critical Medical Alert Banner */}
      {selectedPatient.hasCriticalAlert && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-red-300 dark:border-red-700 bg-red-600 dark:bg-red-700 px-5 py-3 text-white">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">Alerte Médicale Critique</p>
              <p className="text-sm font-medium">
                {selectedPatient.alertSummary || 'Antécédents médicaux critiques signalés dans l\'anamnèse.'}
              </p>
            </div>
          </div>
          {selectedPatient.anamnesis?.notes && (
            <span className="hidden md:block text-xs bg-red-700/80 dark:bg-red-900/60 rounded-lg px-3 py-1.5">
              {selectedPatient.anamnesis.notes}
            </span>
          )}
        </div>
      )}

      {/* Patient Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setSelectedPatientId(null)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline mb-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Retour au répertoire patients</span>
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {selectedPatient.firstName} {selectedPatient.lastName}
              </h2>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {selectedPatient.fileNumber}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              CIN : {selectedPatient.cin || '—'} · Tél :{' '}
              <span className="font-mono tabular-nums">{selectedPatient.phone}</span> · Couverture :{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {selectedPatient.insuranceType} ({selectedPatient.coverageRate}%)
              </strong>{' '}
              {selectedPatient.insuranceNumber ? `· N° ${selectedPatient.insuranceNumber}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {permissions.canViewFinancialTotals && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3.5 py-2 text-right">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Solde débiteur patient</p>
                <p
                  className={`font-mono text-sm font-bold tabular-nums ${
                    patientBalanceDue > 0
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {formatMAD(patientBalanceDue)}
                </p>
              </div>
            )}
            {permissions.canUploadImaging && (
              <button
                type="button"
                onClick={() => setShowQuickCaptureModal(true)}
                title="Lancer instantanément la caméra ou le scanner pour attacher une image au dossier"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors shadow-xs whitespace-nowrap"
              >
                <Camera className="h-3.5 w-3.5 shrink-0" />
                <span>Capture Imagerie</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleExportPatientsCsv([selectedPatient], selectedPatient)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exporter CSV</span>
            </button>
            {permissions.canEditPatientsIdentity && (
              <button
                type="button"
                onClick={() => openEditPatientModal(selectedPatient)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                Modifier Fiche & Anamnèse
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-5 flex flex-wrap gap-1 border-t border-slate-100 dark:border-slate-800 pt-4">
          {(
            [
              ['odontogram', 'Odontogramme FDI'],
              ['notes', `Fil d'Actes (${clinicalNotes.length})`],
              ['history', 'Historique'],
              ['imaging', `Imagerie & Avant/Après (${imagingList.length})`],
              ['finance', `Plans & Factures (${patientPlans.length} / ${patientInvoices.length})`],
              ['sms', `Rappels SMS (${patientSmsHistory.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'odontogram' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <OdontogramFDI
            key={selectedPatient.id}
            dentitionMode={selectedPatient.dentitionMode || 'adulte'}
            odontogram={selectedPatient.odontogram || {}}
            canEdit={permissions.canEditOdontogramAndNotes}
            onChangeDentitionMode={handleChangeDentitionMode}
            onUpdateTooth={handleUpdateOdontogramTooth}
            onQuickAddAct={(toothId, faces) => {
              const defaultAct = actsCatalog[0];
              setNoteForm({
                tooth: toothId,
                faces,
                actName: defaultAct?.name || 'Consultation & Bilan complet',
                actCode: defaultAct?.code || 'C01',
                materials: '',
                report: '',
                amount: defaultAct?.defaultPrice || 300,
              });
              setShowNoteModal(true);
            }}
          />
        </div>
      )}

      {activeTab === 'notes' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Fil d'Actes Chronologique</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Historique des actes cliniques réalisés, matériaux utilisés et liaison comptable
              </p>
            </div>
            {permissions.canEditOdontogramAndNotes && (
              <button
                type="button"
                onClick={() => setShowNoteModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Ajouter un acte</span>
              </button>
            )}
          </div>

          {clinicalNotes.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Aucun acte clinique enregistré pour ce patient.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {clinicalNotes.map((n) => (
                <div key={n.id} className="py-3.5 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">{formatDateFR(n.date)}</span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{n.actName}</span>
                      {n.tooth && (
                        <span className="font-mono text-sky-700 dark:text-sky-400 font-medium">
                          Dent #{n.tooth} {n.faces ? `(${n.faces})` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Praticien : {n.practitionerName}
                      {n.materials ? ` · Matériaux : ${n.materials}` : ''}
                    </p>
                    {n.report && <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">{n.report}</p>}
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatMAD(n.amount)}</p>
                    <p className={n.billed ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                      {n.billed ? 'Facturé' : 'À facturer'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-5">
          {/* Section financière demandée : Résumé des paiements et restes à payer */}
          {permissions.canViewFinancialTotals ? (
            <PatientDebtWaterfall
              patient={selectedPatient}
              invoices={invoices}
              payments={payments}
              canNavigateFinance={actualRole !== 'assistant'}
              onNavigateInvoices={() => setActiveSection('invoices')}
              onNavigatePayments={() => setActiveSection('payments')}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Lock className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold">Résumé des paiements et restes à payer</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                L'accès aux données financières et à l'évolution de la dette patient est réservé aux praticiens et au secrétariat.
              </p>
            </div>
          )}

          {/* Historique des rendez-vous et passages */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#1598C7] dark:text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Historique des visites &amp; rendez-vous ({patientAppointmentHistory.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveSection('appointments')}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
              >
                Ouvrir l'agenda
              </button>
            </div>

            {patientAppointmentHistory.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Aucun rendez-vous enregistré pour ce patient.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientAppointmentHistory.map((apt) => (
                  <div
                    key={apt.id}
                    className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                          {formatDateFR(apt.date)} · {apt.startTime}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {apt.actType}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {apt.practitionerName} · {apt.chair} ({apt.durationMinutes} min)
                        {apt.notes ? ` · ${apt.notes}` : ''}
                      </p>
                    </div>
                    <span
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${
                        apt.status === 'Terminé'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : apt.status === 'Annulé' || apt.status === 'Absent'
                          ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                          : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                      }`}
                    >
                      {apt.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'imaging' && (
        <div className="space-y-5">
          {/* Upload Bar */}
          {permissions.canUploadImaging && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value as ImagingCategory)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                >
                  <option value="Panoramique">Panoramique</option>
                  <option value="Rétro-alvéolaire">Rétro-alvéolaire</option>
                  <option value="Téléradiographie">Téléradiographie</option>
                  <option value="Photo Avant">Photo Avant</option>
                  <option value="Photo Après">Photo Après</option>
                  <option value="Document">Document scanné</option>
                </select>
                <input
                  type="text"
                  placeholder="Dent réf. (ex: 16)"
                  value={uploadToothRef}
                  onChange={(e) => setUploadToothRef(e.target.value)}
                  className="w-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                />
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700">
                <Upload className="h-3.5 w-3.5" />
                <span>Importer cliché / photo (JPEG/PNG)</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
          )}

          {/* Diagnostic Analysis Console */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Clichés & Photos ({imagingList.length})</h3>
              {imagingList.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  <Camera className="h-6 w-6 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                  Aucun cliché importé. Utilisez le bouton d'import ci-dessus.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {imagingList.map((img) => (
                    <div
                      key={img.id}
                      className={`rounded-lg border p-1.5 transition-colors ${
                        selectedImage?.id === img.id
                          ? 'border-sky-600 bg-sky-50 dark:bg-sky-950/60'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedImage(img);
                          setBrightness(100);
                          setContrast(100);
                          setZoom(1);
                          setInvertNegatoscope(false);
                        }}
                        className="w-full text-left"
                      >
                        <img
                          src={img.dataUrl}
                          alt={img.title}
                          referrerPolicy="no-referrer"
                          className="h-24 w-full rounded object-cover bg-slate-900"
                        />
                        <p className="mt-1 text-[11px] font-medium text-slate-900 dark:text-slate-100 truncate">
                          {img.title}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {img.category}
                          {img.toothRef ? ` · #${img.toothRef}` : ''}
                          {' · '}
                          {formatDateFR(img.date)}
                        </p>
                      </button>
                      {imagingList.length >= 2 && (
                        <div className="mt-1.5 flex items-center gap-1 border-t border-slate-100 dark:border-slate-800 pt-1.5">
                          <button
                            type="button"
                            onClick={() => setCompareLeftId(img.id)}
                            className={`flex-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                              compareLeftId === img.id
                                ? 'bg-[#163B63] dark:bg-sky-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            Réf. A
                          </button>
                          <button
                            type="button"
                            onClick={() => setCompareRightId(img.id)}
                            className={`flex-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                              compareRightId === img.id
                                ? 'bg-[#1598C7] dark:bg-sky-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            Suivi B
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Sliders className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <span>Console d'Analyse & Négatoscope Virtuel</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Luminosité</span>
                    <input
                      type="range"
                      min={50}
                      max={180}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                      className="w-20"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Contraste</span>
                    <input
                      type="range"
                      min={50}
                      max={200}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                      className="w-20"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700"
                    title="Dézoomer"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 p-1.5 hover:bg-slate-50 dark:hover:bg-slate-700"
                    title="Zoomer"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setInvertNegatoscope((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium ${
                      invertNegatoscope
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <Contrast className="h-3.5 w-3.5" />
                    <span>Inversion</span>
                  </button>
                </div>
              </div>

              <div className="flex h-80 items-center justify-center overflow-hidden rounded-lg bg-slate-950 border border-slate-800 p-2">
                {selectedImage ? (
                  <img
                    src={selectedImage.dataUrl}
                    alt={selectedImage.title}
                    referrerPolicy="no-referrer"
                    style={{
                      transform: `scale(${zoom})`,
                      filter: `brightness(${brightness}%) contrast(${contrast}%) invert(${
                        invertNegatoscope ? 100 : 0
                      }%)`,
                    }}
                    className="max-h-full max-w-full object-contain transition-transform duration-150"
                  />
                ) : (
                  <p className="text-xs text-slate-400">
                    Sélectionnez un cliché à gauche pour activer le négatoscope virtuel.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Side-by-Side & Split-Curtain Radiograph / Photo Comparator */}
          <ImagingComparePanel
            imagingList={imagingList}
            initialLeftId={compareLeftId}
            initialRightId={compareRightId}
          />
        </div>
      )}

      {activeTab === 'finance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Plans de Traitement & Devis</h3>
              <button
                type="button"
                onClick={() => setActiveSection('treatment-plans')}
                className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
              >
                Gérer les devis
              </button>
            </div>
            {patientPlans.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Aucun devis enregistré.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientPlans.map((pl) => (
                  <div key={pl.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{pl.title}</p>
                      <p className="text-slate-500 dark:text-slate-400 font-mono">
                        {pl.quoteNumber} · {pl.status}
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatMAD(pl.totalAmount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Factures & Documents</h3>
              <button
                type="button"
                onClick={() => setActiveSection('documents')}
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Ordonnances & Feuilles de soins</span>
              </button>
            </div>
            {patientInvoices.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Aucune facture émise.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientInvoices.map((inv) => (
                  <div key={inv.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{inv.invoiceNumber}</p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {formatDateFR(inv.issueDate)} · {inv.status}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{formatMAD(inv.totalAmount)}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Payé : {formatMAD(Number(inv.paidAmount || 0) + Number(inv.insurancePaidAmount || 0))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'sms' && (
        <div className="space-y-5">
          {/* Prochains RDV du patient & envoi manuel */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Prochains rendez-vous & Rappels J-24h
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Les rappels automatiques s'exécutent selon le délai configuré dans Paramètres.
                </p>
              </div>
              {permissions.canManageStaffAndSettings && (
                <button
                  type="button"
                  onClick={() => setActiveSection('settings')}
                  className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  Configurer les rappels SMS
                </button>
              )}
            </div>

            {patientUpcomingAppointments.length === 0 ? (
              <p className="py-4 text-xs text-slate-500 dark:text-slate-400">
                Aucun rendez-vous à venir programmé pour ce patient.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientUpcomingAppointments.map((apt) => {
                  const smsAlreadySent =
                    (apt.reminderStatus || '').toUpperCase().startsWith('SMS') ||
                    patientSmsHistory.some((r) => (r.notes || '').includes(`[RDV:${apt.id}]`));
                  return (
                    <div
                      key={apt.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatDateFR(apt.date)} à{' '}
                          <span className="font-mono tabular-nums">{apt.startTime}</span> · {apt.actType}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {apt.practitionerName} · {apt.chair} · Statut rappel :{' '}
                          <span
                            className={
                              smsAlreadySent
                                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                : 'font-medium text-amber-700 dark:text-amber-400'
                            }
                          >
                            {apt.reminderStatus || 'Non envoyé'}
                          </span>
                        </p>
                      </div>

                      {actualRole !== 'assistant' && (
                        <button
                          type="button"
                          disabled={sendingAptId === apt.id}
                          onClick={() => handleManualSmsSend(apt.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/60 disabled:opacity-60 whitespace-nowrap"
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>
                            {sendingAptId === apt.id
                              ? 'Envoi...'
                              : smsAlreadySent
                              ? 'Renvoyer SMS'
                              : 'Envoyer rappel SMS'}
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historique chronologique d'envoi SMS */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#1598C7] dark:text-sky-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Historique d'envoi des SMS ({patientSmsHistory.length})
              </h3>
            </div>

            {actualRole === 'assistant' ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                L'historique détaillé des rappels SMS est accessible aux praticiens et au secrétariat.
              </p>
            ) : patientSmsHistory.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Aucun rappel SMS enregistré pour ce patient pour le moment.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientSmsHistory.map((sms) => {
                  const messageBody = stripRecallAppointmentTag(sms.notes);
                  const isDelivered = sms.deliveryStatus === 'Délivré' || sms.deliveryStatus === 'Lu';
                  const isFailed = sms.deliveryStatus === 'Échec';
                  return (
                    <div key={sms.id} className="py-3.5 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatSentDateTimeFR(sms.lastSentAt || sms.dueDate)}
                          </span>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {sms.reason}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                          <span className="text-slate-500 dark:text-slate-400">
                            {sms.patientPhone || selectedPatient.phone}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-sans font-semibold ${
                              isDelivered
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : isFailed
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isDelivered ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Clock className="h-3.5 w-3.5" />
                            )}
                            <span>{sms.status === 'Envoyé' ? sms.deliveryStatus : sms.status}</span>
                          </span>
                        </div>
                      </div>
                      {messageBody && (
                        <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          « {messageBody} »
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showQuickCaptureModal && selectedPatient && user && (
        <QuickImagingCaptureModal
          patient={selectedPatient}
          userUid={user.uid}
          onClose={() => setShowQuickCaptureModal(false)}
          onCaptured={(img) => setSelectedImage(img)}
          onOpenImagingTab={() => setActiveTab('imaging')}
          onLogActivity={(detail) => {
            void logActivity({
              category: 'clinique',
              title: `Capture imagerie rapide : ${selectedPatient.firstName} ${selectedPatient.lastName}`,
              detail,
              section: 'patients',
              patientId: selectedPatient.id,
            });
          }}
          onToast={showToast}
        />
      )}

      {showPatientModal && (
        <PatientModal
          editing={!!editingPatient}
          form={patientForm}
          setForm={setPatientForm}
          practitioners={practitioners}
          disablePractitionerSelect={actualRole === 'collaborateur'}
          canEditMedical={permissions.canEditOdontogramAndNotes || !editingPatient}
          onClose={() => setShowPatientModal(false)}
          onSubmit={handleSavePatient}
        />
      )}

      {showNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Saisir un acte clinique</h3>
              <button
                type="button"
                onClick={() => setShowNoteModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveClinicalNote} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Acte du catalogue</label>
                <select
                  value={noteForm.actName}
                  onChange={(e) => {
                    const act = actsCatalog.find((a) => a.name === e.target.value);
                    setNoteForm({
                      ...noteForm,
                      actName: e.target.value,
                      actCode: act?.code || '',
                      amount: act?.defaultPrice || noteForm.amount,
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
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Dent (FDI)</label>
                  <input
                    value={noteForm.tooth}
                    onChange={(e) => setNoteForm({ ...noteForm, tooth: e.target.value })}
                    placeholder="Ex: 36"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Faces</label>
                  <input
                    value={noteForm.faces}
                    onChange={(e) => setNoteForm({ ...noteForm, faces: e.target.value })}
                    placeholder="OMD"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tarif (MAD)</label>
                  <input
                    type="number"
                    min={0}
                    value={noteForm.amount}
                    onChange={(e) => setNoteForm({ ...noteForm, amount: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Matériaux utilisés</label>
                <input
                  value={noteForm.materials}
                  onChange={(e) => setNoteForm({ ...noteForm, materials: e.target.value })}
                  placeholder="Ex: Composite Filtek Z250 A2, Anesthésie Articaïne"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Compte-rendu d'intervention</label>
                <textarea
                  rows={3}
                  value={noteForm.report}
                  onChange={(e) => setNoteForm({ ...noteForm, report: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNoteModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
                >
                  Enregistrer l'acte
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface PatientModalProps {
  editing: boolean;
  form: {
    firstName: string;
    lastName: string;
    birthDate: string;
    cin: string;
    profession: string;
    phone: string;
    email: string;
    address: string;
    referringDoctor: string;
    insuranceType: InsuranceType;
    insuranceNumber: string;
    coverageRate: number;
    assignedPractitionerId: string;
    cardiovascular: boolean;
    diabetes: boolean;
    hemophilia: boolean;
    pregnancy: boolean;
    drugAllergies: string;
    chronicConditions: string;
    anamnesisNotes: string;
    hasCriticalAlert: boolean;
    alertSummary: string;
  };
  setForm: React.Dispatch<React.SetStateAction<PatientModalProps['form']>>;
  practitioners: Array<{ uid: string; displayName: string }>;
  disablePractitionerSelect: boolean;
  canEditMedical: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

const PatientModal: React.FC<PatientModalProps> = ({
  editing,
  form,
  setForm,
  practitioners,
  disablePractitionerSelect,
  canEditMedical,
  onClose,
  onSubmit,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-4 overflow-y-auto">
    <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl my-8">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {editing ? 'Modifier la fiche patient' : 'Nouveau Dossier Patient'}
        </h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Prénom *</label>
            <input
              required
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Nom *</label>
            <input
              required
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Téléphone *</label>
            <input
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">CIN / Pièce d'identité</label>
            <input
              value={form.cin}
              onChange={(e) => setForm({ ...form, cin: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Date de naissance</label>
            <input
              type="date"
              value={form.birthDate}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Profession</label>
            <input
              value={form.profession}
              onChange={(e) => setForm({ ...form, profession: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Couverture Médicale</label>
            <select
              value={form.insuranceType}
              onChange={(e) => setForm({ ...form, insuranceType: e.target.value as InsuranceType })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            >
              <option value="AMO">AMO</option>
              <option value="CNSS">CNSS</option>
              <option value="CNOPS">CNOPS</option>
              <option value="Mutuelle Privée">Mutuelle Privée</option>
              <option value="Aucune">Aucune</option>
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">N° Immatriculation</label>
            <input
              value={form.insuranceNumber}
              onChange={(e) => setForm({ ...form, insuranceNumber: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Taux de couverture (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.coverageRate}
              onChange={(e) => setForm({ ...form, coverageRate: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Adresse</label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Praticien référent attribué</label>
            <select
              disabled={disablePractitionerSelect}
              value={form.assignedPractitionerId}
              onChange={(e) => setForm({ ...form, assignedPractitionerId: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 disabled:opacity-60"
            >
              {practitioners.map((pr) => (
                <option key={pr.uid} value={pr.uid}>
                  {pr.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {canEditMedical && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Anamnèse & Alertes Médicales Critiques</p>
            <div className="flex flex-wrap gap-4 text-slate-700 dark:text-slate-300">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.cardiovascular}
                  onChange={(e) => setForm({ ...form, cardiovascular: e.target.checked })}
                />
                <span>Antécédents cardiovasculaires / HTA</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.diabetes}
                  onChange={(e) => setForm({ ...form, diabetes: e.target.checked })}
                />
                <span>Diabète</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.hemophilia}
                  onChange={(e) => setForm({ ...form, hemophilia: e.target.checked })}
                />
                <span>Hémophilie / Anticoagulants</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.pregnancy}
                  onChange={(e) => setForm({ ...form, pregnancy: e.target.checked })}
                />
                <span>Grossesse</span>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                placeholder="Allergies médicamenteuses (ex: Pénicilline)"
                value={form.drugAllergies}
                onChange={(e) => setForm({ ...form, drugAllergies: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />
              <input
                placeholder="Résumé alerte prioritaire bandeau rouge"
                value={form.alertSummary}
                onChange={(e) => setForm({ ...form, alertSummary: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Annuler
          </button>
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
          >
            Enregistrer le dossier
          </button>
        </div>
      </form>
    </div>
  </div>
);
