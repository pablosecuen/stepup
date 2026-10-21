"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDaysIcon, ChevronRightIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { changeRegistrationOutcomeAction } from "@/lib/actions/lesson-registrations";
import { guardNetwork } from "@/lib/actions/network-guard";
import { LATE_CANCELLATION_POLICY_LABEL, type AdhocOutcome, type LateCancellationPolicy } from "@/lib/lessons/adhoc";
import { lateCancellationSummary, outcomeLabel, outcomeNotice, outcomeOptions, validateOutcomeDraft, type AbsenceNotice, type OutcomeOption } from "@/lib/lessons/registration-outcome";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextArea, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";
import { FormErrorBox } from "@/components/auth/form-boxes";

const POLICIES: LateCancellationPolicy[] = ["cobrar_100", "cobrar_porcentaje", "descontar_del_paquete", "no_cobrar"];

/**
 * «Resultado de la clase» — lo primero del formulario de registro, como en la app anterior («¿Qué pasó con esta clase?»). Muestra el resultado vigente y permite cambiarlo
 * mientras el registro está en curso: Realizada, Profesora ausente, Cancelada con aviso, Cancelada tarde (con su política de cobro), Reprogramada y Feriado (con la excepción
 * «igual se dictó o se cobró») y, sólo en una clase individual, Alumno ausente con o sin aviso. Cualquier resultado distinto de «Realizada» cierra el registro en el acto.
 * «Reprogramada» pide primero la nueva fecha en el calendario (igual que la app). Nunca queda una asistencia «presente» implícita sin esta forma de indicar otro resultado.
 */
