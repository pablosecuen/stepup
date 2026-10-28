// Puerto VERBATIM del original (`src/features/payments/services/__tests__/monthlyAmountScenariosAndE2E.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Auditoría 2026-08-17 (a pedido de Joaquín — verificación exhaustiva de
 * cambio de monto mensual): los 30 casos obligatorios pedidos + el
 * recorrido integrado real (mismo camino que usa la pantalla, nunca un
 * segundo motor). $185.000/$192.000 NO aparecen acá — la matriz general ya
 * los cubrió como dos pares más entre 210; estos casos usan importes
 * arbitrarios distintos a propósito, para demostrar que ningún caso está
 * "especialmente" resuelto.
 *
 * Identidad ficticia aislada: `qa_finanzas_montos_*`. Todo vive en un
 * adaptador en memoria (`makeFakeAdapter`) y un perfil en memoria
 * (`makeFakeProfileStore`) — nunca AsyncStorage ni Supabase real, y
 * desaparece al terminar el proceso de pruebas.
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter, type PaymentsStoreController } from '../../hooks/paymentsStore.ts';
import { generateMonthlyChargesForCandidates } from '../monthlyChargeGenerationService.ts';
import { registerPaymentForStudent } from '../registerPaymentService.ts';
import { voidPaymentForStudent } from '../voidPaymentService.ts';
import { correctMonthlyAmount, type CorrectMonthlyAmountProfileDeps, type CorrectMonthlyAmountStoreDeps } from '../monthlyAmountCorrectionService.ts';
import { applyFirstMonthSituation, markCurrentMonthAsPaid, resumeMonthlyBillingAfterRestore, type ResumeMonthlyBillingProfileDeps } from '../initialMonthlyBillingService.ts';
import { resolveEffectiveMonthlyAmount } from '../../../student-profile/utils/studentBillingPlan.ts';
import { resolveSuggestedMonthlyPaymentAmount } from '../../utils/monthlyPeriodStatus.ts';
import { resolveStudentMonthlyCardStatus } from '../../utils/monthlyPeriodStatus.ts';
import { calculateAssignableDebt } from '../../utils/registerPaymentPlan.ts';
import { buildStudentPaymentsSummary } from '../../utils/studentPaymentsSummary.ts';
import { buildHomeFinancialSummary } from '../../utils/buildHomeFinancialSummary.ts';
import { projectStudentListPaymentStatus } from '../../utils/studentListPaymentProjection.ts';
import { analyzeFinancialConsistency } from '../../utils/financialReconciliation.ts';
import { nextBillingPeriod } from '../../utils/paymentDates.ts';
import type { MonthlyBillingPlan, StudentProfile } from '../../../student-profile/types/index.ts';
import type { PaymentsRepositoryState } from '../../types/index.ts';
import type {
  BackupCollectionName,
  PaymentBackupCollectionName,
  PaymentsSchemaVersionEntry,
  TeacherFlowBackupV2,
} from '../../../../shared/backup/backupTypes.ts';
import { buildNextRawEntries, executeRestore, type RestoreIoAdapters } from '../../../../shared/backup/restoreExecutor.ts';
import { validateBackupFileContents } from '../../../../shared/backup/restoreValidation.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

function makeFakeAdapter() {
  const store = { persisted: emptyPaymentsState() };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state: PaymentsRepositoryState) => {
      store.persisted = state;
    },
  };
  return { adapter, store };
}

function makeMonthlyProfile(id: string, amount: number, extra: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id,
    name: `Ficticio ${id}`,
    levels: ['B1'],
    initialLevel: 'B1',
    modality: 'presencial',
    status: 'activo',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    billingPlan: { type: 'monthly', amount, dueDay: 1 },
    dateJoined: '2026-01-01T00:00:00.000Z',
    lastReactivatedAt: null,
    statusChangeDate: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 1,
    price: amount,
    averageGrade: 8,
    classesThisMonth: 0,
    attendanceRate: 100,
    paymentStatus: 'verde',
    nextClassAt: null,
    lastClassAt: null,
    pendingHomework: null,
    alerts: [],
    currentGoals: [],
    strengths: [],
    areasToImprove: [],
    totalClasses: 0,
    totalHoursTaken: 0,
    totalInvested: 0,
    statusHistory: [],
    levelHistory: [],
    priceHistory: [],
    skillGradesHistory: [],
    ...extra,
  };
}

function makeFakeProfileStore(initial: Record<string, StudentProfile> = {}) {
  const profiles = new Map<string, StudentProfile>(Object.entries(initial));
  const deps: CorrectMonthlyAmountProfileDeps & ResumeMonthlyBillingProfileDeps = {
    getProfile: (studentId) => profiles.get(studentId) ?? null,
    saveProfile: async (profile) => {
      profiles.set(profile.id, profile);
    },
  };
  return { profiles, deps };
}

const PERIOD = '2026-08';
const NOW = new Date('2026-08-05T15:00:00.000Z');

function setup(studentId: string, amount: number) {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, amount) });
  return { controller, deps, profiles, profileDeps };
}

// ---------------------------------------------------------------------------
// 1. Cambio ANTES de crear el cargo mensual.
// ---------------------------------------------------------------------------
// Corrección 2026-08-10 (a pedido de Joaquín — REGRESIÓN CRÍTICA: la cuota
// nueva no actualizaba el cargo abierto): ESTE era exactamente el caso real
// reportado — cambiar el monto "este mes" ANTES de que el ciclo automático
// de generación mensual hubiera creado el cargo del período. Antes, esto
// dejaba el plan actualizado pero SIN NINGÚN cargo del período actual en el
// store — "Registrar pago" no tenía nada del período con el importe nuevo
// contra qué mostrar (podía terminar mostrando una deuda vieja de otro
// período en su lugar). Ahora el cargo se crea EN EL ACTO.
asyncTest('caso 1: cambiar el monto antes de que exista el cargo del mes lo CREA en el acto, con el importe nuevo (GAP REAL corregido)', async () => {
  const studentId = 'qa_finanzas_montos_c1';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 45000);

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 63000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeUpdated, true, 'GAP REAL corregido: el store de pagos SÍ cambia — se crea el cargo del período');
  assertEqual(plan.chargeCreated, true, 'no existía cargo antes de esta llamada: se marca como recién creado');
  assertEqual(controller.getSnapshot().charges.length, 1, 'el cargo del período actual queda creado de inmediato');
  const chargeNow = controller.getSnapshot().charges.find((c) => c.studentId === studentId)!;
  assertEqual(chargeNow.originalAmount, 63000, 'nace directamente con el importe nuevo — "Registrar pago" ya lo ve así');

  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), 63000, 'el plan efectivo coincide con el cargo');

  // La generación automática, si corre después, es idempotente: nunca
  // duplica el cargo que ya se creó en el acto.
  await generateMonthlyChargesForCandidates([{ studentId, price: resolveEffectiveMonthlyAmount(updatedPlan, PERIOD) }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  assertEqual(controller.getSnapshot().charges.length, 1, 'la generación automática posterior no duplica el cargo');
  const chargeAfter = controller.getSnapshot().charges.find((c) => c.studentId === studentId)!;
  assertEqual(chargeAfter.originalAmount, 63000, 'el cargo sigue con el importe corregido, sin duplicados');
});

