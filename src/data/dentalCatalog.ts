import {
  collection,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { addDaysISO, todayISO } from '../lib/formatters';
import { DEFAULT_SMS_REMINDER_SETTINGS } from '../lib/smsReminders';
import { ActCategory, AdminDocumentCategory, PrescriptionLine } from '../types/dental';

export interface SeedCatalogItem {
  id: string;
  code: string;
  category: ActCategory;
  name: string;
  defaultDuration: number;
  minPrice: number;
  maxPrice: number;
  defaultPrice: number;
  color: string;
}

export const DEFAULT_ACTS_CATALOG: SeedCatalogItem[] = [
  { id: 'act_cons_01', code: 'C01', category: 'Consultations', name: 'Consultation & Bilan complet', defaultDuration: 30, minPrice: 200, maxPrice: 400, defaultPrice: 300, color: '#0284C7' },
  { id: 'act_cons_02', code: 'C02', category: 'Consultations', name: 'Consultation d\'urgence & Soulagement', defaultDuration: 30, minPrice: 250, maxPrice: 450, defaultPrice: 350, color: '#DC2626' },
  { id: 'act_paro_01', code: 'PAR01', category: 'Parodontologie', name: 'Détartrage complet & Polissage', defaultDuration: 30, minPrice: 350, maxPrice: 600, defaultPrice: 450, color: '#0D9488' },
  { id: 'act_sc_01', code: 'SC01', category: 'Soins conservateurs', name: 'Obturation composite 1 face', defaultDuration: 30, minPrice: 350, maxPrice: 600, defaultPrice: 450, color: '#2563EB' },
  { id: 'act_sc_02', code: 'SC02', category: 'Soins conservateurs', name: 'Obturation composite 2-3 faces', defaultDuration: 45, minPrice: 500, maxPrice: 850, defaultPrice: 650, color: '#2563EB' },
  { id: 'act_endo_01', code: 'END01', category: 'Endodontie', name: 'Traitement endodontique monoradiculaire', defaultDuration: 45, minPrice: 600, maxPrice: 1000, defaultPrice: 800, color: '#D97706' },
  { id: 'act_endo_02', code: 'END02', category: 'Endodontie', name: 'Traitement endodontique molaire', defaultDuration: 60, minPrice: 1100, maxPrice: 1800, defaultPrice: 1400, color: '#D97706' },
  { id: 'act_chir_01', code: 'CH01', category: 'Chirurgie', name: 'Extraction dentaire simple', defaultDuration: 30, minPrice: 300, maxPrice: 600, defaultPrice: 400, color: '#E11D48' },
  { id: 'act_chir_02', code: 'CH02', category: 'Chirurgie', name: 'Extraction dent de sagesse incluse', defaultDuration: 60, minPrice: 1200, maxPrice: 2500, defaultPrice: 1600, color: '#E11D48' },
  { id: 'act_imp_01', code: 'IMP01', category: 'Implantologie', name: 'Pose d\'implant titane grade 5', defaultDuration: 60, minPrice: 6000, maxPrice: 9500, defaultPrice: 7500, color: '#16A34A' },
  { id: 'act_pf_01', code: 'PF01', category: 'Prothèse fixe', name: 'Couronne céramo-métallique', defaultDuration: 45, minPrice: 2000, maxPrice: 3200, defaultPrice: 2500, color: '#4F46E5' },
  { id: 'act_pf_02', code: 'PF02', category: 'Prothèse fixe', name: 'Couronne Zircone esthétique', defaultDuration: 45, minPrice: 3200, maxPrice: 4800, defaultPrice: 3800, color: '#4F46E5' },
  { id: 'act_pa_01', code: 'PA01', category: 'Prothèse amovible', name: 'Prothèse squelettée Stellite', defaultDuration: 45, minPrice: 3500, maxPrice: 6000, defaultPrice: 4500, color: '#7C3AED' },
  { id: 'act_odf_01', code: 'ODF01', category: 'ODF', name: 'Contrôle & Activation orthodontique', defaultDuration: 30, minPrice: 400, maxPrice: 800, defaultPrice: 500, color: '#0284C7' },
];

export const STOMATOLOGY_MOLECULES: Array<{ category: string; items: PrescriptionLine[] }> = [
  {
    category: 'Antibiotiques',
    items: [
      { molecule: 'Amoxicilline 1g (cp)', dosage: '1 comprimé', frequency: 'Matin et soir (2x/j)', duration: '6 jours', notes: 'Au milieu des repas' },
      { molecule: 'Amoxicilline / Acide Clavulanique 1g', dosage: '1 sachet ou cp', frequency: 'Matin et soir (2x/j)', duration: '7 jours', notes: 'En début de repas' },
      { molecule: 'Spiramycine 1,5 MUI + Métronidazole 250mg (Rodogyl)', dosage: '2 comprimés', frequency: 'Matin et soir', duration: '6 jours', notes: 'Éviter l\'alcool' },
    ],
  },
  {
    category: 'Antalgiques & AINS',
    items: [
      { molecule: 'Paracétamol 1000mg', dosage: '1 comprimé', frequency: 'Toutes les 6h si douleur (max 3g/j)', duration: '5 jours', notes: '' },
      { molecule: 'Ibuprofène 400mg', dosage: '1 comprimé', frequency: 'Matin, midi et soir', duration: '4 jours', notes: 'Pendant les repas' },
      { molecule: 'Kétoprofène 100mg LP', dosage: '1 comprimé', frequency: 'Matin et soir', duration: '4 jours', notes: 'Contre-indiqué si ulcère' },
    ],
  },
  {
    category: 'Corticoïdes & Antiseptiques',
    items: [
      { molecule: 'Prednisolone 20mg (Solupred)', dosage: '2 comprimés', frequency: 'Le matin au petit-déjeuner', duration: '3 jours', notes: 'Anti-œdémateux post-chirurgical' },
      { molecule: 'Chlorhexidine 0,12% (Bain de bouche)', dosage: '15 ml pur', frequency: '2 fois par jour après brossage', duration: '7 jours', notes: 'Ne pas rincer à l\'eau pendant 30 min' },
    ],
  },
];

export const DOCUMENT_TEMPLATES: Record<string, { title: string; body: string }> = {
  'Certificat de présence': {
    title: 'Certificat de Présence au Cabinet Dentaire',
    body: 'Je soussigné(e), Docteur en Chirurgie Dentaire, certifie que le/la patient(e) nommé(e) ci-dessus s\'est présenté(e) à notre cabinet ce jour pour des soins dentaires programmés.\n\nCertificat délivré à l\'intéressé(e) pour servir et valoir ce que de droit.',
  },
  'Dispense': {
    title: 'Certificat Médical de Dispense / Repos',
    body: 'Je soussigné(e), Docteur en Chirurgie Dentaire, certifie après examen clinique que l\'état bucco-dentaire du/de la patient(e) nécessite un repos professionnel / scolaire de 48 heures à compter de ce jour.',
  },
  'Attestation de soins': {
    title: 'Attestation de Soins Dentaires',
    body: 'Je soussigné(e), Docteur en Chirurgie Dentaire, atteste que le/la patient(e) suit régulièrement des soins dentaires conservateurs et prothétiques au sein de notre cabinet.',
  },
  'Consentement éclairé': {
    title: 'Consentement Éclairé — Acte Chirurgical / Implantologie',
    body: 'Je reconnais avoir reçu du praticien une information claire et complète concernant la nature de l\'intervention proposée, les alternatives thérapeutiques, les suites opératoires prévisibles ainsi que les risques éventuels. J\'accepte la réalisation du plan de soins présenté.',
  },
  'Lettre confrère': {
    title: 'Courrier d\'Adressage à un Confrère Spécialiste',
    body: 'Cher(ère) Confrère,\n\nJe vous adresse ce(tte) patient(e) pour avis spécialisé et prise en charge complémentaire concernant le secteur dentaire concerné. Vous trouverez ci-joint les éléments cliniques et radiographiques.\n\nConfraternellement,',
  },
  'Feuille de soins': {
    title: 'Feuille de Soins Dentaire — Prise en Charge Mutuelle (AMO / CNSS / CNOPS)',
    body: 'Dossier de remboursement pré-rempli comprenant l\'identification de l\'assuré(e), la nature des actes codifiés et le détail des honoraires acquittés.',
  },
};

export function buildAdminDocumentsSeed(
  today = todayISO()
): Array<{
  id: string;
  title: string;
  category: AdminDocumentCategory;
  provider: string;
  reference: string;
  expiryDate: string;
  alertDaysBefore: number;
  status: 'Actif' | 'À renouveler' | 'Renouvelé';
  notes: string;
}> {
  return [
    {
      id: 'adm_01',
      title: 'Licence logiciel imagerie CBCT & Panoramique',
      category: 'Licence logicielle',
      provider: 'Carestream Dental Maroc',
      reference: 'LIC-CS-2026-884',
      expiryDate: addDaysISO(today, 9),
      alertDaysBefore: 45,
      status: 'À renouveler',
      notes: 'Renouvellement annuel poste radio panoramique 3D',
    },
    {
      id: 'adm_02',
      title: 'Contrat entretien Fauteuils 1, 2 & 3 + Compresseur',
      category: "Contrat d'entretien",
      provider: 'Maghreb Dental Tech',
      reference: 'CTR-MNT-4102',
      expiryDate: addDaysISO(today, 22),
      alertDaysBefore: 45,
      status: 'À renouveler',
      notes: 'Visite préventive semestrielle et calibrage aspiration',
    },
    {
      id: 'adm_03',
      title: 'Maintenance & Qualification Autoclave Classe B',
      category: "Contrat d'entretien",
      provider: 'StériMed Casablanca',
      reference: 'CTR-STERI-119',
      expiryDate: addDaysISO(today, -4),
      alertDaysBefore: 30,
      status: 'À renouveler',
      notes: 'Contrôle annuel obligatoire chaîne de stérilisation',
    },
    {
      id: 'adm_04',
      title: 'Licence gestion cabinet & sauvegarde cloud sécurisée',
      category: 'Licence logicielle',
      provider: 'DentaCloud Pro',
      reference: 'LIC-DC-2026-019',
      expiryDate: addDaysISO(today, 48),
      alertDaysBefore: 60,
      status: 'Actif',
      notes: 'Abonnement annuel multi-postes (3 fauteuils)',
    },
    {
      id: 'adm_05',
      title: 'Assurance Responsabilité Civile Professionnelle (RCP)',
      category: 'Assurance & Conformité',
      provider: 'Wafa Assurance',
      reference: 'POL-RCP-90341',
      expiryDate: addDaysISO(today, 165),
      alertDaysBefore: 45,
      status: 'Actif',
      notes: 'Couverture cabinet Dr. Sara Bchi & praticiens collaborateurs',
    },
  ];
}

export async function seedDefaultAdminDocumentsIfEmpty(currentUid: string): Promise<void> {
  try {
    const existingSnap = await getDocs(query(collection(db, 'adminDocuments'), limit(1)));
    if (!existingSnap.empty) return;
    const batch = writeBatch(db);
    for (const item of buildAdminDocumentsSeed()) {
      const { id: docId, ...docData } = item;
      batch.set(doc(db, 'adminDocuments', docId), {
        ...docData,
        createdBy: currentUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    console.warn('Initialisation automatique des documents administratifs ignorée:', error);
  }
}

async function commitDeleteRefsInChunks(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const chunk = refs.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const ref of chunk) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

export async function resetClinicDataToZero(currentUid: string, _currentName: string): Promise<void> {
  try {
    // 1. Delete patient subcollections (imaging & clinicalNotes) first
    const patientsSnap = await getDocs(collection(db, 'patients'));
    const subDocRefs: DocumentReference[] = [];
    for (const patDoc of patientsSnap.docs) {
      const [imgSnap, notesSnap] = await Promise.all([
        getDocs(collection(db, 'patients', patDoc.id, 'imaging')),
        getDocs(collection(db, 'patients', patDoc.id, 'clinicalNotes')),
      ]);
      imgSnap.docs.forEach((d) => subDocRefs.push(d.ref));
      notesSnap.docs.forEach((d) => subDocRefs.push(d.ref));
    }
    if (subDocRefs.length > 0) {
      await commitDeleteRefsInChunks(subDocRefs);
    }

    // 2. Unlock any locked cashClosures so Titulaire can delete them cleanly
    const closuresSnap = await getDocs(collection(db, 'cashClosures'));
    for (const closureDoc of closuresSnap.docs) {
      if (closureDoc.data()?.locked === true) {
        await updateDoc(closureDoc.ref, { locked: false });
      }
    }

    // 3. Delete all operational collections
    const collectionsToClear = [
      'patients',
      'appointments',
      'bookingRequests',
      'treatmentPlans',
      'invoices',
      'payments',
      'labOrders',
      'medicalDocuments',
      'recalls',
      'expenses',
      'cashClosures',
      'inventory',
      'stockMovements',
      'adminDocuments',
      'staffInvites',
    ];

    const snaps = await Promise.all(collectionsToClear.map((name) => getDocs(collection(db, name))));
    const refsToDelete: DocumentReference[] = [];
    snaps.forEach((snap) => {
      snap.docs.forEach((d) => refsToDelete.push(d.ref));
    });

    // Remove demo collaborator staff docs if present (keep real staff accounts)
    const demoStaffIds = ['dr_collab_bennani', 'dr_collab_tazi'];
    for (const demoId of demoStaffIds) {
      if (demoId !== currentUid) {
        const demoRef = doc(db, 'staff', demoId);
        const demoSnap = await getDoc(demoRef);
        if (demoSnap.exists()) {
          refsToDelete.push(demoRef);
        }
      }
    }

    if (refsToDelete.length > 0) {
      await commitDeleteRefsInChunks(refsToDelete);
    }

    // 4. Ensure acts catalog is ready for immediate clinical testing
    const existingCatalog = await getDocs(query(collection(db, 'actsCatalog'), limit(1)));
    if (existingCatalog.empty) {
      const catBatch = writeBatch(db);
      for (const act of DEFAULT_ACTS_CATALOG) {
        catBatch.set(doc(db, 'actsCatalog', act.id), {
          code: act.code,
          category: act.category,
          name: act.name,
          defaultDuration: act.defaultDuration,
          minPrice: act.minPrice,
          maxPrice: act.maxPrice,
          defaultPrice: act.defaultPrice,
          color: act.color,
          createdAt: serverTimestamp(),
        });
      }
      await catBatch.commit();
    }

    // 5. Reset clinic sequential counters to 0 and mark betaZeroInitialized
    const settingsRef = doc(db, 'settings', 'clinic');
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      await updateDoc(settingsRef, {
        invoiceCounter: 0,
        quoteCounter: 0,
        receiptCounter: 0,
        betaZeroInitialized: true,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(settingsRef, {
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'resetClinicDataToZero');
  }
}

export async function seedClinicDemoData(currentUid: string, currentName: string): Promise<void> {
  const today = todayISO();
  const batch1 = writeBatch(db);
  const batch2 = writeBatch(db);
  const batch3 = writeBatch(db);
  const batch4 = writeBatch(db);

  try {
    const [settingsSnap, patSnap, aptSnap, paySnap, admSnap] = await Promise.all([
      getDoc(doc(db, 'settings', 'clinic')),
      getDoc(doc(db, 'patients', 'pat_001')),
      getDoc(doc(db, 'appointments', 'apt_001')),
      getDoc(doc(db, 'payments', 'pay_213')),
      getDoc(doc(db, 'adminDocuments', 'adm_01')),
    ]);

    const needBatch1Core = !settingsSnap.exists() || !patSnap.exists();

    // 1. Clinic settings
    if (!settingsSnap.exists()) {
      batch1.set(doc(db, 'settings', 'clinic'), {
        clinicName: 'Cabinet Dentaire Dr. Sara Bchi',
        subtitle: 'Chirurgien - Dentiste',
        address: '42 Boulevard d\'Anfa, Résidence Les Jasmins, Casablanca 20000',
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
        invoiceCounter: 105,
        quoteCounter: 48,
        receiptCounter: 214,
        betaZeroInitialized: true,
        updatedAt: serverTimestamp(),
      });
    }

    if (!patSnap.exists()) {
      // 2. Demo team practitioners (visible in multi-chair schedule)
      batch1.set(doc(db, 'staff', 'dr_collab_bennani'), {
        uid: 'dr_collab_bennani',
        email: 'dr.bennani@cabinet-dr-bchi.ma',
        displayName: 'Dr. Youssef Bennani',
        role: 'collaborateur',
        specialty: 'Implantologie & Chirurgie',
        chairName: 'Fauteuil 2',
        color: '#0D9488',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch1.set(doc(db, 'staff', 'dr_collab_tazi'), {
        uid: 'dr_collab_tazi',
        email: 'dr.tazi@cabinet-dr-bchi.ma',
        displayName: 'Dr. Salma Tazi',
        role: 'collaborateur',
        specialty: 'Orthodontie (ODF)',
        chairName: 'Fauteuil 3',
        color: '#7C3AED',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 3. Acts catalog
      for (const act of DEFAULT_ACTS_CATALOG) {
        batch1.set(doc(db, 'actsCatalog', act.id), {
          code: act.code,
          category: act.category,
          name: act.name,
          defaultDuration: act.defaultDuration,
          minPrice: act.minPrice,
          maxPrice: act.maxPrice,
          defaultPrice: act.defaultPrice,
          color: act.color,
          createdAt: serverTimestamp(),
        });
      }
    }

    // 4. Patients (Moroccan context, CIN, AMO/CNSS/CNOPS, Critical alerts, Odontogram)
    const patientsSeed = [
      {
        id: 'pat_001',
        fileNumber: 'DOS-2026-001',
        firstName: 'Kenza',
        lastName: 'El Fassi',
        birthDate: '1988-04-12',
        cin: 'BK482910',
        profession: 'Architecte',
        phone: '+212 661 42 18 90',
        email: 'kenza.elfassi@gmail.com',
        address: 'Maarif, Casablanca',
        referringDoctor: 'Dr. Benjelloun (Généraliste)',
        insuranceType: 'CNOPS',
        insuranceNumber: 'CNOPS-9482011',
        coverageRate: 80,
        hasCriticalAlert: true,
        alertSummary: 'Allergie sévère à la Pénicilline · Diabète type 2 équilibré',
        anamnesis: {
          cardiovascular: false,
          diabetes: true,
          drugAllergies: 'Pénicilline / Amoxicilline',
          hemophilia: false,
          chronicConditions: 'Diabète type 2 (Metformine)',
          pregnancy: false,
          notes: 'Préférer spiramycine ou clindamycine si antibiothérapie requise.',
        },
        dentitionMode: 'adulte',
        odontogram: {
          '16': { status: 'couronne', faces: { O: 'couronne' }, note: 'Couronne zircone prévue' },
          '36': { status: 'carie', faces: { O: 'carie', M: 'carie' }, note: 'Carie dentinaire profonde' },
          '46': { status: 'devitalisee', faces: { O: 'composite' }, note: 'Endo réalisée 2024' },
        },
      },
      {
        id: 'pat_002',
        fileNumber: 'DOS-2026-002',
        firstName: 'Mehdi',
        lastName: 'Chraibi',
        birthDate: '1979-11-03',
        cin: 'BE771204',
        profession: 'Ingénieur informatique',
        phone: '+212 663 11 54 22',
        email: 'mehdi.chraibi@outlook.com',
        address: 'Gauthier, Casablanca',
        referringDoctor: '',
        insuranceType: 'CNSS',
        insuranceNumber: 'CNSS-118492034',
        coverageRate: 70,
        hasCriticalAlert: false,
        alertSummary: '',
        anamnesis: {
          cardiovascular: false,
          diabetes: false,
          drugAllergies: '',
          hemophilia: false,
          chronicConditions: '',
          pregnancy: false,
          notes: 'RAS',
        },
        dentitionMode: 'adulte',
        odontogram: {
          '26': { status: 'implant', faces: {}, note: 'Implant Straumann posé' },
          '11': { status: 'composite', faces: { M: 'composite' }, note: 'Composite esthétique bord incisif' },
        },
      },
      {
        id: 'pat_003',
        fileNumber: 'DOS-2026-003',
        firstName: 'Nadia',
        lastName: 'Berrada',
        birthDate: '1965-07-21',
        cin: 'BJ310945',
        profession: 'Professeure',
        phone: '+212 670 88 12 45',
        email: 'n.berrada@yahoo.fr',
        address: 'Bourgogne, Casablanca',
        referringDoctor: 'Dr. Mansouri (Cardiologue)',
        insuranceType: 'AMO',
        insuranceNumber: 'AMO-55201948',
        coverageRate: 70,
        hasCriticalAlert: true,
        alertSummary: 'Anticoagulant (Sintrom) · HTA traitée',
        anamnesis: {
          cardiovascular: true,
          diabetes: false,
          drugAllergies: '',
          hemophilia: false,
          chronicConditions: 'Hypertension artérielle sous AVK',
          pregnancy: false,
          notes: 'Vérifier INR < 2.5 avant tout geste chirurgical.',
        },
        dentitionMode: 'adulte',
        odontogram: {
          '47': { status: 'manquante', faces: {}, note: 'Extraite en 2022' },
          '37': { status: 'carie', faces: { O: 'carie' }, note: 'À traiter' },
        },
      },
      {
        id: 'pat_004',
        fileNumber: 'DOS-2026-004',
        firstName: 'Adam',
        lastName: 'Kettani',
        birthDate: '2014-02-18',
        cin: 'Mineur (Tuteur: BK119203)',
        profession: 'Élève',
        phone: '+212 661 95 30 14',
        email: 'parent.kettani@gmail.com',
        address: 'Anfa, Casablanca',
        referringDoctor: '',
        insuranceType: 'Mutuelle Privée',
        insuranceNumber: 'AXA-MAR-88412',
        coverageRate: 85,
        hasCriticalAlert: false,
        alertSummary: '',
        anamnesis: {
          cardiovascular: false,
          diabetes: false,
          drugAllergies: '',
          hemophilia: false,
          chronicConditions: '',
          pregnancy: false,
          notes: 'Suivi orthodontie interceptive',
        },
        dentitionMode: 'mixte',
        odontogram: {
          '55': { status: 'carie', faces: { O: 'carie' }, note: 'Soin conservateur' },
          '16': { status: 'sain', faces: {}, note: 'Scellement de sillons prévu' },
        },
      },
      {
        id: 'pat_005',
        fileNumber: 'DOS-2026-005',
        firstName: 'Yasmine',
        lastName: 'Alaoui',
        birthDate: '1993-09-08',
        cin: 'D884120',
        profession: 'Pharmacienne',
        phone: '+212 662 34 71 09',
        email: 'yasmine.alaoui@gmail.com',
        address: 'Racine, Casablanca',
        referringDoctor: '',
        insuranceType: 'CNOPS',
        insuranceNumber: 'CNOPS-3381920',
        coverageRate: 80,
        hasCriticalAlert: false,
        alertSummary: '',
        anamnesis: {
          cardiovascular: false,
          diabetes: false,
          drugAllergies: '',
          hemophilia: false,
          chronicConditions: '',
          pregnancy: false,
          notes: '',
        },
        dentitionMode: 'adulte',
        odontogram: {
          '21': { status: 'inlay_onlay', faces: { V: 'inlay_onlay' }, note: 'Facette E-max' },
        },
      },
    ];

    if (!patSnap.exists()) {
      for (const p of patientsSeed) {
        const { id: patId, ...patData } = p;
        batch1.set(doc(db, 'patients', patId), {
          ...patData,
          assignedPractitionerId: currentUid,
          active: true,
          createdBy: currentUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    // 5. Appointments (today + next 7 days across multiple chairs & practitioners)
    const appointmentsSeed = [
      {
        id: 'apt_001',
        patientId: 'pat_001',
        patientName: 'Kenza El Fassi',
        patientPhone: '+212 661 42 18 90',
        practitionerId: currentUid,
        practitionerName: currentName,
        chair: 'Fauteuil 1',
        date: today,
        startTime: '09:00',
        durationMinutes: 45,
        actType: 'Couronne Zircone esthétique',
        categoryColor: '#4F46E5',
        status: 'Au fauteuil',
        arrivedAt: new Date(Date.now() - 18 * 60000).toISOString(),
        notes: 'Essayage chape zircone dent 16. Rappel allergie pénicilline.',
        isUrgent: false,
        reminderStatus: 'Délivré',
      },
      {
        id: 'apt_002',
        patientId: 'pat_002',
        patientName: 'Mehdi Chraibi',
        patientPhone: '+212 663 11 54 22',
        practitionerId: 'dr_collab_bennani',
        practitionerName: 'Dr. Youssef Bennani',
        chair: 'Fauteuil 2',
        date: today,
        startTime: '10:00',
        durationMinutes: 60,
        actType: 'Pose d\'implant titane grade 5',
        categoryColor: '#16A34A',
        status: "Arrivé en salle d'attente",
        arrivedAt: new Date(Date.now() - 9 * 60000).toISOString(),
        notes: 'Contrôle scanner CBCT préalable OK.',
        isUrgent: false,
        reminderStatus: 'Lu',
      },
      {
        id: 'apt_003',
        patientId: 'pat_003',
        patientName: 'Nadia Berrada',
        patientPhone: '+212 670 88 12 45',
        practitionerId: currentUid,
        practitionerName: currentName,
        chair: 'Fauteuil 1',
        date: today,
        startTime: '11:30',
        durationMinutes: 30,
        actType: 'Obturation composite 2-3 faces',
        categoryColor: '#2563EB',
        status: 'Confirmé',
        arrivedAt: '',
        notes: 'Soin dent 37 sans anesthésie adrénalinée.',
        isUrgent: false,
        reminderStatus: 'Délivré',
      },
      {
        id: 'apt_004',
        patientId: 'pat_004',
        patientName: 'Adam Kettani',
        patientPhone: '+212 661 95 30 14',
        practitionerId: 'dr_collab_tazi',
        practitionerName: 'Dr. Salma Tazi',
        chair: 'Fauteuil 3',
        date: today,
        startTime: '15:00',
        durationMinutes: 30,
        actType: 'Contrôle & Activation orthodontique',
        categoryColor: '#0284C7',
        status: 'En attente',
        arrivedAt: '',
        notes: 'Changement arc supérieur.',
        isUrgent: false,
        reminderStatus: 'Non envoyé',
      },
      {
        id: 'apt_005',
        patientId: 'pat_005',
        patientName: 'Yasmine Alaoui',
        patientPhone: '+212 662 34 71 09',
        practitionerId: currentUid,
        practitionerName: currentName,
        chair: 'Fauteuil 1',
        date: addDaysISO(today, 2),
        startTime: '09:30',
        durationMinutes: 30,
        actType: 'Détartrage complet & Polissage',
        categoryColor: '#0D9488',
        status: 'Confirmé',
        arrivedAt: '',
        notes: 'Contrôle annuel.',
        isUrgent: false,
        reminderStatus: 'Délivré',
      },
      {
        id: 'apt_006',
        patientId: 'pat_001',
        patientName: 'Kenza El Fassi',
        patientPhone: '+212 661 42 18 90',
        practitionerId: currentUid,
        practitionerName: currentName,
        chair: 'Fauteuil 1',
        date: addDaysISO(today, 4),
        startTime: '16:00',
        durationMinutes: 45,
        actType: 'Traitement endodontique molaire',
        categoryColor: '#D97706',
        status: 'Confirmé',
        arrivedAt: '',
        notes: 'Phase 2 : dent 36.',
        isUrgent: false,
        reminderStatus: 'Non envoyé',
      },
      {
        id: 'apt_007',
        patientId: 'pat_005',
        patientName: 'Yasmine Alaoui',
        patientPhone: '+212 662 34 71 09',
        practitionerId: 'dr_collab_bennani',
        practitionerName: 'Dr. Youssef Bennani',
        chair: 'Fauteuil 3',
        date: today,
        startTime: '09:00',
        durationMinutes: 30,
        actType: 'Extraction dentaire simple',
        categoryColor: '#E11D48',
        status: 'Terminé',
        arrivedAt: new Date(Date.now() - 95 * 60000).toISOString(),
        notes: 'Extraction dent 28 sans complications.',
        isUrgent: false,
        reminderStatus: 'SMS 24h envoyé',
      },
      {
        id: 'apt_008',
        patientId: 'pat_004',
        patientName: 'Adam Kettani',
        patientPhone: '+212 661 95 30 14',
        practitionerId: 'dr_collab_tazi',
        practitionerName: 'Dr. Salma Tazi',
        chair: 'Fauteuil 2',
        date: today,
        startTime: '09:30',
        durationMinutes: 30,
        actType: 'Contrôle & Activation orthodontique',
        categoryColor: '#0284C7',
        status: 'Terminé',
        arrivedAt: new Date(Date.now() - 65 * 60000).toISOString(),
        notes: 'Contrôle mensuel multi-attaches.',
        isUrgent: false,
        reminderStatus: 'SMS 24h envoyé',
      },
    ];

    if (!aptSnap.exists()) {
      for (const apt of appointmentsSeed) {
        const { id: aptId, ...aptData } = apt;
        batch2.set(doc(db, 'appointments', aptId), {
          ...aptData,
          createdBy: currentUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    // 6. Booking request
    if (!patSnap.exists()) {
      batch1.set(doc(db, 'bookingRequests', 'req_001'), {
        patientName: 'Omar Benali',
        phone: '+212 664 10 29 38',
        preferredDate: addDaysISO(today, 1),
        preferredSlot: 'Matin (10:00 - 12:00)',
        reason: 'Douleur molaire droite et bilan détartrage',
        practitionerId: currentUid,
        status: 'En attente',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // 7. Treatment plan / Devis
    batch2.set(doc(db, 'treatmentPlans', 'plan_001'), {
      quoteNumber: 'DEV-2026-048',
      patientId: 'pat_001',
      patientName: 'Kenza El Fassi',
      practitionerId: currentUid,
      practitionerName: currentName,
      title: 'Réhabilitation globale secteur molaire & prothèse',
      isAlternative: false,
      status: 'En cours',
      items: [
        {
          id: 'item_1',
          phase: 'Phase 1 : Assainissement',
          tooth: '36',
          faces: 'OM',
          actCode: 'END02',
          actName: 'Traitement endodontique molaire',
          unitPrice: 1400,
          quantity: 1,
          discount: 0,
          status: 'Réalisé',
        },
        {
          id: 'item_2',
          phase: 'Phase 3 : Réhabilitation prothétique',
          tooth: '16',
          faces: 'Couronne',
          actCode: 'PF02',
          actName: 'Couronne Zircone esthétique',
          unitPrice: 3800,
          quantity: 1,
          discount: 0,
          status: 'En cours',
        },
      ],
      totalAmount: 5200,
      insuranceEstimated: 4160,
      consentSigned: true,
      lockedVersion: true,
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 8. Invoices & Payments
    batch2.set(doc(db, 'invoices', 'inv_104'), {
      invoiceNumber: 'FAC-2026-104',
      patientId: 'pat_001',
      patientName: 'Kenza El Fassi',
      practitionerId: currentUid,
      practitionerName: currentName,
      planId: 'plan_001',
      issueDate: today,
      dueDate: addDaysISO(today, 15),
      items: [
        { actCode: 'END02', actName: 'Traitement endodontique molaire (36)', tooth: '36', quantity: 1, unitPrice: 1400, total: 1400 },
        { actCode: 'PF02', actName: 'Acompte Couronne Zircone (16)', tooth: '16', quantity: 1, unitPrice: 3800, total: 3800 },
      ],
      totalAmount: 5200,
      insuranceType: 'CNOPS',
      insuranceShare: 3200,
      patientShare: 2000,
      paidAmount: 1500,
      insurancePaidAmount: 0,
      status: 'Partiellement payée',
      insuranceClaimStatus: 'Dossier déposé',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch2.set(doc(db, 'invoices', 'inv_105'), {
      invoiceNumber: 'FAC-2026-105',
      patientId: 'pat_002',
      patientName: 'Mehdi Chraibi',
      practitionerId: currentUid,
      practitionerName: currentName,
      planId: '',
      issueDate: addDaysISO(today, -12),
      dueDate: addDaysISO(today, -2),
      items: [
        { actCode: 'IMP01', actName: 'Pose d\'implant titane grade 5 (26)', tooth: '26', quantity: 1, unitPrice: 7500, total: 7500 },
      ],
      totalAmount: 7500,
      insuranceType: 'CNSS',
      insuranceShare: 2500,
      patientShare: 5000,
      paidAmount: 3000,
      insurancePaidAmount: 0,
      status: 'En retard',
      insuranceClaimStatus: 'En attente remboursement',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch3.set(doc(db, 'payments', 'pay_213'), {
      receiptNumber: 'REC-2026-213',
      invoiceId: 'inv_104',
      patientId: 'pat_001',
      patientName: 'Kenza El Fassi',
      practitionerId: currentUid,
      date: today,
      amount: 1500,
      method: 'Carte bancaire',
      payerType: 'Patient',
      isAdvance: true,
      notes: 'Acompte sur plan de traitement prothétique',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
    });

    batch3.set(doc(db, 'payments', 'pay_214'), {
      receiptNumber: 'REC-2026-214',
      invoiceId: 'inv_105',
      patientId: 'pat_002',
      patientName: 'Mehdi Chraibi',
      practitionerId: currentUid,
      date: today,
      amount: 3000,
      method: 'Espèces',
      payerType: 'Patient',
      isAdvance: false,
      notes: 'Premier versement implantologie',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
    });

    // 9. Lab orders
    batch2.set(doc(db, 'labOrders', 'lab_001'), {
      orderNumber: 'LAB-2026-019',
      patientId: 'pat_001',
      patientName: 'Kenza El Fassi',
      practitionerId: currentUid,
      practitionerName: currentName,
      labName: 'Laboratoire Atlas Prothèse',
      prosthesisType: 'Zircone',
      shadeVita: 'A2',
      teeth: '16',
      impressionType: 'Fichier numérique STL',
      sentDate: addDaysISO(today, -5),
      dueDate: addDaysISO(today, -1),
      nextAppointmentDate: today,
      status: 'Au labo',
      labCost: 950,
      supplierInvoiceRef: 'FRN-4021',
      supplierPaid: false,
      notes: 'Contrôler point de contact mésial avant glaçage.',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 10. Recalls
    batch2.set(doc(db, 'recalls', 'rec_001'), {
      patientId: 'pat_005',
      patientName: 'Yasmine Alaoui',
      patientPhone: '+212 662 34 71 09',
      practitionerId: currentUid,
      reason: 'Contrôle annuel & Détartrage',
      dueDate: addDaysISO(today, -8),
      channel: 'WhatsApp',
      status: 'En retard',
      deliveryStatus: 'Non envoyé',
      notes: '',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch2.set(doc(db, 'recalls', 'rec_002'), {
      patientId: 'pat_003',
      patientName: 'Nadia Berrada',
      patientPhone: '+212 670 88 12 45',
      practitionerId: currentUid,
      reason: 'Suivi parodontal 6 mois',
      dueDate: addDaysISO(today, -3),
      channel: 'SMS',
      status: 'En retard',
      deliveryStatus: 'Non envoyé',
      notes: '',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch2.set(doc(db, 'recalls', 'rec_003'), {
      patientId: 'pat_001',
      patientName: 'Kenza El Fassi',
      patientPhone: '+212 661 42 18 90',
      practitionerId: currentUid,
      reason: 'Rappel SMS 24h · RDV 09:00 (Couronne Zircone esthétique)',
      dueDate: today,
      channel: 'SMS',
      status: 'Envoyé',
      deliveryStatus: 'Délivré',
      lastSentAt: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
      notes: '[RDV:apt_001] Bonjour Kenza El Fassi, rappel de votre RDV au Cabinet Dentaire Dr. Sara Bchi aujourd\'hui à 09:00. Tél : +212 532 101 351',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch2.set(doc(db, 'recalls', 'rec_004'), {
      patientId: 'pat_003',
      patientName: 'Nadia Berrada',
      patientPhone: '+212 670 88 12 45',
      practitionerId: currentUid,
      reason: 'Rappel SMS 24h · RDV 11:30 (Obturation composite 2-3 faces)',
      dueDate: today,
      channel: 'SMS',
      status: 'Envoyé',
      deliveryStatus: 'Délivré',
      lastSentAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
      notes: '[RDV:apt_003] Bonjour Nadia Berrada, rappel de votre RDV au Cabinet Dentaire Dr. Sara Bchi aujourd\'hui à 11:30. Tél : +212 532 101 351',
      createdBy: currentUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 11. Expenses
    if (!patSnap.exists()) {
      batch1.set(doc(db, 'expenses', 'exp_001'), {
        date: today,
        category: 'Loyer',
        expenseType: 'Charge fixe',
        label: 'Loyer mensuel cabinet Anfa',
        supplier: 'SCI Les Jasmins',
        amount: 12000,
        paymentMethod: 'Virement',
        receiptRef: 'VIR-2026-11',
        createdBy: currentUid,
        createdAt: serverTimestamp(),
      });
      batch1.set(doc(db, 'expenses', 'exp_002'), {
        date: today,
        category: 'Fournitures',
        expenseType: 'Dépense variable',
        label: 'Commande consommables stérilisation & gants',
        supplier: 'Maghreb Dental Supply',
        amount: 1850,
        paymentMethod: 'Espèces',
        receiptRef: 'BL-9921',
        createdBy: currentUid,
        createdAt: serverTimestamp(),
      });

      // 12. Inventory
      const inventorySeed = [
        { id: 'inv_item_01', sku: 'CONS-001', name: 'Gants nitrile sans poudre (Boîte 100)', category: 'Consommables', unit: 'Boîtes', quantity: 4, minThreshold: 10, unitCost: 75, supplier: 'Maghreb Dental Supply', expiryDate: '2028-06-01' },
        { id: 'inv_item_02', sku: 'DES-014', name: 'Solution désinfectante instruments 5L', category: 'Désinfection', unit: 'Bidons', quantity: 6, minThreshold: 3, unitCost: 320, supplier: 'Hygiène Med Maroc', expiryDate: '2027-11-15' },
        { id: 'inv_item_03', sku: 'ANE-008', name: 'Articaïne 4% 1:100 000 (Boîte 50 carpules)', category: 'Anesthésie', unit: 'Boîtes', quantity: 3, minThreshold: 5, unitCost: 290, supplier: 'PharmaDent', expiryDate: '2027-04-30' },
        { id: 'inv_item_04', sku: 'RES-022', name: 'Composite nano-hybride A2 (Seringue 4g)', category: 'Résines & Composites', unit: 'Seringues', quantity: 12, minThreshold: 4, unitCost: 240, supplier: 'Maghreb Dental Supply', expiryDate: '2028-02-20' },
      ];
      for (const item of inventorySeed) {
        const { id: itemId, ...itemData } = item;
        batch1.set(doc(db, 'inventory', itemId), {
          ...itemData,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (!admSnap.exists()) {
      for (const item of buildAdminDocumentsSeed(today)) {
        const { id: docId, ...docData } = item;
        batch4.set(doc(db, 'adminDocuments', docId), {
          ...docData,
          createdBy: currentUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (needBatch1Core) {
      await batch1.commit();
    }
    if (!aptSnap.exists()) {
      await batch2.commit();
    }
    if (!paySnap.exists()) {
      await batch3.commit();
    }
    if (!admSnap.exists()) {
      await batch4.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seedClinicDemoData');
  }
}
