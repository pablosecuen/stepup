// Puerto VERBATIM del original (`src/features/payments/services/financialReconciliationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { FirstMonthProrationDecision, MonthlyAmountCorrectionEntry, PaymentsRepositoryState } from '../types/index.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { analyzeFinancialConsistency, planDuplicateMonthlyChargeRepair, planIncompatiblePerClassChargeRepair, planInactiveStudentIneligibleChargeRepair, planMonthlyAmountReconciliationRepair, planMonthlyDueDateRepair, planPhantomSurchargeAllocationRepair, planSurchargeWaiverRepairForDisabledPolicy, type DuplicateMonthlyChargeRepairPlan, type FinancialConsistencyReport, type IncompatiblePerClassChargeRepairPlan, type InactiveStudentIneligibleChargeRepairPlan, type MonthlyAmountReconciliationPlan, type MonthlyDueDateRepairPlan, type MonthlyDueDateReviewItem, type PhantomSurchargeAllocationRepairPlan, type SurchargeWaiverRepairPlan } from '../utils/financialReconciliation.ts';
import { applyPaymentsMutation, getPaymentsSnapshot, hydratePaymentsStore } from '../hooks/paymentsStore.ts';
import { getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore } from '../hooks/surchargeSettingsStore.ts';
import { DEFAULT_SURCHARGE_SETTINGS, type SurchargeSettings } from '../utils/surchargeSettings.ts';
import { loadFirstMonthProrationDecisionLog } from '../hooks/firstMonthProrationDecisionStore.ts';
import { buildFirstPeriodJoinDateByChargeId } from '../utils/firstPeriodDueDate.ts';
import { formatDateKeyDMY } from '../utils/paymentFormat.ts';
import { appendMonthlyAmountCorrectionEntry, loadMonthlyAmountCorrectionLog } from '../hooks/monthlyAmountCorrectionLogStore.ts';
import { getStudentsStore } from '../../students/hooks/studentStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';
import type { StudentBillingPlan } from '../../student-profile/types/index.ts';

function resolvePlanForAnyStudent(studentId: string): StudentBillingPlan | null {
  const profile = getStudentProfile(studentId);
  return profile ? resolveStudentBillingPlan(profile) : null;
}

/**
 * Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO: recargo
 * desactivado que seguía apareciendo como deuda): deps OPCIONALES para leer
 * la configuración de recargos VIGENTE — un llamador real (por defecto) usa
 * el store real; una prueba que no las provee sigue calculando con
 * `surchargeSettings: undefined` (el mismo `DEFAULT_SURCHARGE_SETTINGS` que
 * ya usaban todas las pruebas existentes de este servicio) sin tocar
 * AsyncStorage real.
 */
export interface SurchargeSettingsReadDeps {
  hydrateSurchargeSettings?: () => Promise<SurchargeSettings>;
  getSurchargeSettingsSnapshot?: () => SurchargeSettings;
}

const defaultSurchargeSettingsDeps: SurchargeSettingsReadDeps = {
  hydrateSurchargeSettings: hydrateSurchargeSettingsStore,
  getSurchargeSettingsSnapshot,
};

async function resolveCurrentSurchargeSettings(deps: SurchargeSettingsReadDeps): Promise<SurchargeSettings | undefined> {
  if (deps.hydrateSurchargeSettings) await deps.hydrateSurchargeSettings();
  return deps.getSurchargeSettingsSnapshot?.();
}

/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual, PARTE 8): reporte de sólo lectura sobre TODOS
 * los alumnos actuales — nunca borra, nunca corrige nada por sí solo. Sólo
 * informa cantidades (`countsByCategory`); nunca se debe mostrar a la
 * profesora el detalle interno (`findings`, que sí puede incluir ids) como
 * si fuera texto de pantalla — eso es exclusivamente para depuración.
 */
