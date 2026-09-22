import type { AdhocOutcome, LateCancellationPolicy } from "../lessons/adhoc.ts";

/**
 * Puerto de `computeLessonBilledAmount`/`billingFactor`
 * (`lessonRegistrationDomain.ts`, móvil) — cierra Cancelada/Reprogramada del
 * registro ad-hoc (Fase 5). Devuelve el FACTOR (0..1) a aplicar sobre el
 * precio por clase del alumno — nunca un importe final (eso lo decide el
 * llamador, multiplicando por el precio real del alumno). Independiente de
 * `isAdhocClassHeld` (`lib/lessons/adhoc.ts`): una clase cancelada tarde con
 * política `'cobrar_100'` puede cobrar el 100% SIN haberse dictado — son dos
 * ejes distintos (¿se dictó pedagógicamente? vs. ¿corresponde cobrar?).
 *
 * Regla exacta portada:
 *   'cancelada_tarde' con política:
 *     'cobrar_100'          -> 1
 *     'cobrar_porcentaje'   -> lateCancellationPercentage / 100 (0 si falta)
 *     'descontar_del_paquete' | 'no_cobrar' -> 0
 *   cualquier otro caso: 1 si la clase se dictó (isAdhocClassHeld), 0 si no.
 * `'reprogramada'` cae en el caso general -> nunca se dictó -> factor 0
 * (la eventual clase de recuperación es un registro NUEVO y separado, que
 * cobra por sí mismo si corresponde — nunca un cargo duplicado acá).
 */
export function computeLateCancellationBillingFactor(input: {
  outcome: AdhocOutcome;
  isClassHeld: boolean;
  lateCancellationPolicy: LateCancellationPolicy | null;
  lateCancellationPercentage: number | null;
}): number {
  if (input.outcome === "cancelada_tarde" && input.lateCancellationPolicy) {
    switch (input.lateCancellationPolicy) {
      case "cobrar_100":
        return 1;
      case "cobrar_porcentaje":
        return Number.isFinite(input.lateCancellationPercentage) && (input.lateCancellationPercentage as number) > 0
          ? (input.lateCancellationPercentage as number) / 100
          : 0;
      case "descontar_del_paquete":
      case "no_cobrar":
        return 0;
      default:
        return 0;
    }
  }
  return input.isClassHeld ? 1 : 0;
}

/** Importe final a facturar a UN alumno `'per_class'` por esta clase, redondeado. `null` si el alumno no factura por clase (se resuelve fuera de esta función). */
export function computePerClassBilledAmount(input: {
  perClassAmount: number;
  outcome: AdhocOutcome;
  isClassHeld: boolean;
  lateCancellationPolicy: LateCancellationPolicy | null;
  lateCancellationPercentage: number | null;
}): number {
  const factor = computeLateCancellationBillingFactor(input);
  return Math.round(input.perClassAmount * factor);
}
