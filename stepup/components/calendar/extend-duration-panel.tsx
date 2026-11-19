"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@heroicons/react/24/outline";
import { extendLessonDurationAction } from "@/lib/actions/lesson-duration";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { describeExtension, extendOptions, type ExtendIncrement } from "@/lib/calendar/extend-duration";
import { formatCivilDayLabelShort, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";

export interface ExtendDurationLesson {
  id: string;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  start: string;
  end: string;
  title: string | null;
  studentName: string;
}

/**
 * «Extender duración»: +15, +30 o +60 minutos sobre ESTA clase, sin tocar el resto de su serie. Abre con el horario actual y ninguna opción elegida; al elegir muestra enseguida el nuevo fin y la
 * duración total. Las opciones que superan el máximo de duración o la jornada del calendario quedan deshabilitadas con su motivo. Confirmar valida y guarda en el servidor (agenda,
 * disponibilidad y cambios desde otro dispositivo); ante un choque conserva la selección y dice con qué clase o bloqueo. Cancelar no cambia nada.
 */
export function ExtendDurationPanel({ lesson, onCancel, onDone }: { lesson: ExtendDurationLesson; onCancel: () => void; onDone: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<ExtendIncrement | null>(null);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [doneEnd, setDoneEnd] = useState<string | null>(null);

  const options = extendOptions(lesson.start, lesson.end);
  const current = describeExtension(lesson.start, lesson.end);
  const chosen = options.find((option) => option.minutes === selected && option.disabledReason === null) ?? null;
  const result = chosen ? describeExtension(lesson.start, chosen.newEnd) : null;
  const allDisabled = options.every((option) => option.disabledReason !== null);

  function confirm() {
    if (!chosen || inFlight.current || pending) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const request = { viewItemId: lesson.id, recurrenceId: lesson.recurrenceId, occurrenceKey: lesson.occurrenceKey, startAt: lesson.start, endAt: lesson.end, minutes: chosen.minutes };
        const response = await guardNetwork(() => extendLessonDurationAction(request));
        if (response.error) {
          // La selección se conserva: la profesora puede elegir otra opción o cancelar.
          setError({ message: response.error, stale: response.stale === true });
          return;
        }
        setDoneEnd(response.newEnd ?? chosen.newEnd);
        router.refresh();
      } finally {
        inFlight.current = false;
      }
    });
  }

  if (doneEnd) {
    const finished = describeExtension(lesson.start, doneEnd);
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="ok" title="Cambio guardado">
          La clase ahora va de {finished.range} ({finished.duration}). El resto de la serie y los cobros no cambian.
        </Notice>
        <div>
          <Button variant="primary" onClick={onDone} data-autofocus>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="rounded-md border-[1.5px] border-border bg-surface2 p-3">
        <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">{lesson.title?.trim() || lesson.studentName || "Clase"}</p>
        <p className="text-[14px] text-textSecondary">
          Ahora: {formatCivilDayLabelShort(instantDateKey(lesson.start))} · {current.range} · {current.duration}
        </p>
      </div>

      <fieldset className="flex min-w-0 flex-col" disabled={pending}>
        <legend className="mb-1.5 text-[14px] font-[650] text-textSecondary">¿Cuánto más dura?</legend>
        <div className="flex flex-col gap-2 sm:grid sm:grid-cols-3">
          {options.map((option) => {
            const isSelected = option.minutes === selected && option.disabledReason === null;
            const disabled = option.disabledReason !== null;
            return (
              <label
                key={option.minutes}
                className={`flex min-h-12 select-none flex-col justify-center rounded-md border-[1.5px] px-3 py-1.5 text-[15px] font-[650] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink has-[:focus-visible]:ring-offset-2 ${
                  disabled ? "cursor-not-allowed border-border bg-paperDeep text-textMuted" : `cursor-pointer ${isSelected ? "border-ink bg-ink text-background" : "border-borderStrong bg-surface text-textPrimary hover:border-ink"}`
                }`}
              >
                <input
                  type="radio"
                  name={`${uid}-extend`}
                  value={option.minutes}
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => {
                    setSelected(option.minutes);
                    setError(null);
                  }}
                  className="sr-only"
                />
                <span className="inline-flex items-center gap-2">
                  {isSelected && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
                  +{option.minutes} min
                </span>
                {option.disabledReason && <span className="text-[12.5px] font-normal">{option.disabledReason}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div role="status" aria-live="polite" className="rounded-md border-[1.5px] border-accentLine bg-accentSoft p-3.5">
        {result && chosen ? (
          <>
            <p className="text-[15px] font-bold text-textPrimary">Quedará así</p>
            <p className="text-[15px] text-textSecondary">
              {instantTimeLabel(lesson.start)}–{instantTimeLabel(lesson.end)} → <strong className="text-textPrimary">{result.range}</strong> · {result.duration}
            </p>
            <p className="text-[13.5px] text-textMuted">Solo esta clase: el inicio, los alumnos y el resto de la serie no cambian, y no se genera ningún cobro nuevo.</p>
          </>
        ) : (
          <p className="text-[15px] font-bold text-textPrimary">{allDisabled ? "Esta clase no se puede extender más." : "Elegí cuánto querés extender la clase."}</p>
        )}
      </div>

      {error && (
        <Notice tone="bad" role="alert">
          <p className="[overflow-wrap:anywhere]">{error.message}</p>
          {error.stale && (
            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  router.refresh();
                  onDone();
                }}
              >
                Actualizar el calendario
              </Button>
            </div>
          )}
        </Notice>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Button variant="primary" busy={pending} disabled={!chosen || pending} onClick={confirm}>
          {pending ? "Guardando..." : chosen ? `Extender ${chosen.minutes} min` : "Extender duración"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