export async function analyzeFinancialConsistencyNow(
  now: Date = new Date(),
  surchargeSettingsDeps: SurchargeSettingsReadDeps = defaultSurchargeSettingsDeps
): Promise<FinancialConsistencyReport> {
  await hydratePaymentsStore();
  const surchargeSettings = await resolveCurrentSurchargeSettings(surchargeSettingsDeps);
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const students = getStudentsStore().map((student) => ({ id: student.id, status: student.status }));
  const firstMonthProrationDecisions = await loadFirstMonthProrationDecisionLog();
  return analyzeFinancialConsistency({
    state: getPaymentsSnapshot(),
    students,
    resolvePlan: resolvePlanForAnyStudent,
    evaluationDate,
    firstMonthProrationDecisions,
    surchargeSettings,
  });
}

/**
 * Repara automáticamente, en el arranque/vuelta a primer plano de la app,
 * ÚNICAMENTE los duplicados mensuales técnicos sin ambigüedad (ver
 * `planDuplicateMonthlyChargeRepair`) — nunca reparte pagos entre
 * duplicados ambiguos, nunca borra un cargo (los duplicados sobrantes
 * quedan anulados, visibles en el historial). El plan se calcula DENTRO de
 * `applyPaymentsMutation` (mismo criterio anti-condición-de-carrera que el
 * resto de las reparaciones automáticas): correrla dos veces seguidas, o en
 * paralelo, nunca vuelve a anular lo mismo dos veces ni dispara sobre datos
 * ya reparados.
 */
export async function runAutomaticDuplicateMonthlyChargeRepair(
  now: Date = new Date()
): Promise<DuplicateMonthlyChargeRepairPlan> {
  await hydratePaymentsStore();

  let plan: DuplicateMonthlyChargeRepairPlan | null = null;
  await applyPaymentsMutation((current) => {
    plan = planDuplicateMonthlyChargeRepair({ state: current, voidedAt: now.toISOString() });
    if (plan.actions.length === 0) return current;
    return { ...current, charges: plan.updatedCharges };
  });

  return (
    plan ?? {
      actions: [],
      ambiguousGroups: [],
      updatedCharges: getPaymentsSnapshot().charges,
    }
  );
}

/**
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO GENERAL: cuota
 * mensual y obligación desincronizadas): repara automáticamente, en el
 * arranque/vuelta a primer plano de la app Y antes de registrar un pago
 * (ver `registerPaymentService.ts`), los cargos mensuales vigentes del
 * período actual cuyo importe quedó desincronizado del plan (ver
 * `planMonthlyAmountReconciliationRepair`) — nunca inventa saldo a favor,
 * nunca reescribe un período ya saldado. Mismo criterio
 * anti-condición-de-carrera que el resto: el plan se calcula DENTRO de
 * `applyPaymentsMutation`, así que correrla dos veces seguidas, o en
 * paralelo, nunca vuelve a tocar lo mismo dos veces.
 */
export async function runAutomaticMonthlyAmountReconciliationRepair(
  now: Date = new Date(),
  surchargeSettingsDeps: SurchargeSettingsReadDeps = defaultSurchargeSettingsDeps
): Promise<MonthlyAmountReconciliationPlan> {
  await hydratePaymentsStore();
  const surchargeSettings = await resolveCurrentSurchargeSettings(surchargeSettingsDeps);
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const students = getStudentsStore().map((student) => ({ id: student.id, status: student.status }));
  const firstMonthProrationDecisions = await loadFirstMonthProrationDecisionLog();

  let plan: MonthlyAmountReconciliationPlan | null = null;
  await applyPaymentsMutation((current) => {
    plan = planMonthlyAmountReconciliationRepair({
      state: current,
      students,
      resolvePlan: resolvePlanForAnyStudent,
      evaluationDate,
      firstMonthProrationDecisions,
      surchargeSettings,
    });
    if (plan.actions.length === 0) return current;
    return { ...current, charges: plan.updatedCharges };
  });

  return (
    plan ?? {
      actions: [],
      needsReview: [],
      updatedCharges: getPaymentsSnapshot().charges,
    }
  );
}

/**
 * Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
 * contradictorios "Agosto pendiente" + "Pago vencido"): repara
 * automáticamente, en el arranque/vuelta a primer plano de la app,
 * ÚNICAMENTE los cargos `por_clase` del período actual (o uno futuro) que
 * quedaron incompatibles con el plan mensual vigente del alumno Y no
 * tienen ningún pago asignado (ver `planIncompatiblePerClassChargeRepair`)
 * — nunca toca deuda histórica de un período anterior, nunca anula un
 * cargo con pagos reales. Mismo criterio anti-condición-de-carrera que el
 * resto de las reparaciones automáticas: el plan se calcula DENTRO de
 * `applyPaymentsMutation`, así que correrla dos veces seguidas, o en
 * paralelo, nunca vuelve a anular lo mismo dos veces.
 */
