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
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Printer,
  Search,
  Send,
  Sliders,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  collection,
  doc,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useClinic } from '../context/ClinicContext';
import {
  db,
  markCollectionSyncHealthy,
  OperationType,
  reportFirestoreListenerError,
  subscribeFirestoreQuery,
} from '../lib/firebase';
import {
  exportToCsv,
  formatDateFR,
  formatMAD,
  generateSafeId,
  todayISO,
} from '../lib/formatters';
import { compressFileToSafeDataUrl } from '../lib/imageCompression';
import { formatSentDateTimeFR, stripRecallAppointmentTag } from '../lib/smsReminders';
import {
  canAccessSection,
  ClinicalNote,
  DentitionMode,
  ImagingCategory,
  InsuranceType,
  MedicalDocument,
  Patient,
  PatientImaging,
  ToothRecord,
  TreatmentPlan,
  TreatmentPlanItem,
} from '../types/dental';
import { OdontogramFDI } from './OdontogramFDI';
import { OdontogramQuoteModal } from './OdontogramQuoteModal';
import { PatientTimeline } from './PatientTimeline';
import { ImagingComparePanel } from './ImagingComparePanel';
import { PatientDebtWaterfall } from './PatientDebtWaterfall';
import { QuickImagingCaptureModal } from './QuickImagingCaptureModal';
import { AccessDeniedView } from './AccessDeniedView';

