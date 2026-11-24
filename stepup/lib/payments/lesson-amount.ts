import type { StudentBillingPlan } from "./billing-plan.ts";

/**
 * Regla ÚNICA de cuánto vale una clase cuando el alumno paga POR HORA:
 *
 *     importe = tarifa por hora × duración facturable (minutos) / 60
 *
 * Un plan «por clase» sin base explícita (todos los que ya existen) sigue siendo un IMPORTE FIJO por clase: nunca se interpreta como tarifa horaria. La base se elige expresamente en
 * «Plan de cobro» y viaja dentro del propio plan (`rateBasis: "hour"`). Quien combina esta regla con el resultado de la clase (dictada, cancelada tarde, no dictada) es
 * `computePerClassBilledAmount` (adhoc-billing.ts). El mismo cálculo se repite, con la misma aritmética exacta, en las funciones SQL `lesson_hourly_amount` y `lesson_billed_amount`
 * (migración 20261124100000): la base valida y, para tarifas por hora, es la autoridad.
 *
 * Aritmética: todo en CENTAVOS ENTEROS (nada de coma flotante sobre importes) y redondeo «mitad hacia arriba» al centavo, igual que `round(numeric, 2)` de Postgres para importes positivos.
 */
export type RateBasis = "class" | "hour";

/** Duración que se asume cuando no hay forma de saberla (mismo último recurso que la pantalla de registro). */
export const DEFAULT_BILLABLE_MINUTES = 60;
/** Tope defensivo: una clase no puede facturar más de un día. */
export const MAX_BILLABLE_MINUTES = 1440;

/** Base de la tarifa de un plan: «hour» sólo si el plan es por clase y lo declara expresamente; en cualquier otro caso, importe fijo. */
export function rateBasisOf(plan: StudentBillingPlan): RateBasis {
  return plan.type === "per_class" && plan.rateBasis === "hour" ? "hour" : "class";
}

/** Importe en centavos enteros (27500.5 → 2750050). Los importes tienen a lo sumo dos decimales: el error de coma flotante de `× 100` es órdenes de magnitud menor que medio centavo. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Importe de UNA clase para una tarifa por hora y una duración en minutos, redondeado al centavo (mitad hacia arriba).
 * 36.000/h: 45 min → 27.000 · 60 → 36.000 · 75 → 45.000 · 90 → 54.000 · 120 → 72.000 · 135 → 81.000.
 */
export function computeHourlyAmount(ratePerHour: number, minutes: number): number {
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return 0;
  const safeMinutes = Math.min(MAX_BILLABLE_MINUTES, Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0)));
  const numerator = toCents(ratePerHour) * safeMinutes + 30; // +30 = mitad de 60: redondeo mitad hacia arriba con enteros
  const cents = (numerator - (numerator % 60)) / 60;
  return cents / 100;
}

function minutesBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
}

/**
 * Duración facturable de una clase, en minutos: la REAL si el registro ya tiene inicio y fin reales (la profesora la confirma o corrige al registrar la clase); si no, la PROGRAMADA
 * (la de la clase del calendario, ya con cualquier «Extender duración» o cambio de horario aplicado); y 60 sólo como último recurso. Es la misma regla que usa la pantalla de registro
 * para proponer la duración, así que lo que se ve ahí es exactamente lo que se factura.
 */
export function resolveBillableMinutes(input: { actualStartedAt?: string | null; actualEndedAt?: string | null; scheduledStartAt?: string | null; scheduledEndAt?: string | null }): number {
  if (input.actualStartedAt && input.actualEndedAt) {
    const actual = minutesBetween(input.actualStartedAt, input.actualEndedAt);
    if (actual > 0) return Math.min(MAX_BILLABLE_MINUTES, actual);
  }
  if (input.scheduledStartAt && input.scheduledEndAt) {
    const scheduled = minutesBetween(input.scheduledStartAt, input.scheduledEndAt);
    if (scheduled > 0) return Math.min(MAX_BILLABLE_MINUTES, scheduled);
  }
  return DEFAULT_BILLABLE_MINUTES;
}
