// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/trainingBilling.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { TrainingBillingAgreement } from '../../types/index.ts';
import { buildTrainingBillingAgreement, planTrainingMonthlyFeeChange, resolveEffectiveTrainingMonthlyFee } from '../trainingBilling.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function agreement(overrides: Partial<TrainingBillingAgreement> = {}): TrainingBillingAgreement {
  return {
    id: 'qa_agreement_1',
    monthlyFee: 15000,
    startPeriod: '2026-06',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

test('buildTrainingBillingAgreement: construye un acuerdo válido con los datos reales', () => {
  const built = buildTrainingBillingAgreement({
    id: 'qa_agreement_2',
    monthlyFee: 20000,
    startPeriod: '2026-09',
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  assertEqual(built.id, 'qa_agreement_2', 'conserva el id');
  assertEqual(built.monthlyFee, 20000, 'conserva la cuota');
  assertEqual(built.startPeriod, '2026-09', 'conserva el período de inicio');
  assertEqual(built.pendingMonthlyFee, undefined, 'sin cambio de precio pendiente al crear');
});

test('buildTrainingBillingAgreement: rechaza una cuota no positiva', () => {
  assert(
    (() => {
      try {
        buildTrainingBillingAgreement({ id: 'x', monthlyFee: 0, startPeriod: '2026-09', createdAt: '2026-09-01T00:00:00.000Z' });
        return false;
      } catch {
        return true;
      }
    })(),
    'una cuota de $0 nunca es válida'
  );
});

test('buildTrainingBillingAgreement: rechaza un período de inicio con formato inválido', () => {
  assert(
    (() => {
      try {
        buildTrainingBillingAgreement({ id: 'x', monthlyFee: 100, startPeriod: '2026-13', createdAt: '2026-09-01T00:00:00.000Z' });
        return false;
      } catch {
        return true;
      }
    })(),
    'un mes 13 nunca es válido'
  );
});

test('resolveEffectiveTrainingMonthlyFee: sin cambio pendiente, siempre devuelve monthlyFee', () => {
  const a = agreement();
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-06'), 15000, 'período de inicio');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-12'), 15000, 'período futuro, sin cambios');
});

test('resolveEffectiveTrainingMonthlyFee: con cambio pendiente, el período ANTERIOR a la vigencia sigue viendo el precio viejo', () => {
  const a = agreement({ pendingMonthlyFee: 18000, pendingMonthlyFeeEffectiveFrom: '2026-08' });
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-07'), 15000, 'julio: todavía el precio viejo');
});

test('resolveEffectiveTrainingMonthlyFee: el período de vigencia y los posteriores ya ven el precio nuevo', () => {
  const a = agreement({ pendingMonthlyFee: 18000, pendingMonthlyFeeEffectiveFrom: '2026-08' });
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-08'), 18000, 'agosto: ya rige el precio nuevo');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-09'), 18000, 'septiembre: sigue el precio nuevo');
});

// ---------------------------------------------------------------------------
// 14) Cambiar precio: cargos existentes intactos, nuevo precio desde el
//     próximo mes — planTrainingMonthlyFeeChange NUNCA toca PaymentCharge
//     alguno (a diferencia de planMonthlyAmountChange): siempre deja el
//     cambio pendiente para el período siguiente, incondicionalmente.
// ---------------------------------------------------------------------------
test('14a) planTrainingMonthlyFeeChange: el nuevo precio queda pendiente para el mes siguiente, nunca el actual', () => {
  const a = agreement({ monthlyFee: 15000 });
  const updated = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 18000, currentBillingPeriod: '2026-07' });
  assertEqual(updated.monthlyFee, 15000, 'el precio vigente (histórico) nunca se toca directamente');
  assertEqual(updated.pendingMonthlyFee, 18000, 'el precio nuevo queda como pendiente');
  assertEqual(updated.pendingMonthlyFeeEffectiveFrom, '2026-08', 'rige recién desde el mes siguiente');
});

test('14b) planTrainingMonthlyFeeChange: rechaza un precio nuevo no positivo', () => {
  const a = agreement();
  assert(
    (() => {
      try {
        planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: -5, currentBillingPeriod: '2026-07' });
        return false;
      } catch {
        return true;
      }
    })(),
    'un precio negativo nunca es válido'
  );
});

test('14c) planTrainingMonthlyFeeChange: aplicado dos veces seguidas en el mismo mes es idempotente en el resultado (misma vigencia, nunca dos cambios apilados)', () => {
  const a = agreement({ monthlyFee: 15000 });
  const first = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 18000, currentBillingPeriod: '2026-07' });
  const second = planTrainingMonthlyFeeChange({ agreement: first, newMonthlyFee: 18000, currentBillingPeriod: '2026-07' });
  assertEqual(second.pendingMonthlyFee, 18000, 'mismo resultado');
  assertEqual(second.pendingMonthlyFeeEffectiveFrom, '2026-08', 'misma vigencia');
});