// ---------------------------------------------------------------------------
// 2. Cambio DESPUÉS de crear el cargo, sin pagos.
// ---------------------------------------------------------------------------
asyncTest('caso 2: cambiar el monto después de generado el cargo, sin pagos, actualiza el cargo in place', async () => {
  const studentId = 'qa_finanzas_montos_c2';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 52000);

  await generateMonthlyChargesForCandidates([{ studentId, price: 52000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 71000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeUpdated, true, 'el cargo existente se actualiza in place');

  const charge = controller.getSnapshot().charges.find((c) => c.studentId === studentId)!;
  assertEqual(charge.originalAmount, 71000, 'el cargo refleja el nuevo importe');
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), 71000, 'el plan efectivo coincide con el cargo');
});

// (3, 4, 5, 6 — vigencia/aumento/reducción — ya cubiertos exhaustivamente por las 220 transiciones de monthlyAmountMatrix.test.ts; casos con nombre explícito acá por completitud del pedido.)
asyncTest('caso 3/5: "desde este mes" con un AUMENTO real', async () => {
  const studentId = 'qa_finanzas_montos_c3';
  const { controller, deps, profileDeps } = setup(studentId, 30000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 30000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 48000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 48000, 'el cargo refleja el aumento');
});

asyncTest('caso 4/6: "desde el próximo mes" con una REDUCCIÓN real', async () => {
  const studentId = 'qa_finanzas_montos_c4';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 90000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 90000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 65000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 90000, 'el mes actual conserva el importe viejo');
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, nextBillingPeriod(PERIOD)), 65000, 'el próximo mes ya refleja la reducción');
});

// ---------------------------------------------------------------------------
// 7. Cargo parcialmente pagado y luego AUMENTADO.
// ---------------------------------------------------------------------------
asyncTest('caso 7: cargo con pago parcial y luego AUMENTADO — el pago parcial se conserva, el saldo se recalcula sobre el nuevo importe', async () => {
  const studentId = 'qa_finanzas_montos_c7';
  const { controller, deps, profileDeps } = setup(studentId, 100000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 100000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await registerPaymentForStudent({ studentId, amount: 40000, method: 'efectivo', paidAt: '2026-08-03', now: new Date('2026-08-03T12:00:00.000Z') }, deps);

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 130000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeUpdated, true, 'el aumento por encima de lo pagado siempre se permite');

  const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].originalAmount, 130000, 'el importe del cargo ya es el nuevo');
  assertEqual(summary.chargeStates[0].paidAmount, 40000, 'el pago parcial se conserva intacto, nunca se toca');
  assertEqual(summary.chargeStates[0].balance, 90000, 'el saldo se recalcula: 130.000 - 40.000');
});

