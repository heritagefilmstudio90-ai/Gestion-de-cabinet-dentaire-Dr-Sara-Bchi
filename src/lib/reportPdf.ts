import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ClinicSettings } from '../types/dental';
import { formatDateFR, todayISO } from './formatters';

export interface MonthlyStatRow {
  monthKey: string; // YYYY-MM
  monthLabel: string;
  invoiceCount: number;
  billed: number;
  collected: number;
  expenses: number;
  netMargin: number;
  appointmentsTotal: number;
  appointmentsNoShow: number;
}

export interface PractitionerReportRow {
  name: string;
  count: number;
  billed: number;
  sharePercent: number;
}

export interface PaymentMethodReportRow {
  method: string;
  count: number;
  amount: number;
  sharePercent: number;
}

export interface ExpenseCategoryReportRow {
  category: string;
  count: number;
  amount: number;
  sharePercent: number;
}

export interface FinancialInvoiceRow {
  invoiceNumber: string;
  issueDate: string;
  patientName: string;
  insuranceType: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
}

export interface FinancialReportPdfInput {
  clinicSettings: ClinicSettings | null;
  periodLabel: string;
  periodSlug: string;
  generatedBy: string;
  summary: {
    totalBilled: number;
    totalCollected: number;
    totalExpenses: number;
    netMargin: number;
    outstandingBalance: number;
    collectionRate: number;
    quoteConversion: number;
    acceptedQuotesCount: number;
    totalQuotesCount: number;
    avgBasket: number;
    noShowRate: number;
    noShowCount: number;
    totalAppointments: number;
    insurancePendingTotal: number;
    patientPendingTotal: number;
  };
  monthlyStats: MonthlyStatRow[];
  byPractitioner: PractitionerReportRow[];
  byPaymentMethod: PaymentMethodReportRow[];
  byExpenseCategory: ExpenseCategoryReportRow[];
  invoicesList: FinancialInvoiceRow[];
  clinicalActivity?: {
    totalActs: number;
    finishedActs: number;
    totalHonoraires: number;
    totalReceived: number;
    totalRemaining: number;
    topActs: Array<{ name: string; count: number; total: number }>;
  };
}

type JsPDFWithAutoTable = jsPDF & {
  lastAutoTable?: {
    finalY: number;
  };
};

function sanitizePdfText(value: string | undefined | null): string {
  if (!value) return '-';
  return String(value)
    .replace(/[\u202F\u00A0]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[—–]/g, '-');
}

