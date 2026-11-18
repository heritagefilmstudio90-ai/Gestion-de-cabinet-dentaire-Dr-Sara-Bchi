import React, { useMemo, useState } from 'react';
import { Check, FileText, Layers, Plus, Printer, Trash2, X } from 'lucide-react';
import { formatMAD, generateSafeId } from '../lib/formatters';
import {
  CatalogAct,
  Patient,
  TOOTH_STATUS_META,
  ToothRecord,
  ToothStatus,
  TreatmentPlanItem,
} from '../types/dental';

interface OdontogramQuoteModalProps {
  patient: Patient;
  selectedTeeth: string[];
  odontogram: Record<string, ToothRecord>;
  actsCatalog: CatalogAct[];
  canSaveQuote: boolean;
  practitionerName: string;
  onSaveAndPrint: (payload: { title: string; items: TreatmentPlanItem[] }) => Promise<void>;
  onPrintOnly: (title: string, items: TreatmentPlanItem[]) => void;
  onClose: () => void;
}

const PHASES: TreatmentPlanItem['phase'][] = [
  'Phase 1 : Assainissement',
  'Phase 2 : Soins chirurgicaux',
  'Phase 3 : Réhabilitation prothétique',
];

function inferPhaseForToothStatus(status: ToothStatus): TreatmentPlanItem['phase'] {
  if (
    status === 'couronne' ||
    status === 'implant' ||
    status === 'bridge' ||
    status === 'inlay_onlay'
  ) {
    return 'Phase 3 : Réhabilitation prothétique';
  }
  if (
    status === 'devitalisee' ||
    status === 'resection_apicale' ||
    status === 'manquante' ||
    status === 'incluse'
  ) {
    return 'Phase 2 : Soins chirurgicaux';
  }
  return 'Phase 1 : Assainissement';
}

function matchCatalogActForTooth(
  status: ToothStatus,
  actsCatalog: CatalogAct[]
): CatalogAct | undefined {
  if (actsCatalog.length === 0) return undefined;
  const keywordMap: Record<ToothStatus, string[]> = {
    carie: ['composite', 'carie', 'obturation', 'soin'],
    composite: ['composite', 'obturation'],
    amalgame: ['amalgame', 'composite', 'obturation'],
    devitalisee: ['endodont', 'dévitalis', 'traitement canalaire', 'endo'],
    inlay_onlay: ['inlay', 'onlay', 'céramique'],
    couronne: ['couronne', 'zircone', 'céramo'],
    implant: ['implant'],
    bridge: ['bridge', 'prothèse'],
    resection_apicale: ['résection', 'apicale', 'chirurg'],
    manquante: ['implant', 'prothèse', 'bridge', 'extraction'],
    incluse: ['incluse', 'extraction', 'chirurg'],
    sain: ['consultation', 'détartrage', 'bilan'],
  };

  const keywords = keywordMap[status] || [];
  for (const kw of keywords) {
    const found = actsCatalog.find(
      (a) => a.name.toLowerCase().includes(kw) || a.category.toLowerCase().includes(kw)
    );
    if (found) return found;
  }
  return actsCatalog[0];
}

