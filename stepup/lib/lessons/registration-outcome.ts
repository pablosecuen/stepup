import { isAdhocClassHeld, LATE_CANCELLATION_POLICY_LABEL, type AdhocOutcome, type LateCancellationPolicy } from "./adhoc.ts";
import type { AttendanceStatus } from "./attendance.ts";

/**
 * Resultado de una clase PROGRAMADA — puerto de `PendingClassOutcomeSelector`/`LessonOutcomeField`/`RegisterPendingClassSheet` (app anterior): «¿Qué pasó con esta
 * clase?» con las mismas opciones, el mismo orden y las mismas reglas. En una clase INDIVIDUAL se suman «Alumno ausente con aviso / sin aviso» (en un grupo la ausencia
 * de un participante sigue siendo su asistencia). PURO.
 */
export type AbsenceNotice = "aviso" | "sin_aviso";

export interface OutcomeChoice {
  outcome: AdhocOutcome;
  /** Sólo con `alumno_ausente`. */
  absenceNotice?: AbsenceNotice;
}

export interface OutcomeOption extends OutcomeChoice {
  key: string;
  label: string;
}

/** Opciones en el orden de la app: Realizada, Profesora ausente, Cancelada con aviso, Cancelada tarde, Reprogramada, Feriado y, si es individual, las dos ausencias del alumno. */
export function outcomeOptions(isGroup: boolean): OutcomeOption[] {
  const common: OutcomeOption[] = [
    { key: "clase_dictada", outcome: "clase_dictada", label: "Realizada" },
    { key: "profesora_ausente", outcome: "profesora_ausente", label: "Profesora ausente" },
    { key: "cancelada_con_aviso", outcome: "cancelada_con_aviso", label: "Cancelada con aviso" },
    { key: "cancelada_tarde", outcome: "cancelada_tarde", label: "Cancelada tarde" },
    { key: "reprogramada", outcome: "reprogramada", label: "Reprogramada" },
    { key: "feriado", outcome: "feriado", label: "Feriado" },
  ];
  if (isGroup) return common;
  return [
    ...common,
    { key: "alumno_ausente_aviso", outcome: "alumno_ausente", absenceNotice: "aviso", label: "Alumno ausente con aviso" },
    { key: "alumno_ausente_sin_aviso", outcome: "alumno_ausente", absenceNotice: "sin_aviso", label: "Alumno ausente sin aviso" },
  ];
}

/** La asistencia que queda guardada para el único alumno cuando no vino. */
export function absenceAttendanceStatus(notice: AbsenceNotice): Extract<AttendanceStatus, "ausente" | "ausente_aviso"> {
  return notice === "aviso" ? "ausente_aviso" : "ausente";
}

/** Texto del resultado elegido (fila «Resultado de la clase»). */
export function outcomeLabel(choice: OutcomeChoice): string {
  if (choice.outcome === "alumno_ausente") return choice.absenceNotice === "aviso" ? "Alumno ausente con aviso" : "Alumno ausente sin aviso";
  return outcomeOptions(true).find((option) => option.outcome === choice.outcome)?.label ?? "Realizada";
}

/** Aviso que explica qué consecuencias tiene el resultado (iguales a los de la app). `null` si no hay nada que aclarar. */
export function outcomeNotice(choice: OutcomeChoice): string | null {
  switch (choice.outcome) {
    case "alumno_ausente":
      return choice.absenceNotice === "aviso" ? "El alumno avisó que no venía — no genera cobro automático." : "El alumno faltó sin avisar — no genera cobro automático.";
    case "cancelada_con_aviso":
      return "Cancelada con aviso: no genera cobro.";
    case "feriado":
      return "Suspendida por feriado — no suma asistencia, horas, cobro ni promedio.";
    default:
      return null;
  }
}

/** Un resultado «sin dictar» (todos menos Realizada y Feriado con excepción) se cierra solo: no hay asistencia, evaluación ni tarea que cargar. */
export function outcomeClosesImmediately(outcome: AdhocOutcome, holidayException: boolean): boolean {
  return !isAdhocClassHeld(outcome, holidayException);
}

export interface OutcomeDraft extends OutcomeChoice {
  holidayException: boolean;
  lateCancellationPolicy: LateCancellationPolicy | null;
  /** Porcentaje a cobrar (sólo con `cobrar_porcentaje`). */
  lateCancellationPercentage: number | null;
  /** La clase ya figura como reprogramada en el calendario (tiene nueva fecha). */
  alreadyRescheduled: boolean;
  isGroup: boolean;
}

/** Errores en lenguaje simple; vacío si el resultado se puede guardar. */
export function validateOutcomeDraft(draft: OutcomeDraft): string[] {
  const errors: string[] = [];
  if (draft.outcome === "alumno_ausente") {
    if (draft.isGroup) errors.push("«Alumno ausente» sólo se puede elegir en una clase individual.");
    else if (!draft.absenceNotice) errors.push("Elegí si el alumno avisó o no.");
  }
  if (draft.outcome === "cancelada_tarde") {
    if (!draft.lateCancellationPolicy) errors.push("Elegí la política de cancelación tardía.");
    else if (draft.lateCancellationPolicy === "cobrar_porcentaje" && !(draft.lateCancellationPercentage !== null && draft.lateCancellationPercentage >= 0 && draft.lateCancellationPercentage <= 100)) {
      errors.push("Indicá el porcentaje a cobrar (de 0 a 100).");
    }
  }
  if (draft.outcome === "reprogramada" && !draft.alreadyRescheduled) errors.push("Esta clase todavía no tiene una nueva fecha: elegila primero.");
  return errors;
}

/** Texto corto de la política elegida (para el resumen). */
export function lateCancellationSummary(policy: LateCancellationPolicy | null, percentage: number | null): string {
  if (!policy) return "Sin política elegida";
  return policy === "cobrar_porcentaje" ? `${LATE_CANCELLATION_POLICY_LABEL[policy]} (${percentage ?? 0}%)` : LATE_CANCELLATION_POLICY_LABEL[policy];
}
