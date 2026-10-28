// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/monthlyDueDateAndInactiveStudentBilling.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-02 (a pedido de Joaquín — DOS ERRORES RELACIONADOS CON
 * EL ESTADO DE COBRO):
 *   1) un alumno inactivo seguía mostrando "Pendiente" en su tarjeta de pago
 *      y podía seguir generando mensualidades futuras.
 *   2) las mensualidades se generaban con vencimiento el día 1 en vez del
 *      día real configurado (`dueDay`, default 10), lo que las hacía
 *      aparecer como "Mes vencido" apenas empezaba el mes.
 *
 * Este archivo cubre los 14 casos de prueba pedidos explícitamente, sobre
 * las fuentes canónicas nuevas/corregidas:
 *   - `resolveMonthlyDueDate`/`nextBusinessDay`/`isWeekendDateKey` (paymentDates.ts)
 *   - `resolveMonthlyDueDateUrgency`/`isChargeOverdueForDisplay` (paymentDueStage.ts)
 *   - `isStudentBillableForPeriod` (monthlyChargeGenerationPlan.ts)
 *   - `planMonthlyDueDateRepair` (financialReconciliation.ts)
 *   - `resolveStudentMonthlyCardStatus` (monthlyPeriodStatus.ts)
 *   - `buildCollectionsCenterEntries` (collectionsCenter.ts)
 *   - `buildHomeFinancialSummary` (buildHomeFinancialSummary.ts)
 *
 * Todo en memoria, pura — nunca AsyncStorage ni Supabase real, ningún
 * alumno/pago/cargo real. Identidad ficticia aislada: prefijo `qa_vto_`.
 */