function getPatientAge(birthDate?: string): number | null {
  if (!birthDate) return null;
  const trimmed = birthDate.trim();
  if (!trimmed) return null;
  let year = 0;
  let month = 1;
  let day = 1;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  const frMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(trimmed);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (frMatch) {
    day = Number(frMatch[1]);
    month = Number(frMatch[2]);
    year = Number(frMatch[3]);
  } else {
    const dt = new Date(trimmed);
    if (Number.isNaN(dt.getTime())) return null;
    year = dt.getFullYear();
    month = dt.getMonth() + 1;
    day = dt.getDate();
  }

  if (year < 1900 || year > new Date().getFullYear()) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export const PatientsView: React.FC = () => {
  const {
    user,
    actualRole,
    activeRole,
    staffProfile,
    patients,
    clinicalActs,
    appointments,
    recalls,
    staffList,
    actsCatalog,
    treatmentPlans,
    invoices,
    payments,
    labOrders,
    medicalDocuments,
    selectedPatientId,
    setSelectedPatientId,
    permissions,
    ensureCsvPatientSynced,
    saveRecord,
    incrementCounter,
    setPrintableDoc,
    sendAppointmentReminder,
    setActiveSection,
    logActivity,
    showToast,
  } = useClinic();

  const [searchQuery, setSearchQuery] = useState('');
  const [insuranceFilter, setInsuranceFilter] = useState<string>('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState<'all' | 'under18' | '18to60' | 'over60' | 'unknown'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [activeTab, setActiveTab] = useState<
    'odontogram' | 'timeline' | 'notes' | 'history' | 'imaging' | 'finance' | 'sms'
  >('odontogram');
  const [sendingAptAction, setSendingAptAction] = useState<string | null>(null);
  const [showQuickCaptureModal, setShowQuickCaptureModal] = useState(false);
  const [annotateTargetImage, setAnnotateTargetImage] = useState<PatientImaging | null>(null);
  const [captureInitialCategory, setCaptureInitialCategory] = useState<ImagingCategory>('Photo Clinique');
  const [quoteTeeth, setQuoteTeeth] = useState<string[] | null>(null);
  const [savingPatient, setSavingPatient] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

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
  const [splitActPerTooth, setSplitActPerTooth] = useState(false);
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
  const selectedPatientIdValue = selectedPatient?.id || '';

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
    setAnnotateTargetImage(null);
    if (!selectedPatientIdValue) {
      setImagingList([]);
      setClinicalNotes([]);
      return;
    }

    const unsubs: Array<() => void> = [];

    if (permissions.canUploadImaging || permissions.canEditOdontogramAndNotes) {
      unsubs.push(
        subscribeFirestoreQuery(
          query(
            collection(db, 'patients', selectedPatientIdValue, 'imaging'),
            where('patientId', '==', selectedPatientIdValue)
          ),
          (snap) => {
            markCollectionSyncHealthy(`patients/${selectedPatientIdValue}/imaging`);
            setImagingList(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PatientImaging, 'id'>) }))
            );
          },
          `patients/${selectedPatientIdValue}/imaging`
        )
      );
    }

    unsubs.push(
      subscribeFirestoreQuery(
        query(
          collection(db, 'patients', selectedPatientIdValue, 'clinicalNotes'),
          where('patientId', '==', selectedPatientIdValue)
        ),
        (snap) => {
          markCollectionSyncHealthy(`patients/${selectedPatientIdValue}/clinicalNotes`);
          setClinicalNotes(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<ClinicalNote, 'id'>) }))
              .sort((a, b) => b.date.localeCompare(a.date))
          );
        },
        `patients/${selectedPatientIdValue}/clinicalNotes`
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [selectedPatientIdValue, permissions.canUploadImaging, permissions.canEditOdontogramAndNotes]);

  useEffect(() => {
    if (
      (activeTab === 'imaging' && !permissions.canAccessImaging) ||
      (activeTab === 'finance' && !permissions.canViewFinancialTotals) ||
      (activeTab === 'sms' && !permissions.canManageRecalls)
    ) {
      setActiveTab('odontogram');
    }
  }, [activeTab, permissions.canAccessImaging, permissions.canViewFinancialTotals, permissions.canManageRecalls]);

  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      if (insuranceFilter !== 'all' && p.insuranceType !== insuranceFilter) return false;
      if (ageGroupFilter !== 'all') {
        const age = getPatientAge(p.birthDate);
        if (ageGroupFilter === 'under18' && (age === null || age >= 18)) return false;
        if (ageGroupFilter === '18to60' && (age === null || age < 18 || age > 60)) return false;
        if (ageGroupFilter === 'over60' && (age === null || age <= 60)) return false;
        if (ageGroupFilter === 'unknown' && age !== null) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${p.fullName || ''} ${p.firstName} ${p.lastName} ${p.fileNumber} ${p.phone} ${p.cin || ''} ${p.insuranceNumber || ''} ${p.referralSource || ''} ${p.gender || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [patients, searchQuery, insuranceFilter, ageGroupFilter]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, insuranceFilter, ageGroupFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPatients.length / PAGE_SIZE));
  const paginatedPatients = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredPatients.slice(start, start + PAGE_SIZE);
  }, [filteredPatients, page, totalPages]);

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
    if (!user || savingPatient) return;
    const safeFirstName = patientForm.firstName.trim().slice(0, 80);
    const safeLastName = patientForm.lastName.trim().slice(0, 80);
    if (!safeFirstName || !safeLastName) {
      showToast('Veuillez renseigner le prénom et le nom du patient.', 'error');
      return;
    }

    const autoAlert =
      patientForm.hasCriticalAlert ||
      patientForm.cardiovascular ||
      patientForm.diabetes ||
      patientForm.hemophilia ||
      Boolean(patientForm.drugAllergies.trim()) ||
      Boolean(patientForm.alertSummary.trim());

    const autoSummary = (
      patientForm.alertSummary.trim() ||
      [
        patientForm.drugAllergies ? `Allergie : ${patientForm.drugAllergies.trim()}` : '',
        patientForm.diabetes ? 'Diabète' : '',
        patientForm.cardiovascular ? 'Antécédent cardiovasculaire' : '',
        patientForm.hemophilia ? 'Risque hémorragique / Hémophilie' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    ).slice(0, 250);

    const safeCoverage = Math.max(0, Math.min(100, Math.round(Number(patientForm.coverageRate) || 0)));
    const safeAnamnesis = {
      cardiovascular: patientForm.cardiovascular,
      diabetes: patientForm.diabetes,
      hemophilia: patientForm.hemophilia,
      pregnancy: patientForm.pregnancy,
      drugAllergies: patientForm.drugAllergies.trim().slice(0, 200),
      chronicConditions: patientForm.chronicConditions.trim().slice(0, 200),
      notes: patientForm.anamnesisNotes.trim().slice(0, 500),
    };

    setSavingPatient(true);
    try {
      if (editingPatient) {
        // Secrétaire can only update identity & insurance fields per RBAC rules
        const identityPayload: Record<string, unknown> = {
          firstName: safeFirstName,
          lastName: safeLastName,
          birthDate: patientForm.birthDate.trim().slice(0, 20),
          cin: patientForm.cin.trim().slice(0, 30),
          profession: patientForm.profession.trim().slice(0, 100),
          phone: patientForm.phone.trim().slice(0, 30),
          email: patientForm.email.trim().slice(0, 150),
          address: patientForm.address.trim().slice(0, 250),
          referringDoctor: patientForm.referringDoctor.trim().slice(0, 120),
          insuranceType: patientForm.insuranceType,
          insuranceNumber: patientForm.insuranceNumber.trim().slice(0, 60),
          coverageRate: safeCoverage,
          assignedPractitionerId:
            actualRole === 'collaborateur'
              ? editingPatient.assignedPractitionerId
              : (patientForm.assignedPractitionerId || editingPatient.assignedPractitionerId).slice(0, 128),
        };
        if (actualRole !== 'secretaire' && actualRole !== 'assistant' && permissions.canEditOdontogramAndNotes) {
          identityPayload.hasCriticalAlert = autoAlert;
          identityPayload.alertSummary = autoSummary;
          identityPayload.anamnesis = safeAnamnesis;
        }
        await saveRecord('patients', editingPatient.id, identityPayload, false);

        // Propagate identity changes across linked collections when Titulaire edits (per firestore.rules)
        if (actualRole === 'titulaire') {
          const nextFullName = `${safeFirstName} ${safeLastName}`.trim().slice(0, 150);
          const prevFullName = `${editingPatient.firstName} ${editingPatient.lastName}`.trim();
          const nextPhone = patientForm.phone.trim().slice(0, 30);
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
            firstName: safeFirstName,
            lastName: safeLastName,
            birthDate: patientForm.birthDate.trim().slice(0, 20),
            cin: patientForm.cin.trim().slice(0, 30),
            profession: patientForm.profession.trim().slice(0, 100),
            phone: patientForm.phone.trim().slice(0, 30),
            email: patientForm.email.trim().slice(0, 150),
            address: patientForm.address.trim().slice(0, 250),
            referringDoctor: patientForm.referringDoctor.trim().slice(0, 120),
            insuranceType: patientForm.insuranceType,
            insuranceNumber: patientForm.insuranceNumber.trim().slice(0, 60),
            coverageRate: safeCoverage,
            assignedPractitionerId: (patientForm.assignedPractitionerId || user.uid).slice(0, 128),
            dentitionMode: 'adulte',
            odontogram: {},
            hasCriticalAlert: autoAlert,
            alertSummary: autoSummary,
            anamnesis: safeAnamnesis,
            active: true,
            createdBy: user.uid,
          },
          true
        );
        setSelectedPatientId(id);
        showToast('Nouveau dossier patient créé.', 'success');
      }
      setShowPatientModal(false);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Erreur lors de l'enregistrement du dossier patient.",
        'error'
      );
    } finally {
      setSavingPatient(false);
    }
  };

  const handleUpdateOdontogramTooth = async (toothId: string, record: ToothRecord) => {
    if (!selectedPatient) return;
    try {
      const nextOdontogram = {
        ...(selectedPatient.odontogram || {}),
        [toothId]: record,
      };
      await saveRecord('patients', selectedPatient.id, { odontogram: nextOdontogram }, false);
      showToast(`Dent #${toothId} enregistrée.`, 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `Impossible d'enregistrer la dent #${toothId}.`,
        'error'
      );
    }
  };

  const handleUpdateOdontogramTeethBatch = async (updates: Record<string, ToothRecord>) => {
    if (!selectedPatient) return;
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    try {
      const nextOdontogram = {
        ...(selectedPatient.odontogram || {}),
        ...updates,
      };
      await saveRecord('patients', selectedPatient.id, { odontogram: nextOdontogram }, false);
      showToast(
        keys.length > 1
          ? `${keys.length} dents mises à jour dans l'odontogramme.`
          : `Dent #${keys[0]} enregistrée.`,
        'success'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Impossible de mettre à jour l'odontogramme.",
        'error'
      );
    }
  };

  const handleChangeDentitionMode = async (mode: DentitionMode) => {
    if (!selectedPatient) return;
    try {
      await saveRecord('patients', selectedPatient.id, { dentitionMode: mode }, false);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Impossible de changer le mode de dentition.',
        'error'
      );
    }
  };

  const handleSaveClinicalNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !user || savingNote) return;
    const rawTooth = noteForm.tooth.trim();
    const parsedTeeth = rawTooth
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const safeFaces = noteForm.faces.trim().slice(0, 30);
    const safeActCode = noteForm.actCode.trim().slice(0, 30);
    const safeActName = noteForm.actName.trim().slice(0, 150) || 'Acte clinique';
    const safeMaterials = noteForm.materials.trim().slice(0, 200);
    const safeAmount = Math.max(0, Number(noteForm.amount) || 0);
    const practitionerName = (staffProfile?.displayName || 'Praticien').slice(0, 120);

    setSavingNote(true);
    try {
      await ensureCsvPatientSynced(selectedPatient.id);

      if (splitActPerTooth && parsedTeeth.length > 1) {
        const batch = writeBatch(db);
        const safeReport = noteForm.report.trim().slice(0, 1000);
        parsedTeeth.forEach((toothId) => {
          const noteId = generateSafeId('note');
          batch.set(doc(db, 'patients', selectedPatient.id, 'clinicalNotes', noteId), {
            patientId: selectedPatient.id,
            date: todayISO(),
            practitionerId: user.uid,
            practitionerName,
            tooth: toothId.slice(0, 20),
            faces: safeFaces,
            actCode: safeActCode,
            actName: safeActName,
            materials: safeMaterials,
            report: safeReport,
            amount: safeAmount,
            billed: false,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
        });
        await batch.commit();
        void logActivity({
          category: 'clinique',
          title: `${parsedTeeth.length} actes cliniques ajoutés : ${selectedPatient.firstName} ${selectedPatient.lastName}`,
          detail: `${safeActName} · Dents ${parsedTeeth.join(', ')}`,
          section: 'patients',
          patientId: selectedPatient.id,
        });
        setShowNoteModal(false);
        setSplitActPerTooth(false);
        showToast(`${parsedTeeth.length} actes cliniques ajoutés au dossier.`, 'success');
        return;
      }

      const noteId = generateSafeId('note');
      let toothField = rawTooth;
      let reportField = noteForm.report.trim();
      if (toothField.length > 20) {
        const compactSummary =
          parsedTeeth.length > 1
            ? `${parsedTeeth[0]}..${parsedTeeth[parsedTeeth.length - 1]} (${parsedTeeth.length}d)`
            : toothField;
        toothField = compactSummary.slice(0, 20);
        const prefix = `[Dents : ${parsedTeeth.join(', ')}] `;
        reportField = `${prefix}${reportField}`.trim();
      }

      await setDoc(doc(db, 'patients', selectedPatient.id, 'clinicalNotes', noteId), {
        patientId: selectedPatient.id,
        date: todayISO(),
        practitionerId: user.uid,
        practitionerName,
        tooth: toothField,
        faces: safeFaces,
        actCode: safeActCode,
        actName: safeActName,
        materials: safeMaterials,
        report: reportField.slice(0, 1000),
        amount: safeAmount,
        billed: false,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      void logActivity({
        category: 'clinique',
        title: `Acte clinique ajouté : ${selectedPatient.firstName} ${selectedPatient.lastName}`,
        detail: `${safeActName}${rawTooth ? ` · Dent ${rawTooth}` : ''}`,
        section: 'patients',
        patientId: selectedPatient.id,
      });
      setShowNoteModal(false);
      setSplitActPerTooth(false);
      showToast('Acte clinique ajouté au dossier.', 'success');
    } catch (error) {
      showToast("Impossible d'enregistrer l'acte clinique.", 'error');
      reportFirestoreListenerError(
        error,
        OperationType.CREATE,
        `patients/${selectedPatient.id}/clinicalNotes`
      );
    } finally {
      setSavingNote(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedPatient || !user) return;
    try {
      const dataUrl = await compressFileToSafeDataUrl(file, 1400, 840000);
      if (dataUrl.length > 880000) {
        showToast('Image trop volumineuse après compression.', 'error');
        return;
      }
      await ensureCsvPatientSynced(selectedPatient.id);
      const imgId = generateSafeId('img');
      const safeTitle = (file.name.replace(/\.[^.]+$/, '').trim() || uploadCategory).slice(0, 145);
      const safeToothRef = uploadToothRef.trim().slice(0, 30);
      await setDoc(doc(db, 'patients', selectedPatient.id, 'imaging', imgId), {
        patientId: selectedPatient.id,
        title: safeTitle,
        category: uploadCategory,
        toothRef: safeToothRef,
        date: todayISO(),
        dataUrl,
        notes: '',
        uploadedBy: user.uid,
        createdAt: serverTimestamp(),
      });
      logActivity({
        category: 'clinique',
        title: `Imagerie ajoutée : ${selectedPatient.firstName} ${selectedPatient.lastName}`,
        detail: `${uploadCategory} · ${safeTitle}`,
        section: 'patients',
        patientId: selectedPatient.id,
      });
      showToast('Cliché importé et synchronisé.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erreur import image.', 'error');
      reportFirestoreListenerError(
        error,
        OperationType.CREATE,
        `patients/${selectedPatient.id}/imaging`
      );
    }
    e.target.value = '';
  };

  const patientPlans = useMemo(
    () => (selectedPatient ? treatmentPlans.filter((p) => p.patientId === selectedPatient.id) : []),
    [treatmentPlans, selectedPatient]
  );
  const patientInvoices = useMemo(
    () => (selectedPatient ? invoices.filter((inv) => inv.patientId === selectedPatient.id) : []),
    [invoices, selectedPatient]
  );
  const patientPayments = useMemo(
    () => (selectedPatient ? payments.filter((pay) => pay.patientId === selectedPatient.id) : []),
    [payments, selectedPatient]
  );
  const patientMedicalDocs = useMemo(
    () =>
      selectedPatient ? medicalDocuments.filter((docItem) => docItem.patientId === selectedPatient.id) : [],
    [medicalDocuments, selectedPatient]
  );
  const patientLabOrders = useMemo(
    () => (selectedPatient ? labOrders.filter((lo) => lo.patientId === selectedPatient.id) : []),
    [labOrders, selectedPatient]
  );
  const patientRecalls = useMemo(
    () => (selectedPatient ? recalls.filter((r) => r.patientId === selectedPatient.id) : []),
    [recalls, selectedPatient]
  );
  const patientClinicalActs = useMemo(
    () => (selectedPatient ? clinicalActs.filter((a) => a.patientId === selectedPatient.id) : []),
    [clinicalActs, selectedPatient]
  );
  const invoiceDue = useMemo(
    () =>
      patientInvoices
        .filter((i) => i.status !== 'Annulée')
        .reduce((sum, i) => sum + Math.max(0, i.patientShare - i.paidAmount), 0),
    [patientInvoices]
  );
  const patientBalanceDue =
    selectedPatient?.isCsvArchive && selectedPatient.remainingDue !== undefined
      ? Math.max(invoiceDue, Number(selectedPatient.remainingDue))
      : invoiceDue;

  const patientReminderHistory = useMemo(() => {
    if (!selectedPatient) return [];
    return recalls
      .filter((r) => r.patientId === selectedPatient.id)
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

  const handleManualReminderSend = async (
    aptId: string,
    channel: 'SMS' | 'WhatsApp' | 'Appel'
  ) => {
    const apt = appointments.find((a) => a.id === aptId);
    const actionKey = `${aptId}:${channel}`;
    if (!apt || sendingAptAction === actionKey) return;
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
        showToast("Numéro de téléphone manquant ou rôle non autorisé.", 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Échec du rappel ${channel}.`, 'error');
    } finally {
      setSendingAptAction(null);
    }
  };

  const openQuotePrintPreview = (
    title: string,
    items: TreatmentPlanItem[],
    reference?: string
  ) => {
    if (!selectedPatient) return;
    const totalAmount = items.reduce(
      (s, it) => s + Math.max(0, Number(it.unitPrice || 0) * Number(it.quantity || 1) - Number(it.discount || 0)),
      0
    );
    const insuranceShare = Math.round((totalAmount * Number(selectedPatient.coverageRate || 0)) / 100);
    const patientShare = Math.max(0, totalAmount - insuranceShare);
    const practitionerName =
      staffList.find(
        (s) =>
          s.uid === selectedPatient.assignedPractitionerId ||
          s.id === selectedPatient.assignedPractitionerId
      )?.displayName ||
      staffProfile?.displayName ||
      'Praticien';

    setPrintableDoc({
      kind: 'quote',
      title: 'Devis Récapitulatif & Plan de Traitement',
      subtitle: title,
      reference: reference || `APERCU-${todayISO()}`,
      date: todayISO(),
      patientName: selectedPatient.fullName || `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim(),
      patientCin: selectedPatient.cin,
      patientPhone: selectedPatient.phone,
      patientInsurance: `${selectedPatient.insuranceType} (${selectedPatient.coverageRate}%)`,
      patientInsuranceNumber: selectedPatient.insuranceNumber,
      practitionerName,
      items: items.map((it) => ({
        label: `${it.phase} — ${it.actName}${it.faces ? ` (${it.faces})` : ''}`,
        tooth: it.tooth,
        qty: it.quantity,
        unitPrice: it.unitPrice,
        total: Math.max(0, Number(it.unitPrice || 0) * Number(it.quantity || 1) - Number(it.discount || 0)),
      })),
      totalAmount,
      insuranceShare,
      patientShare,
      consentText:
        'Je déclare avoir été informé(e) des alternatives thérapeutiques, des délais et des honoraires prévisionnels exposés dans le présent devis. Validité du devis : 60 jours.',
    });
  };

  const handleSaveAndPrintOdontogramQuote = async (payload: {
    title: string;
    items: TreatmentPlanItem[];
  }) => {
    if (!selectedPatient || !user) return;
    try {
      const qNum = await incrementCounter('quoteCounter');
      const quoteNumber = `DEV-${new Date().getFullYear()}-${String(qNum).padStart(3, '0')}`;
      const planId = generateSafeId('plan');

      // Respect Firestore RBAC: collaborateur must assign their own practitionerId
      const practitionerId =
        actualRole === 'collaborateur'
          ? user.uid
          : selectedPatient.assignedPractitionerId || user.uid;
      const practitionerName =
        staffList.find((s) => s.uid === practitionerId || s.id === practitionerId)?.displayName ||
        staffProfile?.displayName ||
        'Praticien';

      const safeItems = payload.items.slice(0, 40);
      const totalAmount = safeItems.reduce(
        (s, it) => s + Math.max(0, Number(it.unitPrice || 0) * Number(it.quantity || 1) - Number(it.discount || 0)),
        0
      );
      const insuranceEstimated = Math.round(
        (totalAmount * Number(selectedPatient.coverageRate || 0)) / 100
      );

      await saveRecord(
        'treatmentPlans',
        planId,
        {
          quoteNumber,
          patientId: selectedPatient.id,
          patientName:
            selectedPatient.fullName || `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim(),
          practitionerId,
          practitionerName: practitionerName.slice(0, 120),
          title: payload.title.trim().slice(0, 175) || 'Devis Odontogramme',
          isAlternative: false,
          status: 'Imprimé',
          items: safeItems,
          totalAmount,
          insuranceEstimated,
          consentSigned: false,
          lockedVersion: false,
          createdBy: user.uid,
        },
        true
      );

      void logActivity({
        category: 'facturation',
        title: `Devis récapitulatif créé : ${quoteNumber}`,
        detail: `${selectedPatient.firstName} ${selectedPatient.lastName} · ${safeItems.length} dent(s) · ${formatMAD(totalAmount)}`,
        section: 'patients',
        patientId: selectedPatient.id,
      });

      setQuoteTeeth(null);
      openQuotePrintPreview(payload.title, safeItems, quoteNumber);
      showToast(`Devis ${quoteNumber} enregistré et prêt à imprimer.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la création du devis.', 'error');
      throw err;
    }
  };

  const handlePrintMedicalDocument = (docItem: MedicalDocument) => {
    if (!selectedPatient) return;
    const kind =
      docItem.docType === 'Ordonnance'
        ? 'prescription'
        : docItem.docType === 'Feuille de soins'
        ? 'care-sheet'
        : docItem.docType === "Note d'honoraires"
        ? 'fee-note'
        : 'certificate';

    setPrintableDoc({
      kind,
      title: docItem.title || docItem.docType,
      subtitle: docItem.docType,
      date: docItem.date || todayISO(),
      patientName:
        docItem.patientName ||
        selectedPatient.fullName ||
        `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim(),
      patientCin: selectedPatient.cin,
      patientPhone: selectedPatient.phone,
      patientInsurance: `${selectedPatient.insuranceType} (${selectedPatient.coverageRate}%)`,
      patientInsuranceNumber: selectedPatient.insuranceNumber,
      practitionerName: docItem.practitionerName || staffProfile?.displayName || 'Praticien',
      prescriptions: docItem.prescriptions,
      bodyText: docItem.bodyText || docItem.medicationsText || docItem.actsText,
      totalAmount: docItem.amount,
      paymentMethod: docItem.paymentMethod,
    });
  };

  const handlePrintTreatmentPlan = (plan: TreatmentPlan) => {
    if (!selectedPatient) return;
    setPrintableDoc({
      kind: 'quote',
      title: `Devis & Plan de Traitement ${plan.isAlternative ? '(Option Alternative)' : ''}`,
      subtitle: plan.title,
      reference: plan.quoteNumber,
      date: plan.quoteDate || todayISO(),
      patientName: plan.patientName,
      patientCin: selectedPatient.cin,
      patientPhone: selectedPatient.phone,
      patientInsurance: `${selectedPatient.insuranceType} (${selectedPatient.coverageRate}%)`,
      patientInsuranceNumber: selectedPatient.insuranceNumber,
      practitionerName: plan.practitionerName,
      items: (plan.items || []).map((it) => ({
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

  if (!canAccessSection(activeRole, 'patients')) {
    return <AccessDeniedView sectionLabel="Patients" />;
  }

  if (!selectedPatient) {
    return (
      <div className="space-y-5">
        {/* Directory Search & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex flex-wrap items-center gap-3 w-full sm:flex-1">
            <div className="relative w-full sm:flex-1 sm:min-w-[240px] sm:max-w-md">
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
              aria-label="Filtrer par couverture médicale"
              value={insuranceFilter}
              onChange={(e) => setInsuranceFilter(e.target.value)}
              className="w-full sm:w-auto min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-200"
            >
              <option value="all">Toutes couvertures (AMO / CNSS / CNOPS)</option>
              <option value="AMO">AMO</option>
              <option value="CNSS">CNSS</option>
              <option value="CNOPS">CNOPS</option>
              <option value="Mutuelle Privée">Mutuelle Privée</option>
              <option value="Aucune">Sans mutuelle</option>
            </select>

            <select
              aria-label="Filtrer par tranche d'âge"
              value={ageGroupFilter}
              onChange={(e) =>
                setAgeGroupFilter(
                  e.target.value as 'all' | 'under18' | '18to60' | 'over60' | 'unknown'
                )
              }
              className="w-full sm:w-auto min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-200"
            >
              <option value="all">Toutes tranches d&apos;âge</option>
              <option value="under18">&lt; 18 ans (Enfants / Ados)</option>
              <option value="18to60">18 – 60 ans (Adultes)</option>
              <option value="over60">&gt; 60 ans (Seniors)</option>
              <option value="unknown">Âge non renseigné</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleExportPatientsCsv(patients)}
              disabled={patients.length === 0}
              title="Exporter la liste complète des patients au format CSV"
              className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exporter CSV</span>
            </button>
            {permissions.canEditPatientsIdentity && (
              <button
                type="button"
                onClick={openNewPatientModal}
                className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Nouveau Patient</span>
              </button>
            )}
          </div>
        </div>

        {/* Patients Table (all 14 CSV columns) */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {filteredPatients.length} patient{filteredPatients.length > 1 ? 's' : ''} affiché{filteredPatients.length > 1 ? 's' : ''} (sur {patients.length})
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  Précédent
                </button>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  Page {Math.min(page, totalPages)} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  Suivant
                </button>
              </div>
            )}
          </div>
          {/* Mobile Patient Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {paginatedPatients.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                Aucun patient ne correspond à votre recherche.
              </div>
            ) : (
              paginatedPatients.map((p) => {
                const lastRdv = p.lastAppointmentDate || lastVisitDateByPatient.get(p.id) || '';
                const age = p.birthDate ? getPatientAge(p.birthDate) : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPatientId(p.id)}
                    className="w-full text-left px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 active:bg-slate-100 dark:active:bg-slate-800 transition-colors space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                            {p.fileNumber}
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {p.fullName || `${p.lastName} ${p.firstName}`.trim()}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate mt-0.5">
                          {p.phone || 'Sans tél'}
                          {age !== null ? ` · ${age} ans` : ''}
                          {p.insuranceType && p.insuranceType !== 'Aucune' ? ` · ${p.insuranceType}` : ''}
                        </p>
                      </div>

                      <div className="text-right shrink-0 space-y-0.5">
                        {permissions.canViewFinancialTotals && (
                          <p
                            className={`font-mono text-xs font-bold tabular-nums ${
                              Number(p.remainingDue || 0) > 0
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {Number(p.remainingDue || 0) > 0
                              ? `${formatMAD(Number(p.remainingDue || 0))} dû`
                              : 'Soldé'}
                          </p>
                        )}
                        <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                          {lastRdv ? `RDV ${formatDateFR(lastRdv)}` : 'Dossier 360° →'}
                        </p>
                      </div>
                    </div>

                    {p.hasCriticalAlert && (
                      <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="truncate">{p.alertSummary || 'Alerte médicale critique'}</span>
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  <th className="px-3 py-3 font-medium">Num</th>
                  <th className="px-3 py-3 font-medium">Patient</th>
                  <th className="px-3 py-3 font-medium">Sexe</th>
                  <th className="px-3 py-3 font-medium">Né le</th>
                  <th className="px-3 py-3 font-medium">Téléphone</th>
                  {permissions.canViewFinancialTotals && (
                    <>
                      <th className="px-3 py-3 font-medium text-right">Total</th>
                      <th className="px-3 py-3 font-medium text-right">Reste à payer</th>
                      <th className="px-3 py-3 font-medium text-right">Solde</th>
                    </>
                  )}
                  <th className="px-3 py-3 font-medium">Dernier RDV</th>
                  <th className="px-3 py-3 font-medium">Source de référence</th>
                  <th className="px-3 py-3 font-medium">Créé le / Par</th>
                  <th className="px-3 py-3 font-medium">Mis à jour à / par</th>
                  <th className="px-3 py-3 font-medium text-right">Dossier 360°</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedPatients.length === 0 ? (
                  <tr>
                    <td colSpan={permissions.canViewFinancialTotals ? 13 : 10} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      Aucun patient ne correspond à votre recherche.
                    </td>
                  </tr>
                ) : (
                  paginatedPatients.map((p) => {
                    const lastRdv = p.lastAppointmentDate || lastVisitDateByPatient.get(p.id) || '';
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedPatientId(p.id)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2.5 font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {p.fileNumber}
                        </td>
                        <td className="px-3 py-2.5 min-w-[160px]">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {p.fullName || `${p.lastName} ${p.firstName}`.trim()}
                          </p>
                          {(p.cin || p.hasCriticalAlert) && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {p.cin ? `CIN ${p.cin}` : ''}
                              {p.hasCriticalAlert ? (
                                <span className="ml-1 inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-semibold">
                                  <AlertTriangle className="h-3 w-3" />
                                  {p.alertSummary || 'Alerte'}
                                </span>
                              ) : null}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {p.gender || '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {p.birthDate ? (
                            <>
                              {formatDateFR(p.birthDate)}
                              {(() => {
                                const age = getPatientAge(p.birthDate);
                                return age !== null ? (
                                  <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">
                                    ({age} ans)
                                  </span>
                                ) : null;
                              })()}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {p.phone || '—'}
                        </td>
                        {permissions.canViewFinancialTotals && (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                              {formatMAD(Number(p.totalBilled || 0))}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                Number(p.remainingDue || 0) > 0
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {formatMAD(Number(p.remainingDue || 0))}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                              {formatMAD(Number(p.walletBalance || 0))}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {lastRdv ? formatDateFR(lastRdv) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {p.referralSource || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          <div>{p.csvCreatedAt || '—'}</div>
                          {p.csvCreatedBy && <div className="text-slate-700 dark:text-slate-300">{p.csvCreatedBy}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          <div>{p.csvUpdatedAt || '—'}</div>
                          {p.csvUpdatedBy && <div className="text-slate-700 dark:text-slate-300">{p.csvUpdatedBy}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Patient Modal */}
        {showPatientModal && (
          <PatientModal
            editing={!!editingPatient}
            saving={savingPatient}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-600 dark:bg-red-700 px-4 sm:px-5 py-3 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider">Alerte Médicale Critique</p>
              <p className="text-sm font-medium break-words">
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
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
                {selectedPatient.fullName || `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim()}
              </h2>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                N° {selectedPatient.fileNumber}
              </span>
              {selectedPatient.gender && (
                <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  {selectedPatient.gender}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Né(e) le :{' '}
              {selectedPatient.birthDate ? (
                <>
                  {formatDateFR(selectedPatient.birthDate)}
                  {(() => {
                    const age = getPatientAge(selectedPatient.birthDate);
                    return age !== null ? ` (${age} ans)` : '';
                  })()}
                </>
              ) : (
                '—'
              )}{' '}
              · CIN : {selectedPatient.cin || '—'} · Tél :{' '}
              <span className="font-mono tabular-nums">{selectedPatient.phone || '—'}</span> · Couverture :{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {selectedPatient.insuranceType} ({selectedPatient.coverageRate}%)
              </strong>{' '}
              {selectedPatient.insuranceNumber ? `· N° ${selectedPatient.insuranceNumber}` : ''}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Dernier RDV : {selectedPatient.lastAppointmentDate ? formatDateFR(selectedPatient.lastAppointmentDate) : '—'} · Source :{' '}
              {selectedPatient.referralSource || '—'} · Créé : {selectedPatient.csvCreatedAt || '—'}
              {selectedPatient.csvCreatedBy ? ` (${selectedPatient.csvCreatedBy})` : ''} · Màj : {selectedPatient.csvUpdatedAt || '—'}
              {selectedPatient.csvUpdatedBy ? ` (${selectedPatient.csvUpdatedBy})` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {permissions.canViewFinancialTotals && (
              <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 w-full sm:w-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3.5 py-2 text-left sm:text-right">
                {selectedPatient.totalBilled !== undefined && (
                  <div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Total soins</p>
                    <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                      {formatMAD(Number(selectedPatient.totalBilled || 0))}
                    </p>
                  </div>
                )}
                {Number(selectedPatient.walletBalance || 0) > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Solde portefeuille</p>
                    <p className="font-mono text-xs font-semibold text-sky-700 dark:text-sky-400 tabular-nums">
                      {formatMAD(Number(selectedPatient.walletBalance || 0))}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Reste à payer</p>
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
              </div>
            )}
            {permissions.canUploadImaging && (
              <button
                type="button"
                onClick={() => {
                  setAnnotateTargetImage(null);
                  setCaptureInitialCategory('Photo Clinique');
                  setShowQuickCaptureModal(true);
                }}
                title="Prendre une photo clinique ou un cliché intra-oral avec la caméra et l'annoter"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors shadow-xs whitespace-nowrap min-h-[40px]"
              >
                <Camera className="h-3.5 w-3.5 shrink-0" />
                <span>Caméra &amp; Imagerie</span>
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
        <div className="mt-5 flex flex-nowrap sm:flex-wrap gap-1.5 overflow-x-auto scrollbar-none border-t border-slate-100 dark:border-slate-800 pt-4 pb-0.5">
          {(
            [
              ['odontogram', 'Odontogramme FDI'],
              ['timeline', 'Ligne de temps 360°'],
              ['notes', `Fil d'Actes (${clinicalNotes.length + patientClinicalActs.length})`],
              ['history', 'Historique'],
              ...(permissions.canAccessImaging
                ? ([['imaging', `Imagerie & Avant/Après (${imagingList.length})`]] as const)
                : []),
              ...(permissions.canViewFinancialTotals
                ? ([['finance', `Plans, Factures & Docs (${patientPlans.length} / ${patientInvoices.length})`]] as const)
                : []),
              ...(permissions.canManageRecalls
                ? ([['sms', `Rappels (${patientReminderHistory.length})`]] as const)
                : []),
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
            onUpdateTeethBatch={handleUpdateOdontogramTeethBatch}
            onQuickAddAct={(toothId, faces) => {
              const defaultAct = actsCatalog[0];
              setSplitActPerTooth(false);
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
            onGenerateQuote={
              permissions.canCreatePlansAndQuotes ? (teeth) => setQuoteTeeth(teeth) : undefined
            }
          />
        </div>
      )}

      {activeTab === 'timeline' && (
        <PatientTimeline
          clinicalNotes={clinicalNotes}
          clinicalActs={patientClinicalActs}
          medicalDocuments={patientMedicalDocs}
          imagingList={imagingList}
          treatmentPlans={patientPlans}
          invoices={patientInvoices}
          payments={patientPayments}
          labOrders={patientLabOrders}
          appointments={patientAppointmentHistory}
          recalls={patientRecalls}
          canViewFinancialTotals={permissions.canViewFinancialTotals}
          onOpenTab={setActiveTab}
          onPrintMedicalDocument={handlePrintMedicalDocument}
          onPrintTreatmentPlan={handlePrintTreatmentPlan}
          onSelectImaging={(img) => setSelectedImage(img)}
        />
      )}

      {activeTab === 'notes' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Actes Cliniques & Historique des Soins ({patientClinicalActs.length + clinicalNotes.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Date, Date de réalisation, N° patient, Acte, Dents, Prix, Reçu, Reste, Praticien et Statut
                </p>
              </div>
              {permissions.canEditOdontogramAndNotes && (
                <button
                  type="button"
                  onClick={() => {
                    const defaultAct = actsCatalog[0];
                    setSplitActPerTooth(false);
                    setNoteForm({
                      tooth: '',
                      faces: '',
                      actName: defaultAct?.name || 'Consultation & Bilan complet',
                      actCode: defaultAct?.code || 'C01',
                      materials: '',
                      report: '',
                      amount: defaultAct?.defaultPrice || 300,
                    });
                    setShowNoteModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Ajouter un acte</span>
                </button>
              )}
            </div>

            {clinicalNotes.length > 0 && (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800 pb-3">
                {clinicalNotes.map((n) => (
                  <div key={n.id} className="py-3 flex flex-wrap items-start justify-between gap-4">
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
                    {permissions.canViewFinancialTotals && (
                      <div className="text-right text-xs tabular-nums">
                        <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{formatMAD(n.amount)}</p>
                        <p className={n.billed ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                          {n.billed ? 'Facturé' : 'À facturer'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {patientClinicalActs.length === 0 && clinicalNotes.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Aucun acte clinique enregistré pour ce patient.
              </p>
            ) : patientClinicalActs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      <th className="px-3 py-2.5 font-medium">Date</th>
                      <th className="px-3 py-2.5 font-medium">Date de réalisation</th>
                      <th className="px-3 py-2.5 font-medium">N° Patient</th>
                      <th className="px-3 py-2.5 font-medium">Patient</th>
                      <th className="px-3 py-2.5 font-medium">Acte</th>
                      <th className="px-3 py-2.5 font-medium">Dents</th>
                      {permissions.canViewFinancialTotals && (
                        <>
                          <th className="px-3 py-2.5 font-medium text-right">Prix</th>
                          <th className="px-3 py-2.5 font-medium text-right">Reçu</th>
                          <th className="px-3 py-2.5 font-medium text-right">Reste</th>
                        </>
                      )}
                      <th className="px-3 py-2.5 font-medium">Praticien</th>
                      <th className="px-3 py-2.5 font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {patientClinicalActs.map((act) => (
                      <tr key={act.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {act.date ? formatDateFR(act.date) : '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {act.realizationDate ? formatDateFR(act.realizationDate) : '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {act.patientFileNumber}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {act.patientName}
                        </td>
                        <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 min-w-[220px]">
                          {act.actName}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-sky-700 dark:text-sky-400 whitespace-nowrap">
                          {act.teeth || '—'}
                        </td>
                        {permissions.canViewFinancialTotals && (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                              {formatMAD(act.price)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                              {formatMAD(act.receivedAmount)}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                act.remainingAmount > 0
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {formatMAD(act.remainingAmount)}
                            </td>
                          </>
                        )}
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {act.practitionerName}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                              act.status === 'Fini'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : act.status === 'En cours'
                                ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300'
                                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {act.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
              clinicalActs={clinicalActs}
              canNavigateFinance={permissions.canViewFinancialTotals}
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
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 min-h-[40px]"
                >
                  <option value="Photo Clinique">Photo Clinique</option>
                  <option value="Cliché Intra-oral">Cliché Intra-oral</option>
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
                  className="w-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-3 py-2 min-h-[40px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAnnotateTargetImage(null);
                    setCaptureInitialCategory(uploadCategory || 'Photo Clinique');
                    setShowQuickCaptureModal(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#163B63] dark:bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 transition-colors min-h-[40px]"
                >
                  <Camera className="h-3.5 w-3.5 shrink-0" />
                  <span>Caméra / Intra-oral</span>
                </button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[40px]">
                  <Upload className="h-3.5 w-3.5 shrink-0" />
                  <span>Importer fichier</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
            </div>
          )}

          {/* Diagnostic Analysis Console */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
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

            <div className="lg:col-span-8 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
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
                  {permissions.canUploadImaging && selectedImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setAnnotateTargetImage(selectedImage);
                        setShowQuickCaptureModal(true);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-2.5 py-1 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>Annoter</span>
                    </button>
                  )}
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
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Plans de Traitement & Devis ({patientPlans.length})
                </h3>
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
                    <div key={pl.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          Devis N° {pl.quoteNumber} · {pl.status}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                          {pl.quoteDate ? `Du ${formatDateFR(pl.quoteDate)}` : ''}
                          {pl.validityDate ? ` · Valide jusqu'au ${formatDateFR(pl.validityDate)}` : ''}
                          {' · '}{pl.practitionerName}
                        </p>
                        {pl.rawActsText ? (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line mt-1">
                            {pl.rawActsText}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{pl.title}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatMAD(pl.totalAmount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handlePrintTreatmentPlan(pl)}
                          title="Imprimer le devis"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <Printer className="h-3 w-3" />
                          <span>Imprimer</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Factures ({patientInvoices.length}) & Documents ({patientMedicalDocs.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveSection('documents')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Ordonnances & Documents</span>
                </button>
              </div>
              {patientInvoices.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Aucune facture émise.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {patientInvoices.map((inv) => (
                    <div key={inv.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                          Facture {inv.invoiceNumber}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                          {formatDateFR(inv.issueDate)} · {inv.status}
                          {inv.practitionerName ? ` · ${inv.practitionerName}` : ''}
                        </p>
                        {inv.rawActsText && (
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line mt-1">
                            {inv.rawActsText}
                          </p>
                        )}
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
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

          {/* Paiements & Documents médicaux du patient */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Encaissements Patient ({patientPayments.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveSection('payments')}
                  className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  Voir tous les paiements
                </button>
              </div>
              {patientPayments.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Aucun encaissement enregistré.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {patientPayments.map((pay) => (
                    <div key={pay.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {pay.actName || pay.receiptNumber}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatDateFR(pay.date)} · {pay.rawMethod || pay.method}
                          {pay.actCode ? ` · Code ${pay.actCode}` : ''}
                          {pay.enteredBy ? ` · Saisi par ${pay.enteredBy}` : ''}
                        </p>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <p className={`font-semibold ${pay.amount < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                          {formatMAD(pay.amount)}
                        </p>
                        {pay.remainingBalance !== undefined && (
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            Reste : {formatMAD(pay.remainingBalance)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Ordonnances, Certificats & Feuilles ({patientMedicalDocs.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveSection('documents')}
                  className="text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  Ouvrir Documents
                </button>
              </div>
              {patientMedicalDocs.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Aucun document médical associé.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {patientMedicalDocs.map((docItem) => (
                    <div key={docItem.id} className="py-2.5 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {docItem.docType} — {docItem.title}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {formatDateFR(docItem.date)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handlePrintMedicalDocument(docItem)}
                            title="Imprimer le document"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            <Printer className="h-3 w-3" />
                            <span>Imprimer</span>
                          </button>
                        </div>
                      </div>
                      {(docItem.medicationsText || docItem.actsText || docItem.bodyText) && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-line">
                          {docItem.medicationsText || docItem.actsText || docItem.bodyText}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                  Prochains rendez-vous &amp; Rappels (SMS, WhatsApp, Appel)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Les rappels SMS automatiques s&apos;exécutent selon le délai configuré dans Paramètres. Vous pouvez aussi relancer par WhatsApp ou Appel.
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
                  const normalizedStatus = (apt.reminderStatus || '').toUpperCase();
                  const reminderAlreadySent =
                    normalizedStatus.startsWith('SMS') ||
                    normalizedStatus.startsWith('WHATSAPP') ||
                    normalizedStatus.startsWith('APPEL') ||
                    patientReminderHistory.some((r) => (r.notes || '').includes(`[RDV:${apt.id}]`));
                  const isBusy =
                    sendingAptAction === `${apt.id}:SMS` ||
                    sendingAptAction === `${apt.id}:WhatsApp` ||
                    sendingAptAction === `${apt.id}:Appel`;
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
                              reminderAlreadySent
                                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                : 'font-medium text-amber-700 dark:text-amber-400'
                            }
                          >
                            {apt.reminderStatus || 'Non envoyé'}
                          </span>
                        </p>
                      </div>

                      {permissions.canManageRecalls && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleManualReminderSend(apt.id, 'SMS')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-2.5 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 disabled:opacity-60 whitespace-nowrap"
                          >
                            <Send className="h-3.5 w-3.5" />
                            <span>
                              {sendingAptAction === `${apt.id}:SMS` ? 'Envoi...' : 'SMS'}
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleManualReminderSend(apt.id, 'WhatsApp')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-60 whitespace-nowrap"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>WhatsApp</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleManualReminderSend(apt.id, 'Appel')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 disabled:opacity-60 whitespace-nowrap"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            <span>Appel</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historique chronologique des rappels (SMS, WhatsApp, Appel) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#1598C7] dark:text-sky-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Historique des rappels — SMS, WhatsApp &amp; Appel ({patientReminderHistory.length})
              </h3>
            </div>

            {!permissions.canManageRecalls ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                L&apos;historique détaillé des rappels est accessible aux praticiens et au secrétariat.
              </p>
            ) : patientReminderHistory.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Aucun rappel enregistré pour ce patient pour le moment.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {patientReminderHistory.map((sms) => {
                  const messageBody = stripRecallAppointmentTag(sms.notes);
                  const isDelivered = sms.deliveryStatus === 'Délivré' || sms.deliveryStatus === 'Lu';
                  const isFailed = sms.deliveryStatus === 'Échec';
                  return (
                    <div key={sms.id} className="py-3.5 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                              sms.channel === 'WhatsApp'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : sms.channel === 'Appel'
                                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                            }`}
                          >
                            {sms.channel === 'WhatsApp' ? (
                              <MessageCircle className="h-3 w-3" />
                            ) : sms.channel === 'Appel' ? (
                              <Phone className="h-3 w-3" />
                            ) : (
                              <MessageSquare className="h-3 w-3" />
                            )}
                            <span>{sms.channel}</span>
                          </span>
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
      {quoteTeeth && quoteTeeth.length > 0 && selectedPatient && (
        <OdontogramQuoteModal
          patient={selectedPatient}
          selectedTeeth={quoteTeeth}
          odontogram={selectedPatient.odontogram || {}}
          actsCatalog={actsCatalog}
          canSaveQuote={permissions.canCreatePlansAndQuotes}
          practitionerName={
            staffList.find(
              (s) =>
                s.uid === selectedPatient.assignedPractitionerId ||
                s.id === selectedPatient.assignedPractitionerId
            )?.displayName ||
            staffProfile?.displayName ||
            'Praticien'
          }
          onSaveAndPrint={handleSaveAndPrintOdontogramQuote}
          onPrintOnly={(title, items) => {
            setQuoteTeeth(null);
            openQuotePrintPreview(title, items);
          }}
          onClose={() => setQuoteTeeth(null)}
        />
      )}

      {showQuickCaptureModal && selectedPatient && user && (
        <QuickImagingCaptureModal
          patient={selectedPatient}
          userUid={user.uid}
          initialCategory={captureInitialCategory}
          initialToothRef={uploadToothRef}
          initialImageToAnnotate={annotateTargetImage}
          onEnsurePatientExists={ensureCsvPatientSynced}
          onClose={() => {
            setShowQuickCaptureModal(false);
            setAnnotateTargetImage(null);
          }}
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
          saving={savingPatient}
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
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
          <div className="my-auto w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
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
                      {permissions.canViewFinancialTotals
                        ? `${a.code} — ${a.name} (${formatMAD(a.defaultPrice)})`
                        : `${a.code} — ${a.name}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`grid grid-cols-1 ${permissions.canViewFinancialTotals ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2.5`}>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Dent(s) (FDI)</label>
                  <input
                    value={noteForm.tooth}
                    onChange={(e) => setNoteForm({ ...noteForm, tooth: e.target.value })}
                    placeholder="Ex: 36 ou 14,15,16"
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
                {permissions.canViewFinancialTotals && (
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
                )}
              </div>
              {(() => {
                const multiTeeth = noteForm.tooth
                  .split(/[\s,;]+/)
                  .map((t) => t.trim())
                  .filter(Boolean);
                if (multiTeeth.length <= 1) return null;
                return (
                  <label className="flex items-start gap-2 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50/70 dark:bg-sky-950/50 p-2.5 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitActPerTooth}
                      onChange={(e) => setSplitActPerTooth(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>
                      Créer une ligne d&apos;acte distincte pour chacune des <strong>{multiTeeth.length} dents</strong> ({multiTeeth.join(', ')}) au tarif unitaire de {formatMAD(Number(noteForm.amount) || 0)}.
                    </span>
                  </label>
                );
              })()}
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
              <div className="flex flex-wrap-reverse sm:flex-nowrap justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => setShowNoteModal(false)}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingNote}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-0 rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {savingNote ? 'Enregistrement...' : "Enregistrer l'acte"}
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
  saving?: boolean;
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
  saving = false,
  form,
  setForm,
  practitioners,
  disablePractitionerSelect,
  canEditMedical,
  onClose,
  onSubmit,
}) => (
  <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 dark:bg-slate-950/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
    <div className="my-auto w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-xl max-h-[90dvh] overflow-y-auto">
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
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Téléphone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+212 6..."
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Anamnèse & Alertes Médicales Critiques</p>
              <label className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-300 font-medium">
                <input
                  type="checkbox"
                  checked={form.hasCriticalAlert}
                  onChange={(e) => setForm({ ...form, hasCriticalAlert: e.target.checked })}
                />
                <span>Bandeau d'alerte critique</span>
              </label>
            </div>
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

        <div className="flex flex-wrap-reverse sm:flex-nowrap justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer le dossier'}
          </button>
        </div>
      </form>
    </div>
  </div>
);
