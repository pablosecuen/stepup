// Puerto VERBATIM del original (`src/features/payments/utils/paymentDueStage.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentChargeType, PaymentDueStage } from '../types/index.ts';
import { daysBetweenDateKeys, toDateKey } from './paymentDates.ts';
import { DEFAULT_SURCHARGE_TIER_VALUES, type SurchargeTierValues } from './surchargeSettings.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): los
 * porcentajes fijos y los umbrales de días de `determineMonthlyDueStage`
 * pasan a ser configurables vía `SurchargeTierValues` — parámetro OPCIONAL
 * en todas las funciones de este archivo, con default
 * `DEFAULT_SURCHARGE_TIER_VALUES` (los mismos números que ya regían antes
 * de esta fase). Ningún llamador existente que no pase el parámetro cambia
 * de comportamiento — sólo los llamadores nuevos que leen la configuración
 * real de la profesora (`calculateChargeState`/`buildStudentPaymentsSummary`
 * y de ahí en adelante) reflejan el valor vigente.
 */

/**
 * Mensual: la etapa depende de en qué día del mes cae la fecha de
 * evaluación, contado desde el día 1 del mes facturado (`dueDate`) — sin
 * importar en qué mes calendario cae la fecha de evaluación, así una deuda
 * de 45 días sigue cayendo en "rojo" aunque haya cruzado un límite de mes.
 *   día 1 (mismo día que dueDate) a `graceDay`: on_time
 *   `graceDay`+1 a `secondLateDay`-1: first_late
 *   `secondLateDay` a `lastLateDay`-1: second_late
 *   `lastLateDay` en adelante: last_late
 * (Por defecto: 1-10 on_time, 11-18 first_late, 19-26 second_late, 27+ last_late.)
 */
export function determineMonthlyDueStage(
  dueDate: string,
  evaluationDate: string,
  tierValues: SurchargeTierValues = DEFAULT_SURCHARGE_TIER_VALUES
): PaymentDueStage {
  const daysElapsed = daysBetweenDateKeys(toDateKey(dueDate), toDateKey(evaluationDate)) + 1;
  if (daysElapsed <= tierValues.graceDay) return 'on_time';
  if (daysElapsed < tierValues.secondLateDay) return 'first_late';
  if (daysElapsed < tierValues.lastLateDay) return 'second_late';
  return 'last_late';
}

/**
 * Por clase: vence el día de la clase (`dueDate`). La etapa depende de los
 * días de atraso desde esa fecha. Deliberadamente NO configurable por esta
 * fase (los días 1-31 de la configuración nueva son días DE MES, no
 * aplican al concepto "días de atraso desde la clase") — conserva sus
 * umbrales propios, sin cambios.
 *   en término (atraso <= 0): on_time
 *   1 a 7 días: first_late
 *   8 a 15 días: second_late
 *   16 en adelante: last_late
 */
export function determinePerClassDueStage(dueDate: string, evaluationDate: string): PaymentDueStage {
  const daysLate = daysBetweenDateKeys(toDateKey(dueDate), toDateKey(evaluationDate));
  if (daysLate <= 0) return 'on_time';
  if (daysLate <= 7) return 'first_late';
  if (daysLate <= 15) return 'second_late';
  return 'last_late';
}

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): quincenal usa umbrales propios, proporcionales a los de
 * mensual (10/18/26 días sobre un ciclo de ~30) escalados a un ciclo de 14
 * días (factor ≈14/30): on_time ≤5, first_late ≤8, second_late ≤12,
 * last_late >12. Igual que `determinePerClassDueStage`, no configurable
 * por esta fase.
 */
export function determineBiweeklyDueStage(dueDate: string, evaluationDate: string): PaymentDueStage {
  const daysElapsed = daysBetweenDateKeys(toDateKey(dueDate), toDateKey(evaluationDate)) + 1;
  if (daysElapsed <= 5) return 'on_time';
  if (daysElapsed <= 8) return 'first_late';
  if (daysElapsed <= 12) return 'second_late';
  return 'last_late';
}

