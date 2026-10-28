"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startLiveClassAction } from "@/lib/actions/live-class";
import { guardNetwork } from "@/lib/actions/network-guard";
import { arrivalFromChoice, arrivalFromLateTime, arrivalQuestion, ARRIVAL_CHOICES, earlyStartMessage, instantFromClockTime, minutesStartingEarly, type ArrivalChoice } from "@/lib/live-class/live-class";
import type { StudentArrival } from "@/lib/payments/engine/features/new-class/types";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { requestLiveClassNotificationPermission } from "@/components/dashboard/live-class-notifier";

type Step = "question" | "late_time" | "confirm_early";

/**
 * «Comenzar clase» (puerto de `StartClassPunctualityDialog`): antes de arrancar se pregunta si el alumno llegó a horario. Nunca se asume que llegó tarde porque la profesora tocó tarde el botón: se
 * contesta acá. Si la demora fue de la profesora o hubo un acuerdo, no perjudica al alumno (queda aparte, fuera del puntaje). Si se está comenzando antes del horario se pide confirmación.
 */
export function StartClassDialog({ item, studentNames, onClose }: { item: CalendarViewItem; studentNames: string[]; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [step, setStep] = useState<Step>("question");
  const [pendingArrival, setPendingArrival] = useState<StudentArrival | null>(null);
  const [lateTime, setLateTime] = useState(() => instantTimeLabel(item.start));
  const [error, setError] = useState<string | null>(null);

  function submit(arrival: StudentArrival) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    // Se pide el permiso del aviso con este toque (los navegadores no lo permiten sin una acción de la persona); si se rechaza, la clase comienza igual.
    void requestLiveClassNotificationPermission();
    startTransition(async () => {
      const result = await guardNetwork(() => startLiveClassAction({ calendarLessonId: item.materializedLessonId, recurrenceId: item.recurrenceId, occurrenceKey: item.occurrenceKey, recurrenceIndex: null, arrival }));
      inFlight.current = false;
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  // Igual que el original: si se comienza antes del horario efectivo, primero se confirma.
  function proceed(arrival: StudentArrival) {
    const early = minutesStartingEarly(new Date().toISOString(), item.start);
    if (early > 0) {
      setPendingArrival(arrival);
      setStep("confirm_early");
      return;
    }
    submit(arrival);
  }

  function choose(choice: ArrivalChoice) {
    if (choice === "late") {
      setError(null);
      setStep("late_time");
      return;
    }
    proceed(arrivalFromChoice(choice));
  }

  function applyLateTime(arrivedAtIso: string | null) {
    if (!arrivedAtIso) {
      setError("Ingresá una hora válida.");
      return;
    }
    setError(null);
    proceed(arrivalFromLateTime(arrivedAtIso, item.start));
  }

  const title = step === "question" ? arrivalQuestion(studentNames) : step === "late_time" ? `¿A qué hora llegó ${studentNames.join(", ")}?` : earlyStartMessage(minutesStartingEarly(new Date().toISOString(), item.start));

  return (
    <Dialog title="Comenzar clase" size="sm" placement="center" onClose={onClose} onBeforeClose={() => !pending} busy={pending}>
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Comenzando la clase…" : ""}
      </p>
      <h3 className="font-display text-[18px] font-semibold leading-snug [overflow-wrap:anywhere]">{title}</h3>
      {error && <Notice tone="bad">{error}</Notice>}

      {step === "question" && (
        <div className="mt-3 flex flex-col gap-2">
          {ARRIVAL_CHOICES.map(({ choice, label }) => (
            <Button key={choice} variant="secondary" block disabled={pending} onClick={() => choose(choice)}>
              {label}
            </Button>
          ))}
        </div>
      )}

      {step === "late_time" && (
        <div className="mt-3 flex flex-col gap-3">
          <Button variant="primary" block busy={pending} onClick={() => applyLateTime(new Date().toISOString())}>
            Usar la hora actual
          </Button>
          <p className="text-center text-[14px] text-textSecondary">o ingresá una hora manual</p>
          <Field label="Hora de llegada" htmlFor={`${uid}-late`} hint="Hora de Argentina, el mismo día de la clase.">
            <TextInput id={`${uid}-late`} type="time" value={lateTime} onChange={(event) => setLateTime(event.target.value)} />
          </Field>
          <Button variant="secondary" block disabled={pending} onClick={() => applyLateTime(instantFromClockTime(item.start, lateTime))}>
            Aplicar hora ingresada
          </Button>
          <Button variant="ghost" block disabled={pending} onClick={() => setStep("question")}>
            Volver
          </Button>
        </div>
      )}

      {step === "confirm_early" && pendingArrival && (
        <div className="mt-3 flex flex-col gap-2">
          <Button variant="primary" block busy={pending} onClick={() => submit(pendingArrival)}>
            Comenzar antes
          </Button>
          <Button variant="secondary" block disabled={pending} onClick={() => setStep("question")}>
            Volver
          </Button>
        </div>
      )}
    </Dialog>
  );
}
