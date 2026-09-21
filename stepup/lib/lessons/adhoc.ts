/**
 * Puerto real y acotado de `NewClassScreen.tsx`/`validation.ts`/
 * `lessonRegistrationDomain.ts` (móvil) — registro de una clase SIN reserva
 * previa de Calendario (`calendar_lesson_id: null`).
 *
 * `AdhocOutcome` es un subconjunto DELIBERADO de `EventType` (móvil):
 * nunca se portan `cancelada_con_aviso`/`cancelada_tarde` (exigen
 * `lateCancellationPolicy`, motor financiero de Fase 5, todavía no
 * implementado) ni `reprogramada` (enlaza a OTRO registro ad-hoc en el
 * móvil — mecanismo distinto y redundante con el reprogramar real de
 * Calendario ya construido en Fase 3). `alumno_ausente` tampoco se porta:
 * el propio móvil dejó de ofrecerlo para elegir (ver
 * `PendingClassOutcomeSelector.tsx`) — la ausencia de un participante se
 * expresa con su asistencia individual, no con un resultado general.
 */
export type AdhocOutcome = "clase_dictada" | "profesora_ausente" | "feriado";

export const ADHOC_OUTCOME_LABEL: Record<AdhocOutcome, string> = {
  clase_dictada: "Realizada",
  profesora_ausente: "Profesora ausente",
  feriado: "Feriado",
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
