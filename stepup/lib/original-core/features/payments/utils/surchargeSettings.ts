// Puerto VERBATIM del original (`src/features/payments/utils/surchargeSettings.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { isValidBillingPeriod, nextBillingPeriod } from './paymentDates.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): motor puro
 * de la configuración de recargos — nunca toca AsyncStorage/React, mismo
 * patrón que el resto del dominio de pagos (`paymentDueStage.ts`,
 * `paymentMutations.ts`).
 *
 * CAUSA (dónde estaban hardcodeados los recargos antes de esta fase):
 *   - `paymentDueStage.ts` — `SURCHARGE_RATE_BY_STAGE` (10%/15%/20%,
 *     constante de módulo) y los umbrales de días DENTRO de
 *     `determineMonthlyDueStage` (día 1-10 on_time, 11-18 first_late,
 *     19-26 second_late, 27+ last_late) — números literales en el cuerpo
 *     de la función, sin ningún parámetro de configuración.
 * Ambos pasan a ser el valor por DEFECTO (`DEFAULT_SURCHARGE_TIER_VALUES`,
 * exactamente los mismos números) de un parámetro opcional — la migración
 * nunca inventa un valor nuevo.
 */

export interface SurchargeTierValues {
  enabled: boolean;
  /** Día del mes (1-31) hasta el cual el período está "en término" — último día del plazo normal. */
  graceDay: number;
  /** Día del mes (1-31) desde el cual arranca el primer recargo. */
  firstLateDay: number;
  /** Porcentaje entero (10 = 10%), nunca una fracción. */
  firstLatePercentage: number;
  secondLateDay: number;
  secondLatePercentage: number;
  lastLateDay: number;
  lastLatePercentage: number;
}

/**
 * Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
 * confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
 * monetarias automáticas"): `enabled` pasa de `true` a `false` — ninguna
 * cuenta nueva puede obtener un recargo automático por defecto. Los
 * umbrales de día (`graceDay`/`firstLateDay`/etc.) se conservan intactos:
 * siguen siendo la única fuente de la etapa de "mora" VISUAL
 * (`determineDueStage`/semáforo/badges) — nunca de dinero, ver
 * `calculateSurchargeAmount` en `paymentDueStage.ts`, que ahora devuelve
 * siempre 0 sin importar este valor.
 */
export const DEFAULT_SURCHARGE_TIER_VALUES: SurchargeTierValues = {
  enabled: false,
  graceDay: 10,
  firstLateDay: 11,
  firstLatePercentage: 10,
  secondLateDay: 19,
  secondLatePercentage: 15,
  lastLateDay: 27,
  lastLatePercentage: 20,
};

/**
 * `current` es lo vigente HOY (o lo que quedó vigente la última vez que un
 * cambio pendiente pasó a estar en efecto); `pending`/`pendingEffectiveFrom`
 * es un cambio propuesto que todavía no rige para todos los períodos —
 * mismo patrón exacto que `MonthlyBillingPlan.pendingAmount`/
 * `pendingAmountEffectiveFrom` (`studentBillingPlan.ts`,
 * `resolveEffectiveMonthlyAmount`), nunca inventado de nuevo acá.
 * `pending` nunca se "colapsa" sobre `current` cuando su vigencia llega:
 * `resolveEffectiveSurchargeTierValues` siempre resuelve el valor correcto
 * comparando períodos, así que un `pending` cuya vigencia ya pasó sigue
 * siendo la fuente correcta indefinidamente, sin necesidad de una
 * operación de "commit" aparte.
 */
export interface SurchargeSettings {
  current: SurchargeTierValues;
  pending: SurchargeTierValues | null;
  /** 'YYYY-MM' — período desde el cual `pending` pasa a regir. `null` si no hay cambio propuesto. */
  pendingEffectiveFrom: string | null;
}

export const DEFAULT_SURCHARGE_SETTINGS: SurchargeSettings = {
  current: DEFAULT_SURCHARGE_TIER_VALUES,
  pending: null,
  pendingEffectiveFrom: null,
};

/**
 * Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
 * confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
 * monetarias automáticas"): fuerza `enabled: false` sin importar lo que
 * traiga `values` — configuración nueva, vieja (de antes de esta decisión,
 * con `enabled: true` persistido), restaurada de un backup anterior, o
 * corrupta. `graceDay`/`firstLateDay`/`secondLateDay`/`lastLateDay` y los 3
 * porcentajes se conservan intactos: siguen alimentando ÚNICAMENTE la etapa
 * de mora VISUAL (`determineDueStage`), nunca dinero — `calculateSurchargeAmount`
 * (`paymentDueStage.ts`) ya no lee `enabled` en absoluto, es 0 siempre, pero
 * esta normalización es la que garantiza que ninguna pantalla ni ningún
 * otro consumidor de `SurchargeTierValues.enabled` (p. ej. un texto que
 * dijera "Activados"/"Desactivados") pueda mostrar "activado" para una
 * cuenta real.
 */
export function sanitizeSurchargeTierValues(values: SurchargeTierValues): SurchargeTierValues {
  return { ...values, enabled: false };
}

