// Puerto VERBATIM del original (`src/features/payments/services/firstMonthProrationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { FirstMonthProrationDecision, PaymentsRepositoryState } from '../types/index.ts';
import type { StudentProfile } from '../../student-profile/types/index.ts';
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import type { TeacherAvailability } from '../../calendar/types/teacherAvailability.ts';
import { buildFirstMonthProrationSuggestionFromDecision, classifyFirstMonthProrationDecisionOrigin, FIRST_MONTH_PRORATION_RULE_VERSION, planFirstMonthProration, resolveEffectiveFirstMonthJoinDate, resolveFirstMonthChargeAmount, type FirstMonthProrationCriterion, type FirstMonthProrationSuggestion } from '../utils/firstMonthProration.ts';
import { buildMonthlyCharge, voidCharge } from '../utils/paymentMutations.ts';
import { buildMonthlyChargeId } from '../utils/paymentIdempotency.ts';
import { billingPeriodOfDateKey, nextBillingPeriod } from '../utils/paymentDates.ts';
import { resolveFirstPeriodDueDate } from '../utils/firstPeriodDueDate.ts';
import { applyPaymentsMutation, getPaymentsSnapshot, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';
import { appendFirstMonthProrationDecision, findFirstMonthProrationDecision, loadFirstMonthProrationDecisionLog } from '../hooks/firstMonthProrationDecisionStore.ts';
import { getStudentProfile, updateStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveEffectiveMonthlyAmount, resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
 * alumno a una serie): orquesta la confirmación del panel "Primer mes de
 * [alumno]" dentro de una única `applyPaymentsMutation` — mismo patrón
 * anti-TOCTOU que `applyFirstMonthSituation`/`correctMonthlyAmount`. Nunca
 * un segundo motor financiero: reutiliza `buildMonthlyCharge`/`voidCharge`
 * tal cual, y la MISMA clave idempotente `(studentId, billingPeriod)` que
 * cualquier otra mensualidad — repetir la confirmación nunca duplica el
 * cargo.
 */
export type ConfirmFirstMonthProrationStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: ConfirmFirstMonthProrationStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

export interface ConfirmFirstMonthProrationProfileDeps {
  getProfile: (studentId: string) => StudentProfile | null;
  saveProfile: (profile: StudentProfile) => Promise<void>;
}

export interface ConfirmFirstMonthProrationDecisionDeps {
  appendDecision: (decision: FirstMonthProrationDecision) => Promise<void>;
}

const defaultDecisionDeps: ConfirmFirstMonthProrationDecisionDeps = {
  appendDecision: appendFirstMonthProrationDecision,
};

const defaultProfileDeps: ConfirmFirstMonthProrationProfileDeps = {
  getProfile: getStudentProfile,
  saveProfile: updateStudentProfile,
};

export interface ConfirmFirstMonthProrationInput {
  suggestion: FirstMonthProrationSuggestion;
  criterion: FirstMonthProrationCriterion;
  /** Sólo para `criterion: 'custom'`. */
  customAmount?: number;
  now?: Date;
  /**
   * Procedencia de esta confirmación — `'manual'` (default) cuando la llama
   * el panel de revisión con la profesora presente, `'automatic'` cuando la
   * llama `ensureFirstMonthProrationDecision` (detección/reparación en
   * segundo plano, sin intervención humana). Ver `FirstMonthProrationDecision.source`.
   */
  source?: 'manual' | 'automatic';
  /**
   * Corrección 2026-08-27, cuarta ronda (a pedido de Joaquín — SOLUCIÓN
   * ESTRUCTURAL DEFINITIVA): las series activas REALES que produjeron
   * `suggestion` — sólo la pasa el camino automático (`ensureFirstMonthProrationDecision`,
   * que ya las tiene en memoria en el instante mismo de la vinculación).
   * Se usa ÚNICAMENTE para congelar evidencia adicional en la decisión
   * (`recurrenceIds`/`seriesPatternSnapshot`) — nunca para recalcular nada;
   * el importe siempre sale de `suggestion`, ya calculado. Ausente en
   * confirmaciones manuales o de reparación: esas decisiones quedan sin
   * esta evidencia extra, igual que antes.
   */
  activeSeries?: RecurrenceRule[];
}

export interface ConfirmFirstMonthProrationResult {
  decision: FirstMonthProrationDecision;
  chargeCreated: boolean;
  chargeUpdated: boolean;
  chargeVoided: boolean;
}

/**
 * Se rechaza (nunca cambia en silencio) si el cargo del período ya tiene
 * asignaciones (pagos parciales o totales) — la profesora debe usar
 * "Modificar monto mensual" para corregirlo, con su propio registro de
 * auditoría, sin perder historial.
 */
export class FirstMonthProrationHasMovementsError extends Error {
  constructor() {
    super(
      'Este período ya tiene pagos o asignaciones registrados — no se puede recalcular el primer mes en silencio. Usá "Modificar monto mensual" para corregirlo.'
    );
    this.name = 'FirstMonthProrationHasMovementsError';
  }
}

export async function confirmFirstMonthProration(
  input: ConfirmFirstMonthProrationInput,
  deps: ConfirmFirstMonthProrationStoreDeps = defaultStoreDeps,
  profileDeps: ConfirmFirstMonthProrationProfileDeps = defaultProfileDeps,
  decisionDeps: ConfirmFirstMonthProrationDecisionDeps = defaultDecisionDeps
): Promise<ConfirmFirstMonthProrationResult> {
  const { suggestion } = input;
  const profile = profileDeps.getProfile(suggestion.studentId);
  if (!profile) {
    throw new Error('No se encontró el alumno.');
  }
  const resolvedPlan = resolveStudentBillingPlan(profile);
  if (resolvedPlan.type !== 'monthly') {
    throw new Error('Este alumno no tiene un plan de cobro mensual — no corresponde el primer mes proporcional.');
  }

  await deps.hydrate();
  const now = input.now ?? new Date();
  const chargeAmount = resolveFirstMonthChargeAmount(suggestion, input.criterion, input.customAmount);
  const chargeId = buildMonthlyChargeId(suggestion.studentId, suggestion.billingPeriod);
  // Corrección 2026-10-04 (a pedido de Joaquín): max(fecha de incorporación, primer vencimiento global ajustado a día
  // hábil) — nunca antes del vencimiento global (aparecía "Mes vencido" días antes), nunca antes de incorporarse.
  const dueDate = resolveFirstPeriodDueDate(suggestion.billingPeriod, suggestion.effectiveJoinDate);

  let chargeCreated = false;
  let chargeUpdated = false;
  let chargeVoided = false;
  let previousChargeForCompensation: { originalAmount: number; dueDate: string; voidedAt: string | null; voidReason: string | null } | null = null;

  await deps.applyMutation((current) => {
    const existingCharge = current.charges.find((charge) => charge.id === chargeId && charge.voidedAt === null);

    if (existingCharge) {
      const hasMovements = current.allocations.some((allocation) => allocation.chargeId === chargeId);
      if (hasMovements) {
        throw new FirstMonthProrationHasMovementsError();
      }
      previousChargeForCompensation = {
        originalAmount: existingCharge.originalAmount,
        dueDate: existingCharge.dueDate,
        voidedAt: existingCharge.voidedAt,
        voidReason: existingCharge.voidReason,
      };

      if (input.criterion === 'no_charge') {
        chargeVoided = true;
        return {
          ...current,
          charges: voidCharge(current.charges, chargeId, 'Primer mes: se decidió no cobrar este período.', now.toISOString()),
        };
      }

      chargeUpdated = true;
      return {
        ...current,
        charges: current.charges.map((charge) =>
          charge.id === chargeId ? { ...charge, originalAmount: chargeAmount, dueDate } : charge
        ),
      };
    }

    if (input.criterion === 'no_charge') {
      // Nada que crear ni anular: nunca existió un cargo para este período.
      return current;
    }

    const newCharge = buildMonthlyCharge({
      studentId: suggestion.studentId,
      billingPeriod: suggestion.billingPeriod,
      dueDate,
      originalAmount: chargeAmount,
      createdAt: now.toISOString(),
      existingCharges: current.charges,
    });
    chargeCreated = true;
    return { ...current, charges: [...current.charges, newCharge] };
  });

  if (input.criterion === 'no_charge') {
    try {
      await profileDeps.saveProfile({
        ...profile,
        billingPlan: { ...resolvedPlan, startPeriod: nextBillingPeriod(suggestion.billingPeriod) },
      });
    } catch (profileError) {
      if (previousChargeForCompensation) {
        const compensation: { originalAmount: number; dueDate: string; voidedAt: string | null; voidReason: string | null } =
          previousChargeForCompensation;
        await deps
          .applyMutation((current) => ({
            ...current,
            charges: current.charges.map((charge) => (charge.id === chargeId ? { ...charge, ...compensation } : charge)),
          }))
          .catch(() => {
            // Si ni siquiera la reversión se puede escribir, no hay nada más
            // que intentar acá — el error original sigue siendo el que se
            // relanza, para que la pantalla lo muestre tal cual.
          });
      }
      throw profileError;
    }
  }

  // Corrección 2026-08-27, cuarta ronda: congela evidencia adicional SÓLO
  // cuando el llamador (el camino automático, en el instante real de la
  // vinculación) pasó las series reales — nunca se recalcula ni se
  // reinterpreta después; una serie editada/pausada/eliminada más tarde
  // nunca puede alterar esta copia.
  const recurrenceIds = input.activeSeries?.map((rule) => rule.recurrenceId);
  const seriesPatternSnapshot = input.activeSeries?.map((rule) => ({
    recurrenceId: rule.recurrenceId,
    cycleLengthWeeks: rule.cycleLengthWeeks,
    weeks: rule.weeks.map((week) => ({
      weekIndex: week.weekIndex,
      sessions: week.sessions.map((session) => ({
        weekday: session.weekday,
        hour: session.hour,
        minute: session.minute,
        durationMinutes: session.durationMinutes,
      })),
    })),
  }));

  const decision: FirstMonthProrationDecision = {
    id: `firstmonth_${suggestion.studentId}_${suggestion.billingPeriod}_${now.getTime()}`,
    studentId: suggestion.studentId,
    billingPeriod: suggestion.billingPeriod,
    effectiveJoinDate: suggestion.effectiveJoinDate,
    criterion: input.criterion,
    classesRemaining: suggestion.classesRemaining,
    classesPerFullPeriod: suggestion.classesPerFullPeriod,
    permanentMonthlyAmount: suggestion.permanentMonthlyAmount,
    chargedAmount: input.criterion === 'no_charge' ? 0 : chargeAmount,
    chargeId: input.criterion === 'no_charge' ? null : chargeId,
    createdAt: now.toISOString(),
    confirmedAt: now.toISOString(),
    source: input.source ?? 'manual',
    recurrenceIds,
    seriesPatternSnapshot,
    ruleVersion: FIRST_MONTH_PRORATION_RULE_VERSION,
  };
  try {
    await decisionDeps.appendDecision(decision);
  } catch (auditError) {
    // Best-effort: la corrección financiera real (cargo creado/actualizado/
    // anulado) ya se aplicó y persistió con éxito — perder sólo la entrada
    // de auditoría no amerita deshacer un cambio financiero correcto.
    console.error('No se pudo guardar el registro de la decisión de primer mes proporcional', auditError);
  }

  return { decision, chargeCreated, chargeUpdated, chargeVoided };
}

// ---------------------------------------------------------------------------
// CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
// automático al crear/incorporar a una serie a mitad de mes): OPERACIÓN
// CANÓNICA única — detecta automáticamente si corresponde el primer mes
// proporcional y, si corresponde, lo aplica. Reutiliza `confirmFirstMonthProration`
// (arriba) para la mutación real — nunca reimplementa la creación/actualización
// del cargo ni de la decisión. Se invoca desde los mismos lugares reales que
// antes sólo encolaban el panel manual (`useFirstMonthProrationFlow.ts`,
// `enqueueForNewlyAddedParticipants`) Y desde la reparación automática
// (`runAutomaticFirstMonthProrationRepair`, en `firstMonthProrationRepairService.ts`)
// — ambos caminos llaman a esta misma función, nunca a una copia.
//
// "Primer mes real de clases": el alumno todavía NO tiene ningún cargo
// mensual vigente de un período ANTERIOR al calculado — si ya tuvo
// actividad mensual antes, esto NUNCA es su primer mes (evita reprorratear
// a un alumno ya facturado sólo porque se incorporó a una SEGUNDA serie —
// caso 12 del pedido).
// ---------------------------------------------------------------------------

export interface EnsureFirstMonthProrationInput {
  studentId: string;
  /** TODAS las series activas actuales del alumno (la recién tocada incluida) — nunca sólo una. */
  activeSeries: RecurrenceRule[];
  exceptions: RecurrenceException[];
  existingLessons: CalendarLesson[];
  availability: TeacherAvailability | null;
  /**
   * Sólo cuando ESTA llamada es el instante real de una alta/incorporación
   * (crear serie con el alumno adentro, agregarlo a una serie existente) —
   * nunca "ahora" durante una reparación en segundo plano/rehidratación.
   * Ver `resolveEffectiveFirstMonthJoinDate`.
   */
  realMutationDateKey?: string;
  /** `recurrenceId` de la única serie tocada por `realMutationDateKey`. */
  realMutationRecurrenceId?: string;
  now?: Date;
}

export type EnsureFirstMonthProrationOutcome =
  | { status: 'not_applicable'; reason: 'no_monthly_plan' | 'no_active_series' | 'has_prior_monthly_history' | 'insufficient_data' }
  | { status: 'already_decided'; billingPeriod: string }
  | { status: 'skipped_has_movements'; billingPeriod: string }
  /**
   * Corrección 2026-08-27, segunda ronda: una decisión histórica (sin
   * `source`) cuyo `criterion` (`'proportional'`/`'no_charge'`) pudo haber
   * salido tanto del panel manual como del camino automático — origen
   * genuinamente ambiguo (`classifyFirstMonthProrationDecisionOrigin`).
   * Nunca se toca en silencio ni se asume automática sin evidencia: ni el
   * cargo ni el registro de decisiones se modifican. Queda disponible el
   * mecanismo manual existente ("Revisar primer mes proporcional" en
   * Cobros) para que la profesora la confirme/corrija con trazabilidad.
   */
  | { status: 'needs_manual_review'; billingPeriod: string; reason: 'ambiguous_historical_decision' }
  | { status: 'decided'; billingPeriod: string; result: ConfirmFirstMonthProrationResult };

export interface EnsureFirstMonthProrationDeps {
  storeDeps?: ConfirmFirstMonthProrationStoreDeps;
  profileDeps?: ConfirmFirstMonthProrationProfileDeps;
  getSnapshot?: () => PaymentsRepositoryState;
  loadDecisions?: () => Promise<FirstMonthProrationDecision[]>;
  appendDecision?: (decision: FirstMonthProrationDecision) => Promise<void>;
}

async function ensureFirstMonthProrationDecisionInternal(
  input: EnsureFirstMonthProrationInput,
  deps: EnsureFirstMonthProrationDeps = {}
): Promise<EnsureFirstMonthProrationOutcome> {
  const storeDeps = deps.storeDeps ?? defaultStoreDeps;
  const profileDeps = deps.profileDeps ?? defaultProfileDeps;
  const getSnapshot = deps.getSnapshot ?? getPaymentsSnapshot;
  const loadDecisions = deps.loadDecisions ?? loadFirstMonthProrationDecisionLog;
  const appendDecision = deps.appendDecision ?? appendFirstMonthProrationDecision;

  const profile = profileDeps.getProfile(input.studentId);
  if (!profile) return { status: 'not_applicable', reason: 'insufficient_data' };
  const plan = resolveStudentBillingPlan(profile);
  if (plan.type !== 'monthly') return { status: 'not_applicable', reason: 'no_monthly_plan' };
  if (input.activeSeries.length === 0) return { status: 'not_applicable', reason: 'no_active_series' };

  const effectiveJoinDate = resolveEffectiveFirstMonthJoinDate({
    activeSeries: input.activeSeries,
    realMutationDateKey: input.realMutationDateKey,
    realMutationRecurrenceId: input.realMutationRecurrenceId,
  });
  if (!effectiveJoinDate) return { status: 'not_applicable', reason: 'insufficient_data' };
  const billingPeriod = billingPeriodOfDateKey(effectiveJoinDate);

  await storeDeps.hydrate();
  const state = getSnapshot();
  const hasPriorMonthlyHistory = state.charges.some(
    (charge) =>
      charge.studentId === input.studentId &&
      charge.type === 'mensual' &&
      charge.voidedAt === null &&
      !!charge.billingPeriod &&
      charge.billingPeriod < billingPeriod
  );
  if (hasPriorMonthlyHistory) return { status: 'not_applicable', reason: 'has_prior_monthly_history' };

  const decisions = await loadDecisions();
  const existingDecision = findFirstMonthProrationDecision(decisions, input.studentId, billingPeriod);

  if (existingDecision) {
    return reconcileExistingFirstMonthProrationDecision(existingDecision, {
      input,
      billingPeriod,
      state,
      storeDeps,
      profileDeps,
      appendDecision,
    });
  }

  const monthlyAmount = resolveEffectiveMonthlyAmount(plan, billingPeriod);
  const suggestion = planFirstMonthProration({
    studentId: input.studentId,
    monthlyAmount,
    effectiveJoinDate,
    activeSeries: input.activeSeries,
    exceptions: input.exceptions,
    existingLessons: input.existingLessons,
    availability: input.availability,
  });

  // Sin ninguna clase real restante (alta el último día del período, o
  // después de la última ocurrencia): el criterio correcto es "sin cobro",
  // nunca "proporcional" con un importe de $0 — `buildMonthlyCharge` rechaza
  // un cargo de $0 por diseño (nunca un cargo en cero), y "sin cobro" ya es
  // el camino canónico existente para ese caso exacto.
  const criterion: FirstMonthProrationCriterion = suggestion.proportionalAmount > 0 ? 'proportional' : 'no_charge';

  try {
    const result = await confirmFirstMonthProration(
      { suggestion, criterion, now: input.now, source: 'automatic', activeSeries: input.activeSeries },
      storeDeps,
      profileDeps,
      { appendDecision }
    );
    return { status: 'decided', billingPeriod, result };
  } catch (error) {
    if (error instanceof FirstMonthProrationHasMovementsError) {
      // Ya tiene pagos/asignaciones reales — nunca se toca en silencio acá.
      // Queda disponible el mecanismo manual existente ("Revisar primer mes
      // proporcional" en Cobros) para que la profesora lo corrija con
      // trazabilidad, preservando el historial.
      return { status: 'skipped_has_movements', billingPeriod };
    }
    throw error;
  }
}

/**
 * Corrección 2026-08-27 (a pedido de Joaquín — EL PRIMER MES SIGUE
 * COBRANDO LA CUOTA COMPLETA): una decisión YA EXISTENTE para (alumno,
 * período) dejó de ser, por sí sola, motivo suficiente para no volver a
 * mirar nada — eso era exactamente lo que permitía que un cargo real
 * quedara para siempre en la cuota completa: cualquier decisión antigua
 * (automática con un bug ya corregido, o de antes de que existiera este
 * registro) bloqueaba la reparación sólo por EXISTIR, sin importar si el
 * cargo real todavía coincidía con ella.
 *
 * Corrección 2026-08-27, segunda ronda (a pedido de Joaquín — DOS HUECOS DE
 * SEGURIDAD): la ronda anterior asumía "sin `source` = automática", lo que
 * podía pisar en silencio una decisión MANUAL de antes de que ese campo
 * existiera. Ahora se usa `classifyFirstMonthProrationDecisionOrigin`
 * (única función que interpreta el origen — ver `firstMonthProration.ts`
 * para el razonamiento completo de por qué `criterion` es la única señal
 * histórica confiable):
 *
 * - origen `'manual'` (`source: 'manual'`, o `criterion` `'full'`/`'custom'`
 *   sin `source` — sólo el panel manual pudo elegir esos dos): se preserva
 *   SIEMPRE, sea cual sea el estado del cargo. Nunca se pisa en silencio.
 * - origen `'ambiguous'` (`'proportional'`/`'no_charge'` sin `source` —
 *   AMBOS caminos pudieron producirlos históricamente): NUNCA se asume
 *   automática sin evidencia real — ni el cargo ni el registro de
 *   decisiones se tocan; se devuelve `needs_manual_review` para que la
 *   profesora la revise con trazabilidad desde el mecanismo manual
 *   existente. Esto también cierra el caso "decisión internamente
 *   consistente pero calculada mal" (`classesRemaining === classesPerFullPeriod`
 *   con un alta real a mitad de período): no hay forma determinista de
 *   reconstruir la proporción correcta sólo con los campos ya congelados de
 *   la decisión (no guarda `recurrenceId` ni el patrón real de la serie, y
 *   recalcular contra el calendario actual arriesga incorporar
 *   cancelaciones posteriores) — nunca se inventa ese dato, se señala para
 *   revisión en vez de reparar a ciegas o quedar "ya decidido" en silencio.
 * - origen `'automatic'` (`source: 'automatic'` explícito — sólo lo agrega
 *   este mismo código, nunca una decisión de antes de esta corrección): se
 *   revalida contra sus PROPIOS campos ya congelados en el momento en que
 *   se tomó (`classesRemaining`/`classesPerFullPeriod`/`permanentMonthlyAmount`/
 *   `criterion`) — NUNCA contra el calendario actual (`input.activeSeries`/
 *   `exceptions`/`existingLessons`), que podría reflejar cancelaciones o
 *   reprogramaciones ocurridas DESPUÉS de decidido el primer mes — eso
 *   nunca debe alterar retroactivamente una cuota ya cargada (caso 14 de
 *   `ensureFirstMonthProrationDecision.test.ts`). `resolveFirstMonthChargeAmount`
 *   es la MISMA función canónica de siempre — nunca una segunda fórmula —
 *   aplicada acá a los datos que la propia decisión ya guardó.
 *
 * Sólo repara cuando el cargo real diverge de ese importe recalculado Y no
 * tiene ningún pago/asignación real (mismo criterio de siempre,
 * `FirstMonthProrationHasMovementsError`) — nunca crea un cargo ni una
 * decisión duplicados: reutiliza `confirmFirstMonthProration`, que
 * actualiza el MISMO cargo (mismo id determinístico) y agrega una entrada
 * NUEVA al registro de decisiones (nunca edita ni borra la anterior — el
 * historial completo queda auditable). Si el cargo ya coincide, no se
 * agrega ninguna entrada nueva — evita spamear el registro en cada
 * arranque/vuelta a primer plano.
 */
async function reconcileExistingFirstMonthProrationDecision(
  existingDecision: FirstMonthProrationDecision,
  ctx: {
    input: EnsureFirstMonthProrationInput;
    billingPeriod: string;
    state: PaymentsRepositoryState;
    storeDeps: ConfirmFirstMonthProrationStoreDeps;
    profileDeps: ConfirmFirstMonthProrationProfileDeps;
    appendDecision: (decision: FirstMonthProrationDecision) => Promise<void>;
  }
): Promise<EnsureFirstMonthProrationOutcome> {
  const { input, billingPeriod, state, storeDeps, profileDeps, appendDecision } = ctx;

  const origin = classifyFirstMonthProrationDecisionOrigin(existingDecision);
  if (origin === 'manual') {
    return { status: 'already_decided', billingPeriod };
  }
  if (origin === 'ambiguous') {
    return { status: 'needs_manual_review', billingPeriod, reason: 'ambiguous_historical_decision' };
  }

  const frozenSuggestion: FirstMonthProrationSuggestion = buildFirstMonthProrationSuggestionFromDecision(existingDecision);
  const customAmount = existingDecision.criterion === 'custom' ? existingDecision.chargedAmount : undefined;
  const correctedAmount = resolveFirstMonthChargeAmount(frozenSuggestion, existingDecision.criterion, customAmount);

  const chargeId = existingDecision.chargeId ?? buildMonthlyChargeId(input.studentId, billingPeriod);
  const currentCharge = state.charges.find((charge) => charge.id === chargeId && charge.voidedAt === null);

  if (currentCharge) {
    const hasMovements = state.allocations.some((allocation) => allocation.chargeId === chargeId);
    if (hasMovements) return { status: 'skipped_has_movements', billingPeriod };
    if (currentCharge.originalAmount === correctedAmount) {
      return { status: 'already_decided', billingPeriod };
    }
  } else if (correctedAmount === 0) {
    // Sin cargo vigente y sin cobro esperado para este período: ya coincide.
    return { status: 'already_decided', billingPeriod };
  }

  try {
    const result = await confirmFirstMonthProration(
      { suggestion: frozenSuggestion, criterion: existingDecision.criterion, customAmount, now: input.now, source: 'automatic' },
      storeDeps,
      profileDeps,
      { appendDecision }
    );
    return { status: 'decided', billingPeriod, result };
  } catch (error) {
    if (error instanceof FirstMonthProrationHasMovementsError) {
      return { status: 'skipped_has_movements', billingPeriod };
    }
    throw error;
  }
}

/**
 * Serializa la detección completa por alumno. La cola del store de pagos
 * protege el cargo, pero la decisión vive en otro registro; sin esta guarda,
 * dos disparadores simultáneos podían leer "sin decisión" y anexar dos
 * decisiones para el mismo primer período.
 */
const ensureQueueByStudent = new Map<string, Promise<EnsureFirstMonthProrationOutcome>>();

export function ensureFirstMonthProrationDecision(
  input: EnsureFirstMonthProrationInput,
  deps: EnsureFirstMonthProrationDeps = {}
): Promise<EnsureFirstMonthProrationOutcome> {
  const previous = ensureQueueByStudent.get(input.studentId);
  const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
    ensureFirstMonthProrationDecisionInternal(input, deps)
  );
  ensureQueueByStudent.set(input.studentId, current);
  const cleanup = () => {
    if (ensureQueueByStudent.get(input.studentId) === current) ensureQueueByStudent.delete(input.studentId);
  };
  void current.then(cleanup, cleanup);
  return current;
}