// ---------------------------------------------------------------------------
// 7) SEGUNDO CAMBIO DE PRECIO — caso real pedido explícitamente: septiembre
//    $10.000; octubre pasa a $15.000; en noviembre se programa $20.000 para
//    diciembre. Noviembre debe seguir viendo $15.000, NUNCA volver a
//    $10.000 (el bug real: pisar pendingMonthlyFeeEffectiveFrom sin
//    promover antes el precio ya vigente).
// ---------------------------------------------------------------------------
test('7a) Caso real: segundo cambio de precio programado DESPUÉS de que el primero ya entró en vigencia — el mes intermedio conserva el precio YA vigente, nunca el original', () => {
  let a = agreement({ monthlyFee: 10000, startPeriod: '2026-09' });
  // En septiembre se programa el cambio a $15.000 para octubre.
  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 15000, currentBillingPeriod: '2026-09' });
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-09'), 10000, 'septiembre: todavía $10.000');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-10'), 15000, 'octubre: ya rige $15.000');

  // En noviembre (con $15.000 ya vigente) se programa un SEGUNDO cambio a
  // $20.000 para diciembre.
  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 20000, currentBillingPeriod: '2026-11' });
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-11'), 15000, 'noviembre: sigue en $15.000 — NUNCA vuelve a $10.000');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-10'), 15000, 'octubre (histórico) sigue viendo $15.000, sin cambios retroactivos');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-12'), 20000, 'diciembre: ya rige el segundo cambio, $20.000');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2027-01'), 20000, 'enero futuro: sigue en $20.000 hasta un tercer cambio');
});

test('7b) Tres cambios consecutivos, cada uno programado después del anterior ya vigente: en el momento real de CADA generación mensual, el mes en curso siempre resuelve el precio que le corresponde', () => {
  // Nota de diseño: `monthlyFee` promociona al último precio confirmado
  // como vigente en el momento de programar el SIGUIENTE cambio (ver
  // comentario de `planTrainingMonthlyFeeChange`) — esto resuelve
  // correctamente el período ACTUAL y cualquier período futuro EN EL
  // MOMENTO de cada cambio, que es exactamente lo que la generación
  // mensual real consulta (siempre "hoy", nunca un mes ya pasado). Los
  // cargos ya emitidos quedan congelados en su propio
  // `PaymentCharge.originalAmount` — nunca se recalculan desde acá, así
  // que esta función no necesita (ni se usa para) reconstruir un histórico
  // de meses que ya quedaron atrás. Por eso cada aserción se hace
  // INMEDIATAMENTE después del cambio correspondiente, mismo momento en que
  // la generación real la consultaría — nunca después de aplicar cambios
  // posteriores.
  let a = agreement({ monthlyFee: 10000, startPeriod: '2026-06' });

  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 12000, currentBillingPeriod: '2026-06' }); // programado en junio, vigente en julio
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-07'), 12000, 'julio: primer cambio, consultado en el momento real de julio');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-08'), 12000, 'agosto: sigue el primer cambio, consultado en el momento real de agosto');

  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 14000, currentBillingPeriod: '2026-08' }); // programado en agosto (con 12000 ya vigente), vigente en septiembre
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-08'), 12000, 'agosto: el segundo cambio (recién programado) nunca afecta el mes en curso');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-09'), 14000, 'septiembre: segundo cambio, consultado en el momento real de septiembre');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-10'), 14000, 'octubre: sigue el segundo cambio, consultado en el momento real de octubre');

  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 16000, currentBillingPeriod: '2026-10' }); // programado en octubre (con 14000 ya vigente), vigente en noviembre
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-10'), 14000, 'octubre: el tercer cambio (recién programado) nunca afecta el mes en curso');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-11'), 16000, 'noviembre: tercer cambio, consultado en el momento real de noviembre');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-12'), 16000, 'diciembre: sigue el tercer cambio, consultado en el momento real de diciembre');
});

test('7c) Cambio programado ANTES de que el anterior entre en vigencia (se arrepiente y cambia de nuevo el mismo mes): reemplaza el pendiente, nunca lo apila', () => {
  let a = agreement({ monthlyFee: 10000, startPeriod: '2026-06' });
  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 15000, currentBillingPeriod: '2026-06' }); // programado para julio
  // Todavía en junio, se arrepiente y decide 18000 en vez de 15000 (también para julio).
  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 18000, currentBillingPeriod: '2026-06' });
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-06'), 10000, 'junio: todavía el original, ninguno de los dos cambios rige aún');
  assertEqual(resolveEffectiveTrainingMonthlyFee(a, '2026-07'), 18000, 'julio: rige el último cambio decidido (18000), nunca el intermedio (15000)');
});

test('7d) Reinicio/restauración (round-trip JSON) tras varios cambios: la vigencia efectiva se recalcula igual antes y después', () => {
  let a = agreement({ monthlyFee: 10000, startPeriod: '2026-06' });
  a = planTrainingMonthlyFeeChange({ agreement: a, newMonthlyFee: 15000, currentBillingPeriod: '2026-09' });
  const restored: TrainingBillingAgreement = JSON.parse(JSON.stringify(a));
  assertEqual(resolveEffectiveTrainingMonthlyFee(restored, '2026-09'), 10000, 'antes de la vigencia, igual tras el round-trip');
  assertEqual(resolveEffectiveTrainingMonthlyFee(restored, '2026-10'), 15000, 'desde la vigencia, igual tras el round-trip');
});
