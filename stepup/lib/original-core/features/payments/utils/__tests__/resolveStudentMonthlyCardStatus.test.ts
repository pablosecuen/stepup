// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/resolveStudentMonthlyCardStatus.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { resolveStudentMonthlyCardStatus } from '../monthlyPeriodStatus.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y
// tarjetas de Alumnos): estos tests cubren los 9 casos de aceptación
// obligatorios del pedido, con fecha de evaluación SIEMPRE inyectada
// (nunca el reloj real del dispositivo), sobre `resolveStudentMonthlyCardStatus`
// — la función que alimenta la tarjeta de la lista de Alumnos.

const monthlyPlan: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 1 };

function augustCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge_mensual_s1_2026-08',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-08-01',
    createdAt: '2026-08-01T09:00:00.000Z',
    billingPeriod: '2026-08',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

// Caso 1: 1° de agosto (sábado), sin pagar, cargo TODAVÍA no generado —
// pendiente en término, sin recargo, nunca "Al día"/"Vencido".
test('1. 1° de agosto sin cargo generado todavía: "Agosto pendiente", sin recargo', () => {
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-08-01',
  });
  assertEqual(result.status, 'pendiente_en_termino', 'día 1 nunca es "Al día" ni "Vencido"');
  assertEqual(result.label, 'Agosto pendiente', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusPendiente', 'nunca verde/rojo/amarillo en término');
  assertEqual(result.balance, 0, 'sin recargo/mora en término');
});

// Caso 1b: mismo día, pero el cargo YA fue generado (el motor corrió) —
// debe seguir sin recargo, mismo texto.
test('1b. 1° de agosto con cargo ya generado (stage on_time): sigue "Agosto pendiente", sin recargo', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-01',
  });
  assertEqual(result.status, 'pendiente_en_termino', 'día 1 con cargo generado sigue en término');
  assertEqual(result.label, 'Agosto pendiente', 'texto exacto pedido');
  assertEqual(chargeState.stage, 'on_time', 'sin mora todavía');
  assertEqual(result.balance, 20000, 'debe el importe original, sin recargo agregado');
});

// Caso 2: este plan tiene `dueDay: 1` (vencimiento real el 1° de agosto) —
// el 10 de agosto sigue dentro de la ventana de gracia del RECARGO
// (`graceDay: 10`, cuenta desde `dueDate`), pero el vencimiento real ya
// pasó hace 9 días. Corrección 2026-09-02 (a pedido de Joaquín — ERROR
// FINANCIERO: mensualidades "Mes vencido" al comenzar el mes): el estado
// mostrado ya no se decide con la etapa de recargo sino con el vencimiento
// real (`resolveMonthlyDueDateUrgency`) — "Mes vencido" aunque todavía no
// haya recargo agregado (esa es la etapa de mora, independiente).
test('2. 10 de agosto con vencimiento real el 1°: "Mes vencido" aunque el recargo todavía no se aplicó', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-10',
  });
  assertEqual(chargeState.stage, 'on_time', 'el recargo sigue en su propia ventana de gracia (independiente)');
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-10',
  });
  assertEqual(result.status, 'vencido_sin_recargo', 'vencimiento real ya pasado: necesita atención');
  assertEqual(result.label, 'Mes vencido', 'nunca "Agosto pendiente" pasado el vencimiento real');
  assertEqual(result.colorKey, 'statusRojo', 'vencido, nunca el color de "en término"');
  assertEqual(result.balance, 20000, 'sin recargo agregado todavía: la etapa de mora es independiente');
});

// Caso 3: 11 de agosto sin pagar — primer vencimiento, recargo del 10%
// aplicado una sola vez sobre el importe original.
test('3. 11 de agosto sin pagar: "Mes vencido" genérico, sin recargo automático (mora real internamente sigue siendo first_late)', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-11',
  });
  assertEqual(chargeState.stage, 'first_late', 'el día 11 entra en el primer vencimiento (mora real, uso interno)');
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-11',
  });
  assertEqual(result.status, 'vencido_sin_recargo', 'sin recargos automáticos: siempre "Mes vencido" genérico, nunca primer/segundo/último vencimiento');
  assertEqual(result.label, 'Mes vencido', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusRojo', 'color genérico de vencido');
  assertEqual(result.balance, 20000, '20000, sin recargo');
});

// Segundo y último vencimiento (parte de los 10 estados obligatorios,
// aunque no estén en la lista numerada de 9 casos de aceptación).
test('3b. 19 de agosto sin pagar: "Mes vencido" genérico, sin recargo automático (mora real internamente sigue siendo second_late)', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-19',
  });
  assertEqual(chargeState.stage, 'second_late', 'el día 19 entra en el segundo vencimiento (mora real, uso interno)');
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-19',
  });
  assertEqual(result.status, 'vencido_sin_recargo', 'sin recargos automáticos: siempre "Mes vencido" genérico');
  assertEqual(result.label, 'Mes vencido', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusRojo', 'color genérico de vencido');
  assertEqual(result.balance, 20000, '20000, sin recargo');
});

test('3c. 27 de agosto sin pagar: "Mes vencido" genérico, sin recargo automático (mora real internamente sigue siendo last_late)', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-27',
  });
  assertEqual(chargeState.stage, 'last_late', 'el día 27 entra en el último vencimiento (mora real, uso interno)');
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-27',
  });
  assertEqual(result.status, 'vencido_sin_recargo', 'sin recargos automáticos: siempre "Mes vencido" genérico');
  assertEqual(result.label, 'Mes vencido', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusRojo', 'color genérico de vencido');
  assertEqual(result.balance, 20000, '20000, sin recargo');
});

