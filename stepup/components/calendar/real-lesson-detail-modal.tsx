"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowPathIcon, ArrowRightIcon, ArrowUturnLeftIcon, ClipboardDocumentCheckIcon, ClockIcon, PencilIcon, PencilSquareIcon, TrashIcon, UserPlusIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { editRegistrationHref } from "@/lib/registro/return-path";
import { seriesDetailHref } from "@/lib/calendar/series-return";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { formatCivilDayLabelShort, instantDateKey, instantMinutesOfDay, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { lessonStatusLabel, MODALITY_LABELS } from "@/lib/calendar-theme";
import { cancelOccurrenceAction } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { formatMinutes } from "@/lib/format/number-format";
import { Button, PrivateButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { LessonEditDialog, type LessonEditMode } from "@/components/calendar/lesson-edit-dialog";
import { LessonParticipantsDialog } from "@/components/calendar/lesson-participants-dialog";
import { ChangeSchedulePanel } from "@/components/calendar/change-schedule-panel";
import { ActivityDialog } from "@/components/calendar/activity-dialog";

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
  // Nombre, duración, restaurar y eliminar: pasos propios (`LessonEditDialog`) que vuelven a las acciones con «Volver».
  const [editMode, setEditMode] = useState<LessonEditMode | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [activityOpen,setActivityOpen]=useState(false);
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
  }, [reschedulingOpen, confirmingCancel]);

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
  const otherParticipantNames = participantNames.slice(item.studentName && participantNames[0] === item.studentName ? 1 : 0);

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

  const canRestore = !!item.materializedLessonId && !!item.recurrenceId && (item.status === "cancelled" || item.status === "rescheduled");
  const canDeleteCancelled = isCancelled && !!item.materializedLessonId;

  if (participantsOpen) return <LessonParticipantsDialog item={item} onBack={() => setParticipantsOpen(false)} onDone={onClose} />;
  if (activityOpen) return <ActivityDialog item={item} onClose={onClose} />;
  if (editMode) return <LessonEditDialog item={item} mode={editMode} onBack={() => setEditMode(null)} onDone={onClose} />;

  const step: "actions" | "reschedule" | "cancel" = reschedulingOpen ? "reschedule" : confirmingCancel ? "cancel" : "actions";
  const dialogTitle = step === "reschedule" ? `Cambiar horario · ${lessonTitle}` : step === "cancel" ? `Cancelar clase · ${lessonTitle}` : lessonTitle;

  const footer =
    step === "reschedule" ? undefined : step === "cancel" ? (
      <>
        <Button variant="secondary" onClick={() => setConfirmingCancel(false)} data-autofocus>
          Volver
        </Button>
        <Button variant="danger" onClick={handleCancel} busy={pending}>
          {pending ? "Cancelando..." : "Sí, cancelar clase"}
        </Button>
      </>
    ) : (
      <Button variant="secondary" onClick={onClose}>
        Cerrar
      </Button>
    );

  return (
    <Dialog title={dialogTitle} onClose={onClose} size="md" footer={footer} busy={pending}>
      <div ref={bodyRef} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap gap-1.5">
          <MetaChip>{dateLabel}</MetaChip>
          <MetaChip>{timeLabel}</MetaChip>
          <MetaChip>{formatMinutes(durationMinutes)}</MetaChip>
          <MetaChip>{MODALITY_LABELS[item.modality]}</MetaChip>
          <MetaChip>{item.isRecurring ? "Serie recurrente" : "Clase suelta"}</MetaChip>
          <MetaChip>{lessonStatusLabel(item)}</MetaChip>
          {item.activityKind === "training" && <MetaChip>Entrenamiento</MetaChip>}
          {!item.isMaterialized && <MetaChip>Ocurrencia virtual</MetaChip>}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {pending ? "Guardando el cambio…" : ""}
        </p>

        {error && <Notice tone="bad">{error}</Notice>}

        {step === "reschedule" && (
          <ChangeSchedulePanel
            occurrence={{ id: item.id, start: item.start, end: item.end, recurrenceId: item.recurrenceId, title: item.title, studentName: item.studentName, participantNames }}
            initialScope="single"
            onCancel={() => setReschedulingOpen(false)}
            onDone={onClose}
          />
        )}

        {step === "cancel" && (
          <Notice tone="bad" role="alert">
            ¿Cancelar esta clase? Esta acción queda registrada y es visible para la profesora.
          </Notice>
        )}

        {step === "actions" && (
          <>
            {item.studentId && (
              <section>
                <h3 className="text-label font-bold uppercase text-textMuted">{participantNames.length > 1 ? "Alumnos" : "Alumno"}</h3>
                <PrivateButtonLink href={`/alumnos/${item.studentId}`} variant="secondary" block className="mt-2 !justify-between">
                  <span className="min-w-0 text-left [overflow-wrap:anywhere]">{item.studentName || "Ver perfil"}</span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0" aria-hidden />
                </PrivateButtonLink>
                {otherParticipantNames.length > 0 && (
                  <ul aria-label="Otros alumnos de la clase" className="mt-2 flex flex-col gap-1.5">
                    {otherParticipantNames.map((name, index) => (
                      <li key={`${name}-${index}`} className="rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-2 text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

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

            <section className="flex flex-col gap-2">
              {isPast && item.status !== "cancelled" && item.status !== "completed" && (
                <PrivateButtonLink href={item.materializedLessonId ? `/registro/${item.materializedLessonId}` : "/registro"} variant="primary" block>
                  <ClipboardDocumentCheckIcon className="h-5 w-5" aria-hidden />
                  Registrar esta clase
                </PrivateButtonLink>
              )}
              {canReuseSlot && (
                <PrivateButtonLink
                  href={`/calendario/nueva?freedByLessonId=${item.materializedLessonId}&date=${startDateKey}&hour=${Math.floor(startMinutesOfDay / 60)}&minute=${startMinutesOfDay % 60}&duration=${durationMinutes}&modality=${item.modality}`}
                  variant="secondary"
                  block
                >
                  <UserPlusIcon className="h-5 w-5" aria-hidden />
                  Reemplazar con otro alumno
                </PrivateButtonLink>
              )}
              {canEdit && !isPast && (
                <Button variant="secondary" block onClick={() => setReschedulingOpen(true)}>
                  <ArrowPathIcon className="h-5 w-5" aria-hidden />
                  Cambiar horario
                </Button>
              )}
              {item.recurrenceId && (
                <PrivateButtonLink href={seriesDetailHref(item.recurrenceId, calendarPath)} variant="secondary" block>
                  Administrar esta serie
                  <ArrowRightIcon className="h-4 w-4" aria-hidden />
                </PrivateButtonLink>
              )}
            </section>

            {(canEdit || canRestore || canDeleteCancelled) && (
              <section aria-label="Más acciones" className="flex flex-col gap-2 border-t-[1.5px] border-border pt-3">
                {canEdit && <Button variant="secondary" block onClick={() => setParticipantsOpen(true)}><UserPlusIcon className="h-5 w-5" aria-hidden />Modificar participantes de esta clase</Button>}
                {canEdit&&!isPast&&<Button variant="secondary" block onClick={()=>setActivityOpen(true)}>Cambiar tipo de actividad</Button>}
                {canEdit && (
                  <Button variant="secondary" block onClick={() => setEditMode("title")}>
                    <PencilIcon className="h-5 w-5" aria-hidden />
                    Editar nombre de la clase
                  </Button>
                )}
                {canEdit && (
                  <Button variant="secondary" block onClick={() => setEditMode("duration")}>
                    <ClockIcon className="h-5 w-5" aria-hidden />
                    Cambiar duración
                  </Button>
                )}
                {canRestore && (
                  <Button variant="secondary" block onClick={() => setEditMode("restore")}>
                    <ArrowUturnLeftIcon className="h-5 w-5" aria-hidden />
                    {item.status === "rescheduled" ? "Volver a la fecha original" : "Restaurar esta clase"}
                  </Button>
                )}
                {canEdit && item.recurrenceId && (
                  <Button variant="dangerOutline" block onClick={() => setEditMode("delete-series")}>
                    <TrashIcon className="h-5 w-5" aria-hidden />
                    Eliminar esta y las siguientes
                  </Button>
                )}
                {canDeleteCancelled && (
                  <Button variant="dangerOutline" block onClick={() => setEditMode("delete")}>
                    <TrashIcon className="h-5 w-5" aria-hidden />
                    Eliminar clase cancelada
                  </Button>
                )}
              </section>
            )}

            {canEdit && !isCancelled && (
              <section className="border-t-[1.5px] border-border pt-3">
                <Button variant="dangerOutline" block onClick={() => setConfirmingCancel(true)}>
                  <XCircleIcon className="h-5 w-5" aria-hidden />
                  Cancelar esta clase
                </Button>
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