export async function runAutomaticIncompatiblePerClassChargeRepair(
  now: Date = new Date()
): Promise<IncompatiblePerClassChargeRepairPlan> {
  await hydratePaymentsStore();
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const students = getStudentsStore().map((student) => ({ id: student.id, status: student.status }));

  let plan: IncompatiblePerClassChargeRepairPlan | null = null;
  await applyPaymentsMutation((current) => {
    plan = planIncompatiblePerClassChargeRepair({
      state: current,
      students,
      resolvePlan: resolvePlanForAnyStudent,
      evaluationDate,
      voidedAt: now.toISOString(),
    });
    if (plan.actions.length === 0) return current;
    return { ...current, charges: plan.updatedCharges };
  });

  return (
    plan ?? {
      actions: [],
      needsReview: [],
      updatedCharges: getPaymentsSnapshot().charges,
    }
  );
}

/**
 * Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
 * CIRCUITO DE COBROS): repara automáticamente, en el arranque/vuelta a
 * primer plano de la app, las mensualidades YA creadas para un período
 * posterior a la baja de un alumno (ver `planInactiveStudentIneligibleChargeRepair`
 * para el criterio EXACTO — nunca toca deuda legítima del período de la
 * baja o anterior, nunca actúa sin una fecha de baja demostrada, nunca anula
 * un cargo con algún pago/asignación real). Misma cola atómica que el resto
 * de las reparaciones automáticas: el plan se calcula DENTRO de
 * `applyPaymentsMutation`, así que correrla dos veces seguidas, o en
 * paralelo, nunca vuelve a anular lo mismo dos veces.
 */
export async function runAutomaticInactiveStudentIneligibleChargeRepair(
  now: Date = new Date()
): Promise<InactiveStudentIneligibleChargeRepairPlan> {
  await hydratePaymentsStore();
  const students = getStudentsStore().map((student) => ({
    id: student.id,
    status: student.status,
    statusChangeDate: getStudentProfile(student.id)?.statusChangeDate ?? null,
  }));

  let plan: InactiveStudentIneligibleChargeRepairPlan | null = null;
  await applyPaymentsMutation((current) => {
    plan = planInactiveStudentIneligibleChargeRepair({ state: current, students, voidedAt: now.toISOString() });
    if (plan.actions.length === 0) return current;
    return { ...current, charges: plan.updatedCharges };
  });

  return (
    plan ?? {
      actions: [],
      needsReview: [],
      updatedCharges: getPaymentsSnapshot().charges,
    }
  );
}

/**
 * Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO REAL: recargo
 * desactivado que seguía apareciendo como deuda): repara automáticamente, en
 * el arranque/vuelta a primer plano de la app, cualquier obligación vigente
 * (de cualquier tipo — clase suelta, mensualidad, semanal, quincenal o
 * paquete) cuyo importe base ya esté completamente cubierto mientras la
 * política de recargos está REALMENTE desactivada hoy — ver
 * `planSurchargeWaiverRepairForDisabledPolicy` para el criterio exacto y por
 * qué nunca toca deuda de capital real. Nunca hace nada si los recargos
 * siguen activados. Misma cola atómica que el resto de las reparaciones
 * automáticas: el plan se calcula DENTRO de `applyPaymentsMutation`, así que
 * correrla dos veces seguidas, o en paralelo, nunca condona el mismo cargo
 * dos veces.
 */
export async function runAutomaticSurchargeWaiverRepair(
  now: Date = new Date(),
  surchargeSettingsDeps: SurchargeSettingsReadDeps = defaultSurchargeSettingsDeps
): Promise<SurchargeWaiverRepairPlan> {
  await hydratePaymentsStore();
  const surchargeSettings = await resolveCurrentSurchargeSettings(surchargeSettingsDeps);
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);

  let plan: SurchargeWaiverRepairPlan | null = null;
  await applyPaymentsMutation((current) => {
    plan = planSurchargeWaiverRepairForDisabledPolicy({
      state: current,
      evaluationDate,
      surchargeSettings: surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
      createdAt: now.toISOString(),
    });
    if (plan.actions.length === 0) return current;
    return { ...current, adjustments: plan.updatedAdjustments };
  });

  return plan ?? { actions: [], updatedAdjustments: getPaymentsSnapshot().adjustments };
}

