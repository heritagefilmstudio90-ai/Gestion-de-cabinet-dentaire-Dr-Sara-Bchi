import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { DEFAULT_ACTS_CATALOG, resetClinicDataToZero, seedClinicDemoData } from '../data/dentalCatalog';
import { generateSafeId } from '../lib/formatters';
import {
  buildRecallSmsNotes,
  formatSmsReminderMessage,
  isAppointmentDueForSmsReminder,
  resolveSmsReminderSettings,
} from '../lib/smsReminders';
import {
  ActivityCategory,
  ActivityLogEntry,
  AdminDocument,
  Appointment,
  AppSection,
  BookingRequest,
  CashClosure,
  CatalogAct,
  ClinicSettings,
  Expense,
  Invoice,
  LabOrder,
  MedicalDocument,
  Patient,
  Payment,
  PrintableDocumentPayload,
  Recall,
  RolePermissions,
  StaffInvite,
  StaffMember,
  StaffRole,
  StockMovement,
  InventoryItem,
  TreatmentPlan,
  getPermissionsForRole,
} from '../types/dental';

const BOOTSTRAP_ADMIN_EMAIL = 'heritagefilmstudio90@gmail.com';

function mapFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const message = err instanceof Error ? err.message : String(err || '');

  if (code === 'auth/popup-blocked') {
    return "La fenêtre de connexion Google a été bloquée par le navigateur ou l'aperçu intégré. Cliquez sur « Ouvrir dans un nouvel onglet » ou utilisez la connexion par redirection.";
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return "La fenêtre de connexion Google a été fermée avant la fin de l'authentification.";
  }
  if (code === 'auth/unauthorized-domain') {
    return "Ce domaine d'aperçu n'est pas encore autorisé pour le popup Google. Essayez d'ouvrir l'application dans un nouvel onglet.";
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return "La connexion par fenêtre popup n'est pas prise en charge dans cet onglet intégré. Ouvrez l'application dans un nouvel onglet.";
  }
  if (code === 'auth/network-request-failed') {
    return 'Erreur réseau lors de la connexion à Google. Vérifiez votre connexion Internet.';
  }
  if (code === 'permission-denied' || message.includes('PERMISSION_DENIED') || message.includes('Missing or insufficient permissions')) {
    return "Accès refusé par les règles Firestore lors de la vérification du profil. Vérifiez que votre compte Google possède un email vérifié et les droits d'accès.";
  }
  if (code === 'unavailable' || message.includes('client is offline')) {
    return 'Serveur Firebase temporairement inaccessible. Vérifiez votre connexion Internet et réessayez.';
  }
  return message || "Erreur lors de l'authentification Google.";
}

interface ClinicContextValue {
  user: User | null;
  authLoading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  staffProfile: StaffMember | null;
  accessPending: boolean;
  actualRole: StaffRole;
  activeRole: StaffRole;
  setPreviewRole: (role: StaffRole) => void;
  permissions: RolePermissions;
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
  openPatientFile: (patientId: string) => void;
  agendaFocus: { date: string; appointmentId?: string } | null;
  openAgendaAt: (date: string, appointmentId?: string) => void;
  clearAgendaFocus: () => void;
  clinicSettings: ClinicSettings | null;
  staffList: StaffMember[];
  staffInvites: StaffInvite[];
  patients: Patient[];
  appointments: Appointment[];
  bookingRequests: BookingRequest[];
  actsCatalog: CatalogAct[];
  treatmentPlans: TreatmentPlan[];
  invoices: Invoice[];
  payments: Payment[];
  labOrders: LabOrder[];
  medicalDocuments: MedicalDocument[];
  recalls: Recall[];
  expenses: Expense[];
  cashClosures: CashClosure[];
  inventory: InventoryItem[];
  stockMovements: StockMovement[];
  adminDocuments: AdminDocument[];
  hasPendingSync: boolean;
  favoritePatientIds: string[];
  toggleFavoritePatient: (patientId: string) => void;
  sendAppointmentSmsReminder: (apt: Appointment, options?: { isAuto?: boolean }) => Promise<boolean>;
  runDueSmsReminders: (manual?: boolean) => Promise<number>;
  activityLogs: ActivityLogEntry[];
  logActivity: (
    entry: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'actorName' | 'actorRole'>
  ) => void;
  clearActivityLogs: () => void;
  printableDoc: PrintableDocumentPayload | null;
  setPrintableDoc: (docPayload: PrintableDocumentPayload | null) => void;
  toastMessage: { text: string; tone: 'success' | 'error' | 'info' } | null;
  showToast: (text: string, tone?: 'success' | 'error' | 'info') => void;
  signInWithGoogle: () => Promise<void>;
  signInWithGoogleRedirect: () => Promise<void>;
  refreshAuthAccess: () => Promise<void>;
  logout: () => Promise<void>;
  runDemoSeed: () => Promise<void>;
  resetBetaToZero: () => Promise<void>;
  saveRecord: (collectionName: string, id: string, data: Record<string, unknown>, isCreate?: boolean) => Promise<void>;
  removeRecord: (collectionName: string, id: string) => Promise<void>;
  incrementCounter: (counterKey: 'invoiceCounter' | 'quoteCounter' | 'receiptCounter') => Promise<number>;
}

const MAX_ACTIVITY_LOGS = 60;

function toIsoTimestamp(value: unknown, fallbackIso?: string): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return fallbackIso || new Date().toISOString();
    }
  }
  if (typeof value === 'string' && value.length >= 10) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return fallbackIso || new Date().toISOString();
}

const ClinicContext = createContext<ClinicContextValue | null>(null);

