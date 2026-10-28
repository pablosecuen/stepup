// Puerto VERBATIM del original (`src/features/payments/utils/financialReconciliation.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { FirstMonthProrationDecision, Payment, PaymentAdjustment, PaymentAllocation, PaymentCharge, PaymentChargeType, PaymentsRepositoryState } from '../types/index.ts';
import type { StudentBillingPlan, StudentStatus } from '../../student-profile/types/index.ts';
import { DEFAULT_MONTHLY_DUE_DAY, resolveEffectiveMonthlyAmount } from '../../student-profile/utils/studentBillingPlan.ts';
import { calculateChargeState, calculatePaidAmountForCharge, isSurchargeWaivedForCharge } from './paymentCalculations.ts';
import { calculateSurchargeAmount, determineDueStage, resolveMonthlyDueDateUrgency } from './paymentDueStage.ts';
import { billingPeriodOfDateKey, resolveMonthlyDueDate, toDateKey } from './paymentDates.ts';
import { resolveFirstPeriodDueDate } from './firstPeriodDueDate.ts';
import { buildAdjustment, voidCharge } from './paymentMutations.ts';
import { isStudentBillableForPeriod } from './monthlyChargeGenerationPlan.ts';
import { resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';

/**
 * CORRECCIÓN GENERAL (a pedido de Joaquín — alta a mitad de mes y métricas
 * financieras): causa raíz real del "desbalance" reportado — un alumno
 * mensual dado de alta a mitad de mes, con su primer período correctamente
 * prorrateado (`confirmFirstMonthProration`, cargo real con `originalAmount`
 * reducido), volvía a mostrar/cobrar la mensualidad COMPLETA porque esta
 * misma reconciliación (pensada para sincronizar un cargo con un CAMBIO DE
 * PRECIO del plan, corrección 2026-08-10) trataba cualquier divergencia
 * entre `charge.originalAmount` y `resolveEffectiveMonthlyAmount(plan, ...)`
 * como un error a corregir en silencio — sin saber que el primer período
 * diverge A PROPÓSITO. Corre automáticamente en cada arranque/vuelta a
 * primer plano de la app (`App.tsx`) y ANTES de cada pago
 * (`registerPaymentService.ts`), así que el importe prorrateado podía
 * revertirse a la cuota completa sin que la profesora tocara nada — y
 * "editar posteriormente la cuota habitual" (subir/bajar el precio del
 * plan) disparaba exactamente esa reversión en el siguiente arranque.
 *
 * Fix: una obligación con una decisión de primer mes registrada
 * (`FirstMonthProrationDecision`, para el mismo alumno+período) nunca se
 * considera "divergente" ni se reconcilia contra el plan — sigue siendo el
 * cargo real prorrateado, para siempre, sin importar cuántas veces cambie
 * después la cuota habitual del plan. `firstMonthProrationDecisions` es
 * opcional (default `[]`) para no romper ningún llamador existente que
 * todavía no lo conoce.
 */
function findMatchingFirstMonthProrationDecision(
  decisions: readonly FirstMonthProrationDecision[],
  studentId: string,
  billingPeriod: string
): FirstMonthProrationDecision | null {
  const matches = decisions.filter((entry) => entry.studentId === studentId && entry.billingPeriod === billingPeriod);
  if (matches.length === 0) return null;
  return matches.reduce((latest, entry) => (entry.confirmedAt > latest.confirmedAt ? entry : latest));
}

/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual, PARTE 8): analizador global de SÓLO LECTURA —
 * nunca muta nada — que recorre las 4 colecciones financieras y a todos los
 * alumnos existentes buscando exactamente las inconsistencias pedidas. Cada
 * `finding` conserva el `studentId` internamente (para que un flujo de
 * reparación futuro pueda actuar), pero la interfaz que la profesora ve
 * (`FinancialConsistencyReport.countsByCategory`) sólo informa CANTIDADES,
 * nunca nombres ni ningún otro dato personal.
 */
export type FinancialInconsistencyCategory =
  | 'plan_amount_diverges_from_charge'
  | 'monthly_student_without_current_charge'
  | 'duplicate_monthly_charge'
  | 'charge_without_billing_period'
  | 'charge_without_student'
  | 'payment_without_student'
  | 'allocation_without_payment'
  | 'allocation_without_charge'
  | 'negative_balance'
  | 'settled_charge_with_residual_balance'
  | 'voided_charge_with_active_allocations'
  | 'voided_payment_with_active_allocations'
  | 'per_class_charge_incompatible_with_monthly_plan';

export interface FinancialInconsistencyFinding {
  category: FinancialInconsistencyCategory;
  /** `null` cuando la inconsistencia no puede atribuirse a un alumno puntual (p. ej. una asignación totalmente huérfana). */
  studentId: string | null;
  /** Texto técnico interno para depuración — nunca se muestra tal cual a la profesora (podría incluir ids de cargos/pagos). */
  detail: string;
}

export type FinancialConsistencyCounts = Record<FinancialInconsistencyCategory, number>;

export interface FinancialConsistencyReport {
  findings: FinancialInconsistencyFinding[];
  countsByCategory: FinancialConsistencyCounts;
  totalFindings: number;
}

const EMPTY_COUNTS: FinancialConsistencyCounts = {
  plan_amount_diverges_from_charge: 0,
  monthly_student_without_current_charge: 0,
  duplicate_monthly_charge: 0,
  charge_without_billing_period: 0,
  charge_without_student: 0,
  payment_without_student: 0,
  allocation_without_payment: 0,
  allocation_without_charge: 0,
  negative_balance: 0,
  settled_charge_with_residual_balance: 0,
  voided_charge_with_active_allocations: 0,
  voided_payment_with_active_allocations: 0,
  per_class_charge_incompatible_with_monthly_plan: 0,
};

