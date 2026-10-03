"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { formatCivilDayLabelShort, instantDateKey, instantMinutesOfDay, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { MODALITY_LABELS, STATUS_LABELS } from "@/lib/calendar-theme";
import { cancelOccurrenceAction, rescheduleOccurrenceAction } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";

function MetaChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-textSecondary">{children}</span>;
}

interface RealLessonDetailModalProps {
  item: CalendarViewItem;
  canReuseSlot: boolean;
  onClose: () => void;
}

export function RealLessonDetailModal({ item, canReuseSlot, onClose }: RealLessonDetailModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reschedulingOpen, setReschedulingOpen] = useState(false);
  const [reschedulePreview, setReschedulePreview] = useState<{ date: string; hour: number; minute: number } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(Date.now());
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const start = new Date(item.start);
  const startDateKey = instantDateKey(item.start);
  const startMinutesOfDay = instantMinutesOfDay(item.start);
  const dateLabel = formatCivilDayLabelShort(startDateKey);
  const timeLabel = instantTimeLabel(item.start);
  const durationMinutes = Math.round((new Date(item.end).getTime() - start.getTime()) / 60_000);
  const isCancelled = item.status === "cancelled";
  const isPast = now !== null && start.getTime() <= now;
  const canEdit = item.status !== "cancelled" && item.status !== "completed";

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => cancelOccurrenceAction({
        lessonId: item.materializedLessonId,
        recurrenceId: item.recurrenceId,
        occurrenceKey: item.occurrenceKey,
        recurrenceIndex: null,
        primaryStudentId: item.studentId ?? "",
        studentName: item.studentName,
        level: item.level,
        lessonType: item.lessonType,
        startAt: item.start,
        endAt: item.end,
        modality: item.modality,
        classTitle: item.title,
        activityKind: item.activityKind,
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  function openReschedulePreview(formData: FormData) {
    setError(null);
    const date = String(formData.get("date") ?? "");
    const [hourStr, minuteStr] = String(formData.get("time") ?? "").split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr ?? "0");
    if (!date || Number.isNaN(hour) || Number.isNaN(minute)) {
      setError("Elegí una fecha y hora válidas.");
      return;
    }
    setReschedulePreview({ date, hour, minute });
  }

  function confirmReschedule() {
    if (!reschedulePreview) return;
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => rescheduleOccurrenceAction({
        recurrenceId: item.recurrenceId,
        occurrenceKey: item.occurrenceKey,
        originalLessonId: item.materializedLessonId,
        originalStartAt: item.start,
        primaryStudentId: item.studentId ?? "",
        participantIds: item.participantIds,
        lessonType: item.lessonType,
        modality: item.modality,
        classTitle: item.title,
        activityKind: item.activityKind,
        newDate: reschedulePreview.date,
        newHour: reschedulePreview.hour,
        newMinute: reschedulePreview.minute,
        durationMinutes,
      }));
      if (result.error) {
        // Vuelve al paso de elegir fecha/hora (nunca deja la vista previa
        // abierta con un resultado que en realidad falló) — el mensaje real
        // del conflicto/disponibilidad queda visible para reintentar.
        setReschedulePreview(null);
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const previewNewEndLabel = reschedulePreview
    ? (() => {
        const endMinutes = reschedulePreview.hour * 60 + reschedulePreview.minute + durationMinutes;
        const endHour = Math.floor(endMinutes / 60) % 24;
        const endMinute = endMinutes % 60;
        return `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
      })()
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-detail-title"
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-panel sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="lesson-detail-title" className="text-lg font-bold text-textPrimary">
            {item.title?.trim() || item.studentName || "Serie sin alumnos"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle de la clase"
            className="rounded-full p-1.5 text-textMuted transition-all duration-150 ease-premium hover:bg-background hover:text-textPrimary active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <MetaChip>{dateLabel}</MetaChip>
          <MetaChip>{timeLabel}</MetaChip>
          <MetaChip>{durationMinutes} min</MetaChip>
          <MetaChip>{MODALITY_LABELS[item.modality]}</MetaChip>
          <MetaChip>{item.isRecurring ? "Serie recurrente" : "Clase suelta"}</MetaChip>
          <MetaChip>{STATUS_LABELS[item.status]}</MetaChip>
          {item.activityKind === "training" && <MetaChip>Entrenamiento</MetaChip>}
          {!item.isMaterialized && <MetaChip>Ocurrencia virtual</MetaChip>}
        </div>

        {item.studentId && (
          <section className="mt-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-textSecondary">Alumno</h3>
            <Link
              href={`/alumnos/${item.studentId}`}
              className="mt-2 block rounded-md border border-border px-3 py-2 text-sm font-medium text-brandBlue transition-colors hover:border-brandBlue/30 hover:underline"
            >
              {item.studentName || "Ver perfil"} →
            </Link>
          </section>
        )}

        {error && (
          <div className="mt-4">
            <FormErrorBox message={error} />
          </div>
        )}

        {reschedulingOpen && reschedulePreview ? (
          <div className="mt-5 flex flex-col gap-3 rounded-md border border-brandBlue/30 bg-brandBlue/5 p-3">
            <p className="text-sm font-semibold text-textPrimary">Confirmar nuevo horario</p>
            <p className="text-sm text-textSecondary">
              {formatCivilDayLabelShort(reschedulePreview.date)} de{" "}
              {String(reschedulePreview.hour).padStart(2, "0")}:{String(reschedulePreview.minute).padStart(2, "0")} a {previewNewEndLabel} ({durationMinutes} min)
            </p>
            <p className="text-xs text-textMuted">El horario original queda liberado y marcado como reprogramado — el historial se conserva.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmReschedule}
                disabled={pending}
                className="flex-1 rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Guardando..." : "Confirmar reprogramación"}
              </button>
              <button type="button" onClick={() => setReschedulePreview(null)} disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">
                Volver
              </button>
            </div>
          </div>
        ) : reschedulingOpen ? (
          <form action={(fd) => openReschedulePreview(fd)} className="mt-5 flex flex-col gap-3 rounded-md border border-border p-3">
            <p className="text-sm font-semibold text-textPrimary">Nuevo horario</p>
            <input type="date" name="date" required className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <input type="time" name="time" required className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <p className="text-xs text-textMuted">La duración ({durationMinutes} min) se mantiene igual a la clase original.</p>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-md bg-brandBlue px-3 py-2 text-sm font-semibold text-white">
                Ver vista previa
              </button>
              <button
                type="button"
                onClick={() => {
                  setReschedulingOpen(false);
                  setReschedulePreview(null);
                }}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : confirmingCancel ? (
          <div className="mt-5 flex flex-col gap-3 rounded-md border border-statusRojo/30 bg-statusRojo/5 p-3">
            <p className="text-sm font-medium text-statusRojo">¿Cancelar esta clase? Esta acción queda registrada y es visible para la profesora.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={pending}
                className="flex-1 rounded-md bg-statusRojo px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Cancelando..." : "Sí, cancelar clase"}
              </button>
              <button type="button" onClick={() => setConfirmingCancel(false)} className="rounded-md border border-border px-3 py-2 text-sm">
                Volver
              </button>
            </div>
          </div>
        ) : (
          <section className="mt-5">
            <div className="flex flex-col gap-1.5">
              {isPast && item.status !== "cancelled" && item.status !== "completed" && (
                <Link
                  href={item.materializedLessonId ? `/registro/${item.materializedLessonId}` : "/registro"}
                  className="flex items-center justify-between rounded-md border border-brandBlue/30 bg-brandBlue/5 px-3 py-2.5 text-left text-sm font-semibold text-brandBlueDark transition-colors hover:bg-brandBlue/10"
                >
                  Registrar esta clase
                </Link>
              )}
              {canReuseSlot && (
                <Link
                  href={`/calendario/nueva?freedByLessonId=${item.materializedLessonId}&date=${startDateKey}&hour=${Math.floor(startMinutesOfDay / 60)}&minute=${startMinutesOfDay % 60}&duration=${durationMinutes}&modality=${item.modality}`}
                  className="flex items-center justify-between rounded-md border border-brandBlue/30 bg-brandBlue/5 px-3 py-2.5 text-left text-sm font-semibold text-brandBlueDark transition-colors hover:bg-brandBlue/10"
                >
                  Reemplazar con otro alumno
                </Link>
              )}
              {canEdit && !isPast && (
                <button
                  type="button"
                  onClick={() => setReschedulingOpen(true)}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm font-medium text-textPrimary transition-colors hover:border-brandBlue/30"
                >
                  Reprogramar esta clase
                </button>
              )}
              {canEdit && !isCancelled && (
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(true)}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm font-medium text-statusRojo transition-colors hover:border-statusRojo/30"
                >
                  Cancelar esta clase
                </button>
              )}
              {item.recurrenceId && (
                <Link
                  href={`/calendario/series`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 text-left text-sm font-medium text-textPrimary transition-colors hover:border-brandBlue/30"
                >
                  Administrar esta serie →
                </Link>
              )}
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
