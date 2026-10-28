// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentTrafficLight.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState } from '../../types/index.ts';
import { deriveChargeTrafficLight, deriveWorstTrafficLight } from '../paymentTrafficLight.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function state(overrides: Partial<ChargeComputedState> = {}): ChargeComputedState {
  return {
    chargeId: 'charge-1',
    studentId: 's1',
    originalAmount: 10000,
    surchargeAmount: 0,
    totalDue: 10000,
    paidAmount: 0,
    balance: 10000,
    stage: 'on_time',
    settledAt: null,
    isSurchargeWaived: false,
    isNotYetDue: false,
    ...overrides,
  };
}

test('deriveChargeTrafficLight: sin deuda es siempre verde, sin importar la etapa', () => {
  assertEqual(deriveChargeTrafficLight(state({ balance: 0, stage: 'last_late' })), 'verde', 'saldada en último vencimiento igual da verde: ya no hay deuda');
  assertEqual(deriveChargeTrafficLight(state({ balance: -500, stage: 'second_late' })), 'verde', 'con crédito (sobrepago) también da verde');
});

test('deriveChargeTrafficLight: con deuda, colorea según la etapa vigente', () => {
  assertEqual(deriveChargeTrafficLight(state({ balance: 10000, stage: 'on_time' })), 'verde', 'en término');
  assertEqual(deriveChargeTrafficLight(state({ balance: 11000, stage: 'first_late' })), 'amarillo', 'primer vencimiento');
  assertEqual(deriveChargeTrafficLight(state({ balance: 11500, stage: 'second_late' })), 'naranja', 'segundo vencimiento');
  assertEqual(deriveChargeTrafficLight(state({ balance: 12000, stage: 'last_late' })), 'rojo', 'último vencimiento / deuda vencida');
});

test('deriveChargeTrafficLight: una obligación todavía no vencida da verde', () => {
  assertEqual(
    deriveChargeTrafficLight(state({ balance: 10000, stage: 'on_time', isNotYetDue: true })),
    'verde',
    'no vencida: el motor puro ya calcula stage on_time, da verde sin caso especial'
  );
});

test('deriveWorstTrafficLight: sin obligaciones es verde', () => {
  assertEqual(deriveWorstTrafficLight([]), 'verde', 'nada que deber');
});

test('deriveWorstTrafficLight: usa la peor situación entre varias obligaciones', () => {
  const states = [
    state({ chargeId: 'c1', balance: 0, stage: 'on_time' }), // verde
    state({ chargeId: 'c2', balance: 11000, stage: 'first_late' }), // amarillo
    state({ chargeId: 'c3', balance: 12000, stage: 'last_late' }), // rojo — la peor
  ];
  assertEqual(deriveWorstTrafficLight(states), 'rojo', 'el rojo de c3 domina sobre verde y amarillo');
});

test('deriveWorstTrafficLight: el resultado no depende del orden de las obligaciones', () => {
  const states = [
    state({ chargeId: 'c1', balance: 11500, stage: 'second_late' }), // naranja
    state({ chargeId: 'c2', balance: 0, stage: 'on_time' }), // verde
  ];
  assertEqual(deriveWorstTrafficLight(states), 'naranja', 'orden original');
  assertEqual(deriveWorstTrafficLight([...states].reverse()), 'naranja', 'orden invertido: mismo resultado');
});
