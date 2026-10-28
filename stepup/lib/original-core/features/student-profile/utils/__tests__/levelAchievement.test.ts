// Puerto VERBATIM del original (`src/features/student-profile/utils/__tests__/levelAchievement.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel en
 * Progreso): pruebas puras (nunca montan componentes React — mismo patrón
 * del resto del proyecto) para `cefrLevel.ts` y `levelAchievementRules.ts`.
 * Cubre los 17 casos pedidos explícitamente en la tarea.
 */
import { assert, assertEqual, finishTests, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { CEFR_LEVEL_ORDER, daysBetween, formatElapsedDuration, isLevelDowngrade, isLevelJump, levelStepDistance } from '../cefrLevel.ts';
import { LevelAchievementError, planLevelAchievement } from '../levelAchievementRules.ts';
import type { LevelHistoryEntry } from '../../types/index.ts';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const DATE_JOINED = '2026-01-10T00:00:00.000Z';

test('CEFR_LEVEL_ORDER: exactamente los 6 niveles reales, en orden', () => {
  assertEqual(CEFR_LEVEL_ORDER.length, 6, 'seis niveles');
  assertEqual(CEFR_LEVEL_ORDER.join(','), 'A1,A2,B1,B2,C1,C2', 'orden real A1..C2');
});

test('levelStepDistance / isLevelDowngrade / isLevelJump: signo y magnitud correctos', () => {
  assertEqual(levelStepDistance('A1', 'A2'), 1, 'A1->A2 es un paso');
  assertEqual(levelStepDistance('A1', 'B1'), 2, 'A1->B1 son dos pasos (salto)');
  assertEqual(levelStepDistance('B1', 'A1'), -2, 'B1->A1 es una corrección de dos pasos');
  assert(!isLevelDowngrade('A1', 'A2'), 'A1->A2 no es downgrade');
  assert(isLevelDowngrade('B1', 'A1'), 'B1->A1 es downgrade');
  assert(!isLevelJump('A1', 'A2'), 'A1->A2 no es salto');
  assert(isLevelJump('A1', 'B1'), 'A1->B1 es salto');
  assert(!isLevelJump('B1', 'A1'), 'una corrección hacia abajo nunca se clasifica como salto');
});

test('formatElapsedDuration: "Hoy", días sueltos, meses y días, años y meses', () => {
  assertEqual(formatElapsedDuration(0), 'Hoy', 'cero días');
  assertEqual(formatElapsedDuration(1), '1 día', 'singular');
  assertEqual(formatElapsedDuration(5), '5 días', 'plural corto');
  assertEqual(formatElapsedDuration(72), '2 meses y 12 días', 'ejemplo exacto pedido en la tarea');
  assertEqual(formatElapsedDuration(60), '2 meses', 'meses exactos, sin sobrante de días');
  assertEqual(formatElapsedDuration(455), '1 año y 3 meses', 'ejemplo exacto pedido en la tarea');
  assertEqual(formatElapsedDuration(365), '1 año', 'año exacto, sin sobrante de meses');
});

test('daysBetween: días calendario reales, incluyendo cambio de año (diciembre -> enero)', () => {
  assertEqual(daysBetween('2025-12-20', '2026-01-05'), 16, 'cruza fin de año correctamente');
  assertEqual(daysBetween('2026-01-01', '2026-01-01'), 0, 'misma fecha, cero días');
  assertEqual(daysBetween('bad', '2026-01-01'), null, 'fecha inválida da null, nunca inventa un número');
});

// --- 1) A1 -> A2 -----------------------------------------------------------
test('1) A1 -> A2: logro normal, sin advertencia, primera duración desde dateJoined', () => {
  const result = planLevelAchievement({
    currentLevel: 'A1',
    history: [],
    dateJoined: DATE_JOINED,
    toLevel: 'A2',
    achievedAt: '2026-03-15',
    now: NOW,
  });
  assertEqual(result.nextLevel, 'A2', 'nivel actualizado');
  assertEqual(result.warning, null, 'sin advertencia para un paso normal');
  assertEqual(result.entry.fromLevel, 'A1', 'fromLevel correcto');
  assertEqual(result.entry.previousMilestoneAt, '2026-01-10', 'usa dateJoined como base (primer logro)');
  assertEqual(result.entry.durationDays, 64, 'duración real en días calendario');
  assertEqual(result.nextHistory.length, 1, 'historial con una entrada');
});

// --- 2) A2 -> B1 (con un logro previo) -------------------------------------
test('2) A2 -> B1: segunda duración calculada desde el logro anterior, nunca desde dateJoined', () => {
  const previous: LevelHistoryEntry = {
    level: 'A2',
    date: '2026-03-15',
    fromLevel: 'A1',
    previousMilestoneAt: '2026-01-10',
    durationDays: 64,
    origin: 'manual',
  };
  const result = planLevelAchievement({
    currentLevel: 'A2',
    history: [previous],
    dateJoined: DATE_JOINED,
    toLevel: 'B1',
    achievedAt: '2026-06-01',
    now: NOW,
  });
  assertEqual(result.entry.previousMilestoneAt, '2026-03-15', 'base = logro anterior, no dateJoined');
  assertEqual(result.entry.durationDays, 78, 'duración desde el logro anterior');
  assertEqual(result.nextHistory.length, 2, 'historial con dos entradas, la anterior intacta');
  assertEqual(result.nextHistory[0], previous, 'la entrada anterior no se muta ni se reemplaza');
});

// --- 3) Salto A1 -> B1 ------------------------------------------------------
test('3) Salto A1 -> B1: se permite, pero devuelve advertencia "jump" con 2 pasos', () => {
  const result = planLevelAchievement({
    currentLevel: 'A1',
    history: [],
    dateJoined: DATE_JOINED,
    toLevel: 'B1',
    achievedAt: '2026-05-01',
    now: NOW,
  });
  assert(result.warning !== null, 'debe advertir');
  assertEqual(result.warning?.kind, 'jump', 'clasificado como salto');
  assertEqual(result.warning?.steps, 2, 'dos niveles de diferencia');
  assertEqual(result.nextLevel, 'B1', 'igual se aplica (la UI ya confirmó)');
});

// --- 4) Corrección hacia nivel inferior -------------------------------------
test('4) Corrección hacia nivel inferior: se permite, advertencia "downgrade", nunca se presenta como logro', () => {
  const result = planLevelAchievement({
    currentLevel: 'B1',
    history: [],
    dateJoined: DATE_JOINED,
    toLevel: 'A2',
    achievedAt: '2026-05-01',
    now: NOW,
  });
  assertEqual(result.warning?.kind, 'downgrade', 'clasificado como corrección, no como logro');
  assertEqual(result.warning?.fromLevel, 'B1', 'fromLevel de la advertencia');
  assertEqual(result.warning?.toLevel, 'A2', 'toLevel de la advertencia');
  assertEqual(result.warning?.steps, 1, 'un solo paso de diferencia');
});

// --- 5) Mismo nivel rechazado -----------------------------------------------
test('5) Mismo nivel rechazado: nunca se permite "cambiar" al nivel que ya tiene', () => {
  let threw = false;
  try {
    planLevelAchievement({
      currentLevel: 'B1',
      history: [],
      dateJoined: DATE_JOINED,
      toLevel: 'B1',
      achievedAt: '2026-05-01',
      now: NOW,
    });
  } catch (error) {
    threw = true;
    assert(error instanceof LevelAchievementError, 'error tipado');
    assertEqual((error as LevelAchievementError).code, 'same_level', 'código de error correcto');
  }
  assert(threw, 'debe rechazar con excepción');
});

// --- 6) Fecha futura rechazada ----------------------------------------------
test('6) Fecha futura rechazada', () => {
  let code: string | null = null;
  try {
    planLevelAchievement({
      currentLevel: 'A1',
      history: [],
      dateJoined: DATE_JOINED,
      toLevel: 'A2',
      achievedAt: '2026-12-31',
      now: NOW,
    });
  } catch (error) {
    code = (error as LevelAchievementError).code;
  }
  assertEqual(code, 'future_date', 'rechaza fecha futura respecto de "now"');
});

// --- 7) Primera duración desde el inicio del alumno -------------------------
test('7) Primera duración: usa dateJoined cuando no hay logros previos', () => {
  const result = planLevelAchievement({
    currentLevel: 'A1',
    history: [],
    dateJoined: '2026-01-01',
    toLevel: 'A2',
    achievedAt: '2026-01-01',
    now: NOW,
  });
  assertEqual(result.entry.previousMilestoneAt, '2026-01-01', 'base = dateJoined');
  assertEqual(result.entry.durationDays, 0, 'mismo día que el inicio: cero días, no null');
});

// --- 8) Duración posterior desde el logro anterior --------------------------
test('8) Duración posterior: ignora dateJoined si ya hay un logro previo más reciente', () => {
  const previous: LevelHistoryEntry = { level: 'A2', date: '2026-02-01' };
  const result = planLevelAchievement({
    currentLevel: 'A2',
    history: [previous],
    dateJoined: '2020-01-01', // muy anterior — no debe usarse
    toLevel: 'B1',
    achievedAt: '2026-03-01',
    now: NOW,
  });
  assertEqual(result.entry.previousMilestoneAt, '2026-02-01', 'usa el logro anterior, nunca dateJoined');
  assertEqual(result.entry.durationDays, 28, 'duración desde el logro anterior');
});

// --- 9) Falta de fecha inicial -----------------------------------------------
test('9) Falta de fecha inicial: sin dateJoined y sin logros previos, durationDays es null (nunca inventado)', () => {
  const result = planLevelAchievement({
    currentLevel: 'A1',
    history: [],
    dateJoined: null,
    toLevel: 'A2',
    achievedAt: '2026-03-01',
    now: NOW,
  });
  assertEqual(result.entry.previousMilestoneAt, null, 'sin base real');
  assertEqual(result.entry.durationDays, null, '"No se puede calcular todavía" en la UI, nunca un número inventado');
});

// --- 10) Doble toque ----------------------------------------------------------
// El guard de doble toque vive en la capa de persistencia (useStudentProfile.ts,
// mismo patrón que applyBillingPlanChange) y en la UI (LevelAchievementSheet) —
// se prueba estructuralmente en levelAchievementPersistence.test.ts.

// --- 16) No mutación de entradas ---------------------------------------------
test('16) planLevelAchievement nunca muta el historial ni las entradas recibidas', () => {
  const previous: LevelHistoryEntry = { level: 'A2', date: '2026-02-01' };
  const historyInput = [previous];
  const historySnapshot = JSON.stringify(historyInput);
  planLevelAchievement({
    currentLevel: 'A2',
    history: historyInput,
    dateJoined: DATE_JOINED,
    toLevel: 'B1',
    achievedAt: '2026-03-01',
    now: NOW,
  });
  assertEqual(JSON.stringify(historyInput), historySnapshot, 'el array/objeto de entrada no se modifica');
});

// --- 17) Fechas límite y cambio de año ---------------------------------------
test('17) Fechas límite: achievedAt exactamente hoy se acepta; cruzar diciembre->enero calcula bien la duración', () => {
  const today = planLevelAchievement({
    currentLevel: 'A1',
    history: [],
    dateJoined: DATE_JOINED,
    toLevel: 'A2',
    achievedAt: '2026-08-03', // == NOW
    now: NOW,
  });
  assertEqual(today.entry.date, '2026-08-03', 'la fecha de hoy exacta se acepta, nunca se rechaza como "futura"');

  const previous: LevelHistoryEntry = { level: 'A2', date: '2025-12-20' };
  const acrossYear = planLevelAchievement({
    currentLevel: 'A2',
    history: [previous],
    dateJoined: DATE_JOINED,
    toLevel: 'B1',
    achievedAt: '2026-01-05',
    now: NOW,
  });
  assertEqual(acrossYear.entry.durationDays, 16, 'la duración cruzando el cambio de año se calcula correctamente');
});

test('secuencia incoherente: una fecha de logro anterior al último logro registrado se rechaza', () => {
  const previous: LevelHistoryEntry = { level: 'A2', date: '2026-06-01' };
  let code: string | null = null;
  try {
    planLevelAchievement({
      currentLevel: 'A2',
      history: [previous],
      dateJoined: DATE_JOINED,
      toLevel: 'B1',
      achievedAt: '2026-05-01', // anterior al logro ya registrado
      now: NOW,
    });
  } catch (error) {
    code = (error as LevelAchievementError).code;
  }
  assertEqual(code, 'incoherent_sequence', 'nunca permite insertar un logro "en el pasado" respecto del último');
});

test('fecha anterior al inicio del alumno (sin logros previos) se rechaza', () => {
  let code: string | null = null;
  try {
    planLevelAchievement({
      currentLevel: 'A1',
      history: [],
      dateJoined: '2026-06-01',
      toLevel: 'A2',
      achievedAt: '2026-01-01', // antes de dateJoined
      now: NOW,
    });
  } catch (error) {
    code = (error as LevelAchievementError).code;
  }
  assertEqual(code, 'before_start', 'código de error correcto');
});

test('el id de cada logro es único incluso para el mismo alumno en el mismo instante (usa la posición en el historial)', () => {
  const r1 = planLevelAchievement({
    currentLevel: 'A1', history: [], dateJoined: DATE_JOINED, toLevel: 'A2', achievedAt: '2026-03-01', now: NOW,
  });
  const r2 = planLevelAchievement({
    currentLevel: 'A2', history: r1.nextHistory, dateJoined: DATE_JOINED, toLevel: 'B1', achievedAt: '2026-04-01', now: NOW,
  });
  assert(r1.entry.id !== r2.entry.id, 'ids distintos para entradas distintas del mismo alumno');
});

// --- Niveles personalizados (a pedido de Joaquín) ---------------------------
// `levelStepDistance` usa `CEFR_LEVEL_ORDER.indexOf(...)`, que da -1 para
// cualquier nivel personalizado ("Infantes", etc.) — antes de esta
// corrección eso producía una distancia numérica sin sentido. Ahora debe
// devolver `null` (nunca inventar downgrade/jump) apenas uno de los dos
// lados no es un nivel CEFR real.
test('levelStepDistance: null cuando cualquiera de los dos lados es un nivel personalizado (nunca inventa una distancia)', () => {
  assertEqual(levelStepDistance('Infantes', 'A2'), null, 'origen personalizado');
  assertEqual(levelStepDistance('A2', 'Infantes'), null, 'destino personalizado');
  assertEqual(levelStepDistance('Infantes', 'Conversación'), null, 'ambos personalizados');
});

test('isLevelDowngrade / isLevelJump: siempre false cuando interviene un nivel personalizado', () => {
  assert(!isLevelDowngrade('B1', 'Infantes'), 'nunca downgrade hacia un nivel personalizado');
  assert(!isLevelDowngrade('Infantes', 'A1'), 'nunca downgrade desde un nivel personalizado');
  assert(!isLevelJump('A1', 'Infantes'), 'nunca salto hacia un nivel personalizado');
  assert(!isLevelJump('Infantes', 'B1'), 'nunca salto desde un nivel personalizado');
});

test('planLevelAchievement: cambiar hacia o desde un nivel personalizado nunca produce advertencia de downgrade/salto', () => {
  const toCustom = planLevelAchievement({
    currentLevel: 'A1',
    history: [],
    dateJoined: DATE_JOINED,
    toLevel: 'Infantes',
    achievedAt: '2026-03-15',
    now: NOW,
  });
  assertEqual(toCustom.warning, null, 'sin advertencia al pasar a un nivel personalizado');
  assertEqual(toCustom.nextLevel, 'Infantes', 'igual se aplica el cambio de nivel');

  const fromCustom = planLevelAchievement({
    currentLevel: 'Infantes',
    history: [],
    dateJoined: DATE_JOINED,
    toLevel: 'B1',
    achievedAt: '2026-03-15',
    now: NOW,
  });
  assertEqual(fromCustom.warning, null, 'sin advertencia al salir de un nivel personalizado');
});

finishTests('de logros de nivel');