// ---------------------------------------------------------------------------
// 8. Cargo parcialmente pagado y luego REDUCIDO, sin saldo a favor accidental.
// ---------------------------------------------------------------------------
asyncTest('caso 8a: reducir por debajo de lo ya pagado se RECHAZA — nunca genera saldo a favor accidental', async () => {
  const studentId = 'qa_finanzas_montos_c8a';
  const { deps, profileDeps } = setup(studentId, 100000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 100000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await registerPaymentForStudent({ studentId, amount: 60000, method: 'efectivo', paidAt: '2026-08-03', now: new Date('2026-08-03T12:00:00.000Z') }, deps);

  let rejected = false;
  let message = '';
  try {
    await correctMonthlyAmount({ studentId, newAmount: 50000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch (error) {
    rejected = true;
    message = error instanceof Error ? error.message : '';
  }
  assert(rejected, 'reducir a $50.000 (menos que los $60.000 ya pagados) debe rechazarse');
  assert(message.includes('menor a lo ya pagado'), 'el mensaje explica la razón exacta');
});

asyncTest('caso 8b: reducir hasta EXACTAMENTE lo ya pagado se acepta (saldo final $0, nunca negativo)', async () => {
  const studentId = 'qa_finanzas_montos_c8b';
  const { controller, deps, profileDeps } = setup(studentId, 100000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 100000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await registerPaymentForStudent({ studentId, amount: 60000, method: 'efectivo', paidAt: '2026-08-03', now: new Date('2026-08-03T12:00:00.000Z') }, deps);

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 60000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeUpdated, true, 'reducir hasta lo ya pagado (ni un peso menos) se acepta');

  const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].balance, 0, 'saldo final exacto en $0, nunca negativo (nunca saldo a favor)');
});

// ---------------------------------------------------------------------------
// 9/10. Cargo COMPLETAMENTE pagado — nunca se reescribe retroactivamente.
// ---------------------------------------------------------------------------
asyncTest('caso 9/10: intentar cambiar el monto "desde este mes" de un cargo YA SALDADO por completo se rechaza siempre — "próximo mes" sigue disponible', async () => {
  const studentId = 'qa_finanzas_montos_c9';
  const { deps, profiles, profileDeps } = setup(studentId, 80000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 80000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await registerPaymentForStudent({ studentId, amount: 80000, method: 'efectivo', paidAt: '2026-08-03', now: new Date('2026-08-03T12:00:00.000Z') }, deps);

  let rejected = false;
  let message = '';
  try {
    await correctMonthlyAmount({ studentId, newAmount: 95000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch (error) {
    rejected = true;
    message = error instanceof Error ? error.message : '';
  }
  assert(rejected, 'modificar retroactivamente un mes ya saldado por completo se rechaza');
  assert(message.includes('no se puede modificar retroactivamente'), 'el mensaje explica que el período ya está cerrado');

  // "Próximo mes" sigue siendo un camino real y disponible sobre el mismo alumno.
  const { plan: nextMonthPlan } = await correctMonthlyAmount({ studentId, newAmount: 95000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);
  assertEqual(nextMonthPlan.chargeUpdated, false, '"próximo mes" nunca toca el cargo ya saldado');
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, nextBillingPeriod(PERIOD)), 95000, 'el próximo mes queda con el importe nuevo');
});

// ---------------------------------------------------------------------------
// 11-14. Pago en cada etapa de vencimiento (después de un cambio de monto).
// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): las 4 etapas siguen calculándose (mora
// visual/scoring), pero ninguna produce recargo nunca — `expectedSurcharge`
// pasa a ser siempre 0, en las 4 etapas por igual.
const DUE_STAGE_CASES: Array<{ day: string; label: string; expectedSurcharge: (amount: number) => number }> = [
  { day: '2026-08-07', label: 'en término (día 1-10)', expectedSurcharge: () => 0 },
  { day: '2026-08-15', label: 'primer vencimiento (día 11-18)', expectedSurcharge: () => 0 },
  { day: '2026-08-22', label: 'segundo vencimiento (día 19-26)', expectedSurcharge: () => 0 },
  { day: '2026-08-30', label: 'último vencimiento (día 27+)', expectedSurcharge: () => 0 },
];

DUE_STAGE_CASES.forEach(({ day, label, expectedSurcharge }, index) => {
  asyncTest(`caso ${11 + index}: pago ${label} sobre un cargo con el monto YA corregido — sin recargo automático, nunca compuesto`, async () => {
    const studentId = `qa_finanzas_montos_c${11 + index}`;
    const { controller, deps, profileDeps } = setup(studentId, 60000);
    // dueDay: 1 explícito — mismo vencimiento que ya usa `makeMonthlyProfile`
    // para este alumno (evita el default de la profesora, día 10, que
    // correría las etapas de mora fuera de las fechas fijas de este caso).
    await generateMonthlyChargesForCandidates([{ studentId, price: 60000, dueDay: 1 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
    await correctMonthlyAmount({ studentId, newAmount: 84000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

    const summaryBefore = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: day });
    const expected = expectedSurcharge(84000);
    assertEqual(summaryBefore.chargeStates[0].surchargeAmount, expected, `(${label}) nunca hay recargo, ni sobre el importe ya corregido`);

    const suggested = resolveSuggestedMonthlyPaymentAmount({
      plan: { type: 'monthly', amount: 84000, dueDay: 1 },
      charges: summaryBefore.charges,
      chargeStates: summaryBefore.chargeStates,
      evaluationDate: day,
    });
    await registerPaymentForStudent({ studentId, amount: suggested.amount, method: 'efectivo', paidAt: day, now: new Date(`${day}T15:00:00.000Z`) }, deps);

    const summaryAfter = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: day });
    assertEqual(summaryAfter.chargeStates[0].balance, 0, `(${label}) saldo final $0 exacto`);
    assertEqual(summaryAfter.chargeStates[0].surchargeAmount, expected, `(${label}) recargo nunca compuesto sobre sí mismo`);
  });
});

// ---------------------------------------------------------------------------
// 15. Pago cargado HOY con paidAt retroactivo.
// ---------------------------------------------------------------------------
asyncTest('caso 15: pago cargado hoy (recordedAt) con paidAt retroactivo — el recargo usa paidAt real, nunca recordedAt', async () => {
  const studentId = 'qa_finanzas_montos_c15';
  const { controller, deps, profileDeps } = setup(studentId, 70000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 70000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 88000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  // El alumno pagó realmente el día 5 (en término), pero la profesora recién
  // lo carga en la app el día 20 (recordedAt muy posterior) — el recargo
  // debe evaluarse contra paidAt (05), nunca contra recordedAt (20).
  await registerPaymentForStudent(
    { studentId, amount: 88000, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-20T18:00:00.000Z') },
    deps
  );

  const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-20' });
  assertEqual(summary.chargeStates[0].surchargeAmount, 0, 'sin recargo: paidAt (05) está en término, aunque recordedAt (20) no lo esté');
  assertEqual(summary.chargeStates[0].balance, 0, 'saldo final $0');
});

// ---------------------------------------------------------------------------
// 16. Pago anulado y vuelto a registrar.
// ---------------------------------------------------------------------------
asyncTest('caso 16: pago anulado y vuelto a registrar — el saldo se recalcula correctamente, sin duplicar ni perder historial', async () => {
  const studentId = 'qa_finanzas_montos_c16';
  const { controller, deps, profileDeps } = setup(studentId, 55000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 55000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 72000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  const firstPayment = await registerPaymentForStudent({ studentId, amount: 72000, method: 'efectivo', paidAt: '2026-08-05', now: NOW }, deps);
  await voidPaymentForStudent({ paymentId: firstPayment.payment.id, reason: 'Error de carga (importe equivocado)', now: new Date('2026-08-06T10:00:00.000Z') }, deps);

  const summaryAfterVoid = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-06' });
  assertEqual(summaryAfterVoid.chargeStates[0].balance, 72000, 'anulado el pago, la deuda vuelve a estar completa');
  assertEqual(summaryAfterVoid.voidedPayments.length, 1, 'el pago anulado queda visible en el historial, nunca se borra');

  await registerPaymentForStudent({ studentId, amount: 72000, method: 'transferencia', paidAt: '2026-08-06', now: new Date('2026-08-06T10:05:00.000Z') }, deps);
  const finalSummary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-06' });
  assertEqual(finalSummary.chargeStates[0].balance, 0, 'el nuevo pago salda el mes correctamente');
  assertEqual(finalSummary.activePayments.length, 1, 'exactamente un pago activo, nunca dos');
  assertEqual(finalSummary.voidedPayments.length, 1, 'el anulado sigue en el historial, sin duplicarse');
});

// ---------------------------------------------------------------------------
// 17. Dos cambios CONSECUTIVOS de monto.
// ---------------------------------------------------------------------------
asyncTest('caso 17: dos cambios consecutivos de monto — el importe final es el último, sin residuos del intermedio', async () => {
  const studentId = 'qa_finanzas_montos_c17';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 40000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 40000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  await correctMonthlyAmount({ studentId, newAmount: 55000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  await correctMonthlyAmount({ studentId, newAmount: 61000, effectiveFrom: 'this_month', now: new Date('2026-08-06T10:00:00.000Z') }, deps, profileDeps);

  assertEqual(controller.getSnapshot().charges.length, 1, 'sigue siendo un único cargo, nunca uno por cada cambio');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 61000, 'el importe final es el del último cambio, no el intermedio (55.000)');
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), 61000, 'el plan efectivo también refleja sólo el último cambio');
});

// ---------------------------------------------------------------------------
// 18. Dos cambios CONCURRENTES simulados.
// ---------------------------------------------------------------------------
asyncTest('caso 18: dos cambios de monto concurrentes (Promise.all) — la cola interna los serializa, nunca corrompe el estado', async () => {
  const studentId = 'qa_finanzas_montos_c18';
  const { controller, deps, profileDeps } = setup(studentId, 50000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 50000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  const attempt = (amount: number) =>
    correctMonthlyAmount({ studentId, newAmount: amount, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps).then(
      () => ({ ok: true as const, amount }),
      (error: unknown) => ({ ok: false as const, amount, error })
    );

  const [first, second] = await Promise.all([attempt(70000), attempt(90000)]);
  const successes = [first, second].filter((r) => r.ok);
  assert(successes.length >= 1, 'al menos uno de los dos cambios concurrentes se aplica sin corromper el estado');
  assertEqual(controller.getSnapshot().charges.length, 1, 'nunca se crea un segundo cargo por la concurrencia');

  const finalAmount = controller.getSnapshot().charges[0].originalAmount;
  assert(finalAmount === 70000 || finalAmount === 90000, 'el importe final es exactamente uno de los dos propuestos, nunca un valor corrupto');
});

// ---------------------------------------------------------------------------
// 19. Dos alumnos con importes DISTINTOS (sin contaminación cruzada).
// ---------------------------------------------------------------------------
asyncTest('caso 19: dos alumnos con importes distintos, cambiados en la misma corrida — nunca se mezclan entre sí', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({
    qa_finanzas_montos_c19_a: makeMonthlyProfile('qa_finanzas_montos_c19_a', 35000),
    qa_finanzas_montos_c19_b: makeMonthlyProfile('qa_finanzas_montos_c19_b', 210000),
  });

  await generateMonthlyChargesForCandidates(
    [
      { studentId: 'qa_finanzas_montos_c19_a', price: 35000 },
      { studentId: 'qa_finanzas_montos_c19_b', price: 210000 },
    ],
    PERIOD,
    `${PERIOD}-01T09:00:00.000Z`,
    deps
  );

  await correctMonthlyAmount({ studentId: 'qa_finanzas_montos_c19_a', newAmount: 42000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  await correctMonthlyAmount({ studentId: 'qa_finanzas_montos_c19_b', newAmount: 180000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  const state = controller.getSnapshot();
  const chargeA = state.charges.find((c) => c.studentId === 'qa_finanzas_montos_c19_a')!;
  const chargeB = state.charges.find((c) => c.studentId === 'qa_finanzas_montos_c19_b')!;
  assertEqual(chargeA.originalAmount, 42000, 'el alumno A queda con su propio importe corregido');
  assertEqual(chargeB.originalAmount, 180000, 'el alumno B queda con su propio importe corregido, sin heredar el de A');
});

// ---------------------------------------------------------------------------
// 20. Como MÍNIMO 100 alumnos ficticios con importes diferentes.
// ---------------------------------------------------------------------------
asyncTest('caso 20: 100 alumnos ficticios, cada uno con un importe distinto, cambiados en la misma corrida — cada uno queda exactamente en el suyo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const students = Array.from({ length: 100 }, (_, i) => ({
    id: `qa_finanzas_montos_c20_${i}`,
    from: 10000 + i * 1000,
    to: 10000 + i * 1000 + 5000 + i * 37, // distinto por alumno, nunca el mismo delta
  }));

  const { deps: profileDeps } = makeFakeProfileStore(
    Object.fromEntries(students.map((s) => [s.id, makeMonthlyProfile(s.id, s.from)]))
  );

  await generateMonthlyChargesForCandidates(
    students.map((s) => ({ studentId: s.id, price: s.from })),
    PERIOD,
    `${PERIOD}-01T09:00:00.000Z`,
    deps
  );

  for (const s of students) {
    await correctMonthlyAmount({ studentId: s.id, newAmount: s.to, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  }

  const state = controller.getSnapshot();
  assertEqual(state.charges.length, 100, 'exactamente 100 cargos, uno por alumno, nunca más');
  students.forEach((s) => {
    const charge = state.charges.find((c) => c.studentId === s.id)!;
    assertEqual(charge.originalAmount, s.to, `(${s.id}) su propio importe corregido, sin mezclarse con otro alumno`);
  });
});

// ---------------------------------------------------------------------------
// 21. Cambio de MES.
// ---------------------------------------------------------------------------
asyncTest('caso 21: cambio de mes real — "próximo mes" aplicado en agosto se materializa correctamente al generar septiembre', async () => {
  const studentId = 'qa_finanzas_montos_c21';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 60000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 60000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 77000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);

  const plan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  await generateMonthlyChargesForCandidates(
    [{ studentId, price: resolveEffectiveMonthlyAmount(plan, '2026-09') }],
    '2026-09',
    '2026-09-01T09:00:00.000Z',
    deps
  );
  const septemberCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-09')!;
  assertEqual(septemberCharge.originalAmount, 77000, 'septiembre nace con el importe correcto');
  const augustCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === PERIOD)!;
  assertEqual(augustCharge.originalAmount, 60000, 'agosto queda intacto');
});

// ---------------------------------------------------------------------------
// 22. Cambio de AÑO, diciembre -> enero.
// ---------------------------------------------------------------------------
asyncTest('caso 22: cambio de monto "próximo mes" en diciembre se materializa en enero del año siguiente', async () => {
  const studentId = 'qa_finanzas_montos_c22';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 50000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 50000 }], '2026-12', '2026-12-01T09:00:00.000Z', deps);
  await correctMonthlyAmount({ studentId, newAmount: 68000, effectiveFrom: 'next_month', now: new Date('2026-12-05T15:00:00.000Z') }, deps, profileDeps);

  const plan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(plan.pendingAmountEffectiveFrom, '2027-01', 'el próximo período cruza correctamente a enero del año siguiente');
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2027-01'), 68000, 'enero 2027 ya usa el importe nuevo');
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-12'), 50000, 'diciembre 2026 conserva el importe viejo');

  await generateMonthlyChargesForCandidates(
    [{ studentId, price: resolveEffectiveMonthlyAmount(plan, '2027-01') }],
    '2027-01',
    '2027-01-01T09:00:00.000Z',
    deps
  );
  const januaryCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2027-01')!;
  assertEqual(januaryCharge.originalAmount, 68000, 'el cargo de enero 2027 nace con el importe correcto');
});

// ---------------------------------------------------------------------------
// 23. Alumno ARCHIVADO y RESTAURADO.
// ---------------------------------------------------------------------------
asyncTest('caso 23: alumno archivado, restaurado ("cobrar desde este mes") y luego con un cambio de monto — todo coherente', async () => {
  const studentId = 'qa_finanzas_montos_c23';
  const { deps: profileDepsRaw } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, 40000, { status: 'archivado' }) });
  const { adapter } = makeFakeAdapter();
  const paymentsController = createPaymentsStoreController(adapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: paymentsController.hydrate, applyMutation: paymentsController.applyMutation };

  const restoreResult = await resumeMonthlyBillingAfterRestore({ studentId, choice: 'this_month', now: new Date('2026-08-12T15:00:00.000Z') }, deps, profileDepsRaw);
  assert(restoreResult.chargeCreated, 'se genera el cargo del mes al restaurar "desde este mes"');

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 58000, effectiveFrom: 'this_month', now: new Date('2026-08-13T10:00:00.000Z') }, deps, profileDepsRaw);
  assertEqual(plan.chargeUpdated, true, 'tras restaurar, el cambio de monto sigue funcionando con normalidad');

  const summary = buildStudentPaymentsSummary({ studentId, state: paymentsController.getSnapshot(), evaluationDate: '2026-08-13' });
  assertEqual(summary.chargeStates[0].originalAmount, 58000, 'el cargo post-restauración refleja el nuevo importe');
});

// ---------------------------------------------------------------------------
// 24. Alumno NUEVO que declara el mes ya pagado.
// ---------------------------------------------------------------------------
asyncTest('caso 24: alumno nuevo con "el mes ya está pagado" declarado al alta, y luego un cambio de monto para el mes SIGUIENTE', async () => {
  const studentId = 'qa_finanzas_montos_c24';
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, 45000) });

  const altaResult = await applyFirstMonthSituation({ studentId, situation: 'paid', amount: 45000, paidAt: '2026-08-02', method: 'efectivo', now: new Date('2026-08-02T12:00:00.000Z') }, deps);
  assertEqual(altaResult.allocation?.amount, 45000, 'la declaración de alta registra el importe completo');

  const summaryAugust = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-02' });
  assertEqual(summaryAugust.chargeStates[0].balance, 0, 'agosto queda saldado por la declaración de alta');

  // Cambio de monto para septiembre, sin tocar la declaración de agosto.
  await correctMonthlyAmount({ studentId, newAmount: 52000, effectiveFrom: 'next_month', now: new Date('2026-08-10T12:00:00.000Z') }, deps, profileDeps);
  const plan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  await generateMonthlyChargesForCandidates([{ studentId, price: resolveEffectiveMonthlyAmount(plan, '2026-09') }], '2026-09', '2026-09-01T09:00:00.000Z', deps);

  const septemberCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-09')!;
  assertEqual(septemberCharge.originalAmount, 52000, 'septiembre ya usa el nuevo importe');
  const augustCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-08')!;
  assertEqual(augustCharge.originalAmount, 45000, 'agosto (la declaración de alta) nunca se altera');
});

