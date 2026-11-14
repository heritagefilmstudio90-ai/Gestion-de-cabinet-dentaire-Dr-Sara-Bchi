import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, Clock, Sparkles, X } from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { addDaysISO, formatDateFR, generateSafeId, todayISO } from '../lib/formatters';
import { Appointment, AppointmentStatus, ClinicSettings, Patient } from '../types/dental';

interface QuickAppointmentModalProps {
  patient: Patient | null;
  onClose: () => void;
}

const STATUS_OPTIONS: AppointmentStatus[] = [
  'Confirmé',
  'En attente',
  "Arrivé en salle d'attente",
  'Au fauteuil',
];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function minutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function findNextAvailableSlot(params: {
  appointments: Appointment[];
  practitionerId: string;
  chair: string;
  durationMinutes: number;
  workingHours?: ClinicSettings['workingHours'];
}): { date: string; startTime: string } {
  const { appointments, practitionerId, chair, durationMinutes, workingHours } = params;
  const duration = Math.max(15, durationMinutes || 30);

  const openStartMin = toMinutes(workingHours?.start || '09:00');
  const openEndMin = toMinutes(workingHours?.end || '18:00');
  const lunchStartMin = toMinutes(workingHours?.lunchStart || '13:00');
  const lunchEndMin = toMinutes(workingHours?.lunchEnd || '15:00');
  const satStartMin = toMinutes(workingHours?.saturdayStart || '09:00');
  const satEndMin = toMinutes(workingHours?.saturdayEnd || '13:00');

  const today = todayISO();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (let offset = 0; offset < 21; offset++) {
    const dateIso = addDaysISO(today, offset);
    const dayOfWeek = new Date(`${dateIso}T00:00:00`).getDay();
    if (dayOfWeek === 0) continue; // Dimanche fermé

    const windows: Array<[number, number]> =
      dayOfWeek === 6
        ? [[satStartMin, satEndMin]]
        : [
            [openStartMin, lunchStartMin],
            [lunchEndMin, openEndMin],
          ];

    const dayBlockingApts = appointments
      .filter(
        (apt) =>
          apt.date === dateIso &&
          apt.status !== 'Annulé' &&
          apt.status !== 'Absent' &&
          (apt.practitionerId === practitionerId || apt.chair === chair)
      )
      .map((apt) => {
        const s = toMinutes(apt.startTime);
        return { start: s, end: s + (apt.durationMinutes || 30) };
      });

    const minStartToday = offset === 0 ? Math.ceil((nowMinutes + 5) / 30) * 30 : 0;

    for (const [winStart, winEnd] of windows) {
      if (winEnd - winStart < duration) continue;
      let cursor = Math.max(winStart, minStartToday);
      // Align cursor on 30-min grid relative to window start
      const rem = (cursor - winStart) % 30;
      if (rem > 0) cursor += 30 - rem;

      while (cursor + duration <= winEnd) {
        const slotEnd = cursor + duration;
        const hasOverlap = dayBlockingApts.some(
          (blk) => blk.start < slotEnd && cursor < blk.end
        );
        if (!hasOverlap) {
          return { date: dateIso, startTime: minutesToHHMM(cursor) };
        }
        cursor += 30;
      }
    }
  }

  return { date: addDaysISO(today, 1), startTime: workingHours?.start || '09:00' };
}

