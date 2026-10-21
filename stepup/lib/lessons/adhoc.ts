/**
 * Puerto real y acotado de `NewClassScreen.tsx`/`validation.ts`/
 * `lessonRegistrationDomain.ts` (móvil) — registro de una clase SIN reserva
 * previa de Calendario (`calendar_lesson_id: null`).
 *
 * `AdhocOutcome` es un subconjunto de `EventType` (móvil). Fase 4 excluyó
 * deliberadamente `cancelada_con_aviso`/`cancelada_tarde` (exigían
 * `lateCancellationPolicy`, motor financiero de Fase 5) y `reprogramada` —
 * Fase 5 los cierra ahora que ese motor existe (ver `adhoc-billing.ts`).
 * `alumno_ausente` (sólo clase INDIVIDUAL, con o sin aviso): la app lo vuelve a
 * ofrecer desde 2026-08-12 como resultado de la clase individual; en un grupo
 * la ausencia de un participante sigue expresándose con su asistencia. No se
 * dictó: no cuenta como clase, no suma horas y no cobra.
 */
export type AdhocOutcome = "clase_dictada" | "profesora_ausente" | "feriado" | "cancelada_con_aviso" | "cancelada_tarde" | "reprogramada" | "alumno_ausente";

export const ADHOC_OUTCOME_LABEL: Record<AdhocOutcome, string> = {
  clase_dictada: "Realizada",
  alumno_ausente: "Alumno ausente",
  profesora_ausente: "Profesora ausente",
  feriado: "Feriado",
  cancelada_con_aviso: "Cancelada con aviso",
  cancelada_tarde: "Cancelada tarde",
  reprogramada: "Reprogramada",
};

/**
 * Puerto de `LateCancellationPolicy` (móvil) — sólo aplica cuando
 * `outcome === 'cancelada_tarde'`. `'cobrar_porcentaje'` exige
 * `lateCancellationPercentage`; el resto lo ignora.
 */
export type LateCancellationPolicy = "cobrar_100" | "cobrar_porcentaje" | "descontar_del_paquete" | "no_cobrar";

export const LATE_CANCELLATION_POLICY_LABEL: Record<LateCancellationPolicy, string> = {
  cobrar_100: "Cobrar el 100%",
  cobrar_porcentaje: "Cobrar un porcentaje",
  descontar_del_paquete: "Descontar del paquete",
  no_cobrar: "No cobrar",
};

/**
 * Puerto exacto de `isClassHeld` (móvil, `validation.ts`): si el resultado
 * implica que la actividad efectivamente se dictó — asistencia, notas por
 * habilidad y tareas sólo aplican cuando esto es `true`. Un feriado sólo
 * cuenta como dictado con la excepción manual marcada.
 */
export function isAdhocClassHeld(outcome: AdhocOutcome, holidayException: boolean): boolean {
  if (outcome === "clase_dictada") return true;
  if (outcome === "feriado") return holidayException;
  return false;
}

/** Fin de una clase: inicio + duración EXACTA en minutos, sin redondeos (cruza la medianoche sin ajustes). */
export function adhocEndAt(startAtIso: string, durationMinutes: number): string {
  return new Date(new Date(startAtIso).getTime() + durationMinutes * 60_000).toISOString();
}

export interface AdhocRegistrationInput {
  studentIds: string[];
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  durationMinutes: number;
  modality: string;
}

/** Puerto acotado de `validateNewClassForm` (móvil) — sólo las reglas que aplican sin campos financieros/reprogramación. */
export function validateAdhocRegistrationInput(input: AdhocRegistrationInput): string[] {
  const errors: string[] = [];
  if (input.studentIds.length === 0) errors.push("Elegí al menos un alumno.");
  if (!input.date) errors.push("Falta la fecha.");
  if (!input.time) errors.push("Falta la hora.");
  if (!input.durationMinutes || input.durationMinutes <= 0) errors.push("La duración tiene que ser mayor a 0.");
  if (!input.modality) errors.push("Falta la modalidad.");
  return errors;
}