// ---------------------------------------------------------------------------
// 25. Backup y restauración AISLADOS, conservando plan, cargo, pago y vigencia.
// ---------------------------------------------------------------------------
const BACKUP_KEYS: Record<BackupCollectionName, string> = {
  students: 'qa_montos_k_students',
  profiles: 'qa_montos_k_profiles',
  pedagogicalLessons: 'qa_montos_k_lessons',
  calendarLessons: 'qa_montos_k_calendar',
  recurrenceRules: 'qa_montos_k_rules',
  recurrenceExceptions: 'qa_montos_k_exceptions',
  teacherAvailability: 'qa_montos_k_availability',
};
const BACKUP_PAYMENT_KEYS: Record<PaymentBackupCollectionName, string> = {
  paymentCharges: 'qa_montos_k_payment_charges',
  payments: 'qa_montos_k_payments',
  paymentAllocations: 'qa_montos_k_payment_allocations',
  paymentAdjustments: 'qa_montos_k_payment_adjustments',
};
const BACKUP_PAYMENTS_SCHEMA_VERSION_ENTRY: PaymentsSchemaVersionEntry = { key: 'qa_montos_k_payments_schema_version', value: '1' };
const BACKUP_FALLBACK_AVAILABILITY: TeacherFlowBackupV2['teacherAvailability'] = {
  schemaVersion: 1,
  timezone: 'America/Argentina/Buenos_Aires',
  weeklyBlocks: [],
  exceptions: [],
};