export function analyzeFinancialConsistency(input: {
  state: PaymentsRepositoryState;
  students: Array<{ id: string; status: StudentStatus }>;
  resolvePlan: (studentId: string) => StudentBillingPlan | null;
  evaluationDate: string;
  /** Decisiones de primer mes proporcional ya confirmadas — un cargo con una decisión propia nunca se reporta como divergente. */
  firstMonthProrationDecisions?: readonly FirstMonthProrationDecision[];
  /** Configuración REAL de recargos vigente — sin esto, "saldo negativo"/"saldado con residuo" se evaluaban como si los recargos siempre estuvieran activados. */
  surchargeSettings?: SurchargeSettings;
}): FinancialConsistencyReport {
  const { state, students, resolvePlan, evaluationDate, firstMonthProrationDecisions = [], surchargeSettings } = input;
  const findings: FinancialInconsistencyFinding[] = [];
  const studentIds = new Set(students.map((student) => student.id));
  const currentBillingPeriod = billingPeriodOfDateKey(evaluationDate);

  // --- 1. Plan vs. cargo actual divergen ---------------------------------
  students
    .filter((student) => student.status === 'activo')
    .forEach((student) => {
      const plan = resolvePlan(student.id);
      if (!plan || plan.type !== 'monthly') return;
      if (plan.startPeriod && currentBillingPeriod < plan.startPeriod) return;

      const charge = state.charges.find(
        (item) =>
          item.studentId === student.id &&
          item.type === 'mensual' &&
          item.billingPeriod === currentBillingPeriod &&
          item.voidedAt === null
      );

      if (!charge) {
        // --- 2. Alumno mensual activo sin cargo del período actual, ya vencido el margen de generación ---
        // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
        // mensualidades "Mes vencido" al comenzar el mes): vencimiento REAL
        // del alumno (`resolveMonthlyDueDate`, con su `dueDay` real — nunca
        // el día 1) y vencimiento real para decidir "¿ya deberíamos tener
        // el cargo?" (`resolveMonthlyDueDateUrgency`, única fuente).
        const dueDate = resolveMonthlyDueDate(currentBillingPeriod, plan.dueDay);
        const dueStatus = resolveMonthlyDueDateUrgency(dueDate, evaluationDate);
        if (dueStatus.urgency === 'mes_vencido') {
          findings.push({
            category: 'monthly_student_without_current_charge',
            studentId: student.id,
            detail: `sin cargo mensual de ${currentBillingPeriod}, ya fuera del margen de generación`,
          });
        }
        return;
      }

      // Primer mes con proporcional/personalizado/decisión propia ya
      // confirmada: divergir del plan es EXACTAMENTE lo esperado, nunca una
      // inconsistencia a reportar.
      if (findMatchingFirstMonthProrationDecision(firstMonthProrationDecisions, student.id, currentBillingPeriod)) return;

      const effectiveAmount = resolveEffectiveMonthlyAmount(plan, currentBillingPeriod);
      if (charge.originalAmount !== effectiveAmount) {
        findings.push({
          category: 'plan_amount_diverges_from_charge',
          studentId: student.id,
          detail: `cargo ${charge.id}: originalAmount=${charge.originalAmount}, plan efectivo=${effectiveAmount}`,
        });
      }
    });

  // --- 3. Cargos mensuales duplicados (mismo alumno+período+tipo, ids distintos) ---
  const monthlyGroups = new Map<string, PaymentCharge[]>();
  state.charges
    .filter((charge) => charge.type === 'mensual' && charge.voidedAt === null && charge.billingPeriod)
    .forEach((charge) => {
      const key = `${charge.studentId}__${charge.billingPeriod}`;
      const group = monthlyGroups.get(key) ?? [];
      group.push(charge);
      monthlyGroups.set(key, group);
    });
  monthlyGroups.forEach((group) => {
    if (group.length > 1) {
      findings.push({
        category: 'duplicate_monthly_charge',
        studentId: group[0].studentId,
        detail: `${group.length} cargos mensuales vigentes para ${group[0].billingPeriod}: ${group.map((c) => c.id).join(', ')}`,
      });
    }
  });

  // --- 4. Cargos por período sin billingPeriod ---------------------------
  state.charges
    .filter((charge) => (charge.type === 'mensual' || charge.type === 'semanal' || charge.type === 'quincenal') && !charge.billingPeriod)
    .forEach((charge) => {
      findings.push({
        category: 'charge_without_billing_period',
        studentId: charge.studentId,
        detail: `cargo ${charge.id} (${charge.type}) sin billingPeriod`,
      });
    });

  // --- 5/6. Cargos/pagos sin alumno reconocible ---------------------------
  state.charges
    .filter((charge) => !studentIds.has(charge.studentId))
    .forEach((charge) => {
      findings.push({ category: 'charge_without_student', studentId: null, detail: `cargo ${charge.id} → alumno inexistente` });
    });
  state.payments
    .filter((payment) => !studentIds.has(payment.studentId))
    .forEach((payment) => {
      findings.push({ category: 'payment_without_student', studentId: null, detail: `pago ${payment.id} → alumno inexistente` });
    });

  // --- 7/8. Asignaciones huérfanas ---------------------------------------
  const paymentsById = new Map(state.payments.map((payment) => [payment.id, payment]));
  const chargesById = new Map(state.charges.map((charge) => [charge.id, charge]));
  state.allocations.forEach((allocation) => {
    const payment = paymentsById.get(allocation.paymentId);
    const charge = chargesById.get(allocation.chargeId);
    if (!payment) {
      findings.push({
        category: 'allocation_without_payment',
        studentId: allocation.studentId,
        detail: `asignación ${allocation.id} → pago inexistente (${allocation.paymentId})`,
      });
    }
    if (!charge) {
      findings.push({
        category: 'allocation_without_charge',
        studentId: allocation.studentId,
        detail: `asignación ${allocation.id} → cargo inexistente (${allocation.chargeId})`,
      });
    }
    if (payment && payment.voidedAt !== null) {
      findings.push({
        category: 'voided_payment_with_active_allocations',
        studentId: allocation.studentId,
        detail: `asignación ${allocation.id} apunta a un pago anulado (${payment.id})`,
      });
    }
    if (charge && charge.voidedAt !== null) {
      findings.push({
        category: 'voided_charge_with_active_allocations',
        studentId: allocation.studentId,
        detail: `asignación ${allocation.id} apunta a un cargo anulado (${charge.id})`,
      });
    }
  });

  // --- 9/10. Saldos negativos y cargos "saldados" con saldo residual positivo ---
  state.charges
    .filter((charge) => charge.voidedAt === null)
    .forEach((charge) => {
      const chargeState = calculateChargeState({
        charge,
        allocations: state.allocations,
        payments: state.payments,
        adjustments: state.adjustments,
        evaluationDate,
        surchargeSettings,
      });
      if (chargeState.balance < 0) {
        findings.push({
          category: 'negative_balance',
          studentId: charge.studentId,
          detail: `cargo ${charge.id}: saldo ${chargeState.balance} (incluye asignaciones que superan lo requerido)`,
        });
      }
      if (chargeState.settledAt !== null && chargeState.balance > 0) {
        // Defensivo: por diseño, `calculateChargeState` nunca debería dejar
        // saldo positivo en un cargo ya saldado — si esto aparece alguna
        // vez, es una señal real de que algo rompió esa invariante.
        findings.push({
          category: 'settled_charge_with_residual_balance',
          studentId: charge.studentId,
          detail: `cargo ${charge.id}: settledAt=${chargeState.settledAt} pero saldo=${chargeState.balance}`,
        });
      }
    });

  // ---------------------------------------------------------------------
  // 11. Cargo por clase incompatible con el plan mensual VIGENTE del alumno
  // ---------------------------------------------------------------------
  // Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
  // contradictorios "Agosto pendiente" + "Pago vencido" en la lista de
  // Alumnos): `planPerClassChargesForLesson` ya impedía generar un cargo
  // `por_clase` NUEVO para un alumno mensual (`billingPlanAsksPerClass`
  // sólo es true con `type: 'per_class'`) — pero un cargo `por_clase` que
  // se generó ANTES de que el alumno pasara a mensual seguía activo para
  // siempre, envejeciendo sin que nada lo reconcilie: se volvía "vencido"
  // por su cuenta mientras la mensualidad del mismo período todavía estaba
  // "pendiente en término", produciendo exactamente el par contradictorio
  // reportado. El modelo no guarda desde cuándo un plan está vigente (no
  // hay historial de cambios de plan), así que no se puede reconstruir con
  // certeza si un cargo por clase VIEJO (de un período ANTERIOR al actual)
  // era legítimo en su momento — ésos nunca se tocan, quedan como deuda
  // histórica. Lo que SÍ se puede afirmar con certeza, para cualquier
  // alumno, es que ninguna clase del período ACTUAL (o de uno futuro)
  // puede generar un cargo por clase mientras el plan vigente sea mensual
  // — ver la regla exacta más arriba. `billingPeriodOfDateKey(dueDate) >=
  // currentBillingPeriod` es esa comprobación, sin depender de ningún
  // alumno/importe/fecha puntual.
  state.charges
    .filter((charge) => charge.type === 'por_clase' && charge.voidedAt === null)
    .forEach((charge) => {
      if (!studentIds.has(charge.studentId)) return; // ya cubierto por el hallazgo 5/6
      const student = students.find((item) => item.id === charge.studentId);
      if (!student || student.status !== 'activo') return;
      const plan = resolvePlan(charge.studentId);
      if (!plan || plan.type !== 'monthly') return;
      const chargePeriod = billingPeriodOfDateKey(toDateKey(charge.dueDate));
      if (chargePeriod < currentBillingPeriod) return; // deuda histórica: nunca se toca sin certeza

      findings.push({
        category: 'per_class_charge_incompatible_with_monthly_plan',
        studentId: charge.studentId,
        detail: `cargo ${charge.id} (por_clase, vence ${charge.dueDate}) incompatible con el plan mensual vigente`,
      });
    });

  const countsByCategory: FinancialConsistencyCounts = { ...EMPTY_COUNTS };
  findings.forEach((finding) => {
    countsByCategory[finding.category] += 1;
  });

  return { findings, countsByCategory, totalFindings: findings.length };
}

