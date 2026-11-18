import {
  Expense,
  Invoice,
  InvoiceItem,
  LabOrder,
  LabOrderStatus,
  MedicalDocument,
  Patient,
  PatientClinicalAct,
  Payment,
  PaymentMethod,
  PrescriptionLine,
  TreatmentPlan,
  TreatmentPlanItem,
} from '../types/dental';

export const CABINET_CSV_FILES = {
  patients: '/assets/cabinet/patients_26291487.csv',
  actes: '/assets/cabinet/actes_9df8c288.csv',
  devis: '/assets/cabinet/devis_c1bcb43c.csv',
  factures: '/assets/cabinet/factures_a0273cbb.csv',
  paiements: '/assets/cabinet/paiements_31a24333.csv',
  charges: '/assets/cabinet/charges_d8557354.csv',
  certificats: '/assets/cabinet/certificats_medicaux_b4e5cfc0.csv',
  feuillesDeSoins: '/assets/cabinet/feuilles_de_soins_6651eb2f.csv',
  notesHonoraires: '/assets/cabinet/note_dhonoraires_a9a47ee9.csv',
  ordonnances: '/assets/cabinet/ordonnances_e0e6f887.csv',
  protheses: '/assets/cabinet/protheses_5a69e534.csv',
} as const;

export interface RawCabinetCsvTexts {
  patients: string;
  actes: string;
  devis: string;
  factures: string;
  paiements: string;
  charges: string;
  certificats: string;
  feuillesDeSoins: string;
  notesHonoraires: string;
  ordonnances: string;
  protheses: string;
}

export interface CabinetCsvBundle {
  patients: Patient[];
  clinicalActs: PatientClinicalAct[];
  treatmentPlans: TreatmentPlan[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  medicalDocuments: MedicalDocument[];
  labOrders: LabOrder[];
}

export function parseCsvRfc4180(rawText: string): Record<string, string>[] {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (ch === '\r') {
      if (i + 1 < text.length && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else if (ch === '\n') {
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => !c.trim())) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      obj[key] = (row[c] ?? '').trim();
    }
    records.push(obj);
  }

  return records;
}

function sanitizeIdPart(val: string): string {
  const cleaned = val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'x';
}

export function parseFrDateToIso(raw: string | undefined): string {
  const value = (raw || '').trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  return value.slice(0, 20);
}

function parseNumber(raw: string | undefined, fallback = 0): number {
  const cleaned = (raw || '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  if (!cleaned) return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLookupName(name: string | undefined): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { firstName: 'Patient', lastName: 'Cabinet' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0].slice(0, 80), lastName: '—' };
  }
  const lastName = parts[0].slice(0, 80);
  const firstName = parts.slice(1).join(' ').slice(0, 80);
  return { firstName: firstName || '—', lastName: lastName || '—' };
}

function mapCsvPaymentMethod(raw: string): PaymentMethod {
  const v = (raw || '').trim().toLowerCase();
  if (v.includes('portefeuille')) return 'Solde Portefeuille';
  if (v.includes('virement')) return 'Virement';
  if (v.includes('chèque') || v.includes('cheque')) return 'Chèque';
  if (v.includes('carte')) return 'Carte bancaire';
  return 'Espèces';
}

function mapCsvExpenseMethod(raw: string): Expense['paymentMethod'] {
  const v = (raw || '').trim().toLowerCase();
  if (v.includes('virement')) return 'Virement';
  if (v.includes('carte')) return 'Carte bancaire';
  if (v.includes('chèque') || v.includes('cheque')) return 'Chèque';
  return 'Espèces';
}

function mapCsvExpenseCategory(rawType: string): Expense['category'] {
  const v = (rawType || '').trim().toLowerCase();
  if (v.includes('loyer') && !v.includes('impôt') && !v.includes('impot')) return 'Loyer';
  if (v.includes('salaire')) return 'Salaires';
  if (v.includes('maintenance') || v.includes('entretien')) return 'Maintenance';
  if (v.includes('leasing')) return 'Leasing';
  if (v.includes('fourniture')) return 'Fournitures';
  if (v.includes('labo')) return 'Laboratoire';
  if (v.includes('réparation') || v.includes('reparation')) return 'Réparations';
  if (v.includes('électricité') || v.includes('electricite') || v.includes('eau')) return 'Électricité/Eau';
  return 'Autre';
}

