// Puerto VERBATIM del original (`src/features/new-class/utils/punctualityClassification.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentArrivalStatus } from '../types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): clasifica la llegada del alumno SIEMPRE contra
 * `effectiveStartAt` (el horario ya ajustado), nunca contra el horario
 * original — un atraso de la profesora nunca debe leerse como que el
 * alumno llegó tarde.
 *
 * Corrección 2026-07-22 (a pedido de Joaquín — "ELIMINAR TOLERANCIA DE
 * PUNTUALIDAD"): se retiró la clasificación automática "dentro de la
 * tolerancia" (dependía de la configuración de minutos ya eliminada).
 * Ahora sólo distingue a horario (0 minutos de demora) de tarde (más de 0).
 * "Dentro de la tolerancia" sigue existiendo como opción MANUAL que la
 * profesora puede elegir ella misma (ver `StartClassPunctualityDialog.tsx`),
 * pero ya nunca se infiere automáticamente a partir de una cantidad de
 * minutos configurada.
 */
export interface ArrivalClassification {
  status: 'on_time' | 'within_grace' | 'late';
  lateMinutes: number;
}

/** Minutos reales de diferencia entre la llegada y el horario efectivo — 0 si llegó antes o justo a horario. */
export function computeLateMinutes(arrivedAtIso: string, effectiveStartAtIso: string): number {
  const arrivedMs = new Date(arrivedAtIso).getTime();
  const effectiveMs = new Date(effectiveStartAtIso).getTime();
  if (arrivedMs <= effectiveMs) return 0;
  return Math.round((arrivedMs - effectiveMs) / 60_000);
}

/**
 * Clasifica una llegada real contra el horario efectivo. Usada
 * exclusivamente para la opción "Llegó tarde" del diálogo de puntualidad —
 * las otras 5 opciones (a horario, dentro de tolerancia, retraso de la
 * profesora, acuerdo mutuo, registrar después) fijan su status
 * directamente, sin pasar por acá.
 */
export function classifyArrival(arrivedAtIso: string, effectiveStartAtIso: string): ArrivalClassification {
  const lateMinutes = computeLateMinutes(arrivedAtIso, effectiveStartAtIso);
  if (lateMinutes === 0) return { status: 'on_time', lateMinutes: 0 };
  return { status: 'late', lateMinutes };
}

/** Minutos que faltan (positivo) o que sobran (negativo) para llegar al horario efectivo — para "Estás comenzando N minutos antes". */
export function computeMinutesBeforeEffectiveStart(nowIso: string, effectiveStartAtIso: string): number {
  const nowMs = new Date(nowIso).getTime();
  const effectiveMs = new Date(effectiveStartAtIso).getTime();
  return Math.round((effectiveMs - nowMs) / 60_000);
}

export const ARRIVAL_STATUS_LABELS: Record<StudentArrivalStatus, string> = {
  on_time: 'A horario',
  within_grace: 'Dentro de la tolerancia',
  late: 'Llegó tarde',
  teacher_delayed: 'La profesora retrasó la clase',
  mutual_adjustment: 'Habían acordado otro horario',
  unknown: 'Sin registrar',
  no_show: 'Ausencia',
};