// ---------------------------------------------------------------------------
// PARTE 8 (continuación) — reparación automática, sólo de duplicados
// TÉCNICOS demostrables: nunca se reparte un pago automáticamente entre
// duplicados ambiguos, nunca se borra nada (sólo se anula, con motivo, y el
// historial queda intacto).
// ---------------------------------------------------------------------------

export interface DuplicateMonthlyChargeRepairAction {
  studentId: string;
  billingPeriod: string;
  /** El cargo que se conserva (el único con actividad real, o el más antiguo si ninguno tiene pagos). */
  keptChargeId: string;
  /** Cargos duplicados que se anulan — nunca se borran, quedan visibles en el historial como anulados. */
  voidedChargeIds: string[];
}

export interface DuplicateMonthlyChargeRepairPlan {
  actions: DuplicateMonthlyChargeRepairAction[];
  /** Grupos detectados como duplicados pero AMBIGUOS (más de un cargo con pagos reales) — requieren revisión manual, nunca se tocan solos. */
  ambiguousGroups: Array<{ studentId: string; billingPeriod: string; chargeIds: string[] }>;
  updatedCharges: PaymentCharge[];
}

/**
 * Identifica duplicados mensuales técnicos (mismo alumno+período+tipo,
 * ids distintos — nunca puede pasar por la generación normal, que usa un id
 * determinístico) y sólo repara el caso SIN AMBIGÜEDAD: exactamente un
 * cargo del grupo tiene pagos asignados (o ninguno tiene, y se conserva el
 * más antiguo por `createdAt`) — el/los otro(s) se anulan, nunca se borran.
 * Si más de un cargo del grupo tiene pagos reales asignados, el grupo queda
 * SIN TOCAR en `ambiguousGroups`: distinguir cuál es el "real" ahí exige
 * criterio humano, no una regla automática. Idempotente — correrla de nuevo
 * sobre el resultado no encuentra más duplicados que reparar. Pura — no
 * muta `state`.
 */
