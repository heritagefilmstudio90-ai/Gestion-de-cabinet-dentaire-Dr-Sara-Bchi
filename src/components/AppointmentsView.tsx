import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Search,
  Trash2,
  UserCheck,
  X,
  CheckCircle2,
  AlertCircle,
  Phone,
} from 'lucide-react';
import { useClinic } from '../context/ClinicContext';
import { addDaysISO, computeWaitingMinutes, formatDateFR, generateSafeId, todayISO } from '../lib/formatters';
import { Appointment, AppointmentStatus } from '../types/dental';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function formatHourSlot(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

const STATUS_OPTIONS: AppointmentStatus[] = [
  'En attente',
  'Confirmé',
  "Arrivé en salle d'attente",
  'Au fauteuil',
  'Terminé',
  'Absent',
  'Annulé',
];

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  'En attente': 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
  Confirmé: 'text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800',
  "Arrivé en salle d'attente": 'text-sky-800 dark:text-sky-200 bg-sky-50 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800',
  'Au fauteuil': 'text-indigo-800 dark:text-indigo-200 bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800',
  Terminé: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
  Absent: 'text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-800',
  Annulé: 'text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800',
};

export const AppointmentsView: React.FC = () => {
  const {
    user,
    actualRole,
    staffList,
    patients,
    appointments,
    bookingRequests,
    actsCatalog,
    clinicSettings,
    permissions,
    agendaFocus,
    clearAgendaFocus,
    saveRecord,
    removeRecord,
    openPatientFile,
    showToast,
  } = useClinic();

  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [viewMode, setViewMode] = useState<'jour' | 'semaine' | 'mois' | 'prereservations'>('jour');
  const [groupBy, setGroupBy] = useState<'practitioner' | 'chair'>('practitioner');
  const [filterPractitioner, setFilterPractitioner] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAptId, setSelectedAptId] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);
  const [confirmDeleteAptId, setConfirmDeleteAptId] = useState<string | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);

  useEffect(() => {
    if (!agendaFocus) return;
    setSelectedDate(agendaFocus.date);
    setViewMode('jour');
    if (agendaFocus.appointmentId) {
      setSelectedAptId(agendaFocus.appointmentId);
    }
    clearAgendaFocus();
  }, [agendaFocus, clearAgendaFocus]);

  useEffect(() => {
    setConfirmDeleteAptId(null);
  }, [selectedAptId, selectedDate]);

  const [formState, setFormState] = useState({
    patientId: '',
    practitionerId: '',
    chair: clinicSettings?.chairs?.[0] || 'Fauteuil 1',
    date: todayISO(),
    startTime: '09:00',
    durationMinutes: 30,
    actType: actsCatalog[0]?.name || 'Consultation & Bilan complet',
    status: 'Confirmé' as AppointmentStatus,
    notes: '',
    isUrgent: false,
  });

  const [bookingForm, setBookingForm] = useState({
    patientName: '',
    phone: '',
    preferredDate: addDaysISO(todayISO(), 1),
    preferredSlot: 'Matin (09:00 - 13:00)',
    reason: '',
  });

  const practitioners = useMemo(
    () =>
      staffList.filter(
        (s) => s.active && (s.role === 'titulaire' || s.role === 'collaborateur')
      ),
    [staffList]
  );

  const chairs = clinicSettings?.chairs || ['Fauteuil 1', 'Fauteuil 2', 'Fauteuil 3'];

  const filteredAppointments = useMemo(() => {
    return appointments.filter((apt) => {
      if (filterPractitioner !== 'all' && apt.practitionerId !== filterPractitioner) return false;
      if (filterStatus !== 'all' && apt.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (
          !apt.patientName.toLowerCase().includes(q) &&
          !apt.actType.toLowerCase().includes(q) &&
          !apt.practitionerName.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [appointments, filterPractitioner, filterStatus, searchQuery]);

  const dayAppointments = useMemo(
    () =>
      filteredAppointments
        .filter((a) => a.date === selectedDate)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [filteredAppointments, selectedDate]
  );

  const selectedApt = useMemo(
    () => appointments.find((a) => a.id === selectedAptId) || dayAppointments[0] || null,
    [appointments, selectedAptId, dayAppointments]
  );

  const conflictingModalApt = useMemo(() => {
    if (!showModal || !formState.date || !formState.startTime) return null;
    const candStart = toMinutes(formState.startTime);
    const candEnd = candStart + (Number(formState.durationMinutes) || 30);
    return (
      appointments.find((apt) => {
        if (editingApt && apt.id === editingApt.id) return false;
        if (apt.date !== formState.date) return false;
        if (apt.status === 'Annulé' || apt.status === 'Absent') return false;
        if (
          apt.practitionerId !== formState.practitionerId &&
          apt.chair !== formState.chair
        ) {
          return false;
        }
        const aptStart = toMinutes(apt.startTime);
        const aptEnd = aptStart + (apt.durationMinutes || 30);
        return aptStart < candEnd && candStart < aptEnd;
      }) || null
    );
  }, [showModal, editingApt, appointments, formState.date, formState.startTime, formState.durationMinutes, formState.practitionerId, formState.chair]);

  const openNewAppointmentModal = (prefillDate?: string, prefillTime?: string, prefillPractitioner?: string) => {
    const firstPatient = patients[0];
    const effectivePrac =
      actualRole === 'collaborateur' && user
        ? practitioners.find((p) => p.uid === user.uid)
        : practitioners.find((p) => p.uid === prefillPractitioner) || practitioners[0];
    setEditingApt(null);
    setFormState({
      patientId: firstPatient?.id || '',
      practitionerId:
        actualRole === 'collaborateur' && user
          ? user.uid
          : prefillPractitioner || effectivePrac?.uid || user?.uid || '',
      chair: effectivePrac?.chairName || chairs[0] || 'Fauteuil 1',
      date: prefillDate || selectedDate,
      startTime: prefillTime || '09:00',
      durationMinutes: actsCatalog[0]?.defaultDuration || 30,
      actType: actsCatalog[0]?.name || 'Consultation & Bilan complet',
      status: 'Confirmé',
      notes: '',
      isUrgent: false,
    });
    setShowModal(true);
  };

  const openEditAppointmentModal = (apt: Appointment) => {
    setEditingApt(apt);
    setFormState({
      patientId: apt.patientId,
      practitionerId: apt.practitionerId,
      chair: apt.chair,
      date: apt.date,
      startTime: apt.startTime,
      durationMinutes: apt.durationMinutes,
      actType: apt.actType,
      status: apt.status,
      notes: apt.notes || '',
      isUrgent: apt.isUrgent,
    });
    setShowModal(true);
  };

  const handleSaveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const pat = patients.find((p) => p.id === formState.patientId);
    const effectivePracId =
      actualRole === 'collaborateur' ? user.uid : formState.practitionerId || user.uid;
    const prac = practitioners.find((s) => s.uid === effectivePracId);
    const act = actsCatalog.find((a) => a.name === formState.actType);
    if (!pat && !editingApt) {
      showToast('Veuillez sélectionner un patient.', 'error');
      return;
    }

    const computedArrivedAt =
      formState.status === "Arrivé en salle d'attente" && !editingApt?.arrivedAt
        ? new Date().toISOString()
        : editingApt?.arrivedAt || '';

    if (editingApt) {
      let updatePayload: Record<string, unknown>;
      if (actualRole === 'collaborateur') {
        updatePayload = {
          date: formState.date,
          startTime: formState.startTime,
          durationMinutes: Number(formState.durationMinutes),
          actType: formState.actType,
          status: formState.status,
          arrivedAt: computedArrivedAt,
          notes: formState.notes,
        };
      } else if (actualRole === 'secretaire') {
        updatePayload = {
          practitionerId: prac?.uid || effectivePracId,
          practitionerName: prac?.displayName || editingApt.practitionerName || 'Dr. Sara Bchi',
          chair: formState.chair,
          date: formState.date,
          startTime: formState.startTime,
          durationMinutes: Number(formState.durationMinutes),
          actType: formState.actType,
          categoryColor: act?.color || editingApt.categoryColor || '#0284C7',
          status: formState.status,
          arrivedAt: computedArrivedAt,
          notes: formState.notes,
          isUrgent: formState.isUrgent,
          reminderStatus: editingApt.reminderStatus || 'Non envoyé',
        };
      } else {
        updatePayload = {
          patientId: pat?.id || editingApt.patientId,
          patientName: pat ? `${pat.firstName} ${pat.lastName}` : editingApt.patientName,
          patientPhone: pat ? pat.phone : editingApt.patientPhone,
          practitionerId: prac?.uid || effectivePracId,
          practitionerName: prac?.displayName || 'Dr. Sara Bchi',
          chair: formState.chair,
          date: formState.date,
          startTime: formState.startTime,
          durationMinutes: Number(formState.durationMinutes),
          actType: formState.actType,
          categoryColor: act?.color || '#0284C7',
          status: formState.status,
          arrivedAt: computedArrivedAt,
          notes: formState.notes,
          isUrgent: formState.isUrgent,
          reminderStatus: editingApt.reminderStatus || 'Non envoyé',
        };
      }
      await saveRecord('appointments', editingApt.id, updatePayload, false);
      showToast('Rendez-vous mis à jour.', 'success');
    } else if (pat) {
      const createPayload: Record<string, unknown> = {
        patientId: pat.id,
        patientName: `${pat.firstName} ${pat.lastName}`,
        patientPhone: pat.phone,
        practitionerId: prac?.uid || effectivePracId,
        practitionerName: prac?.displayName || 'Dr. Sara Bchi',
        chair: formState.chair,
        date: formState.date,
        startTime: formState.startTime,
        durationMinutes: Number(formState.durationMinutes),
        actType: formState.actType,
        categoryColor: act?.color || '#0284C7',
        status: formState.status,
        arrivedAt: computedArrivedAt,
        notes: formState.notes,
        isUrgent: formState.isUrgent,
        reminderStatus: 'Non envoyé',
        createdBy: user.uid,
      };
      await saveRecord('appointments', generateSafeId('apt'), createPayload, true);
      showToast('Nouveau rendez-vous enregistré.', 'success');
    }
    setShowModal(false);
  };

  const handleStatusChange = async (apt: Appointment, nextStatus: AppointmentStatus) => {
    if (!permissions.canEditAppointments) return;
    const arrivedAt =
      nextStatus === "Arrivé en salle d'attente" && !apt.arrivedAt
        ? new Date().toISOString()
        : apt.arrivedAt || '';
    await saveRecord('appointments', apt.id, { status: nextStatus, arrivedAt }, false);
    showToast(`Statut mis à jour : ${nextStatus}`, 'success');
  };

  const handleCreateBookingRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingForm.patientName.trim() || !bookingForm.phone.trim()) return;
    await saveRecord(
      'bookingRequests',
      generateSafeId('req'),
      {
        patientName: bookingForm.patientName.trim(),
        phone: bookingForm.phone.trim(),
        preferredDate: bookingForm.preferredDate,
        preferredSlot: bookingForm.preferredSlot,
        reason: bookingForm.reason.trim() || 'Demande de consultation',
        practitionerId: practitioners[0]?.uid || user?.uid || '',
        status: 'En attente',
      },
      true
    );
    setBookingForm({
      patientName: '',
      phone: '',
      preferredDate: addDaysISO(todayISO(), 1),
      preferredSlot: 'Matin (09:00 - 13:00)',
      reason: '',
    });
    setShowBookingForm(false);
    showToast('Demande de pré-réservation enregistrée pour validation.', 'success');
  };

  const handleValidateBookingRequest = async (reqId: string, decision: 'Validé' | 'Refusé') => {
    await saveRecord('bookingRequests', reqId, { status: decision }, false);
    showToast(
      decision === 'Validé'
        ? 'Pré-réservation validée. Créez le créneau patient dans l\'agenda.'
        : 'Pré-réservation refusée.',
      'info'
    );
  };

  // Mini calendar builder for selectedDate month
  const miniCalendarDays = useMemo(() => {
    const [y, m] = selectedDate.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Mon=0..Sun=6
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        day: d,
      });
    }
    return cells;
  }, [selectedDate]);

  // Week dates (Mon-Sat around selectedDate)
  const weekDays = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dayIdx = (dt.getDay() + 6) % 7;
    const mondayIso = addDaysISO(selectedDate, -dayIdx);
    return Array.from({ length: 6 }, (_, i) => addDaysISO(mondayIso, i));
  }, [selectedDate]);

  const columns =
    groupBy === 'practitioner'
      ? practitioners.map((p) => ({
          key: p.uid,
          title: p.displayName,
          subtitle: p.specialty || p.chairName || 'Praticien',
          color: p.color || '#0284C7',
        }))
      : chairs.map((ch) => ({
          key: ch,
          title: ch,
          subtitle: 'Planning fauteuil',
          color: '#0284C7',
        }));

  const pendingBookingsCount = bookingRequests.filter((r) => r.status === 'En attente').length;

  const workingHours = useMemo(
    () => ({
      start: clinicSettings?.workingHours?.start || '09:00',
      end: clinicSettings?.workingHours?.end || '18:00',
      lunchStart: clinicSettings?.workingHours?.lunchStart || '13:00',
      lunchEnd: clinicSettings?.workingHours?.lunchEnd || '15:00',
      saturdayStart: clinicSettings?.workingHours?.saturdayStart || '09:00',
      saturdayEnd: clinicSettings?.workingHours?.saturdayEnd || '13:00',
    }),
    [clinicSettings?.workingHours]
  );

  const selectedDayOfWeek = useMemo(
    () => new Date(`${selectedDate}T00:00:00`).getDay(),
    [selectedDate]
  );

  const timeSlots = useMemo(() => {
    const startH = Math.floor(toMinutes(workingHours.start) / 60);
    const endMinutes = toMinutes(workingHours.end);
    const lastSlotH = Math.max(startH, Math.ceil(endMinutes / 60) - 1);
    const hourSet = new Set<number>();
    for (let h = startH; h <= lastSlotH; h++) {
      hourSet.add(h);
    }
    for (const apt of dayAppointments) {
      const h = Number(apt.startTime.slice(0, 2));
      if (Number.isFinite(h)) hourSet.add(h);
    }
    const lunchStartMin = toMinutes(workingHours.lunchStart);
    const lunchEndMin = toMinutes(workingHours.lunchEnd);
    const satStartMin = toMinutes(workingHours.saturdayStart);
    const satEndMin = toMinutes(workingHours.saturdayEnd);
    const openStartMin = toMinutes(workingHours.start);

    return Array.from(hourSet)
      .sort((a, b) => a - b)
      .map((hour) => {
        const slot = formatHourSlot(hour);
        const min = hour * 60;
        let state: 'open' | 'lunch' | 'closed' = 'open';
        if (selectedDayOfWeek === 0) {
          state = 'closed';
        } else if (selectedDayOfWeek === 6) {
          if (min < satStartMin || min >= satEndMin) state = 'closed';
        } else {
          if (min < openStartMin || min >= endMinutes) {
            state = 'closed';
          } else if (min >= lunchStartMin && min < lunchEndMin) {
            state = 'lunch';
          }
        }
        return { slot, hourPrefix: String(hour).padStart(2, '0'), state };
      });
  }, [workingHours, dayAppointments, selectedDayOfWeek]);

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1">
            <button
              type="button"
              onClick={() => setSelectedDate(addDaysISO(selectedDate, -1))}
              className="rounded p-1 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
              title="Jour précédent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent px-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 font-mono focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setSelectedDate(addDaysISO(selectedDate, 1))}
              className="rounded p-1 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
              title="Jour suivant"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {(
              [
                ['jour', 'Jour'],
                ['semaine', 'Semaine'],
                ['mois', 'Mois'],
                ['prereservations', `Pré-réservations (${pendingBookingsCount})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  viewMode === id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-xs">
            <button
              type="button"
              onClick={() => setGroupBy('practitioner')}
              className={`rounded-md px-2.5 py-1 font-medium ${
                groupBy === 'practitioner' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Par Praticien
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('chair')}
              className={`rounded-md px-2.5 py-1 font-medium ${
                groupBy === 'chair' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Par Fauteuil
            </button>
          </div>

          {permissions.canEditAppointments && (
            <button
              type="button"
              onClick={() => openNewAppointmentModal()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-700 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nouveau Rendez-vous</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterPractitioner}
          onChange={(e) => setFilterPractitioner(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 focus:border-sky-500 focus:outline-none"
        >
          <option value="all">Tous les praticiens</option>
          {practitioners.map((p) => (
            <option key={p.uid} value={p.uid}>
              {p.displayName}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 focus:border-sky-500 focus:outline-none"
        >
          <option value="all">Tous les statuts</option>
          {STATUS_OPTIONS.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un patient, acte, praticien..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            <span>
              Lun–Ven : <strong className="font-mono text-slate-700 dark:text-slate-200">{workingHours.start}–{workingHours.lunchStart}</strong> / <strong className="font-mono text-slate-700 dark:text-slate-200">{workingHours.lunchEnd}–{workingHours.end}</strong> · Sam : <strong className="font-mono text-slate-700 dark:text-slate-200">{workingHours.saturdayStart}–{workingHours.saturdayEnd}</strong>
            </span>
          </span>
          <span className="inline-flex items-center gap-1 font-mono">
            <Phone className="h-3 w-3 text-sky-600 dark:text-sky-400" />
            <span>{clinicSettings?.phone || '+212 532 101 351'}</span>
          </span>
        </div>
      </div>

      {/* Main Content + Right Side Inspector */}
      {viewMode === 'prereservations' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Demandes de Pré-réservation en ligne
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Souhaits de rendez-vous soumis par les patients en attente de validation manuelle par l'accueil.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBookingForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Simuler / Saisir une demande en ligne</span>
            </button>
          </div>

          {showBookingForm && (
            <form
              onSubmit={handleCreateBookingRequest}
              className="grid grid-cols-1 md:grid-cols-6 gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4"
            >
              <input
                required
                placeholder="Nom complet du patient"
                value={bookingForm.patientName}
                onChange={(e) => setBookingForm({ ...bookingForm, patientName: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <input
                required
                placeholder="Téléphone (+212...)"
                value={bookingForm.phone}
                onChange={(e) => setBookingForm({ ...bookingForm, phone: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <input
                type="date"
                value={bookingForm.preferredDate}
                onChange={(e) => setBookingForm({ ...bookingForm, preferredDate: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <select
                value={bookingForm.preferredSlot}
                onChange={(e) => setBookingForm({ ...bookingForm, preferredSlot: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              >
                <option value="Matin (09:00 - 13:00)">Matin (09:00 - 13:00)</option>
                <option value="Après-midi (15:00 - 18:00)">Après-midi (15:00 - 18:00)</option>
                <option value="Samedi matin (09:00 - 13:00)">Samedi matin (09:00 - 13:00)</option>
              </select>
              <input
                placeholder="Motif du rendez-vous"
                value={bookingForm.reason}
                onChange={(e) => setBookingForm({ ...bookingForm, reason: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700"
              >
                Soumettre la demande
              </button>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 font-medium">Patient</th>
                  <th className="py-2.5 font-medium">Téléphone</th>
                  <th className="py-2.5 font-medium">Date souhaitée</th>
                  <th className="py-2.5 font-medium">Motif</th>
                  <th className="py-2.5 font-medium">Statut</th>
                  <th className="py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {bookingRequests.map((req) => (
                  <tr key={req.id}>
                    <td className="py-3 font-semibold text-slate-900 dark:text-slate-100">{req.patientName}</td>
                    <td className="py-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">{req.phone}</td>
                    <td className="py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatDateFR(req.preferredDate)} · {req.preferredSlot || 'Flexible'}
                    </td>
                    <td className="py-3 text-slate-600 dark:text-slate-300">{req.reason}</td>
                    <td className="py-3 font-medium">
                      <span
                        className={
                          req.status === 'Validé'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : req.status === 'Refusé'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="py-3 text-right space-x-2">
                      {req.status === 'En attente' && permissions.canEditAppointments && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleValidateBookingRequest(req.id, 'Validé')}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                          >
                            Valider
                          </button>
                          <button
                            type="button"
                            onClick={() => handleValidateBookingRequest(req.id, 'Refusé')}
                            className="rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Refuser
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left Schedule Matrix */}
          <div className="xl:col-span-9 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {viewMode === 'jour' && (
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  {/* Column headers */}
                  <div
                    className="grid border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60"
                    style={{ gridTemplateColumns: `80px repeat(${Math.max(1, columns.length)}, minmax(180px, 1fr))` }}
                  >
                    <div className="p-3 text-xs font-medium text-slate-500 dark:text-slate-400">Heure</div>
                    {columns.map((col) => (
                      <div key={col.key} className="border-l border-slate-200 dark:border-slate-800 p-3">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{col.title}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{col.subtitle}</p>
                      </div>
                    ))}
                  </div>

                  {/* Day status notice when Saturday or Sunday */}
                  {(selectedDayOfWeek === 0 || selectedDayOfWeek === 6) && (
                    <div className="border-b border-slate-200 dark:border-slate-800 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                      {selectedDayOfWeek === 0
                        ? 'Dimanche — Cabinet fermé selon les horaires habituels (créneaux disponibles sur urgence).'
                        : `Samedi — Consultations le matin uniquement (${workingHours.saturdayStart} – ${workingHours.saturdayEnd}).`}
                    </div>
                  )}

                  {/* Time slot rows */}
                  {timeSlots.map(({ slot, hourPrefix, state }) => {
                    const isBreakOrClosed = state !== 'open';
                    return (
                      <div
                        key={slot}
                        className={`grid border-b border-slate-100 dark:border-slate-800 min-h-[68px] ${
                          isBreakOrClosed ? 'bg-slate-50/70 dark:bg-slate-800/25' : ''
                        }`}
                        style={{
                          gridTemplateColumns: `80px repeat(${Math.max(1, columns.length)}, minmax(180px, 1fr))`,
                        }}
                      >
                        <div className="p-3 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          <div>{slot}</div>
                          {state === 'lunch' && (
                            <div className="mt-0.5 font-sans text-[10px] font-medium text-slate-400 dark:text-slate-500">
                              Pause
                            </div>
                          )}
                          {state === 'closed' && (
                            <div className="mt-0.5 font-sans text-[10px] font-medium text-slate-400 dark:text-slate-500">
                              Fermé
                            </div>
                          )}
                        </div>
                        {columns.map((col) => {
                          const cellApts = dayAppointments.filter((apt) => {
                            const matchCol =
                              groupBy === 'practitioner'
                                ? apt.practitionerId === col.key
                                : apt.chair === col.key;
                            return matchCol && apt.startTime.slice(0, 2) === hourPrefix;
                          });
                          return (
                            <div
                              key={col.key}
                              onClick={() => {
                                if (cellApts.length === 0 && permissions.canEditAppointments) {
                                  openNewAppointmentModal(
                                    selectedDate,
                                    slot,
                                    groupBy === 'practitioner' ? col.key : undefined
                                  );
                                }
                              }}
                              className="border-l border-slate-100 dark:border-slate-800 p-1.5 space-y-1.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                            >
                              {cellApts.map((apt) => {
                                const waitMin =
                                  apt.status === "Arrivé en salle d'attente"
                                    ? computeWaitingMinutes(apt.arrivedAt)
                                    : 0;
                                return (
                                  <button
                                    key={apt.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedAptId(apt.id);
                                    }}
                                    className={`w-full rounded-lg border p-2 text-left transition-all ${
                                      selectedApt?.id === apt.id ? 'ring-2 ring-sky-500' : ''
                                    } ${STATUS_STYLE[apt.status]}`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-xs font-semibold truncate">{apt.patientName}</span>
                                      <span className="font-mono text-[10px] tabular-nums shrink-0">
                                        {apt.startTime}
                                      </span>
                                    </div>
                                    <p className="text-[11px] opacity-85 truncate mt-0.5">
                                      {apt.actType} · {apt.durationMinutes} min
                                    </p>
                                    {waitMin > 0 && (
                                      <p className="text-[10px] font-mono font-semibold mt-0.5 tabular-nums">
                                        Salle d'attente : {waitMin} min
                                      </p>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {viewMode === 'semaine' && (
              <div className="grid grid-cols-1 md:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
                {weekDays.map((dayIso) => {
                  const list = filteredAppointments
                    .filter((a) => a.date === dayIso)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));
                  return (
                    <div key={dayIso} className="p-3 space-y-2 min-h-[340px]">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDate(dayIso);
                          setViewMode('jour');
                        }}
                        className={`w-full text-left pb-2 border-b border-slate-100 dark:border-slate-800 ${
                          dayIso === selectedDate ? 'text-sky-700 dark:text-sky-400 font-bold' : 'text-slate-800 dark:text-slate-200 font-semibold'
                        }`}
                      >
                        <p className="text-xs">{formatDateFR(dayIso)}</p>
                        <p className="text-[11px] font-normal text-slate-500 dark:text-slate-400">{list.length} RDV</p>
                      </button>
                      <div className="space-y-1.5">
                        {list.map((apt) => (
                          <button
                            key={apt.id}
                            type="button"
                            onClick={() => setSelectedAptId(apt.id)}
                            className={`w-full rounded-lg border p-2 text-left text-[11px] ${STATUS_STYLE[apt.status]}`}
                          >
                            <p className="font-mono font-semibold tabular-nums">{apt.startTime}</p>
                            <p className="font-semibold truncate">{apt.patientName}</p>
                            <p className="truncate opacity-80">{apt.actType}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {viewMode === 'mois' && (
              <div className="p-4">
                <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  <span>Lun</span>
                  <span>Mar</span>
                  <span>Mer</span>
                  <span>Jeu</span>
                  <span>Ven</span>
                  <span>Sam</span>
                  <span>Dim</span>
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {miniCalendarDays.map((cell, idx) => {
                    if (!cell) return <div key={`e-${idx}`} className="h-24 rounded-lg bg-slate-50/50 dark:bg-slate-800/30" />;
                    const count = filteredAppointments.filter((a) => a.date === cell.iso).length;
                    return (
                      <button
                        key={cell.iso}
                        type="button"
                        onClick={() => {
                          setSelectedDate(cell.iso);
                          setViewMode('jour');
                        }}
                        className={`h-24 rounded-lg border p-2 text-left flex flex-col justify-between transition-colors ${
                          cell.iso === selectedDate
                            ? 'border-sky-600 dark:border-sky-400 bg-sky-50/60 dark:bg-sky-950/60'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {cell.day}
                        </span>
                        {count > 0 && (
                          <span className="text-[11px] font-medium text-sky-700 dark:text-sky-400 tabular-nums">
                            {count} RDV
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right Mini Calendar + Appointment Details Panel */}
          <div className="xl:col-span-3 space-y-4">
            {/* Mini Calendar */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 capitalize">
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayISO())}
                  className="text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline"
                >
                  Aujourd'hui
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400 dark:text-slate-500 mb-1">
                <span>L</span>
                <span>M</span>
                <span>M</span>
                <span>J</span>
                <span>V</span>
                <span>S</span>
                <span>D</span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs tabular-nums">
                {miniCalendarDays.map((cell, idx) =>
                  cell ? (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedDate(cell.iso)}
                      className={`h-7 w-7 mx-auto rounded-full flex items-center justify-center font-mono text-[11px] transition-colors ${
                        cell.iso === selectedDate
                          ? 'bg-sky-600 text-white font-bold'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {cell.day}
                    </button>
                  ) : (
                    <span key={`blank-${idx}`} />
                  )
                )}
              </div>
            </div>

            {/* Appointment Details Panel */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Détails du rendez-vous</h3>
                {selectedApt && (
                  <span className="text-[11px] font-medium text-sky-700 dark:text-sky-400">{selectedApt.status}</span>
                )}
              </div>

              {selectedApt ? (
                <>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Patient</span>
                      <button
                        type="button"
                        onClick={() => openPatientFile(selectedApt.patientId)}
                        className="font-semibold text-sky-700 dark:text-sky-400 hover:underline text-right"
                      >
                        {selectedApt.patientName}
                      </button>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Téléphone</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {selectedApt.patientPhone || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Acte</span>
                      <span className="text-slate-900 dark:text-slate-100 text-right">{selectedApt.actType}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Praticien / Fauteuil</span>
                      <span className="text-slate-900 dark:text-slate-100 text-right">
                        {selectedApt.practitionerName} · {selectedApt.chair}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Date & Heure</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatDateFR(selectedApt.date)} · {selectedApt.startTime} ({selectedApt.durationMinutes} min)
                      </span>
                    </div>
                    {selectedApt.status === "Arrivé en salle d'attente" && (
                      <div className="flex justify-between gap-2 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 rounded-lg px-2.5 py-1.5">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" /> Temps d'attente
                        </span>
                        <span className="font-mono font-bold tabular-nums">
                          {computeWaitingMinutes(selectedApt.arrivedAt)} min
                        </span>
                      </div>
                    )}
                    {selectedApt.notes && (
                      <div className="pt-1">
                        <p className="text-slate-500 dark:text-slate-400 mb-0.5">Notes cliniques</p>
                        <p className="text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 rounded-lg p-2">{selectedApt.notes}</p>
                      </div>
                    )}
                  </div>

                  {permissions.canEditAppointments && (
                    <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Cycle de vie du rendez-vous</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStatusChange(selectedApt, "Arrivé en salle d'attente")}
                          className="flex items-center justify-center gap-1 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 px-2 py-1.5 text-[11px] font-medium text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/60"
                        >
                          <UserCheck className="h-3 w-3" />
                          <span>Arrivé</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(selectedApt, 'Au fauteuil')}
                          className="flex items-center justify-center gap-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-1.5 text-[11px] font-medium text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Au fauteuil</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(selectedApt, 'Terminé')}
                          className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-1.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                        >
                          Terminé
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(selectedApt, 'Absent')}
                          className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-2 py-1.5 text-[11px] font-medium text-red-800 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/60"
                        >
                          Absent
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => openEditAppointmentModal(selectedApt)}
                          className="flex-1 rounded-lg bg-sky-600 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                        >
                          Modifier / Reporter
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(selectedApt, 'Annulé')}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Annuler
                        </button>
                        {actualRole === 'titulaire' && (
                          confirmDeleteAptId === selectedApt.id ? (
                            <button
                              type="button"
                              onClick={async () => {
                                await removeRecord('appointments', selectedApt.id);
                                setConfirmDeleteAptId(null);
                                setSelectedAptId(null);
                                showToast('Rendez-vous supprimé définitivement.', 'success');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Confirmer</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAptId(selectedApt.id)}
                              title="Supprimer le rendez-vous"
                              className="rounded-lg border border-red-200 dark:border-red-800 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  Sélectionnez un rendez-vous dans le planning pour afficher ses détails.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New / Edit Appointment Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingApt ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAppointment} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Patient</label>
                <select
                  required
                  disabled={Boolean(editingApt && (actualRole === 'collaborateur' || actualRole === 'secretaire'))}
                  value={formState.patientId}
                  onChange={(e) => setFormState({ ...formState, patientId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                >
                  <option value="">Sélectionner un patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fileNumber} — {p.firstName} {p.lastName} ({p.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Praticien</label>
                  <select
                    disabled={actualRole === 'collaborateur'}
                    value={formState.practitionerId}
                    onChange={(e) => setFormState({ ...formState, practitionerId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    {practitioners.map((p) => (
                      <option key={p.uid} value={p.uid}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Fauteuil</label>
                  <select
                    disabled={Boolean(editingApt && actualRole === 'collaborateur')}
                    value={formState.chair}
                    onChange={(e) => setFormState({ ...formState, chair: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  >
                    {chairs.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={formState.date}
                    onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Heure</label>
                  <input
                    type="time"
                    required
                    value={formState.startTime}
                    onChange={(e) => setFormState({ ...formState, startTime: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Durée</label>
                  <select
                    value={formState.durationMinutes}
                    onChange={(e) =>
                      setFormState({ ...formState, durationMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono"
                  >
                    {[15, 30, 45, 60, 90, 120].map((d) => (
                      <option key={d} value={d}>
                        {d} min
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Type d'acte</label>
                  <select
                    value={formState.actType}
                    onChange={(e) => {
                      const act = actsCatalog.find((a) => a.name === e.target.value);
                      setFormState({
                        ...formState,
                        actType: e.target.value,
                        durationMinutes: act?.defaultDuration || formState.durationMinutes,
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    {actsCatalog.map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name} ({a.defaultDuration} min)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Statut</label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as AppointmentStatus })
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                  >
                    {STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {conflictingModalApt && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Chevauchement détecté avec <strong>{conflictingModalApt.patientName}</strong> ({conflictingModalApt.startTime}, {conflictingModalApt.durationMinutes} min · {conflictingModalApt.chair}).
                  </span>
                </div>
              )}

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  disabled={Boolean(editingApt && actualRole === 'collaborateur')}
                  checked={formState.isUrgent}
                  onChange={(e) => setFormState({ ...formState, isUrgent: e.target.checked })}
                  className="rounded border-slate-300 dark:border-slate-600 disabled:opacity-60"
                />
                <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <span>Créneau d'urgence clinique</span>
              </label>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-200 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={formState.notes}
                  onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