export const QuickAppointmentModal: React.FC<QuickAppointmentModalProps> = ({
  patient,
  onClose,
}) => {
  const {
    user,
    actualRole,
    staffProfile,
    staffList,
    appointments,
    actsCatalog,
    clinicSettings,
    openAgendaAt,
    saveRecord,
    showToast,
  } = useClinic();

  const practitioners = useMemo(() => {
    const activeDocs = staffList.filter(
      (s) => s.active && (s.role === 'titulaire' || s.role === 'collaborateur')
    );
    if (actualRole === 'collaborateur' && user) {
      return activeDocs.filter((s) => s.uid === user.uid);
    }
    return activeDocs;
  }, [staffList, actualRole, user]);

  const primaryPractitioner = useMemo(() => {
    if (actualRole === 'collaborateur' && staffProfile) {
      return staffProfile;
    }
    return (
      practitioners.find((p) => p.role === 'titulaire') ||
      practitioners[0] ||
      staffProfile ||
      null
    );
  }, [actualRole, practitioners, staffProfile]);

  const chairs = clinicSettings?.chairs?.length
    ? clinicSettings.chairs
    : ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3'];

  const defaultAct = useMemo(() => {
    return (
      actsCatalog.find((a) => a.name.toLowerCase().includes('consultation')) ||
      actsCatalog[0]
    );
  }, [actsCatalog]);

  const [practitionerId, setPractitionerId] = useState('');
  const [chair, setChair] = useState(chairs[0]);
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [actType, setActType] = useState('Consultation & Bilan complet');
  const [status, setStatus] = useState<AppointmentStatus>('Confirmé');
  const [isUrgent, setIsUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!patient) return;
    const pracId = primaryPractitioner?.uid || user?.uid || '';
    const defaultChair = primaryPractitioner?.chairName || chairs[0] || 'Fauteuil 1';
    const actName = defaultAct?.name || 'Consultation & Bilan complet';
    const duration = defaultAct?.defaultDuration || 30;

    const nextSlot = findNextAvailableSlot({
      appointments,
      practitionerId: pracId,
      chair: defaultChair,
      durationMinutes: duration,
      workingHours: clinicSettings?.workingHours,
    });

    setPractitionerId(pracId);
    setChair(defaultChair);
    setActType(actName);
    setDurationMinutes(duration);
    setDate(nextSlot.date);
    setStartTime(nextSlot.startTime);
    setStatus('Confirmé');
    setIsUrgent(false);
    setNotes('');
    setSubmitting(false);
    // Re-initialize only when target patient changes (modal opened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  useEffect(() => {
    if (!patient || practitionerId) return;
    if (primaryPractitioner?.uid) {
      setPractitionerId(primaryPractitioner.uid);
      if (primaryPractitioner.chairName) {
        setChair(primaryPractitioner.chairName);
      }
    }
  }, [patient, practitionerId, primaryPractitioner]);

  useEffect(() => {
    if (!patient) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [patient, onClose]);

  const conflictingAppointment = useMemo(() => {
    if (!patient || !date || !startTime) return null;
    const candStart = toMinutes(startTime);
    const candEnd = candStart + (durationMinutes || 30);
    return (
      appointments.find((apt) => {
        if (apt.date !== date) return false;
        if (apt.status === 'Annulé' || apt.status === 'Absent') return false;
        if (apt.practitionerId !== practitionerId && apt.chair !== chair) return false;
        const aptStart = toMinutes(apt.startTime);
        const aptEnd = aptStart + (apt.durationMinutes || 30);
        return aptStart < candEnd && candStart < aptEnd;
      }) || null
    );
  }, [patient, appointments, date, startTime, durationMinutes, practitionerId, chair]);

  if (!patient) return null;

  const handleRecalculateNextSlot = (
    targetPracId = practitionerId,
    targetChair = chair,
    targetDuration = durationMinutes
  ) => {
    const nextSlot = findNextAvailableSlot({
      appointments,
      practitionerId: targetPracId,
      chair: targetChair,
      durationMinutes: targetDuration,
      workingHours: clinicSettings?.workingHours,
    });
    setDate(nextSlot.date);
    setStartTime(nextSlot.startTime);
  };

  const handleSave = async (navigateToAgenda: boolean) => {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      const prac =
        practitioners.find((p) => p.uid === practitionerId) || primaryPractitioner;
      const act = actsCatalog.find((a) => a.name === actType);
      const effectivePracId =
        actualRole === 'collaborateur'
          ? user.uid
          : prac?.uid || practitionerId || user.uid;
      const effectivePracName = prac?.displayName || 'Dr. Sara Bchi';

      const newAptId = generateSafeId('apt');
      await saveRecord(
        'appointments',
        newAptId,
        {
          patientId: patient.id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientPhone: patient.phone || '',
          practitionerId: effectivePracId,
          practitionerName: effectivePracName,
          chair: chair || 'Fauteuil 1',
          date,
          startTime,
          durationMinutes: Number(durationMinutes) || 30,
          actType: actType || 'Consultation & Bilan complet',
          categoryColor: act?.color || '#0284C7',
          status,
          arrivedAt:
            status === "Arrivé en salle d'attente" ? new Date().toISOString() : '',
          notes: notes.trim().slice(0, 500),
          isUrgent,
          reminderStatus: 'Non envoyé',
          createdBy: user.uid,
        },
        true
      );

      showToast(
        `Rendez-vous confirmé pour ${patient.firstName} ${patient.lastName} le ${formatDateFR(date)} à ${startTime}.`,
        'success'
      );
      onClose();
      if (navigateToAgenda) {
        openAgendaAt(date, newAptId);
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Impossible de créer le rendez-vous.',
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/75 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-apt-title"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-[#1598C7] dark:text-sky-400">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="quick-apt-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Prendre Rendez-vous
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Création rapide d'un créneau agenda
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Selected Patient Summary */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {patient.firstName} {patient.lastName}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              {patient.fileNumber} · {patient.phone} · {patient.insuranceType}
            </p>
          </div>
          {patient.hasCriticalAlert && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Alerte médicale</span>
            </span>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave(false);
          }}
          className="mt-4 space-y-3.5 text-xs"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">
                Praticien
              </label>
              <select
                value={practitionerId}
                disabled={actualRole === 'collaborateur'}
                onChange={(e) => {
                  const nextId = e.target.value;
                  const nextPrac = practitioners.find((p) => p.uid === nextId);
                  const nextChair = nextPrac?.chairName || chair;
                  setPractitionerId(nextId);
                  if (nextPrac?.chairName) setChair(nextPrac.chairName);
                  handleRecalculateNextSlot(nextId, nextChair, durationMinutes);
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none disabled:opacity-70"
              >
                {practitioners.length > 0 ? (
                  practitioners.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.displayName}
                    </option>
                  ))
                ) : (
                  <option value={primaryPractitioner?.uid || user?.uid || ''}>
                    {primaryPractitioner?.displayName || 'Dr. Sara Bchi'}
                  </option>
                )}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">
                Fauteuil
              </label>
              <select
                value={chair}
                onChange={(e) => setChair(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {chairs.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-[#1598C7] dark:text-sky-400" />
                <span>Créneau horaire</span>
              </span>
              <button
                type="button"
                onClick={() => handleRecalculateNextSlot()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1598C7] dark:text-sky-400 hover:underline whitespace-nowrap"
              >
                <Sparkles className="h-3 w-3" />
                <span>Prochain créneau libre</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Date du rendez-vous"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                aria-label="Heure du rendez-vous"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              />
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                aria-label="Durée du rendez-vous"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {[15, 30, 45, 60, 90, 120].map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </div>
          </div>

          {conflictingAppointment && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
              <span>
                Chevauchement détecté avec{' '}
                <strong>{conflictingAppointment.patientName}</strong> (
                <span className="font-mono tabular-nums">
                  {conflictingAppointment.startTime}
                </span>
                ).
              </span>
              <button
                type="button"
                onClick={() => handleRecalculateNextSlot()}
                className="font-semibold underline hover:no-underline whitespace-nowrap"
              >
                Décaler au prochain libre
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">
                Type d'acte
              </label>
              <select
                value={actType}
                onChange={(e) => {
                  const nextActName = e.target.value;
                  const act = actsCatalog.find((a) => a.name === nextActName);
                  setActType(nextActName);
                  if (act?.defaultDuration) {
                    setDurationMinutes(act.defaultDuration);
                  }
                }}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {actsCatalog.length > 0 ? (
                  actsCatalog.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name} ({a.defaultDuration} min)
                    </option>
                  ))
                ) : (
                  <option value="Consultation & Bilan complet">
                    Consultation & Bilan complet (30 min)
                  </option>
                )}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">
                Statut initial
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={isUrgent}
              onChange={(e) => setIsUrgent(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            <span>Créneau d'urgence clinique</span>
          </label>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">
              Notes / Motif rapide
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Précisions pour l'accueil ou le praticien..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSave(true)}
              className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-3.5 py-2 font-medium text-[#163B63] dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 disabled:opacity-60 whitespace-nowrap"
            >
              Enregistrer & Voir l'agenda
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#163B63] dark:bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-[#0F2C4C] dark:hover:bg-sky-500 disabled:opacity-60 whitespace-nowrap"
            >
              {submitting ? 'Enregistrement...' : 'Confirmer le rendez-vous'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
