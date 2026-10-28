// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/monthlyChargeGenerationPlan.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { planMonthlyChargeGeneration, selectMonthlyChargeCandidates } from '../monthlyChargeGenerationPlan.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

test('genera la mensualidad del mes actual para un alumno activo mensual, usando el precio vigente', () => {
  const plan = planMonthlyChargeGeneration({
    candidates: [{ studentId: 's1', price: 20000 }],
    existingCharges: [],
    billingPeriod: '2026-07',
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 1, 'crea un cargo');
  assertEqual(plan.toCreate[0].studentId, 's1', 'para el alumno correcto');
  assertEqual(plan.toCreate[0].originalAmount, 20000, 'con el precio vigente del perfil');
  assertEqual(plan.toCreate[0].dueDate, '2026-07-10', 'vencimiento el día 10 del período (configuración por defecto de la profesora)');
  assertEqual(plan.toCreate[0].billingPeriod, '2026-07', 'período correcto');
  assertEqual(plan.skipped.length, 0, 'nadie se omite');
});

test('es idempotente: no duplica si el cargo del mes ya existe (abrir la app varias veces)', () => {
  const existing: PaymentCharge = {
    id: 'charge_mensual_s1_2026-07',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
  };
  const plan = planMonthlyChargeGeneration({
    candidates: [{ studentId: 's1', price: 20000 }],
    existingCharges: [existing],
    billingPeriod: '2026-07',
    createdAt: '2026-07-15T00:00:00.000Z', // "segunda apertura de la app" ese mismo mes
  });
  assertEqual(plan.toCreate.length, 0, 'no genera un segundo cargo para el mismo alumno y mes');
});

test('cambio de mes: abrir la app en agosto crea la nueva mensualidad sin tocar julio', () => {
  const julyCharge: PaymentCharge = {
    id: 'charge_mensual_s1_2026-07',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
  };
  const plan = planMonthlyChargeGeneration({
    candidates: [{ studentId: 's1', price: 20000 }],
    existingCharges: [julyCharge],
    billingPeriod: '2026-08',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 1, 'crea la mensualidad de agosto');
  assertEqual(plan.toCreate[0].billingPeriod, '2026-08', 'período de agosto');
  assertEqual(plan.toCreate[0].dueDate, '2026-08-10', 'vencimiento el día 10 de agosto (configuración por defecto de la profesora)');
  assert(
    plan.toCreate[0].id !== julyCharge.id,
    'el cargo de agosto tiene un id distinto al de julio: no lo reemplaza ni lo duplica'
  );
});

test('nunca genera meses anteriores: sólo crea para el billingPeriod recibido, no retroactivamente', () => {
  const plan = planMonthlyChargeGeneration({
    candidates: [{ studentId: 's1', price: 20000 }],
    existingCharges: [],
    billingPeriod: '2026-08',
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 1, 'sólo un cargo');
  assertEqual(plan.toCreate[0].billingPeriod, '2026-08', 'únicamente el mes recibido, nunca julio ni meses previos');
});

test('omite y reporta un precio inválido, sin crear un cargo en cero', () => {
  const plan = planMonthlyChargeGeneration({
    candidates: [
      { studentId: 's1', price: 0 },
      { studentId: 's2', price: -100 },
      { studentId: 's3', price: NaN },
      { studentId: 's4', price: 15000 },
    ],
    existingCharges: [],
    billingPeriod: '2026-07',
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 1, 'sólo s4 tiene precio válido');
  assertEqual(plan.toCreate[0].studentId, 's4', 'el único cargo creado es el de s4');
  assertEqual(plan.skipped.length, 3, 's1, s2 y s3 se omiten');
  assert(
    plan.skipped.every((item) => item.reason === 'precio_invalido'),
    'todos se reportan con el mismo motivo'
  );
  assert(
    !plan.toCreate.some((charge) => charge.originalAmount === 0),
    'nunca se crea un cargo con importe cero'
  );
});

test('un alumno con billingType por_clase nunca debe pasarse como candidato mensual (filtrado antes, no acá)', () => {
  // planMonthlyChargeGeneration confía en que el llamador ya filtró por
  // billingType === 'mensual'; esta prueba documenta ese contrato: sin
  // candidatos, no genera nada.
  const plan = planMonthlyChargeGeneration({
    candidates: [],
    existingCharges: [],
    billingPeriod: '2026-07',
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 0, 'sin candidatos mensuales, no se crea nada');
});

test('no muta candidates ni existingCharges recibidos', () => {
  const candidates = [{ studentId: 's1', price: 20000 }];
  const existingCharges: PaymentCharge[] = [];
  const candidatesSnapshot = JSON.stringify(candidates);
  const existingSnapshot = JSON.stringify(existingCharges);
  planMonthlyChargeGeneration({ candidates, existingCharges, billingPeriod: '2026-07', createdAt: '2026-07-01T00:00:00.000Z' });
  assertEqual(JSON.stringify(candidates), candidatesSnapshot, 'candidates no cambia');
  assertEqual(JSON.stringify(existingCharges), existingSnapshot, 'existingCharges no cambia');
});

// ---------------------------------------------------------------------------
// selectMonthlyChargeCandidates — corrección 2026-07-26 (ciclo mensual de
// cobros): quién es candidato a mensualidad de un período dado.
// ---------------------------------------------------------------------------

const monthlyPlan = (overrides: Partial<StudentBillingPlan & { type: 'monthly' }> = {}): StudentBillingPlan => ({
  type: 'monthly',
  amount: 20000,
  dueDay: 1,
  ...overrides,
});

test('selectMonthlyChargeCandidates: un alumno archivado nunca es candidato, aunque su plan sea mensual', () => {
  const candidates = selectMonthlyChargeCandidates({
    students: [{ id: 's1', status: 'archivado' }],
    resolvePlan: () => monthlyPlan(),
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'un alumno archivado no genera mensualidad');
});

test('selectMonthlyChargeCandidates: un alumno pausado nunca es candidato', () => {
  const candidates = selectMonthlyChargeCandidates({
    students: [{ id: 's1', status: 'pausado' }],
    resolvePlan: () => monthlyPlan(),
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'un alumno pausado no genera mensualidad');
});

test('selectMonthlyChargeCandidates: un plan por_clase/semanal/quincenal/paquete/sin cargo nunca es candidato mensual', () => {
  const plans: StudentBillingPlan[] = [
    { type: 'per_class', amount: 5000 },
    { type: 'weekly', amount: 5000, dueWeekday: 1 },
    { type: 'biweekly', amount: 5000, anchorDate: '2026-01-01' },
    { type: 'class_package', amount: 50000, includedClasses: 4, validFrom: '2026-01-01' },
    { type: 'complimentary' },
  ];
  plans.forEach((plan, index) => {
    const candidates = selectMonthlyChargeCandidates({
      students: [{ id: `s${index}`, status: 'activo' }],
      resolvePlan: () => plan,
      billingPeriod: '2026-08',
    });
    assertEqual(candidates.length, 0, `plan ${plan.type} nunca genera candidato mensual`);
  });
});

test('selectMonthlyChargeCandidates: alumno "comienza a pagar el mes siguiente" — excluido en julio, incluido en agosto', () => {
  const resolvePlan = () => monthlyPlan({ startPeriod: '2026-08' });

  const julyCandidates = selectMonthlyChargeCandidates({
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan,
    billingPeriod: '2026-07',
  });
  assertEqual(julyCandidates.length, 0, 'julio es anterior a startPeriod: sin candidato');

  const augustCandidates = selectMonthlyChargeCandidates({
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan,
    billingPeriod: '2026-08',
  });
  assertEqual(augustCandidates.length, 1, 'agosto es el startPeriod: sí es candidato');
  assertEqual(augustCandidates[0].price, 20000, 'usa el importe vigente del plan');
});

test('selectMonthlyChargeCandidates: sin startPeriod, siempre es candidato (comportamiento histórico)', () => {
  const candidates = selectMonthlyChargeCandidates({
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => monthlyPlan(),
    billingPeriod: '2026-12',
  });
  assertEqual(candidates.length, 1, 'sin restricción de período, siempre candidato mientras esté activo');
});

test('selectMonthlyChargeCandidates: sin perfil resuelto (resolvePlan devuelve null), se omite sin lanzar', () => {
  const candidates = selectMonthlyChargeCandidates({
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'sin perfil, no hay candidato');
});