// Caso 4: pago completo dentro del término — "Agosto pagado", verde, saldo $0.
test('4. Pago completo en término: "Agosto pagado", verde, saldo $0', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [{ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 20000 }],
    payments: [
      {
        id: 'p1',
        studentId: 's1',
        amount: 20000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-08-05',
        recordedAt: '2026-08-05T09:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    adjustments: [],
    evaluationDate: '2026-08-05',
  });
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-05',
  });
  assertEqual(result.status, 'pagado', 'saldo cero: pagado');
  assertEqual(result.label, 'Agosto pagado', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusVerde', 'verde sólo cuando está realmente pagado');
  assertEqual(result.balance, 0, 'sin saldo pendiente');
});

// Caso 5: pago parcial — "Pago parcial" + saldo, coloreado según la etapa.
test('5. Pago parcial en primer vencimiento (mora real): "Pago parcial", saldo visible sin recargo, color genérico rojo', () => {
  const charge = augustCharge();
  const chargeState = calculateChargeState({
    charge,
    allocations: [{ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 8000 }],
    payments: [
      {
        id: 'p1',
        studentId: 's1',
        amount: 8000,
        currency: 'ARS',
        method: 'efectivo',
        paidAt: '2026-08-12',
        recordedAt: '2026-08-12T09:00:00.000Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
    adjustments: [],
    evaluationDate: '2026-08-12',
  });
  assertEqual(chargeState.stage, 'first_late', 'evaluado el día 12, en primer vencimiento');
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [charge],
    chargeStates: [chargeState],
    evaluationDate: '2026-08-12',
  });
  assertEqual(result.status, 'pago_parcial', 'pagó parte, todavía debe el resto');
  assertEqual(result.label, 'Pago parcial', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusRojo', 'sin recargos automáticos, el color de "Pago parcial" es siempre rojo genérico, nunca por etapa');
  assertEqual(result.balance, 12000, '20000 (sin recargo) - 8000 pagados');
});

// Caso 6: deuda de julio no pagada + agosto que arranca — la función sólo
// informa el período ACTUAL (agosto); julio no debe "contaminar" ni
// "tapar" el estado de agosto (el arrastre de julio lo cubre el badge de
// "Pago vencido" ya existente, que agrega TODOS los períodos).
test('6. Cargo de julio impago no altera el estado de agosto: julio se ignora, agosto se evalúa solo', () => {
  const julyCharge: PaymentCharge = {
    id: 'charge_mensual_s1_2026-07',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T09:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
  };
  const julyState = calculateChargeState({
    charge: julyCharge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  const augustChargeObj = augustCharge();
  const augustState = calculateChargeState({
    charge: augustChargeObj,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [julyCharge, augustChargeObj],
    chargeStates: [julyState, augustState],
    evaluationDate: '2026-08-01', // vencimiento real de agosto (dueDay: 1): "vence hoy", todavía en término
  });
  assertEqual(result.billingPeriod, '2026-08', 'evalúa el período actual, agosto');
  assertEqual(result.status, 'pendiente_en_termino', 'agosto sigue en término aunque julio esté impago');
  assertEqual(result.label, 'Agosto pendiente', 'julio no debe aparecer en el texto de agosto');
});

// Caso 8: alumno que arranca en septiembre — "Comienza en septiembre",
// nunca moroso ni pagado.
test('8. Alumno con startPeriod en septiembre, evaluado en agosto: "Comienza en septiembre"', () => {
  const result = resolveStudentMonthlyCardStatus({
    plan: { ...monthlyPlan, startPeriod: '2026-09' },
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-08-15',
  });
  assertEqual(result.status, 'comienza_proximo_mes', 'todavía no debe pagar agosto');
  assertEqual(result.label, 'Comienza en septiembre', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusSinDatos', 'ni moroso ni pagado');
  assertEqual(result.balance, 0, 'no tiene obligación vigente todavía');
});

// Plan sin mensualidad: debe mostrar la descripción real del plan, no un
// estado financiero mensual inventado.
test('9. Plan no mensual (por clase): muestra la descripción real del plan', () => {
  const result = resolveStudentMonthlyCardStatus({
    plan: { type: 'per_class', amount: 5000 },
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-08-15',
  });
  assertEqual(result.status, 'sin_plan_mensual', 'no tiene mensualidad');
  assertEqual(result.label, 'Por clase', 'descripción real del plan, no un estado financiero inventado');
  assertEqual(result.colorKey, 'statusSinDatos', 'gris, ni moroso ni pagado');
});

// Cargo vencido pero todavía no generado (caso límite: el motor de
// generación no corrió a tiempo) — debe pedir generación inmediata, nunca
// mostrar "vencido" sin un cargo real detrás.
test('Cargo mensual atrasado que todavía no fue generado: pide generación inmediata', () => {
  const result = resolveStudentMonthlyCardStatus({
    plan: monthlyPlan,
    charges: [],
    chargeStates: [],
    evaluationDate: '2026-08-15',
  });
  assertEqual(result.status, 'cargo_pendiente_generar', 'sin cargo generado y ya pasado el término');
  assertEqual(result.label, 'Cargo pendiente de generar', 'texto exacto pedido');
  assertEqual(result.colorKey, 'statusSinDatos', 'nunca "vencido" sin un cargo real detrás');
});