asyncTest('caso 25: backup + restauración aislados (FakeStore en memoria) conservan plan, cargo, pago y vigencia exactos', async () => {
  const studentId = 'qa_finanzas_montos_c25';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 66000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 66000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 91000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);
  await registerPaymentForStudent({ studentId, amount: 66000, method: 'efectivo', paidAt: '2026-08-05', now: NOW }, deps);

  const paymentsState = controller.getSnapshot();
  const profile = profiles.get(studentId)!;

  const backup: TeacherFlowBackupV2 = {
    schemaVersion: 2,
    exportedAt: '2026-08-17T12:00:00.000Z',
    appVersion: 'qa-finanzas-montos',
    students: [
      {
        id: studentId,
        name: profile.name,
        levels: profile.levels,
        modality: profile.modality,
        status: profile.status,
        nextClassAt: null,
        paymentStatus: 'verde',
        averageGrade: 8,
        classesThisMonth: 0,
        lastPaymentAt: null,
        isFeatured: false,
        isNew: false,
        hasOverduePayment: false,
        hasPendingReport: false,
        hasPendingHomework: false,
      },
    ],
    profiles: { [studentId]: profile },
    pedagogicalLessons: [],
    calendarLessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    teacherAvailability: null,
    paymentCharges: paymentsState.charges,
    payments: paymentsState.payments,
    paymentAllocations: paymentsState.allocations,
    paymentAdjustments: paymentsState.adjustments,
  };

  const validated = validateBackupFileContents(JSON.stringify(backup));
  assert(validated.ok, `el backup armado debe ser válido: ${validated.ok ? '' : validated.errors.map((e) => e.message).join('; ')}`);
  if (!validated.ok) return;

  const staleEntries: Record<string, string | null> = {};
  for (const key of Object.values(BACKUP_KEYS)) staleEntries[key] = null;
  for (const key of Object.values(BACKUP_PAYMENT_KEYS)) staleEntries[key] = null;
  staleEntries[BACKUP_PAYMENTS_SCHEMA_VERSION_ENTRY.key] = null;

  const fakeStore = { entries: { ...staleEntries } };
  const adapters: RestoreIoAdapters = {
    readCurrentEntries: async () => ({ ...fakeStore.entries }),
    writeEntries: async (next) => {
      fakeStore.entries = { ...next };
    },
    saveRecoverySnapshot: async () => undefined,
    syncInMemoryStores: async () => undefined,
  };

  const outcome = await executeRestore(validated.backup, BACKUP_KEYS, BACKUP_PAYMENT_KEYS, BACKUP_FALLBACK_AVAILABILITY, BACKUP_PAYMENTS_SCHEMA_VERSION_ENTRY, adapters);
  assertEqual(outcome.status, 'restored', 'la restauración aislada debe completarse con éxito');

  const expectedEntries = buildNextRawEntries(validated.backup, BACKUP_KEYS, BACKUP_PAYMENT_KEYS, BACKUP_FALLBACK_AVAILABILITY, BACKUP_PAYMENTS_SCHEMA_VERSION_ENTRY);
  Object.entries(expectedEntries).forEach(([key, expectedValue]) => {
    assertEqual(fakeStore.entries[key], expectedValue, `la clave restaurada "${key}" coincide con lo esperado`);
  });

  const restoredCharges: typeof paymentsState.charges = JSON.parse(fakeStore.entries[BACKUP_PAYMENT_KEYS.paymentCharges] ?? '[]');
  const restoredProfiles: Record<string, StudentProfile> = JSON.parse(fakeStore.entries[BACKUP_KEYS.profiles] ?? '{}');
  const restoredPlan = restoredProfiles[studentId].billingPlan as MonthlyBillingPlan;

  assertEqual(restoredCharges[0].originalAmount, 66000, 'el cargo restaurado conserva el importe original exacto');
  assertEqual(resolveEffectiveMonthlyAmount(restoredPlan, PERIOD), 66000, 'la vigencia del mes actual se conserva tras restaurar');
  assertEqual(resolveEffectiveMonthlyAmount(restoredPlan, nextBillingPeriod(PERIOD)), 91000, 'la vigencia "próximo mes" pendiente también se conserva tras restaurar');

  const restoredPayments: typeof paymentsState.payments = JSON.parse(fakeStore.entries[BACKUP_PAYMENT_KEYS.payments] ?? '[]');
  assertEqual(restoredPayments[0].amount, 66000, 'el pago restaurado conserva su importe exacto');
});