export const ClinicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [staffProfile, setStaffProfile] = useState<StaffMember | null>(null);
  const [accessPending, setAccessPending] = useState(false);
  const [previewRole, setPreviewRole] = useState<StaffRole>('titulaire');
  const [activeSection, setActiveSection] = useState<AppSection>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [agendaFocus, setAgendaFocus] = useState<{ date: string; appointmentId?: string } | null>(null);

  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bookingRequests, setBookingRequests] = useState<BookingRequest[]>([]);
  const [actsCatalog, setActsCatalog] = useState<CatalogAct[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [medicalDocuments, setMedicalDocuments] = useState<MedicalDocument[]>([]);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cashClosures, setCashClosures] = useState<CashClosure[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [adminDocuments, setAdminDocuments] = useState<AdminDocument[]>([]);

  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});
  const [favoritePatientIds, setFavoritePatientIds] = useState<string[]>([]);
  const dispatchedSmsAptIdsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [activityStorageReady, setActivityStorageReady] = useState(false);
  const [printableDoc, setPrintableDocState] = useState<PrintableDocumentPayload | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((text: string, tone: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage({ text, tone });
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const resolveStaffProfile = useCallback(async (firebaseUser: User) => {
    setAuthError(null);
    if (!firebaseUser.emailVerified) {
      setStaffProfile(null);
      setAccessPending(false);
      setAuthError("Votre adresse email Google n'est pas vérifiée.");
      return;
    }

    try {
      const staffRef = doc(db, 'staff', firebaseUser.uid);
      let staffSnap = await getDoc(staffRef);

      if (!staffSnap.exists()) {
        const normalizedEmail = (firebaseUser.email || '').toLowerCase();
        if (normalizedEmail === BOOTSTRAP_ADMIN_EMAIL) {
          const profileData = {
            uid: firebaseUser.uid,
            email: normalizedEmail,
            displayName: 'Dr. Sara Bchi',
            role: 'titulaire' as StaffRole,
            specialty: 'Chirurgien - Dentiste',
            chairName: 'Fauteuil 1',
            color: '#0284C7',
            active: true,
            inviteId: 'bootstrap',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(staffRef, profileData);
          staffSnap = await getDoc(staffRef);
        } else {
          const inviteQ = query(
            collection(db, 'staffInvites'),
            where('email', '==', normalizedEmail),
            limit(1)
          );
          const inviteSnaps = await getDocs(inviteQ);
          if (!inviteSnaps.empty) {
            const invDoc = inviteSnaps.docs[0];
            const inv = invDoc.data() as Omit<StaffInvite, 'id'>;
            await setDoc(staffRef, {
              uid: firebaseUser.uid,
              email: normalizedEmail || inv.email,
              displayName: firebaseUser.displayName || inv.displayName,
              role: inv.role,
              specialty: inv.specialty || '',
              chairName: inv.chairName || '',
              color: inv.color || '#0284C7',
              active: true,
              inviteId: invDoc.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            staffSnap = await getDoc(staffRef);
          }
        }
      }

      if (staffSnap.exists()) {
        const data = staffSnap.data() as Omit<StaffMember, 'id'>;
        let profile: StaffMember = { id: staffSnap.id, ...data };

        // Sync Titulaire profile name to Dr. Sara Bchi once if still using generic/Google bootstrap name
        if (
          profile.role === 'titulaire' &&
          profile.inviteId === 'bootstrap' &&
          window.localStorage.getItem('dentaflow_sarabchi_profile_synced_v1') !== '1'
        ) {
          try {
            if (profile.displayName !== 'Dr. Sara Bchi' || profile.specialty !== 'Chirurgien - Dentiste') {
              await updateDoc(staffRef, {
                displayName: 'Dr. Sara Bchi',
                specialty: 'Chirurgien - Dentiste',
                updatedAt: serverTimestamp(),
              });
              profile = {
                ...profile,
                displayName: 'Dr. Sara Bchi',
                specialty: 'Chirurgien - Dentiste',
              };
            }
            window.localStorage.setItem('dentaflow_sarabchi_profile_synced_v1', '1');
          } catch (syncProfileErr) {
            console.warn('Mise à jour automatique du profil Titulaire ignorée:', syncProfileErr);
          }
        }

        setStaffProfile(profile);
        setPreviewRole(profile.role);
        setAccessPending(!profile.active);

        // Auto-initialize clean zeroed beta state once for Titulaire (never auto-seeds demo data)
        if (profile.role === 'titulaire') {
          try {
            const clinicRef = doc(db, 'settings', 'clinic');
            const clinicSnap = await getDoc(clinicRef);
            const clinicData = clinicSnap.exists()
              ? (clinicSnap.data() as Partial<ClinicSettings>)
              : null;

            if (!clinicSnap.exists() || clinicData?.betaZeroInitialized !== true) {
              await resetClinicDataToZero(firebaseUser.uid, profile.displayName || 'Dr. Sara Bchi');
              try {
                window.localStorage.setItem(`dentaflow_activity_log_${firebaseUser.uid}`, JSON.stringify([]));
                window.localStorage.setItem(`dentaflow_favorite_patients_${firebaseUser.uid}`, JSON.stringify([]));
              } catch {
                // Ignore storage quota errors
              }
              setFavoritePatientIds([]);
              setActivityLogs([]);
              setActivityStorageReady(true);
              window.localStorage.setItem('dentaflow_sarabchi_settings_synced_v1', '1');
            }
          } catch (seedErr) {
            console.warn('Initialisation / remise à zéro des paramètres du cabinet ignorée:', seedErr);
          }
        }
      } else {
        setStaffProfile(null);
        setAccessPending(true);
      }
    } catch (err) {
      console.error('Erreur initialisation profil:', err);
      setStaffProfile(null);
      setAccessPending(false);
      setAuthError(mapFirebaseAuthError(err));
    }
  }, []);

  useEffect(() => {
    void getRedirectResult(auth).catch((err) => {
      console.error('Erreur retour redirection Google:', err);
      setAuthError(mapFirebaseAuthError(err));
    });

    const resetSessionCollections = () => {
      setPreviewRole('titulaire');
      setActiveSection('dashboard');
      setSelectedPatientId(null);
      setAgendaFocus(null);
      setClinicSettings(null);
      setStaffList([]);
      setStaffInvites([]);
      setPatients([]);
      setAppointments([]);
      setBookingRequests([]);
      setActsCatalog([]);
      setTreatmentPlans([]);
      setInvoices([]);
      setPayments([]);
      setLabOrders([]);
      setMedicalDocuments([]);
      setRecalls([]);
      setExpenses([]);
      setCashClosures([]);
      setInventory([]);
      setStockMovements([]);
      setAdminDocuments([]);
      setPendingMap({});
      dispatchedSmsAptIdsRef.current.clear();
    };

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setStaffProfile(null);
        setAccessPending(false);
        resetSessionCollections();
        setAuthLoading(false);
        return;
      }

      setAuthLoading(true);
      await resolveStaffProfile(firebaseUser);
      setAuthLoading(false);
    });

    return () => unsub();
  }, [resolveStaffProfile]);

  const actualRole: StaffRole = staffProfile?.role || 'secretaire';
  const activeRole: StaffRole = actualRole === 'titulaire' ? previewRole : actualRole;
  const permissions = useMemo(() => getPermissionsForRole(activeRole), [activeRole]);

  // Attach real-time Firestore listeners scoped to the authenticated user's actual RBAC role
  useEffect(() => {
    if (!user || !staffProfile || !staffProfile.active) return;

    const unsubscribers: Array<() => void> = [];
    const trackPending = (key: string, pending: boolean) => {
      setPendingMap((prev) => (prev[key] === pending ? prev : { ...prev, [key]: pending }));
    };

    // Settings
    unsubscribers.push(
      onSnapshot(
        doc(db, 'settings', 'clinic'),
        (snap) => {
          trackPending('settings', snap.metadata.hasPendingWrites);
          if (snap.exists()) {
            setClinicSettings({ id: snap.id, ...(snap.data() as Omit<ClinicSettings, 'id'>) });
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'settings/clinic')
      )
    );

    // Staff
    unsubscribers.push(
      onSnapshot(
        collection(db, 'staff'),
        (snap) => {
          trackPending('staff', snap.metadata.hasPendingWrites);
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffMember, 'id'>) }));
          list.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'fr'));
          setStaffList(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'staff')
      )
    );

    // Acts catalog
    unsubscribers.push(
      onSnapshot(
        collection(db, 'actsCatalog'),
        (snap) => {
          trackPending('actsCatalog', snap.metadata.hasPendingWrites);
          if (snap.empty) {
            setActsCatalog(
              DEFAULT_ACTS_CATALOG.map((a) => ({ ...a, createdAt: null })).sort((a, b) =>
                (a.code || '').localeCompare(b.code || '', 'fr')
              )
            );
          } else {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CatalogAct, 'id'>) }));
            list.sort((a, b) => (a.code || '').localeCompare(b.code || '', 'fr'));
            setActsCatalog(list);
          }
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'actsCatalog')
      )
    );

    // Staff invites (Titulaire only)
    if (actualRole === 'titulaire') {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'staffInvites'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffInvite, 'id'>) }));
            list.sort((a, b) => (a.email || '').localeCompare(b.email || '', 'fr'));
            setStaffInvites(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'staffInvites')
        )
      );
    }

    // Patients
    const patientsQuery =
      actualRole === 'collaborateur'
        ? query(collection(db, 'patients'), where('assignedPractitionerId', '==', user.uid))
        : collection(db, 'patients');
    unsubscribers.push(
      onSnapshot(
        patientsQuery,
        (snap) => {
          trackPending('patients', snap.metadata.hasPendingWrites);
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Patient, 'id'>) }));
          list.sort((a, b) => (a.fileNumber || '').localeCompare(b.fileNumber || '', 'fr'));
          setPatients(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'patients')
      )
    );

    // Appointments
    const aptQuery =
      actualRole === 'collaborateur'
        ? query(collection(db, 'appointments'), where('practitionerId', '==', user.uid))
        : collection(db, 'appointments');
    unsubscribers.push(
      onSnapshot(
        aptQuery,
        (snap) => {
          trackPending('appointments', snap.metadata.hasPendingWrites);
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Appointment, 'id'>) }));
          list.sort((a, b) => `${a.date || ''}T${a.startTime || ''}`.localeCompare(`${b.date || ''}T${b.startTime || ''}`));
          setAppointments(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'appointments')
      )
    );

    // Booking requests (Titulaire & Secrétaire)
    if (actualRole === 'titulaire' || actualRole === 'secretaire') {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'bookingRequests'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BookingRequest, 'id'>) }));
            list.sort((a, b) => `${b.preferredDate || ''}T${b.preferredSlot || ''}`.localeCompare(`${a.preferredDate || ''}T${a.preferredSlot || ''}`));
            setBookingRequests(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'bookingRequests')
        )
      );
    }

    // Treatment plans
    if (actualRole !== 'assistant') {
      const plansQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'treatmentPlans'), where('practitionerId', '==', user.uid))
          : collection(db, 'treatmentPlans');
      unsubscribers.push(
        onSnapshot(
          plansQ,
          (snap) => {
            trackPending('treatmentPlans', snap.metadata.hasPendingWrites);
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TreatmentPlan, 'id'>) }));
            list.sort((a, b) => (b.quoteNumber || '').localeCompare(a.quoteNumber || '', 'fr'));
            setTreatmentPlans(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'treatmentPlans')
        )
      );

      // Invoices
      const invQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'invoices'), where('practitionerId', '==', user.uid))
          : collection(db, 'invoices');
      unsubscribers.push(
        onSnapshot(
          invQ,
          (snap) => {
            trackPending('invoices', snap.metadata.hasPendingWrites);
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invoice, 'id'>) }));
            list.sort((a, b) => `${b.issueDate || ''}_${b.invoiceNumber || ''}`.localeCompare(`${a.issueDate || ''}_${a.invoiceNumber || ''}`));
            setInvoices(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'invoices')
        )
      );

      // Payments
      const payQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'payments'), where('practitionerId', '==', user.uid))
          : collection(db, 'payments');
      unsubscribers.push(
        onSnapshot(
          payQ,
          (snap) => {
            trackPending('payments', snap.metadata.hasPendingWrites);
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payment, 'id'>) }));
            list.sort((a, b) => `${b.date || ''}_${b.receiptNumber || ''}`.localeCompare(`${a.date || ''}_${a.receiptNumber || ''}`));
            setPayments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
        )
      );

      // Medical Documents
      const docQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'medicalDocuments'), where('practitionerId', '==', user.uid))
          : collection(db, 'medicalDocuments');
      unsubscribers.push(
        onSnapshot(
          docQ,
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MedicalDocument, 'id'>) }));
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setMedicalDocuments(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'medicalDocuments')
        )
      );

      // Recalls
      unsubscribers.push(
        onSnapshot(
          collection(db, 'recalls'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Recall, 'id'>) }));
            list.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
            setRecalls(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'recalls')
        )
      );
    }

    // Lab orders
    const labQ =
      actualRole === 'collaborateur'
        ? query(collection(db, 'labOrders'), where('practitionerId', '==', user.uid))
        : collection(db, 'labOrders');
    unsubscribers.push(
      onSnapshot(
        labQ,
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabOrder, 'id'>) }));
          list.sort((a, b) => (b.orderNumber || '').localeCompare(a.orderNumber || '', 'fr'));
          setLabOrders(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'labOrders')
      )
    );

    // Expenses (Titulaire only)
    if (actualRole === 'titulaire') {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'expenses'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Expense, 'id'>) }));
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setExpenses(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'expenses')
        )
      );
    }

    // Cash closures (Titulaire & Secrétaire)
    if (actualRole === 'titulaire' || actualRole === 'secretaire') {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'cashClosures'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CashClosure, 'id'>) }));
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setCashClosures(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'cashClosures')
        )
      );
    }

    // Inventory & movements (Titulaire & Assistant)
    if (actualRole === 'titulaire' || actualRole === 'assistant') {
      unsubscribers.push(
        onSnapshot(
          collection(db, 'inventory'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, 'id'>) }));
            list.sort((a, b) => (a.sku || a.name || '').localeCompare(b.sku || b.name || '', 'fr'));
            setInventory(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'inventory')
        )
      );
      unsubscribers.push(
        onSnapshot(
          collection(db, 'stockMovements'),
          (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockMovement, 'id'>) }));
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setStockMovements(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'stockMovements')
        )
      );
    }

    // Administrative documents (licenses & maintenance contracts)
    unsubscribers.push(
      onSnapshot(
        collection(db, 'adminDocuments'),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminDocument, 'id'>) }));
          list.sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));
          setAdminDocuments(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'adminDocuments')
      )
    );

    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, [user, staffProfile, actualRole]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const friendly = mapFirebaseAuthError(err);
      setAuthError(friendly);
      throw new Error(friendly);
    }
  };

  const signInWithGoogleRedirect = async () => {
    setAuthError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      const friendly = mapFirebaseAuthError(err);
      setAuthError(friendly);
      throw new Error(friendly);
    }
  };

  const refreshAuthAccess = async () => {
    if (!auth.currentUser) return;
    setAuthLoading(true);
    await resolveStaffProfile(auth.currentUser);
    setAuthLoading(false);
  };

  const logout = async () => {
    setAuthError(null);
    setStaffProfile(null);
    setAccessPending(false);
    setPreviewRole('titulaire');
    setSelectedPatientId(null);
    setAgendaFocus(null);
    await signOut(auth);
  };

  const activityStorageKey = user ? `dentaflow_activity_log_${user.uid}` : null;
  const favoritesStorageKey = user ? `dentaflow_favorite_patients_${user.uid}` : null;

  useEffect(() => {
    if (!favoritesStorageKey) {
      setFavoritePatientIds([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(favoritesStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setFavoritePatientIds(parsed.filter((id): id is string => typeof id === 'string'));
          return;
        }
      }
      setFavoritePatientIds([]);
    } catch {
      setFavoritePatientIds([]);
    }
  }, [favoritesStorageKey]);

  const toggleFavoritePatient = useCallback(
    (patientId: string) => {
      setFavoritePatientIds((prev) => {
        const exists = prev.includes(patientId);
        const updated = exists ? prev.filter((id) => id !== patientId) : [patientId, ...prev];
        if (favoritesStorageKey) {
          try {
            window.localStorage.setItem(favoritesStorageKey, JSON.stringify(updated));
          } catch {
            // Ignore storage quota errors
          }
        }
        return updated;
      });
    },
    [favoritesStorageKey]
  );

  useEffect(() => {
    if (!activityStorageKey) {
      setActivityLogs([]);
      setActivityStorageReady(false);
      return;
    }
    try {
      const raw = window.localStorage.getItem(activityStorageKey);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setActivityLogs(parsed.slice(0, MAX_ACTIVITY_LOGS));
        }
        setActivityStorageReady(true);
      } else {
        setActivityLogs([]);
        setActivityStorageReady(false);
      }
    } catch {
      setActivityLogs([]);
      setActivityStorageReady(true);
    }
  }, [activityStorageKey]);

  // Real-time cross-tab synchronization for favorites and activity journal
  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      if (!e.key || e.newValue === null) return;
      if (favoritesStorageKey && e.key === favoritesStorageKey) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            setFavoritePatientIds(parsed.filter((id): id is string => typeof id === 'string'));
          }
        } catch {
          // Ignore malformed JSON
        }
      }
      if (activityStorageKey && e.key === activityStorageKey) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            setActivityLogs(parsed.slice(0, MAX_ACTIVITY_LOGS));
            setActivityStorageReady(true);
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, [favoritesStorageKey, activityStorageKey]);

  // Seed initial readable clinic operations once on a fresh session from loaded Firestore records
  useEffect(() => {
    if (!activityStorageKey || activityStorageReady || !staffProfile) return;
    if (
      patients.length === 0 &&
      appointments.length === 0 &&
      invoices.length === 0 &&
      payments.length === 0
    ) {
      return;
    }

    const seededEntries: ActivityLogEntry[] = [];
    for (const inv of invoices.slice(0, 4)) {
      seededEntries.push({
        id: `seed_inv_${inv.id}`,
        timestamp: toIsoTimestamp(inv.updatedAt || inv.createdAt, `${inv.issueDate}T10:30:00`),
        category: 'facturation',
        title: `Facture ${inv.invoiceNumber} · ${inv.status}`,
        detail: `${inv.patientName} · ${Number(inv.totalAmount || 0).toLocaleString('fr-FR')} MAD`,
        actorName: inv.practitionerName || staffProfile.displayName,
        actorRole: staffProfile.role,
        section: 'invoices',
        patientId: inv.patientId,
      });
    }
    for (const apt of appointments.slice(0, 4)) {
      seededEntries.push({
        id: `seed_apt_${apt.id}`,
        timestamp: toIsoTimestamp(apt.updatedAt || apt.createdAt, `${apt.date}T${apt.startTime || '09:00'}:00`),
        category: 'planning',
        title: `RDV ${apt.status} · ${apt.patientName}`,
        detail: `${apt.actType} · ${apt.date} à ${apt.startTime} (${apt.chair})`,
        actorName: apt.practitionerName || staffProfile.displayName,
        actorRole: staffProfile.role,
        section: 'appointments',
        patientId: apt.patientId,
      });
    }
    for (const pay of payments.slice(0, 3)) {
      seededEntries.push({
        id: `seed_pay_${pay.id}`,
        timestamp: toIsoTimestamp(pay.createdAt, `${pay.date}T11:15:00`),
        category: 'facturation',
        title: `Paiement reçu · ${pay.receiptNumber}`,
        detail: `${pay.patientName} · ${Number(pay.amount || 0).toLocaleString('fr-FR')} MAD (${pay.method})`,
        actorName: staffProfile.displayName,
        actorRole: staffProfile.role,
        section: 'payments',
        patientId: pay.patientId,
      });
    }
    for (const lab of labOrders.slice(0, 2)) {
      seededEntries.push({
        id: `seed_lab_${lab.id}`,
        timestamp: toIsoTimestamp(lab.updatedAt || lab.createdAt),
        category: 'logistique',
        title: `Prothèse ${lab.orderNumber} · ${lab.status}`,
        detail: `${lab.patientName} · ${lab.labName}`,
        actorName: lab.practitionerName || staffProfile.displayName,
        actorRole: staffProfile.role,
        section: 'lab-orders',
        patientId: lab.patientId,
      });
    }

    seededEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const initialList = seededEntries.slice(0, MAX_ACTIVITY_LOGS);
    setActivityLogs(initialList);
    setActivityStorageReady(true);
    try {
      window.localStorage.setItem(activityStorageKey, JSON.stringify(initialList));
    } catch {
      // Ignore storage quota errors
    }
  }, [
    activityStorageKey,
    activityStorageReady,
    staffProfile,
    patients.length,
    appointments,
    invoices,
    payments,
    labOrders,
  ]);

  const logActivity = useCallback(
    (entry: Omit<ActivityLogEntry, 'id' | 'timestamp' | 'actorName' | 'actorRole'>) => {
      if (!activityStorageKey) return;
      const nowIso = new Date().toISOString();
      const nextItem: ActivityLogEntry = {
        ...entry,
        id: generateSafeId('act'),
        timestamp: nowIso,
        actorName: staffProfile?.displayName || user?.displayName || 'Praticien',
        actorRole: activeRole,
      };
      setActivityLogs((prev) => {
        // Prevent duplicate consecutive "patient opened" log within 10s
        const head = prev[0];
        if (
          head &&
          head.title === nextItem.title &&
          head.patientId === nextItem.patientId &&
          Date.now() - new Date(head.timestamp).getTime() < 10000
        ) {
          return prev;
        }
        const updated = [nextItem, ...prev].slice(0, MAX_ACTIVITY_LOGS);
        try {
          window.localStorage.setItem(activityStorageKey, JSON.stringify(updated));
        } catch {
          // Ignore storage quota errors
        }
        return updated;
      });
      setActivityStorageReady(true);
    },
    [activityStorageKey, staffProfile, user, activeRole]
  );

  const clearActivityLogs = useCallback(() => {
    setActivityLogs([]);
    setActivityStorageReady(true);
    if (activityStorageKey) {
      try {
        window.localStorage.setItem(activityStorageKey, JSON.stringify([]));
      } catch {
        // Ignore storage quota errors
      }
    }
  }, [activityStorageKey]);

  const selectPatientWithLog = useCallback(
    (patientId: string | null) => {
      setSelectedPatientId(patientId);
      if (!patientId) return;
      const pat = patients.find((p) => p.id === patientId);
      if (pat) {
        logActivity({
          category: 'patient',
          title: `Dossier patient ouvert : ${pat.firstName} ${pat.lastName}`,
          detail: `${pat.fileNumber} · ${pat.insuranceType}`,
          section: 'patients',
          patientId: pat.id,
        });
      }
    },
    [patients, logActivity]
  );

  const openPatientFile = useCallback(
    (patientId: string) => {
      selectPatientWithLog(patientId);
      setActiveSection('patients');
    },
    [selectPatientWithLog]
  );

  const openAgendaAt = useCallback((date: string, appointmentId?: string) => {
    setAgendaFocus({ date, appointmentId });
    setActiveSection('appointments');
  }, []);

  const clearAgendaFocus = useCallback(() => {
    setAgendaFocus(null);
  }, []);

  const setPrintableDoc = useCallback(
    (docPayload: PrintableDocumentPayload | null) => {
      setPrintableDocState(docPayload);
      if (docPayload) {
        logActivity({
          category: docPayload.kind === 'prescription' || docPayload.kind === 'certificate' ? 'clinique' : 'facturation',
          title: `Document ouvert : ${docPayload.title}`,
          detail: `${docPayload.patientName}${docPayload.reference ? ` · ${docPayload.reference}` : ''}`,
          section: docPayload.kind === 'prescription' || docPayload.kind === 'certificate' ? 'documents' : 'invoices',
        });
      }
    },
    [logActivity]
  );

  const runDemoSeed = async () => {
    if (!user || !staffProfile) return;
    await seedClinicDemoData(user.uid, staffProfile.displayName);
    logActivity({
      category: 'administration',
      title: 'Données cliniques de démonstration chargées',
      detail: 'Patients, planning, factures et stock initialisés',
      section: 'settings',
    });
    showToast('Données cliniques de démonstration chargées.', 'success');
  };

  const resetBetaToZero = async () => {
    if (!user || !staffProfile) return;
    await resetClinicDataToZero(user.uid, staffProfile.displayName);
    dispatchedSmsAptIdsRef.current.clear();
    setSelectedPatientId(null);
    setFavoritePatientIds([]);
    if (favoritesStorageKey) {
      try {
        window.localStorage.setItem(favoritesStorageKey, JSON.stringify([]));
      } catch {
        // Ignore storage quota errors
      }
    }
    clearActivityLogs();
    showToast('Toutes les données et tous les compteurs ont été remis à zéro pour le test bêta.', 'success');
  };

  const describeSavedRecord = (
    collectionName: string,
    id: string,
    data: Record<string, unknown>,
    isCreate: boolean
  ): Omit<ActivityLogEntry, 'id' | 'timestamp' | 'actorName' | 'actorRole'> | null => {
    const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
    const num = (key: string) => (typeof data[key] === 'number' ? (data[key] as number) : undefined);

    switch (collectionName) {
      case 'patients': {
        const existing = patients.find((p) => p.id === id);
        const fullName =
          str('firstName') || str('lastName')
            ? `${str('firstName')} ${str('lastName')}`.trim()
            : existing
            ? `${existing.firstName} ${existing.lastName}`
            : 'Patient';
        if ('odontogram' in data) {
          return {
            category: 'clinique',
            title: `Odontogramme mis à jour : ${fullName}`,
            detail: 'Schéma dentaire FDI enregistré',
            section: 'patients',
            patientId: id,
          };
        }
        if ('dentitionMode' in data && Object.keys(data).length === 1) {
          return {
            category: 'clinique',
            title: `Mode dentition (${str('dentitionMode')}) : ${fullName}`,
            detail: 'Affichage odontogramme modifié',
            section: 'patients',
            patientId: id,
          };
        }
        return {
          category: 'patient',
          title: isCreate ? `Nouveau patient : ${fullName}` : `Dossier patient modifié : ${fullName}`,
          detail: str('fileNumber') || existing?.fileNumber || 'Identité & anamnèse',
          section: 'patients',
          patientId: id,
        };
      }
      case 'appointments': {
        const existing = appointments.find((a) => a.id === id);
        const patName = str('patientName') || existing?.patientName || 'Patient';
        const patId = str('patientId') || existing?.patientId;
        const status = str('status');
        const slot = str('date') && str('startTime') ? `${str('date')} à ${str('startTime')}` : existing ? `${existing.date} à ${existing.startTime}` : '';
        return {
          category: 'planning',
          title: isCreate ? `Nouveau rendez-vous : ${patName}` : `Planning modifié : ${patName}`,
          detail: status && !isCreate ? `Statut : ${status}${slot ? ` · ${slot}` : ''}` : `${str('actType') || existing?.actType || 'Consultation'}${slot ? ` · ${slot}` : ''}`,
          section: 'appointments',
          patientId: patId,
        };
      }
      case 'bookingRequests':
        return {
          category: 'planning',
          title: `Demande en ligne ${str('status').toLowerCase() || 'traitée'}`,
          detail: str('patientName') || 'Demande de rendez-vous',
          section: 'appointments',
        };
      case 'treatmentPlans': {
        const existing = treatmentPlans.find((p) => p.id === id);
        const quoteNum = str('quoteNumber') || existing?.quoteNumber || 'Devis';
        const patName = str('patientName') || existing?.patientName || '';
        return {
          category: 'clinique',
          title: isCreate ? `Devis créé : ${quoteNum}` : `Plan de traitement modifié : ${quoteNum}`,
          detail: `${patName}${str('status') ? ` · ${str('status')}` : ''}`.trim() || 'Actes mis à jour',
          section: 'treatment-plans',
          patientId: str('patientId') || existing?.patientId,
        };
      }
      case 'invoices': {
        const existing = invoices.find((i) => i.id === id);
        const invNum = str('invoiceNumber') || existing?.invoiceNumber || 'Facture';
        const patName = str('patientName') || existing?.patientName || '';
        const amt = num('totalAmount') ?? existing?.totalAmount;
        return {
          category: 'facturation',
          title: isCreate ? `Facture émise : ${invNum}` : `Facture mise à jour : ${invNum}`,
          detail: [patName, amt !== undefined ? `${amt.toLocaleString('fr-FR')} MAD` : '', str('status') || str('insuranceClaimStatus')]
            .filter(Boolean)
            .join(' · '),
          section: 'invoices',
          patientId: str('patientId') || existing?.patientId,
        };
      }
      case 'payments': {
        const amt = num('amount');
        return {
          category: 'facturation',
          title: `Paiement enregistré : ${str('receiptNumber') || 'Reçu'}`,
          detail: [str('patientName'), amt !== undefined ? `${amt.toLocaleString('fr-FR')} MAD` : '', str('method')]
            .filter(Boolean)
            .join(' · '),
          section: 'payments',
          patientId: str('patientId') || undefined,
        };
      }
      case 'labOrders': {
        const existing = labOrders.find((l) => l.id === id);
        const orderNum = str('orderNumber') || existing?.orderNumber || 'Commande labo';
        return {
          category: 'logistique',
          title: isCreate ? `Prothèse commandée : ${orderNum}` : `Suivi laboratoire : ${orderNum}`,
          detail: [str('patientName') || existing?.patientName, str('status'), str('labName') || existing?.labName]
            .filter(Boolean)
            .join(' · '),
          section: 'lab-orders',
          patientId: str('patientId') || existing?.patientId,
        };
      }
      case 'medicalDocuments':
        return {
          category: 'clinique',
          title: `Document émis : ${str('docType') || 'Document médical'}`,
          detail: [str('patientName'), str('title')].filter(Boolean).join(' · '),
          section: 'documents',
          patientId: str('patientId') || undefined,
        };
      case 'recalls':
        return {
          category: 'planning',
          title: isCreate ? 'Rappel patient planifié' : 'Rappel patient mis à jour',
          detail: [str('patientName'), str('reason') || str('status')].filter(Boolean).join(' · '),
          section: 'recalls',
          patientId: str('patientId') || undefined,
        };
      case 'expenses':
        return {
          category: 'facturation',
          title: `Charge enregistrée : ${str('label') || str('category')}`,
          detail: num('amount') !== undefined ? `${num('amount')!.toLocaleString('fr-FR')} MAD` : str('category'),
          section: 'cash-expenses',
        };
      case 'cashClosures':
        return {
          category: 'facturation',
          title: `Clôture de caisse : ${str('date') || 'Journée'}`,
          detail: num('countedBalance') !== undefined ? `Solde compté : ${num('countedBalance')!.toLocaleString('fr-FR')} MAD` : 'Caisse verrouillée',
          section: 'cash-expenses',
        };
      case 'inventory':
      case 'stockMovements':
        return {
          category: 'logistique',
          title: collectionName === 'stockMovements' ? `Mouvement de stock (${str('type') || 'Maj'})` : 'Inventaire consommables mis à jour',
          detail: str('itemName') || str('name') || 'Article mis à jour',
          section: 'inventory',
        };
      case 'staffInvites':
      case 'staff':
        return {
          category: 'administration',
          title: isCreate ? `Membre invité : ${str('displayName') || str('email')}` : 'Équipe & rôles mis à jour',
          detail: str('email') || str('role') || 'Gestion des accès',
          section: 'staff',
        };
      case 'settings':
        return {
          category: 'administration',
          title: 'Paramètres du cabinet mis à jour',
          detail: str('clinicName') || 'Configuration enregistrée',
          section: 'settings',
        };
      case 'adminDocuments':
        return {
          category: 'administration',
          title: isCreate
            ? `Document administratif ajouté : ${str('title')}`
            : `Document administratif mis à jour : ${str('title') || 'Renouvellement'}`,
          detail: [str('category'), str('provider'), str('expiryDate') ? `Échéance ${str('expiryDate')}` : '']
            .filter(Boolean)
            .join(' · '),
          section: 'dashboard',
        };
      default:
        return null;
    }
  };

  const saveRecord = async (
    collectionName: string,
    id: string,
    data: Record<string, unknown>,
    isCreate = false
  ) => {
    const docId = id || generateSafeId(collectionName.slice(0, 4));
    const docRef = doc(db, collectionName, docId);
    const collectionsWithoutCreatedAt = ['settings', 'inventory'];
    const collectionsWithoutUpdatedAt = [
      'payments',
      'medicalDocuments',
      'expenses',
      'cashClosures',
      'stockMovements',
      'staffInvites',
      'actsCatalog',
    ];
    try {
      if (isCreate) {
        await setDoc(docRef, {
          ...data,
          ...(!collectionsWithoutCreatedAt.includes(collectionName) ? { createdAt: serverTimestamp() } : {}),
          ...(!collectionsWithoutUpdatedAt.includes(collectionName) ? { updatedAt: serverTimestamp() } : {}),
        });
      } else {
        await updateDoc(docRef, {
          ...data,
          ...(!collectionsWithoutUpdatedAt.includes(collectionName) ? { updatedAt: serverTimestamp() } : {}),
        });
      }
      const entry = describeSavedRecord(collectionName, docId, data, isCreate);
      if (entry) {
        logActivity(entry);
      }
    } catch (error) {
      handleFirestoreError(error, isCreate ? OperationType.CREATE : OperationType.UPDATE, `${collectionName}/${docId}`);
    }
  };

  const removeRecord = async (collectionName: string, id: string) => {
    try {
      await deleteDoc(doc(db, collectionName, id));
      const sectionByCollection: Record<string, { section: AppSection; category: ActivityCategory; label: string }> = {
        staffInvites: { section: 'staff', category: 'administration', label: 'Invitation révoquée' },
        appointments: { section: 'appointments', category: 'planning', label: 'Rendez-vous supprimé' },
        patients: { section: 'patients', category: 'patient', label: 'Dossier patient supprimé' },
        invoices: { section: 'invoices', category: 'facturation', label: 'Facture supprimée' },
      };
      const meta = sectionByCollection[collectionName] || {
        section: 'dashboard' as AppSection,
        category: 'administration' as ActivityCategory,
        label: `Élément supprimé (${collectionName})`,
      };
      logActivity({
        category: meta.category,
        title: meta.label,
        detail: `Référence : ${id}`,
        section: meta.section,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
    }
  };

  const incrementCounter = async (
    counterKey: 'invoiceCounter' | 'quoteCounter' | 'receiptCounter'
  ): Promise<number> => {
    const settingsRef = doc(db, 'settings', 'clinic');
    const fallbackNext = Number(clinicSettings?.[counterKey] ?? 0) + 1;
    try {
      const nextVal = await runTransaction(db, async (tx) => {
        const snap = await tx.get(settingsRef);
        const current = snap.exists() ? Number(snap.data()?.[counterKey] || 0) : 0;
        const next = current + 1;
        tx.update(settingsRef, {
          [counterKey]: next,
          updatedAt: serverTimestamp(),
        });
        return next;
      });
      return nextVal;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'settings/clinic');
      return fallbackNext;
    }
  };

  const hasPendingSync = useMemo(() => Object.values(pendingMap).some(Boolean), [pendingMap]);

  const sendAppointmentSmsReminder = useCallback(
    async (apt: Appointment, options?: { isAuto?: boolean }): Promise<boolean> => {
      if (!user || !staffProfile?.active) return false;
      if (actualRole === 'assistant') return false;

      const isAuto = Boolean(options?.isAuto);
      const alreadyTagged = recalls.some(
        (r) => r.channel === 'SMS' && (r.notes || '').includes(`[RDV:${apt.id}]`)
      );
      if (isAuto && (alreadyTagged || dispatchedSmsAptIdsRef.current.has(apt.id))) {
        return false;
      }

      const smsCfg = resolveSmsReminderSettings(clinicSettings);
      const linkedPatient = patients.find((p) => p.id === apt.patientId);
      const phone = (apt.patientPhone || linkedPatient?.phone || '').trim().slice(0, 40);
      if (!phone) return false;

      dispatchedSmsAptIdsRef.current.add(apt.id);
      const nowIso = new Date().toISOString();
      const message = formatSmsReminderMessage(smsCfg.template, apt, clinicSettings);
      const reasonPrefix = isAuto
        ? `Rappel SMS ${smsCfg.hoursBefore}h`
        : 'Rappel SMS manuel';
      const reason = `${reasonPrefix} · RDV ${apt.startTime} (${apt.actType})`.slice(0, 155);

      try {
        await saveRecord(
          'recalls',
          generateSafeId('sms'),
          {
            patientId: apt.patientId,
            patientName: (apt.patientName || 'Patient').slice(0, 145),
            patientPhone: phone,
            practitionerId: apt.practitionerId || user.uid,
            reason,
            dueDate: (apt.date || '').slice(0, 20),
            channel: 'SMS',
            status: 'Envoyé',
            deliveryStatus: 'Délivré',
            lastSentAt: nowIso.slice(0, 38),
            notes: buildRecallSmsNotes(apt.id, message),
            createdBy: user.uid,
          },
          true
        );

        if (actualRole === 'titulaire' || actualRole === 'secretaire') {
          const statusLabel = isAuto
            ? `SMS ${smsCfg.hoursBefore}h envoyé`.slice(0, 38)
            : 'SMS envoyé';
          await saveRecord('appointments', apt.id, {
            reminderStatus: statusLabel,
          });
        }
        return true;
      } catch (err) {
        dispatchedSmsAptIdsRef.current.delete(apt.id);
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, staffProfile, actualRole, recalls, clinicSettings, patients]
  );

  const runDueSmsReminders = useCallback(
    async (manual = false): Promise<number> => {
      if (!user || !staffProfile?.active) return 0;
      if (actualRole !== 'titulaire' && actualRole !== 'secretaire') return 0;
      const smsCfg = resolveSmsReminderSettings(clinicSettings);
      if (!manual && !smsCfg.enabled) return 0;

      const now = new Date();
      const dueAppointments = appointments.filter((apt) => {
        if (!isAppointmentDueForSmsReminder(apt, smsCfg.hoursBefore, now)) return false;
        if (dispatchedSmsAptIdsRef.current.has(apt.id)) return false;
        const alreadySentInHistory = recalls.some(
          (r) => r.channel === 'SMS' && (r.notes || '').includes(`[RDV:${apt.id}]`)
        );
        return !alreadySentInHistory;
      });

      if (dueAppointments.length === 0) {
        if (manual) {
          showToast(
            `Aucun rendez-vous éligible dans les ${smsCfg.hoursBefore} prochaines heures.`,
            'info'
          );
        }
        return 0;
      }

      let sentCount = 0;
      for (const apt of dueAppointments) {
        try {
          const sent = await sendAppointmentSmsReminder(apt, { isAuto: true });
          if (sent) sentCount += 1;
        } catch (err) {
          console.warn('Échec envoi rappel SMS automatique:', err);
        }
      }

      if (sentCount > 0) {
        showToast(
          `${sentCount} rappel${sentCount > 1 ? 's' : ''} SMS automatique${sentCount > 1 ? 's' : ''} envoyé${sentCount > 1 ? 's' : ''}.`,
          'success'
        );
      }
      return sentCount;
    },
    [
      user,
      staffProfile,
      actualRole,
      clinicSettings,
      appointments,
      recalls,
      sendAppointmentSmsReminder,
      showToast,
    ]
  );

  useEffect(() => {
    if (!user || !staffProfile?.active || !clinicSettings) return;
    if (actualRole !== 'titulaire' && actualRole !== 'secretaire') return;
    const smsCfg = resolveSmsReminderSettings(clinicSettings);
    if (!smsCfg.enabled) return;

    void runDueSmsReminders(false);
    const intervalId = window.setInterval(() => {
      void runDueSmsReminders(false);
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [user, staffProfile, actualRole, clinicSettings, appointments, recalls, runDueSmsReminders]);

  return (
    <ClinicContext.Provider
      value={{
        user,
        authLoading,
        authError,
        clearAuthError,
        staffProfile,
        accessPending,
        actualRole,
        activeRole,
        setPreviewRole,
        permissions,
        activeSection,
        setActiveSection,
        selectedPatientId,
        setSelectedPatientId: selectPatientWithLog,
        openPatientFile,
        agendaFocus,
        openAgendaAt,
        clearAgendaFocus,
        clinicSettings,
        staffList,
        staffInvites,
        patients,
        appointments,
        bookingRequests,
        actsCatalog,
        treatmentPlans,
        invoices,
        payments,
        labOrders,
        medicalDocuments,
        recalls,
        expenses,
        cashClosures,
        inventory,
        stockMovements,
        adminDocuments,
        hasPendingSync,
        favoritePatientIds,
        toggleFavoritePatient,
        sendAppointmentSmsReminder,
        runDueSmsReminders,
        activityLogs,
        logActivity,
        clearActivityLogs,
        printableDoc,
        setPrintableDoc,
        toastMessage,
        showToast,
        signInWithGoogle,
        signInWithGoogleRedirect,
        refreshAuthAccess,
        logout,
        runDemoSeed,
        resetBetaToZero,
        saveRecord,
        removeRecord,
        incrementCounter,
      }}
    >
      {children}
    </ClinicContext.Provider>
  );
};

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic must be used within ClinicProvider');
  return ctx;
}
