// Puerto VERBATIM del original (`src/features/payments/services/__tests__/voidChargeService.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { voidChargeForStudent, type VoidChargeStoreDeps } from '../voidChargeService.ts';
import { recalculateAllChargeStates } from '../../utils/paymentCalculations.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge-1',
    studentId: 's1',
    type: 'entrenamiento',
    originalAmount: 80000,
    currency: 'ARS',
    dueDate: '2026-09-10',
    createdAt: '2026-09-01T00:00:00.000Z',
    billingPeriod: '2026-09',
    trainingBillingAgreementId: 'agreement-1',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

/** Controlador falso en memoria — mismo patrón que `VoidPaymentStoreDeps`/`RegisterPaymentStoreDeps`, sin tocar AsyncStorage real. */
function makeDeps(initial: PaymentsRepositoryState): VoidChargeStoreDeps & { getState: () => PaymentsRepositoryState } {
  let state = initial;
  return {
    hydrate: async () => state,
    applyMutation: async (updater) => {
      const next = updater(state);
      state = next;
      return state;
    },
    getState: () => state,
  };
}

// ---------------------------------------------------------------------------
// Problema 3 (reportado por Joaquín — ANULAR UN COBRO ERRÓNEO DESDE EL
// ALUMNO): el caso real es una obligación del 12/09 vinculada a una serie de
// entrenamiento mal configurada, pero estas pruebas nunca usan datos ni
// cuentas reales — sólo fixtures.
// ---------------------------------------------------------------------------

asyncTest('voidChargeForStudent: anula un cargo sin pagos asignados y desaparece del cálculo de saldos', async () => {
  const deps = makeDeps({ ...emptyState(), charges: [charge()] });
  await voidChargeForStudent({ chargeId: 'charge-1', reason: 'Serie de entrenamiento mal configurada' }, deps);

  const state = deps.getState();
  assertEqual(state.charges[0].voidedAt !== null, true, 'el cargo queda marcado como anulado');
  assertEqual(state.charges[0].voidReason, 'Serie de entrenamiento mal configurada', 'conserva el motivo');
  assertEqual(state.charges.length, 1, 'nunca se borra el registro — sigue existiendo, sólo anulado');

  const activeStates = recalculateAllChargeStates({
    charges: state.charges,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate: '2026-09-16',
  });
  assertEqual(activeStates.length, 0, 'un cargo anulado desaparece de pendientes/vencidos/totales/Centro de cobros (mismo filtro voidedAt === null que ya usa todo el motor)');
});

asyncTest('voidChargeForStudent: bloquea la anulación si el cargo tiene un pago vigente asignado (evita movimientos huérfanos)', async () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge()],
    payments: [
      {
        id: 'payment-1',
        studentId: 's1',
        amount: 40000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-09-05',
        recordedAt: '2026-09-05T12:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    allocations: [{ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 's1', amount: 40000 }],
  };
  const deps = makeDeps(state);

  let rejected = false;
  let message = '';
  try {
    await voidChargeForStudent({ chargeId: 'charge-1', reason: 'Serie mal configurada' }, deps);
  } catch (error) {
    rejected = true;
    message = error instanceof Error ? error.message : '';
  }
  assert(rejected, 'la anulación se rechaza mientras haya un pago vigente asignado');
  assert(message.includes('pagos asignados'), 'explica que primero hay que revertir los pagos');
  assertEqual(deps.getState().charges[0].voidedAt, null, 'el cargo NO queda anulado — no se guardó ningún cambio parcial');
});

asyncTest('voidChargeForStudent: un cargo con un pago YA anulado (revertido primero) sí puede anularse', async () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge()],
    payments: [
      {
        id: 'payment-1',
        studentId: 's1',
        amount: 40000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-09-05',
        recordedAt: '2026-09-05T12:00:00.000Z',
        voidedAt: '2026-09-15T00:00:00.000Z',
        voidReason: 'Pago revertido para poder anular el cobro',
      },
    ],
    allocations: [{ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 's1', amount: 40000 }],
  };
  const deps = makeDeps(state);
  await voidChargeForStudent({ chargeId: 'charge-1', reason: 'Serie mal configurada' }, deps);
  assert(deps.getState().charges[0].voidedAt !== null, 'con el pago ya anulado, el cargo sí se puede anular');
});

asyncTest('voidChargeForStudent: es idempotente — anular dos veces el mismo cargo rechaza la segunda vez, nunca duplica el efecto', async () => {
  const deps = makeDeps({ ...emptyState(), charges: [charge()] });
  await voidChargeForStudent({ chargeId: 'charge-1', reason: 'Primera anulación' }, deps);

  let rejectedSecondTime = false;
  try {
    await voidChargeForStudent({ chargeId: 'charge-1', reason: 'Segundo intento (doble toque)' }, deps);
  } catch {
    rejectedSecondTime = true;
  }
  assert(rejectedSecondTime, 'un segundo toque sobre el mismo cargo nunca lo "re-anula" ni afecta otra obligación');
  assertEqual(deps.getState().charges[0].voidReason, 'Primera anulación', 'el motivo original queda intacto, nunca sobrescrito por el reintento');
});

asyncTest('voidChargeForStudent: anular un cargo nunca afecta a otro cargo del mismo alumno', async () => {
  const deps = makeDeps({
    ...emptyState(),
    charges: [charge({ id: 'charge-1', originalAmount: 80000 }), charge({ id: 'charge-2', originalAmount: 27500, trainingBillingAgreementId: 'agreement-2' })],
  });
  await voidChargeForStudent({ chargeId: 'charge-1', reason: 'Serie mal configurada' }, deps);

  const state = deps.getState();
  assert(state.charges.find((item) => item.id === 'charge-1')!.voidedAt !== null, 'charge-1 anulado');
  assertEqual(state.charges.find((item) => item.id === 'charge-2')!.voidedAt, null, 'charge-2 queda completamente intacto');
});
