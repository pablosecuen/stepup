// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/firstMonthProration.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
 * alumno a una serie): pruebas puras de `computeProportionalAmount`,
 * `planFirstMonthProration` y `resolveFirstMonthChargeAmount` — casos QA
 * 1, 2, 3, 4, 13.
 */
import type { RecurrenceRule, RecurrenceWeek } from '../../../calendar/types/index.ts';
import { computeProportionalAmount, planFirstMonthProration, resolveFirstMonthChargeAmount } from '../firstMonthProration.ts';
import { assert, assertEqual, assertThrows, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function rule(overrides: Partial<RecurrenceRule> & { weeks: RecurrenceWeek[]; cycleLengthWeeks: 1 | 2 | 3 | 4 }): RecurrenceRule {
  return {
    recurrenceId: 'qa_rule',
    studentId: 'qa_student',
    participantIds: ['qa_student'],
    type: 'weekly',
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-07-27', // lunes, antes del rango de prueba (agosto)
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

// --- 1) Cuota $80.000, 2 de 4 clases: cargo $40.000 -------------------------
test('1) computeProportionalAmount: cuota $80.000, 2 de 4 clases habituales -> $40.000 exacto', () => {
  assertEqual(computeProportionalAmount(80000, 2, 4), 40000, 'mitad de las clases, mitad de la cuota');
});

// --- 2) Redondeo cuando no es divisible exactamente --------------------------
test('2) computeProportionalAmount: importe no divisible exactamente redondea a entero (nunca decimales de dinero)', () => {
  // 80000 * 1 / 3 = 26666.666... -> redondea a 26667.
  const result = computeProportionalAmount(80000, 1, 3);
  assertEqual(result, 26667, 'redondeo estándar a entero, nunca trunca ni deja decimales');
  assert(Number.isInteger(result), 'el resultado siempre es un entero');
});

// --- 3) Inicio el primer día con período completo: cuota completa -----------
test('3) computeProportionalAmount: clases restantes = clases habituales (alta el primer día) -> cuota completa', () => {
  assertEqual(computeProportionalAmount(80000, 4, 4), 80000, 'con todas las clases del período por delante, cuota completa');
});

test('3b) computeProportionalAmount: más clases restantes que habituales (patrón irregular) nunca supera el 100%', () => {
  assertEqual(computeProportionalAmount(80000, 5, 4), 80000, 'nunca cobra más que la cuota completa');
});

// --- 4) Inicio el último día sin clases restantes: $0 ------------------------
test('4) computeProportionalAmount: sin ninguna clase real restante -> $0', () => {
  assertEqual(computeProportionalAmount(80000, 0, 4), 0, 'alta el último día, sin clases por delante');
});

test('caso límite: sin ningún patrón real conocido (denominador 0) implica 0 ocurrencias restantes -> $0, nunca cuota completa inventada', () => {
  // classesRemaining siempre es un subconjunto de classesPerFullPeriod (ver
  // planFirstMonthProration) — classesPerFullPeriod<=0 sólo puede darse junto
  // con classesRemaining<=0, que cae en el escalón "0 ocurrencias: sin cargo".
  assertEqual(computeProportionalAmount(80000, 0, 0), 0, 'sin ninguna ocurrencia real por delante, nunca se inventa un cargo');
});

// --- resolveFirstMonthChargeAmount: mapea cada criterio -----------------------
const baseSuggestion = {
  studentId: 'qa_student',
  billingPeriod: '2026-08',
  effectiveJoinDate: '2026-08-15',
  classesRemaining: 2,
  classesPerFullPeriod: 4,
  permanentMonthlyAmount: 80000,
  proportionalAmount: 40000,
};

test('resolveFirstMonthChargeAmount: "proportional" usa el importe ya calculado', () => {
  assertEqual(resolveFirstMonthChargeAmount(baseSuggestion, 'proportional'), 40000, 'usa proportionalAmount tal cual');
});

test('resolveFirstMonthChargeAmount: "full" usa la cuota permanente completa', () => {
  assertEqual(resolveFirstMonthChargeAmount(baseSuggestion, 'full'), 80000, 'cuota completa, ignora el proporcional');
});

test('resolveFirstMonthChargeAmount: "custom" usa el importe personalizado, redondeado', () => {
  assertEqual(resolveFirstMonthChargeAmount(baseSuggestion, 'custom', 55000.4), 55000, 'importe personalizado redondeado');
});

test('resolveFirstMonthChargeAmount: "custom" sin importe válido lanza (nunca cobra $0/NaN en silencio)', () => {
  assertThrows(
    () => resolveFirstMonthChargeAmount(baseSuggestion, 'custom', 0),
    /positivo/,
    'un importe personalizado <= 0 se rechaza'
  );
  assertThrows(
    () => resolveFirstMonthChargeAmount(baseSuggestion, 'custom', undefined),
    /positivo/,
    'sin importe personalizado se rechaza'
  );
});

test('resolveFirstMonthChargeAmount: "no_charge" siempre da 0', () => {
  assertEqual(resolveFirstMonthChargeAmount(baseSuggestion, 'no_charge'), 0, 'no cobra nada este primer período');
});

// --- 13) Alumno agregado a dos series: una sola mensualidad (suma, nunca duplica) ---
test('13) planFirstMonthProration: dos series activas suman sus clases — una sola sugerencia combinada', () => {
  const ruleA = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }], // lunes
  });
  const ruleB = rule({
    recurrenceId: 'qa_rule_b',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 17, minute: 0, durationMinutes: 60 }] }], // jueves
  });

  const suggestion = planFirstMonthProration({
    studentId: 'qa_student',
    monthlyAmount: 90000,
    effectiveJoinDate: '2026-08-01',
    activeSeries: [ruleA, ruleB],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });

  // Agosto 2026: 5 lunes (03,10,17,24,31) + 4 jueves (06,13,20,27) = 9 habituales, mismas 9 restantes desde el día 1.
  assertEqual(suggestion.classesPerFullPeriod, 9, 'suma las dos series, nunca una mensualidad por serie');
  assertEqual(suggestion.classesRemaining, 9, 'alta el primer día: todas las clases de ambas series restan');
  assertEqual(suggestion.proportionalAmount, 90000, 'con el período completo por delante, cuota completa');
});

