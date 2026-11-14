export type StaffRole = 'titulaire' | 'collaborateur' | 'secretaire' | 'assistant';

export const ROLE_LABELS: Record<StaffRole, string> = {
  titulaire: 'Praticien Titulaire',
  collaborateur: 'Praticien Collaborateur',
  secretaire: 'Secrétaire / Accueil',
  assistant: 'Assistant(e) Dentaire',
};

export interface StaffMember {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  specialty?: string;
  chairName?: string;
  color?: string;
  active: boolean;
  inviteId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StaffInvite {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
  specialty?: string;
  chairName?: string;
  color?: string;
  createdBy: string;
  createdAt?: unknown;
}

export interface SmsReminderSettings {
  enabled: boolean;
  hoursBefore: number;
  template: string;
}

export interface ClinicSettings {
  id: string;
  clinicName: string;
  subtitle?: string;
  address?: string;
  phone?: string;
  email?: string;
  ice?: string;
  ifNumber?: string;
  patente?: string;
  inpe?: string;
  currency: string;
  chairs: string[];
  workingHours?: {
    start: string;
    end: string;
    lunchStart: string;
    lunchEnd: string;
    saturdayStart?: string;
    saturdayEnd?: string;
  };
  smsReminders?: SmsReminderSettings;
  invoiceCounter: number;
  quoteCounter: number;
  receiptCounter: number;
  betaZeroInitialized?: boolean;
  updatedAt?: unknown;
}

export type InsuranceType = 'Aucune' | 'AMO' | 'CNSS' | 'CNOPS' | 'Mutuelle Privée';
export type DentitionMode = 'adulte' | 'mixte' | 'temporaire';

export type ToothStatus =
  | 'sain'
  | 'carie'
  | 'composite'
  | 'amalgame'
  | 'devitalisee'
  | 'inlay_onlay'
  | 'couronne'
  | 'implant'
  | 'bridge'
  | 'resection_apicale'
  | 'manquante'
  | 'incluse';

export type ToothFace = 'M' | 'D' | 'O' | 'V' | 'L';

export interface ToothRecord {
  status: ToothStatus;
  faces: Partial<Record<ToothFace, ToothStatus>>;
  note?: string;
  updatedAt?: string;
}

export interface PatientAnamnesis {
  cardiovascular: boolean;
  diabetes: boolean;
  drugAllergies: string;
  hemophilia: boolean;
  chronicConditions: string;
  pregnancy: boolean;
  notes: string;
}

export interface Patient {
  id: string;
  fileNumber: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
  cin?: string;
  profession?: string;
  phone: string;
  email?: string;
  address?: string;
  referringDoctor?: string;
  insuranceType: InsuranceType;
  insuranceNumber?: string;
  coverageRate: number;
  anamnesis?: PatientAnamnesis;
  hasCriticalAlert: boolean;
  alertSummary?: string;
  assignedPractitionerId: string;
  dentitionMode: DentitionMode;
  odontogram: Record<string, ToothRecord>;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ImagingCategory =
  | 'Panoramique'
  | 'Rétro-alvéolaire'
  | 'Téléradiographie'
  | 'Photo Avant'
  | 'Photo Après'
  | 'Document';

export interface PatientImaging {
  id: string;
  patientId: string;
  title: string;
  category: ImagingCategory;
  toothRef?: string;
  date: string;
  dataUrl: string;
  notes?: string;
  uploadedBy: string;
  createdAt?: unknown;
}

export interface ClinicalNote {
  id: string;
  patientId: string;
  date: string;
  practitionerId: string;
  practitionerName: string;
  tooth?: string;
  faces?: string;
  actCode?: string;
  actName: string;
  materials?: string;
  report?: string;
  amount: number;
  billed: boolean;
  createdBy: string;
  createdAt?: unknown;
}

export type AppointmentStatus =
  | 'En attente'
  | 'Confirmé'
  | "Arrivé en salle d'attente"
  | 'Au fauteuil'
  | 'Terminé'
  | 'Absent'
  | 'Annulé';

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  practitionerId: string;
  practitionerName: string;
  chair: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  actType: string;
  categoryColor?: string;
  status: AppointmentStatus;
  arrivedAt?: string;
  notes?: string;
  isUrgent: boolean;
  reminderStatus?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BookingRequest {
  id: string;
  patientName: string;
  phone: string;
  preferredDate: string;
  preferredSlot?: string;
  reason: string;
  practitionerId?: string;
  status: 'En attente' | 'Validé' | 'Refusé';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ActCategory =
  | 'Consultations'
  | 'Soins conservateurs'
  | 'Endodontie'
  | 'Parodontologie'
  | 'Chirurgie'
  | 'Implantologie'
  | 'Prothèse fixe'
  | 'Prothèse amovible'
  | 'ODF';

export interface CatalogAct {
  id: string;
  code: string;
  category: ActCategory;
  name: string;
  defaultDuration: number;
  minPrice: number;
  maxPrice: number;
  defaultPrice: number;
  color?: string;
  createdAt?: unknown;
}

export type PlanItemStatus = 'Prévu' | 'En cours' | 'Réalisé' | 'Facturé' | 'Payé';

export interface TreatmentPlanItem {
  id: string;
  phase: 'Phase 1 : Assainissement' | 'Phase 2 : Soins chirurgicaux' | 'Phase 3 : Réhabilitation prothétique';
  tooth: string;
  faces?: string;
  actCode: string;
  actName: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  status: PlanItemStatus;
}

export interface TreatmentPlan {
  id: string;
  quoteNumber: string;
  patientId: string;
  patientName: string;
  practitionerId: string;
  practitionerName: string;
  title: string;
  isAlternative?: boolean;
  status: 'Brouillon' | 'Devis envoyé' | 'Accepté' | 'En cours' | 'Terminé' | 'Refusé';
  items: TreatmentPlanItem[];
  totalAmount: number;
  insuranceEstimated?: number;
  consentSigned: boolean;
  lockedVersion: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type InvoiceStatus = 'Émise' | 'Partiellement payée' | 'Payée' | 'En retard' | 'Annulée';
export type ClaimStatus = 'Aucune' | 'Dossier déposé' | 'En attente remboursement' | 'Remboursée';

export interface InvoiceItem {
  actCode: string;
  actName: string;
  tooth?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  practitionerId: string;
  practitionerName?: string;
  planId?: string;
  issueDate: string;
  dueDate?: string;
  items: InvoiceItem[];
  totalAmount: number;
  insuranceType?: string;
  insuranceShare: number;
  patientShare: number;
  paidAmount: number;
  insurancePaidAmount?: number;
  status: InvoiceStatus;
  insuranceClaimStatus?: ClaimStatus;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type PaymentMethod = 'Espèces' | 'Carte bancaire' | 'Virement' | 'Chèque';

export interface Payment {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  patientId: string;
  patientName: string;
  practitionerId: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  payerType: 'Patient' | 'Mutuelle';
  isAdvance: boolean;
  chequeNumber?: string;
  bankName?: string;
  chequeDepositDate?: string;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
}

export type LabOrderStatus =
  | 'Envoyé'
  | 'Au labo'
  | 'Reçu au cabinet'
  | 'En essayage'
  | 'Validé posé'
  | 'Retour pour correction';

export interface LabOrder {
  id: string;
  orderNumber: string;
  patientId: string;
  patientName: string;
  practitionerId: string;
  practitionerName?: string;
  labName: string;
  prosthesisType: 'Zircone' | 'Céramo-métallique' | 'E-max' | 'Squeletté' | 'Résine amovible' | 'Gouttière' | 'Sur implant';
  shadeVita?: string;
  teeth?: string;
  impressionType?: 'Empreinte physique' | 'Fichier numérique STL';
  sentDate?: string;
  dueDate?: string;
  nextAppointmentDate?: string;
  status: LabOrderStatus;
  labCost: number;
  supplierInvoiceRef?: string;
  supplierPaid: boolean;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MedicalDocType =
  | 'Ordonnance'
  | 'Certificat de présence'
  | 'Dispense'
  | 'Attestation de soins'
  | 'Consentement éclairé'
  | 'Lettre confrère'
  | 'Feuille de soins';

export interface PrescriptionLine {
  molecule: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes?: string;
}

export interface MedicalDocument {
  id: string;
  patientId: string;
  patientName: string;
  practitionerId: string;
  practitionerName?: string;
  docType: MedicalDocType;
  date: string;
  title: string;
  prescriptions?: PrescriptionLine[];
  bodyText?: string;
  createdBy: string;
  createdAt?: unknown;
}

export interface Recall {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  practitionerId?: string;
  reason: string;
  dueDate: string;
  channel: 'WhatsApp' | 'SMS' | 'Appel';
  status: 'À faire' | 'En retard' | 'Envoyé' | 'RDV pris';
  deliveryStatus: 'Non envoyé' | 'Délivré' | 'Lu' | 'Échec';
  lastSentAt?: string;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Expense {
  id: string;
  date: string;
  category: 'Loyer' | 'Salaires' | 'Maintenance' | 'Leasing' | 'Fournitures' | 'Laboratoire' | 'Réparations' | 'Électricité/Eau' | 'Autre';
  expenseType: 'Charge fixe' | 'Dépense variable';
  label: string;
  supplier?: string;
  amount: number;
  paymentMethod: 'Espèces' | 'Virement' | 'Carte bancaire' | 'Chèque';
  receiptRef?: string;
  createdBy: string;
  createdAt?: unknown;
}

export interface CashClosure {
  id: string;
  date: string;
  openingBalance: number;
  cashInflows: number;
  cashOutflows: number;
  expectedBalance: number;
  countedBalance: number;
  discrepancy: number;
  notes?: string;
  locked: boolean;
  closedByUid: string;
  closedByName: string;
  createdAt?: unknown;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: 'Consommables' | 'Désinfection' | 'Résines & Composites' | 'Ciments' | 'Anesthésie' | 'Implants & Chirurgie' | 'Autre';
  unit: string;
  quantity: number;
  minThreshold: number;
  unitCost: number;
  supplier?: string;
  expiryDate?: string;
  updatedAt?: unknown;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: 'Entrée' | 'Sortie';
  quantity: number;
  reason?: string;
  date: string;
  createdBy: string;
  createdAt?: unknown;
}

export type AdminDocumentCategory =
  | 'Licence logicielle'
  | "Contrat d'entretien"
  | 'Assurance & Conformité'
  | 'Autre';

export interface AdminDocument {
  id: string;
  title: string;
  category: AdminDocumentCategory;
  provider: string;
  reference?: string;
  expiryDate: string;
  alertDaysBefore: number;
  status: 'Actif' | 'À renouveler' | 'Renouvelé';
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AppSection =
  | 'dashboard'
  | 'appointments'
  | 'patients'
  | 'treatment-plans'
  | 'recalls'
  | 'invoices'
  | 'payments'
  | 'insurance'
  | 'lab-orders'
  | 'documents'
  | 'cash-expenses'
  | 'inventory'
  | 'staff'
  | 'reports'
  | 'settings';

export interface RolePermissions {
  canViewDashboard: boolean;
  canEditAppointments: boolean;
  canEditPatientsIdentity: boolean;
  canEditOdontogramAndNotes: boolean;
  canUploadImaging: boolean;
  canCreatePlansAndQuotes: boolean;
  canCreateInvoicesAndPayments: boolean;
  canViewFinancialTotals: boolean;
  canManageExpensesAndClosures: boolean;
  canManageLabOrders: boolean;
  canCreateMedicalDocs: boolean;
  canManageInventory: boolean;
  canManageStaffAndSettings: boolean;
}

export function getPermissionsForRole(role: StaffRole): RolePermissions {
  switch (role) {
    case 'titulaire':
      return {
        canViewDashboard: true,
        canEditAppointments: true,
        canEditPatientsIdentity: true,
        canEditOdontogramAndNotes: true,
        canUploadImaging: true,
        canCreatePlansAndQuotes: true,
        canCreateInvoicesAndPayments: true,
        canViewFinancialTotals: true,
        canManageExpensesAndClosures: true,
        canManageLabOrders: true,
        canCreateMedicalDocs: true,
        canManageInventory: true,
        canManageStaffAndSettings: true,
      };
    case 'collaborateur':
      return {
        canViewDashboard: true,
        canEditAppointments: true,
        canEditPatientsIdentity: true,
        canEditOdontogramAndNotes: true,
        canUploadImaging: true,
        canCreatePlansAndQuotes: true,
        canCreateInvoicesAndPayments: false,
        canViewFinancialTotals: true, // Ses honoraires uniquement
        canManageExpensesAndClosures: false,
        canManageLabOrders: true,
        canCreateMedicalDocs: true,
        canManageInventory: false,
        canManageStaffAndSettings: false,
      };
    case 'secretaire':
      return {
        canViewDashboard: true,
        canEditAppointments: true,
        canEditPatientsIdentity: true,
        canEditOdontogramAndNotes: false, // Lecture seule historique
        canUploadImaging: false,
        canCreatePlansAndQuotes: true,
        canCreateInvoicesAndPayments: true,
        canViewFinancialTotals: true,
        canManageExpensesAndClosures: false, // Encaissements & clôture du jour uniquement
        canManageLabOrders: false,
        canCreateMedicalDocs: false, // Impression uniquement
        canManageInventory: false,
        canManageStaffAndSettings: false,
      };
    case 'assistant':
      return {
        canViewDashboard: true,
        canEditAppointments: false, // Consultation planning
        canEditPatientsIdentity: false,
        canEditOdontogramAndNotes: true, // Saisie assistée au fauteuil
        canUploadImaging: true,
        canCreatePlansAndQuotes: false,
        canCreateInvoicesAndPayments: false,
        canViewFinancialTotals: false,
        canManageExpensesAndClosures: false,
        canManageLabOrders: true,
        canCreateMedicalDocs: false,
        canManageInventory: true,
        canManageStaffAndSettings: false,
      };
  }
}

export const FDI_UPPER_RIGHT = ['18', '17', '16', '15', '14', '13', '12', '11'];
export const FDI_UPPER_LEFT = ['21', '22', '23', '24', '25', '26', '27', '28'];
export const FDI_LOWER_LEFT = ['31', '32', '33', '34', '35', '36', '37', '38'];
export const FDI_LOWER_RIGHT = ['48', '47', '46', '45', '44', '43', '42', '41'];

export const FDI_TEMP_UPPER_RIGHT = ['55', '54', '53', '52', '51'];
export const FDI_TEMP_UPPER_LEFT = ['61', '62', '63', '64', '65'];
export const FDI_TEMP_LOWER_LEFT = ['71', '72', '73', '74', '75'];
export const FDI_TEMP_LOWER_RIGHT = ['85', '84', '83', '82', '81'];

export const TOOTH_STATUS_META: Record<ToothStatus, { label: string; color: string; short: string }> = {
  sain: { label: 'Saine', color: '#E2E8F0', short: 'OK' },
  carie: { label: 'Carie', color: '#DC2626', short: 'CAR' },
  composite: { label: 'Obturation Composite', color: '#0284C7', short: 'CMP' },
  amalgame: { label: 'Amalgame', color: '#64748B', short: 'AMG' },
  devitalisee: { label: 'Dévitalisée (Endo)', color: '#D97706', short: 'END' },
  inlay_onlay: { label: 'Inlay / Onlay', color: '#0D9488', short: 'INL' },
  couronne: { label: 'Couronne', color: '#4F46E5', short: 'CRN' },
  implant: { label: 'Implant', color: '#16A34A', short: 'IMP' },
  bridge: { label: 'Bridge', color: '#7C3AED', short: 'BRG' },
  resection_apicale: { label: 'Résection apicale', color: '#BE123C', short: 'RAP' },
  manquante: { label: 'Dent manquante', color: '#0F172A', short: 'ABS' },
  incluse: { label: 'Dent incluse', color: '#94A3B8', short: 'INC' },
};

export interface PrintableDocumentPayload {
  kind: 'quote' | 'invoice' | 'receipt' | 'prescription' | 'certificate' | 'care-sheet';
  title: string;
  subtitle?: string;
  reference?: string;
  date: string;
  patientName: string;
  patientCin?: string;
  patientPhone?: string;
  patientInsurance?: string;
  patientInsuranceNumber?: string;
  practitionerName: string;
  items?: Array<{ label: string; tooth?: string; qty: number; unitPrice: number; total: number }>;
  totalAmount?: number;
  insuranceShare?: number;
  patientShare?: number;
  paidAmount?: number;
  paymentMethod?: string;
  prescriptions?: PrescriptionLine[];
  bodyText?: string;
  consentText?: string;
}

export type ActivityCategory =
  | 'patient'
  | 'planning'
  | 'facturation'
  | 'clinique'
  | 'logistique'
  | 'administration';

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  title: string;
  detail: string;
  actorName: string;
  actorRole: StaffRole;
  section: AppSection;
  patientId?: string;
}

