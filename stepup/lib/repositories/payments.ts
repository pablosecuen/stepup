import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { PaymentAllocationRow, PaymentChargeRow, PaymentMethod, PaymentRow, TrainingBillingAgreementRow } from "@/lib/db/database.types";
import {
  toPaymentAllocationRecord,
  toPaymentChargeRecord,
  toPaymentRecord,
  toTrainingBillingAgreementRecord,
  type PaymentAllocationRecord,
  type PaymentChargeRecord,
  type PaymentRecord,
  type TrainingBillingAgreementRecord,
} from "./payments-mapping";
import { listStudents } from "./students";
import { readTable, readRpc } from "@/lib/db/read";
import type { ChargeWithPaidAmount } from "@/lib/payments/collections-center";
import { listRecurrenceRules, type RecurrenceRuleRecord } from "./recurrence-rules";
import { listRecurrenceExceptionsForRules } from "./recurrence-exceptions";
import { listCalendarLessonsForRecurrence } from "./calendar-lessons";
import { resolveEffectiveMonthlyAmount, resolveStudentBillingPlan, type MonthlyBillingPlan } from "@/lib/payments/billing-plan";
import { isStudentBillableForPeriod } from "@/lib/payments/monthly-charge-plan";
import { resolveMonthlyDueDate, billingPeriodOfDateKey, firstDayOfBillingPeriod, lastDateKeyOfBillingPeriod } from "@/lib/payments/dates";
import {
  computeTrainingFirstPeriodCharge,
  resolveEarliestParticipantOccurrenceDateInRange,
  resolveEffectiveTrainingFee,
  isStudentEligibleForTrainingCharge,
} from "@/lib/payments/training-charge-plan";

/**
 * Repositorio de Cobros — única puerta de entrada real a `payment_charges`/
 * `payments`/`payment_allocations`/`training_billing_agreements`. Toda
 * escritura real pasa por una RPC atómica (`supabase/migrations/
 * 20260925100000_payments_engine.sql`) — nunca un `.insert()`/`.update()`
 * directo desde acá para estas cuatro tablas (mismo criterio que Fase 4).
 */
export type { PaymentChargeRecord, PaymentRecord, PaymentAllocationRecord, TrainingBillingAgreementRecord } from "./payments-mapping";

export class PaymentNotFoundError extends Error {}
export class ChargeNotFoundError extends Error {}

/** Todos los cargos vigentes o anulados del profesor — base de Centro de cobros. Filtro de "vigentes" lo decide el llamador (charge-balance.ts). */
// R2: todas las listas de Cobros se leen COMPLETAS por páginas (ver `lib/db/read.ts`): saldos, vencidos e ingresos nunca se
// calculan sobre una respuesta truncada en `max_rows`. Mismo orden de antes + `id` como desempate estable.
const CHARGE_ORDER = [
  { column: "due_date", ascending: true },
  { column: "id", ascending: true },
] as const;
const PAYMENT_ORDER = [
  { column: "paid_at", ascending: false },
  { column: "id", ascending: false },
] as const;

export async function listAllCharges(ctx: AuthenticatedDbContext): Promise<PaymentChargeRecord[]> {
  const data = await readTable<PaymentChargeRow>(ctx.supabase, "payment_charges", {
    filter: (query) => query.eq("owner_id", ctx.ownerId),
    order: CHARGE_ORDER,
  });
  return data.map(toPaymentChargeRecord);
}

/** Cargos de entrenamiento ligados a un acuerdo — lo único que necesita la generación periódica (no toda la historia de cargos). */
async function listTrainingAgreementCharges(ctx: AuthenticatedDbContext): Promise<PaymentChargeRecord[]> {
  const data = await readTable<PaymentChargeRow>(ctx.supabase, "payment_charges", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("charge_type", "entrenamiento").not("training_billing_agreement_id", "is", null),
    order: CHARGE_ORDER,
  });
  return data.map(toPaymentChargeRecord);
}

export async function listChargesForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<PaymentChargeRecord[]> {
  const data = await readTable<PaymentChargeRow>(ctx.supabase, "payment_charges", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    order: CHARGE_ORDER,
  });
  return data.map(toPaymentChargeRecord);
}

