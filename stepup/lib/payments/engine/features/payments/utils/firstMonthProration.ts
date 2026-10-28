// Puerto VERBATIM del original (`src/features/payments/utils/firstMonthProration.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import type { TeacherAvailability } from '../../calendar/types/teacherAvailability.ts';
import { countRuleOccurrencesInRange } from '../../calendar/utils/calendarOccurrenceCounting.ts';
import type { FirstMonthProrationDecision, PaymentAllocation, PaymentCharge } from '../types/index.ts';
import { buildMonthlyChargeId } from './paymentIdempotency.ts';
import { billingPeriodOfDateKey, firstDayOfBillingPeriod, lastDayOfBillingPeriod } from './paymentDates.ts';

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
 * alumno a una serie): núcleo puro — nunca lee ni escribe ningún store,
 * nunca conoce AsyncStorage. `criterion` es la decisión real que termina
 * eligiendo la profesora en el panel de confirmación; `'proportional'` es
 * sólo la SUGERENCIA por defecto, nunca la única opción posible.
 */
export type FirstMonthProrationCriterion = 'proportional' | 'full' | 'custom' | 'no_charge';

/**
 * Corrección 2026-08-27, cuarta ronda (a pedido de Joaquín — SOLUCIÓN
 * ESTRUCTURAL DEFINITIVA — PRORRATEO AUTOMÁTICO AL VINCULAR UN ALUMNO):
 * versión de la fórmula/regla vigente — se congela en cada
 * `FirstMonthProrationDecision` nueva (ver `confirmFirstMonthProration`)
 * para poder distinguir, en el futuro, decisiones calculadas con una
 * versión ya superada de la regla sin tener que inferirlo de otros campos.
 * Subir este número SÓLO cuando la fórmula/criterios de cálculo cambien de
 * verdad — nunca por una corrección de UI o de otra regla no relacionada.
 *
 * Historial:
 *   1 — proporción lineal (`cuota × restantes ÷ habituales`).
 *   2 — corrección 2026-08-27, quinta ronda: escalón fijo por cantidad de
 *       ocurrencias restantes (0/1/2/3+, ver `computeProportionalAmount`).
 *       Las decisiones YA congeladas con `ruleVersion: 1` (o sin este
 *       campo, de antes de que existiera) NUNCA se recalculan sólo porque
 *       la regla cambió — siguen siendo historia financiera real, válida
 *       en su momento; el campo es para AUDITORÍA, nunca un disparador de
 *       recálculo automático.
 */
export const FIRST_MONTH_PRORATION_RULE_VERSION = 2;

export interface FirstMonthProrationSuggestion {
  studentId: string;
  billingPeriod: string; // YYYY-MM
  effectiveJoinDate: string; // YYYY-MM-DD
  /** Clases reales que quedan del período, sumadas entre TODAS las series activas del alumno (nunca una por serie por separado). */
  classesRemaining: number;
  /** Clases habituales de un período COMPLETO para el mismo conjunto de series, con el mismo criterio de exclusión (canceladas/reprogramadas/vacaciones). */
  classesPerFullPeriod: number;
  permanentMonthlyAmount: number;
  /** Importe sugerido si la profesora elige "Usar proporcional" — ya redondeado a entero. */
  proportionalAmount: number;
}