import type { PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { billingPeriodOfDateKey, firstDayOfBillingPeriod, isWeekendDateKey, nextBusinessDay, resolveMonthlyDueDate } from '../paymentDates.ts';
import { isChargeOverdueForDisplay, resolveMonthlyDueDateUrgency } from '../paymentDueStage.ts';
import { buildMonthlyChargeId } from '../paymentIdempotency.ts';
import { isStudentBillableForPeriod, planMonthlyChargeGeneration, selectMonthlyChargeCandidates } from '../monthlyChargeGenerationPlan.ts';
import { planMonthlyDueDateRepair } from '../financialReconciliation.ts';
import { resolveStudentMonthlyCardStatus, summarizeOverdueDebt } from '../monthlyPeriodStatus.ts';
import { buildCollectionsCenterEntries } from '../collectionsCenter.ts';
import { buildHomeFinancialSummary } from '../buildHomeFinancialSummary.ts';
import { buildStudentPaymentsSummary } from '../studentPaymentsSummary.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function monthlyCharge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; billingPeriod: string; dueDate: string }): PaymentCharge {
  return {
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    createdAt: `${overrides.billingPeriod}-01T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

const planDueDay10: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 10 };

// ---------------------------------------------------------------------------
// 1) Días 1 al 6: pendiente en término, sin atención.
// ---------------------------------------------------------------------------
test('días 1 a 6 (vencimiento real el 10): pendiente en término, nunca aparece en Centro de cobros', () => {
  const dueDate = '2026-08-10';
  ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'].forEach((evaluationDate) => {
    const status = resolveMonthlyDueDateUrgency(dueDate, evaluationDate);
    assertEqual(status.urgency, 'pendiente_en_termino', `${evaluationDate}: pendiente en término`);

    const charge = monthlyCharge({ id: 'c1', studentId: 'qa_vto_s1', billingPeriod: '2026-08', dueDate });
    const entries = buildCollectionsCenterEntries({ state: { ...emptyState(), charges: [charge] }, evaluationDate });
    assertEqual(entries.length, 0, `${evaluationDate}: no requiere atención en Centro de cobros`);
  });
});

// ---------------------------------------------------------------------------
// 2) Tres días antes del vencimiento: "vence pronto", informa días restantes.
// ---------------------------------------------------------------------------
test('3 días antes del vencimiento: "vence pronto", informa los días restantes, todavía no vencida', () => {
  const dueDate = '2026-08-10';
  [
    { evaluationDate: '2026-08-07', expectedDays: 3 },
    { evaluationDate: '2026-08-08', expectedDays: 2 },
    { evaluationDate: '2026-08-09', expectedDays: 1 },
  ].forEach(({ evaluationDate, expectedDays }) => {
    const status = resolveMonthlyDueDateUrgency(dueDate, evaluationDate);
    assertEqual(status.urgency, 'vence_pronto', `${evaluationDate}: vence pronto`);
    assertEqual(status.daysUntilDue, expectedDays, `${evaluationDate}: faltan ${expectedDays} día(s)`);

    const charge = monthlyCharge({ id: 'c1', studentId: 'qa_vto_s1', billingPeriod: '2026-08', dueDate });
    const entries = buildCollectionsCenterEntries({ state: { ...emptyState(), charges: [charge] }, evaluationDate });
    assertEqual(entries[0]?.urgency, 'vence_pronto', `${evaluationDate}: aparece marcado "vence pronto" en Centro de cobros`);
    assertEqual(entries[0]?.daysUntilDue, expectedDays, `${evaluationDate}: Centro de cobros informa los días restantes`);
  });
});

// ---------------------------------------------------------------------------
// 3) Día 10 (vencimiento efectivo): "vence hoy", todavía en término.
// ---------------------------------------------------------------------------
test('día del vencimiento efectivo: "vence hoy", todavía en término (nunca "Mes vencido")', () => {
  const dueDate = '2026-08-10';
  const status = resolveMonthlyDueDateUrgency(dueDate, dueDate);
  assertEqual(status.urgency, 'vence_hoy', 'el propio día de vencimiento: "vence hoy"');
  assertEqual(isChargeOverdueForDisplay('mensual', dueDate, 'on_time', dueDate), false, 'todavía no está vencida para ningún consumidor');
});

// ---------------------------------------------------------------------------
// 4) Día siguiente al vencimiento: "Mes vencido".
// ---------------------------------------------------------------------------
test('el día siguiente al vencimiento: "Mes vencido"', () => {
  const dueDate = '2026-08-10';
  const status = resolveMonthlyDueDateUrgency(dueDate, '2026-08-11');
  assertEqual(status.urgency, 'mes_vencido', 'un día después: vencido');
  assertEqual(status.daysOverdue, 1, 'un día de atraso');
  assertEqual(isChargeOverdueForDisplay('mensual', dueDate, 'on_time', '2026-08-11'), true, 'necesita atención en todos los consumidores');
});

// ---------------------------------------------------------------------------
// 5) Día 10 en fin de semana: se ajusta al siguiente día hábil.
// ---------------------------------------------------------------------------
test('día 10 en domingo: el vencimiento se ajusta al siguiente día hábil (lunes), sin calendarios externos', () => {
  // Mayo 2026: el 9 de mayo es sábado (doomsday 5/9) → el 10 es domingo.
  assertEqual(isWeekendDateKey('2026-05-10'), true, 'el 10 de mayo de 2026 es domingo');
  assertEqual(nextBusinessDay('2026-05-10'), '2026-05-11', 'se corre al lunes 11');
  assertEqual(resolveMonthlyDueDate('2026-05', 10), '2026-05-11', 'el vencimiento real de mayo queda en el lunes 11');
});

test('día 10 en sábado: el vencimiento se ajusta al lunes siguiente', () => {
  // Agosto 2026: el 8 de agosto es sábado (doomsday 8/8).
  assertEqual(isWeekendDateKey('2026-08-08'), true, 'el 8 de agosto de 2026 es sábado');
  assertEqual(resolveMonthlyDueDate('2026-08', 8), '2026-08-10', 'un dueDay que cae sábado se corre al lunes');
});

// ---------------------------------------------------------------------------
// 6) Cambio de mes y año.
// ---------------------------------------------------------------------------
test('cambio de mes: julio y agosto resuelven cada uno su propio vencimiento, sin arrastrar nada', () => {
  assertEqual(resolveMonthlyDueDate('2026-07', 10), '2026-07-10', 'julio: vencimiento propio');
  assertEqual(resolveMonthlyDueDate('2026-08', 10), '2026-08-10', 'agosto: vencimiento propio');
});

test('cambio de año: diciembre 2026 -> enero 2027 resuelve el vencimiento correcto, sin desbordar', () => {
  assertEqual(resolveMonthlyDueDate('2026-12', 10), '2026-12-10', 'diciembre 2026');
  // El 10 de enero de 2027 cae domingo: se ajusta al lunes 11, mismo criterio de días hábiles.
  assertEqual(resolveMonthlyDueDate('2027-01', 10), '2027-01-11', 'enero 2027, año nuevo, ajustado por caer domingo');
  assertEqual(billingPeriodOfDateKey('2027-01-10'), '2027-01', 'el período de enero 2027 se resuelve bien cruzando el año');

  const status = resolveStudentMonthlyCardStatus({
    plan: planDueDay10,
    charges: [],
    chargeStates: [],
    evaluationDate: '2027-01-05',
  });
  assertEqual(status.status, 'pendiente_en_termino', 'enero 2027: sigue funcionando igual que cualquier otro mes');
  assertEqual(status.label, 'Enero pendiente', 'nombre del mes correcto cruzando el año');
});

// ---------------------------------------------------------------------------
// 7) Alumno inactivo: la tarjeta del perfil muestra "No aplica".
// ---------------------------------------------------------------------------
test('alumno inactivo: la tarjeta de pago muestra "No aplica", nunca un estado de pago corriente', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 'qa_vto_inactivo', billingPeriod: '2026-08', dueDate: '2026-08-10' });
  (['pausado', 'inactivo', 'archivado'] as const).forEach((status) => {
    const result = resolveStudentMonthlyCardStatus({
      plan: planDueDay10,
      charges: [charge],
      chargeStates: [
        {
          chargeId: charge.id,
          studentId: charge.studentId,
          originalAmount: 20000,
          surchargeAmount: 0,
          totalDue: 20000,
          paidAmount: 0,
          balance: 20000,
          stage: 'last_late',
          settledAt: null,
          isSurchargeWaived: false,
          isNotYetDue: false,
        },
      ],
      evaluationDate: '2026-09-15',
      status,
    });
    assertEqual(result.status, 'no_aplica', `estado ${status}: nunca un estado de pago corriente`);
    assertEqual(result.label, 'No aplica', `estado ${status}: texto exacto pedido`);
    assertEqual(result.balance, 0, `estado ${status}: la tarjeta corriente no expone saldo (la deuda histórica vive aparte)`);
  });
});

// ---------------------------------------------------------------------------
// 8) Deuda histórica de un alumno inactivo se preserva íntegra.
// ---------------------------------------------------------------------------
test('alumno inactivo: la deuda histórica real se conserva íntegra en el historial financiero (nunca se borra ni se perdona)', () => {
  const unpaidCharge = monthlyCharge({ id: 'c-agosto', studentId: 'qa_vto_baja', billingPeriod: '2026-08', dueDate: '2026-08-10', originalAmount: 20000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [unpaidCharge] };

  // evaluationDate 2 días después del vencimiento: ya "Mes vencido" para
  // mostrar/contar, pero todavía dentro de la ventana de gracia del RECARGO
  // (independiente) — así el saldo se mantiene igual al importe original,
  // sin mezclar esta prueba con la magnitud del recargo acumulado.
  // Independiente de que el alumno esté inactivo AHORA — `summarizeOverdueDebt`
  // y `buildStudentPaymentsSummary` nunca reciben ni consultan el estado del
  // alumno: sólo cargos/pagos reales. Ver alumnos inactivos.
  const summary = buildStudentPaymentsSummary({ studentId: 'qa_vto_baja', state, evaluationDate: '2026-08-12' });
  assertEqual(summary.chargeStates[0].balance, 20000, 'la deuda real de agosto sigue intacta, sin perdonarse');
  assertEqual(summary.overdueBalance, 20000, 'sigue contando como vencida en el historial financiero');

  const debt = summarizeOverdueDebt({ charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-12' });
  assertEqual(debt.count, 1, 'la obligación vencida real sigue detectándose');
  assertEqual(debt.label, 'Agosto vencido', 'nombra el mes real de la deuda histórica');
});

// ---------------------------------------------------------------------------
// 9) No se generan mensualidades posteriores a la fecha efectiva de baja.
// ---------------------------------------------------------------------------
test('alumno dado de baja: no se generan mensualidades de períodos posteriores a la baja', () => {
  assertEqual(
    isStudentBillableForPeriod({ status: 'inactivo', statusChangeDate: '2026-08-02', billingPeriod: '2026-08' }),
    true,
    'el propio período de la baja sigue siendo facturable (pudo tener actividad real antes de la baja)'
  );
  assertEqual(
    isStudentBillableForPeriod({ status: 'inactivo', statusChangeDate: '2026-08-02', billingPeriod: '2026-09' }),
    false,
    'el mes siguiente a la baja nunca se factura'
  );
  assertEqual(
    isStudentBillableForPeriod({ status: 'inactivo', statusChangeDate: '2026-08-02', billingPeriod: '2026-07' }),
    true,
    'los períodos anteriores a la baja, siempre facturables'
  );
  assertEqual(
    isStudentBillableForPeriod({ status: 'inactivo', statusChangeDate: null, billingPeriod: '2026-08' }),
    false,
    'sin fecha de baja conocida: nunca facturar de más, por seguridad'
  );

  const candidates = selectMonthlyChargeCandidates({
    students: [{ id: 'qa_vto_baja2', status: 'inactivo', statusChangeDate: '2026-08-02' }],
    resolvePlan: () => planDueDay10,
    billingPeriod: '2026-09',
  });
  assertEqual(candidates.length, 0, 'setiembre: el alumno dado de baja en agosto no es candidato');

  const plan = planMonthlyChargeGeneration({
    candidates: selectMonthlyChargeCandidates({
      students: [{ id: 'qa_vto_baja2', status: 'inactivo', statusChangeDate: '2026-08-02' }],
      resolvePlan: () => planDueDay10,
      billingPeriod: '2026-09',
    }),
    existingCharges: [],
    billingPeriod: '2026-09',
    createdAt: '2026-09-01T09:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 0, 'ninguna mensualidad de septiembre para el alumno dado de baja en agosto');
});

// ---------------------------------------------------------------------------
// 10) Reactivación: vuelve a facturar sin duplicar cargos anteriores.
// ---------------------------------------------------------------------------
test('reactivación: vuelve a ser candidato de inmediato, sin duplicar el cargo del período que ya existía', () => {
  const reactivatedCandidates = selectMonthlyChargeCandidates({
    students: [{ id: 'qa_vto_reactivado', status: 'activo', statusChangeDate: '2026-10-01' }],
    resolvePlan: () => planDueDay10,
    billingPeriod: '2026-10',
  });
  assertEqual(reactivatedCandidates.length, 1, 'alumno reactivado: vuelve a ser candidato de inmediato');

  const existingCharge = monthlyCharge({
    id: buildMonthlyChargeId('qa_vto_reactivado', '2026-10'),
    studentId: 'qa_vto_reactivado',
    billingPeriod: '2026-10',
    dueDate: '2026-10-10',
  });
  const plan = planMonthlyChargeGeneration({
    candidates: reactivatedCandidates,
    existingCharges: [existingCharge],
    billingPeriod: '2026-10',
    createdAt: '2026-10-15T09:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 0, 'ya existía el cargo de octubre: no se duplica al reactivar');
});

// ---------------------------------------------------------------------------
// 11) Reparación de mensualidades creadas con la regla vieja (vencimiento día 1).
// ---------------------------------------------------------------------------
// Corrección 2026-10-04 (a pedido de Joaquín — guardas finales): la reparación SÓLO corrige cuando la incorporación es
// conocida (decisión guardada), es el primer período y no hay pagos ni asignaciones. Sin decisión: byte-idéntico + evidencia.
test('reparación: una mensualidad con la regla vieja (día 1) SIN decisión de incorporación queda byte-idéntica con evidencia; CON decisión (primer período, sin pagos) se corrige al global', () => {
  const buggyCharge = monthlyCharge({
    id: 'c-bug',
    studentId: 'qa_vto_reparar',
    billingPeriod: '2026-09',
    dueDate: firstDayOfBillingPeriod('2026-09'),
    originalAmount: 20000,
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [buggyCharge] };

  const withoutDecision = planMonthlyDueDateRepair({ state, resolvePlan: () => planDueDay10 });
  assertEqual(withoutDecision.actions.length, 0, 'sin decisión de incorporación no se toca');
  assertEqual(withoutDecision.updatedCharges[0].dueDate, '2026-09-01', 'byte-idéntico: conserva el día 1');
  assertEqual(withoutDecision.reviewNeeded[0]?.reason, 'sin_decision', 'queda evidencia para revisión');

  const joinDates = new Map([['c-bug', '2026-09-01']]);
  const firstRun = planMonthlyDueDateRepair({ state, resolvePlan: () => planDueDay10, firstPeriodJoinDateByChargeId: joinDates });
  assertEqual(firstRun.actions.length, 1, 'con incorporación conocida (primer período, sin pagos) sí se corrige');
  assertEqual(firstRun.actions[0].previousDueDate, '2026-09-01', 'vencimiento anterior: día 1');
  assertEqual(firstRun.actions[0].newDueDate, '2026-09-10', 'vencimiento corregido: global (día 10)');
  assertEqual(firstRun.updatedCharges[0].originalAmount, 20000, 'nunca toca originalAmount');

  const secondRun = planMonthlyDueDateRepair({
    state: { ...state, charges: firstRun.updatedCharges },
    resolvePlan: () => planDueDay10,
    firstPeriodJoinDateByChargeId: joinDates,
  });
  assertEqual(secondRun.actions.length, 0, 'idempotente: correr de nuevo no vuelve a tocar nada');
  assertEqual(secondRun.updatedCharges[0].dueDate, '2026-09-10', 'el vencimiento corregido sobrevive una segunda corrida');
});

// ---------------------------------------------------------------------------
// 12) Regla global: cualquier vencimiento mensual distinto del día 10 se
// corrige, sin importar de qué "regla vieja" provenga — ya no existen
// vencimientos individuales válidos. Reemplaza por completo la prueba
// anterior (que preservaba cualquier vencimiento distinto del día 1).
// ---------------------------------------------------------------------------
// Corrección 2026-10-04 (a pedido de Joaquín): la reparación sólo ADELANTA un vencimiento (día 1/día 5 → día 10). Un vencimiento
// POSTERIOR al global (día 15) sin decisión guardada ya NO se lleva hacia atrás: se conserva y queda para revisión.
test('reparación: sin decisión de incorporación NINGÚN vencimiento se mueve (día 1, día 5 ni día 15): byte-idénticos, con evidencia para revisión', () => {
  const day1Charge = monthlyCharge({
    id: 'c-dia1', studentId: 'qa_vto_dia1', billingPeriod: '2026-09', dueDate: firstDayOfBillingPeriod('2026-09'), originalAmount: 20000,
  });
  const day5Charge = monthlyCharge({
    id: 'c-dia5', studentId: 'qa_vto_dia5', billingPeriod: '2026-09', dueDate: '2026-09-05', originalAmount: 20000,
  });
  const day15Charge = monthlyCharge({
    id: 'c-dia15', studentId: 'qa_vto_dia15', billingPeriod: '2026-09', dueDate: '2026-09-15', originalAmount: 20000,
  });
  const alreadyCorrectCharge = monthlyCharge({
    id: 'c-dia10', studentId: 'qa_vto_dia10', billingPeriod: '2026-09', dueDate: '2026-09-10', originalAmount: 20000,
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [day1Charge, day5Charge, day15Charge, alreadyCorrectCharge] };

  const plan = planMonthlyDueDateRepair({ state });
  assertEqual(plan.actions.length, 0, 'sin incorporación confiable no se corrige ninguno');
  assertEqual(plan.updatedCharges.find((c) => c.id === 'c-dia1')!.dueDate, '2026-09-01', 'día 1: se conserva');
  assertEqual(plan.updatedCharges.find((c) => c.id === 'c-dia5')!.dueDate, '2026-09-05', 'día 5: se conserva');
  assertEqual(plan.updatedCharges.find((c) => c.id === 'c-dia15')!.dueDate, '2026-09-15', 'día 15: se conserva');
  assertEqual(JSON.stringify(plan.updatedCharges), JSON.stringify(state.charges), 'todos byte-idénticos');
  assertEqual(plan.reviewNeeded.length, 3, 'los tres quedan como evidencia para revisión (el que ya coincide con el día 10 no)');
  assert(plan.reviewNeeded.every((item) => item.reason === 'sin_decision'), 'motivo: no hay fecha de incorporación guardada');
  assertEqual(plan.updatedCharges.find((c) => c.id === 'c-dia10')!.dueDate, '2026-09-10', 'ya estaba correcto: sin cambios');
  assertEqual(plan.actions.find((a) => a.chargeId === 'c-dia10'), undefined, 'el cargo ya correcto nunca genera una acción');

  const secondRun = planMonthlyDueDateRepair({ state: { ...state, charges: plan.updatedCharges } });
  assertEqual(secondRun.actions.length, 0, 'segunda reparación: idempotente, cero cambios');
});

test('reparación P0 2026-09-05: una clase suelta (por_clase) con vencimiento día 5 permanece intacta — la regla es exclusiva de mensualidades', () => {
  const perClassCharge: PaymentCharge = {
    id: 'c-suelta', studentId: 'qa_vto_suelta', type: 'por_clase', originalAmount: 9000, currency: 'ARS',
    dueDate: '2026-09-05', createdAt: '2026-09-01T09:00:00.000Z', voidedAt: null, voidReason: null,
  };
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [perClassCharge] };
  const plan = planMonthlyDueDateRepair({ state });
  assertEqual(plan.actions.length, 0, 'una clase suelta nunca se toca');
  assertEqual(plan.updatedCharges[0].dueDate, '2026-09-05', 'su vencimiento propio permanece intacto');
});

test('reparación P0 2026-09-05: un paquete de clases con vencimiento día 5 permanece intacto', () => {
  const packageCharge: PaymentCharge = {
    id: 'c-paquete', studentId: 'qa_vto_paquete', type: 'paquete', originalAmount: 40000, currency: 'ARS',
    dueDate: '2026-09-05', createdAt: '2026-09-01T09:00:00.000Z', voidedAt: null, voidReason: null,
  };
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [packageCharge] };
  const plan = planMonthlyDueDateRepair({ state });
  assertEqual(plan.actions.length, 0, 'un paquete nunca se toca');
  assertEqual(plan.updatedCharges[0].dueDate, '2026-09-05', 'su vencimiento propio permanece intacto');
});

test('reparación P0 2026-09-05: un cargo mensual de un período anterior YA SALDADO por completo, con vencimiento distinto del día 10, nunca se reescribe', () => {
  const settledPastCharge = monthlyCharge({
    id: 'c-saldado-julio', studentId: 'qa_vto_saldado', billingPeriod: '2026-07', dueDate: '2026-07-05', originalAmount: 20000,
  });
  const payment = {
    id: 'p-saldado', studentId: 'qa_vto_saldado', amount: 20000, currency: 'ARS' as const, method: 'efectivo' as const,
    paidAt: '2026-07-06', recordedAt: '2026-07-06T09:00:00.000Z', voidedAt: null, voidReason: null,
  };
  const allocation = { id: 'a-saldado', paymentId: 'p-saldado', chargeId: 'c-saldado-julio', studentId: 'qa_vto_saldado', amount: 20000 };
  const state: PaymentsRepositoryState = { charges: [settledPastCharge], payments: [payment], allocations: [allocation], adjustments: [] };

  const plan = planMonthlyDueDateRepair({ state });
  assertEqual(plan.actions.length, 0, 'un cargo ya saldado por completo nunca se reescribe, sin importar su vencimiento histórico');
  assertEqual(plan.updatedCharges[0].dueDate, '2026-07-05', 'conserva su vencimiento histórico tal cual quedó registrado');
});

// ---------------------------------------------------------------------------
// 13) Pagos y asignaciones byte a byte intactos tras la reparación.
// ---------------------------------------------------------------------------
test('reparación: nunca toca pagos, asignaciones ni cargos anulados/no mensuales', () => {
  const buggyCharge = monthlyCharge({
    id: 'c-bug2',
    studentId: 'qa_vto_intacto',
    billingPeriod: '2026-09',
    dueDate: firstDayOfBillingPeriod('2026-09'),
    originalAmount: 20000,
  });
  const voidedBuggyCharge = monthlyCharge({
    id: 'c-anulado',
    studentId: 'qa_vto_intacto',
    billingPeriod: '2026-06',
    dueDate: firstDayOfBillingPeriod('2026-06'),
    originalAmount: 20000,
    voidedAt: '2026-06-20T00:00:00.000Z',
    voidReason: 'Cargo duplicado',
  });
  const perClassCharge: PaymentCharge = {
    id: 'c-clase',
    studentId: 'qa_vto_intacto',
    type: 'por_clase',
    originalAmount: 9000,
    currency: 'ARS',
    dueDate: firstDayOfBillingPeriod('2026-09'),
    createdAt: '2026-09-01T09:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const payment = {
    id: 'p1',
    studentId: 'qa_vto_intacto',
    amount: 5000,
    currency: 'ARS' as const,
    method: 'efectivo' as const,
    paidAt: '2026-09-03',
    recordedAt: '2026-09-03T09:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const allocation = { id: 'a1', paymentId: 'p1', chargeId: 'c-bug2', studentId: 'qa_vto_intacto', amount: 5000 };
  const state: PaymentsRepositoryState = {
    charges: [buggyCharge, voidedBuggyCharge, perClassCharge],
    payments: [payment],
    allocations: [allocation],
    adjustments: [],
  };

  const plan = planMonthlyDueDateRepair({ state, resolvePlan: () => planDueDay10, firstPeriodJoinDateByChargeId: new Map([['c-bug2', '2026-09-01']]) });
  assertEqual(plan.actions.length, 0, 'un cargo con un pago parcial real NUNCA se toca, aunque su incorporación sea conocida');
  assertEqual(plan.reviewNeeded.length, 1, 'queda como evidencia para revisión');
  assertEqual(plan.reviewNeeded[0].reason, 'con_pagos', 'motivo: tiene pagos');
  assertEqual(plan.updatedCharges.find((c) => c.id === 'c-bug2')!.dueDate, firstDayOfBillingPeriod('2026-09'), 'el cargo con pagos queda byte-idéntico');

  assert(plan.updatedCharges.find((c) => c.id === 'c-anulado')!.dueDate === firstDayOfBillingPeriod('2026-06'), 'un cargo anulado nunca se reabre ni se toca');
  assert(plan.updatedCharges.find((c) => c.id === 'c-clase')!.dueDate === firstDayOfBillingPeriod('2026-09'), 'un cargo por clase nunca se toca');

  assertEqual(state.payments[0], payment, 'el pago real permanece byte a byte intacto');
  assertEqual(state.allocations[0], allocation, 'la asignación real permanece byte a byte intacta');
});

// ---------------------------------------------------------------------------
// 14) Consistencia entre Home, Centro de cobros y perfil.
// ---------------------------------------------------------------------------
test('consistencia: Home, Centro de cobros y el perfil coinciden en si una mensualidad está vencida o no', () => {
  const dueDate = '2026-08-10';
  const charge = monthlyCharge({ id: 'c-consist', studentId: 'qa_vto_consistencia', billingPeriod: '2026-08', dueDate, originalAmount: 20000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };

  // Antes del vencimiento (día 5): ninguno de los tres debe mostrar "vencido".
  const earlyDate = '2026-08-05';
  const earlyProfile = resolveStudentMonthlyCardStatus({ plan: planDueDay10, charges: [charge], chargeStates: [calculateStateOnTime(charge)], evaluationDate: earlyDate });
  const earlyCollections = buildCollectionsCenterEntries({ state, evaluationDate: earlyDate });
  const earlyHome = buildHomeFinancialSummary({ state, evaluationDate: earlyDate });
  assertEqual(earlyProfile.status, 'pendiente_en_termino', 'perfil: en término antes del vencimiento');
  assertEqual(earlyCollections.length, 0, 'Centro de cobros: nada que atender antes del vencimiento');
  assertEqual(earlyHome.overdueBalance, 0, 'Home: sin saldo vencido antes del vencimiento');
  assertEqual(earlyHome.pendingOnTimeBalance, 20000, 'Home: todo el saldo cuenta como pendiente en término');

  // Después del vencimiento (día 15): los tres deben coincidir en "vencido".
  const lateDate = '2026-08-15';
  const lateProfile = resolveStudentMonthlyCardStatus({ plan: planDueDay10, charges: [charge], chargeStates: [calculateStateOnTime(charge)], evaluationDate: lateDate });
  const lateCollections = buildCollectionsCenterEntries({ state, evaluationDate: lateDate });
  const lateHome = buildHomeFinancialSummary({ state, evaluationDate: lateDate });
  assert(lateProfile.status !== 'pendiente_en_termino' && lateProfile.status !== 'vence_pronto', 'perfil: ya no está en término después del vencimiento');
  assertEqual(lateCollections.length, 1, 'Centro de cobros: aparece necesitando atención después del vencimiento');
  assertEqual(lateHome.overdueBalance, 20000, 'Home: el saldo pasa a vencido después del vencimiento');
  assertEqual(lateHome.pendingOnTimeBalance, 0, 'Home: ya no cuenta como pendiente en término');
});

function calculateStateOnTime(charge: PaymentCharge) {
  return {
    chargeId: charge.id,
    studentId: charge.studentId,
    originalAmount: charge.originalAmount,
    surchargeAmount: 0,
    totalDue: charge.originalAmount,
    paidAmount: 0,
    balance: charge.originalAmount,
    stage: 'on_time' as const,
    settledAt: null,
    isSurchargeWaived: false,
    isNotYetDue: false,
  };
}
