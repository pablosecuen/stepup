"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@heroicons/react/24/outline";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { changeLessonDurationAction, deleteCancelledLessonAction, deleteSeriesFromOccurrenceAction, editLessonTitleAction, restoreOccurrenceAction, type LessonRefInput } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { CLASS_TITLE_MAX_LENGTH, DURATION_OPTIONS_MINUTES, lessonDurationMinutes, validateClassTitleInput, type LessonEditScope } from "@/lib/calendar/lesson-edit";
import { formatCivilDayLabelShort, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export type LessonEditMode = "title" | "duration" | "restore" | "delete" | "delete-series";

/** La clase tal como la ve la pantalla; el servidor resuelve nombres y niveles de los alumnos, nunca se toman de acá. */
export function lessonRefFromItem(item: CalendarViewItem): LessonRefInput {
  return {
    viewItemId: item.id,
    lessonId: item.materializedLessonId,
    recurrenceId: item.recurrenceId,
    occurrenceKey: item.occurrenceKey,
    primaryStudentId: item.studentId ?? "",
    participantIds: item.participantIds,
    lessonType: item.lessonType,
    startAt: item.start,
    endAt: item.end,
    modality: item.modality,
    classTitle: item.title,
    activityKind: item.activityKind,
  };
}

const SCOPE_LABEL: Record<LessonEditScope, string> = {
  occurrence: "Sólo esta clase",
  thisAndFuture: "Esta y las siguientes",
  series: "Toda la serie",
};

/** Opciones excluyentes en botones grandes (radios nativos: teclado y lector de pantalla); la elegida lleva tilde además del color. */
function ChoiceGroup<T extends string | number>({ legend, name, value, options, onChange, disabled, columns }: { legend: string; name: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; columns?: boolean }) {
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1.5 text-sm font-[650] text-textSecondary">{legend}</legend>
      <div className={columns ? "grid grid-cols-3 gap-2" : "flex flex-col gap-2"}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={`flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-md border-[1.5px] px-3 text-[15px] font-[650] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 ${columns ? "justify-center" : ""} ${
                selected ? "border-ink bg-ink text-background" : "border-borderStrong bg-surface text-textPrimary hover:border-ink"
              }`}
            >
              <input type="radio" name={name} value={String(option.value)} checked={selected} onChange={() => onChange(option.value)} disabled={disabled} className="sr-only" />
              {selected && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Pasos de una sola clase del Calendario que la app original resolvía desde su hoja de acciones: nombre, duración, restaurar, eliminar una cancelada y eliminar «esta y las siguientes».
 * Todo corre en el servidor (la base valida: nunca se toca una clase dictada, con registro o con cobro) y cada paso vuelve a las acciones con «Volver».
 */
export function LessonEditDialog({ item, mode, onBack, onDone }: { item: CalendarViewItem; mode: LessonEditMode; onBack: () => void; onDone: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<"replace" | "overlap" | null>(null);
  const [title, setTitle] = useState(item.title ?? "");
  const [minutes, setMinutes] = useState<number>(lessonDurationMinutes(item.start, item.end));
  const [scope, setScope] = useState<LessonEditScope>("occurrence");
  const ref = lessonRefFromItem(item);
  const label = item.title?.trim() || item.studentName || "Clase";
  const dateLabel = `${formatCivilDayLabelShort(instantDateKey(item.start))} · ${instantTimeLabel(item.start)}`;

  function run(task: () => Promise<{ error?: string; conflict?: boolean; replaces?: boolean }>) {
    if (inFlight.current || pending) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await task();
        if (result.error) {
          setError(result.error);
          setNeedsConfirm(result.replaces ? "replace" : result.conflict ? "overlap" : null);
          return;
        }
        router.refresh();
        onDone();
      } finally {
        inFlight.current = false;
      }
    });
  }

  function submit(confirmed = false) {
    if (mode === "title") {
      const validation = validateClassTitleInput(title);
      if (!validation.valid) {
        setError(validation.error);
        return;
      }
      run(() => guardNetwork(() => editLessonTitleAction({ ref, title, scope, confirmReplace: confirmed && needsConfirm === "replace" })));
    } else if (mode === "duration") {
      run(() => guardNetwork(() => changeLessonDurationAction({ ref, minutes, scope: scope === "series" ? "occurrence" : scope, confirmReplace: confirmed && needsConfirm === "replace", allowOverlap: confirmed && needsConfirm === "overlap" })));
    } else if (mode === "restore") {
      run(() => guardNetwork(() => restoreOccurrenceAction({ lessonId: item.materializedLessonId ?? "", confirmOverlap: confirmed && needsConfirm === "overlap" })));
    } else if (mode === "delete") {
      run(() => guardNetwork(() => deleteCancelledLessonAction({ lessonId: item.materializedLessonId ?? "" })));
    } else if (item.recurrenceId) {
      run(() => guardNetwork(() => deleteSeriesFromOccurrenceAction({ ruleId: item.recurrenceId as string, startAt: item.start })));
    }
  }

  const scopeOptions = (mode === "title" ? (["occurrence", "thisAndFuture", "series"] as const) : (["occurrence", "thisAndFuture"] as const)).map((value) => ({ value, label: SCOPE_LABEL[value] }));
  const heading = { title: "Nombre de la clase", duration: "Duración de la clase", restore: "Restaurar esta clase", delete: "Eliminar definitivamente", "delete-series": "Eliminar esta y todas las siguientes" }[mode];
  const primaryLabel = {
    title: "Guardar nombre",
    duration: "Guardar duración",
    restore: item.status === "rescheduled" ? "Volver a la fecha original" : "Restaurar clase",
    delete: "Eliminar",
    "delete-series": "Eliminar serie",
  }[mode];
  const destructive = mode === "delete" || mode === "delete-series";

  const footer = (
    <>
      <Button variant="secondary" onClick={onBack} disabled={pending}>
        Volver
      </Button>
      {needsConfirm ? (
        <Button variant="primary" busy={pending} onClick={() => submit(true)}>
          {pending ? "Guardando…" : needsConfirm === "replace" ? "Confirmar y guardar" : mode === "restore" ? "Restaurar igual" : "Guardar igual"}
        </Button>
      ) : (
        <Button variant={destructive ? "danger" : "primary"} busy={pending} onClick={() => submit()}>
          {pending ? "Guardando…" : primaryLabel}
        </Button>
      )}
    </>
  );

  return (
    <Dialog title={heading} size="md" onClose={onBack} onBeforeClose={() => !pending} busy={pending} footer={footer}>
      <p className="text-[14px] text-textSecondary [overflow-wrap:anywhere]">
        <strong className="font-[650] text-textPrimary">{label}</strong> · {dateLabel}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Guardando el cambio…" : ""}
      </p>
      {error && <Notice tone={needsConfirm ? "warn" : "bad"}>{error}</Notice>}

      {mode === "title" && (
        <>
          <Field label="Nombre de la clase" htmlFor={`${uid}-title`} hint="Dejalo vacío para volver a mostrar el nombre automático según los alumnos.">
            <TextInput id={`${uid}-title`} type="text" maxLength={CLASS_TITLE_MAX_LENGTH} autoComplete="off" placeholder="Ej: Conversación B2, Grupo de los lunes…" value={title} onChange={(e) => { setTitle(e.target.value); setNeedsConfirm(null); }} disabled={pending} />
          </Field>
          {item.isRecurring && <ChoiceGroup legend="¿Dónde querés aplicar el nuevo nombre?" name={`${uid}-scope`} value={scope} options={scopeOptions} onChange={(next) => { setScope(next); setNeedsConfirm(null); }} disabled={pending} />}
          {item.isRecurring && <p className="text-[13px] text-textMuted">Nunca se tocan las clases pasadas.</p>}
        </>
      )}

      {mode === "duration" && (
        <>
          <ChoiceGroup legend="Duración" name={`${uid}-minutes`} columns value={minutes} options={DURATION_OPTIONS_MINUTES.map((value) => ({ value, label: `${value} min` }))} onChange={(next) => { setMinutes(next); setNeedsConfirm(null); }} disabled={pending} />
          {item.isRecurring && <ChoiceGroup legend="¿Dónde querés aplicar la nueva duración?" name={`${uid}-scope`} value={scope === "series" ? "occurrence" : scope} options={scopeOptions} onChange={(next) => { setScope(next); setNeedsConfirm(null); }} disabled={pending} />}
          {item.isRecurring && <p className="text-[13px] text-textMuted">Nunca se tocan las clases pasadas.</p>}
        </>
      )}

      {mode === "restore" && (
        <p className="text-[15px] text-textSecondary">
          {item.status === "rescheduled" ? "La clase vuelve a su fecha y hora originales y deja de figurar como reprogramada." : "Vuelve a dejar activa la fecha original: la clase deja de figurar como cancelada."} La duración se conserva. Si ya tiene un registro o un cobro, no se restaura para conservar el historial.
        </p>
      )}

      {mode === "delete" && (
        <Notice tone="warn" title="Eliminar definitivamente">
          La tarjeta desaparece. Si pertenece a una repetición, esta fecha queda excluida para que no vuelva a aparecer. Si la clase tiene un registro o un cobro asociado, no se elimina para conservar el historial.
        </Notice>
      )}

      {mode === "delete-series" && (
        <Notice tone="warn" title="Eliminar esta y todas las siguientes">
          Esta clase y todas las siguientes de la serie dejan de aparecer en la agenda (las que ya tienen registro no se tocan). Las clases anteriores y todo lo ya registrado se conservan.
        </Notice>
      )}
    </Dialog>
  );
}
