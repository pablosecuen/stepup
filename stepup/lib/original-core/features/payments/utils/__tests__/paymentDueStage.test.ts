// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentDueStage.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { calculateSurchargeAmount, determineMonthlyDueStage, determinePerClassDueStage } from '../paymentDueStage.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// Mensual: día 1 (dueDate) a 10 verde; 11-18 amarillo; 19-26 naranja; 27+ rojo.
// ---------------------------------------------------------------------------

test('mensual: día 1 y día 10 son on_time (límite inferior/superior de verde)', () => {
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-01'), 'on_time', 'día 1');
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-10'), 'on_time', 'día 10');
});

test('mensual: día 11 y día 18 son first_late (límites de amarillo)', () => {
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-11'), 'first_late', 'día 11');
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-18'), 'first_late', 'día 18');
});

test('mensual: día 19 y día 26 son second_late (límites de naranja)', () => {
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-19'), 'second_late', 'día 19');
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-26'), 'second_late', 'día 26');
});

test('mensual: día 27 es last_late y se mantiene mucho después', () => {
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-07-27'), 'last_late', 'día 27');
  assertEqual(determineMonthlyDueStage('2026-07-01', '2026-09-15'), 'last_late', 'muy tarde, cruza meses');
});

// ---------------------------------------------------------------------------
// Por clase: en término <=0 días; 1-7 amarillo; 8-15 naranja; 16+ rojo.
// ---------------------------------------------------------------------------

test('por clase: el mismo día y antes de la clase son on_time', () => {
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-15'), 'on_time', 'mismo día');
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-10'), 'on_time', 'antes de la clase');
});

test('por clase: 1 y 7 días de atraso son first_late (límites de amarillo)', () => {
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-16'), 'first_late', '1 día');
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-22'), 'first_late', '7 días');
});

test('por clase: 8 y 15 días de atraso son second_late (límites de naranja)', () => {
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-23'), 'second_late', '8 días');
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-30'), 'second_late', '15 días');
});

test('por clase: 16 días de atraso en adelante es last_late', () => {
  assertEqual(determinePerClassDueStage('2026-07-15', '2026-07-31'), 'last_late', '16 días');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): `calculateSurchargeAmount` es ahora el punto
// CENTRAL que garantiza cero recargo siempre — devuelve 0 sin importar el
// importe, la etapa o los `tierValues` que se le pasen (incluso pasando a
// mano un `SurchargeTierValues` con `enabled: true` y porcentajes propios).
// Esto es justamente lo que hace imposible que una llamada futura reintroduzca
// un recargo automático "por accidente".
// ---------------------------------------------------------------------------

test('calculateSurchargeAmount devuelve siempre 0, en cualquier etapa, sin importar el importe', () => {
  const original = 10000;
  assertEqual(calculateSurchargeAmount(original, 'on_time'), 0, 'sin recargo en término');
  assertEqual(calculateSurchargeAmount(original, 'first_late'), 0, 'nunca +10%');
  assertEqual(calculateSurchargeAmount(original, 'second_late'), 0, 'nunca +15%');
  assertEqual(calculateSurchargeAmount(original, 'last_late'), 0, 'nunca +20%');
});

test('calculateSurchargeAmount devuelve 0 incluso pasando a mano un SurchargeTierValues con enabled: true — ninguna llamada puede omitir la regla central', () => {
  const original = 50000;
  const customTierValuesClaimingEnabled = {
    enabled: true,
    graceDay: 10,
    firstLateDay: 11,
    firstLatePercentage: 10,
    secondLateDay: 19,
    secondLatePercentage: 15,
    lastLateDay: 27,
    lastLatePercentage: 20,
  };
  assertEqual(calculateSurchargeAmount(original, 'last_late', customTierValuesClaimingEnabled), 0, 'ni siquiera con enabled: true explícito hay recargo — la función ignora ese campo por completo');
});