function mapCsvQuoteStatus(raw: string): TreatmentPlan['status'] {
  const v = (raw || '').trim();
  if (v === 'Accepté' || v === 'Imprimé' || v === 'Noveaux' || v === 'Brouillon' || v === 'Devis envoyé' || v === 'En cours' || v === 'Terminé' || v === 'Refusé') {
    return v;
  }
  return 'Noveaux';
}

function mapCsvLabStatus(raw: string): LabOrderStatus {
  const v = (raw || '').trim().toLowerCase();
  if (v.includes('pose') || v.includes('valid')) return 'Validé posé';
  if (v.includes('essayage')) return 'En essayage';
  if (v.includes('reçu') || v.includes('recu') || v.includes('retour')) return 'Reçu au cabinet';
  if (v.includes('correction')) return 'Retour pour correction';
  if (v.includes('labo')) return 'Au labo';
  return 'Envoyé';
}

export function buildCsvCollections(raw: RawCabinetCsvTexts, defaultUid = 'csv_cabinet'): CabinetCsvBundle {
  const safeUid = sanitizeIdPart(defaultUid || 'csv_cabinet');

  // 1. Patients (446)
  const patientRows = parseCsvRfc4180(raw.patients);
  const byFileNum = new Map<string, Patient>();
  const byNormName = new Map<string, Patient>();

  const patients: Patient[] = patientRows.map((row, idx) => {
    const num = (row['Num'] || '').trim() || String(idx + 1);
    const fullName = (row['Patient'] || '').trim() || `Patient ${num}`;
    const { firstName, lastName } = splitFullName(fullName);
    const id = `csv_pat_${sanitizeIdPart(num)}`;

    const patient: Patient = {
      id,
      fileNumber: num.slice(0, 40),
      firstName,
      lastName,
      fullName,
      gender: (row['Sexe'] || '').trim(),
      birthDate: parseFrDateToIso(row['Né le']),
      phone: (row['Téléphone'] || '').trim().slice(0, 30),
      referralSource: (row['Source de référence'] || '').trim(),
      insuranceType: 'Aucune',
      coverageRate: 0,
      hasCriticalAlert: false,
      assignedPractitionerId: safeUid,
      dentitionMode: 'adulte',
      odontogram: {},
      active: true,
      createdBy: safeUid,
      totalBilled: parseNumber(row['Total'], 0),
      remainingDue: parseNumber(row['Reste à payer'], 0),
      walletBalance: parseNumber(row['Solde'], 0),
      lastAppointmentDate: parseFrDateToIso(row['Dernier RDV']),
      csvCreatedAt: (row['Créé le'] || '').trim(),
      csvCreatedBy: (row['Créé Par'] || '').trim(),
      csvUpdatedAt: (row['Mis à jour à'] || '').trim(),
      csvUpdatedBy: (row['Mis à jour par'] || '').trim(),
      isCsvArchive: true,
    };

    byFileNum.set(num, patient);
    const norm = normalizeLookupName(fullName);
    if (norm && !byNormName.has(norm)) {
      byNormName.set(norm, patient);
    }
    return patient;
  });

  const resolvePatient = (fileNumRaw: string | undefined, nameRaw: string | undefined): {
    patientId: string;
    patientFileNumber: string;
    patientName: string;
    patient?: Patient;
  } => {
    const fileNum = (fileNumRaw || '').trim();
    const name = (nameRaw || '').trim();
    const found =
      (fileNum ? byFileNum.get(fileNum) : undefined) ||
      (name ? byNormName.get(normalizeLookupName(name)) : undefined);
    if (found) {
      return {
        patientId: found.id,
        patientFileNumber: found.fileNumber,
        patientName: found.fullName || `${found.lastName} ${found.firstName}`.trim(),
        patient: found,
      };
    }
    const fallbackNum = fileNum || sanitizeIdPart(name || '0');
    return {
      patientId: `csv_pat_${sanitizeIdPart(fallbackNum)}`,
      patientFileNumber: fileNum || '—',
      patientName: name || 'Patient',
    };
  };

  // 2. Actes cliniques (1,045)
  const actesRows = parseCsvRfc4180(raw.actes);
  const clinicalActs: PatientClinicalAct[] = actesRows.map((row, idx) => {
    const linked = resolvePatient(row['Numéro de patient'], row['Patient']);
    const dateIso = parseFrDateToIso(row['Date']) || parseFrDateToIso(row['Date de réalisation']);
    return {
      id: `csv_act_${idx + 1}`,
      date: dateIso,
      realizationDate: parseFrDateToIso(row['Date de réalisation']),
      patientId: linked.patientId,
      patientFileNumber: (row['Numéro de patient'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim(),
      actName: (row['Acte'] || '').trim() || 'Acte clinique',
      teeth: (row['Dents'] || '').trim(),
      price: parseNumber(row['Prix'], 0),
      receivedAmount: parseNumber(row['Reçu'], 0),
      remainingAmount: parseNumber(row['Reste'], 0),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim(),
      status: (row['Statut'] || 'En attente').trim(),
      isCsvArchive: true,
    };
  });
  clinicalActs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 3. Devis / Plans de traitement (52)
  const devisRows = parseCsvRfc4180(raw.devis);
  const treatmentPlans: TreatmentPlan[] = devisRows.map((row, idx) => {
    const linked = resolvePatient(row['Num P'], row['Patient']);
    const quoteNumber = (row['Numéro'] || '').trim() || String(idx + 1).padStart(4, '0');
    const totalAmount = Math.max(0, parseNumber(row['Total'], 0));
    const rawActs = (row['Actes'] || '').trim();
    const actLines = rawActs
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 40);

    const perLinePrice = actLines.length > 0 ? Math.round((totalAmount / actLines.length) * 100) / 100 : totalAmount;
    const items: TreatmentPlanItem[] = actLines.map((line, lineIdx) => ({
      id: `csv_pi_${idx + 1}_${lineIdx + 1}`,
      phase: 'Phase 1 : Assainissement',
      tooth: '—',
      actCode: `DEV-${lineIdx + 1}`,
      actName: line.slice(0, 150),
      unitPrice: lineIdx === actLines.length - 1
        ? Math.max(0, Math.round((totalAmount - perLinePrice * (actLines.length - 1)) * 100) / 100)
        : perLinePrice,
      quantity: 1,
      discount: 0,
      status: mapCsvQuoteStatus(row['Statut']) === 'Accepté' ? 'Réalisé' : 'Prévu',
    }));

    const firstLine = actLines[0] || `Devis ${quoteNumber}`;
    const title = actLines.length > 1
      ? `${firstLine.slice(0, 130)} (+${actLines.length - 1} actes)`
      : firstLine.slice(0, 175);

    const status = mapCsvQuoteStatus(row['Statut']);
    return {
      id: `csv_plan_${idx + 1}_${sanitizeIdPart(quoteNumber)}`,
      quoteNumber: quoteNumber.slice(0, 40),
      patientId: linked.patientId,
      patientFileNumber: (row['Num P'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      title: title || `Devis ${quoteNumber}`,
      status,
      items,
      totalAmount,
      consentSigned: status === 'Accepté',
      lockedVersion: status === 'Accepté',
      createdBy: safeUid,
      quoteDate: parseFrDateToIso(row['Date']),
      validityDate: parseFrDateToIso(row['Date de validité']),
      rawActsText: rawActs,
      isCsvArchive: true,
    };
  });
  treatmentPlans.sort((a, b) => (b.quoteDate || '').localeCompare(a.quoteDate || '') || b.quoteNumber.localeCompare(a.quoteNumber, 'fr'));

  // 4. Factures (185) — reconciled against patient.remainingDue so no phantom unpaid debt is created
  const facturesRows = parseCsvRfc4180(raw.factures);
  const invoices: Invoice[] = facturesRows.map((row, idx) => {
    const linked = resolvePatient(row['Num Patient'], row['Patient']);
    const invoiceNumber = (row['Numéro'] || '').trim() || String(idx + 1).padStart(4, '0');
    const totalAmount = Math.max(0, parseNumber(row['Montant'], 0));
    const rawActs = (row['Actes'] || '').trim();
    const actLines = rawActs
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 40);

    const perLinePrice = actLines.length > 0 ? Math.round((totalAmount / actLines.length) * 100) / 100 : totalAmount;
    const items: InvoiceItem[] = actLines.map((line, lineIdx) => {
      const price = lineIdx === actLines.length - 1
        ? Math.max(0, Math.round((totalAmount - perLinePrice * (actLines.length - 1)) * 100) / 100)
        : perLinePrice;
      return {
        actCode: `ACT-${lineIdx + 1}`,
        actName: line.slice(0, 150),
        quantity: 1,
        unitPrice: price,
        total: price,
      };
    });

    const issueDate = parseFrDateToIso(row['Date']);
    return {
      id: `csv_inv_${idx + 1}_${sanitizeIdPart(invoiceNumber)}`,
      invoiceNumber: invoiceNumber.slice(0, 40),
      patientId: linked.patientId,
      patientFileNumber: (row['Num Patient'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      issueDate,
      dueDate: issueDate,
      items,
      totalAmount,
      insuranceType: 'Aucune',
      insuranceShare: 0,
      patientShare: totalAmount,
      paidAmount: totalAmount,
      status: 'Payée',
      insuranceClaimStatus: 'Aucune',
      createdBy: safeUid,
      rawActsText: rawActs,
      csvCreatedAt: (row['Créé le'] || '').trim(),
      csvUpdatedAt: (row['Dernière mise à jour le'] || '').trim(),
      isCsvArchive: true,
    };
  });

  // Allocate each patient's actual CSV remainingDue across their most recent CSV invoices
  const invoicesByPatient = new Map<string, Invoice[]>();
  invoices.forEach((inv) => {
    const arr = invoicesByPatient.get(inv.patientId) || [];
    arr.push(inv);
    invoicesByPatient.set(inv.patientId, arr);
  });
  invoicesByPatient.forEach((patInvoices, patId) => {
    const pat = patients.find((p) => p.id === patId);
    let remainingToAllocate = Math.max(0, Number(pat?.remainingDue || 0));
    patInvoices.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || b.invoiceNumber.localeCompare(a.invoiceNumber, 'fr'));
    for (const inv of patInvoices) {
      if (remainingToAllocate <= 0) {
        inv.paidAmount = inv.totalAmount;
        inv.status = 'Payée';
      } else {
        const unpaid = Math.min(inv.totalAmount, remainingToAllocate);
        inv.paidAmount = Math.max(0, Math.round((inv.totalAmount - unpaid) * 100) / 100);
        remainingToAllocate = Math.max(0, Math.round((remainingToAllocate - unpaid) * 100) / 100);
        inv.status = inv.paidAmount <= 0 ? 'Émise' : inv.paidAmount < inv.totalAmount ? 'Partiellement payée' : 'Payée';
      }
    }
  });
  invoices.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || b.invoiceNumber.localeCompare(a.invoiceNumber, 'fr'));

  // 5. Paiements (1,100) — all 22 columns preserved
  const paiementsRows = parseCsvRfc4180(raw.paiements);
  const payments: Payment[] = paiementsRows.map((row, idx) => {
    const linked = resolvePatient(row['Num P'], row['Patient']);
    const actIdRef = (row['ID Acte'] || '').trim();
    const patInvoices = invoicesByPatient.get(linked.patientId) || [];
    const linkedInvoiceId = patInvoices[0]?.id || `csv_inv_ref_${sanitizeIdPart(linked.patientFileNumber)}`;
    const chequeAmountRaw = (row['Chéque montant'] || '').trim();

    return {
      id: `csv_pay_${idx + 1}`,
      receiptNumber: (actIdRef ? `ACT-${actIdRef}` : `ENC-${String(idx + 1).padStart(4, '0')}`).slice(0, 40),
      invoiceId: linkedInvoiceId,
      patientId: linked.patientId,
      patientFileNumber: (row['Num P'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim(),
      date: parseFrDateToIso(row['Date']) || parseFrDateToIso(row['Créé à']),
      amount: parseNumber(row['Montant encaissé'], 0),
      method: mapCsvPaymentMethod(row['Type']),
      rawMethod: (row['Type'] || '').trim(),
      payerType: 'Patient',
      isAdvance: false,
      chequeDate: parseFrDateToIso(row['Chéque date']),
      chequeNumber: (row['Chéque référence'] || '').trim().slice(0, 60),
      chequeAmount: chequeAmountRaw ? parseNumber(chequeAmountRaw, 0) : undefined,
      chequeStatus: (row['Chéque statut'] || '').trim(),
      chequeDepositDate: parseFrDateToIso(row['Chéque date de depot']),
      chequeEncashmentDate: parseFrDateToIso(row["Chéque date d'encaissement"]),
      chequeGuarantee: (row['Chéque de garantie'] || '').trim(),
      actCode: (row['Code Acte'] || '').trim(),
      actName: (row['Acte'] || '').trim(),
      actFees: parseNumber(row['Honoraires'], 0),
      previousPayment: parseNumber(row['Ancien Paiement'], 0),
      remainingBalance: parseNumber(row['Reste'], 0),
      enteredBy: (row['Saisi par'] || '').trim(),
      csvCreatedAt: (row['Créé à'] || '').trim(),
      actIdRef,
      notes: (row['Note'] || '').trim().slice(0, 250),
      createdBy: safeUid,
      isCsvArchive: true,
    };
  });
  payments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 6. Charges (4) — all 9 columns preserved
  const chargesRows = parseCsvRfc4180(raw.charges);
  const expenses: Expense[] = chargesRows.map((row, idx) => {
    const rawType = (row['Type'] || '').trim();
    const desc = (row['Description'] || '').trim();
    const label = (desc ? `${rawType} — ${desc}` : rawType || 'Charge cabinet').slice(0, 180);
    return {
      id: `csv_exp_${idx + 1}`,
      date: parseFrDateToIso(row['Date']),
      category: mapCsvExpenseCategory(rawType),
      expenseType: 'Charge fixe',
      label,
      amount: Math.max(0, parseNumber(row['Montant'], 0)),
      paymentMethod: mapCsvExpenseMethod(row['Moyen de paiement']),
      rawType,
      description: desc,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim(),
      enteredBy: (row['Saisi par'] || '').trim(),
      rawPaymentMethod: (row['Moyen de paiement'] || '').trim(),
      settlementDate: parseFrDateToIso(row['Date de règlement']),
      declared: (row['Declaré'] || '').trim(),
      createdBy: safeUid,
      isCsvArchive: true,
    };
  });
  expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 7. Documents médicaux (15 certificats + 4 feuilles de soins + 3 notes d'honoraires + 7 ordonnances = 29)
  const medicalDocuments: MedicalDocument[] = [];

  parseCsvRfc4180(raw.certificats).forEach((row, idx) => {
    const linked = resolvePatient(row['Num Patient'], row['Patient']);
    const durationDays = Math.max(0, parseNumber(row['Durée (Jours)'], 1));
    const certType = (row['Type'] || 'Initial').trim();
    const dateIso = parseFrDateToIso(row['Le']);
    medicalDocuments.push({
      id: `csv_doc_cert_${idx + 1}`,
      patientId: linked.patientId,
      patientFileNumber: (row['Num Patient'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      docType: 'Certificat médical',
      date: dateIso,
      title: `Certificat médical (${certType}) · ${durationDays} jour${durationDays > 1 ? 's' : ''}`.slice(0, 160),
      bodyText: `Je soussigné(e), ${row['Praticien'] || 'Dr.Sara BCHI'}, certifie que l'état de santé de ${row['Patient'] || linked.patientName} nécessite un arrêt / repos de ${durationDays} jour(s) à compter du ${row['Le'] || dateIso} (Type : ${certType}).`,
      durationDays,
      certificateType: certType,
      csvCreatedAt: (row['Créé le'] || '').trim(),
      csvCreatedBy: (row['Créé par'] || '').trim(),
      csvUpdatedAt: (row['Dernière mise à jour le'] || '').trim(),
      csvUpdatedBy: (row['Dernière mise à jour par'] || '').trim(),
      createdBy: safeUid,
      isCsvArchive: true,
    });
  });

  parseCsvRfc4180(raw.feuillesDeSoins).forEach((row, idx) => {
    const linked = resolvePatient(row['Num Patient'], row['Patient']);
    const fund = (row['Feuille de soins'] || 'CNSS').trim();
    const execType = (row['Type'] || 'Exécution').trim();
    const amount = parseNumber(row['Montant'], 0);
    const actsText = (row['Actes'] || '').trim();
    medicalDocuments.push({
      id: `csv_doc_fds_${idx + 1}`,
      patientId: linked.patientId,
      patientFileNumber: (row['Num Patient'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      docType: 'Feuille de soins',
      date: parseFrDateToIso(row['Le']),
      title: `Feuille de soins ${fund} (${execType}) · ${amount.toLocaleString('fr-FR')} MAD`.slice(0, 160),
      bodyText: actsText.slice(0, 3000),
      amount,
      careSheetFund: fund,
      careSheetExecutionType: execType,
      actsText,
      csvCreatedAt: (row['Créé le'] || '').trim(),
      csvCreatedBy: (row['Créé par'] || '').trim(),
      csvUpdatedAt: (row['Dernière mise à jour le'] || '').trim(),
      csvUpdatedBy: (row['Dernière mise à jour par'] || '').trim(),
      createdBy: safeUid,
      isCsvArchive: true,
    });
  });

  parseCsvRfc4180(raw.notesHonoraires).forEach((row, idx) => {
    const linked = resolvePatient(row['Num Patient'], row['Patient']);
    const amount = parseNumber(row['Montant'], 0);
    const paymentMethod = (row['Moyen de paiement'] || 'Espèce').trim();
    const actsText = (row['Actes'] || '').trim();
    medicalDocuments.push({
      id: `csv_doc_nh_${idx + 1}`,
      patientId: linked.patientId,
      patientFileNumber: (row['Num Patient'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      docType: "Note d'honoraires",
      date: parseFrDateToIso(row['Le']),
      title: `Note d'honoraires · ${amount.toLocaleString('fr-FR')} MAD (${paymentMethod})`.slice(0, 160),
      bodyText: actsText.slice(0, 3000),
      amount,
      paymentMethod,
      actsText,
      csvCreatedAt: (row['Créé le'] || '').trim(),
      csvCreatedBy: (row['Créé par'] || '').trim(),
      csvUpdatedAt: (row['Dernière mise à jour le'] || '').trim(),
      csvUpdatedBy: (row['Dernière mise à jour par'] || '').trim(),
      createdBy: safeUid,
      isCsvArchive: true,
    });
  });

  parseCsvRfc4180(raw.ordonnances).forEach((row, idx) => {
    const linked = resolvePatient(row['Num Patient'], row['Patient']);
    const medsRaw = (row['Les médicaments'] || '').trim();
    const medLines = medsRaw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 20);
    const prescriptions: PrescriptionLine[] = medLines.map((med) => ({
      molecule: med,
      dosage: 'Selon prescription',
      frequency: 'Voir posologie cabinet',
      duration: 'Traitement prescrit',
    }));

    medicalDocuments.push({
      id: `csv_doc_ord_${idx + 1}`,
      patientId: linked.patientId,
      patientFileNumber: (row['Num Patient'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      docType: 'Ordonnance',
      date: parseFrDateToIso(row['Le']),
      title: `Ordonnance · ${medLines.length} médicament${medLines.length > 1 ? 's' : ''}`.slice(0, 160),
      prescriptions,
      bodyText: medsRaw.slice(0, 3000),
      medicationsText: medsRaw,
      csvCreatedAt: (row['Créé le'] || '').trim(),
      csvCreatedBy: (row['Créé par'] || '').trim(),
      csvUpdatedAt: (row['Dernière mise à jour le'] || '').trim(),
      csvUpdatedBy: (row['Dernière mise à jour par'] || '').trim(),
      createdBy: safeUid,
      isCsvArchive: true,
    });
  });

  medicalDocuments.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 8. Prothèses / Laboratoire (0 lignes de données actuellement dans protheses_5a69e534.csv)
  const prothesesRows = parseCsvRfc4180(raw.protheses);
  const labOrders: LabOrder[] = prothesesRows.map((row, idx) => {
    const linked = resolvePatient(row['Num P'], row['Patient']);
    const prosth = (row['Types de prothèse'] || 'Zircone').trim();
    const validProsthTypes: LabOrder['prosthesisType'][] = [
      'Zircone',
      'Céramo-métallique',
      'E-max',
      'Squeletté',
      'Résine amovible',
      'Gouttière',
      'Sur implant',
    ];
    const prosthesisType = (validProsthTypes.find((t) => t.toLowerCase() === prosth.toLowerCase()) || 'Zircone') as LabOrder['prosthesisType'];
    return {
      id: `csv_lab_${idx + 1}`,
      orderNumber: `PRO-${String(idx + 1).padStart(4, '0')}`,
      patientId: linked.patientId,
      patientFileNumber: (row['Num P'] || linked.patientFileNumber).trim(),
      patientName: (row['Patient'] || linked.patientName).trim().slice(0, 150),
      practitionerId: safeUid,
      practitionerName: (row['Praticien'] || 'Dr.Sara BCHI').trim().slice(0, 120),
      labName: (row['Laboratoire'] || 'Laboratoire').trim().slice(0, 120),
      labPhone: (row['Laboratoire tel'] || '').trim(),
      prosthesisType,
      shadeVita: (row['Teinte'] || '').trim().slice(0, 20),
      teeth: (row['Dents'] || '').trim().slice(0, 60),
      sentDate: parseFrDateToIso(row["Date d'envoi"]),
      returnDate: parseFrDateToIso(row['Date de retour']),
      fittingDate: parseFrDateToIso(row['Date de pose']),
      dueDate: parseFrDateToIso(row['Date de retour']),
      nextAppointmentDate: parseFrDateToIso(row['Date de pose']),
      status: mapCsvLabStatus(row['Statut']),
      labCost: 0,
      supplierPaid: ['oui', 'payé', 'paye', 'true', '1'].includes((row['Payé'] || '').trim().toLowerCase()),
      notes: (row['Observation'] || '').trim().slice(0, 400),
      createdBy: safeUid,
      isCsvArchive: true,
    };
  });

  return {
    patients,
    clinicalActs,
    treatmentPlans,
    invoices,
    payments,
    expenses,
    medicalDocuments,
    labOrders,
  };
}

let cachedUid: string | null = null;
let cachedPromise: Promise<CabinetCsvBundle> | null = null;

async function fetchCsvText(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

export async function loadAllCabinetCsvData(defaultUid = 'csv_dr_sara_bchi'): Promise<CabinetCsvBundle> {
  if (!cachedPromise || cachedUid !== defaultUid) {
    cachedUid = defaultUid;
    cachedPromise = (async () => {
      const [
        patients,
        actes,
        devis,
        factures,
        paiements,
        charges,
        certificats,
        feuillesDeSoins,
        notesHonoraires,
        ordonnances,
        protheses,
      ] = await Promise.all([
        fetchCsvText(CABINET_CSV_FILES.patients),
        fetchCsvText(CABINET_CSV_FILES.actes),
        fetchCsvText(CABINET_CSV_FILES.devis),
        fetchCsvText(CABINET_CSV_FILES.factures),
        fetchCsvText(CABINET_CSV_FILES.paiements),
        fetchCsvText(CABINET_CSV_FILES.charges),
        fetchCsvText(CABINET_CSV_FILES.certificats),
        fetchCsvText(CABINET_CSV_FILES.feuillesDeSoins),
        fetchCsvText(CABINET_CSV_FILES.notesHonoraires),
        fetchCsvText(CABINET_CSV_FILES.ordonnances),
        fetchCsvText(CABINET_CSV_FILES.protheses),
      ]);

      return buildCsvCollections(
        {
          patients,
          actes,
          devis,
          factures,
          paiements,
          charges,
          certificats,
          feuillesDeSoins,
          notesHonoraires,
          ordonnances,
          protheses,
        },
        defaultUid
      );
    })();
  }
  return cachedPromise;
}