export async function listAllPayments(ctx: AuthenticatedDbContext): Promise<PaymentRecord[]> {
  const data = await readTable<PaymentRow>(ctx.supabase, "payments", {
    filter: (query) => query.eq("owner_id", ctx.ownerId),
    order: PAYMENT_ORDER,
  });
  return data.map(toPaymentRecord);
}

export async function listPaymentsForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<PaymentRecord[]> {
  const data = await readTable<PaymentRow>(ctx.supabase, "payments", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    order: PAYMENT_ORDER,
  });
  return data.map(toPaymentRecord);
}

export async function listAllAllocations(ctx: AuthenticatedDbContext): Promise<PaymentAllocationRecord[]> {
  const data = await readTable<PaymentAllocationRow>(ctx.supabase, "payment_allocations", {
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  return data.map(toPaymentAllocationRecord);
}

/**
 * Cargos vigentes con saldo pendiente + lo ya pagado (R2) — base de Inicio, Cobros y Recordatorios. Los calcula la RPC
 * `list_open_charge_balances` (propietario = `auth.uid()`, RLS aplica) en vez de descargar toda la historia de cargos,
 * asignaciones y pagos. Las reglas de vencimiento siguen en TypeScript. Se lee COMPLETA por páginas (clave `charge_id`).
 */
export async function listOpenChargeBalances(ctx: AuthenticatedDbContext): Promise<ChargeWithPaidAmount[]> {
  const rows = await readRpc<{
    charge_id: string;
    student_id: string;
    charge_type: PaymentChargeRow["charge_type"];
    due_date: string;
    original_amount: number | string;
    paid_amount: number | string;
  }>(ctx.supabase, "list_open_charge_balances", {}, { order: [{ column: "charge_id", ascending: true }], idColumn: "charge_id" });
  return rows.map((row) => ({
    charge: {
      id: row.charge_id,
      studentId: row.student_id,
      chargeType: row.charge_type,
      originalAmount: Number(row.original_amount),
      dueDate: row.due_date,
      voidedAt: null,
    },
    paidAmount: Number(row.paid_amount),
  }));
}

export async function listAllocationsForStudent(ctx: AuthenticatedDbContext, studentId: string): Promise<PaymentAllocationRecord[]> {
  const data = await readTable<PaymentAllocationRow>(ctx.supabase, "payment_allocations", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
  });
  return data.map(toPaymentAllocationRecord);
}

export interface RegisterPaymentInput {
  operationId: string;
  studentId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // YYYY-MM-DD
  notes?: string | null;
  /** `null`/ausente: reparte "obligación más antigua primero" entre TODAS las obligaciones vigentes del alumno. */
  chargeId?: string | null;
  /** Corrección/reemplazo: anula este pago viejo en la MISMA transacción. */
  replacesPaymentId?: string | null;
}

export async function registerPayment(ctx: AuthenticatedDbContext, input: RegisterPaymentInput): Promise<PaymentRecord> {
  const { data, error } = await ctx.supabase.rpc("register_payment", {
    p_payload: {
      operation_id: input.operationId,
      student_id: input.studentId,
      amount: input.amount,
      method: input.method,
      paid_at: input.paidAt,
      notes: input.notes ?? null,
      charge_id: input.chargeId ?? null,
      replaces_payment_id: input.replacesPaymentId ?? null,
    },
  });
  if (error) {
    if (error.code === "P0002") throw new PaymentNotFoundError(error.message);
    throw error;
  }
  return toPaymentRecord(data as PaymentRow);
}

export async function voidPayment(ctx: AuthenticatedDbContext, input: { paymentId: string; voidReason: string }): Promise<PaymentRecord> {
  const { data, error } = await ctx.supabase.rpc("void_payment", { p_payload: { payment_id: input.paymentId, void_reason: input.voidReason } });
  if (error) {
    if (error.code === "P0002") throw new PaymentNotFoundError(error.message);
    throw error;
  }
  return toPaymentRecord(data as PaymentRow);
}

export async function voidCharge(ctx: AuthenticatedDbContext, input: { chargeId: string; voidReason: string }): Promise<PaymentChargeRecord> {
  const { data, error } = await ctx.supabase.rpc("void_charge", { p_payload: { charge_id: input.chargeId, void_reason: input.voidReason } });
  if (error) {
    if (error.code === "P0002") throw new ChargeNotFoundError(error.message);
    throw error;
  }
  return toPaymentChargeRecord(data as PaymentChargeRow);
}

export interface MonthlyChargeCandidate {
  studentId: string;
  amount: number;
  dueDate: string;
}

/** Genera las mensualidades faltantes del período — idempotente, se puede llamar en cada carga de Centro de cobros sin riesgo de duplicar. */
export async function ensureMonthlyCharges(ctx: AuthenticatedDbContext, billingPeriod: string, candidates: MonthlyChargeCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const { data, error } = await ctx.supabase.rpc("ensure_monthly_charges", {
    p_billing_period: billingPeriod,
    p_candidates: candidates.map((c) => ({ student_id: c.studentId, amount: c.amount, due_date: c.dueDate })),
  });
  if (error) throw error;
  return data as number;
}

export interface PerClassChargeParticipant {
  studentId: string;
  /** `null`/`0`: retira el cobro si todavía no tiene pagos asignados (corrección). */
  amount: number | null;
}

/** Materializa el cobro por clase de un registro pedagógico ya finalizado/editado — se llama SIEMPRE inmediatamente después de esa RPC, nunca por separado. */
export async function syncPerClassCharge(ctx: AuthenticatedDbContext, lessonRegistrationId: string, participants: PerClassChargeParticipant[]): Promise<number> {
  if (participants.length === 0) return 0;
  const { data, error } = await ctx.supabase.rpc("sync_per_class_charge", {
    p_lesson_registration_id: lessonRegistrationId,
    p_participants: participants.map((p) => ({ student_id: p.studentId, amount: p.amount })),
  });
  if (error) throw error;
  return data as number;
}

export interface ConfigureTrainingBillingChargeInput {
  studentId: string;
  amount: number;
  dueDate: string;
  billingPeriod: string;
}

export interface ConfigureTrainingBillingInput {
  operationId: string;
  recurrenceRuleIds: string[];
  monthlyFee: number;
  trainingSeriesName: string | null;
  startPeriod: string;
  charges: ConfigureTrainingBillingChargeInput[];
}

export async function configureTrainingBilling(ctx: AuthenticatedDbContext, input: ConfigureTrainingBillingInput): Promise<{ agreementId: string; chargeIds: string[] }> {
  const { data, error } = await ctx.supabase.rpc("configure_training_billing", {
    p_payload: {
      operation_id: input.operationId,
      recurrence_rule_ids: input.recurrenceRuleIds,
      monthly_fee: input.monthlyFee,
      training_series_name: input.trainingSeriesName,
      start_period: input.startPeriod,
      charges: input.charges.map((c) => ({ student_id: c.studentId, amount: c.amount, due_date: c.dueDate, billing_period: c.billingPeriod })),
    },
  });
  if (error) throw error;
  const result = data as { agreement_id: string; charge_ids: string[] };
  return { agreementId: result.agreement_id, chargeIds: result.charge_ids };
}

export async function editTrainingBillingFee(
  ctx: AuthenticatedDbContext,
  input: { agreementId: string; pendingMonthlyFee: number; pendingMonthlyFeeEffectiveFrom: string },
): Promise<TrainingBillingAgreementRecord> {
  const { data, error } = await ctx.supabase.rpc("edit_training_billing_fee", {
    p_payload: {
      agreement_id: input.agreementId,
      pending_monthly_fee: input.pendingMonthlyFee,
      pending_monthly_fee_effective_from: input.pendingMonthlyFeeEffectiveFrom,
    },
  });
  if (error) throw error;
  return toTrainingBillingAgreementRecord(data as TrainingBillingAgreementRow);
}

export async function listTrainingBillingAgreements(ctx: AuthenticatedDbContext): Promise<TrainingBillingAgreementRecord[]> {
  const data = await readTable<TrainingBillingAgreementRow>(ctx.supabase, "training_billing_agreements", {
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  return data.map(toTrainingBillingAgreementRecord);
}

/**
 * Genera las mensualidades faltantes del período dado para TODOS los
 * alumnos con plan `'monthly'` (derivado — `resolveStudentBillingPlan`) —
 * pensada para llamarse en cada carga del Centro de cobros, igual criterio
 * que el motor automático del móvil. Idempotente por clave natural
 * (`ensure_monthly_charges`), segura de llamar en cada render/reintento.
 * Alcance de esta fase: sólo `'monthly'`/`'per_class'` — `'weekly'`/
 * `'biweekly'`/`'class_package'`/`'complimentary'` quedan fuera (no están en
 * la lista de motores pedida), documentado en WEB_PARITY_PLAN.md.
 */
export async function ensureCurrentMonthlyCharges(ctx: AuthenticatedDbContext, billingPeriod: string): Promise<number> {
  const students = await listStudents(ctx);
  const candidates: MonthlyChargeCandidate[] = [];
  for (const student of students) {
    if (!isStudentBillableForPeriod({ status: student.status, statusChangeDate: student.statusChangeDate, billingPeriod })) continue;
    const plan = resolveStudentBillingPlan({ billingPlan: student.billingPlan as MonthlyBillingPlan | null, billingType: student.billingType, price: student.price });
    if (plan.type !== "monthly") continue;
    const amount = resolveEffectiveMonthlyAmount(plan, billingPeriod);
    if (amount <= 0) continue;
    candidates.push({ studentId: student.id, amount, dueDate: resolveMonthlyDueDate(billingPeriod, plan.dueDay) });
  }
  return ensureMonthlyCharges(ctx, billingPeriod, candidates);
}

export interface TrainingChargeCandidate {
  agreementId: string;
  studentId: string;
  amount: number;
  dueDate: string;
  billingPeriod: string;
  trainingSeriesName: string | null;
}

async function ensureTrainingChargesRpc(ctx: AuthenticatedDbContext, candidates: TrainingChargeCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const { data, error } = await ctx.supabase.rpc("ensure_training_charges", {
    p_candidates: candidates.map((c) => ({
      agreement_id: c.agreementId,
      student_id: c.studentId,
      amount: c.amount,
      due_date: c.dueDate,
      billing_period: c.billingPeriod,
      training_series_name: c.trainingSeriesName,
    })),
  });
  if (error) throw error;
  return data as number;
}

function toEngineRule(rule: RecurrenceRuleRecord) {
  return {
    recurrenceId: rule.id,
    studentId: rule.primaryStudentId,
    participantIds: rule.participantIds,
    cycleLengthWeeks: rule.cycleLengthWeeks,
    weeks: rule.weeks,
    modality: rule.modality,
    timezone: rule.timezone,
    startDate: rule.startDate,
    endDate: rule.endDate,
    status: rule.status,
    classTitle: rule.classTitle,
    activityKind: rule.activityKind,
  };
}

/**
 * Generación PERIÓDICA real de cuotas de entrenamiento — brecha real
 * encontrada en la revisión de esta fase: `configure_training_billing`
 * sólo generaba el cargo del período INICIAL; nada generaba octubre,
 * noviembre, etc. de una serie ya configurada, ni consumía
 * `pending_monthly_fee` una vez llegado su período. Pensada para llamarse
 * en cada carga de Centro de cobros (y de la pestaña Cobros del alumno,
 * que puede abrirse sin pasar antes por Centro de cobros) — idempotente
 * por clave natural (`training_billing_agreement_id, student_id,
 * billing_period`, el mismo índice único de siempre).
 *
 * CORRECCIÓN REAL (revisión de esta ronda — a pedido explícito de Joaquín,
 * verificado contra el código real del móvil): la versión anterior usaba
 * `recurrence_rule_participants.created_at` como "fecha de incorporación" y
 * rellenaba con un `while` todos los períodos entre el último facturado y
 * el actual — dos errores reales:
 *   (a) `created_at` es una fecha TÉCNICA de inserción de fila, no la fecha
 *       comercial real de incorporación — el móvil NUNCA usa un campo así
 *       (no existe tal campo en su modelo). El móvil recalcula esta fecha
 *       EN VIVO a partir de ocurrencias REALES de calendario
 *       (`resolveEarliestParticipantOccurrenceDateInRange`, ver
 *       `training-charge-plan.ts` — puerto exacto, mismas dos fuentes:
 *       clases materializadas + ocurrencias virtuales sólo si la regla está
 *       activa).
 *   (b) El motor automático REAL del móvil (`runTrainingChargeGeneration`,
 *       `trainingChargeGenerationService.ts`) NUNCA mira hacia atrás — sólo
 *       evalúa el período ACTUAL en cada corrida, nunca un rango. Un
 *       `while` que rellena huecos podía generar de nuevo un período en el
 *       que el alumno ya estaba inactivo (sólo porque hoy volvió a estar
 *       activo) — la regla real, estricta, es que un período NUNCA se
 *       revisita retroactivamente por generación automática. Corregido:
 *       esta función ahora sólo evalúa `currentBillingPeriod` (el "ahora"
 *       real, igual que el móvil) — nunca un rango. Como consecuencia
 *       directa y estructural (no un caso especial agregado a mano):
 *     - un alumno activo en agosto, inactivo en septiembre, reactivado en
 *       octubre nunca recibe un cargo de septiembre (esa corrida nunca lo
 *       evalúa) — sólo agosto (cuando corrió) y octubre (cuando corre de
 *       nuevo, ya reactivado);
 *     - una serie pausada y luego reanudada nunca "rellena" los períodos
 *       de la pausa — vuelve a evaluar sólo desde el período en que se
 *       reanuda en adelante;
 *     - un hueco real (la profesora no abrió Cobros durante meses) se
 *       comporta EXACTAMENTE igual que el móvil: esos períodos intermedios
 *       nunca se generan, nunca hay backfill — mismo límite real, no una
 *       regresión de este puerto.
 *
 * `effectiveBillingStart` (nunca antes del inicio real del acuerdo ni de la
 * regla) se aplica acotando el RANGO DE BÚSQUEDA de la ocurrencia más
 * temprana — nunca hace falta "clampear" después: `resolveEarliestParticipantOccurrenceDateInRange`
 * estructuralmente no puede devolver una fecha anterior al máximo de
 * (`agreement.startPeriod`, `rule.startDate`) porque nunca busca ahí.
 */
export async function ensureTrainingCharges(ctx: AuthenticatedDbContext, currentBillingPeriod: string): Promise<number> {
  const [agreements, allRules, allStudents, allTrainingCharges] = await Promise.all([
    listTrainingBillingAgreements(ctx),
    listRecurrenceRules(ctx),
    listStudents(ctx),
    listTrainingAgreementCharges(ctx),
  ]);
  if (agreements.length === 0) return 0;

  const studentsById = new Map(allStudents.map((s) => [s.id, s]));
  const rulesByAgreement = new Map<string, RecurrenceRuleRecord[]>();
  allRules.forEach((rule) => {
    if (!rule.trainingBillingAgreementId) return;
    const list = rulesByAgreement.get(rule.trainingBillingAgreementId) ?? [];
    list.push(rule);
    rulesByAgreement.set(rule.trainingBillingAgreementId, list);
  });
  const trainingChargesByAgreement = new Map<string, PaymentChargeRecord[]>();
  allTrainingCharges
    .filter((c) => c.chargeType === "entrenamiento" && c.trainingBillingAgreementId)
    .forEach((c) => {
      const key = c.trainingBillingAgreementId as string;
      const list = trainingChargesByAgreement.get(key) ?? [];
      list.push(c);
      trainingChargesByAgreement.set(key, list);
    });

  const currentPeriodStartDateKey = firstDayOfBillingPeriod(currentBillingPeriod);
  const currentPeriodEndDateKey = lastDateKeyOfBillingPeriod(currentBillingPeriod);
  const candidates: TrainingChargeCandidate[] = [];

  for (const agreement of agreements) {
    const rules = rulesByAgreement.get(agreement.id) ?? [];
    const activeRules = rules.filter((r) => r.status === "active");
    if (activeRules.length === 0) continue; // serie pausada/finalizada -> nunca genera cargos nuevos (ver comentario de arriba).

    const activeRuleIds = activeRules.map((r) => r.id);
    const [exceptions, lessonsPerRule] = await Promise.all([
      listRecurrenceExceptionsForRules(ctx, activeRuleIds),
      Promise.all(activeRuleIds.map((id) => listCalendarLessonsForRecurrence(ctx, id))),
    ]);
    // Lecciones separadas por regla — nunca mezcladas entre reglas del mismo
    // linaje (una materializada de la regla sucesora jamás puede atribuirse
    // a la original, ni viceversa).
    const lessonsByRuleId = new Map(activeRuleIds.map((id, index) => [id, lessonsPerRule[index]]));
    const trainingSeriesName = activeRules[0]?.classTitle ?? null;
    const agreementStartDateKey = firstDayOfBillingPeriod(agreement.startPeriod);

    const studentIds = new Set(activeRules.flatMap((r) => r.participantIds));
    const existingForAgreement = trainingChargesByAgreement.get(agreement.id) ?? [];

    for (const studentId of studentIds) {
      const student = studentsById.get(studentId);
      if (!student || !isStudentEligibleForTrainingCharge(student.status)) continue;

      const existingForStudent = existingForAgreement.filter((c) => c.studentId === studentId);

      if (existingForStudent.length > 0) {
        // No es el primer período — sólo asegura el período ACTUAL (nunca
        // retrocede), mismo alcance real que `runTrainingChargeGeneration`.
        if (existingForStudent.some((c) => c.billingPeriod === currentBillingPeriod)) continue;
        candidates.push({
          agreementId: agreement.id,
          studentId,
          amount: resolveEffectiveTrainingFee(agreement, currentBillingPeriod),
          dueDate: resolveMonthlyDueDate(currentBillingPeriod, 10),
          billingPeriod: currentBillingPeriod,
          trainingSeriesName,
        });
        continue;
      }

      // Primer período real jamás facturado — busca la fecha efectiva REAL
      // de incorporación (nunca antes del inicio del acuerdo ni de la
      // regla) a través de TODAS las reglas activas donde participa.
      // Nunca hacia atrás: la búsqueda siempre arranca (como mínimo) en el
      // inicio del período ACTUAL — nunca puede "descubrir" retroactivamente
      // una ocurrencia de un período ya pasado (p. ej. el acuerdo empezó en
      // septiembre pero esta corrida es de octubre: septiembre nunca se
      // evalúa). Mismo alcance real que `runTrainingChargeGeneration`.
      let effectiveJoinDate: string | null = null;
      let matchingRule: RecurrenceRuleRecord | null = null;
      for (const rule of activeRules) {
        if (!rule.participantIds.includes(studentId)) continue;
        const searchStartDateKey = [currentPeriodStartDateKey, agreementStartDateKey, rule.startDate].reduce((max, key) => (key > max ? key : max));
        const found = resolveEarliestParticipantOccurrenceDateInRange({
          rule: toEngineRule(rule),
          studentId,
          exceptions,
          existingLessons: lessonsByRuleId.get(rule.id) ?? [],
          rangeStartDateKey: searchStartDateKey,
          rangeEndDateKey: currentPeriodEndDateKey,
        });
        if (found !== null && (effectiveJoinDate === null || found < effectiveJoinDate)) {
          effectiveJoinDate = found;
          matchingRule = rule;
        }
      }
      if (effectiveJoinDate === null || matchingRule === null) continue; // todavía ninguna ocurrencia real en el período actual -> nada que facturar por ahora.

      const first = computeTrainingFirstPeriodCharge({
        rule: toEngineRule(matchingRule),
        exceptions,
        existingLessons: lessonsByRuleId.get(matchingRule.id) ?? [],
        effectiveJoinDate,
        monthlyFee: resolveEffectiveTrainingFee(agreement, billingPeriodOfDateKey(effectiveJoinDate)),
      });
      // Defensivo: estructuralmente `amount` nunca debería ser 0 acá (ver
      // comentario de `resolveEarliestParticipantOccurrenceDateInRange` —
      // la fecha siempre sale de una ocurrencia real dentro del período) —
      // pero `payment_charges.original_amount` exige > 0, así que nunca se
      // inserta un candidato inválido de todos modos.
      if (first.amount <= 0) continue;
      // Defensivo: la fecha de búsqueda ya está acotada al período actual,
      // así que esto nunca debería dispararse — pero se descarta explícitamente
      // cualquier candidato cuyo billingPeriod no sea el período que esta
      // corrida está generando (nunca se inserta un período distinto al actual).
      if (first.billingPeriod !== currentBillingPeriod) continue;
      candidates.push({ agreementId: agreement.id, studentId, amount: first.amount, dueDate: first.dueDate, billingPeriod: first.billingPeriod, trainingSeriesName });
    }
  }

  return ensureTrainingChargesRpc(ctx, candidates);
}