/**
 * Normaliza toda la configuración persistida — `current` Y `pending` (un
 * cambio propuesto histórico, si existiera, tampoco puede reactivar
 * recargos al llegar su vigencia). Único punto que debe usarse para leer
 * `SurchargeSettings` recién hidratada/restaurada de un backup — ver
 * `surchargeSettingsStore.ts` (`parsePersistedSurchargeSettings`,
 * `replaceSurchargeSettingsFromBackup`).
 */
export function sanitizeSurchargeSettings(settings: SurchargeSettings): SurchargeSettings {
  return {
    current: sanitizeSurchargeTierValues(settings.current),
    pending: settings.pending ? sanitizeSurchargeTierValues(settings.pending) : null,
    pendingEffectiveFrom: settings.pendingEffectiveFrom,
  };
}

/**
 * Valores efectivos de recargo para un período de facturación puntual —
 * ÚNICA función que debe usarse para saber "qué configuración regía en tal
 * mes", tanto para un cargo abierto de HOY como para uno ya saldado hace
 * tiempo (nunca aplicar retroactivamente un cambio a un período anterior a
 * su vigencia — ver `calculateChargeState`, que llama a esto con el
 * `billingPeriod` REAL del cargo, nunca con "hoy" a secas). Sanitiza SIEMPRE
 * antes de resolver — ver `sanitizeSurchargeSettings`.
 */
export function resolveEffectiveSurchargeTierValues(
  settings: SurchargeSettings,
  billingPeriod: string
): SurchargeTierValues {
  const sanitized = sanitizeSurchargeSettings(settings);
  if (sanitized.pending && sanitized.pendingEffectiveFrom && billingPeriod >= sanitized.pendingEffectiveFrom) {
    return sanitized.pending;
  }
  return sanitized.current;
}

/**
 * Validación completa de los 7 campos editables. Devuelve la lista de
 * errores (vacía = válido) — nunca lanza, para que la UI pueda mostrar
 * todos los problemas a la vez en vez de sólo el primero.
 *   - días enteros entre 1 y 31;
 *   - orden cronológico estricto (graceDay < firstLateDay < secondLateDay < lastLateDay);
 *   - porcentajes finitos y >= 0 (nunca NaN, negativos ni texto corrupto).
 */
export function validateSurchargeTierValues(values: SurchargeTierValues): string[] {
  const errors: string[] = [];

  function validateDay(value: unknown, label: string): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) {
      errors.push(`${label} debe ser un día entero entre 1 y 31.`);
    }
  }

  function validatePercentage(value: unknown, label: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors.push(`${label} debe ser un porcentaje válido, igual o mayor que cero.`);
    }
  }

  validateDay(values.graceDay, 'El día de vencimiento base');
  validateDay(values.firstLateDay, 'El día del primer recargo');
  validateDay(values.secondLateDay, 'El día del segundo recargo');
  validateDay(values.lastLateDay, 'El día del último recargo');
  validatePercentage(values.firstLatePercentage, 'El porcentaje del primer recargo');
  validatePercentage(values.secondLatePercentage, 'El porcentaje del segundo recargo');
  validatePercentage(values.lastLatePercentage, 'El porcentaje del último recargo');

  // El orden cronológico sólo se valida si los cuatro días son, cada uno,
  // un entero real 1-31 — comparar un NaN/valor fuera de rango produciría
  // mensajes de orden incoherentes encima del error de rango ya reportado.
  const daysAreAllValidNumbers = [values.graceDay, values.firstLateDay, values.secondLateDay, values.lastLateDay].every(
    (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31
  );
  if (daysAreAllValidNumbers) {
    if (!(values.graceDay < values.firstLateDay)) {
      errors.push('El día del primer recargo debe ser posterior al día de vencimiento base.');
    }
    if (!(values.firstLateDay < values.secondLateDay)) {
      errors.push('El día del segundo recargo debe ser posterior al día del primer recargo.');
    }
    if (!(values.secondLateDay < values.lastLateDay)) {
      errors.push('El día del último recargo debe ser posterior al día del segundo recargo.');
    }
  }

  return errors;
}

export type SurchargeSettingsVigencia = 'current_month' | 'next_month';

/**
 * Construye la propuesta de cambio (pending + vigencia), SIN persistir
 * nada — el llamador (`surchargeSettingsService.ts`) decide cuándo
 * escribirlo vía el store. Lanza si `nextValues` no pasa la validación —
 * nunca deja guardar una configuración corrupta "por las dudas".
 */
export function proposeSurchargeSettingsChange(
  settings: SurchargeSettings,
  nextValues: SurchargeTierValues,
  vigencia: SurchargeSettingsVigencia,
  todayBillingPeriod: string
): SurchargeSettings {
  if (!isValidBillingPeriod(todayBillingPeriod)) {
    throw new RangeError('todayBillingPeriod debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  const errors = validateSurchargeTierValues(nextValues);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
  const pendingEffectiveFrom = vigencia === 'current_month' ? todayBillingPeriod : nextBillingPeriod(todayBillingPeriod);
  return { ...settings, pending: nextValues, pendingEffectiveFrom };
}
