"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowPathIcon, ArrowRightIcon, ChevronDownIcon, ClipboardDocumentCheckIcon, PencilSquareIcon, UserPlusIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { editRegistrationHref } from "@/lib/registro/return-path";
import { seriesDetailHref } from "@/lib/calendar/series-return";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { formatCivilDayLabelShort, instantDateKey, instantMinutesOfDay, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { lessonStatusLabel, MODALITY_LABELS } from "@/lib/calendar-theme";
import { cancelOccurrenceAction, restoreOccurrenceAction } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { formatMinutes } from "@/lib/format/number-format";
import { Button, PrivateButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { LessonParticipantsDialog } from "@/components/calendar/lesson-participants-dialog";
import { ChangeSchedulePanel } from "@/components/calendar/change-schedule-panel";
import { LessonMemberSummary } from "@/components/calendar/lesson-member-summary";

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-[26px] items-center rounded-pill border border-border bg-paperDeep px-2.5 text-[12.5px] font-[650] text-textSecondary [overflow-wrap:anywhere]">{children}</span>
  );
}

interface RealLessonDetailModalProps {
  item: CalendarViewItem;
  canReuseSlot: boolean;
  onClose: () => void;
  /** Abre directo el paso «Reprogramar» (resultado «Reprogramada» del registro, también para una clase que ya pasó). */
  startInReschedule?: boolean;
}

/**
 * Detalle de una clase del calendario. Un único diálogo con pasos (acciones → reprogramar → confirmar, o acciones → cancelar):
 * el título y los datos de la clase (día, hora, duración, modalidad, estado) quedan siempre a la vista, así cada paso dice QUÉ
 * clase y QUÉ fecha se están modificando sin depender del fondo oscurecido. La lógica (acciones, validaciones, foco entre
 * pasos) no cambió; sólo la presentación.
 */
