// Puerto VERBATIM del original (`src/features/payments/utils/paymentTrafficLight.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState, PaymentDueStage } from '../types/index.ts';

// Semáforo VISUAL, derivado siempre de las obligaciones calculadas — nunca
// se lee ni se escribe `Student.paymentStatus`/`StudentProfile.paymentStatus`
// acá. Ese campo sigue siendo el semáforo manual heredado; este es
// independiente a propósito (ver Fase 4A: "sin convertirlo en una tercera
// fuente de verdad").
export type PaymentTrafficLight = 'verde' | 'amarillo' | 'naranja' | 'rojo';

const STAGE_TO_LIGHT: Record<PaymentDueStage, PaymentTrafficLight> = {
  on_time: 'verde',
  first_late: 'amarillo',
  second_late: 'naranja',
  last_late: 'rojo',
};

/** Orden de severidad: 0 es el peor semáforo posible (rojo), 3 el mejor (verde). */
const LIGHT_SEVERITY_RANK: Record<PaymentTrafficLight, number> = {
  rojo: 0,
  naranja: 1,
  amarillo: 2,
  verde: 3,
};

/**
 * Semáforo de UNA obligación: sin deuda (saldada, sea en término o tarde; o
 * con crédito) es siempre verde — el color por etapa sólo aplica a deuda
 * vigente. Una obligación todavía no vencida ya calcula `stage: 'on_time'`
 * en el motor puro, así que da verde sin necesitar un caso especial acá.
 *
 * Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
 * configurables): `collapseToBinary` (opcional, default `false`) colapsa
 * amarillo/naranja/rojo en un único rojo — "en la interfaz del alumno...
 * no mostrar Primer/Segundo/Último vencimiento" también aplica al color,
 * nunca sólo al texto (nunca comunicar un estado importante sólo por
 * color, pero tampoco mostrar un degradé de severidad que ya no tiene
 * recargos asociados). Pura.
 */
export function deriveChargeTrafficLight(state: ChargeComputedState, collapseToBinary = false): PaymentTrafficLight {
  if (state.balance <= 0) return 'verde';
  if (collapseToBinary) return state.stage === 'on_time' ? 'verde' : 'rojo';
  return STAGE_TO_LIGHT[state.stage];
}

/**
 * Semáforo de un alumno con varias obligaciones: la PEOR situación entre
 * todas. Sin obligaciones, verde (nada que deber). Pura — no muta `states`.
 */
export function deriveWorstTrafficLight(states: ChargeComputedState[], collapseToBinary = false): PaymentTrafficLight {
  return states.reduce<PaymentTrafficLight>((worst, state) => {
    const current = deriveChargeTrafficLight(state, collapseToBinary);
    return LIGHT_SEVERITY_RANK[current] < LIGHT_SEVERITY_RANK[worst] ? current : worst;
  }, 'verde');
}