export function RegistrationOutcomeField({
  registrationId,
  current,
  currentHolidayException,
  isGroup,
  alreadyRescheduled,
  rescheduleHref,
}: {
  registrationId: string;
  current: { outcome: AdhocOutcome; absenceNotice?: AbsenceNotice };
  currentHolidayException: boolean;
  isGroup: boolean;
  /** La clase ya tiene nueva fecha en el calendario. */
  alreadyRescheduled: boolean;
  /** Dónde elegir la nueva fecha (flujo de reprogramar del calendario). */
  rescheduleHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = outcomeOptions(isGroup);
  const initialKey = options.find((option) => option.outcome === current.outcome && option.absenceNotice === current.absenceNotice)?.key ?? "clase_dictada";
  const [key, setKey] = useState(initialKey);
  const [holidayException, setHolidayException] = useState(currentHolidayException);
  const [policy, setPolicy] = useState<LateCancellationPolicy | null>(null);
  const [percentage, setPercentage] = useState("50");
  const [observation, setObservation] = useState("");

  const choice: OutcomeOption = options.find((option) => option.key === key) ?? options[0];
  const percentageValue = percentage.trim() === "" ? null : Number(percentage);
  const notice = outcomeNotice(choice);
  const draftErrors = validateOutcomeDraft({
    outcome: choice.outcome,
    absenceNotice: choice.absenceNotice,
    holidayException,
    lateCancellationPolicy: policy,
    lateCancellationPercentage: percentageValue !== null && Number.isFinite(percentageValue) ? percentageValue : null,
    alreadyRescheduled,
    isGroup,
  });
  const needsNewDate = choice.outcome === "reprogramada" && !alreadyRescheduled;
  const isHeld = choice.outcome === "clase_dictada" || (choice.outcome === "feriado" && holidayException);

  function openDialog() {
    setError(null);
    setKey(initialKey);
    setHolidayException(currentHolidayException);
    setOpen(true);
  }

  function save() {
    setError(null);
    if (draftErrors.length > 0) {
      setError(draftErrors.join(" "));
      return;
    }
    const unchanged = choice.outcome === current.outcome && choice.absenceNotice === current.absenceNotice && holidayException === currentHolidayException && isHeld;
    if (unchanged) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await guardNetwork(() => changeRegistrationOutcomeAction({
        lessonRegistrationId: registrationId,
        outcome: choice.outcome,
        absenceNotice: choice.absenceNotice,
        holidayException,
        lateCancellationPolicy: policy,
        lateCancellationPercentage: policy === "cobrar_porcentaje" ? percentageValue : null,
        observation: isHeld ? undefined : observation,
      }));
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result.data?.closed) router.push("/registro");
      else router.refresh();
    });
  }

  const footer = (
    <>
      <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
        Cancelar
      </Button>
      {needsNewDate ? (
        <Button variant="primary" onClick={() => router.push(rescheduleHref)} disabled={pending}>
          Elegir nueva fecha
        </Button>
      ) : (
        <Button variant="primary" onClick={save} busy={pending} data-autofocus>
          {pending ? "Guardando..." : isHeld ? "Listo" : "Guardar resultado"}
        </Button>
      )}
    </>
  );

  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border-[1.5px] border-border bg-surface px-4 py-3 shadow-card">
        <div className="min-w-0">
          <p className="text-label font-bold uppercase text-textMuted">Resultado de la clase</p>
          <p className="mt-0.5 text-[16px] font-bold text-textPrimary [overflow-wrap:anywhere]">{outcomeLabel(current)}</p>
        </div>
        <Button variant="secondary" onClick={openDialog} aria-label={`Resultado de la clase: ${outcomeLabel(current)}. Cambiar`}>
          Cambiar
          <ChevronRightIcon className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {open && (
        <Dialog title="¿Qué pasó con esta clase?" onClose={() => setOpen(false)} size="md" footer={footer} busy={pending}>
          <div className="flex flex-col gap-4">
            {error && <FormErrorBox message={error} />}

            <fieldset className="min-w-0">
              <legend className="sr-only">Resultado de la clase</legend>
              <div className={choiceGroupClass} role="radiogroup" aria-label="Resultado de la clase">
                {options.map((option) => (
                  <label key={option.key} className={choiceRowClass}>
                    <input type="radio" name="registration-outcome" className={checkClass} checked={key === option.key} onChange={() => setKey(option.key)} />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {notice && (
              <p className="flex items-start gap-2 rounded-md bg-paperDeep px-3 py-2.5 text-[14px] text-textSecondary">
                <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                {notice}
              </p>
            )}

            {choice.outcome === "feriado" && (
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-textPrimary">
                <input type="checkbox" className={checkClass} checked={holidayException} onChange={(e) => setHolidayException(e.target.checked)} />
                Excepción: igual se dictó o se cobró
              </label>
            )}

            {choice.outcome === "cancelada_tarde" && (
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="text-[14px] font-bold text-textPrimary">Política de cancelación tardía</legend>
                <div className={choiceGroupClass} role="radiogroup" aria-label="Política de cancelación tardía">
                  {POLICIES.map((option) => (
                    <label key={option} className={choiceRowClass}>
                      <input type="radio" name="late-cancellation-policy" className={checkClass} checked={policy === option} onChange={() => setPolicy(option)} />
                      {LATE_CANCELLATION_POLICY_LABEL[option]}
                    </label>
                  ))}
                </div>
                {policy === "cobrar_porcentaje" && (
                  <div className="sm:w-56">
                    <Field label="Porcentaje a cobrar (0 a 100)" htmlFor="late-cancellation-percentage">
                      <TextInput id="late-cancellation-percentage" type="number" min="0" max="100" value={percentage} onChange={(e) => setPercentage(e.target.value)} />
                    </Field>
                  </div>
                )}
                <p className="text-[13.5px] text-textMuted">{lateCancellationSummary(policy, percentageValue)}</p>
              </fieldset>
            )}

            {choice.outcome === "reprogramada" && (
              <p className="flex items-start gap-2 rounded-md bg-paperDeep px-3 py-2.5 text-[14px] text-textSecondary">
                <CalendarDaysIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                {alreadyRescheduled ? "Esta clase ya tiene una nueva fecha en el calendario." : "Esta clase todavía no tiene una nueva fecha. Elegila en el calendario y después volvé a registrarla."}
              </p>
            )}

            {!isHeld && !needsNewDate && (
              <Field label="Observación (opcional)" htmlFor="outcome-observation" hint="Queda como observación interna de la clase; no se incluye en reportes.">
                <TextArea id="outcome-observation" rows={3} placeholder="Observación" value={observation} onChange={(e) => setObservation(e.target.value)} />
              </Field>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