// ---------------------------------------------------------------------------
// 26. Cierre y nueva HIDRATACIÓN del store en memoria.
// ---------------------------------------------------------------------------
asyncTest('caso 26: reiniciar (resetForTests) y volver a hidratar el store en memoria conserva el importe corregido, tal como quedó persistido', async () => {
  const studentId = 'qa_finanzas_montos_c26';
  const { store, adapter } = (() => {
    const s = { persisted: emptyPaymentsState() };
    const a: PaymentsPersistenceAdapter = {
      readAll: async () => s.persisted,
      writeAll: async (state) => {
        s.persisted = state;
      },
    };
    return { store: s, adapter: a };
  })();

  let controller: PaymentsStoreController = createPaymentsStoreController(adapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, 33000) });

  await generateMonthlyChargesForCandidates([{ studentId, price: 33000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 47000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(store.persisted.charges[0].originalAmount, 47000, 'el adaptador en memoria ya tiene el importe corregido');

  // "Cierre" simulado: una instancia NUEVA del controlador (equivalente a
  // reiniciar la app), que vuelve a hidratar desde el mismo adaptador —
  // nunca desde el estado en memoria de la instancia anterior.
  controller = createPaymentsStoreController(adapter);
  const rehydrated = await controller.hydrate();
  assertEqual(rehydrated.charges[0].originalAmount, 47000, 'tras una nueva hidratación, el importe corregido sigue siendo el mismo');
});

// ---------------------------------------------------------------------------
// 27. Error simulado al guardar el PERFIL: el cargo debe revertirse.
// ---------------------------------------------------------------------------
asyncTest('caso 27: si falla guardar el perfil DESPUÉS de corregir el cargo, el cargo se revierte al importe anterior', async () => {
  const studentId = 'qa_finanzas_montos_c27';
  const { controller, deps } = setup(studentId, 40000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 40000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  const failingProfileDeps: CorrectMonthlyAmountProfileDeps = {
    getProfile: () => makeMonthlyProfile(studentId, 40000),
    saveProfile: async () => {
      throw new Error('fallo simulado al guardar el perfil');
    },
  };

  let rejected = false;
  try {
    await correctMonthlyAmount({ studentId, newAmount: 60000, effectiveFrom: 'this_month', now: NOW }, deps, failingProfileDeps);
  } catch {
    rejected = true;
  }
  assert(rejected, 'el error simulado del perfil se propaga tal cual a quien llamó');

  const charge = controller.getSnapshot().charges.find((c) => c.studentId === studentId)!;
  assertEqual(charge.originalAmount, 40000, 'el cargo se revirtió a su importe anterior — nunca queda con el nuevo importe sin el plan actualizado');
});

// Corrección 2026-08-10 (a pedido de Joaquín — REGRESIÓN CRÍTICA): caso 27
// cubre el rollback cuando el cargo YA EXISTÍA. Falta el otro camino nuevo:
// si el cargo se CREÓ recién en este llamado (no existía ningún cargo del
// período antes) y el guardado del perfil falla, el cargo recién creado
// debe RETIRARSE por completo — nunca quedar huérfano con el importe nuevo
// sin que el plan lo respalde.
asyncTest('caso 27b: si el cargo se CREÓ recién (no existía antes) y falla guardar el perfil, el cargo recién creado se RETIRA por completo', async () => {
  const studentId = 'qa_finanzas_montos_c27b';
  const { controller, deps } = setup(studentId, 40000);
  // Deliberadamente NO se genera el cargo del mes — es exactamente el
  // escenario real reportado: editar la cuota antes de que exista cargo.
  assertEqual(controller.getSnapshot().charges.length, 0, 'precondición: no existe cargo del período antes de corregir');

  const failingProfileDeps: CorrectMonthlyAmountProfileDeps = {
    getProfile: () => makeMonthlyProfile(studentId, 40000),
    saveProfile: async () => {
      throw new Error('fallo simulado al guardar el perfil');
    },
  };

  let rejected = false;
  try {
    await correctMonthlyAmount({ studentId, newAmount: 60000, effectiveFrom: 'this_month', now: NOW }, deps, failingProfileDeps);
  } catch {
    rejected = true;
  }
  assert(rejected, 'el error simulado del perfil se propaga tal cual a quien llamó');

  assertEqual(
    controller.getSnapshot().charges.filter((c) => c.studentId === studentId).length,
    0,
    'el cargo recién creado se retira por completo — nunca queda huérfano con $60.000 sin que el plan lo respalde'
  );
});

// ---------------------------------------------------------------------------
// 28. Error simulado al guardar PAGOS: el perfil no debe quedar desincronizado.
// ---------------------------------------------------------------------------
asyncTest('caso 28: si falla la escritura del store de pagos, el perfil nunca llega a tocarse (falla ANTES, no después)', async () => {
  const studentId = 'qa_finanzas_montos_c28';
  const failingAdapter: PaymentsPersistenceAdapter = {
    readAll: async () => emptyPaymentsState(),
    writeAll: async () => {
      throw new Error('fallo simulado al escribir el store de pagos');
    },
  };
  const controller = createPaymentsStoreController(failingAdapter);
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  let profileSaveCalled = false;
  const profileDeps: CorrectMonthlyAmountProfileDeps = {
    getProfile: () => makeMonthlyProfile(studentId, 25000),
    saveProfile: async () => {
      profileSaveCalled = true;
    },
  };

  let rejected = false;
  try {
    await correctMonthlyAmount({ studentId, newAmount: 34000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch {
    rejected = true;
  }
  assert(rejected, 'el fallo de persistencia de pagos se propaga');
  assert(!profileSaveCalled, 'el perfil nunca se guarda si el store de pagos falló antes — nunca queda desincronizado');
});

// ---------------------------------------------------------------------------
// 29. NO duplicación de cargos, pagos ni asignaciones (motor real de reconciliación).
// ---------------------------------------------------------------------------
asyncTest('caso 29: tras una secuencia realista de cambios de monto + pagos + anulaciones, analyzeFinancialConsistency no encuentra NINGUNA inconsistencia', async () => {
  const studentId = 'qa_finanzas_montos_c29';
  const { controller, deps, profileDeps } = setup(studentId, 58000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 58000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId, newAmount: 74000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  await registerPaymentForStudent({ studentId, amount: 30000, method: 'efectivo', paidAt: '2026-08-05', now: NOW }, deps);
  const secondPayment = await registerPaymentForStudent({ studentId, amount: 44000, method: 'transferencia', paidAt: '2026-08-10', now: new Date('2026-08-10T10:00:00.000Z') }, deps);
  await voidPaymentForStudent({ paymentId: secondPayment.payment.id, reason: 'Duplicado de carga', now: new Date('2026-08-10T10:05:00.000Z') }, deps);
  await registerPaymentForStudent({ studentId, amount: 44000, method: 'transferencia', paidAt: '2026-08-10', now: new Date('2026-08-10T10:06:00.000Z') }, deps);

  const state = controller.getSnapshot();
  const report = analyzeFinancialConsistency({
    state,
    students: [{ id: studentId, status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 74000, dueDay: 1 }),
    evaluationDate: '2026-08-10',
  });
  assertEqual(report.totalFindings, 0, `no debe haber ninguna inconsistencia financiera: ${JSON.stringify(report.findings)}`);
  assertEqual(report.countsByCategory.duplicate_monthly_charge, 0, 'nunca un cargo mensual duplicado');
  assertEqual(report.countsByCategory.negative_balance, 0, 'nunca un saldo negativo (sobrepago no admitido)');
});

// ---------------------------------------------------------------------------
// 30. ACTUALIZACIÓN INMEDIATA de todos los consumidores (mismo estado, sin caché).
// ---------------------------------------------------------------------------
asyncTest('caso 30: tras cambiar el monto, TODOS los consumidores (perfil/Cobros, listado, Home, scoring/resumen) reflejan el nuevo importe de inmediato, desde el mismo snapshot', async () => {
  const studentId = 'qa_finanzas_montos_c30';
  const { controller, deps, profiles, profileDeps } = setup(studentId, 62000);
  await generateMonthlyChargesForCandidates([{ studentId, price: 62000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  await correctMonthlyAmount({ studentId, newAmount: 89000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  const state = controller.getSnapshot();
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;

  // Perfil / Cobros (CobrosTab.tsx).
  const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].originalAmount, 89000, 'Cobros: el cargo ya muestra el nuevo importe');
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan: updatedPlan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  assertEqual(suggested.amount, 89000, 'Cobros: el pago sugerido ya es el nuevo importe');

  // Listado de alumnos (StudentCard vía projectStudentListPaymentStatus).
  const projected = projectStudentListPaymentStatus(
    [{ id: studentId, name: 'x', levels: ['B1'], modality: 'presencial', status: 'activo', nextClassAt: null, paymentStatus: 'verde', averageGrade: 8, classesThisMonth: 0, lastPaymentAt: null, isFeatured: false, isNew: false, hasOverduePayment: false, hasPendingReport: false, hasPendingHomework: false }],
    state,
    '2026-08-05',
    () => updatedPlan
  );
  assertEqual(projected[0].monthlyStatusBalance, 89000, 'Listado de alumnos: el saldo mensual ya refleja el nuevo importe');
  const cardStatus = resolveStudentMonthlyCardStatus({ plan: updatedPlan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  assertEqual(cardStatus.balance, 89000, 'Tarjeta de alumno: mismo saldo, mismo instante');

  // Home / resumen financiero global.
  const homeSummary = buildHomeFinancialSummary({ state, evaluationDate: '2026-08-05' });
  assertEqual(homeSummary.currentMonthGenerated, 89000, 'Home: "generado este mes" ya refleja el importe corregido');
  assertEqual(homeSummary.currentMonthPendingBalance, 89000, 'Home: "pendiente este mes" ya refleja el importe corregido');
});

// ---------------------------------------------------------------------------
// PRUEBA DEL FLUJO REAL — recorrido integrado de 10 pasos, mismo camino que
// usa la pantalla (nunca un segundo motor exclusivo para las pruebas).
// ---------------------------------------------------------------------------
asyncTest('recorrido integrado real: identidad ficticia -> alta -> cargo -> EditMonthlyAmountSheet (correctMonthlyAmount) -> CobrosTab (resolveSuggestedMonthlyPaymentAmount) -> RegisterPaymentSheet (registerPaymentForStudent) -> desmontaje -> nueva hidratación -> coherencia final', async () => {
  // 1) Identidad ficticia en memoria.
  const studentId = 'qa_finanzas_montos_e2e';
  const { store, adapter } = (() => {
    const s = { persisted: emptyPaymentsState() };
    const a: PaymentsPersistenceAdapter = {
      readAll: async () => s.persisted,
      writeAll: async (state) => {
        s.persisted = state;
      },
    };
    return { store: s, adapter: a };
  })();
  let controller = createPaymentsStoreController(adapter);
  let deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore();

  // 2) Alumno ficticio con plan mensual.
  profiles.set(studentId, makeMonthlyProfile(studentId, 68000));

  // 3) Generar el cargo abierto original — obligación A (mismo motor real:
  // selectMonthlyChargeCandidates + generateMonthlyChargesForCandidates).
  await generateMonthlyChargesForCandidates([{ studentId, price: 68000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  assertEqual(controller.getSnapshot().charges.length, 1, 'paso 3: el cargo del mes existe (obligación A = $68.000)');
  const chargeIdBeforeChange = controller.getSnapshot().charges.find((c) => c.studentId === studentId)!.id;

  // 4) Modificar el importe (A -> B) mediante EXACTAMENTE el servicio que
  // llama EditMonthlyAmountSheet, con vigencia "este mes".
  const { plan: changePlan } = await correctMonthlyAmount({ studentId, newAmount: 95000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(changePlan.chargeUpdated, true, 'paso 4: correctMonthlyAmount actualiza el cargo real');

  // 5) Leer nuevamente el store: el MISMO chargeId ahora contiene B, nunca un cargo nuevo.
  const stateAfterChange = controller.getSnapshot();
  assertEqual(stateAfterChange.charges.length, 1, 'paso 5a: sigue habiendo un único cargo del período — nunca se duplica');
  assertEqual(stateAfterChange.charges[0].id, chargeIdBeforeChange, 'paso 5b: es el MISMO chargeId de la obligación original, corregido in place');
  assertEqual(stateAfterChange.charges[0].originalAmount, 95000, 'paso 5c: el store refleja el importe nuevo (B)');

  // 6) Construir el estado REAL de RegisterPaymentSheet: las mismas dos
  // funciones que ese componente llama, ni una más — buildStudentPaymentsSummary
  // (saldo/importe original) y calculateAssignableDebt (máximo registrable).
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  const summary = buildStudentPaymentsSummary({ studentId, state: stateAfterChange, evaluationDate: '2026-08-05' });
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan: updatedPlan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  const assignableAtPaidAt = calculateAssignableDebt({ studentId, state: stateAfterChange, evaluationDate: '2026-08-05' });

  // 7) Confirmar que RegisterPaymentSheet muestra B como importe original Y como saldo máximo registrable — nunca A.
  assertEqual(summary.chargeStates[0].originalAmount, 95000, 'paso 7a: "importe original" en RegisterPaymentSheet es B, nunca A ($68.000)');
  assertEqual(summary.chargeStates[0].balance, 95000, 'paso 7b: el saldo pendiente ya es B completo (nada pagado todavía)');
  assertEqual(assignableAtPaidAt, 95000, 'paso 7c: calculateAssignableDebt (el "máximo registrable" real de la pantalla) ya es B');
  assertEqual(suggested.amount, 95000, 'paso 7d: el importe sugerido por CobrosTab también es B');

  // 8) Registrar el pago mediante EXACTAMENTE el servicio que usa la pantalla (RegisterPaymentSheet), por B.
  const paymentResult = await registerPaymentForStudent({ studentId, amount: assignableAtPaidAt, method: 'efectivo', paidAt: '2026-08-05', now: NOW }, deps);
  assertEqual(paymentResult.payment.amount, 95000, 'paso 8: el pago registrado es exactamente B');

  // 9) Confirmar saldo cero tras registrar el pago (cargo, pago, asignación, saldo, recargo y scoring).
  const summaryAfterPayment = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summaryAfterPayment.chargeStates[0].balance, 0, 'paso 9a: saldo final $0');
  assertEqual(summaryAfterPayment.chargeStates[0].surchargeAmount, 0, 'paso 9b: sin recargo (pagado en término)');
  assertEqual(summaryAfterPayment.activePayments.length, 1, 'paso 9c: un único pago activo');
  assertEqual(summaryAfterPayment.activePayments[0].amount, 95000, 'paso 9d: el pago activo tiene el importe correcto');

  // 10) Simular desmontaje, hidratación y nueva lectura (equivalente a cerrar y reabrir la app) — confirmar que sigue en B.
  controller = createPaymentsStoreController(adapter);
  deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const rehydratedState = await controller.hydrate();

  assertEqual(rehydratedState.charges[0].originalAmount, 95000, 'paso 10a: el cargo sigue con el importe corregido tras la nueva hidratación');
  const finalSummary = buildStudentPaymentsSummary({ studentId, state: rehydratedState, evaluationDate: '2026-08-05' });
  assertEqual(finalSummary.chargeStates[0].balance, 0, 'paso 10b: el saldo sigue en $0 tras la nueva hidratación');
  assertEqual(finalSummary.activePayments[0].amount, 95000, 'paso 10c: el pago sigue íntegro tras la nueva hidratación');
  assertEqual(store.persisted.charges[0].originalAmount, 95000, 'paso 10d: lo persistido en el adaptador en memoria coincide exactamente');
});