export function RealLessonDetailModal({ item, canReuseSlot, onClose, startInReschedule = false }: RealLessonDetailModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reschedulingOpen, setReschedulingOpen] = useState(startInReschedule);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Id de la clase recién cancelada: la cancelación la saca de la agenda, así que acá se ofrece (una vez) reemplazarla con otro alumno o deshacer.
  const [cancelledLessonId, setCancelledLessonId] = useState<string | null>(null);
  const [restoreNeedsConfirm, setRestoreNeedsConfirm] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  // La semana o el día desde el que se abrió la clase: «Editar registro» vuelve ahí al guardar.
  const [calendarPath, setCalendarPath] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Al pasar de un paso a otro (reprogramar, confirmar, cancelar, volver) el foco va al control principal del paso nuevo
  // (marcado con data-autofocus) o, al volver a las acciones, al propio diálogo: nunca se pierde en <body>. El diálogo (con su
  // foco atrapado, Escape y devolución del foco al control que lo abrió) es `components/ui/dialog.tsx`.
  useEffect(() => {
    const dialog = bodyRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const target = dialog.querySelector<HTMLElement>("[data-autofocus]");
    (target ?? dialog).focus();
  }, [reschedulingOpen, confirmingCancel, cancelledLessonId]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setNow(Date.now());
    setCalendarPath(window.location.pathname + window.location.search);
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
  const lessonTitle = item.title?.trim() || item.studentName || "Serie sin alumnos";
  // Todos los alumnos de la clase (el principal primero): `studentName` es sólo el del principal, y una clase compartida parecía de uno solo.
  const participantNames = item.participantNames && item.participantNames.length > 0 ? item.participantNames : item.studentName ? [item.studentName] : [];
  const members = item.participantProfiles ?? (item.studentId && item.studentName ? [{ id: item.studentId, name: item.studentName }] : []);

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
      if (result.cancelledLessonId) {
        setConfirmingCancel(false);
        setCancelledLessonId(result.cancelledLessonId);
        return;
      }
      onClose();
    });
  }

  function handleUndoCancel(confirmOverlap: boolean) {
    if (!cancelledLessonId) return;
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => restoreOccurrenceAction({ lessonId: cancelledLessonId, confirmOverlap }));
      if (result.error) {
        setError(result.error);
        setRestoreNeedsConfirm(result.conflict === true);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  if (participantsOpen) return <LessonParticipantsDialog item={item} onBack={() => setParticipantsOpen(false)} onDone={onClose} />;

  const step: "actions" | "reschedule" | "cancel" | "cancelled" = cancelledLessonId ? "cancelled" : reschedulingOpen ? "reschedule" : confirmingCancel ? "cancel" : "actions";
  const dialogTitle = step === "reschedule" ? `Reprogramar · ${lessonTitle}` : step === "cancel" ? `Cancelar clase · ${lessonTitle}` : step === "cancelled" ? `Clase cancelada · ${lessonTitle}` : lessonTitle;
  const isFutureSlot = now !== null && start.getTime() > now;

  const footer =
    step === "reschedule" ? undefined : step === "cancelled" ? (
      <Button variant="primary" onClick={onClose} className="self-end" data-autofocus>
        Listo
      </Button>
    ) : step === "cancel" ? (
      <>
        <Button variant="secondary" onClick={() => setConfirmingCancel(false)} data-autofocus>
          Volver
        </Button>
        <Button variant="danger" onClick={handleCancel} busy={pending}>
          {pending ? "Cancelando..." : "Sí, cancelar clase"}
        </Button>
      </>
    ) : (
      <Button variant="secondary" onClick={onClose} className="self-end">
        Cerrar
      </Button>
    );

  return (
    <Dialog title={dialogTitle} onClose={onClose} size={step === "actions" ? "sm" : "md"} footer={footer} busy={pending}>
      <div ref={bodyRef} className="flex min-w-0 flex-col gap-3.5">
        {step === "actions" ? (
          <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
            <p className="flex flex-wrap gap-x-2 gap-y-1 text-[14px] text-textSecondary"><span>{dateLabel}</span><span>{timeLabel}–{instantTimeLabel(item.end)}</span><span>{MODALITY_LABELS[item.modality]}</span></p>
            <p className="text-xs text-textMuted">{item.isRecurring ? "Serie recurrente" : "Clase suelta"} · {lessonStatusLabel(item)} · {formatMinutes(durationMinutes)}{item.activityKind === "training" ? " · Entrenamiento" : ""}</p>
          </div>
        ) : <div className="flex flex-wrap gap-1.5">
          <MetaChip>{dateLabel}</MetaChip>
          <MetaChip>{timeLabel}</MetaChip>
          <MetaChip>{formatMinutes(durationMinutes)}</MetaChip>
          <MetaChip>{MODALITY_LABELS[item.modality]}</MetaChip>
          <MetaChip>{item.isRecurring ? "Serie recurrente" : "Clase suelta"}</MetaChip>
          <MetaChip>{lessonStatusLabel(item)}</MetaChip>
          {item.activityKind === "training" && <MetaChip>Entrenamiento</MetaChip>}
          {!item.isMaterialized && <MetaChip>Ocurrencia virtual</MetaChip>}
        </div>}

        <p role="status" aria-live="polite" className="sr-only">
          {pending ? "Guardando el cambio…" : ""}
        </p>

        {error && <Notice tone="bad">{error}</Notice>}

        {step === "reschedule" && (
          <ChangeSchedulePanel
            occurrence={{ id: item.id, start: item.start, end: item.end, recurrenceId: item.recurrenceId, title: item.title, studentName: item.studentName, participantNames }}
            initialScope="single"
            singleClassOnly
            onCancel={() => setReschedulingOpen(false)}
            onDone={onClose}
          />
        )}

        {step === "cancel" && (
          <Notice tone="bad" role="alert">
            ¿Cancelar esta clase? Esta acción queda registrada y es visible para la profesora.
          </Notice>
        )}

        {step === "cancelled" && cancelledLessonId && (
          <section aria-label="Clase cancelada" className="flex flex-col gap-2.5">
            <Notice tone="ok" role="status">
              La clase se canceló y ya no figura en la agenda. Su historial, registros y cobros se conservan.
            </Notice>
            {isFutureSlot && (
              <PrivateButtonLink
                href={`/calendario/nueva?freedByLessonId=${cancelledLessonId}&date=${startDateKey}&hour=${Math.floor(startMinutesOfDay / 60)}&minute=${startMinutesOfDay % 60}&duration=${durationMinutes}&modality=${item.modality}`}
                variant="secondary"
                block
              >
                <UserPlusIcon className="h-5 w-5" aria-hidden />
                Reemplazar con otro alumno
              </PrivateButtonLink>
            )}
            <Button variant="secondary" block busy={pending} onClick={() => handleUndoCancel(restoreNeedsConfirm)}>
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              {restoreNeedsConfirm ? "Restaurar igual" : "Deshacer la cancelación"}
            </Button>
          </section>
        )}

        {step === "actions" && (
          <>
            <LessonMemberSummary members={members} />

            {item.status === "completed" && item.materializedLessonId && (
              // Como la app original: una clase registrada muestra «Clase registrada» y «Editar registro» (corrige el registro existente; no inicia uno nuevo, no abre el perfil ni la programación de la clase).
              <section aria-label="Clase registrada" className="flex flex-col gap-2 rounded-md border-[1.5px] border-border bg-surface2 p-3">
                <p className="text-[15px] font-bold text-textPrimary">Clase registrada</p>
                <p className="text-[13.5px] text-textMuted">Esta clase ya tiene un registro pedagógico asociado.</p>
                <PrivateButtonLink href={editRegistrationHref(item.materializedLessonId, calendarPath)} variant="primary" block aria-label={`Editar registro, ${item.studentName || lessonTitle}`}>
                  <PencilSquareIcon className="h-5 w-5" aria-hidden />
                  Editar registro
                </PrivateButtonLink>
              </section>
            )}

            <section data-lesson-actions className="flex flex-col gap-2 [&>button]:min-h-[52px] [&>button]:max-w-none [&>a]:min-h-[52px] [&>a]:max-w-none">
              {isPast && item.status !== "cancelled" && item.status !== "completed" && (
                <PrivateButtonLink href={item.materializedLessonId ? `/registro/${item.materializedLessonId}` : "/registro"} variant="primary" block>
                  <ClipboardDocumentCheckIcon className="h-5 w-5" aria-hidden />
                  Registrar esta clase
                </PrivateButtonLink>
              )}
              {canEdit && (
                <Button variant={isPast && item.status !== "cancelled" && item.status !== "completed" ? "secondary" : "primary"} block onClick={() => setReschedulingOpen(true)}>
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  <span>Reprogramar<span className="block text-xs font-normal">Solo esta clase</span></span>
                </Button>
              )}
              {canEdit && (
                <Button variant="secondary" block onClick={() => setParticipantsOpen(true)}>
                  <UserPlusIcon className="h-5 w-5" aria-hidden />
                  Administrar miembros
                </Button>
              )}
              {canEdit && !isCancelled && (
                <Button variant="dangerOutline" block onClick={() => setConfirmingCancel(true)}>
                  <XCircleIcon className="h-5 w-5" aria-hidden />
                  Cancelar esta clase
                </Button>
              )}
            </section>

            {(item.recurrenceId || canReuseSlot) && (
              <details className="group border-t-[1.5px] border-border pt-1">
                <summary className="tf-motion-button flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 text-sm font-semibold text-textSecondary [&::-webkit-details-marker]:hidden">
                  Más opciones
                  <ChevronDownIcon className="h-4 w-4 group-open:rotate-180" aria-hidden />
                </summary>
                <div className="flex flex-col items-start gap-2 pb-1 pt-2">
                  {item.recurrenceId && (
                    <PrivateButtonLink href={seriesDetailHref(item.recurrenceId, calendarPath)} variant="secondary">
                      Administrar serie
                      <ArrowRightIcon className="h-4 w-4" aria-hidden />
                    </PrivateButtonLink>
                  )}
                  {canReuseSlot && (
                    <PrivateButtonLink
                      href={`/calendario/nueva?freedByLessonId=${item.materializedLessonId}&date=${startDateKey}&hour=${Math.floor(startMinutesOfDay / 60)}&minute=${startMinutesOfDay % 60}&duration=${durationMinutes}&modality=${item.modality}`}
                      variant="secondary"
                    >
                      <UserPlusIcon className="h-5 w-5" aria-hidden />
                      Reemplazar con otro alumno
                    </PrivateButtonLink>
                  )}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