/**
 * Corrección 2026-07-19: extendido a los tipos nuevos de esta fase, sin
 * tocar el comportamiento de `'mensual'`/`'por_clase'` (idénticos a antes).
 * `'semanal'` reutiliza los umbrales de `'por_clase'` tal cual (mismo
 * criterio de "vencimiento de corto plazo", su período completo dura sólo
 * 7 días). `'paquete'` reutiliza los umbrales de `'mensual'` tal cual (se
 * trata como una factura única de monto considerable, no como una clase
 * suelta) — por eso `'paquete'` SÍ es configurable (mismos umbrales que
 * `'mensual'`), mientras que `'semanal'`/`'por_clase'`/`'quincenal'` no lo son.
 *
 * Corrección 2026-09-14 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS, revisión estructural): `'entrenamiento'` reutiliza
 * EXACTAMENTE el mismo camino que `'mensual'` — mismo vencimiento mensual,
 * mismas etapas de recargo, misma configuración vigente
 * (`SurchargeTierValues`). Antes caía en el `default` de clase suelta
 * (7/15 días de gracia) porque este switch no lo conocía — nunca un
 * segundo criterio de vencimiento, esta es la única función real que
 * decide la etapa de cualquier cargo, y todo consumidor
 * (`calculateChargeState`, resúmenes, asignación de pagos) ya la llama de
 * forma genérica con `charge.type` — agregar el caso acá alcanza para
 * corregirlos a todos a la vez, sin tocar ninguno de ellos.
 */
export function determineDueStage(
  chargeType: PaymentChargeType,
  dueDate: string,
  evaluationDate: string,
  tierValues: SurchargeTierValues = DEFAULT_SURCHARGE_TIER_VALUES
): PaymentDueStage {
  switch (chargeType) {
    case 'mensual':
    case 'entrenamiento':
    case 'paquete':
      return determineMonthlyDueStage(dueDate, evaluationDate, tierValues);
    case 'quincenal':
      return determineBiweeklyDueStage(dueDate, evaluationDate);
    case 'semanal':
    case 'por_clase':
    default:
      return determinePerClassDueStage(dueDate, evaluationDate);
  }
}

/**
 * Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
 * confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
 * monetarias automáticas"): ÚNICO punto de todo el proyecto donde se
 * calcula dinero de recargo (ver los 3 llamadores reales:
 * `paymentCalculations.ts`/`calculateChargeState`,
 * `financialReconciliation.ts`/reparaciones de recargo fantasma). Devuelve
 * SIEMPRE 0 — nunca lee `tierValues.enabled` ni ningún otro campo — así
 * ninguna llamada futura puede reintroducir un recargo automático, ni
 * siquiera pasando a mano un `SurchargeTierValues` con `enabled: true` o
 * porcentajes propios (bypasseando `resolveEffectiveSurchargeTierValues`,
 * que también normaliza, pero cuya sanitización nunca debe ser la ÚNICA
 * barrera). `originalAmount`/`stage`/`tierValues` se conservan en la firma
 * sólo por compatibilidad de los ~90 llamadores existentes — nunca se leen.
 * "Mora" sigue existiendo como estado VISUAL de atraso
 * (`determineDueStage`, más abajo) — nunca vuelve a aumentar un importe.
 */