/**
 * Corrección 2026-09-01 (a pedido de Joaquín — ERROR FINANCIERO REAL,
 * segunda causa encontrada tras validación física con datos reales): repara
 * automáticamente, en el arranque/vuelta a primer plano de la app,
 * asignaciones históricas de un pago real que quedaron repartidas mal entre
 * dos cargos hermanos del mismo alumno por un recargo fantasma —
 * ver `planPhantomSurchargeAllocationRepair` para el criterio EXACTO y
 * deliberadamente estrecho (nunca ambiguo, nunca cruza alumnos, nunca toca
 * `Payment`). Nunca hace nada si los recargos siguen activados. Misma cola
 * atómica que el resto: el plan se calcula DENTRO de `applyPaymentsMutation`,
 * así que correrla dos veces seguidas, o en paralelo, nunca vuelve a mover
 * el mismo dinero dos veces.
 */
export async function runAutomaticPhantomSurchargeAllocationRepair(
  now: Date = new Date(),
  surchargeSettingsDeps: SurchargeSettingsReadDeps = defaultSurchargeSettingsDeps
): Promise<PhantomSurchargeAllocationRepairPlan> {
  await hydratePaymentsStore();
  const surchargeSettings = await resolveCurrentSurchargeSettings(surchargeSettingsDeps);
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);

  let plan: PhantomSurchargeAllocationRepairPlan | null = null;
  await applyPaymentsMutation((current) => {
    plan = planPhantomSurchargeAllocationRepair({
      state: current,
      evaluationDate,
      surchargeSettings: surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
    });
    if (plan.actions.length === 0) return current;
    return { ...current, allocations: plan.updatedAllocations };
  });

  return plan ?? { actions: [], updatedAllocations: getPaymentsSnapshot().allocations };
}

/**
 * Corrección 2026-10-04: dependencias inyectables de `runAutomaticMonthlyDueDateRepair` — mismo patrón que el resto de
 * los servicios, para probar el arranque completo con un store en memoria (sin AsyncStorage real).
 */
export interface MonthlyDueDateRepairDeps {
  hydrate?: () => Promise<unknown>;
  applyMutation?: (updater: (current: PaymentsRepositoryState) => PaymentsRepositoryState) => Promise<unknown>;
  getSnapshot?: () => PaymentsRepositoryState;
  loadDecisions?: () => Promise<FirstMonthProrationDecision[]>;
  loadAuditLog?: () => Promise<MonthlyAmountCorrectionEntry[]>;
  appendAuditEntry?: (entry: MonthlyAmountCorrectionEntry) => Promise<void>;
  now?: Date;
}

const MONTHLY_REVIEW_REASON_TEXT: Record<MonthlyDueDateReviewItem['reason'], string> = {
  sin_decision: 'porque no hay una fecha de incorporación confiable guardada',
  con_pagos: 'porque el cargo tiene pagos o asignaciones',
  no_es_primer_periodo: 'porque el alumno ya tiene una mensualidad de un período anterior',
  con_decision: 'porque llevarlo a esa fecha sería moverlo hacia atrás',
};

/**
 * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidad
 * generada con vencimiento el día 1 en vez del día real configurado): repara
 * automáticamente, en el arranque/vuelta a primer plano de la app,
 * mensualidades YA creadas con la regla vieja (`firstDayOfBillingPeriod`) —
 * ver `planMonthlyDueDateRepair` para el criterio EXACTO (nunca toca un
 * vencimiento distinto del día 1 del propio período, nunca asume que
 * cualquier fecha distinta del día 10 es un error, nunca cargos anulados ni
 * no mensuales). Nunca cambia `originalAmount`/pagos/asignaciones/ajustes —
 * sólo `dueDate`. Misma cola atómica que el resto de las reparaciones
 * automáticas: el plan se calcula DENTRO de `applyPaymentsMutation`, así que
 * correrla dos veces seguidas, o en paralelo, nunca vuelve a tocar el mismo
 * cargo dos veces.
 */