test('13b) planFirstMonthProration: alta a mitad de mes con dos series combina clases restantes de ambas', () => {
  const ruleA = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }], // lunes
  });
  const ruleB = rule({
    recurrenceId: 'qa_rule_b',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 17, minute: 0, durationMinutes: 60 }] }], // jueves
  });

  const suggestion = planFirstMonthProration({
    studentId: 'qa_student',
    monthlyAmount: 90000,
    effectiveJoinDate: '2026-08-18', // martes
    activeSeries: [ruleA, ruleB],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });

  // Restantes desde 18/08: lunes 24,31 (2) + jueves 20,27 (2) = 4. Habituales del mes completo: 9 (ver prueba anterior).
  assertEqual(suggestion.classesRemaining, 4, 'suma clases restantes de ambas series desde la fecha de incorporación');
  assertEqual(suggestion.classesPerFullPeriod, 9, 'el denominador sigue siendo el período completo de ambas series');
  assertEqual(suggestion.proportionalAmount, computeProportionalAmount(90000, 4, 9), 'coincide con la fórmula pura');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, quinta ronda (a pedido de Joaquín — CORRECCIÓN
// DEFINITIVA DE LA REGLA DEL PRIMER MES): regla comercial confirmada por
// ESCALÓN FIJO de ocurrencias reales restantes — nunca una fracción
// continua. 0 -> sin cargo. 1 -> valor de una clase. 2 -> exactamente 50%.
// 3 o más -> cuota completa, sin importar cuántas clases tenga el período
// completo (nunca 3/4, nunca 3/5, ni ningún otro porcentaje intermedio).
// ---------------------------------------------------------------------------

test('escalón: 0 ocurrencias restantes -> $0, sin cargo', () => {
  assertEqual(computeProportionalAmount(80000, 0, 4), 0, '0 ocurrencias nunca genera cargo');
});

test('escalón: 1 ocurrencia restante -> el valor de UNA sola clase (cuota / clases habituales del período completo), nunca el precio de clase suelta', () => {
  assertEqual(computeProportionalAmount(80000, 1, 4), 20000, '80.000 / 4 clases habituales = 20.000 exactos');
  // Redondeo estándar cuando no es divisible exactamente (ver prueba 2, misma regla).
  assertEqual(computeProportionalAmount(80000, 1, 3), 26667, 'valor de una clase, redondeado a entero');
});

test('escalón: 2 ocurrencias restantes -> exactamente el 50% de la cuota, sin importar si la serie habitual es de 2, 3 u 8 clases por período', () => {
  assertEqual(computeProportionalAmount(80000, 2, 2), 40000, 'serie de 1 clase semanal (período completo = 2)');
  assertEqual(computeProportionalAmount(80000, 2, 3), 40000, 'período completo = 3: igual 50%, nunca 2/3');
  assertEqual(computeProportionalAmount(80000, 2, 8), 40000, 'período completo = 8 (serie de varias clases semanales): igual 50%, nunca 2/8');
});

test('escalón: 3 ocurrencias restantes -> cuota COMPLETA, nunca 75% ni ninguna otra fracción, sin importar el período completo', () => {
  const result = computeProportionalAmount(80000, 3, 4);
  assertEqual(result, 80000, 'tres o más ocurrencias ya corresponden a cuota completa');
  assert(result !== 60000, 'nunca calcula 3/4 (75%) de la cuota');
});

test('escalón: 4 ocurrencias restantes -> cuota completa', () => {
  assertEqual(computeProportionalAmount(80000, 4, 4), 80000, 'cuota completa');
});

test('escalón: mes con 5 ocurrencias habituales — la cuota completa se alcanza en 3, nunca es una fracción sobre 5 (nunca 3/5, nunca 4/5)', () => {
  assertEqual(computeProportionalAmount(80000, 3, 5), 80000, '3 de 5 ya es cuota completa, nunca 48.000 (3/5)');
  assertEqual(computeProportionalAmount(80000, 4, 5), 80000, '4 de 5 ya es cuota completa, nunca 64.000 (4/5)');
  assertEqual(computeProportionalAmount(80000, 5, 5), 80000, '5 de 5 (período completo): cuota completa');
  // Los dos primeros escalones sí dependen de esas 5 clases habituales:
  assertEqual(computeProportionalAmount(80000, 1, 5), 16000, '1 de 5: valor de una sola clase (80.000/5)');
  assertEqual(computeProportionalAmount(80000, 2, 5), 40000, '2 de 5: igual 50%, independiente del 5');
});

test('escalón por CANTIDAD de ocurrencias real, verificado con series reales de 1, 2 y 3 clases semanales — 2 restantes siempre son 50%, sin importar cuántas clases tenga el período completo de cada serie', () => {
  // Agosto 2026: lunes 03,10,17,24,31 · miércoles 05,12,19,26 · jueves 06,13,20,27 · viernes 07,14,21,28.
  const monthlyRule = rule({
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }], // sólo lunes
  });
  const twiceWeeklyRule = rule({
    recurrenceId: 'qa_rule_2x',
    cycleLengthWeeks: 1,
    weeks: [{
      weekIndex: 0,
      sessions: [
        { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }, // lunes
        { weekday: 3, hour: 17, minute: 0, durationMinutes: 60 }, // jueves
      ],
    }],
  });
  const thriceWeeklyRule = rule({
    recurrenceId: 'qa_rule_3x',
    cycleLengthWeeks: 1,
    weeks: [{
      weekIndex: 0,
      sessions: [
        { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }, // lunes
        { weekday: 2, hour: 16, minute: 0, durationMinutes: 60 }, // miércoles
        { weekday: 4, hour: 15, minute: 0, durationMinutes: 60 }, // viernes
      ],
    }],
  });

  // 1x/semana: sólo quedan los lunes 24 y 31 -> 2 de 5 habituales.
  const oneWeekly = planFirstMonthProration({
    studentId: 'qa_student', monthlyAmount: 80000, effectiveJoinDate: '2026-08-20',
    activeSeries: [monthlyRule], exceptions: [], existingLessons: [], availability: null,
  });
  assertEqual(oneWeekly.classesRemaining, 2, '1x/semana: quedan exactamente 2 lunes');
  assertEqual(oneWeekly.classesPerFullPeriod, 5, '1x/semana: período completo de 5 lunes');
  assertEqual(oneWeekly.proportionalAmount, 40000, '2 restantes = 50%, sin importar el período completo de 5');

  // 2x/semana: sólo quedan jueves 27 y lunes 31 -> 2 de 9 habituales (5 lunes + 4 jueves).
  const twoWeekly = planFirstMonthProration({
    studentId: 'qa_student', monthlyAmount: 80000, effectiveJoinDate: '2026-08-25',
    activeSeries: [twiceWeeklyRule], exceptions: [], existingLessons: [], availability: null,
  });
  assertEqual(twoWeekly.classesRemaining, 2, '2x/semana: quedan exactamente 2 ocurrencias (jueves 27, lunes 31)');
  assertEqual(twoWeekly.classesPerFullPeriod, 9, '2x/semana: período completo de 9 ocurrencias');
  assertEqual(twoWeekly.proportionalAmount, 40000, '2 restantes = 50%, sin importar el período completo de 9');

  // 3x/semana: sólo quedan viernes 28 y lunes 31 -> 2 de 13 habituales (5 lunes + 4 miércoles + 4 viernes).
  const threeWeekly = planFirstMonthProration({
    studentId: 'qa_student', monthlyAmount: 80000, effectiveJoinDate: '2026-08-27',
    activeSeries: [thriceWeeklyRule], exceptions: [], existingLessons: [], availability: null,
  });
  assertEqual(threeWeekly.classesRemaining, 2, '3x/semana: quedan exactamente 2 ocurrencias (viernes 28, lunes 31)');
  assertEqual(threeWeekly.classesPerFullPeriod, 13, '3x/semana: período completo de 13 ocurrencias');
  assertEqual(threeWeekly.proportionalAmount, 40000, '2 restantes = 50%, sin importar el período completo de 13');
});

test('planFirstMonthProration: billingPeriod se deriva de la fecha efectiva de incorporación, nunca de "hoy"', () => {
  const ruleA = rule({ cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }] });
  const suggestion = planFirstMonthProration({
    studentId: 'qa_student',
    monthlyAmount: 50000,
    effectiveJoinDate: '2026-03-10',
    activeSeries: [ruleA],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(suggestion.billingPeriod, '2026-03', 'el período es el de la fecha de incorporación');
});