/**
 * Corrección 2026-08-27, quinta ronda (a pedido de Joaquín — CORRECCIÓN
 * DEFINITIVA DE LA REGLA DEL PRIMER MES): reemplaza POR COMPLETO la
 * proporción lineal anterior (`cuota × restantes ÷ habituales`, vigente
 * en `FIRST_MONTH_PRORATION_RULE_VERSION` 1) — la regla comercial
 * confirmada es un ESCALÓN FIJO por CANTIDAD de ocurrencias reales
 * restantes, nunca una fracción continua ni ningún otro porcentaje
 * intermedio (nunca 3/4, nunca 3/5):
 *
 *   - 0 ocurrencias restantes: $0 (sin cargo para este período).
 *   - 1 ocurrencia restante: el valor de UNA sola clase dentro de la
 *     mensualidad — `cuotaMensual ÷ classesPerFullPeriod`, redondeado
 *     (nunca el precio de una clase suelta — ver `valorClase` abajo).
 *   - 2 ocurrencias restantes: exactamente el 50% de la cuota mensual,
 *     sin importar si la serie habitual es de una, dos o tres clases
 *     semanales.
 *   - 3 o más ocurrencias restantes: la cuota mensual COMPLETA.
 *
 * `classesRemaining` nunca puede superar a `classesPerFullPeriod` (el
 * rango de "restantes" siempre es un subconjunto del rango de
 * "habituales" — `planFirstMonthProration`, abajo), así que
 * `classesPerFullPeriod <= 0` sólo puede darse junto con
 * `classesRemaining <= 0` — cae solo en el primer escalón (0
 * ocurrencias), sin necesitar un caso aparte. `Math.max(classesPerFullPeriod, 1)`
 * es sólo defensivo (nunca divide por cero) para el escalón de 1
 * ocurrencia, donde `classesPerFullPeriod` siempre es como mínimo 1 en la
 * práctica real.
 */
export function computeProportionalAmount(
  monthlyAmount: number,
  classesRemaining: number,
  classesPerFullPeriod: number
): number {
  if (classesRemaining <= 0) return 0;
  if (classesRemaining === 1) return Math.round(monthlyAmount / Math.max(classesPerFullPeriod, 1));
  if (classesRemaining === 2) return Math.round(monthlyAmount * 0.5);
  return monthlyAmount;
}

/** Último date key (YYYY-MM-DD) de un período de facturación — `paymentDates.ts` sólo expone el día como número. */
function lastDateKeyOfBillingPeriod(billingPeriod: string): string {
  const day = lastDayOfBillingPeriod(billingPeriod);
  return `${billingPeriod}-${String(day).padStart(2, '0')}`;
}

export interface PlanFirstMonthProrationInput {
  studentId: string;
  monthlyAmount: number;
  /** YYYY-MM-DD — fecha real en la que el alumno queda incorporado a la serie. */
  effectiveJoinDate: string;
  /** TODAS las series activas donde participa el alumno (la recién incorporada incluida) — nunca sólo una, para nunca duplicar ni fragmentar la mensualidad. */
  activeSeries: RecurrenceRule[];
  exceptions: RecurrenceException[];
  existingLessons: CalendarLesson[];
  availability: TeacherAvailability | null;
}

/**
 * Suma ocurrencias de TODAS las series activas del alumno — nunca una
 * mensualidad por serie. Cada serie tiene su propio `recurrenceId`, así que
 * sumar sus conteos nunca duplica una misma ocurrencia real.
 */
export function planFirstMonthProration(input: PlanFirstMonthProrationInput): FirstMonthProrationSuggestion {
  const billingPeriod = billingPeriodOfDateKey(input.effectiveJoinDate);
  const periodStart = firstDayOfBillingPeriod(billingPeriod);
  const periodEnd = lastDateKeyOfBillingPeriod(billingPeriod);
  const remainingRangeStart = input.effectiveJoinDate > periodStart ? input.effectiveJoinDate : periodStart;

  let classesRemaining = 0;
  let classesPerFullPeriod = 0;
  input.activeSeries.forEach((rule) => {
    classesRemaining += countRuleOccurrencesInRange({
      rule,
      exceptions: input.exceptions,
      existingLessons: input.existingLessons,
      availability: input.availability,
      rangeStartDateKey: remainingRangeStart,
      rangeEndDateKey: periodEnd,
    });
    classesPerFullPeriod += countRuleOccurrencesInRange({
      rule,
      exceptions: input.exceptions,
      existingLessons: input.existingLessons,
      availability: input.availability,
      rangeStartDateKey: periodStart,
      rangeEndDateKey: periodEnd,
    });
  });

  return {
    studentId: input.studentId,
    billingPeriod,
    effectiveJoinDate: input.effectiveJoinDate,
    classesRemaining,
    classesPerFullPeriod,
    permanentMonthlyAmount: input.monthlyAmount,
    proportionalAmount: computeProportionalAmount(input.monthlyAmount, classesRemaining, classesPerFullPeriod),
  };
}

