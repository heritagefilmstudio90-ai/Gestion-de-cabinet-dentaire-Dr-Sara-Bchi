import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  User,
  getRedirectResult,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  autoResolveRecoverableSyncErrors,
  clearAllSyncErrors as clearAllSyncErrorLogsStore,
  clearResolvedSyncErrors as clearResolvedSyncErrorLogsStore,
  db,
  googleProvider,
  handleFirestoreError,
  incrementSyncErrorRetry,
  markCollectionSyncHealthy,
  markSyncErrorResolved,
  OperationType,
  provisionAuthUserWithPassword,
  resyncFirestoreNetwork,
  subscribeFirestoreDoc,
  subscribeFirestoreQuery,
  subscribeSyncErrorLogs,
  testConnection,
  verifyFirestoreServerSync,
} from '../lib/firebase';
import { normalizeLoginIdentifier, validateLoginIdentifier } from '../lib/authIdentifier';
import { DEFAULT_ACTS_CATALOG } from '../data/dentalCatalog';
import { formatDateFR, generateSafeId, todayISO } from '../lib/formatters';
import {
  DEFAULT_SMS_REMINDER_SETTINGS,
  buildRecallSmsNotes,
  buildTelUri,
  buildWhatsAppUrl,
  formatSmsReminderMessage,
  isAppointmentDueForSmsReminder,
  resolveSmsReminderSettings,
  stripRecallAppointmentTag,
  triggerExternalActionLink,
} from '../lib/smsReminders';
import { sendSmsViaGateway, sendWhatsAppViaGateway } from '../lib/smsGateway';
import { loadAllCabinetCsvData, CabinetCsvBundle } from '../lib/cabinetCsvData';
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
  ClinicalNote,
  Expense,
  Invoice,
  LabOrder,
  MedicalDocument,
  NO_PERMISSIONS,
  Patient,
  PatientClinicalAct,
  Payment,
  PrintableDocumentPayload,
  Recall,
  RolePermissions,
  StaffInvite,
  StaffMember,
  StaffRole,
  StockMovement,
  SyncErrorLog,
  InventoryItem,
  TreatmentPlan,
  canAccessSection,
  getPermissionsForRole,
} from '../types/dental';

const BOOTSTRAP_ADMIN_EMAIL = 'heritagefilmstudio90@gmail.com';

function mapFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const message = err instanceof Error ? err.message : String(err || '');

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Identifiant ou mot de passe incorrect.';
  }
  if (code === 'auth/invalid-email') {
    return "Le format de l'identifiant ou de l'adresse email est invalide.";
  }
  if (code === 'auth/email-already-in-use') {
    return 'Cet identifiant ou cette adresse email est déjà utilisé par un autre compte.';
  }
  if (code === 'auth/weak-password') {
    return 'Le mot de passe doit contenir au moins 6 caractères.';
  }
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return "L'authentification par Identifiant / Mot de passe n'est pas encore activée dans la console Firebase (Authentication → Sign-in method → Adresse e-mail/Mot de passe).";
  }
  if (code === 'auth/too-many-requests') {
    return 'Trop de tentatives échouées. Patientez quelques minutes avant de réessayer.';
  }
  if (code === 'auth/user-disabled') {
    return 'Ce compte utilisateur a été désactivé.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'Par sécurité, veuillez vous déconnecter puis vous reconnecter avant de modifier votre mot de passe.';
  }
  if (code === 'auth/provider-already-linked') {
    return 'Un mot de passe est déjà associé à ce compte.';
  }
  if (code === 'auth/popup-blocked') {
    return "La fenêtre de connexion Google a été bloquée par le navigateur ou l'aperçu intégré. Utilisez votre identifiant/mot de passe ou cliquez sur « Ouvrir dans un nouvel onglet ».";
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return "La fenêtre de connexion Google a été fermée avant la fin de l'authentification.";
  }
  if (code === 'auth/unauthorized-domain') {
    return "Ce domaine d'aperçu n'est pas encore autorisé pour le popup Google. Essayez d'ouvrir l'application dans un nouvel onglet.";
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return "La connexion par fenêtre popup n'est pas prise en charge dans cet onglet intégré. Utilisez votre identifiant/mot de passe ou ouvrez l'application dans un nouvel onglet.";
  }
  if (code === 'auth/network-request-failed') {
    return 'Erreur réseau lors de la connexion au serveur. Vérifiez votre connexion Internet.';
  }
  if (code === 'permission-denied' || message.includes('PERMISSION_DENIED') || message.includes('Missing or insufficient permissions')) {
    return "Accès refusé par les règles Firestore lors de la vérification du profil. Vérifiez que le compte possède bien un accès actif.";
  }
  if (code === 'unavailable' || message.includes('client is offline')) {
    return 'Serveur Firebase temporairement inaccessible. Vérifiez votre connexion Internet et réessayez.';
  }
  return message || "Erreur lors de l'authentification.";
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
  patients: Patient[];
  clinicalActs: PatientClinicalAct[];
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
  pendingSyncCollections: string[];
  syncErrorLogs: SyncErrorLog[];
  retrySyncError: (logId: string) => Promise<boolean>;
  retryAllSyncErrors: () => Promise<{ succeeded: number; failed: number }>;
  checkServerConnection: () => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  resolveSyncError: (logId: string) => void;
  clearResolvedSyncErrors: () => void;
  clearAllSyncErrors: () => void;
  ensureCsvPatientSynced: (patientId: string) => Promise<void>;
  fetchClinicalNotesForExport: () => Promise<ClinicalNote[]>;
  favoritePatientIds: string[];
  toggleFavoritePatient: (patientId: string) => void;
  sendAppointmentReminder: (
    apt: Appointment,
    channel: 'SMS' | 'WhatsApp' | 'Appel',
    options?: { isAuto?: boolean; customMessage?: string }
  ) => Promise<boolean>;
  sendAppointmentSmsReminder: (
    apt: Appointment,
    options?: { isAuto?: boolean; customMessage?: string }
  ) => Promise<boolean>;
  dispatchRecallNotification: (
    recall: Recall,
    channelOverride?: 'SMS' | 'WhatsApp' | 'Appel'
  ) => Promise<boolean>;
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
  signInWithCredentials: (loginOrEmail: string, password: string) => Promise<void>;
  sendPasswordReset: (loginOrEmail: string) => Promise<void>;
  createStaffAccount: (payload: {
    login: string;
    password: string;
    displayName: string;
    role: StaffRole;
    specialty?: string;
    chairName?: string;
  }) => Promise<{ uid: string; login: string; authEmail: string }>;
  setOwnPassword: (newPassword: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithGoogleRedirect: () => Promise<void>;
  refreshAuthAccess: () => Promise<void>;
  logout: () => Promise<void>;
  saveRecord: (collectionName: string, id: string, data: Record<string, unknown>, isCreate?: boolean) => Promise<void>;
  removeRecord: (collectionName: string, id: string) => Promise<void>;
  incrementCounter: (counterKey: 'invoiceCounter' | 'quoteCounter' | 'receiptCounter') => Promise<number>;
}

const FIRESTORE_ALLOWED_FIELDS: Record<string, string[]> = {
  staff: [
    'uid', 'login', 'email', 'displayName', 'role', 'specialty', 'chairName', 'color', 'active', 'inviteId', 'createdBy',
  ],
  settings: [
    'clinicName', 'subtitle', 'address', 'phone', 'email', 'ice', 'ifNumber', 'patente', 'inpe',
    'currency', 'chairs', 'workingHours', 'smsReminders', 'invoiceCounter', 'quoteCounter', 'receiptCounter', 'betaZeroInitialized',
  ],
  patients: [
    'fileNumber', 'firstName', 'lastName', 'birthDate', 'cin', 'profession', 'phone',
    'email', 'address', 'referringDoctor', 'insuranceType', 'insuranceNumber', 'coverageRate',
    'anamnesis', 'hasCriticalAlert', 'alertSummary', 'assignedPractitionerId', 'dentitionMode',
    'odontogram', 'active', 'createdBy',
  ],
  appointments: [
    'patientId', 'patientName', 'patientPhone', 'practitionerId', 'practitionerName', 'chair',
    'date', 'startTime', 'durationMinutes', 'actType', 'categoryColor', 'status', 'arrivedAt',
    'notes', 'isUrgent', 'reminderStatus', 'createdBy',
  ],
  bookingRequests: [
    'patientName', 'phone', 'preferredDate', 'preferredSlot', 'reason', 'practitionerId', 'status',
  ],
  actsCatalog: [
    'code', 'category', 'name', 'defaultDuration', 'minPrice', 'maxPrice', 'defaultPrice', 'color',
  ],
  treatmentPlans: [
    'quoteNumber', 'patientId', 'patientName', 'practitionerId', 'practitionerName', 'title',
    'isAlternative', 'status', 'items', 'totalAmount', 'insuranceEstimated', 'consentSigned',
    'lockedVersion', 'createdBy',
  ],
  invoices: [
    'invoiceNumber', 'patientId', 'patientName', 'practitionerId', 'practitionerName', 'planId',
    'issueDate', 'dueDate', 'items', 'totalAmount', 'insuranceType', 'insuranceShare',
    'patientShare', 'paidAmount', 'insurancePaidAmount', 'status', 'insuranceClaimStatus', 'createdBy',
  ],
  payments: [
    'receiptNumber', 'invoiceId', 'patientId', 'patientName', 'practitionerId', 'date',
    'amount', 'method', 'payerType', 'isAdvance', 'chequeNumber', 'bankName',
    'chequeDepositDate', 'notes', 'createdBy',
  ],
  labOrders: [
    'orderNumber', 'patientId', 'patientName', 'practitionerId', 'practitionerName', 'labName',
    'prosthesisType', 'shadeVita', 'teeth', 'impressionType', 'sentDate', 'dueDate',
    'nextAppointmentDate', 'status', 'labCost', 'supplierInvoiceRef', 'supplierPaid', 'notes', 'createdBy',
  ],
  medicalDocuments: [
    'patientId', 'patientName', 'practitionerId', 'practitionerName', 'docType', 'date',
    'title', 'prescriptions', 'bodyText', 'createdBy',
  ],
  recalls: [
    'patientId', 'patientName', 'patientPhone', 'practitionerId', 'reason', 'dueDate',
    'channel', 'status', 'deliveryStatus', 'lastSentAt', 'notes', 'createdBy',
  ],
  expenses: [
    'date', 'category', 'expenseType', 'label', 'supplier', 'amount', 'paymentMethod',
    'receiptRef', 'createdBy',
  ],
  cashClosures: [
    'date', 'openingBalance', 'cashInflows', 'cashOutflows', 'expectedBalance', 'countedBalance',
    'discrepancy', 'notes', 'locked', 'closedByUid', 'closedByName',
  ],
  inventory: [
    'sku', 'name', 'category', 'unit', 'quantity', 'minThreshold', 'unitCost', 'supplier', 'expiryDate',
  ],
  stockMovements: [
    'itemId', 'itemName', 'type', 'quantity', 'reason', 'date', 'createdBy',
  ],
  adminDocuments: [
    'title', 'category', 'provider', 'reference', 'expiryDate', 'alertDaysBefore', 'status', 'notes', 'createdBy',
  ],
};

