import React from 'react';
import { Printer, X } from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { formatDateFR, formatMAD } from '../lib/formatters';

export const PrintModal: React.FC = () => {
  const { printableDoc, setPrintableDoc, clinicSettings } = useClinic();

  if (!printableDoc) return null;

  const clinicName = clinicSettings?.clinicName || 'Cabinet Dentaire Dr. Sara Bchi';
  const clinicSubtitle = clinicSettings?.subtitle || 'Chirurgien - Dentiste';
  const clinicPhone = clinicSettings?.phone || '+212 532 101 351';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 dark:bg-black/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto print:static print:bg-white print:p-0">
      <div className="my-auto w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl print:border-0 print:shadow-none print:max-w-none overflow-hidden">
        <div className="no-print flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3.5 sm:py-4">
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">Aperçu avant impression A4</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{printableDoc.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-3.5 sm:px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 transition-colors min-h-[38px]"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Imprimer / PDF</span>
            </button>
            <button
              type="button"
              onClick={() => setPrintableDoc(null)}
              aria-label="Fermer l'aperçu"
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[38px] min-w-[38px] flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-8 text-slate-900 print:p-0">
          {/* Clinic Letterhead */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b-2 border-slate-900 pb-5">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <img
                src="/assets/cabinet/logo_Dr_sara_50e1a027.png"
                alt={clinicName}
                className="h-10 sm:h-12 w-auto max-w-[110px] sm:max-w-[140px] object-contain shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">{clinicName}</h1>
                <p className="text-xs font-medium text-slate-600 mt-0.5">{clinicSubtitle}</p>
              {clinicSettings?.address && (
                <p className="text-xs text-slate-500 mt-1">{clinicSettings.address}</p>
              )}
              <p className="text-xs text-slate-500 break-words">
                Tél : {clinicPhone}
                {clinicSettings?.email ? ` · Email : ${clinicSettings.email}` : ''}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Consultations sur RDV : Lun–Ven {clinicSettings?.workingHours?.start || '09:00'}–{clinicSettings?.workingHours?.lunchStart || '13:00'} / {clinicSettings?.workingHours?.lunchEnd || '15:00'}–{clinicSettings?.workingHours?.end || '18:00'} · Samedi {clinicSettings?.workingHours?.saturdayStart || '09:00'}–{clinicSettings?.workingHours?.saturdayEnd || '13:00'}
              </p>
              </div>
            </div>
            <div className="text-left sm:text-right text-xs text-slate-600 tabular-nums shrink-0">
              {printableDoc.reference && (
                <p className="font-mono font-semibold text-sm text-slate-900">{printableDoc.reference}</p>
              )}
              <p className="mt-1">Date : {formatDateFR(printableDoc.date)}</p>
              <p className="mt-0.5 font-medium text-slate-800">{printableDoc.practitionerName}</p>
            </div>
          </div>

          {/* Document Title */}
          <div className="my-6">
            <h2 className="text-lg font-bold text-slate-900 uppercase tracking-wide">
              {printableDoc.title}
            </h2>
            {printableDoc.subtitle && (
              <p className="text-xs text-slate-500 mt-0.5">{printableDoc.subtitle}</p>
            )}
          </div>

          {/* Patient Block */}
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5 sm:p-4 text-xs">
            <div className="min-w-0">
              <p className="text-slate-500">Patient(e)</p>
              <p className="font-semibold text-sm text-slate-900 mt-0.5">{printableDoc.patientName}</p>
              {printableDoc.patientCin && <p className="text-slate-600 mt-0.5">CIN : {printableDoc.patientCin}</p>}
              {printableDoc.patientPhone && <p className="text-slate-600">Tél : {printableDoc.patientPhone}</p>}
            </div>
            <div className="min-w-0">
              <p className="text-slate-500">Couverture Médicale / Mutuelle</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {printableDoc.patientInsurance || 'Aucune'}
              </p>
              {printableDoc.patientInsuranceNumber && (
                <p className="text-slate-600 mt-0.5 font-mono break-all">
                  N° Immatriculation : {printableDoc.patientInsuranceNumber}
                </p>
              )}
            </div>
          </div>

          {/* Items table for quotes / invoices / care-sheets */}
          {printableDoc.items && printableDoc.items.length > 0 && (
            <div className="mb-6 overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[440px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-slate-600">
                    <th className="py-2 pr-2 font-semibold">Acte / Désignation</th>
                    <th className="py-2 px-2 font-semibold text-center">Dent</th>
                    <th className="py-2 px-2 font-semibold text-right">Qté</th>
                    <th className="py-2 px-2 font-semibold text-right">PU (MAD)</th>
                    <th className="py-2 pl-2 font-semibold text-right">Total (MAD)</th>
                  </tr>
                </thead>
                <tbody>
                  {printableDoc.items.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className="py-2.5 pr-2 text-slate-900">{item.label}</td>
                      <td className="py-2.5 px-2 text-center font-mono text-slate-600">{item.tooth || '—'}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{item.qty}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">{formatMAD(item.unitPrice)}</td>
                      <td className="py-2.5 pl-2 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                        {formatMAD(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Totals block */}
          {typeof printableDoc.totalAmount === 'number' && (
            <div className="ml-auto w-full sm:w-72 space-y-1.5 border-t border-slate-300 pt-3 text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-600">Montant Total</span>
                <span className="font-mono font-semibold text-slate-900">
                  {formatMAD(printableDoc.totalAmount)}
                </span>
              </div>
              {typeof printableDoc.insuranceShare === 'number' && printableDoc.insuranceShare > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Part Mutuelle estimée</span>
                  <span className="font-mono text-slate-700">{formatMAD(printableDoc.insuranceShare)}</span>
                </div>
              )}
              {typeof printableDoc.patientShare === 'number' && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Part Patient</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {formatMAD(printableDoc.patientShare)}
                  </span>
                </div>
              )}
              {typeof printableDoc.paidAmount === 'number' ? (
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-600">
                    Montant réglé {printableDoc.paymentMethod ? `(${printableDoc.paymentMethod})` : ''}
                  </span>
                  <span className="font-mono font-bold text-emerald-700">
                    {formatMAD(printableDoc.paidAmount)}
                  </span>
                </div>
              ) : printableDoc.paymentMethod ? (
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-600">Moyen de paiement</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {printableDoc.paymentMethod}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Prescriptions */}
          {printableDoc.prescriptions && printableDoc.prescriptions.length > 0 && (
            <div className="my-6 space-y-3">
              {printableDoc.prescriptions.map((line, i) => (
                <div key={i} className="border-b border-slate-100 pb-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {i + 1}. {line.molecule}
                  </p>
                  <p className="text-xs text-slate-700 mt-1">
                    Posologie : {line.dosage} · {line.frequency} · Pendant {line.duration}
                  </p>
                  {line.notes && <p className="text-xs text-slate-500 mt-0.5 italic">{line.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Body text */}
          {printableDoc.bodyText && (
            <div className="my-6 space-y-1.5">
              {(printableDoc.kind === 'fee-note' || printableDoc.kind === 'care-sheet') && (
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Détail des actes figurant sur le document
                </p>
              )}
              <div className="whitespace-pre-line text-sm leading-relaxed text-slate-800">
                {printableDoc.bodyText}
              </div>
            </div>
          )}

          {/* Consent clause */}
          {printableDoc.consentText && (
            <div className="mt-8 rounded-lg border border-slate-300 p-4 text-xs text-slate-700 leading-relaxed">
              <p className="font-semibold text-slate-900 mb-1">Clause de consentement éclairé</p>
              <p>{printableDoc.consentText}</p>
              <div className="mt-6 flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-slate-200">
                <span>Date et signature du patient (Lu et approuvé) :</span>
                <span>Cachet et signature du praticien :</span>
              </div>
            </div>
          )}

          {/* Fiscal footer */}
          <div className="mt-10 border-t border-slate-200 pt-3 text-[11px] text-slate-500 flex flex-wrap justify-between gap-2 tabular-nums">
            <span>
              ICE : {clinicSettings?.ice || '—'} · IF : {clinicSettings?.ifNumber || '—'} · Patente :{' '}
              {clinicSettings?.patente || '—'} · INPE : {clinicSettings?.inpe || '—'}
            </span>
            <span>{clinicName}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