// ---------------------------------------------------------------------------
// CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
// automático al crear/incorporar a una serie a mitad de mes): ÚNICA fuente
// de verdad para "cuándo empieza de verdad" un alumno mensual, reutilizada
// tanto por la detección automática en tiempo real (crear serie/agregar
// participante) como por la reparación (rehidratación/backfill) y el panel
// manual de revisión — nunca dispersada en comparaciones de fecha propias
// de cada componente.
//
// Regla: para cada serie activa del alumno, su fecha real de "primera clase
// para él" es la MÁS TARDÍA entre el inicio de la serie
// (`RecurrenceRule.startDate`) y — sólo cuando el llamador SABE que esta
// llamada ES el instante real de una incorporación (nunca "ahora" durante
// una reparación en segundo plano) — `realMutationDateKey`:
//   - Serie NUEVA creada con el alumno ya adentro: su `startDate` suele ser
//     hoy o una fecha futura cercana -> domina el `startDate` de la serie.
//   - Alumno agregado a una serie YA EXISTENTE (su `startDate` quedó en el
//     pasado): sus clases anteriores a hoy no le corresponden -> domina
//     `realMutationDateKey` (el día real de la incorporación).
// Con varias series simultáneas, se toma la MÁS TEMPRANA de esas fechas por
// serie — el conteo de clases restantes de `planFirstMonthProration` ya
// respeta el `startDate` propio de cada serie, así que arrancar el rango
// desde la más temprana nunca cuenta clases de una serie antes de que esa
// serie exista.
//
// Nunca usa `profile.dateJoined` (fecha de alta del alumno en la app, que
// puede no coincidir con el día real de su primera clase) ni "ahora" fuera
// del instante real de una mutación — ambos prohibidos explícitamente por
// el pedido.
// ---------------------------------------------------------------------------
export function resolveEffectiveFirstMonthJoinDate(input: {
  /** Identidad y fecha de inicio de cada serie activa del alumno. */
  activeSeries: readonly Pick<RecurrenceRule, 'recurrenceId' | 'startDate'>[];
  /** Sólo cuando ESTA llamada es el instante real de una alta/incorporación — nunca "ahora" en rehidratación/reparación. */
  realMutationDateKey?: string;
  /** Serie puntual a la que el alumno acaba de incorporarse. La fecha de mutación nunca se aplica a sus otras series. */
  realMutationRecurrenceId?: string;
}): string | null {
  if (input.activeSeries.length === 0) return null;
  const perSeriesEffectiveDate = input.activeSeries.map(({ recurrenceId, startDate }) =>
    input.realMutationDateKey &&
    (!input.realMutationRecurrenceId || input.realMutationRecurrenceId === recurrenceId) &&
    input.realMutationDateKey > startDate
      ? input.realMutationDateKey
      : startDate
  );
  return perSeriesEffectiveDate.reduce((earliest, dateKey) => (dateKey < earliest ? dateKey : earliest));
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, segunda ronda (a pedido de Joaquín — DOS HUECOS DE
// SEGURIDAD en la reparación automática): antes de esta ronda,
// `source === undefined` (cualquier decisión persistida ANTES de que
// existiera ese campo) se trataba como "automática" sin más — pero el
// panel manual ("Primer mes de [alumno]"/"Revisar primer mes proporcional")
// existe desde el commit ORIGINAL de esta función (`3df94e1`, antes incluso
// de que existiera ningún camino automático) y siempre pudo elegir
// `criterion: 'proportional'` o `'no_charge'` — exactamente los DOS únicos
// criterios que el camino automático también puede producir
// (`ensureFirstMonthProrationDecisionInternal` nunca eligió, en ninguna
// versión histórica, `'full'` ni `'custom'` por su cuenta). Una decisión
// manual antigua con esos dos criterios es indistinguible de una automática
// SÓLO mirando sus campos — asumirla automática (como hacía la ronda
// anterior) podía pisar en silencio una elección real de la profesora.
//
// Señal persistida real y confiable: el `criterion` mismo.
//   - `'full'`/`'custom'`: SÓLO el panel manual pudo producirlos, en
//     cualquier versión histórica del código — origen manual, sin
//     ambigüedad, sin importar si `source` está presente o no.
//   - `'proportional'`/`'no_charge'` sin `source`: AMBOS caminos (manual y
//     automático) pudieron producirlos — origen genuinamente ambiguo. Nunca
//     se asume automático sin evidencia real.
// ---------------------------------------------------------------------------
export type FirstMonthProrationDecisionOrigin = 'manual' | 'automatic' | 'ambiguous';

/**
 * Clasifica el origen real de una decisión ya persistida, usando sólo sus
 * propios campos (`source`/`criterion`) — nunca el calendario actual, nunca
 * "ahora". Pura, sin acoplarse al tipo completo `FirstMonthProrationDecision`
 * (evita cualquier dependencia circular con `types/index.ts`).
 */
export function classifyFirstMonthProrationDecisionOrigin(decision: {
  source?: 'manual' | 'automatic';
  criterion: FirstMonthProrationCriterion;
}): FirstMonthProrationDecisionOrigin {
  if (decision.source === 'manual') return 'manual';
  if (decision.source === 'automatic') return 'automatic';
  if (decision.criterion === 'full' || decision.criterion === 'custom') return 'manual';
  return 'ambiguous';
}

/**
 * Reconstruye una `FirstMonthProrationSuggestion` a partir de los campos ya
 * CONGELADOS de una decisión persistida — nunca recalcula contra el
 * calendario actual (mismo motivo que `reconcileExistingFirstMonthProrationDecision`:
 * evita incorporar cancelaciones/reprogramaciones posteriores a la decisión
 * original). Función compartida — antes vivía duplicada inline en
 * `firstMonthProrationService.ts`; ahora también la reutiliza el panel
 * manual para ofrecer la revisión de una decisión histórica ambigua con
 * exactamente los mismos números que ya se habían calculado en su momento.
 */
export function buildFirstMonthProrationSuggestionFromDecision(
  decision: Pick<
    FirstMonthProrationDecision,
    'studentId' | 'billingPeriod' | 'effectiveJoinDate' | 'classesRemaining' | 'classesPerFullPeriod' | 'permanentMonthlyAmount'
  >
): FirstMonthProrationSuggestion {
  return {
    studentId: decision.studentId,
    billingPeriod: decision.billingPeriod,
    effectiveJoinDate: decision.effectiveJoinDate,
    classesRemaining: decision.classesRemaining,
    classesPerFullPeriod: decision.classesPerFullPeriod,
    permanentMonthlyAmount: decision.permanentMonthlyAmount,
    proportionalAmount: computeProportionalAmount(
      decision.permanentMonthlyAmount,
      decision.classesRemaining,
      decision.classesPerFullPeriod
    ),
  };
}

/** Traduce el criterio elegido por la profesora al importe final a cargar. `'custom'` exige `customAmount` (entero positivo). */
export function resolveFirstMonthChargeAmount(
  suggestion: FirstMonthProrationSuggestion,
  criterion: FirstMonthProrationCriterion,
  customAmount?: number
): number {
  switch (criterion) {
    case 'proportional':
      return suggestion.proportionalAmount;
    case 'full':
      return suggestion.permanentMonthlyAmount;
    case 'custom':
      if (!Number.isFinite(customAmount) || (customAmount as number) <= 0) {
        throw new RangeError('El importe personalizado debe ser un número positivo.');
      }
      return Math.round(customAmount as number);
    case 'no_charge':
      return 0;
    default:
      throw new Error('Criterio de primer mes desconocido.');
  }
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — HACER
// CORREGIBLE EL PRORRATEO HISTÓRICO MARCADO PARA REVISIÓN): `needs_manual_review`
// (ronda anterior) protegía correctamente el dato, pero no dejaba ninguna
// acción visible para la profesora — el candidato vivía sólo en el valor de
// retorno transitorio de `ensureFirstMonthProrationDecision`, nunca
// persistido ni reconstruible después. `findFirstMonthProrationReviewNeeds`
// es la ÚNICA fuente de verdad para "qué decisiones de primer mes necesitan
// revisión humana ahora mismo" — determinista, reconstruible en cualquier
// momento (arranque, primer plano, después de restaurar un respaldo) SÓLO
// con datos ya persistidos (`FirstMonthProrationDecision[]`/`PaymentCharge[]`/
// `PaymentAllocation[]`), sin ningún estado transitorio ni caché propia.
// Reutilizada tanto por `CobrosTab.tsx` (un alumno puntual) como por
// `collectionsCenter.ts` (todos los alumnos, para marcar la tarjeta
// correspondiente en Centro de cobros) — nunca dos implementaciones.
// ---------------------------------------------------------------------------

export interface FirstMonthProrationReviewNeed {
  studentId: string;
  billingPeriod: string;
  /** La decisión ambigua real que motiva la revisión — sus campos congelados alimentan `buildFirstMonthProrationSuggestionFromDecision`. */
  decision: FirstMonthProrationDecision;
  /** Id determinístico del cargo real correspondiente — siempre existe y no está anulado (si no, no hay nada que reparar acá). */
  chargeId: string;
  /** true si el cargo ya tiene algún pago/asignación real — la confirmación sigue protegida por `FirstMonthProrationHasMovementsError`, nunca se oculta la acción, pero el resultado puede requerir revisión manual con trazabilidad. */
  hasMovements: boolean;
}

/**
 * Recorre TODAS las decisiones de primer mes persistidas, se queda con la
 * MÁS RECIENTE por (alumno, período) — mismo criterio que
 * `findFirstMonthProrationDecision` — y filtra sólo las de origen
 * `'ambiguous'` (`classifyFirstMonthProrationDecisionOrigin`) cuyo cargo
 * real todavía exista y no esté anulado. Nunca incluye una mensualidad
 * histórica que no sea realmente el primer período del alumno (sólo mira
 * `FirstMonthProrationDecision`, que por construcción representa siempre el
 * primer mes) ni un período ajeno (el `billingPeriod` es siempre el propio
 * de la decisión). Pura — no lee ningún store, no muta nada.
 */
export function findFirstMonthProrationReviewNeeds(input: {
  decisions: readonly FirstMonthProrationDecision[];
  charges: readonly PaymentCharge[];
  allocations: readonly PaymentAllocation[];
}): FirstMonthProrationReviewNeed[] {
  const { decisions, charges, allocations } = input;

  const latestByKey = new Map<string, FirstMonthProrationDecision>();
  decisions.forEach((decision) => {
    const key = `${decision.studentId}__${decision.billingPeriod}`;
    const current = latestByKey.get(key);
    if (!current || decision.confirmedAt > current.confirmedAt) {
      latestByKey.set(key, decision);
    }
  });

  const needs: FirstMonthProrationReviewNeed[] = [];
  latestByKey.forEach((decision) => {
    if (classifyFirstMonthProrationDecisionOrigin(decision) !== 'ambiguous') return;

    const chargeId = decision.chargeId ?? buildMonthlyChargeId(decision.studentId, decision.billingPeriod);
    const charge = charges.find((item) => item.id === chargeId && item.voidedAt === null);
    if (!charge) return; // sin cargo real vigente: nada que reparar desde acá.

    const hasMovements = allocations.some((allocation) => allocation.chargeId === chargeId);
    needs.push({ studentId: decision.studentId, billingPeriod: decision.billingPeriod, decision, chargeId, hasMovements });
  });

  return needs;
}