export const OdontogramQuoteModal: React.FC<OdontogramQuoteModalProps> = ({
  patient,
  selectedTeeth,
  odontogram,
  actsCatalog,
  canSaveQuote,
  practitionerName,
  onSaveAndPrint,
  onPrintOnly,
  onClose,
}) => {
  const sortedTeeth = useMemo(
    () => [...selectedTeeth].sort((a, b) => Number(a) - Number(b)),
    [selectedTeeth]
  );

  const defaultTitle =
    sortedTeeth.length > 1
      ? `Devis récapitulatif · Dents ${sortedTeeth.join(', ')}`
      : `Devis dentaire · Dent #${sortedTeeth[0] || ''}`;

  const [title, setTitle] = useState(defaultTitle);
  const [bulkActId, setBulkActId] = useState<string>(actsCatalog[0]?.id || '');
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<TreatmentPlanItem[]>(() =>
    sortedTeeth.map((toothId) => {
      const rec = odontogram[toothId];
      const status: ToothStatus = rec?.status || 'sain';
      const faceCodes = Object.entries(rec?.faces || {})
        .filter(([, fStatus]) => Boolean(fStatus) && fStatus !== 'sain')
        .map(([face]) => face)
        .join('');
      const effectiveStatus: ToothStatus =
        status === 'sain' && faceCodes
          ? (Object.values(rec?.faces || {}).find((s) => s && s !== 'sain') as ToothStatus) || 'carie'
          : status;
      const matchedAct = matchCatalogActForTooth(effectiveStatus, actsCatalog);

      return {
        id: generateSafeId('qit'),
        phase: inferPhaseForToothStatus(effectiveStatus),
        tooth: toothId,
        faces: faceCodes || undefined,
        actCode: matchedAct?.code || 'C01',
        actName: matchedAct?.name || 'Consultation & Bilan complet',
        unitPrice: matchedAct?.defaultPrice ?? 300,
        quantity: 1,
        discount: 0,
        status: 'Prévu',
      };
    })
  );

  const totalAmount = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + Math.max(0, Number(it.unitPrice || 0) * Number(it.quantity || 1) - Number(it.discount || 0)),
        0
      ),
    [items]
  );

  const coverageRate = Number(patient.coverageRate || 0);
  const insuranceShare = Math.round((totalAmount * coverageRate) / 100);
  const patientShare = Math.max(0, totalAmount - insuranceShare);

  const applyActToAllRows = () => {
    const act = actsCatalog.find((a) => a.id === bulkActId);
    if (!act) return;
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        actCode: act.code,
        actName: act.name,
        unitPrice: act.defaultPrice,
      }))
    );
  };

  const updateItem = (id: string, patch: Partial<TreatmentPlanItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const addExtraLine = () => {
    if (items.length >= 40) return;
    const firstAct = actsCatalog[0];
    setItems((prev) => {
      if (prev.length >= 40) return prev;
      return [
        ...prev,
        {
          id: generateSafeId('qit'),
          phase: PHASES[0],
          tooth: sortedTeeth[0] || '',
          actCode: firstAct?.code || 'C01',
          actName: firstAct?.name || 'Consultation & Bilan complet',
          unitPrice: firstAct?.defaultPrice ?? 300,
          quantity: 1,
          discount: 0,
          status: 'Prévu',
        },
      ];
    });
  };

  const handleSaveAndPrint = async () => {
    if (items.length === 0 || saving) return;
    setSaving(true);
    try {
      await onSaveAndPrint({
        title: title.trim() || defaultTitle,
        items,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/60 dark:bg-black/75 p-3 sm:p-4 pt-safe pb-safe overflow-y-auto">
      <div className="my-auto w-full max-w-4xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden max-h-[92dvh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 shrink-0">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                Devis récapitulatif · Odontogramme FDI ({sortedTeeth.length} dent{sortedTeeth.length > 1 ? 's' : ''})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {patient.fullName || `${patient.firstName} ${patient.lastName}`} · Dossier {patient.fileNumber} · {practitionerName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto text-xs">
          {/* Quote Title + Bulk Act Selector */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5">
            <div className="md:col-span-6">
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Intitulé du devis récapitulatif
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={175}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="md:col-span-6 flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Appliquer un même acte à toutes les dents
                </label>
                <select
                  value={bulkActId}
                  onChange={(e) => setBulkActId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
                >
                  {actsCatalog.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name} ({formatMAD(a.defaultPrice)})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={applyActToAllRows}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                <span>Appliquer à tout</span>
              </button>
            </div>
          </div>

          {/* Items Table */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2.5 font-medium">Dent</th>
                  <th className="px-3 py-2.5 font-medium">État FDI</th>
                  <th className="px-3 py-2.5 font-medium">Phase</th>
                  <th className="px-3 py-2.5 font-medium">Acte du catalogue</th>
                  <th className="px-3 py-2.5 font-medium text-right">PU (MAD)</th>
                  <th className="px-3 py-2.5 font-medium text-right">Qté</th>
                  <th className="px-3 py-2.5 font-medium text-right">Remise</th>
                  <th className="px-3 py-2.5 font-medium text-right">Sous-total</th>
                  <th className="px-2 py-2.5 text-center" aria-label="Retirer" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      Aucune ligne dans le devis. Ajoutez une ligne pour générer le devis.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const toothRec = item.tooth ? odontogram[item.tooth] : undefined;
                    const stMeta = TOOTH_STATUS_META[toothRec?.status || 'sain'];
                    const lineTotal = Math.max(
                      0,
                      Number(item.unitPrice || 0) * Number(item.quantity || 1) - Number(item.discount || 0)
                    );
                    const matchedCatalog = actsCatalog.find(
                      (a) => a.name === item.actName && a.code === item.actCode
                    );

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                        <td className="px-3 py-2">
                          <input
                            value={item.tooth}
                            onChange={(e) => updateItem(item.id, { tooth: e.target.value })}
                            className="w-14 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 font-mono font-semibold text-center text-slate-900 dark:text-slate-100 tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <span
                              className="h-2 w-2 rounded-sm shrink-0"
                              style={{ backgroundColor: stMeta.color }}
                            />
                            <span>{stMeta.label}</span>
                            {item.faces && (
                              <span className="font-mono text-[10px] text-slate-400">({item.faces})</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={item.phase}
                            onChange={(e) =>
                              updateItem(item.id, {
                                phase: e.target.value as TreatmentPlanItem['phase'],
                              })
                            }
                            className="w-40 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] text-slate-800 dark:text-slate-200"
                          >
                            {PHASES.map((ph) => (
                              <option key={ph} value={ph}>
                                {ph}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 min-w-[200px]">
                          <select
                            value={matchedCatalog?.id || ''}
                            onChange={(e) => {
                              const act = actsCatalog.find((a) => a.id === e.target.value);
                              if (!act) return;
                              updateItem(item.id, {
                                actCode: act.code,
                                actName: act.name,
                                unitPrice: act.defaultPrice,
                              });
                            }}
                            className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-900 dark:text-slate-100"
                          >
                            {!matchedCatalog && (
                              <option value="">
                                {item.actCode} — {item.actName}
                              </option>
                            )}
                            {actsCatalog.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name} ({formatMAD(a.defaultPrice)})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            value={item.unitPrice}
                            onChange={(e) =>
                              updateItem(item.id, { unitPrice: Math.max(0, Number(e.target.value)) })
                            }
                            className="w-24 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(item.id, { quantity: Math.max(1, Number(e.target.value)) })
                            }
                            className="w-14 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            value={item.discount}
                            onChange={(e) =>
                              updateItem(item.id, { discount: Math.max(0, Number(e.target.value)) })
                            }
                            className="w-20 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                          {formatMAD(lineTotal)}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            title="Retirer cette ligne"
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 hover:text-rose-600 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <button
              type="button"
              disabled={items.length >= 40 || saving}
              onClick={addExtraLine}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>
                {items.length >= 40 ? 'Maximum 40 actes atteint' : 'Ajouter un acte complémentaire'}
              </span>
            </button>

            <div className="w-full sm:w-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-1.5 tabular-nums">
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Nombre d&apos;actes prévus</span>
                <span className="font-mono font-semibold">{items.length}</span>
              </div>
              <div className="flex justify-between text-slate-900 dark:text-slate-100 text-sm font-bold pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>Total Devis</span>
                <span className="font-mono">{formatMAD(totalAmount)}</span>
              </div>
              {coverageRate > 0 && (
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Part Mutuelle ({patient.insuranceType} · {coverageRate}%)</span>
                  <span className="font-mono">{formatMAD(insuranceShare)}</span>
                </div>
              )}
              <div className="flex justify-between text-sky-700 dark:text-sky-400 font-semibold">
                <span>Reste à charge Patient</span>
                <span className="font-mono">{formatMAD(patientShare)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Annuler
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={items.length === 0 || saving}
              onClick={() => onPrintOnly(title.trim() || defaultTitle, items)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Imprimer l&apos;aperçu A4</span>
            </button>
            {canSaveQuote && (
              <button
                type="button"
                disabled={items.length === 0 || saving}
                onClick={handleSaveAndPrint}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163B63] dark:bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span>{saving ? 'Enregistrement...' : 'Enregistrer le devis & Imprimer'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