function formatPdfMAD(amount: number | undefined | null): string {
  const val = Number.isFinite(amount) ? Number(amount) : 0;
  const fixed = val.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formattedInt},${decPart} MAD`;
}

function drawSectionHeading(doc: jsPDF, title: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(11, 34, 57); // #0B2239
  doc.text(sanitizePdfText(title), 14, y);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.35);
  doc.line(14, y + 2, 196, y + 2);
  return y + 7;
}

export function exportFinancialReportPdf(input: FinancialReportPdfInput): string {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  }) as JsPDFWithAutoTable;

  const clinicName = sanitizePdfText(input.clinicSettings?.clinicName || 'Cabinet Dentaire Dr. Sara Bchi');
  const clinicSubtitle = sanitizePdfText(input.clinicSettings?.subtitle || 'Chirurgien - Dentiste');
  const clinicAddress = sanitizePdfText(input.clinicSettings?.address || '');
  const clinicPhone = sanitizePdfText(input.clinicSettings?.phone || '+212 532 101 351');
  const clinicEmail = sanitizePdfText(input.clinicSettings?.email || '');
  const fiscalParts = [
    input.clinicSettings?.ice ? `ICE: ${input.clinicSettings.ice}` : '',
    input.clinicSettings?.ifNumber ? `IF: ${input.clinicSettings.ifNumber}` : '',
    input.clinicSettings?.patente ? `Patente: ${input.clinicSettings.patente}` : '',
    input.clinicSettings?.inpe ? `INPE: ${input.clinicSettings.inpe}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');

  // Top Header Banner (#0B2239)
  doc.setFillColor(11, 34, 57);
  doc.rect(0, 0, 210, 34, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(clinicName, 14, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(186, 230, 253); // sky-200
  doc.text(clinicSubtitle, 14, 18.5);

  const contactLine = [clinicAddress, clinicPhone ? `Tel: ${clinicPhone}` : '', clinicEmail]
    .filter((s) => s && s !== '-')
    .join('  |  ');
  if (contactLine) {
    doc.setTextColor(203, 213, 225);
    doc.setFontSize(7.5);
    doc.text(contactLine.slice(0, 95), 14, 24.5);
  }

  // Right side report metadata
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('RAPPORT FINANCIER & STATISTIQUES', 196, 12.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(226, 232, 240);
  doc.text(`Periode : ${sanitizePdfText(input.periodLabel)}`, 196, 18.5, { align: 'right' });
  doc.text(
    `Edite le ${sanitizePdfText(formatDateFR(todayISO()))} par ${sanitizePdfText(input.generatedBy)}`,
    196,
    24,
    { align: 'right' }
  );

  // Subtle accent line
  doc.setFillColor(2, 132, 199); // sky-600
  doc.rect(0, 34, 210, 1.2, 'F');

  let cursorY = 43;

  // 1. KPI Summary Cards (4 cards)
  cursorY = drawSectionHeading(doc, '1. Synthese Financiere & Indicateurs Cles', cursorY);

  const cardWidth = 43.5;
  const cardGap = 2.6;
  const cardHeight = 22;
  const cards = [
    {
      label: 'CA Facture',
      value: formatPdfMAD(input.summary.totalBilled),
      sub: `${input.summary.collectionRate}% encaisse`,
      primary: true,
    },
    {
      label: 'Montant Encaisse',
      value: formatPdfMAD(input.summary.totalCollected),
      sub: `Reste du : ${formatPdfMAD(input.summary.outstandingBalance)}`,
      primary: false,
    },
    {
      label: 'Charges & Depenses',
      value: formatPdfMAD(input.summary.totalExpenses),
      sub: `Marge : ${formatPdfMAD(input.summary.netMargin)}`,
      primary: false,
    },
    {
      label: 'Activite & Devis',
      value: `${input.summary.quoteConversion}% devis`,
      sub: `Panier moy. : ${formatPdfMAD(input.summary.avgBasket)}`,
      primary: false,
    },
  ];

  cards.forEach((card, idx) => {
    const x = 14 + idx * (cardWidth + cardGap);
    if (card.primary) {
      doc.setFillColor(11, 34, 57);
      doc.roundedRect(x, cursorY, cardWidth, cardHeight, 2, 2, 'F');
      doc.setTextColor(186, 230, 253);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(card.label, x + 3, cursorY + 5.5);
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(card.value, x + 3, cursorY + 12.5);
      doc.setTextColor(203, 213, 225);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(card.sub, x + 3, cursorY + 18);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, cursorY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(card.label, x + 3, cursorY + 5.5);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(card.value, x + 3, cursorY + 12.5);
      doc.setTextColor(71, 85, 105);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(card.sub, x + 3, cursorY + 18);
    }
  });

  cursorY += cardHeight + 6;

  // Secondary operational strip
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(14, cursorY, 182, 11, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Devis acceptes : ${input.summary.acceptedQuotesCount}/${input.summary.totalQuotesCount}   |   RDV total : ${input.summary.totalAppointments} (Absenteisme : ${input.summary.noShowRate}%)   |   Creances Mutuelles : ${formatPdfMAD(input.summary.insurancePendingTotal)}   |   Creances Patients : ${formatPdfMAD(input.summary.patientPendingTotal)}`,
    17,
    cursorY + 6.8
  );

  cursorY += 18;

  // 2. Monthly Statistics Chart + Table
  if (input.monthlyStats.length > 0) {
    cursorY = drawSectionHeading(doc, '2. Statistiques Mensuelles & Evolution Tresorerie', cursorY);

    // Compact vector comparison bar chart (up to 6 latest months)
    const chartMonths = input.monthlyStats.slice(-6);
    const maxVal = Math.max(
      1,
      ...chartMonths.flatMap((m) => [m.billed, m.collected, m.expenses])
    );
    const chartHeight = 26;
    const chartBaseY = cursorY + chartHeight;
    const chartLeft = 18;
    const chartRight = 192;
    const slotWidth = (chartRight - chartLeft) / chartMonths.length;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(chartLeft, chartBaseY, chartRight, chartBaseY);

    chartMonths.forEach((m, idx) => {
      const centerX = chartLeft + idx * slotWidth + slotWidth / 2;
      const barW = Math.min(6, slotWidth / 4.2);

      const hBilled = Math.max(1, (m.billed / maxVal) * (chartHeight - 4));
      const hCollected = Math.max(1, (m.collected / maxVal) * (chartHeight - 4));
      const hExp = Math.max(1, (m.expenses / maxVal) * (chartHeight - 4));

      // Billed (#0B2239)
      doc.setFillColor(11, 34, 57);
      doc.rect(centerX - barW * 1.6, chartBaseY - hBilled, barW, hBilled, 'F');
      // Collected (#0284C7)
      doc.setFillColor(2, 132, 199);
      doc.rect(centerX - barW * 0.45, chartBaseY - hCollected, barW, hCollected, 'F');
      // Expenses (#DC2626)
      doc.setFillColor(220, 38, 38);
      doc.rect(centerX + barW * 0.7, chartBaseY - hExp, barW, hExp, 'F');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text(sanitizePdfText(m.monthLabel), centerX, chartBaseY + 4, { align: 'center' });
    });

    // Legend
    const legendY = chartBaseY + 9;
    doc.setFillColor(11, 34, 57);
    doc.rect(18, legendY - 2.3, 3, 2.5, 'F');
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(7.2);
    doc.text('CA Facture', 22.5, legendY);

    doc.setFillColor(2, 132, 199);
    doc.rect(48, legendY - 2.3, 3, 2.5, 'F');
    doc.text('Encaisse', 52.5, legendY);

    doc.setFillColor(220, 38, 38);
    doc.rect(74, legendY - 2.3, 3, 2.5, 'F');
    doc.text('Charges', 78.5, legendY);

    cursorY = legendY + 4;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [['Mois', 'Factures', 'CA Facture', 'Encaisse', 'Charges', 'Marge Nette', 'RDV (Abs.)']],
      body: input.monthlyStats.map((m) => [
        sanitizePdfText(m.monthLabel),
        String(m.invoiceCount),
        formatPdfMAD(m.billed),
        formatPdfMAD(m.collected),
        formatPdfMAD(m.expenses),
        formatPdfMAD(m.netMargin),
        `${m.appointmentsTotal} (${m.appointmentsNoShow})`,
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: [11, 34, 57],
        textColor: [255, 255, 255],
        fontSize: 7.8,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 7.6,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold' },
        6: { halign: 'center' },
      },
    });

    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // Ensure enough space before next section
  if (cursorY > 235) {
    doc.addPage();
    cursorY = 18;
  }

  // 3. Payment Methods & Practitioner Breakdown
  cursorY = drawSectionHeading(doc, '3. Suivi des Encaissements & Revenus par Praticien', cursorY);

  if (input.byPaymentMethod.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [['Mode de Paiement', 'Nb Reglements', 'Montant Encaisse', 'Part (%)']],
      body: input.byPaymentMethod.map((pm) => [
        sanitizePdfText(pm.method),
        String(pm.count),
        formatPdfMAD(pm.amount),
        `${pm.sharePercent}%`,
      ]),
      theme: 'grid',
      headStyles: {
        fillColor: [2, 132, 199],
        textColor: [255, 255, 255],
        fontSize: 7.8,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 7.6,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right' },
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 6;
  }

  if (input.byPractitioner.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [['Praticien', 'Factures Emises', 'CA Facture', 'Part du CA (%)']],
      body: input.byPractitioner.map((p) => [
        sanitizePdfText(p.name),
        String(p.count),
        formatPdfMAD(p.billed),
        `${p.sharePercent}%`,
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: [11, 34, 57],
        textColor: [255, 255, 255],
        fontSize: 7.8,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 7.6,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right' },
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // 4. Expenses by Category
  if (input.byExpenseCategory.length > 0) {
    if (cursorY > 235) {
      doc.addPage();
      cursorY = 18;
    }
    cursorY = drawSectionHeading(doc, '4. Ventilation des Charges & Depenses', cursorY);
    autoTable(doc, {
      startY: cursorY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [['Categorie de Charge', 'Ecritures', 'Montant Total', 'Part (%)']],
      body: input.byExpenseCategory.map((e) => [
        sanitizePdfText(e.category),
        String(e.count),
        formatPdfMAD(e.amount),
        `${e.sharePercent}%`,
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: [71, 85, 105],
        textColor: [255, 255, 255],
        fontSize: 7.8,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 7.6,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right' },
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 8;
  }

  // 4b. Clinical Activity Summary
  if (input.clinicalActivity && input.clinicalActivity.totalActs > 0) {
    if (cursorY > 225) {
      doc.addPage();
      cursorY = 18;
    }
    cursorY = drawSectionHeading(doc, '5. Activite Clinique & Actes Realises', cursorY);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(14, cursorY, 182, 11, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `Actes realises : ${input.clinicalActivity.totalActs} (Termines : ${input.clinicalActivity.finishedActs})   |   Honoraires actes : ${formatPdfMAD(input.clinicalActivity.totalHonoraires)}   |   Recu : ${formatPdfMAD(input.clinicalActivity.totalReceived)}   |   Reste : ${formatPdfMAD(input.clinicalActivity.totalRemaining)}`,
      17,
      cursorY + 6.8
    );
    cursorY += 15;

    if (input.clinicalActivity.topActs.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        margin: { left: 14, right: 14, bottom: 18 },
        head: [['Acte Clinique (Principaux actes)', 'Volume', 'Honoraires Cumules']],
        body: input.clinicalActivity.topActs.map((act) => [
          sanitizePdfText(act.name),
          String(act.count),
          formatPdfMAD(act.total),
        ]),
        theme: 'striped',
        headStyles: {
          fillColor: [2, 132, 199],
          textColor: [255, 255, 255],
          fontSize: 7.8,
          fontStyle: 'bold',
        },
        bodyStyles: {
          fontSize: 7.6,
          textColor: [30, 41, 59],
        },
        columnStyles: {
          1: { halign: 'center' },
          2: { halign: 'right', fontStyle: 'bold' },
        },
      });
      cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 8;
    }
  }

  // 6. Financial Invoices Ledger for the period
  if (input.invoicesList.length > 0) {
    if (cursorY > 225) {
      doc.addPage();
      cursorY = 18;
    }
    const ledgerHeading =
      input.clinicalActivity && input.clinicalActivity.totalActs > 0
        ? '6. Suivi Detaille des Factures & Recouvrements'
        : '5. Suivi Detaille des Factures & Recouvrements';
    cursorY = drawSectionHeading(doc, ledgerHeading, cursorY);
    autoTable(doc, {
      startY: cursorY,
      margin: { left: 14, right: 14, bottom: 18 },
      head: [['N° Facture', 'Date', 'Patient', 'Mutuelle', 'Total', 'Regle', 'Reste Du', 'Statut']],
      body: input.invoicesList.map((inv) => [
        sanitizePdfText(inv.invoiceNumber),
        sanitizePdfText(formatDateFR(inv.issueDate)),
        sanitizePdfText(inv.patientName),
        sanitizePdfText(inv.insuranceType || 'Aucune'),
        formatPdfMAD(inv.totalAmount),
        formatPdfMAD(inv.paidAmount),
        formatPdfMAD(inv.remainingAmount),
        sanitizePdfText(inv.status),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: [11, 34, 57],
        textColor: [255, 255, 255],
        fontSize: 7.3,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fontSize: 7.2,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right', fontStyle: 'bold' },
      },
    });
  }

  // Page Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.line(14, 284, 196, 284);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      fiscalParts ? `${clinicName}  -  ${fiscalParts}` : clinicName,
      14,
      289
    );
    doc.text(`Page ${i} / ${pageCount}`, 196, 289, { align: 'right' });
  }

  const fileName = `DentaFlow-Rapport-${input.periodSlug}-${todayISO()}.pdf`;
  doc.save(fileName);
  return fileName;
}