export function calculateSurchargeAmount(
  _originalAmount: number,
  _stage: PaymentDueStage,
  _tierValues: SurchargeTierValues = DEFAULT_SURCHARGE_TIER_VALUES
): number {
  return 0;
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidades
// "Mes vencido" al comenzar el mes): concepto DELIBERADAMENTE separado de
// `determineMonthlyDueStage`/`SurchargeTierValues` de arriba — ese motor mide
// etapas de RECARGO (dinero), con una ventana de gracia que cuenta días
// DESDE `dueDate` hacia adelante (`graceDay` días de margen), pensada para
// cuando `dueDate` era siempre el día 1 del período. Este resolver mide algo
// distinto: si una mensualidad está "en término" respecto de SU PROPIA fecha
// de vencimiento real (`dueDate`, ya sea el día 10 configurado o cualquier
// otro) — únicamente para decidir si necesita ATENCIÓN/aviso, nunca cuánto
// recargo corresponde. Nunca se mezclan: cambiar `dueDate` de día 1 a día 10
// no debe (ni debería) alterar CUÁNTOS días de gracia de RECARGO tiene un
// cargo — eso sigue siendo responsabilidad exclusiva de `SurchargeTierValues`.
//
// Regla exacta (a pedido de Joaquín):
//   1. desde el comienzo del mes hasta 3 días corridos antes del
//      vencimiento: 'pendiente_en_termino' — nunca necesita atención urgente.
//   2. desde 3 días antes (inclusive) hasta el día anterior al vencimiento:
//      'vence_pronto' — informa `daysUntilDue`, todavía no vencida.
//   3. el día efectivo de vencimiento, completo: 'vence_hoy' — sigue en
//      término, nunca "Mes vencido".
//   4. desde el día siguiente al vencimiento: 'mes_vencido'.
// Pura — sólo días de calendario, sin leer `SurchargeTierValues` ni ningún
// store.
// ---------------------------------------------------------------------------

export type MonthlyDueDateUrgency = 'pendiente_en_termino' | 'vence_pronto' | 'vence_hoy' | 'mes_vencido';

/** Ventana de aviso previo — 3 días corridos antes del vencimiento efectivo, a pedido explícito de Joaquín. */
export const DUE_SOON_WINDOW_DAYS = 3;

export interface MonthlyDueDateStatus {
  urgency: MonthlyDueDateUrgency;
  /** Días que faltan para el vencimiento — sólo > 0 en 'pendiente_en_termino'/'vence_pronto'; 0 en el resto. */
  daysUntilDue: number;
  /** Días de atraso — sólo > 0 en 'mes_vencido'; 0 en el resto. */
  daysOverdue: number;
}

export function resolveMonthlyDueDateUrgency(dueDate: string, evaluationDate: string): MonthlyDueDateStatus {
  const daysUntilDue = daysBetweenDateKeys(toDateKey(evaluationDate), toDateKey(dueDate));
  if (daysUntilDue > DUE_SOON_WINDOW_DAYS) {
    return { urgency: 'pendiente_en_termino', daysUntilDue, daysOverdue: 0 };
  }
  if (daysUntilDue > 0) {
    return { urgency: 'vence_pronto', daysUntilDue, daysOverdue: 0 };
  }
  if (daysUntilDue === 0) {
    return { urgency: 'vence_hoy', daysUntilDue: 0, daysOverdue: 0 };
  }
  return { urgency: 'mes_vencido', daysUntilDue: 0, daysOverdue: -daysUntilDue };
}

/**
 * Única fuente que decide si un cargo "necesita atención por estar vencido"
 * para PRESENTACIÓN (Centro de cobros, Home, resúmenes, contadores de
 * atención) — nunca para calcular recargo. Para `'mensual'` usa
 * `resolveMonthlyDueDateUrgency` (la regla nueva, de días corridos hasta/
 * desde `dueDate`); para el resto de los tipos conserva EXACTAMENTE el
 * criterio de siempre (`stage !== 'on_time'`, la etapa de recargo) — esta
 * corrección es exclusiva de mensualidades, a pedido explícito de Joaquín.
 *
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural):
 * `'entrenamiento'` comparte EXACTAMENTE el criterio de `'mensual'` — mismo
 * aviso de "vence pronto"/"vence hoy"/"mes vencido" según el día real de
 * vencimiento. Todo consumidor (`buildHomeFinancialSummary.ts`,
 * `periodFinancialSummary.ts`, `studentPaymentsSummary.ts` — de ahí Home,
 * badges y totales) ya llama a esta función con `charge.type` genérico, así
 * que corregir acá alcanza para los tres a la vez.
 */
export function isChargeOverdueForDisplay(
  chargeType: PaymentChargeType,
  dueDate: string,
  stage: PaymentDueStage,
  evaluationDate: string
): boolean {
  if (chargeType === 'mensual' || chargeType === 'entrenamiento') {
    return resolveMonthlyDueDateUrgency(dueDate, evaluationDate).urgency === 'mes_vencido';
  }
  return stage !== 'on_time';
}