export function planDuplicateMonthlyChargeRepair(input: {
  state: PaymentsRepositoryState;
  voidedAt: string;
  reason?: string;
}): DuplicateMonthlyChargeRepairPlan {
  const reason = input.reason?.trim() || 'Duplicado técnico detectado automáticamente (reconciliación)';
  const groups = new Map<string, PaymentCharge[]>();
  input.state.charges
    .filter((charge) => charge.type === 'mensual' && charge.voidedAt === null && charge.billingPeriod)
    .forEach((charge) => {
      const key = `${charge.studentId}__${charge.billingPeriod}`;
      const group = groups.get(key) ?? [];
      group.push(charge);
      groups.set(key, group);
    });

  const actions: DuplicateMonthlyChargeRepairAction[] = [];
  const ambiguousGroups: DuplicateMonthlyChargeRepairPlan['ambiguousGroups'] = [];
  let updatedCharges = input.state.charges;

  groups.forEach((group) => {
    if (group.length < 2) return;

    const withPayments = group.filter(
      (charge) => calculatePaidAmountForCharge(charge.id, input.state.allocations, input.state.payments) > 0
    );

    if (withPayments.length > 1) {
      ambiguousGroups.push({
        studentId: group[0].studentId,
        billingPeriod: group[0].billingPeriod as string,
        chargeIds: group.map((charge) => charge.id),
      });
      return;
    }

    const kept = withPayments.length === 1
      ? withPayments[0]
      : [...group].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    const toVoid = group.filter((charge) => charge.id !== kept.id);

    actions.push({
      studentId: kept.studentId,
      billingPeriod: kept.billingPeriod as string,
      keptChargeId: kept.id,
      voidedChargeIds: toVoid.map((charge) => charge.id),
    });

    toVoid.forEach((charge) => {
      updatedCharges = voidCharge(updatedCharges, charge.id, reason, input.voidedAt);
    });
  });

  return { actions, ambiguousGroups, updatedCharges };
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO GENERAL: cuota
// mensual y obligación desincronizadas): reparación de datos YA
// desincronizados por el gap real de `planMonthlyAmountChange` (buscaba el
// cargo vigente sólo por `buildMonthlyChargeId`, nunca por identidad
// semántica — ver `monthlyAmountCorrection.ts`). Un cargo mensual vigente
// (mismo alumno + `mensual` + billingPeriod actual + no anulado) cuyo
// `originalAmount` quedó divergiendo del importe efectivo del plan (el
// hallazgo `plan_amount_diverges_from_charge` de arriba) se sincroniza acá,
// SIEMPRE respetando lo ya pagado — nunca inventa saldo a favor, nunca
// reescribe un período ya saldado, nunca toca períodos anteriores ni cargos
// anulados. Idempotente — correrla de nuevo sobre el resultado no encuentra
// más divergencias que reparar. Pura — no muta `state`.
// ---------------------------------------------------------------------------

export interface MonthlyAmountReconciliationAction {
  studentId: string;
  billingPeriod: string;
  chargeId: string;
  previousAmount: number;
  newAmount: number;
}

export interface MonthlyAmountReconciliationReviewItem {
  studentId: string;
  billingPeriod: string;
  chargeId: string;
  /** Ya asignado (pagos reales) contra este cargo — mayor al importe efectivo del plan. */
  alreadyAllocated: number;
  /** Importe efectivo del plan para el período — sería MENOR a lo ya asignado si se aplicara sin más. */
  planAmount: number;
}

export interface MonthlyAmountReconciliationPlan {
  actions: MonthlyAmountReconciliationAction[];
  /** Divergencias detectadas donde sincronizar generaría saldo a favor — nunca se tocan solas, requieren corrección manual explícita. */
  needsReview: MonthlyAmountReconciliationReviewItem[];
  updatedCharges: PaymentCharge[];
}

/**
 * Recorre alumnos ACTIVOS con plan mensual vigente para el período evaluado
 * y sincroniza el cargo mensual vigente del período ACTUAL cuyo
 * `originalAmount` diverge del importe efectivo del plan — identificado por
 * identidad semántica, nunca por id determinístico (mismo criterio que ya
 * corrige `planMonthlyAmountChange`). Reglas, en orden:
 *   - sin cargo del período: nada que reconciliar acá (otro flujo se
 *     encarga de crearlo — `runMonthlyChargeGeneration`/`correctMonthlyAmount`);
 *   - cargo ya saldado (balance <= 0): NUNCA se toca, es historia financiera
 *     cerrada;
 *   - sin pagos asignados: se reemplaza el importe directamente;
 *   - con pago parcial y el importe del plan es MENOR a lo ya asignado: se
 *     reporta en `needsReview`, nunca se sincroniza sola (generaría saldo a
 *     favor silencioso);
 *   - con pago parcial y el importe del plan es igual o mayor a lo ya
 *     asignado: se sincroniza, el saldo se recalcula solo contra el nuevo
 *     importe (misma fórmula que ya usa `calculateChargeState`).
 * Nunca toca períodos anteriores al evaluado, nunca cargos anulados, nunca
 * duplica un cargo.
 */
export function planMonthlyAmountReconciliationRepair(input: {
  state: PaymentsRepositoryState;
  students: Array<{ id: string; status: StudentStatus }>;
  resolvePlan: (studentId: string) => StudentBillingPlan | null;
  evaluationDate: string;
  /** Decisiones de primer mes proporcional ya confirmadas — un cargo con una decisión propia nunca se reconcilia contra el plan. */
  firstMonthProrationDecisions?: readonly FirstMonthProrationDecision[];
  /** Configuración REAL de recargos vigente — el gate "ya saldado: nunca se reescribe" debe evaluarse con la configuración real, nunca con recargos activados por defecto. */
  surchargeSettings?: SurchargeSettings;
}): MonthlyAmountReconciliationPlan {
  const { state, students, resolvePlan, evaluationDate, firstMonthProrationDecisions = [], surchargeSettings } = input;
  const currentBillingPeriod = billingPeriodOfDateKey(evaluationDate);

  const actions: MonthlyAmountReconciliationAction[] = [];
  const needsReview: MonthlyAmountReconciliationReviewItem[] = [];
  let updatedCharges = state.charges;

  students
    .filter((student) => student.status === 'activo')
    .forEach((student) => {
      const plan = resolvePlan(student.id);
      if (!plan || plan.type !== 'monthly') return;
      if (plan.startPeriod && currentBillingPeriod < plan.startPeriod) return;

      const charge = updatedCharges.find(
        (item) =>
          item.studentId === student.id &&
          item.type === 'mensual' &&
          item.billingPeriod === currentBillingPeriod &&
          item.voidedAt === null
      );
      if (!charge) return; // sin cargo vigente todavía: no es este flujo el que lo crea.

      // CORRECCIÓN GENERAL (alta a mitad de mes): un cargo con una decisión
      // de primer mes proporcional propia NUNCA se reescribe con el importe
      // del plan — esa es precisamente la fuente de verdad de este período,
      // por diseño distinta de la cuota habitual. Editar la cuota habitual
      // después nunca debe convertir retroactivamente la media cuota en una
      // cuota completa.
      if (findMatchingFirstMonthProrationDecision(firstMonthProrationDecisions, student.id, currentBillingPeriod)) return;

      const effectiveAmount = resolveEffectiveMonthlyAmount(plan, currentBillingPeriod);
      if (charge.originalAmount === effectiveAmount) return; // ya coincide, nada que reparar.

      const chargeState = calculateChargeState({
        charge,
        allocations: state.allocations,
        payments: state.payments,
        adjustments: state.adjustments,
        evaluationDate,
        surchargeSettings,
      });
      if (chargeState.balance <= 0) return; // ya saldado: nunca se reescribe historia financiera.

      const alreadyAllocated = calculatePaidAmountForCharge(charge.id, state.allocations, state.payments);
      if (alreadyAllocated > effectiveAmount) {
        needsReview.push({
          studentId: student.id,
          billingPeriod: currentBillingPeriod,
          chargeId: charge.id,
          alreadyAllocated,
          planAmount: effectiveAmount,
        });
        return;
      }

      actions.push({
        studentId: student.id,
        billingPeriod: currentBillingPeriod,
        chargeId: charge.id,
        previousAmount: charge.originalAmount,
        newAmount: effectiveAmount,
      });
      updatedCharges = updatedCharges.map((item) =>
        item.id === charge.id ? { ...item, originalAmount: effectiveAmount } : item
      );
    });

  return { actions, needsReview, updatedCharges };
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
// contradictorios "Agosto pendiente" + "Pago vencido"): reparación
// automática, idempotente y auditable de cargos `por_clase` incompatibles
// con el plan mensual VIGENTE del alumno (ver el hallazgo 11 de
// `analyzeFinancialConsistency`, arriba, mismo criterio exacto). Nunca
// borra nada — sólo anula (`voidCharge`, con motivo) los cargos SIN ningún
// pago asignado; los que sí tienen pagos reales quedan intactos en
// `needsReview` (nunca se tocan solos: anularlos borraría el rastro de un
// pago real, contra la regla de "nunca borrar información" — el saldo, si
// queda alguno, sigue mostrándose como una deuda real y auditable). No
// depende de ningún alumno/importe/fecha concreto: sólo mira el tipo de
// cargo, el plan vigente y la fecha, igual para cualquier alumno actual o
// futuro.
// ---------------------------------------------------------------------------

export interface IncompatiblePerClassChargeRepairAction {
  studentId: string;
  voidedChargeId: string;
}

export interface IncompatiblePerClassChargeRepairPlan {
  actions: IncompatiblePerClassChargeRepairAction[];
  /** Cargos incompatibles detectados que YA tienen pagos asignados — nunca se anulan solos, requieren revisión manual. */
  needsReview: Array<{ studentId: string; chargeId: string }>;
  updatedCharges: PaymentCharge[];
}

/**
 * Identifica cargos `por_clase` activos, del período de facturación ACTUAL
 * o de uno futuro, para un alumno cuyo plan vigente ya es mensual — y
 * anula automáticamente sólo los que no tienen ningún pago asignado. Un
 * cargo `por_clase` de un período ANTERIOR al actual nunca se toca (puede
 * ser deuda histórica legítima de cuando el alumno todavía pagaba por
 * clase; el modelo no guarda desde cuándo cambió de plan, así que nunca se
 * asume eso sin certeza). Idempotente — correrla de nuevo sobre el
 * resultado no encuentra más cargos que reparar (los ya anulados quedan
 * fuera por `voidedAt === null`). Pura — no muta `state`.
 */
export function planIncompatiblePerClassChargeRepair(input: {
  state: PaymentsRepositoryState;
  students: Array<{ id: string; status: StudentStatus }>;
  resolvePlan: (studentId: string) => StudentBillingPlan | null;
  evaluationDate: string;
  voidedAt: string;
  reason?: string;
}): IncompatiblePerClassChargeRepairPlan {
  const reason =
    input.reason?.trim() ||
    'Cargo por clase incompatible con el plan mensual vigente del alumno para este período (reconciliación automática)';
  const currentBillingPeriod = billingPeriodOfDateKey(input.evaluationDate);
  const activeStudentIds = new Set(
    input.students.filter((student) => student.status === 'activo').map((student) => student.id)
  );

  const actions: IncompatiblePerClassChargeRepairAction[] = [];
  const needsReview: IncompatiblePerClassChargeRepairPlan['needsReview'] = [];
  let updatedCharges = input.state.charges;

  input.state.charges
    .filter(
      (charge) => charge.type === 'por_clase' && charge.voidedAt === null && activeStudentIds.has(charge.studentId)
    )
    .forEach((charge) => {
      const plan = input.resolvePlan(charge.studentId);
      if (!plan || plan.type !== 'monthly') return;

      const chargePeriod = billingPeriodOfDateKey(toDateKey(charge.dueDate));
      if (chargePeriod < currentBillingPeriod) return; // deuda histórica: nunca se toca sin certeza

      const paidAmount = calculatePaidAmountForCharge(charge.id, input.state.allocations, input.state.payments);
      if (paidAmount > 0) {
        needsReview.push({ studentId: charge.studentId, chargeId: charge.id });
        return;
      }

      actions.push({ studentId: charge.studentId, voidedChargeId: charge.id });
      updatedCharges = voidCharge(updatedCharges, charge.id, reason, input.voidedAt);
    });

  return { actions, needsReview, updatedCharges };
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
// CIRCUITO DE COBROS): reparación general, automática e idempotente para
// mensualidades YA CREADAS para un período en el que el alumno, según su
// estado y fecha efectiva de baja ACTUALES, nunca debió facturarse.
// ---------------------------------------------------------------------------

export interface InactiveStudentIneligibleChargeRepairAction {
  studentId: string;
  billingPeriod: string;
  voidedChargeId: string;
}

export interface InactiveStudentIneligibleChargeRepairPlan {
  actions: InactiveStudentIneligibleChargeRepairAction[];
  /** Cargos detectados en un período no facturable por inactividad que YA tienen algún pago/asignación real — nunca se anulan solos, requieren revisión manual. Aunque queden sin reparar, el alumno inactivo de todas formas nunca aparece en las superficies operativas de cobro (esa protección es de LECTURA, no depende de esta reparación). */
  needsReview: Array<{ studentId: string; chargeId: string; billingPeriod: string }>;
  updatedCharges: PaymentCharge[];
}

/**
 * Identifica mensualidades (`type: 'mensual'`) activas (no anuladas) cuyo
 * `billingPeriod` es POSTERIOR al período de la baja del alumno —
 * reutilizando exactamente `isStudentBillableForPeriod`
 * (`monthlyChargeGenerationPlan.ts`, la misma fuente que ya usa la
 * generación mensual, nunca una segunda interpretación de la regla— y
 * anula automáticamente sólo las que no tienen ningún pago/asignación real.
 *
 * Sólo actúa cuando la relación alumno-cargo Y la fecha efectiva de baja
 * están demostradas:
 *   - un alumno `'activo'` nunca se toca (siempre facturable).
 *   - sin `statusChangeDate` conocido (dato legado, de antes de que este
 *     campo existiera) nunca se actúa sin esa fecha — no hay forma de
 *     demostrar con certeza que el cargo corresponde a un período
 *     ineligible, así que se deja intacto como deuda histórica.
 *   - un cargo del propio período de la baja, o de cualquier período
 *     anterior, nunca se toca: es deuda legítima (la baja pudo ocurrir a
 *     mitad de ese período) y se conserva íntegra en el historial.
 *
 * Un cargo con algún pago/asignación real ya registrado NUNCA se anula
 * solo (se reporta en `needsReview`, requiere revisión manual) — nunca se
 * le quita un pago real a un alumno para "corregir" un cargo, nunca se
 * modifica `Payment`/`PaymentAllocation`. Idempotente — los cargos ya
 * anulados quedan fuera por `voidedAt === null`, así que correrla de nuevo
 * sobre el resultado no encuentra más cargos que reparar. Pura — no muta
 * `state`.
 */
export function planInactiveStudentIneligibleChargeRepair(input: {
  state: PaymentsRepositoryState;
  students: Array<{ id: string; status: StudentStatus; statusChangeDate: string | null }>;
  voidedAt: string;
  reason?: string;
}): InactiveStudentIneligibleChargeRepairPlan {
  const reason =
    input.reason?.trim() ||
    'Mensualidad generada para un período no facturable por inactividad del alumno (reconciliación automática)';
  const studentById = new Map(input.students.map((student) => [student.id, student]));

  const actions: InactiveStudentIneligibleChargeRepairAction[] = [];
  const needsReview: InactiveStudentIneligibleChargeRepairPlan['needsReview'] = [];
  let updatedCharges = input.state.charges;

  input.state.charges
    .filter((charge) => charge.type === 'mensual' && charge.voidedAt === null && !!charge.billingPeriod)
    .forEach((charge) => {
      const student = studentById.get(charge.studentId);
      if (!student) return; // sin datos del alumno: nunca se asume nada
      if (student.status === 'activo') return; // siempre facturable, nunca se repara
      if (!student.statusChangeDate) return; // fecha efectiva no demostrada: nunca se actúa sin certeza

      const billable = isStudentBillableForPeriod({
        status: student.status,
        statusChangeDate: student.statusChangeDate,
        billingPeriod: charge.billingPeriod as string,
      });
      if (billable) return; // período de la baja o anterior: deuda legítima, nunca se toca

      const paidAmount = calculatePaidAmountForCharge(charge.id, input.state.allocations, input.state.payments);
      if (paidAmount > 0) {
        needsReview.push({
          studentId: charge.studentId,
          chargeId: charge.id,
          billingPeriod: charge.billingPeriod as string,
        });
        return;
      }

      actions.push({
        studentId: charge.studentId,
        billingPeriod: charge.billingPeriod as string,
        voidedChargeId: charge.id,
      });
      updatedCharges = voidCharge(updatedCharges, charge.id, reason, input.voidedAt);
    });

  return { actions, needsReview, updatedCharges };
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO REAL: recargo
// desactivado que seguía apareciendo como deuda): reparación general,
// automática e idempotente para cargos con un recargo "pendiente persistido"
// mientras la política de recargos está desactivada.
//
// CAUSA RAÍZ real (evidencia de código, no de un dato puntual): el recargo
// NUNCA se persiste — `PaymentCharge.originalAmount` es siempre el importe
// base (ver el comentario del propio tipo) y `calculateChargeState` ya
// calcula `surchargeAmount: 0` en el instante en que se le pasa la
// configuración REAL vigente con `enabled: false` (`calculateSurchargeAmount`,
// paymentDueStage.ts). El bug real estaba en que numerosos consumidores
// (`allocatePayment`, `RegisterPaymentSheet`, `ClassPaymentPromptModal`,
// Analíticas financieras del Dashboard, esta misma reconciliación y la
// detección de "recargo inicial pagado") nunca recibían esa configuración
// real y caían en el default (`enabled: true`, 10/15/20%) — YA CORREGIDO en
// cada uno de esos sitios en esta misma ronda.
//
// Con eso corregido, el saldo de HOY ya es correcto en todas las pantallas
// sin tocar ningún dato — pero una obligación pagada exactamente en su
// importe base, en una fecha en la que (bajo la configuración que regía
// ENTONCES) el recargo todavía no se había completado, queda técnicamente
// "abierta" (`settledAt: null`) para siempre: si la profesora vuelve a
// activar los recargos más adelante, esa obligación resucitaría el mismo
// recargo fantasma, porque nada dejó constancia de que esa obligación
// puntual quedó resuelta. Esta reparación cierra ese caso EXACTO de forma
// permanente, reutilizando la MISMA condonación manual ya existente
// (`PaymentAdjustment`/`buildAdjustment`/`isSurchargeWaivedForCharge` — nunca
// una segunda fórmula): una vez condonada, `determineSettledDate` la trata
// como saldada con el importe base exclusivamente, para siempre, sin
// importar qué pase después con la configuración de recargos.
//
// Alcance exacto (todas las condiciones a la vez, para CUALQUIER tipo de
// cargo — clase suelta, mensualidad, semanal, quincenal o paquete):
//   - la política de recargos está REALMENTE desactivada hoy (se resuelve
//     con la MISMA función real que usa el motor, `resolveEffectiveSurchargeTierValues`,
//     nunca con un valor asumido);
//   - el cargo está vigente (no anulado) y todavía no tiene una condonación
//     activa (nunca duplica una condonación ya existente);
//   - el cargo todavía figura como NO saldado (`settledAt === null`) — una
//     obligación ya saldada es historia cerrada, nunca se retoca;
//   - lo efectivamente pagado ya cubre el importe base completo
//     (`paidAmount >= originalAmount`) — nunca se condona ni un peso de
//     deuda de CAPITAL real, sólo la porción que sólo podía existir por el
//     recargo.
// Nunca toca `originalAmount`, `Payment` ni `PaymentAllocation` — sólo
// agrega condonaciones nuevas. Idempotente: una vez condonado, el cargo dej
// a de aparecer en una segunda pasada (`isSurchargeWaivedForCharge` ya lo
// excluye). Pura — no muta `state`.
// ---------------------------------------------------------------------------

export const SURCHARGE_WAIVER_REPAIR_REASON =
  'Recargo condonado automáticamente: política de recargos desactivada e importe base ya cubierto';

export interface SurchargeWaiverRepairAction {
  studentId: string;
  chargeId: string;
  chargeType: PaymentChargeType;
}

export interface SurchargeWaiverRepairPlan {
  actions: SurchargeWaiverRepairAction[];
  updatedAdjustments: PaymentAdjustment[];
}

export function planSurchargeWaiverRepairForDisabledPolicy(input: {
  state: PaymentsRepositoryState;
  evaluationDate: string;
  surchargeSettings: SurchargeSettings;
  createdAt: string;
  reason?: string;
}): SurchargeWaiverRepairPlan {
  const { state, evaluationDate, surchargeSettings, createdAt } = input;
  const reason = input.reason?.trim() || SURCHARGE_WAIVER_REPAIR_REASON;

  // Nunca actúa "como si" estuviera desactivado: resuelve la configuración
  // REAL vigente para el período de evaluación, la misma que usaría
  // cualquier pantalla real en este instante.
  const tierValuesToday = resolveEffectiveSurchargeTierValues(surchargeSettings, billingPeriodOfDateKey(evaluationDate));
  if (tierValuesToday.enabled) {
    return { actions: [], updatedAdjustments: state.adjustments };
  }

  const actions: SurchargeWaiverRepairAction[] = [];
  let nextAdjustments = state.adjustments;

  state.charges
    .filter((charge) => charge.voidedAt === null)
    .forEach((charge, index) => {
      if (isSurchargeWaivedForCharge(charge.id, nextAdjustments)) return;

      const chargeState = calculateChargeState({
        charge,
        allocations: state.allocations,
        payments: state.payments,
        adjustments: nextAdjustments,
        evaluationDate,
        surchargeSettings,
      });
      if (chargeState.settledAt !== null) return; // ya saldada: historia cerrada, nunca se retoca.
      if (chargeState.paidAmount < charge.originalAmount) return; // deuda de capital real: nunca se condona.

      actions.push({ studentId: charge.studentId, chargeId: charge.id, chargeType: charge.type });
      nextAdjustments = [
        ...nextAdjustments,
        buildAdjustment({
          id: `surcharge_waiver_repair_${charge.id}_${index}`,
          chargeId: charge.id,
          studentId: charge.studentId,
          reason,
          createdAt,
        }),
      ];
    });

  return { actions, updatedAdjustments: nextAdjustments };
}

// ---------------------------------------------------------------------------
// Reparación 2026-09-01 (a pedido de Joaquín — ERROR FINANCIERO REAL, segunda
// causa encontrada tras validación física: NO es un recargo persistido sobre
// un cargo — es un PAGO REAL ya existente cuya asignación interna quedó
// repartida mal entre DOS cargos hermanos del MISMO alumno).
//
// Mecanismo real confirmado con el motor real (`planPaymentRegistration`),
// no con fixtures inventados: cuando un pago general se distribuye entre las
// obligaciones vigentes de un alumno (la más antigua primero) sin la
// configuración de recargos real (`surchargeSettings: undefined`, el
// comportamiento previo a esta fase), la capacidad segura de un cargo YA
// CUBIERTO en su importe base se calculaba de más — hasta un 10/15/20%
// "fantasma" — permitiendo que UNA PORCIÓN de un pago posterior, destinada
// en los hechos a otro cargo del mismo alumno, quedara asignada al cargo
// equivocado. El cargo que "recibió de más" queda con saldo a favor
// (`balance < 0`, saldado con crédito); el cargo que debía recibir esa
// porción queda con un faltante de capital real idéntico. Con la
// configuración real ya vigente (ver `planSurchargeWaiverRepairForDisabledPolicy`
// más arriba), este defecto de origen quedó CERRADO para pagos nuevos — mismo
// motor, probado exhaustivamente con `surchargeSettings` real, nunca vuelve a
// ocurrir — pero un pago histórico ya persistido con esa asignación mal
// dirigida no se autocorrige solo.
//
// Alcance EXACTO, deliberadamente estrecho (a pedido explícito de Joaquín —
// nunca redistribuir créditos ambiguos ni cruzar alumnos):
//   - Sólo actúa sobre un PAGO PUNTUAL con EXACTAMENTE 2 asignaciones
//     vigentes (nunca 1, nunca 3+: cualquier otro caso es ambiguo y se
//     ignora por completo).
//   - Las 2 asignaciones deben apuntar a 2 cargos DISTINTOS, ambos vigentes
//     (no anulados) y ambos del MISMO alumno que el pago (nunca se cruza a
//     otro alumno — estructuralmente imposible salvo dato ya corrupto, que
//     tampoco se toca).
//   - Uno de los dos cargos, evaluado HOY con la configuración REAL de
//     recargos, debe mostrar saldo A FAVOR (`balance < 0`, "acreedor"); el
//     otro debe mostrar capital REAL pendiente (`balance > 0`, "deudor").
//   - El monto a mover nunca excede ni el crédito disponible, ni la deuda
//     real del otro cargo, ni lo que esa asignación puntual aportó.
//   - Verificación de origen EXACTA: el monto a mover debe coincidir, al
//     peso, con el recargo que se habría calculado sobre el cargo acreedor,
//     en la etapa real de la fecha de ese pago, usando la configuración
//     `current` (la que regía antes de la desactivación real) — si no
//     coincide exactamente, nunca se toca (no se adivina, no se aproxima).
//   - La política de recargos debe estar REALMENTE desactivada hoy (mismo
//     criterio que la reparación de arriba) — nunca actúa mientras siguen
//     activados.
// Nunca toca `Payment` (mismo id, importe, método, fecha) ni crea/elimina
// pagos — sólo corrige el importe de las DOS asignaciones ya existentes de
// ESE pago (nunca su `paymentId` ni su fecha), preservando la suma total
// exacta que ese pago ya tenía asignada. Verificado antes de persistir: si
// la recomputación posterior no cierra en cero el crédito sin generar deuda
// nueva, o si la suma del pago no se preserva exactamente, esa acción
// puntual se descarta sin tocar nada (nunca se persiste un estado dudoso).
// Idempotente: una vez corregido, el cargo acreedor deja de tener saldo a
// favor, así que una segunda pasada no vuelve a encontrar nada que mover.
// ---------------------------------------------------------------------------

export const PHANTOM_SURCHARGE_ALLOCATION_REPAIR_REASON =
  'Corrección automática: asignación de un pago real redirigida al cargo correcto del mismo alumno (recargo fantasma histórico)';

export interface PhantomSurchargeAllocationRepairAction {
  studentId: string;
  paymentId: string;
  fromChargeId: string;
  toChargeId: string;
  amount: number;
}

export interface PhantomSurchargeAllocationRepairPlan {
  actions: PhantomSurchargeAllocationRepairAction[];
  updatedAllocations: PaymentAllocation[];
}

export function planPhantomSurchargeAllocationRepair(input: {
  state: PaymentsRepositoryState;
  evaluationDate: string;
  surchargeSettings: SurchargeSettings;
}): PhantomSurchargeAllocationRepairPlan {
  const { state, evaluationDate, surchargeSettings } = input;

  const tierValuesToday = resolveEffectiveSurchargeTierValues(surchargeSettings, billingPeriodOfDateKey(evaluationDate));
  if (tierValuesToday.enabled) {
    return { actions: [], updatedAllocations: state.allocations };
  }

  const chargesById = new Map(state.charges.map((charge) => [charge.id, charge]));
  const actions: PhantomSurchargeAllocationRepairAction[] = [];
  let nextAllocations = state.allocations;

  function chargeStateOf(charge: PaymentCharge, allocations: PaymentAllocation[]) {
    return calculateChargeState({
      charge,
      allocations,
      payments: state.payments,
      adjustments: state.adjustments,
      evaluationDate,
      surchargeSettings,
    });
  }

  state.payments
    .filter((payment) => payment.voidedAt === null)
    .forEach((payment: Payment) => {
      const beforeThisPayment = nextAllocations;
      const allocationsOfPayment = beforeThisPayment.filter((allocation) => allocation.paymentId === payment.id);
      if (allocationsOfPayment.length !== 2) return; // ambiguo (0/1/3+): nunca se toca.

      const [allocOne, allocTwo] = allocationsOfPayment;
      if (allocOne.chargeId === allocTwo.chargeId) return;

      const chargeOne = chargesById.get(allocOne.chargeId);
      const chargeTwo = chargesById.get(allocTwo.chargeId);
      if (!chargeOne || !chargeTwo) return;
      if (chargeOne.voidedAt !== null || chargeTwo.voidedAt !== null) return;
      // Nunca cruzar alumnos: los dos cargos y el pago deben ser del mismo alumno.
      if (chargeOne.studentId !== payment.studentId || chargeTwo.studentId !== payment.studentId) return;

      const stateOne = chargeStateOf(chargeOne, beforeThisPayment);
      const stateTwo = chargeStateOf(chargeTwo, beforeThisPayment);

      let creditorAlloc: PaymentAllocation;
      let debtorAlloc: PaymentAllocation;
      let creditorCharge: PaymentCharge;
      let debtorCharge: PaymentCharge;
      let creditorBalance: number;
      let debtorBalance: number;
      if (stateOne.balance < 0 && stateTwo.balance > 0) {
        creditorAlloc = allocOne;
        debtorAlloc = allocTwo;
        creditorCharge = chargeOne;
        debtorCharge = chargeTwo;
        creditorBalance = stateOne.balance;
        debtorBalance = stateTwo.balance;
      } else if (stateTwo.balance < 0 && stateOne.balance > 0) {
        creditorAlloc = allocTwo;
        debtorAlloc = allocOne;
        creditorCharge = chargeTwo;
        debtorCharge = chargeOne;
        creditorBalance = stateTwo.balance;
        debtorBalance = stateOne.balance;
      } else {
        return; // no es un par crédito/débito limpio: nunca ambiguo.
      }

      const creditAmount = -creditorBalance;
      const moveAmount = Math.min(creditAmount, debtorBalance, creditorAlloc.amount);
      if (moveAmount <= 0) return;

      // Verificación de origen EXACTA: debe coincidir centavo a centavo con
      // el recargo "fantasma" que se habría calculado sobre el cargo
      // acreedor, en su etapa real a la fecha de ESTE pago, usando la
      // configuración vigente ANTES de la desactivación real (`current`) —
      // nunca se mueve dinero por una coincidencia aproximada.
      const stageUnderPreviousPolicy = determineDueStage(creditorCharge.type, creditorCharge.dueDate, payment.paidAt, surchargeSettings.current);
      const phantomSurcharge = calculateSurchargeAmount(creditorCharge.originalAmount, stageUnderPreviousPolicy, surchargeSettings.current);
      if (phantomSurcharge !== moveAmount) return;

      const newCreditorAmount = creditorAlloc.amount - moveAmount;
      const newDebtorAmount = debtorAlloc.amount + moveAmount;

      const candidateAllocations = beforeThisPayment
        .filter((allocation) => !(allocation.id === creditorAlloc.id && newCreditorAmount <= 0))
        .map((allocation) => {
          if (allocation.id === creditorAlloc.id && newCreditorAmount > 0) {
            return { ...allocation, amount: newCreditorAmount };
          }
          if (allocation.id === debtorAlloc.id) {
            return { ...allocation, amount: newDebtorAmount };
          }
          return allocation;
        });

      // Verificación antes de persistir: la suma asignada por ESTE pago debe
      // preservarse exacta, y el cargo acreedor debe quedar sin crédito
      // (saldo >= 0) sin generar deuda nueva en el deudor. Si algo no cierra,
      // se descarta esta acción puntual — nunca se persiste un estado dudoso.
      const totalBefore = allocationsOfPayment.reduce((sum, allocation) => sum + allocation.amount, 0);
      const totalAfter = candidateAllocations
        .filter((allocation) => allocation.paymentId === payment.id)
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      const verifyCreditor = chargeStateOf(creditorCharge, candidateAllocations);
      const verifyDebtor = chargeStateOf(debtorCharge, candidateAllocations);
      if (totalAfter !== totalBefore || verifyCreditor.balance < 0 || verifyDebtor.balance < debtorBalance - moveAmount) {
        return; // no cierra exacto: no se toca nada de este pago.
      }

      actions.push({
        studentId: payment.studentId,
        paymentId: payment.id,
        fromChargeId: creditorCharge.id,
        toChargeId: debtorCharge.id,
        amount: moveAmount,
      });
      nextAllocations = candidateAllocations;
    });

  return { actions, updatedAllocations: nextAllocations };
}

// ---------------------------------------------------------------------------
// Reparación 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidad
// generada con vencimiento el día 1 en vez del día real configurado por la
// profesora), REEMPLAZADA por completo el 2026-09-05 (VALIDACIÓN FÍSICA
// FALLIDA — VENCIMIENTOS INCONSISTENTES, regla definitiva confirmada por la
// profesora): la versión anterior sólo tocaba un cargo cuyo `dueDate`
// coincidía EXACTO con el día 1 del propio período ("huella" de la regla
// vieja), preservando cualquier otro vencimiento distinto del día 10 como si
// fuera manual/legítimo — esa preservación es la causa real de la
// inconsistencia observada el 05/09/2026 (un alumno mostraba "Vence hoy"
// antes de que ningún mensual de septiembre debiera vencer).
//
// Regla nueva: **no existen vencimientos mensuales distintos por alumno**.
// El vencimiento correcto de CUALQUIER cargo `'mensual'` es siempre
// `resolveMonthlyDueDate(billingPeriod, DEFAULT_MONTHLY_DUE_DAY)` — nunca el
// `dueDay` del plan del alumno (que en `studentBillingPlan.ts` ya se
// normaliza aparte a esa misma constante; acá no hace falta leerlo, la
// política es global). Se corrige cualquier cargo mensual "abierto" (no
// anulado, no saldado por completo) cuyo `dueDate` no coincida con ese único
// valor correcto — sin importar de qué regla vieja provenga (día 1, día 5,
// día 15, cualquiera).
//
// Excepciones reales, todas necesarias:
//   - Cargo anulado (`voidedAt !== null`): nunca se reabre ni se toca.
//   - Cargo que no es `'mensual'` (clase suelta/paquete/semanal/quincenal):
//     nunca se toca — esta reparación es exclusiva de mensualidades.
//   - Cargo YA SALDADO POR COMPLETO (`paidAmount >= originalAmount`, sin
//     importar el período): reescribirle el vencimiento no cambia nada
//     financiero real y alteraría sin necesidad un registro de un período ya
//     cerrado — se preserva tal cual, típicamente deuda histórica de meses
//     anteriores que la profesora ya cobró.
// Nunca cambia `originalAmount`, nunca toca pagos/asignaciones/ajustes,
// nunca duplica nada (sólo corrige `dueDate` en el mismo cargo, mismo id).
// Idempotente: una vez corregido, `charge.dueDate` ya coincide con el único
// valor correcto, así que una segunda pasada no vuelve a tocarlo. Pura — no
// muta `state`.
// ---------------------------------------------------------------------------

export interface MonthlyDueDateRepairAction {
  studentId: string;
  chargeId: string;
  billingPeriod: string;
  previousDueDate: string;
  newDueDate: string;
}

/**
 * Corrección 2026-10-04: un vencimiento que NO se toca (queda byte-idéntico) y
 * deja evidencia para revisión manual — sólo ids y fechas, nunca nombres.
 */
export interface MonthlyDueDateReviewItem {
  studentId: string;
  chargeId: string;
  billingPeriod: string;
  currentDueDate: string;
  /** Fecha que habría resultado de aplicar la regla (global, o max(incorporación, global) si hay decisión guardada). */
  ruleDueDate: string;
  /**
   * Por qué NO se corrige:
   *  - `'sin_decision'`: no hay fecha de incorporación confiable (decisión guardada) que justifique cambiarlo;
   *  - `'con_pagos'`: tiene algún pago o asignación (aunque sea parcial) — nunca se reescribe;
   *  - `'no_es_primer_periodo'`: hay una decisión, pero el alumno ya tiene una mensualidad de un período anterior;
   *  - `'con_decision'`: hay decisión, pero la regla daría una fecha ANTERIOR a la actual (nunca hacia atrás).
   */
  reason: 'sin_decision' | 'con_pagos' | 'no_es_primer_periodo' | 'con_decision';
}

export interface MonthlyDueDateRepairPlan {
  actions: MonthlyDueDateRepairAction[];
  updatedCharges: PaymentCharge[];
  /** Vencimientos conservados a propósito (nunca hacia atrás) — ver `MonthlyDueDateReviewItem`. */
  reviewNeeded: MonthlyDueDateReviewItem[];
}

export function planMonthlyDueDateRepair(input: {
  state: PaymentsRepositoryState;
  /**
   * Conservado por compatibilidad de firma (algunos llamadores/pruebas ya lo
   * pasan) — ya NO decide el vencimiento correcto, que ahora es siempre
   * `DEFAULT_MONTHLY_DUE_DAY` para cualquier alumno (política global, nunca
   * una preferencia por alumno).
   */
  resolvePlan?: (studentId: string) => StudentBillingPlan | null;
  /**
   * Corrección 2026-10-04 (a pedido de Joaquín — primer mes proporcional):
   * fecha efectiva de incorporación por `chargeId` de cada cargo de PRIMER
   * período (sale de `FirstMonthProrationDecision`). Un cargo que está acá no
   * vence el día 10 a secas sino en `resolveFirstPeriodDueDate` =
   * max(incorporación, vencimiento global ajustado) — sin esto, esta
   * reparación (que corre en cada arranque) pisaba el vencimiento de una
   * incorporación posterior al día 10 dejándolo ANTES de la primera clase.
   * Sin esta fecha (cargo ausente del mapa) el vencimiento NO se toca: queda
   * byte-idéntico y se registra en `reviewNeeded`. Un cargo con CUALQUIER
   * pago/asignación (ni siquiera uno parcial) tampoco se toca nunca.
   */
  firstPeriodJoinDateByChargeId?: ReadonlyMap<string, string>;
}): MonthlyDueDateRepairPlan {
  const { state } = input;
  const actions: MonthlyDueDateRepairAction[] = [];
  const reviewNeeded: MonthlyDueDateReviewItem[] = [];

  const updatedCharges = state.charges.map((charge) => {
    if (charge.type !== 'mensual') return charge; // nunca clases sueltas ni otros tipos.
    if (charge.voidedAt !== null) return charge; // nunca reabre un cargo anulado.
    if (!charge.billingPeriod) return charge;

    const joinDate = input.firstPeriodJoinDateByChargeId?.get(charge.id);
    // Fecha que daría la regla — sólo como referencia para la evidencia cuando NO se corrige.
    const ruleDueDate =
      joinDate !== undefined
        ? resolveFirstPeriodDueDate(charge.billingPeriod, joinDate)
        : resolveMonthlyDueDate(charge.billingPeriod, DEFAULT_MONTHLY_DUE_DAY);
    if (ruleDueDate === charge.dueDate) return charge; // ya correcto: nada que reparar.

    // Un cargo ya saldado por completo (de cualquier período) nunca se
    // reescribe — no cambia nada financiero real, y tocaría sin necesidad un
    // registro ya cerrado (típicamente deuda histórica ya cobrada).
    const paidAmount = calculatePaidAmountForCharge(charge.id, state.allocations, state.payments);
    if (paidAmount >= charge.originalAmount) return charge;

    const review = (reason: MonthlyDueDateReviewItem['reason']) => {
      reviewNeeded.push({
        studentId: charge.studentId,
        chargeId: charge.id,
        billingPeriod: charge.billingPeriod as string,
        currentDueDate: charge.dueDate,
        ruleDueDate,
        reason,
      });
      return charge;
    };

    // Corrección 2026-10-04 (a pedido de Joaquín — guardas finales). El vencimiento SÓLO se corrige cuando se cumplen
    // las tres condiciones a la vez: (1) la fecha de incorporación es conocida y confiable (decisión de primer mes
    // guardada), (2) es el primer período del alumno, (3) no existe ningún pago ni asignación. En cualquier otro caso
    // el cargo queda byte-idéntico y se deja evidencia: nunca se inventa una fecha ni se retrocede un vencimiento.
    if (state.allocations.some((allocation) => allocation.chargeId === charge.id)) return review('con_pagos');
    if (joinDate === undefined) return review('sin_decision');
    const hasEarlierMonthlyCharge = state.charges.some(
      (other) =>
        other.id !== charge.id &&
        other.studentId === charge.studentId &&
        other.type === 'mensual' &&
        other.voidedAt === null &&
        !!other.billingPeriod &&
        other.billingPeriod < (charge.billingPeriod as string)
    );
    if (hasEarlierMonthlyCharge) return review('no_es_primer_periodo');
    if (ruleDueDate < charge.dueDate) return review('con_decision');

    actions.push({
      studentId: charge.studentId,
      chargeId: charge.id,
      billingPeriod: charge.billingPeriod,
      previousDueDate: charge.dueDate,
      newDueDate: ruleDueDate,
    });
    return { ...charge, dueDate: ruleDueDate };
  });

  return { actions, updatedCharges, reviewNeeded };
}