export async function runAutomaticMonthlyDueDateRepair(deps: MonthlyDueDateRepairDeps = {}): Promise<MonthlyDueDateRepairPlan> {
  const hydrate = deps.hydrate ?? hydratePaymentsStore;
  const applyMutation = deps.applyMutation ?? applyPaymentsMutation;
  const getSnapshot = deps.getSnapshot ?? getPaymentsSnapshot;
  const loadDecisions = deps.loadDecisions ?? loadFirstMonthProrationDecisionLog;
  const loadAuditLog = deps.loadAuditLog ?? loadMonthlyAmountCorrectionLog;
  const appendAuditEntry = deps.appendAuditEntry ?? appendMonthlyAmountCorrectionEntry;
  const now = deps.now ?? new Date();

  await hydrate();
  // Corrección 2026-10-04: un cargo de PRIMER mes proporcional vence en max(incorporación, vencimiento global), no el
  // día 10 a secas — se lee la fecha de incorporación de la decisión ya persistida (nunca se recalcula ni se inventa).
  const firstPeriodJoinDateByChargeId = buildFirstPeriodJoinDateByChargeId(await loadDecisions());

  let plan: MonthlyDueDateRepairPlan | null = null;
  await applyMutation((current) => {
    plan = planMonthlyDueDateRepair({
      state: current,
      resolvePlan: resolvePlanForAnyStudent,
      firstPeriodJoinDateByChargeId,
    });
    if (plan.actions.length === 0) return current;
    return { ...current, charges: plan.updatedCharges };
  });

  const finalPlan: MonthlyDueDateRepairPlan = plan ?? { actions: [], updatedCharges: getSnapshot().charges, reviewNeeded: [] };

  // Evidencia segura (sólo ids, importes y fechas — nunca nombres), en el registro de auditoría ya existente y ya
  // incluido en el respaldo. Best-effort: perder una entrada no deshace una corrección financiera ya persistida.
  try {
    const knownIds = new Set((await loadAuditLog()).map((entry) => entry.id));
    const amountOf = new Map(finalPlan.updatedCharges.map((charge) => [charge.id, charge.originalAmount]));
    for (const action of finalPlan.actions) {
      const amount = amountOf.get(action.chargeId) ?? 0;
      await appendAuditEntry({
        id: `monthly_due_date_repair_${action.chargeId}_${now.getTime()}`,
        studentId: action.studentId,
        billingPeriod: action.billingPeriod,
        previousAmount: amount,
        newAmount: amount,
        changedAt: now.toISOString(),
        reason: `Reparación de vencimiento mensual: de ${formatDateKeyDMY(action.previousDueDate)} a ${formatDateKeyDMY(action.newDueDate)} (importe sin cambios).`,
      });
    }
    for (const item of finalPlan.reviewNeeded) {
      const id = `monthly_due_date_review_${item.chargeId}`;
      if (knownIds.has(id)) continue; // una sola entrada por cargo: nunca se repite en cada arranque.
      const amount = amountOf.get(item.chargeId) ?? 0;
      await appendAuditEntry({
        id,
        studentId: item.studentId,
        billingPeriod: item.billingPeriod,
        previousAmount: amount,
        newAmount: amount,
        changedAt: now.toISOString(),
        reason: `Revisión pendiente: se conservó el vencimiento ${formatDateKeyDMY(item.currentDueDate)} (la regla daría ${formatDateKeyDMY(item.ruleDueDate)}) ${MONTHLY_REVIEW_REASON_TEXT[item.reason]}.`,
      });
    }
  } catch (auditError) {
    console.error('No se pudo guardar el registro de auditoría de la reparación de vencimientos mensuales', auditError);
  }
  if (finalPlan.reviewNeeded.length > 0) {
    // Sólo una cantidad — nunca nombres, importes ni fechas en el log.
    console.warn(`Reparación de vencimientos mensuales: ${finalPlan.reviewNeeded.length} vencimiento(s) conservado(s) para revisión.`);
  }

  return finalPlan;
}