function sanitizeFirestorePayload(collectionName: string, data: Record<string, unknown>): Record<string, unknown> {
  const allowed = FIRESTORE_ALLOWED_FIELDS[collectionName];
  if (!allowed) return data;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in data && data[key] !== undefined) {
      out[key] = data[key];
    }
  }
  return out;
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
  const [activeSection, setActiveSectionState] = useState<AppSection>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [agendaFocus, setAgendaFocus] = useState<{ date: string; appointmentId?: string } | null>(null);

  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [csvBundle, setCsvBundle] = useState<CabinetCsvBundle | null>(null);
  const [deletedCsvIds, setDeletedCsvIds] = useState<Record<string, string[]>>({});
  const [fsPatients, setFsPatients] = useState<Patient[]>([]);
  const [fsAppointments, setFsAppointments] = useState<Appointment[]>([]);
  const [fsBookingRequests, setFsBookingRequests] = useState<BookingRequest[]>([]);
  const [actsCatalog, setActsCatalog] = useState<CatalogAct[]>([]);
  const [fsTreatmentPlans, setFsTreatmentPlans] = useState<TreatmentPlan[]>([]);
  const [fsInvoices, setFsInvoices] = useState<Invoice[]>([]);
  const [fsPayments, setFsPayments] = useState<Payment[]>([]);
  const [fsLabOrders, setFsLabOrders] = useState<LabOrder[]>([]);
  const [fsMedicalDocuments, setFsMedicalDocuments] = useState<MedicalDocument[]>([]);
  const [fsRecalls, setFsRecalls] = useState<Recall[]>([]);
  const [fsExpenses, setFsExpenses] = useState<Expense[]>([]);
  const [fsCashClosures, setFsCashClosures] = useState<CashClosure[]>([]);
  const [fsInventory, setFsInventory] = useState<InventoryItem[]>([]);
  const [fsStockMovements, setFsStockMovements] = useState<StockMovement[]>([]);
  const [adminDocuments, setAdminDocuments] = useState<AdminDocument[]>([]);

  const syncedCsvPatientIdsRef = useRef<Set<string>>(new Set());
  const syncedCsvInvoiceIdsRef = useRef<Set<string>>(new Set());
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});
  const [syncErrorLogs, setSyncErrorLogs] = useState<SyncErrorLog[]>([]);
  const [favoritePatientIds, setFavoritePatientIds] = useState<string[]>([]);
  const dispatchedSmsAptIdsRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [activityStorageReady, setActivityStorageReady] = useState(false);
  const [printableDoc, setPrintableDocState] = useState<PrintableDocumentPayload | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    return subscribeSyncErrorLogs(setSyncErrorLogs);
  }, []);

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

    try {
      const staffRef = doc(db, 'staff', firebaseUser.uid);
      let staffSnap = await getDoc(staffRef);

      if (staffSnap.exists()) {
        const existingData = staffSnap.data() as Omit<StaffMember, 'id'>;
        if (existingData.inviteId !== 'direct' && !firebaseUser.emailVerified) {
          setStaffProfile(null);
          setAccessPending(false);
          setAuthError("Votre adresse email n'est pas encore vérifiée.");
          return;
        }
      } else if (firebaseUser.emailVerified) {
        const normalizedEmail = (firebaseUser.email || '').toLowerCase();
        if (normalizedEmail === BOOTSTRAP_ADMIN_EMAIL) {
          const profileData = {
            uid: firebaseUser.uid,
            login: normalizedEmail,
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
              login: normalizedEmail || inv.email,
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

        // Sync Titulaire profile name to Dr. Sara Bchi in background if still using generic bootstrap name
        if (
          profile.role === 'titulaire' &&
          profile.inviteId === 'bootstrap' &&
          window.localStorage.getItem('dentaflow_sarabchi_profile_synced_v1') !== '1'
        ) {
          if (profile.displayName !== 'Dr. Sara Bchi' || profile.specialty !== 'Chirurgien - Dentiste') {
            profile = {
              ...profile,
              displayName: 'Dr. Sara Bchi',
              specialty: 'Chirurgien - Dentiste',
            };
            void updateDoc(staffRef, {
              displayName: 'Dr. Sara Bchi',
              specialty: 'Chirurgien - Dentiste',
              updatedAt: serverTimestamp(),
            })
              .then(() => {
                window.localStorage.setItem('dentaflow_sarabchi_profile_synced_v1', '1');
              })
              .catch((syncProfileErr) => {
                console.warn('Mise à jour automatique du profil Titulaire ignorée:', syncProfileErr);
              });
          } else {
            window.localStorage.setItem('dentaflow_sarabchi_profile_synced_v1', '1');
          }
        }

        setStaffProfile(profile);
        setPreviewRole(profile.role);
        setAccessPending(!profile.active);
        if (!profile.active) {
          setAuthError('Votre accès a été suspendu par le Praticien Titulaire.');
        }

        // Non-blocking clinic settings bootstrap so login & workspace render immediately
        if (profile.role === 'titulaire') {
          void (async () => {
            try {
              const clinicRef = doc(db, 'settings', 'clinic');
              const clinicSnap = await getDoc(clinicRef);
              if (!clinicSnap.exists()) {
                await setDoc(clinicRef, {
                  clinicName: 'Cabinet Dentaire Dr. Sara Bchi',
                  subtitle: 'Chirurgien - Dentiste',
                  address: "42 Boulevard d'Anfa, Résidence Les Jasmins, Casablanca 20000",
                  phone: '+212 532 101 351',
                  email: 'contact@cabinet-dr-bchi.ma',
                  ice: '002849103000048',
                  ifNumber: '40291844',
                  patente: '34781209',
                  inpe: '012489310',
                  currency: 'MAD',
                  chairs: ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3'],
                  workingHours: {
                    start: '09:00',
                    end: '18:00',
                    lunchStart: '13:00',
                    lunchEnd: '15:00',
                    saturdayStart: '09:00',
                    saturdayEnd: '13:00',
                  },
                  smsReminders: DEFAULT_SMS_REMINDER_SETTINGS,
                  invoiceCounter: 0,
                  quoteCounter: 0,
                  receiptCounter: 0,
                  betaZeroInitialized: true,
                  updatedAt: serverTimestamp(),
                });
              }
            } catch (seedErr) {
              console.warn('Initialisation des paramètres du cabinet ignorée:', seedErr);
            }
          })();
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
      setActiveSectionState('dashboard');
      setSelectedPatientId(null);
      setAgendaFocus(null);
      setClinicSettings(null);
      setStaffList([]);
      setCsvBundle(null);
      setDeletedCsvIds({});
      setFsPatients([]);
      setFsAppointments([]);
      setFsBookingRequests([]);
      setActsCatalog([]);
      setFsTreatmentPlans([]);
      setFsInvoices([]);
      setFsPayments([]);
      setFsLabOrders([]);
      setFsMedicalDocuments([]);
      setFsRecalls([]);
      setFsExpenses([]);
      setFsCashClosures([]);
      setFsInventory([]);
      setFsStockMovements([]);
      setAdminDocuments([]);
      setPendingMap({});
      syncedCsvPatientIdsRef.current.clear();
      syncedCsvInvoiceIdsRef.current.clear();
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

  const hasValidSession = Boolean(user && staffProfile && staffProfile.active && !accessPending);
  const activeSessionUid = hasValidSession && user ? user.uid : null;
  const actualRole: StaffRole = staffProfile?.role || 'assistant';
  const activeRole: StaffRole = actualRole === 'titulaire' ? previewRole : actualRole;
  const permissions = useMemo(
    () => (hasValidSession ? getPermissionsForRole(activeRole) : NO_PERMISSIONS),
    [hasValidSession, activeRole]
  );

  // Load CSV clinic archives & deleted tombstones once authenticated staff session starts (strictly keyed by role attribution)
  useEffect(() => {
    if (!activeSessionUid) return;
    let cancelled = false;
    try {
      const rawDeleted = window.localStorage.getItem(`dentaflow_csv_deleted_${activeSessionUid}`);
      if (rawDeleted) {
        const parsed = JSON.parse(rawDeleted);
        if (parsed && typeof parsed === 'object') {
          setDeletedCsvIds(parsed as Record<string, string[]>);
        }
      }
    } catch {
      // Ignore malformed storage
    }

    const csvOwnerUid = actualRole === 'titulaire' ? activeSessionUid : 'csv_dr_sara_bchi';
    loadAllCabinetCsvData(csvOwnerUid)
      .then((bundle) => {
        if (!cancelled) {
          setCsvBundle(bundle);
        }
      })
      .catch((err) => {
        console.warn('Chargement des archives CSV du cabinet impossible:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionUid, actualRole]);

  // Verify live Firestore connectivity on authenticated session start & auto-flush pending offline writes when coming back online
  useEffect(() => {
    if (!activeSessionUid) return;
    let disposed = false;
    let wasOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;

    void testConnection().then((ok) => {
      if (!disposed && ok) {
        autoResolveRecoverableSyncErrors();
      }
    });

    const handleOffline = () => {
      wasOffline = true;
    };

    const handleOnline = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const recoverFromOffline = wasOffline;
      wasOffline = false;
      if (!recoverFromOffline) return;
      void resyncFirestoreNetwork({ forceReset: false }).then(() => {
        void testConnection().then((ok) => {
          if (!disposed && ok) {
            autoResolveRecoverableSyncErrors();
          }
        });
      });
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      disposed = true;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [activeSessionUid]);

  // Attach real-time Firestore listeners scoped to the authenticated user's actual RBAC role
  useEffect(() => {
    if (!activeSessionUid) return;

    const unsubscribers: Array<() => void> = [];
    const trackPending = (key: string, pending: boolean) => {
      setPendingMap((prev) => (prev[key] === pending ? prev : { ...prev, [key]: pending }));
    };

    // Settings
    unsubscribers.push(
      subscribeFirestoreDoc(
        doc(db, 'settings', 'clinic'),
        (snap) => {
          markCollectionSyncHealthy('settings');
          trackPending('settings', snap.metadata.hasPendingWrites);
          if (snap.exists()) {
            setClinicSettings({ id: snap.id, ...(snap.data() as Omit<ClinicSettings, 'id'>) });
          }
        },
        'settings/clinic'
      )
    );

    // Staff
    unsubscribers.push(
      subscribeFirestoreQuery(
        collection(db, 'staff'),
        (snap) => {
          markCollectionSyncHealthy('staff');
          trackPending('staff', snap.metadata.hasPendingWrites);
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffMember, 'id'>) }));
          list.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'fr'));
          setStaffList(list);
        },
        'staff'
      )
    );

    // Acts catalog
    unsubscribers.push(
      subscribeFirestoreQuery(
        collection(db, 'actsCatalog'),
        (snap) => {
          markCollectionSyncHealthy('actsCatalog');
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
        'actsCatalog'
      )
    );

    // Patients
    const patientsQuery =
      actualRole === 'collaborateur'
        ? query(collection(db, 'patients'), where('assignedPractitionerId', '==', activeSessionUid))
        : collection(db, 'patients');
    unsubscribers.push(
      subscribeFirestoreQuery(
        patientsQuery,
        (snap) => {
          markCollectionSyncHealthy('patients');
          trackPending('patients', snap.metadata.hasPendingWrites);
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Patient, 'id'>) }));
          setFsPatients(list);
        },
        'patients'
      )
    );

    // Appointments
    const aptQuery =
      actualRole === 'collaborateur'
        ? query(collection(db, 'appointments'), where('practitionerId', '==', activeSessionUid))
        : collection(db, 'appointments');
    unsubscribers.push(
      subscribeFirestoreQuery(
        aptQuery,
        (snap) => {
          markCollectionSyncHealthy('appointments');
          trackPending('appointments', snap.metadata.hasPendingWrites);
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Appointment, 'id'>) }));
          list.sort((a, b) => `${a.date || ''}T${a.startTime || ''}`.localeCompare(`${b.date || ''}T${b.startTime || ''}`));
          setFsAppointments(list);
        },
        'appointments'
      )
    );

    // Booking requests (Titulaire & Secrétaire)
    if (actualRole === 'titulaire' || actualRole === 'secretaire') {
      unsubscribers.push(
        subscribeFirestoreQuery(
          collection(db, 'bookingRequests'),
          (snap) => {
            markCollectionSyncHealthy('bookingRequests');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BookingRequest, 'id'>) }));
            list.sort((a, b) => `${b.preferredDate || ''}T${b.preferredSlot || ''}`.localeCompare(`${a.preferredDate || ''}T${a.preferredSlot || ''}`));
            setFsBookingRequests(list);
          },
          'bookingRequests'
        )
      );
    }

    // Treatment plans
    if (actualRole !== 'assistant') {
      const plansQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'treatmentPlans'), where('practitionerId', '==', activeSessionUid))
          : collection(db, 'treatmentPlans');
      unsubscribers.push(
        subscribeFirestoreQuery(
          plansQ,
          (snap) => {
            markCollectionSyncHealthy('treatmentPlans');
            trackPending('treatmentPlans', snap.metadata.hasPendingWrites);
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TreatmentPlan, 'id'>) }));
            setFsTreatmentPlans(list);
          },
          'treatmentPlans'
        )
      );

      // Invoices
      const invQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'invoices'), where('practitionerId', '==', activeSessionUid))
          : collection(db, 'invoices');
      unsubscribers.push(
        subscribeFirestoreQuery(
          invQ,
          (snap) => {
            markCollectionSyncHealthy('invoices');
            trackPending('invoices', snap.metadata.hasPendingWrites);
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invoice, 'id'>) }));
            setFsInvoices(list);
          },
          'invoices'
        )
      );

      // Payments
      const payQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'payments'), where('practitionerId', '==', activeSessionUid))
          : collection(db, 'payments');
      unsubscribers.push(
        subscribeFirestoreQuery(
          payQ,
          (snap) => {
            markCollectionSyncHealthy('payments');
            trackPending('payments', snap.metadata.hasPendingWrites);
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payment, 'id'>) }));
            setFsPayments(list);
          },
          'payments'
        )
      );

      // Medical Documents
      const docQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'medicalDocuments'), where('practitionerId', '==', activeSessionUid))
          : collection(db, 'medicalDocuments');
      unsubscribers.push(
        subscribeFirestoreQuery(
          docQ,
          (snap) => {
            markCollectionSyncHealthy('medicalDocuments');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MedicalDocument, 'id'>) }));
            setFsMedicalDocuments(list);
          },
          'medicalDocuments'
        )
      );

      // Recalls (scoped strictly to practitionerId for collaborateur)
      const recallsQ =
        actualRole === 'collaborateur'
          ? query(collection(db, 'recalls'), where('practitionerId', '==', activeSessionUid))
          : collection(db, 'recalls');
      unsubscribers.push(
        subscribeFirestoreQuery(
          recallsQ,
          (snap) => {
            markCollectionSyncHealthy('recalls');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Recall, 'id'>) }));
            list.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
            setFsRecalls(list);
          },
          'recalls'
        )
      );
    }

    // Lab orders
    const labQ =
      actualRole === 'collaborateur'
        ? query(collection(db, 'labOrders'), where('practitionerId', '==', activeSessionUid))
        : collection(db, 'labOrders');
    unsubscribers.push(
      subscribeFirestoreQuery(
        labQ,
        (snap) => {
          markCollectionSyncHealthy('labOrders');
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabOrder, 'id'>) }));
          setFsLabOrders(list);
        },
        'labOrders'
      )
    );

    // Expenses (Titulaire only)
    if (actualRole === 'titulaire') {
      unsubscribers.push(
        subscribeFirestoreQuery(
          collection(db, 'expenses'),
          (snap) => {
            markCollectionSyncHealthy('expenses');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Expense, 'id'>) }));
            setFsExpenses(list);
          },
          'expenses'
        )
      );
    }

    // Cash closures (Titulaire & Secrétaire)
    if (actualRole === 'titulaire' || actualRole === 'secretaire') {
      unsubscribers.push(
        subscribeFirestoreQuery(
          collection(db, 'cashClosures'),
          (snap) => {
            markCollectionSyncHealthy('cashClosures');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CashClosure, 'id'>) }));
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setFsCashClosures(list);
          },
          'cashClosures'
        )
      );
    }

    // Inventory & movements (Titulaire & Assistant)
    if (actualRole === 'titulaire' || actualRole === 'assistant') {
      unsubscribers.push(
        subscribeFirestoreQuery(
          collection(db, 'inventory'),
          (snap) => {
            markCollectionSyncHealthy('inventory');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, 'id'>) }));
            list.sort((a, b) => (a.sku || a.name || '').localeCompare(b.sku || b.name || '', 'fr'));
            setFsInventory(list);
          },
          'inventory'
        )
      );
      unsubscribers.push(
        subscribeFirestoreQuery(
          collection(db, 'stockMovements'),
          (snap) => {
            markCollectionSyncHealthy('stockMovements');
            const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockMovement, 'id'>) }));
            list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            setFsStockMovements(list);
          },
          'stockMovements'
        )
      );
    }

    // Administrative documents (licenses & maintenance contracts)
    unsubscribers.push(
      subscribeFirestoreQuery(
        collection(db, 'adminDocuments'),
        (snap) => {
          markCollectionSyncHealthy('adminDocuments');
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminDocument, 'id'>) }));
          list.sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));
          setAdminDocuments(list);
        },
        'adminDocuments'
      )
    );

    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, [activeSessionUid, actualRole]);

  // Merge CSV archives with live Firestore documents (Firestore edits win; CSV-only display fields preserved)
  const mergeCollection = useCallback(
    <T extends { id: string }>(collectionName: string, csvList: T[], fsList: T[]): T[] => {
      const hiddenSet = new Set(deletedCsvIds[collectionName] || []);
      const fsById = new Map(fsList.map((item) => [item.id, item]));
      const merged: T[] = [];
      const seen = new Set<string>();

      for (const csvItem of csvList) {
        if (hiddenSet.has(csvItem.id)) continue;
        const override = fsById.get(csvItem.id);
        merged.push(override ? { ...csvItem, ...override } : csvItem);
        seen.add(csvItem.id);
      }
      for (const fsItem of fsList) {
        if (!seen.has(fsItem.id)) {
          merged.push(fsItem);
        }
      }
      return merged;
    },
    [deletedCsvIds]
  );

  const patients = useMemo(() => {
    if (!hasValidSession || !user) return [];
    let list = mergeCollection('patients', csvBundle?.patients || [], fsPatients);
    if (activeRole === 'collaborateur') {
      list = list.filter((p) => p.assignedPractitionerId === user.uid);
    } else if (activeRole === 'assistant') {
      list = list.map((p) => ({
        ...p,
        totalBilled: undefined,
        remainingDue: undefined,
        walletBalance: undefined,
      }));
    }
    return [...list].sort((a, b) => {
      const na = Number(a.fileNumber);
      const nb = Number(b.fileNumber);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
        return na - nb;
      }
      return (a.fileNumber || '').localeCompare(b.fileNumber || '', 'fr');
    });
  }, [hasValidSession, user, activeRole, mergeCollection, csvBundle, fsPatients]);

  const appointments = useMemo(() => {
    if (!hasValidSession || !user) return [];
    if (activeRole === 'collaborateur') {
      return fsAppointments.filter((a) => a.practitionerId === user.uid);
    }
    return fsAppointments;
  }, [hasValidSession, user, activeRole, fsAppointments]);

  const bookingRequests = useMemo(() => {
    if (!hasValidSession || (activeRole !== 'titulaire' && activeRole !== 'secretaire')) {
      return [];
    }
    return fsBookingRequests;
  }, [hasValidSession, activeRole, fsBookingRequests]);

  const clinicalActs = useMemo(() => {
    if (!hasValidSession || !user) return [];
    const base = csvBundle?.clinicalActs || [];
    if (activeRole === 'collaborateur') {
      return base.filter((a) => a.practitionerId === user.uid);
    }
    if (activeRole === 'assistant') {
      return base.map((a) => ({
        ...a,
        price: 0,
        receivedAmount: 0,
        remainingAmount: 0,
      }));
    }
    return base;
  }, [hasValidSession, user, activeRole, csvBundle]);

  const treatmentPlans = useMemo(() => {
    if (!hasValidSession || !user || activeRole === 'assistant') return [];
    let list = mergeCollection('treatmentPlans', csvBundle?.treatmentPlans || [], fsTreatmentPlans);
    if (activeRole === 'collaborateur') {
      list = list.filter((p) => p.practitionerId === user.uid);
    }
    return [...list].sort((a, b) => (b.quoteDate || '').localeCompare(a.quoteDate || '') || (b.quoteNumber || '').localeCompare(a.quoteNumber || '', 'fr'));
  }, [hasValidSession, user, activeRole, mergeCollection, csvBundle, fsTreatmentPlans]);

  const invoices = useMemo(() => {
    if (!hasValidSession || !user || activeRole === 'assistant') return [];
    let list = mergeCollection('invoices', csvBundle?.invoices || [], fsInvoices);
    if (activeRole === 'collaborateur') {
      list = list.filter((i) => i.practitionerId === user.uid);
    }
    return [...list].sort((a, b) => `${b.issueDate || ''}_${b.invoiceNumber || ''}`.localeCompare(`${a.issueDate || ''}_${a.invoiceNumber || ''}`));
  }, [hasValidSession, user, activeRole, mergeCollection, csvBundle, fsInvoices]);

  const payments = useMemo(() => {
    if (!hasValidSession || !user || activeRole === 'assistant') return [];
    let list = mergeCollection('payments', csvBundle?.payments || [], fsPayments);
    if (activeRole === 'collaborateur') {
      list = list.filter((p) => p.practitionerId === user.uid);
    }
    return [...list].sort((a, b) => `${b.date || ''}_${b.receiptNumber || ''}`.localeCompare(`${a.date || ''}_${a.receiptNumber || ''}`));
  }, [hasValidSession, user, activeRole, mergeCollection, csvBundle, fsPayments]);

  const labOrders = useMemo(() => {
    if (!hasValidSession || !user) return [];
    let list = mergeCollection('labOrders', csvBundle?.labOrders || [], fsLabOrders);
    if (activeRole === 'collaborateur') {
      list = list.filter((l) => l.practitionerId === user.uid);
    }
    return [...list].sort((a, b) => (b.orderNumber || '').localeCompare(a.orderNumber || '', 'fr'));
  }, [hasValidSession, user, activeRole, mergeCollection, csvBundle, fsLabOrders]);

  const medicalDocuments = useMemo(() => {
    if (!hasValidSession || !user || activeRole === 'assistant') return [];
    let list = mergeCollection('medicalDocuments', csvBundle?.medicalDocuments || [], fsMedicalDocuments);
    if (activeRole === 'collaborateur') {
      list = list.filter((d) => d.practitionerId === user.uid);
    }
    return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [hasValidSession, user, activeRole, mergeCollection, csvBundle, fsMedicalDocuments]);

  const recalls = useMemo(() => {
    if (!hasValidSession || !user || activeRole === 'assistant') return [];
    if (activeRole === 'collaborateur') {
      return fsRecalls.filter((r) => r.practitionerId === user.uid);
    }
    return fsRecalls;
  }, [hasValidSession, user, activeRole, fsRecalls]);

  const expenses = useMemo(() => {
    if (!hasValidSession || activeRole !== 'titulaire') return [];
    const list = mergeCollection('expenses', csvBundle?.expenses || [], fsExpenses);
    return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [hasValidSession, activeRole, mergeCollection, csvBundle, fsExpenses]);

  const cashClosures = useMemo(() => {
    if (!hasValidSession || (activeRole !== 'titulaire' && activeRole !== 'secretaire')) return [];
    return fsCashClosures;
  }, [hasValidSession, activeRole, fsCashClosures]);

  const inventory = useMemo(() => {
    if (!hasValidSession || (activeRole !== 'titulaire' && activeRole !== 'assistant')) return [];
    return fsInventory;
  }, [hasValidSession, activeRole, fsInventory]);

  const stockMovements = useMemo(() => {
    if (!hasValidSession || (activeRole !== 'titulaire' && activeRole !== 'assistant')) return [];
    return fsStockMovements;
  }, [hasValidSession, activeRole, fsStockMovements]);

  const resolveNonAssistantPractitionerUid = useCallback(
    (fallback?: string) => {
      if (fallback && fallback !== user?.uid) return fallback;
      const firstDoc = staffList.find(
        (s) => s.active && (s.role === 'titulaire' || s.role === 'collaborateur')
      );
      return firstDoc?.uid || firstDoc?.id || fallback || 'clinic_practitioner';
    },
    [staffList, user]
  );

  const ensureCsvPatientSynced = useCallback(
    async (patientId: string) => {
      if (!user || !patientId || !patientId.startsWith('csv_pat_')) return;
      if (syncedCsvPatientIdsRef.current.has(patientId) || fsPatients.some((p) => p.id === patientId)) {
        syncedCsvPatientIdsRef.current.add(patientId);
        return;
      }
      const patRef = doc(db, 'patients', patientId);
      const snap = await getDoc(patRef);
      if (snap.exists()) {
        syncedCsvPatientIdsRef.current.add(patientId);
        return;
      }
      const basePatient = csvBundle?.patients.find((p) => p.id === patientId);
      if (!basePatient) return;

      const preservedPractitionerId =
        actualRole === 'collaborateur'
          ? user.uid
          : actualRole === 'assistant'
          ? resolveNonAssistantPractitionerUid(basePatient.assignedPractitionerId)
          : basePatient.assignedPractitionerId || user.uid;

      const cleanPayload = sanitizeFirestorePayload('patients', {
        ...basePatient,
        fileNumber: (basePatient.fileNumber || patientId).trim().slice(0, 40) || patientId.slice(0, 40),
        firstName: (basePatient.firstName || 'Patient').trim().slice(0, 80) || 'Patient',
        lastName: (basePatient.lastName || 'Cabinet').trim().slice(0, 80) || 'Cabinet',
        birthDate: (basePatient.birthDate || '').trim().slice(0, 20),
        cin: (basePatient.cin || '').trim().slice(0, 30),
        profession: (basePatient.profession || '').trim().slice(0, 100),
        phone: (basePatient.phone || '').trim().slice(0, 30),
        email: (basePatient.email || '').trim().slice(0, 150),
        address: (basePatient.address || '').trim().slice(0, 250),
        referringDoctor: (basePatient.referringDoctor || '').trim().slice(0, 120),
        insuranceNumber: (basePatient.insuranceNumber || '').trim().slice(0, 60),
        coverageRate: Math.max(0, Math.min(100, Number(basePatient.coverageRate) || 0)),
        alertSummary: (basePatient.alertSummary || '').trim().slice(0, 250),
        assignedPractitionerId: preservedPractitionerId,
        createdBy: user.uid,
      });
      await setDoc(patRef, {
        ...cleanPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      syncedCsvPatientIdsRef.current.add(patientId);
    },
    [user, actualRole, fsPatients, csvBundle, resolveNonAssistantPractitionerUid]
  );

  const ensureCsvInvoiceSynced = useCallback(
    async (invoiceId: string) => {
      if (!user || !invoiceId || !invoiceId.startsWith('csv_inv_')) return;
      if (syncedCsvInvoiceIdsRef.current.has(invoiceId) || fsInvoices.some((i) => i.id === invoiceId)) {
        syncedCsvInvoiceIdsRef.current.add(invoiceId);
        return;
      }
      const invRef = doc(db, 'invoices', invoiceId);
      const snap = await getDoc(invRef);
      if (snap.exists()) {
        syncedCsvInvoiceIdsRef.current.add(invoiceId);
        return;
      }
      const baseInv = csvBundle?.invoices.find((i) => i.id === invoiceId);
      if (!baseInv) return;

      await ensureCsvPatientSynced(baseInv.patientId);
      const preservedPractitionerId =
        actualRole === 'collaborateur'
          ? user.uid
          : baseInv.practitionerId || user.uid;

      const cleanPayload = sanitizeFirestorePayload('invoices', {
        ...baseInv,
        invoiceNumber: (baseInv.invoiceNumber || invoiceId).trim().slice(0, 40) || invoiceId.slice(0, 40),
        patientName: (baseInv.patientName || 'Patient').trim().slice(0, 150) || 'Patient',
        issueDate: (baseInv.issueDate || todayISO()).trim().slice(0, 20) || todayISO(),
        items: Array.isArray(baseInv.items) ? baseInv.items.slice(0, 40) : [],
        practitionerId: preservedPractitionerId,
        createdBy: user.uid,
      });
      await setDoc(invRef, {
        ...cleanPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      syncedCsvInvoiceIdsRef.current.add(invoiceId);
    },
    [user, actualRole, fsInvoices, csvBundle, ensureCsvPatientSynced]
  );

  const signInWithCredentials = useCallback(async (loginOrEmail: string, password: string) => {
    setAuthError(null);
    const loginErr = validateLoginIdentifier(loginOrEmail);
    if (loginErr) {
      setAuthError(loginErr);
      throw new Error(loginErr);
    }
    if (!password || password.length < 6) {
      const msg = 'Le mot de passe doit contenir au moins 6 caractères.';
      setAuthError(msg);
      throw new Error(msg);
    }
    const { authEmail } = normalizeLoginIdentifier(loginOrEmail);
    try {
      await signInWithEmailAndPassword(auth, authEmail, password);
    } catch (err) {
      const friendly = mapFirebaseAuthError(err);
      setAuthError(friendly);
      throw new Error(friendly);
    }
  }, []);

  const sendPasswordReset = useCallback(async (loginOrEmail: string) => {
    setAuthError(null);
    const loginErr = validateLoginIdentifier(loginOrEmail);
    if (loginErr) {
      throw new Error(loginErr);
    }
    const { authEmail, isLocalLogin } = normalizeLoginIdentifier(loginOrEmail);
    if (isLocalLogin) {
      throw new Error(
        "Cet identifiant est un compte interne au cabinet (sans boîte email). Demandez au Praticien Titulaire de créer un nouvel accès dans Équipe & Rôles."
      );
    }
    try {
      await sendPasswordResetEmail(auth, authEmail);
    } catch (err) {
      throw new Error(mapFirebaseAuthError(err));
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
    const isStandaloneMobile =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        window.location.protocol === 'capacitor:' ||
        'Capacitor' in window) &&
      /iphone|ipad|ipod|android/i.test(window.navigator.userAgent || '');

    if (isStandaloneMobile && !isInIframe) {
      try {
        await signInWithRedirect(auth, googleProvider);
        return;
      } catch (redirectErr) {
        const friendly = mapFirebaseAuthError(redirectErr);
        setAuthError(friendly);
        throw new Error(friendly);
      }
    }

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (
        !isInIframe &&
        (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment')
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          const friendlyRedirect = mapFirebaseAuthError(redirectErr);
          setAuthError(friendlyRedirect);
          throw new Error(friendlyRedirect);
        }
      }
      const friendly = mapFirebaseAuthError(err);
      setAuthError(friendly);
      throw new Error(friendly);
    }
  }, []);

  const signInWithGoogleRedirect = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithRedirect(auth, googleProvider);
    } catch (err) {
      const friendly = mapFirebaseAuthError(err);
      setAuthError(friendly);
      throw new Error(friendly);
    }
  }, []);

  const refreshAuthAccess = useCallback(async () => {
    if (!auth.currentUser) return;
    setAuthLoading(true);
    await resolveStaffProfile(auth.currentUser);
    setAuthLoading(false);
  }, [resolveStaffProfile]);

  const logout = useCallback(async () => {
    setAuthError(null);
    setStaffProfile(null);
    setAccessPending(false);
    setPreviewRole('titulaire');
    setSelectedPatientId(null);
    setAgendaFocus(null);
    await signOut(auth);
  }, []);

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

  const createStaffAccount = useCallback(
    async (payload: {
      login: string;
      password: string;
      displayName: string;
      role: StaffRole;
      specialty?: string;
      chairName?: string;
    }): Promise<{ uid: string; login: string; authEmail: string }> => {
      if (!user || actualRole !== 'titulaire') {
        throw new Error('Seul le Praticien Titulaire peut créer des comptes utilisateurs.');
      }
      const loginErr = validateLoginIdentifier(payload.login);
      if (loginErr) {
        throw new Error(loginErr);
      }
      if (!payload.displayName.trim()) {
        throw new Error('Veuillez saisir le nom complet du membre.');
      }
      if (!payload.password || payload.password.length < 6) {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      }

      const { displayLogin, authEmail } = normalizeLoginIdentifier(payload.login);
      try {
        const newUid = await provisionAuthUserWithPassword(
          authEmail,
          payload.password,
          payload.displayName.trim()
        );
        await setDoc(doc(db, 'staff', newUid), {
          uid: newUid,
          login: displayLogin,
          email: authEmail,
          displayName: payload.displayName.trim(),
          role: payload.role,
          specialty: (payload.specialty || '').trim(),
          chairName: (payload.chairName || '').trim(),
          color: '#0284C7',
          active: true,
          inviteId: 'direct',
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        logActivity({
          category: 'administration',
          title: `Compte utilisateur créé : ${payload.displayName.trim()}`,
          detail: `Identifiant : ${displayLogin} · Rôle : ${payload.role}`,
          section: 'staff',
        });
        return { uid: newUid, login: displayLogin, authEmail };
      } catch (err) {
        const friendly = mapFirebaseAuthError(err);
        throw new Error(friendly);
      }
    },
    [user, actualRole, logActivity]
  );

  const setOwnPassword = useCallback(
    async (newPassword: string) => {
      const current = auth.currentUser;
      if (!current || !current.email) {
        throw new Error('Aucune session active avec identifiant email.');
      }
      if (!newPassword || newPassword.length < 6) {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      }
      try {
        const hasPasswordProvider = current.providerData.some((p) => p.providerId === 'password');
        if (hasPasswordProvider) {
          await updatePassword(current, newPassword);
        } else {
          const credential = EmailAuthProvider.credential(current.email, newPassword);
          await linkWithCredential(current, credential);
        }
        showToast('Votre mot de passe de connexion a été enregistré avec succès.', 'success');
      } catch (err) {
        throw new Error(mapFirebaseAuthError(err));
      }
    },
    [showToast]
  );

  const setActiveSection = useCallback(
    (section: AppSection) => {
      if (!hasValidSession) {
        setActiveSectionState('dashboard');
        return;
      }
      if (!canAccessSection(activeRole, section)) {
        showToast('Module non autorisé pour ce profil utilisateur.', 'error');
        setActiveSectionState('dashboard');
        return;
      }
      setActiveSectionState(section);
    },
    [hasValidSession, activeRole, showToast]
  );

  // Enforce active section & selectedPatientId validity immediately when activeRole / previewRole changes
  useEffect(() => {
    if (!hasValidSession) {
      setActiveSectionState('dashboard');
      setSelectedPatientId(null);
      return;
    }
    if (!canAccessSection(activeRole, activeSection)) {
      setActiveSectionState('dashboard');
    }
    if (selectedPatientId && !patients.some((p) => p.id === selectedPatientId)) {
      setSelectedPatientId(null);
    }
  }, [hasValidSession, activeRole, activeSection, selectedPatientId, patients]);

  const selectPatientWithLog = useCallback(
    (patientId: string | null) => {
      if (!patientId) {
        setSelectedPatientId(null);
        return;
      }
      const pat = patients.find((p) => p.id === patientId);
      if (!pat) {
        showToast('Dossier patient inaccessible pour votre profil.', 'error');
        return;
      }
      setSelectedPatientId(patientId);
      logActivity({
        category: 'patient',
        title: `Dossier patient ouvert : ${pat.firstName} ${pat.lastName}`,
        detail: `${pat.fileNumber} · ${pat.insuranceType}`,
        section: 'patients',
        patientId: pat.id,
      });
    },
    [patients, logActivity, showToast]
  );

  const openPatientFile = useCallback(
    (patientId: string) => {
      if (!canAccessSection(activeRole, 'patients')) {
        showToast('Accès au répertoire patients non autorisé.', 'error');
        return;
      }
      const pat = patients.find((p) => p.id === patientId);
      if (!pat) {
        showToast('Ce dossier patient n’est pas rattaché à votre profil.', 'error');
        return;
      }
      selectPatientWithLog(patientId);
      setActiveSection('patients');
    },
    [activeRole, patients, selectPatientWithLog, setActiveSection, showToast]
  );

  const openAgendaAt = useCallback(
    (date: string, appointmentId?: string) => {
      if (!canAccessSection(activeRole, 'appointments')) {
        showToast("Accès à l'agenda non autorisé.", 'error');
        return;
      }
      setAgendaFocus({ date, appointmentId });
      setActiveSection('appointments');
    },
    [activeRole, setActiveSection, showToast]
  );

  const clearAgendaFocus = useCallback(() => {
    setAgendaFocus(null);
  }, []);

  const setPrintableDoc = useCallback(
    (docPayload: PrintableDocumentPayload | null) => {
      if (docPayload) {
        const isFinancialDoc =
          docPayload.kind === 'quote' ||
          docPayload.kind === 'invoice' ||
          docPayload.kind === 'receipt' ||
          docPayload.kind === 'fee-note';
        const isMedicalDoc =
          docPayload.kind === 'prescription' ||
          docPayload.kind === 'certificate' ||
          docPayload.kind === 'care-sheet' ||
          docPayload.kind === 'fee-note';
        if (isFinancialDoc && !permissions.canViewFinancialTotals) {
          showToast('Impression financière non autorisée pour ce profil.', 'error');
          return;
        }
        if (isMedicalDoc && !canAccessSection(activeRole, 'documents')) {
          showToast('Impression des documents médicaux non autorisée pour ce profil.', 'error');
          return;
        }
        logActivity({
          category: docPayload.kind === 'prescription' || docPayload.kind === 'certificate' ? 'clinique' : 'facturation',
          title: `Document ouvert : ${docPayload.title}`,
          detail: `${docPayload.patientName}${docPayload.reference ? ` · ${docPayload.reference}` : ''}`,
          section: docPayload.kind === 'prescription' || docPayload.kind === 'certificate' ? 'documents' : 'invoices',
        });
      }
      setPrintableDocState(docPayload);
    },
    [permissions.canViewFinancialTotals, activeRole, logActivity, showToast]
  );

  const describeSavedRecord = useCallback(
    (
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
      case 'staff':
        return {
          category: 'administration',
          title: isCreate ? `Membre ajouté : ${str('displayName') || str('email')}` : 'Équipe & rôles mis à jour',
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
    },
    [patients, appointments, treatmentPlans, invoices, labOrders]
  );

  const projectWriteDataForRole = useCallback(
    (
      collectionName: string,
      docId: string,
      rawData: Record<string, unknown>,
      isCreate: boolean
    ): Record<string, unknown> => {
      if (!hasValidSession || !user) {
        throw new Error('Session non authentifiée ou accès inactif.');
      }

      const pickKeys = (keys: string[]) => {
        const subset: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in rawData && rawData[key] !== undefined) {
            subset[key] = rawData[key];
          }
        }
        return subset;
      };

      switch (collectionName) {
        case 'staff': {
          if (actualRole !== 'titulaire') {
            if (isCreate || docId !== user.uid) {
              throw new Error('Gestion des membres réservée au Praticien Titulaire.');
            }
            return pickKeys(['displayName', 'specialty', 'chairName', 'color']);
          }
          return rawData;
        }
        case 'settings':
        case 'actsCatalog':
        case 'expenses': {
          if (actualRole !== 'titulaire') {
            throw new Error('Modification réservée au Praticien Titulaire.');
          }
          return rawData;
        }
        case 'patients': {
          if (isCreate) {
            if (actualRole === 'assistant') {
              throw new Error("Création de dossier patient non autorisée pour l'assistant(e).");
            }
            if (actualRole === 'collaborateur' && rawData.assignedPractitionerId !== user.uid) {
              return { ...rawData, assignedPractitionerId: user.uid };
            }
            return rawData;
          }
          if (actualRole === 'titulaire') return rawData;
          if (actualRole === 'collaborateur') {
            const { assignedPractitionerId: _ignored, ...rest } = rawData;
            return rest;
          }
          if (actualRole === 'secretaire') {
            return pickKeys([
              'firstName', 'lastName', 'birthDate', 'cin', 'profession', 'phone', 'email',
              'address', 'referringDoctor', 'insuranceType', 'insuranceNumber', 'coverageRate',
              'assignedPractitionerId', 'active',
            ]);
          }
          if (actualRole === 'assistant') {
            return pickKeys(['odontogram', 'dentitionMode']);
          }
          throw new Error('Modification patient non autorisée.');
        }
        case 'appointments': {
          if (isCreate) {
            if (actualRole === 'assistant') {
              throw new Error("Création de rendez-vous non autorisée pour l'assistant(e).");
            }
            if (actualRole === 'collaborateur') {
              return { ...rawData, practitionerId: user.uid };
            }
            return rawData;
          }
          if (actualRole === 'titulaire') return rawData;
          if (actualRole === 'secretaire') {
            return pickKeys([
              'practitionerId', 'practitionerName', 'chair', 'date', 'startTime',
              'durationMinutes', 'actType', 'categoryColor', 'status', 'arrivedAt',
              'notes', 'isUrgent', 'reminderStatus',
            ]);
          }
          if (actualRole === 'collaborateur') {
            return pickKeys([
              'date', 'startTime', 'durationMinutes', 'actType', 'status', 'arrivedAt', 'notes', 'reminderStatus',
            ]);
          }
          throw new Error("Modification du planning non autorisée pour l'assistant(e).");
        }
        case 'bookingRequests': {
          if (isCreate) return rawData;
          if (actualRole !== 'titulaire' && actualRole !== 'secretaire') {
            throw new Error('Traitement des pré-réservations réservé au Titulaire ou Secrétariat.');
          }
          return pickKeys(['status', 'practitionerId']);
        }
        case 'treatmentPlans': {
          if (actualRole === 'assistant') {
            throw new Error('Accès aux plans de traitement non autorisé.');
          }
          if (isCreate) {
            if (actualRole === 'collaborateur') {
              return { ...rawData, practitionerId: user.uid };
            }
            return rawData;
          }
          if (actualRole === 'titulaire') return rawData;
          const existingPlan = treatmentPlans.find((p) => p.id === docId);
          if (existingPlan?.lockedVersion) {
            return pickKeys(['status', 'items']);
          }
          return pickKeys([
            'title', 'status', 'items', 'totalAmount', 'insuranceEstimated',
            'consentSigned', 'lockedVersion',
          ]);
        }
        case 'invoices': {
          if (actualRole !== 'titulaire' && actualRole !== 'secretaire') {
            throw new Error('Facturation réservée au Titulaire ou au Secrétariat.');
          }
          if (isCreate) return rawData;
          if (actualRole === 'titulaire') return rawData;
          return pickKeys(['paidAmount', 'insurancePaidAmount', 'status', 'insuranceClaimStatus', 'dueDate']);
        }
        case 'payments': {
          if (isCreate) {
            if (actualRole !== 'titulaire' && actualRole !== 'secretaire') {
              throw new Error('Encaissement réservé au Titulaire ou au Secrétariat.');
            }
            return rawData;
          }
          if (actualRole !== 'titulaire') {
            throw new Error('Modification d’un paiement réservée au Praticien Titulaire.');
          }
          return pickKeys(['notes', 'chequeDepositDate']);
        }
        case 'labOrders': {
          if (isCreate) {
            if (actualRole === 'secretaire') {
              throw new Error('Création de fiche prothèse non autorisée pour le secrétariat.');
            }
            if (actualRole === 'collaborateur') {
              return { ...rawData, practitionerId: user.uid };
            }
            return rawData;
          }
          if (actualRole === 'titulaire') return rawData;
          return pickKeys([
            'status', 'dueDate', 'nextAppointmentDate', 'supplierInvoiceRef',
            'supplierPaid', 'labCost', 'notes',
          ]);
        }
        case 'medicalDocuments': {
          if (isCreate) {
            if (actualRole !== 'titulaire' && actualRole !== 'collaborateur') {
              throw new Error('Émission de document médical réservée aux praticiens.');
            }
            if (actualRole === 'collaborateur') {
              return { ...rawData, practitionerId: user.uid };
            }
            return rawData;
          }
          if (actualRole !== 'titulaire') {
            throw new Error('Modification de document médical réservée au Praticien Titulaire.');
          }
          return pickKeys(['title', 'prescriptions', 'bodyText']);
        }
        case 'recalls': {
          if (actualRole === 'assistant') {
            throw new Error('Gestion des rappels non autorisée pour ce profil.');
          }
          if (isCreate) {
            if (actualRole === 'collaborateur') {
              return { ...rawData, practitionerId: user.uid };
            }
            return rawData;
          }
          return pickKeys(['channel', 'status', 'deliveryStatus', 'lastSentAt', 'dueDate', 'notes']);
        }
        case 'cashClosures': {
          if (isCreate) {
            if (actualRole !== 'titulaire' && actualRole !== 'secretaire') {
              throw new Error('Clôture de caisse réservée au Titulaire ou au Secrétariat.');
            }
            return rawData;
          }
          if (actualRole !== 'titulaire') {
            throw new Error('Modification d’une clôture verrouillée réservée au Titulaire.');
          }
          return pickKeys(['countedBalance', 'discrepancy', 'notes', 'locked']);
        }
        case 'inventory': {
          if (actualRole !== 'titulaire' && actualRole !== 'assistant') {
            throw new Error('Gestion du stock réservée au Titulaire ou à l’Assistant(e).');
          }
          return rawData;
        }
        case 'stockMovements': {
          if (!isCreate || (actualRole !== 'titulaire' && actualRole !== 'assistant')) {
            throw new Error('Journal de stock réservé au Titulaire ou à l’Assistant(e).');
          }
          return rawData;
        }
        case 'adminDocuments': {
          if (actualRole !== 'titulaire' && actualRole !== 'secretaire') {
            throw new Error('Suivi administratif réservé au Titulaire ou au Secrétariat.');
          }
          if (isCreate || actualRole === 'titulaire') return rawData;
          return pickKeys([
            'title', 'category', 'provider', 'reference', 'expiryDate',
            'alertDaysBefore', 'status', 'notes',
          ]);
        }
        default:
          return rawData;
      }
    },
    [hasValidSession, user, actualRole, treatmentPlans]
  );

  const saveRecord = useCallback(
    async (
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
      'actsCatalog',
    ];
    const collectionsRequiringPatient = [
      'appointments',
      'treatmentPlans',
      'invoices',
      'labOrders',
      'medicalDocuments',
      'recalls',
    ];

    try {
      const projectedData = projectWriteDataForRole(collectionName, docId, data, isCreate);

      if (
        collectionsRequiringPatient.includes(collectionName) &&
        typeof projectedData.patientId === 'string' &&
        projectedData.patientId.startsWith('csv_pat_')
      ) {
        await ensureCsvPatientSynced(projectedData.patientId);
      }
      if (
        collectionName === 'payments' &&
        typeof projectedData.invoiceId === 'string' &&
        projectedData.invoiceId.startsWith('csv_inv_')
      ) {
        await ensureCsvInvoiceSynced(projectedData.invoiceId);
      }

      if (isCreate) {
        const cleanCreate = sanitizeFirestorePayload(collectionName, projectedData);
        await setDoc(docRef, {
          ...cleanCreate,
          ...(!collectionsWithoutCreatedAt.includes(collectionName) ? { createdAt: serverTimestamp() } : {}),
          ...(!collectionsWithoutUpdatedAt.includes(collectionName) ? { updatedAt: serverTimestamp() } : {}),
        });
      } else if (docId.startsWith('csv_')) {
        let snap = await getDoc(docRef);
        if (!snap.exists() && collectionName === 'patients' && docId.startsWith('csv_pat_')) {
          syncedCsvPatientIdsRef.current.delete(docId);
          await ensureCsvPatientSynced(docId);
          snap = await getDoc(docRef);
        }
        if (!snap.exists()) {
          let baseRecord: Record<string, unknown> | undefined;
          if (collectionName === 'patients') {
            baseRecord = csvBundle?.patients.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          } else if (collectionName === 'treatmentPlans') {
            baseRecord = csvBundle?.treatmentPlans.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          } else if (collectionName === 'invoices') {
            baseRecord = csvBundle?.invoices.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          } else if (collectionName === 'payments') {
            baseRecord = csvBundle?.payments.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          } else if (collectionName === 'labOrders') {
            baseRecord = csvBundle?.labOrders.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          } else if (collectionName === 'medicalDocuments') {
            baseRecord = csvBundle?.medicalDocuments.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          } else if (collectionName === 'expenses') {
            baseRecord = csvBundle?.expenses.find((r) => r.id === docId) as unknown as Record<string, unknown>;
          }

          const merged = { ...(baseRecord || {}), ...projectedData };
          if (user) {
            merged.createdBy = user.uid;
            if ('assignedPractitionerId' in merged) {
              merged.assignedPractitionerId =
                actualRole === 'collaborateur'
                  ? user.uid
                  : actualRole === 'assistant'
                  ? resolveNonAssistantPractitionerUid(
                      typeof merged.assignedPractitionerId === 'string'
                        ? merged.assignedPractitionerId
                        : undefined
                    )
                  : (typeof merged.assignedPractitionerId === 'string' && merged.assignedPractitionerId) ||
                    user.uid;
            }
            if ('practitionerId' in merged) {
              merged.practitionerId =
                actualRole === 'collaborateur'
                  ? user.uid
                  : (typeof merged.practitionerId === 'string' && merged.practitionerId) ||
                    user.uid;
            }
          }
          if (
            collectionsRequiringPatient.includes(collectionName) &&
            typeof merged.patientId === 'string' &&
            merged.patientId.startsWith('csv_pat_')
          ) {
            await ensureCsvPatientSynced(merged.patientId);
          }

          if (collectionName === 'treatmentPlans') {
            merged.quoteNumber = String(merged.quoteNumber || docId).trim().slice(0, 40) || 'Devis';
            merged.patientName = String(merged.patientName || 'Patient').trim().slice(0, 150) || 'Patient';
            merged.practitionerName =
              String(merged.practitionerName || 'Dr. Sara Bchi').trim().slice(0, 120) || 'Dr. Sara Bchi';
            merged.title = String(merged.title || 'Plan de traitement').trim().slice(0, 180) || 'Plan de traitement';
            merged.items = Array.isArray(merged.items) ? merged.items.slice(0, 40) : [];
          } else if (collectionName === 'invoices') {
            merged.invoiceNumber = String(merged.invoiceNumber || docId).trim().slice(0, 40) || docId.slice(0, 40);
            merged.patientName = String(merged.patientName || 'Patient').trim().slice(0, 150) || 'Patient';
            merged.issueDate = String(merged.issueDate || todayISO()).trim().slice(0, 20) || todayISO();
            merged.items = Array.isArray(merged.items) ? merged.items.slice(0, 40) : [];
          } else if (collectionName === 'labOrders') {
            merged.orderNumber = String(merged.orderNumber || docId).trim().slice(0, 40) || 'LAB';
            merged.patientName = String(merged.patientName || 'Patient').trim().slice(0, 150) || 'Patient';
            merged.labName = String(merged.labName || 'Laboratoire').trim().slice(0, 120) || 'Laboratoire';
          } else if (collectionName === 'medicalDocuments') {
            merged.patientName = String(merged.patientName || 'Patient').trim().slice(0, 150) || 'Patient';
            merged.date = String(merged.date || todayISO()).trim().slice(0, 20) || todayISO();
            merged.title =
              String(merged.title || merged.docType || 'Document médical').trim().slice(0, 160) || 'Document médical';
          } else if (collectionName === 'expenses') {
            merged.date = String(merged.date || todayISO()).trim().slice(0, 20) || todayISO();
            merged.label = String(merged.label || 'Charge cabinet').trim().slice(0, 180) || 'Charge cabinet';
          } else if (collectionName === 'payments') {
            merged.receiptNumber = String(merged.receiptNumber || docId).trim().slice(0, 40) || docId.slice(0, 40);
            merged.patientName = String(merged.patientName || 'Patient').trim().slice(0, 150) || 'Patient';
            merged.date = String(merged.date || todayISO()).trim().slice(0, 20) || todayISO();
            if (Number(merged.amount || 0) === 0) {
              throw new Error("Impossible de synchroniser un paiement d'archive de montant nul (0 MAD).");
            }
          }

          if (
            collectionName === 'payments' &&
            typeof merged.invoiceId === 'string' &&
            merged.invoiceId.startsWith('csv_inv_')
          ) {
            if (merged.invoiceId.startsWith('csv_inv_ref_')) {
              const fallbackInv =
                fsInvoices.find((i) => i.patientId === merged.patientId && i.status !== 'Annulée') ||
                csvBundle?.invoices.find((i) => i.patientId === merged.patientId && i.status !== 'Annulée');
              if (!fallbackInv) {
                throw new Error(
                  "Ce paiement d'archive n'est rattaché à aucune facture émise pour ce patient."
                );
              }
              merged.invoiceId = fallbackInv.id;
            }
            if (typeof merged.invoiceId === 'string' && merged.invoiceId.startsWith('csv_inv_')) {
              await ensureCsvInvoiceSynced(merged.invoiceId);
            }
          }

          const cleanMerged = sanitizeFirestorePayload(collectionName, merged);
          await setDoc(docRef, {
            ...cleanMerged,
            ...(!collectionsWithoutCreatedAt.includes(collectionName) ? { createdAt: serverTimestamp() } : {}),
            ...(!collectionsWithoutUpdatedAt.includes(collectionName) ? { updatedAt: serverTimestamp() } : {}),
          });
        } else {
          const cleanUpdate = sanitizeFirestorePayload(collectionName, projectedData);
          await updateDoc(docRef, {
            ...cleanUpdate,
            ...(!collectionsWithoutUpdatedAt.includes(collectionName) ? { updatedAt: serverTimestamp() } : {}),
          });
        }
      } else {
        const cleanUpdate = sanitizeFirestorePayload(collectionName, projectedData);
        await updateDoc(docRef, {
          ...cleanUpdate,
          ...(!collectionsWithoutUpdatedAt.includes(collectionName) ? { updatedAt: serverTimestamp() } : {}),
        });
      }
      const entry = describeSavedRecord(collectionName, docId, projectedData, isCreate);
      if (entry) {
        logActivity(entry);
      }
    } catch (error) {
      handleFirestoreError(
        error,
        isCreate ? OperationType.CREATE : OperationType.UPDATE,
        `${collectionName}/${docId}`,
        {
          kind: 'saveRecord',
          collectionName,
          docId,
          data,
          isCreate,
        }
      );
    }
    },
    [
      user,
      actualRole,
      csvBundle,
      projectWriteDataForRole,
      ensureCsvPatientSynced,
      ensureCsvInvoiceSynced,
      resolveNonAssistantPractitionerUid,
      describeSavedRecord,
      logActivity,
    ]
  );

  const removeRecord = useCallback(
    async (collectionName: string, id: string) => {
    if (!hasValidSession || actualRole !== 'titulaire') {
      throw new Error('Suppression non autorisée : action réservée au Praticien Titulaire.');
    }
    try {
      if (id.startsWith('csv_')) {
        const snap = await getDoc(doc(db, collectionName, id));
        if (snap.exists()) {
          await deleteDoc(doc(db, collectionName, id));
        }
        setDeletedCsvIds((prev) => {
          const current = prev[collectionName] || [];
          if (current.includes(id)) return prev;
          const next = { ...prev, [collectionName]: [...current, id] };
          if (user) {
            try {
              window.localStorage.setItem(`dentaflow_csv_deleted_${user.uid}`, JSON.stringify(next));
            } catch {
              // Ignore storage quota errors
            }
          }
          return next;
        });
      } else {
        await deleteDoc(doc(db, collectionName, id));
      }
      const sectionByCollection: Record<string, { section: AppSection; category: ActivityCategory; label: string }> = {
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
      handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`, {
        kind: 'removeRecord',
        collectionName,
        docId: id,
      });
    }
    },
    [hasValidSession, actualRole, user, logActivity]
  );

  const incrementCounter = useCallback(
    async (
      counterKey: 'invoiceCounter' | 'quoteCounter' | 'receiptCounter'
    ): Promise<number> => {
      if (
        !hasValidSession ||
        (actualRole !== 'titulaire' && actualRole !== 'secretaire' && actualRole !== 'collaborateur')
      ) {
        throw new Error('Incrémentation de compteur non autorisée pour ce profil.');
      }
      const settingsRef = doc(db, 'settings', 'clinic');
      const minBaseline = counterKey === 'invoiceCounter' ? 164 : counterKey === 'quoteCounter' ? 38 : 0;
      const fallbackNext = Math.max(Number(clinicSettings?.[counterKey] ?? 0), minBaseline) + 1;
      try {
        const nextVal = await runTransaction(db, async (tx) => {
          const snap = await tx.get(settingsRef);
          const current = snap.exists() ? Number(snap.data()?.[counterKey] || 0) : 0;
          const next = Math.max(current, minBaseline) + 1;
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
    },
    [hasValidSession, actualRole, clinicSettings]
  );

  const pendingSyncCollections = useMemo(
    () =>
      Object.entries(pendingMap)
        .filter(([, pending]) => pending)
        .map(([key]) => key),
    [pendingMap]
  );

  const hasPendingSync = pendingSyncCollections.length > 0;

  const checkServerConnection = useCallback(async () => {
    const res = await verifyFirestoreServerSync();
    if (res.ok) {
      autoResolveRecoverableSyncErrors();
      showToast(`Serveur Firestore joignable (${res.latencyMs} ms). Cache synchronisé.`, 'success');
    } else {
      showToast(res.error || 'Serveur Firestore inaccessible pour le moment.', 'error');
    }
    return res;
  }, [showToast]);

  const retrySyncError = useCallback(
    async (logId: string): Promise<boolean> => {
      const target = syncErrorLogs.find((item) => item.id === logId);
      if (!target) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        showToast('Connexion Internet requise pour relancer la synchronisation.', 'error');
        return false;
      }

      incrementSyncErrorRetry(logId);
      try {
        if (target.retryPayload?.kind === 'saveRecord' && target.retryPayload.data) {
          await saveRecord(
            target.retryPayload.collectionName,
            target.retryPayload.docId,
            target.retryPayload.data,
            Boolean(target.retryPayload.isCreate)
          );
          markSyncErrorResolved(logId);
          showToast(`Synchronisation réussie pour ${target.path}.`, 'success');
          return true;
        }
        if (target.retryPayload?.kind === 'removeRecord') {
          await removeRecord(target.retryPayload.collectionName, target.retryPayload.docId);
          markSyncErrorResolved(logId);
          showToast(`Suppression synchronisée pour ${target.path}.`, 'success');
          return true;
        }

        if (target.category === 'permission') {
          await refreshAuthAccess();
        } else if (target.category === 'listener' || target.errorCode === 'already-exists') {
          await resyncFirestoreNetwork({ forceReset: true });
        }
        const serverCheck = await verifyFirestoreServerSync();
        if (serverCheck.ok) {
          markSyncErrorResolved(logId);
          showToast(`Flux vérifié et résolu (${serverCheck.latencyMs} ms).`, 'success');
          return true;
        }
        showToast(serverCheck.error || 'Échec lors de la nouvelle tentative.', 'error');
        return false;
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : `Échec de la relance pour ${target.path}.`,
          'error'
        );
        return false;
      }
    },
    [syncErrorLogs, saveRecord, removeRecord, refreshAuthAccess, showToast]
  );

  const retryAllSyncErrors = useCallback(async () => {
    const activeLogs = syncErrorLogs.filter((item) => !item.resolved);
    if (activeLogs.length === 0) {
      return { succeeded: 0, failed: 0 };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('Impossible de relancer : vous êtes toujours hors ligne.', 'error');
      return { succeeded: 0, failed: activeLogs.length };
    }

    let succeeded = 0;
    let failed = 0;
    for (const log of activeLogs) {
      const ok = await retrySyncError(log.id);
      if (ok) succeeded += 1;
      else failed += 1;
    }

    if (succeeded > 0 && failed === 0) {
      showToast(`${succeeded} erreur(s) de synchronisation résolue(s).`, 'success');
    } else if (succeeded > 0 && failed > 0) {
      showToast(`${succeeded} résolue(s), ${failed} toujours en échec.`, 'info');
    }
    return { succeeded, failed };
  }, [syncErrorLogs, retrySyncError, showToast]);

  const resolveSyncError = useCallback((logId: string) => {
    markSyncErrorResolved(logId);
  }, []);

  const clearResolvedSyncErrors = useCallback(() => {
    clearResolvedSyncErrorLogsStore();
    showToast('Erreurs résolues retirées du journal.', 'info');
  }, [showToast]);

  const clearAllSyncErrors = useCallback(() => {
    clearAllSyncErrorLogsStore();
    showToast('Journal des erreurs de synchronisation vidé.', 'info');
  }, [showToast]);

  const fetchClinicalNotesForExport = useCallback(async (): Promise<ClinicalNote[]> => {
    if (!hasValidSession || !permissions.canAccessReports || fsPatients.length === 0) {
      return [];
    }
    const scopedPatients =
      activeRole === 'collaborateur' && user
        ? fsPatients.filter((p) => p.assignedPractitionerId === user.uid)
        : fsPatients;
    if (scopedPatients.length === 0) return [];
    const notes: ClinicalNote[] = [];
    const BATCH_SIZE = 8;
    for (let i = 0; i < scopedPatients.length; i += BATCH_SIZE) {
      const batch = scopedPatients.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map((pat) =>
          getDocs(
            query(
              collection(db, 'patients', pat.id, 'clinicalNotes'),
              where('patientId', '==', pat.id)
            )
          )
        )
      );
      for (const res of settled) {
        if (res.status === 'fulfilled') {
          res.value.docs.forEach((d) => {
            notes.push({
              id: d.id,
              ...(d.data() as Omit<ClinicalNote, 'id'>),
            });
          });
        }
      }
    }
    return notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [hasValidSession, permissions.canAccessReports, activeRole, user, fsPatients]);

  const latestSmsStateRef = useRef({
    appointments,
    recalls,
    clinicSettings,
    patients,
  });
  latestSmsStateRef.current = {
    appointments,
    recalls,
    clinicSettings,
    patients,
  };

  const sendAppointmentReminder = useCallback(
    async (
      apt: Appointment,
      channel: 'SMS' | 'WhatsApp' | 'Appel',
      options?: { isAuto?: boolean; customMessage?: string }
    ): Promise<boolean> => {
      if (!user || !staffProfile?.active) return false;
      if (actualRole === 'assistant') return false;

      const { recalls: currentRecalls, clinicSettings: currentSettings, patients: currentPatients } =
        latestSmsStateRef.current;

      const isAuto = Boolean(options?.isAuto) && channel === 'SMS';
      const alreadyTagged = currentRecalls.some(
        (r) => r.channel === 'SMS' && (r.notes || '').includes(`[RDV:${apt.id}]`)
      );
      if (isAuto && (alreadyTagged || dispatchedSmsAptIdsRef.current.has(apt.id))) {
        return false;
      }

      const smsCfg = resolveSmsReminderSettings(currentSettings);
      const linkedPatient = currentPatients.find((p) => p.id === apt.patientId);
      const phone = (apt.patientPhone || linkedPatient?.phone || '').trim().slice(0, 40);
      if (!phone) {
        if (!isAuto) {
          throw new Error('Aucun numéro de téléphone enregistré pour ce patient.');
        }
        return false;
      }

      if (channel === 'SMS') {
        dispatchedSmsAptIdsRef.current.add(apt.id);
      }

      const nowIso = new Date().toISOString().slice(0, 38);
      const customText = options?.customMessage?.trim();
      const message = (
        customText && customText.length > 0
          ? customText
          : formatSmsReminderMessage(smsCfg.template, apt, currentSettings)
      ).slice(0, 900);

      const canUpdateAptReminderStatus =
        actualRole === 'titulaire' ||
        actualRole === 'secretaire' ||
        (actualRole === 'collaborateur' && apt.practitionerId === user.uid);

      try {
        if (channel === 'SMS') {
          const reasonPrefix = isAuto
            ? `Rappel SMS ${smsCfg.hoursBefore}h`
            : 'Rappel SMS manuel';
          const reason = `${reasonPrefix} · RDV ${apt.startTime} (${apt.actType})`.slice(0, 155);

          const gatewayRes = await sendSmsViaGateway({
            to: phone,
            message,
            patientName: apt.patientName,
            appointmentId: apt.id,
            clinicName: currentSettings?.clinicName,
          });

          const deliveryStatus: 'Non envoyé' | 'Délivré' | 'Échec' = !gatewayRes.ok
            ? 'Échec'
            : gatewayRes.delivered
            ? 'Délivré'
            : 'Non envoyé';

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
              status: gatewayRes.ok ? 'Envoyé' : 'À faire',
              deliveryStatus,
              lastSentAt: nowIso,
              notes: buildRecallSmsNotes(apt.id, message),
              createdBy: user.uid,
            },
            true
          );

          if (!gatewayRes.ok) {
            dispatchedSmsAptIdsRef.current.delete(apt.id);
            throw new Error(gatewayRes.error || "Échec d'envoi sur la passerelle SMS.");
          }

          if (canUpdateAptReminderStatus) {
            const statusLabel = isAuto
              ? `SMS ${smsCfg.hoursBefore}h envoyé`.slice(0, 38)
              : 'SMS envoyé';
            await saveRecord('appointments', apt.id, {
              reminderStatus: statusLabel,
            });
          }
          return true;
        }

        if (channel === 'WhatsApp') {
          const fallbackWaUrl = buildWhatsAppUrl(phone, message);
          if (!fallbackWaUrl) {
            throw new Error('Numéro de téléphone invalide pour WhatsApp.');
          }

          const waGatewayRes = await sendWhatsAppViaGateway({
            to: phone,
            message,
            patientName: apt.patientName,
            appointmentId: apt.id,
            appointmentDate: formatDateFR(apt.date),
            appointmentTime: apt.startTime,
            actType: apt.actType,
            clinicName: currentSettings?.clinicName,
          });

          const reason = `Rappel WhatsApp · RDV ${apt.startTime} (${apt.actType})`.slice(0, 155);

          if (!waGatewayRes.ok) {
            await saveRecord(
              'recalls',
              generateSafeId('wa'),
              {
                patientId: apt.patientId,
                patientName: (apt.patientName || 'Patient').slice(0, 145),
                patientPhone: phone,
                practitionerId: apt.practitionerId || user.uid,
                reason,
                dueDate: (apt.date || '').slice(0, 20),
                channel: 'WhatsApp',
                status: 'À faire',
                deliveryStatus: 'Échec',
                lastSentAt: nowIso,
                notes: buildRecallSmsNotes(apt.id, message),
                createdBy: user.uid,
              },
              true
            );
            throw new Error(
              waGatewayRes.error || "Échec d'envoi via l'API WhatsApp Business."
            );
          }

          if (!waGatewayRes.delivered) {
            const targetUrl = waGatewayRes.waUrl || fallbackWaUrl;
            triggerExternalActionLink(targetUrl, true);
          }

          await saveRecord(
            'recalls',
            generateSafeId('wa'),
            {
              patientId: apt.patientId,
              patientName: (apt.patientName || 'Patient').slice(0, 145),
              patientPhone: phone,
              practitionerId: apt.practitionerId || user.uid,
              reason,
              dueDate: (apt.date || '').slice(0, 20),
              channel: 'WhatsApp',
              status: 'Envoyé',
              deliveryStatus: waGatewayRes.delivered ? 'Délivré' : 'Non envoyé',
              lastSentAt: nowIso,
              notes: buildRecallSmsNotes(apt.id, message),
              createdBy: user.uid,
            },
            true
          );

          if (canUpdateAptReminderStatus) {
            await saveRecord('appointments', apt.id, {
              reminderStatus: waGatewayRes.delivered ? 'WhatsApp API envoyé' : 'WhatsApp envoyé',
            });
          }
          return true;
        }

        // Canal Appel
        const telUri = buildTelUri(phone);
        if (!telUri) {
          throw new Error("Numéro de téléphone invalide pour lancer l'appel.");
        }
        triggerExternalActionLink(telUri, false);

        const reason = `Appel téléphonique · RDV ${apt.startTime} (${apt.actType})`.slice(0, 155);
        await saveRecord(
          'recalls',
          generateSafeId('call'),
          {
            patientId: apt.patientId,
            patientName: (apt.patientName || 'Patient').slice(0, 145),
            patientPhone: phone,
            practitionerId: apt.practitionerId || user.uid,
            reason,
            dueDate: (apt.date || '').slice(0, 20),
            channel: 'Appel',
            status: 'Envoyé',
            deliveryStatus: 'Délivré',
            lastSentAt: nowIso,
            notes: buildRecallSmsNotes(apt.id, `Appel téléphonique initié vers ${phone}.`),
            createdBy: user.uid,
          },
          true
        );

        if (canUpdateAptReminderStatus) {
          await saveRecord('appointments', apt.id, {
            reminderStatus: 'Appel effectué',
          });
        }
        return true;
      } catch (err) {
        if (channel === 'SMS') {
          dispatchedSmsAptIdsRef.current.delete(apt.id);
        }
        throw err;
      }
    },
    [user, staffProfile, actualRole, saveRecord]
  );

  const sendAppointmentSmsReminder = useCallback(
    async (
      apt: Appointment,
      options?: { isAuto?: boolean; customMessage?: string }
    ): Promise<boolean> => {
      return sendAppointmentReminder(apt, 'SMS', options);
    },
    [sendAppointmentReminder]
  );

  const dispatchRecallNotification = useCallback(
    async (
      recall: Recall,
      channelOverride?: 'SMS' | 'WhatsApp' | 'Appel'
    ): Promise<boolean> => {
      if (!user || !staffProfile?.active) return false;
      if (actualRole === 'assistant') return false;

      const { clinicSettings: currentSettings, patients: currentPatients } =
        latestSmsStateRef.current;
      const effectiveChannel = channelOverride || recall.channel || 'SMS';
      const linkedPatient = currentPatients.find((p) => p.id === recall.patientId);
      const phone = (recall.patientPhone || linkedPatient?.phone || '').trim().slice(0, 40);
      if (!phone) {
        throw new Error('Numéro de téléphone du patient manquant.');
      }

      const clinicName = currentSettings?.clinicName || 'Cabinet Dentaire Dr. Sara Bchi';
      const clinicPhone = currentSettings?.phone || '+212 532 101 351';
      const existingNote = stripRecallAppointmentTag(recall.notes);
      const fallbackMessage =
        existingNote ||
        `Bonjour ${recall.patientName}, rappel du ${clinicName} : ${recall.reason} (prévu le ${formatDateFR(recall.dueDate)}). Tél : ${clinicPhone}`;

      const nowIso = new Date().toISOString().slice(0, 38);

      if (effectiveChannel === 'SMS') {
        const gatewayRes = await sendSmsViaGateway({
          to: phone,
          message: fallbackMessage,
          patientName: recall.patientName,
          clinicName,
        });

        const deliveryStatus: 'Non envoyé' | 'Délivré' | 'Échec' = !gatewayRes.ok
          ? 'Échec'
          : gatewayRes.delivered
          ? 'Délivré'
          : 'Non envoyé';

        await saveRecord('recalls', recall.id, {
          channel: 'SMS',
          status: gatewayRes.ok ? 'Envoyé' : 'À faire',
          deliveryStatus,
          lastSentAt: nowIso,
        });

        if (!gatewayRes.ok) {
          throw new Error(gatewayRes.error || "Échec d'envoi sur la passerelle SMS.");
        }
        return true;
      }

      if (effectiveChannel === 'WhatsApp') {
        const waUrl = buildWhatsAppUrl(phone, fallbackMessage);
        if (!waUrl) {
          throw new Error('Numéro de téléphone invalide pour WhatsApp.');
        }
        const waGatewayRes = await sendWhatsAppViaGateway({
          to: phone,
          message: fallbackMessage,
          patientName: recall.patientName,
          appointmentDate: formatDateFR(recall.dueDate),
          actType: recall.reason,
          clinicName,
        });
        if (!waGatewayRes.ok) {
          await saveRecord('recalls', recall.id, {
            channel: 'WhatsApp',
            status: 'À faire',
            deliveryStatus: 'Échec',
            lastSentAt: nowIso,
          });
          throw new Error(waGatewayRes.error || "Échec d'envoi via l'API WhatsApp Business.");
        }
        if (!waGatewayRes.delivered) {
          triggerExternalActionLink(waGatewayRes.waUrl || waUrl, true);
        }
        await saveRecord('recalls', recall.id, {
          channel: 'WhatsApp',
          status: 'Envoyé',
          deliveryStatus: waGatewayRes.delivered ? 'Délivré' : 'Non envoyé',
          lastSentAt: nowIso,
        });
        return true;
      }

      // Appel
      const telUri = buildTelUri(phone);
      if (!telUri) {
        throw new Error("Numéro de téléphone invalide pour lancer l'appel.");
      }
      triggerExternalActionLink(telUri, false);
      await saveRecord('recalls', recall.id, {
        channel: 'Appel',
        status: 'Envoyé',
        deliveryStatus: 'Délivré',
        lastSentAt: nowIso,
      });
      return true;
    },
    [user, staffProfile, actualRole, saveRecord]
  );

  const runDueSmsReminders = useCallback(
    async (manual = false): Promise<number> => {
      if (!user || !staffProfile?.active) return 0;
      if (actualRole !== 'titulaire' && actualRole !== 'secretaire') return 0;
      const { appointments: currentAppointments, recalls: currentRecalls, clinicSettings: currentSettings } =
        latestSmsStateRef.current;
      const smsCfg = resolveSmsReminderSettings(currentSettings);
      if (!manual && !smsCfg.enabled) return 0;

      const now = new Date();
      const dueAppointments = currentAppointments.filter((apt) => {
        if (!isAppointmentDueForSmsReminder(apt, smsCfg.hoursBefore, now)) return false;
        if (dispatchedSmsAptIdsRef.current.has(apt.id)) return false;
        const alreadySentInHistory = currentRecalls.some(
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
    [user, staffProfile, actualRole, sendAppointmentSmsReminder, showToast]
  );

  const smsAutomationEnabled = Boolean(
    clinicSettings && resolveSmsReminderSettings(clinicSettings).enabled
  );

  useEffect(() => {
    if (!user || !staffProfile?.active || !smsAutomationEnabled) return;
    if (actualRole !== 'titulaire' && actualRole !== 'secretaire') return;

    const initialTimer = window.setTimeout(() => {
      void runDueSmsReminders(false);
    }, 1500);
    const intervalId = window.setInterval(() => {
      void runDueSmsReminders(false);
    }, 60_000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [user, staffProfile, actualRole, smsAutomationEnabled, runDueSmsReminders]);

  const contextValue = useMemo<ClinicContextValue>(
    () => ({
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
      patients,
      clinicalActs,
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
      pendingSyncCollections,
      syncErrorLogs,
      retrySyncError,
      retryAllSyncErrors,
      checkServerConnection,
      resolveSyncError,
      clearResolvedSyncErrors,
      clearAllSyncErrors,
      ensureCsvPatientSynced,
      fetchClinicalNotesForExport,
      favoritePatientIds,
      toggleFavoritePatient,
      sendAppointmentReminder,
      sendAppointmentSmsReminder,
      dispatchRecallNotification,
      runDueSmsReminders,
      activityLogs,
      logActivity,
      clearActivityLogs,
      printableDoc,
      setPrintableDoc,
      toastMessage,
      showToast,
      signInWithCredentials,
      sendPasswordReset,
      createStaffAccount,
      setOwnPassword,
      signInWithGoogle,
      signInWithGoogleRedirect,
      refreshAuthAccess,
      logout,
      saveRecord,
      removeRecord,
      incrementCounter,
    }),
    [
      user,
      authLoading,
      authError,
      clearAuthError,
      staffProfile,
      accessPending,
      actualRole,
      activeRole,
      permissions,
      activeSection,
      setActiveSection,
      selectedPatientId,
      selectPatientWithLog,
      openPatientFile,
      agendaFocus,
      openAgendaAt,
      clearAgendaFocus,
      clinicSettings,
      staffList,
      patients,
      clinicalActs,
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
      pendingSyncCollections,
      syncErrorLogs,
      retrySyncError,
      retryAllSyncErrors,
      checkServerConnection,
      resolveSyncError,
      clearResolvedSyncErrors,
      clearAllSyncErrors,
      ensureCsvPatientSynced,
      fetchClinicalNotesForExport,
      favoritePatientIds,
      toggleFavoritePatient,
      sendAppointmentReminder,
      sendAppointmentSmsReminder,
      dispatchRecallNotification,
      runDueSmsReminders,
      activityLogs,
      logActivity,
      clearActivityLogs,
      printableDoc,
      setPrintableDoc,
      toastMessage,
      showToast,
      signInWithCredentials,
      sendPasswordReset,
      createStaffAccount,
      setOwnPassword,
      signInWithGoogle,
      signInWithGoogleRedirect,
      refreshAuthAccess,
      logout,
      saveRecord,
      removeRecord,
      incrementCounter,
    ]
  );

  return (
    <ClinicContext.Provider value={contextValue}>
      {children}
    </ClinicContext.Provider>
  );
};

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic must be used within ClinicProvider');
  return ctx;
}
