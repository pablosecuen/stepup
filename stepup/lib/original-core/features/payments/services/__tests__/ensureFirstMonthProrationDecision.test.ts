// Puerto VERBATIM del original (`src/features/payments/services/__tests__/ensureFirstMonthProrationDecision.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
 * automático al crear/incorporar a una serie a mitad de mes): pruebas de
 * punta a punta de `ensureFirstMonthProrationDecision` — la ÚNICA operación
 * canónica que detecta y aplica el primer mes proporcional, tanto en tiempo
 * real (crear serie/agregar participante) como en reparación (rehidratación/
 * backfill). Con adaptadores en memoria — nunca AsyncStorage ni Supabase
 * reales — y sólo identidades `qa_*`, importes y fechas genéricas.
 *
 * Fixture de calendario reutilizada en casi todas las pruebas: una serie
 * semanal de jueves. Agosto 2026 tiene jueves el 6, 13, 20 y 27 (4 en
 * total) — confirmado con el calendario real, nunca hardcodeado a mano.
 * Desde el 18/08 (después del jueves 13, antes del 20) quedan 2 jueves
 * (20 y 27) — de ahí sale el ejemplo exacto del pedido: cuota $80.000,
 * mitad de mes -> cargo $40.000.
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { ensureFirstMonthProrationDecision, type ConfirmFirstMonthProrationProfileDeps, type EnsureFirstMonthProrationDeps, type EnsureFirstMonthProrationInput, type EnsureFirstMonthProrationOutcome } from '../firstMonthProrationService.ts';
import { computeProportionalAmount, FIRST_MONTH_PRORATION_RULE_VERSION } from '../../utils/firstMonthProration.ts';
import { planMonthlyAmountReconciliationRepair } from '../../utils/financialReconciliation.ts';
import { buildMonthlyCharge, allocatePayment, recordPayment } from '../../utils/paymentMutations.ts';
import { buildMonthlyChargeId } from '../../utils/paymentIdempotency.ts';
import { parsePersistedFirstMonthProrationDecisionLog } from '../../hooks/firstMonthProrationDecisionStore.ts';
import type { FirstMonthProrationDecision } from '../../types/index.ts';
import type { StudentProfile } from '../../../student-profile/types/index.ts';
import type { PaymentsRepositoryState } from '../../types/index.ts';
import type { RecurrenceRule, RecurrenceWeek } from '../../../calendar/types/index.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

function makeFakeAdapter(initial: PaymentsRepositoryState = emptyPaymentsState()) {
  const store = { persisted: initial };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state) => {
      store.persisted = state;
    },
  };
  return { adapter, store };
}

function makeFakeProfileStore(initial: Record<string, StudentProfile> = {}) {
  const profiles = new Map<string, StudentProfile>(Object.entries(initial));
  const deps: ConfirmFirstMonthProrationProfileDeps = {
    getProfile: (studentId) => profiles.get(studentId) ?? null,
    saveProfile: async (profile) => {
      profiles.set(profile.id, profile);
    },
  };
  return { profiles, deps };
}

function makeMonthlyProfile(id: string, amount: number): StudentProfile {
  return {
    id,
    name: `Alumna ficticia ${id}`,
    levels: ['B1'],
    initialLevel: 'B1',
    modality: 'presencial',
    status: 'activo',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    billingPlan: { type: 'monthly', amount, dueDay: 1 },
    dateJoined: '2026-01-01T00:00:00.000Z', // deliberadamente lejos de la serie: nunca debe usarse como fuente
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
  };
}

function makePerClassProfile(id: string, amount: number): StudentProfile {
  return { ...makeMonthlyProfile(id, amount), billingType: 'por_clase', billingPlan: { type: 'per_class', amount } };
}

function thursdayRule(overrides: Partial<RecurrenceRule> & { studentId: string; participantIds?: string[] }): RecurrenceRule {
  const weeks: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 18, minute: 0, durationMinutes: 60 }] }];
  return {
    recurrenceId: `qa_rule_${overrides.studentId}`,
    type: 'weekly',
    modality: 'presencial',
    timezone: 'America/Argentina/Buenos_Aires',
    startDate: '2026-01-05', // vieja a propósito: una serie YA existente antes de la incorporación real
    endDate: null,
    status: 'active',
    cycleLengthWeeks: 1,
    weeks,
    ...overrides,
  };
}

function fakeDecisionLog(initial: FirstMonthProrationDecision[] = []) {
  let entries = [...initial];
  return {
    entries: () => entries,
    loadDecisions: async () => entries,
    push: (entry: FirstMonthProrationDecision) => {
      entries = [...entries, entry];
    },
  };
}

const AUGUST_MONTHLY_AMOUNT = 80000;

/** Construye deps completos con adaptadores en memoria — nunca AsyncStorage/Supabase reales. */
function buildDeps(input: {
  initialState?: PaymentsRepositoryState;
  profiles?: Record<string, StudentProfile>;
  decisions?: FirstMonthProrationDecision[];
}) {
  const { adapter, store } = makeFakeAdapter(input.initialState ?? emptyPaymentsState());
  const controller = createPaymentsStoreController(adapter);
  const { deps: profileDeps, profiles } = makeFakeProfileStore(input.profiles ?? {});
  const decisionLog = fakeDecisionLog(input.decisions ?? []);
  const deps: EnsureFirstMonthProrationDeps = {
    storeDeps: { hydrate: controller.hydrate, applyMutation: controller.applyMutation },
    profileDeps,
    getSnapshot: controller.getSnapshot,
    loadDecisions: decisionLog.loadDecisions,
    appendDecision: async (decision) => decisionLog.push(decision),
  };
  return { deps, store, controller, profiles, decisionLog };
}

/** Alias legible: el adaptador de decisiones en memoria ya persiste igual que producción. */
async function ensureAndSync(
  input: EnsureFirstMonthProrationInput,
  ctx: { deps: EnsureFirstMonthProrationDeps; decisionLog: ReturnType<typeof fakeDecisionLog> }
): Promise<EnsureFirstMonthProrationOutcome> {
  return ensureFirstMonthProrationDecision(input, ctx.deps);
}

// ---------------------------------------------------------------------------
// 1/2) Alumno mensual nuevo + primera serie a mitad de mes -> cargo
// proporcional. Ejemplo exacto del pedido: $80.000 -> $40.000.
// ---------------------------------------------------------------------------

asyncTest('1/2) alumno mensual nuevo + serie iniciada a mitad de mes: primer cargo exactamente $40.000 sobre una cuota de $80.000', async () => {
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });
  const rule = thursdayRule({ studentId: 'qa_s1' });

  const outcome = await ensureFirstMonthProrationDecision({
    studentId: 'qa_s1',
    activeSeries: [rule],
    exceptions: [],
    existingLessons: [],
    availability: null,
    realMutationDateKey: '2026-08-18',
  }, deps);

  assertEqual(outcome.status, 'decided', 'se aplica automáticamente, sin esperar confirmación');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.billingPeriod, '2026-08', 'período de agosto');
  assertEqual(outcome.result.decision.chargedAmount, 40000, 'exactamente la mitad — 2 de 4 jueves de agosto');
  assertEqual(outcome.result.decision.permanentMonthlyAmount, 80000, 'conserva la cuota habitual completa en el registro');

  const charge = controller.getSnapshot().charges.find((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assert(!!charge, 'se creó el cargo real');
  assertEqual(charge!.originalAmount, 40000, 'el cargo real también queda en $40.000, nunca $80.000');
});

asyncTest('el mes siguiente ya no es "primer mes": ensureFirstMonthProrationDecision nunca lo toca (queda para la generación mensual normal en 100%)', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, store } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );

  // Septiembre: septiembre ya tiene el cargo mensual COMPLETO generado por el
  // motor normal (fuera del alcance de este archivo) — ensure nunca debe
  // tocarlo porque agosto ya es historial mensual previo.
  const septemberCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-09',
    dueDate: '2026-09-01',
    originalAmount: 80000,
    createdAt: '2026-09-01T09:00:00.000Z',
    existingCharges: store.persisted.charges,
  });
  store.persisted = { ...store.persisted, charges: [...store.persisted.charges, septemberCharge] };

  // Simula que el mismo alumno se agrega a una TERCERA serie en octubre —
  // aunque octubre nunca haya tenido cargo, ya tiene historial mensual real
  // (agosto y septiembre) anterior a octubre, así que nada de esto puede
  // tratarse como su "primer mes".
  const outcome = await ensureFirstMonthProrationDecision(
    {
      studentId: 'qa_s1',
      activeSeries: [rule],
      exceptions: [],
      existingLessons: [],
      availability: null,
      realMutationDateKey: '2026-10-15',
    },
    deps
  );
  assertEqual(outcome.status, 'not_applicable', 'ya tiene historial mensual: nunca se reproratea');
  if (outcome.status !== 'not_applicable') return;
  assertEqual(outcome.reason, 'has_prior_monthly_history', 'motivo exacto');
  assertEqual(septemberCharge.originalAmount, 80000, 'septiembre queda intacto, con la cuota completa');
});

// ---------------------------------------------------------------------------
// 3) Importes enteros variados y pseudoaleatorios — nunca depende de un
// monto específico.
// ---------------------------------------------------------------------------

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

asyncTest('3) importes enteros pseudoaleatorios: la proporción siempre coincide con la fórmula central, nunca hardcodeada', async () => {
  const random = pseudoRandom(7);
  for (let i = 0; i < 25; i++) {
    const monthlyAmount = 5000 + Math.floor(random() * 500000);
    const studentId = `qa_random_${i}`;
    const rule = thursdayRule({ studentId, recurrenceId: `qa_rule_random_${i}` });
    const { deps, controller } = buildDeps({ profiles: { [studentId]: makeMonthlyProfile(studentId, monthlyAmount) } });

    const outcome = await ensureFirstMonthProrationDecision(
      { studentId, activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
      deps
    );
    assertEqual(outcome.status, 'decided', `iteración ${i}`);
    if (outcome.status !== 'decided') continue;
    const expected = computeProportionalAmount(monthlyAmount, 2, 4);
    assertEqual(outcome.result.decision.chargedAmount, expected, `iteración ${i}: cuota ${monthlyAmount}`);
    const charge = controller.getSnapshot().charges[0];
    assertEqual(charge.originalAmount, expected, `iteración ${i}: cargo real coincide`);
  }
});

// ---------------------------------------------------------------------------
// 4) Alumno agregado a una serie YA EXISTENTE a mitad de mes.
// ---------------------------------------------------------------------------

asyncTest('4) alumno agregado a una serie YA EXISTENTE (inicio en el pasado) a mitad de mes: usa la fecha real de la incorporación, no el inicio viejo de la serie', async () => {
  // La regla `thursdayRule` ya arranca en enero (serie vieja) — esto prueba
  // exactamente ese escenario: el alumno recién se agrega hoy (18/08).
  const rule = thursdayRule({ studentId: 'qa_s1', startDate: '2026-01-05' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', 'se decide igual, aunque la serie sea vieja');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.chargedAmount, 40000, 'sus clases de enero-julio nunca le corresponden');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'cargo real correcto');
});

// ---------------------------------------------------------------------------
// 5) Serie creada recientemente, antes de la corrección, sin decisión ->
// reparación automática (repara CREANDO el cargo que faltaba).
// ---------------------------------------------------------------------------

asyncTest('5) serie creada recientemente antes de la corrección, sin decisión todavía: la reparación (sin fecha de mutación real) crea sola el cargo que faltaba', async () => {
  // '2026-08-17' es el lunes real de esa semana (el anchor de "semana 0" de
  // la serie siempre debe ser un lunes) — la serie en sí es reciente
  // (arrancó a mitad de agosto): sus únicas 2 clases posibles ese mes son
  // 20 y 27/08. Corrección 2026-08-27 (quinta ronda — regla comercial por
  // ESCALÓN de ocurrencias, ver `computeProportionalAmount`): 2 ocurrencias
  // restantes siempre son exactamente el 50% de la cuota, sin importar si
  // esas 2 son o no el período completo de la serie — nunca 100% sólo
  // porque "restantes === habituales".
  const rule = thursdayRule({ studentId: 'qa_s1', startDate: '2026-08-17' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    // Sin realMutationDateKey a propósito: esto es reparación, no el
    // instante real de una alta — la fecha sale del propio inicio de la serie.
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null },
    deps
  );
  assertEqual(outcome.status, 'decided', 'la reparación detecta y aplica sola, sin intervención de la profesora');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.chargeCreated, true, 'no existía ningún cargo: lo crea, sin esperar a que la profesora abra el panel');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, '2 ocurrencias restantes = exactamente 50% de la cuota, por regla de escalón');
});


// ---------------------------------------------------------------------------
// 6) Serie creada al COMIENZO del período -> nunca aplica medio mes.
// ---------------------------------------------------------------------------

asyncTest('6) serie iniciada el primer día del período: cuota completa, nunca medio mes', async () => {
  // El lunes ancla de esa semana cae ANTES del 1/08 (que es sábado) — al
  // acotar contra el inicio real del período (`periodStart`), el resultado
  // es idéntico a "toda la serie por delante desde el día 1".
  const rule = thursdayRule({ studentId: 'qa_s1', startDate: '2026-07-27' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null },
    deps
  );
  assertEqual(outcome.status, 'decided', 'se decide igual (queda registrado que este mes es completo)');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.chargedAmount, 80000, 'con el período completo por delante, cuota completa — nunca reducida sin motivo');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 80000, 'cargo real: cuota completa');
});

// ---------------------------------------------------------------------------
// 7) Serie creada cerca del final del mes -> aplica la regla proporcional
// central (importe chico, nunca $0 salvo que de verdad no reste nada).
// ---------------------------------------------------------------------------

asyncTest('7) serie iniciada cerca del final del mes: importe chico, calculado por la misma regla central (nunca $0 mientras reste al menos una clase)', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    // 25/08: sólo queda el jueves 27 -> 1 de 4.
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-25' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.chargedAmount, computeProportionalAmount(80000, 1, 4), 'misma fórmula central, nunca un cálculo aparte');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 20000, '1 de 4 jueves = 20.000 exactos');
});

asyncTest('sin ninguna clase real restante: nunca un cargo en $0 — usa el criterio "sin cobro" del propio dominio', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    // 28/08: ya pasaron los 4 jueves de agosto -> 0 restantes.
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-28' },
    deps
  );
  assertEqual(outcome.status, 'decided', 'igual se registra la decisión (criterio sin cobro), nunca lanza');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.chargedAmount, 0, 'sin cobro este período');
  assertEqual(outcome.result.chargeCreated, false, 'nunca crea un PaymentCharge de $0 (el dominio los rechaza por diseño)');
  assertEqual(controller.getSnapshot().charges.length, 0, 'ningún cargo real creado');
});

// ---------------------------------------------------------------------------
// 8) Cambio diciembre -> enero.
// ---------------------------------------------------------------------------

asyncTest('8) cambio diciembre -> enero: el período de facturación cruza el año sin romperse', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1', startDate: '2026-12-07' }); // lunes real de esa semana
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-12-29' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.billingPeriod, '2026-12', 'el período sigue siendo diciembre de 2026, nunca enero');
  assertEqual(controller.getSnapshot().charges[0].billingPeriod, '2026-12', 'el cargo real también');
});

// ---------------------------------------------------------------------------
// 9) Buenos Aires / offsets: la función pura nunca reinterpreta las fechas
// ya resueltas — trabaja con date keys YYYY-MM-DD tal cual se las pasan
// (la resolución de huso horario es responsabilidad del llamador real,
// `localDateKeyInTimeZone`, verificado por separado en la suite de wiring).
// ---------------------------------------------------------------------------

asyncTest('9) date keys ya resueltos en huso de Buenos Aires se usan tal cual, sin reinterpretarlos', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.effectiveJoinDate, '2026-08-18', 'exactamente el date key recibido, sin corrimientos de huso horario');
  assertEqual(controller.getSnapshot().charges[0].dueDate, '2026-08-18', 'el vencimiento del cargo también usa la misma fecha, tal cual');
});

// ---------------------------------------------------------------------------
// 10) Dos guardados consecutivos -> una sola decisión y un solo cargo.
// ---------------------------------------------------------------------------

asyncTest('10) dos guardados consecutivos (mismo alumno/serie): sólo una decisión y un solo cargo, nunca duplicados', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller, decisionLog } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const firstOutcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(firstOutcome.status, 'decided', 'el primer guardado decide');

  // El segundo guardado ya ve la decisión persistida por el primero.
  const secondOutcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(secondOutcome.status, 'already_decided', 'el segundo guardado no vuelve a decidir');

  const charges = controller.getSnapshot().charges.filter((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assertEqual(charges.length, 1, 'un único cargo mensual, nunca dos');
});

// ---------------------------------------------------------------------------
// 11) Dos llamadas concurrentes -> sin cargos NI decisiones duplicadas.
// ---------------------------------------------------------------------------

asyncTest('11) dos llamadas concurrentes para el mismo alumno/período: nunca duplican cargo ni decisión', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller, decisionLog } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  await Promise.all([
    ensureFirstMonthProrationDecision(
      { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
      deps
    ),
    ensureFirstMonthProrationDecision(
      { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
      deps
    ),
  ]);

  const charges = controller.getSnapshot().charges.filter((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assertEqual(charges.length, 1, 'el id determinístico del cargo + la cola de mutación atómica evitan el duplicado');
  assertEqual(charges[0].originalAmount, 40000, 'con el importe correcto, sin importar cuál de las dos llamadas "ganó"');
  assertEqual(decisionLog.entries().length, 1, 'la serialización cubre también el registro de decisiones, no sólo el cargo');
});

// ---------------------------------------------------------------------------
// 12) Alumno agregado a DOS series -> una sola cuota mensual, no dos.
// ---------------------------------------------------------------------------

asyncTest('12) alumno con dos series activas simultáneas: una única cuota mensual que suma clases de ambas, nunca dos cargos', async () => {
  const ruleA = thursdayRule({ studentId: 'qa_s1', recurrenceId: 'qa_rule_a' });
  const ruleB: RecurrenceRule = {
    ...thursdayRule({ studentId: 'qa_s1', recurrenceId: 'qa_rule_b' }),
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 17, minute: 0, durationMinutes: 60 }] }], // lunes
  };
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [ruleA, ruleB], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  // Lunes restantes desde 18/08: 24,31 (2). Jueves restantes: 20,27 (2). Total remaining=4.
  // Lunes del mes completo: 03,10,17,24,31 (5). Jueves: 06,13,20,27 (4). Total full=9.
  assertEqual(outcome.result.decision.classesRemaining, 4, 'suma las clases restantes de las dos series');
  assertEqual(outcome.result.decision.classesPerFullPeriod, 9, 'suma las clases habituales de las dos series');
  assertEqual(outcome.result.decision.chargedAmount, computeProportionalAmount(80000, 4, 9), 'una sola cuota combinada, nunca una por serie');

  const charges = controller.getSnapshot().charges.filter((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assertEqual(charges.length, 1, 'un único cargo mensual para las dos series juntas');
});

// ---------------------------------------------------------------------------
// 13) Alumno dentro de un grupo -> mismo comportamiento que individual.
// ---------------------------------------------------------------------------

asyncTest('13) alumno dentro de una serie grupal: mismo cálculo que un alumno individual, sin verse afectado por sus compañeros', async () => {
  const groupRule = thursdayRule({ studentId: 'qa_s1', participantIds: ['qa_s1', 'qa_s2', 'qa_s3'] });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [groupRule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.chargedAmount, 40000, 'idéntico al caso individual — el grupo no cambia la fórmula');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'cargo real correcto para el alumno del grupo');
});

// ---------------------------------------------------------------------------
// 14) Cancelaciones/ausencias/reprogramaciones posteriores nunca modifican
// la cuota ya decidida — la decisión queda fija una vez tomada.
// ---------------------------------------------------------------------------

asyncTest('14) una vez decidido el primer mes, cancelar/ausentar/reprogramar clases después nunca cambia la cuota ya cargada', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller, decisionLog } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  const amountAfterFirstDecision = controller.getSnapshot().charges[0].originalAmount;

  // "Después" se cancela/reprograma todo — se vuelve a llamar con datos de
  // calendario completamente distintos (simulando cambios reales
  // posteriores). Como ya existe una decisión para (alumno, período), NUNCA
  // debe volver a calcular ni a tocar el cargo.
  const outcomeAfterChanges = await ensureAndSync(
    {
      studentId: 'qa_s1',
      activeSeries: [{ ...rule, status: 'active' }],
      exceptions: [],
      existingLessons: [],
      availability: null,
      realMutationDateKey: '2026-08-18',
    },
    { deps, decisionLog }
  );
  assertEqual(outcomeAfterChanges.status, 'already_decided', 'la decisión ya tomada nunca se recalcula por cambios posteriores en el calendario');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, amountAfterFirstDecision, 'el cargo permanece exactamente igual');
});

// ---------------------------------------------------------------------------
// 15) Cambio posterior de la cuota habitual -> primer cargo preservado,
// períodos futuros con la nueva cuota (usa la protección de reconciliación
// ya existente, ahora alimentada por una decisión creada automáticamente).
// ---------------------------------------------------------------------------

asyncTest('15) cambiar la cuota habitual DESPUÉS del primer mes proporcional nunca lo convierte retroactivamente en cuota completa', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;

  // La profesora sube la cuota habitual a $95.000 después del alta — la
  // reconciliación automática (arranque/foreground) corre después.
  const reconciliation = planMonthlyAmountReconciliationRepair({
    state: controller.getSnapshot(),
    students: [{ id: 'qa_s1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 95000, dueDay: 1 }),
    evaluationDate: '2026-08-25',
    firstMonthProrationDecisions: [outcome.result.decision],
  });
  assertEqual(reconciliation.actions.length, 0, 'la reconciliación reconoce la decisión y no toca nada');
  assertEqual(reconciliation.updatedCharges[0].originalAmount, 40000, 'agosto sigue en $40.000, pase lo que pase con la cuota habitual');
});

// ---------------------------------------------------------------------------
// 16) Cargo impago INCORRECTO (cuota completa por error, sin pagos) ->
// reparación segura: la operación canónica lo corrige.
// ---------------------------------------------------------------------------

asyncTest('16) cargo impago con importe incorrecto (cuota completa por error, sin pagos): la reparación lo corrige al importe proporcional real', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const wrongCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 80000, // incorrecto: debería ser proporcional
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  assertEqual(wrongCharge.id, chargeId, 'usa el mismo id determinístico que la operación canónica esperaría encontrar');

  const { deps, controller } = buildDeps({
    initialState: { ...emptyPaymentsState(), charges: [wrongCharge] },
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
  });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.chargeUpdated, true, 'actualiza el cargo existente, nunca crea uno nuevo');
  assertEqual(outcome.result.chargeCreated, false, '');
  const charges = controller.getSnapshot().charges.filter((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assertEqual(charges.length, 1, 'sigue siendo un único cargo — se corrige, nunca se duplica');
  assertEqual(charges[0].originalAmount, 40000, 'corregido al importe proporcional real');
});

// ---------------------------------------------------------------------------
// 17/18) Cargo parcial o totalmente pagado -> nunca se toca, historial y
// asignaciones preservados intactos.
// ---------------------------------------------------------------------------

async function assertMovementsPreserved(paidAmount: number, label: string) {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const charge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 80000, // incorrecto, pero YA TIENE un pago real encima
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  let state: PaymentsRepositoryState = { ...emptyPaymentsState(), charges: [charge] };
  const paymentRecord = recordPayment({
    id: 'qa_payment_1',
    studentId: 'qa_s1',
    amount: paidAmount,
    method: 'efectivo',
    paidAt: '2026-08-19',
    recordedAt: '2026-08-19T10:00:00.000Z',
    todayDateKey: '2026-08-19',
  });
  state = { ...state, payments: [...state.payments, paymentRecord] };
  const allocation = allocatePayment({ id: 'qa_alloc_1', paymentId: paymentRecord.id, chargeId: charge.id, amount: paidAmount, state });
  state = { ...state, allocations: [...state.allocations, allocation] };

  const { deps, controller } = buildDeps({
    initialState: state,
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
  });
  await controller.hydrate(); // el snapshot en memoria sólo refleja lo sembrado después de hidratar.

  const beforeSnapshot = JSON.stringify(controller.getSnapshot());

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'skipped_has_movements', `${label}: nunca se toca en silencio`);

  const afterSnapshot = JSON.stringify(controller.getSnapshot());
  assertEqual(afterSnapshot, beforeSnapshot, `${label}: cargo, pago y asignación quedan byte a byte idénticos — nada se reescribe ni se borra`);
}

asyncTest('17) cargo con pago PARCIAL: historial y asignaciones preservados, nunca reescritos en silencio', async () => {
  await assertMovementsPreserved(30000, 'pago parcial');
});

asyncTest('18) cargo TOTALMENTE pagado: nunca se borra ni se reescribe en silencio', async () => {
  await assertMovementsPreserved(80000, 'pago completo');
});

// ---------------------------------------------------------------------------
// 19) Reinicio y vuelta de segundo plano -> permanece correcto (repetir la
// reparación en modo "reinicio" — sin fecha de mutación real — sobre un
// estado ya decidido nunca lo altera).
// ---------------------------------------------------------------------------

asyncTest('19) reinicio/vuelta de segundo plano (repetir en modo reparación): la decisión y el cargo ya tomados permanecen exactamente iguales', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1', startDate: '2026-08-17' }); // lunes real de esa semana
  const { deps, controller, decisionLog } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  const afterFirstRun = controller.getSnapshot().charges[0].originalAmount;

  // "Reinicio": la app vuelve a correr la reparación automática, ahora SIN
  // el instante real de la mutación (nunca "ahora" en una reparación) — la
  // fecha efectiva vuelve a salir sólo del inicio real de la serie, que
  // sigue cayendo dentro del mismo período de agosto ya decidido.
  const outcomeOnRestart = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null },
    { deps, decisionLog }
  );
  assertEqual(outcomeOnRestart.status, 'already_decided', 'el reinicio reconoce que ya estaba decidido');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, afterFirstRun, 'permanece exactamente igual tras el reinicio');
});

// ---------------------------------------------------------------------------
// 20) Respaldo y restauración: la decisión ya participa del respaldo v2
// best-effort (`firstMonthProrationBackup.test.ts`, sin cambios de esta
// corrección) — acá se confirma que el objeto que esta operación produce
// tiene exactamente la forma que ese mecanismo de respaldo espera.
// ---------------------------------------------------------------------------

asyncTest('20) la decisión producida tiene la forma completa que el respaldo v2 ya sabe conservar (id, alumno, período, cargo, importes, fechas)', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  const decision = outcome.result.decision;
  assert(typeof decision.id === 'string' && decision.id.length > 0, 'id presente');
  assertEqual(decision.studentId, 'qa_s1', '');
  assertEqual(decision.billingPeriod, '2026-08', '');
  assertEqual(decision.chargeId, controller.getSnapshot().charges[0].id, 'el chargeId de la decisión coincide con el cargo real, sin duplicar la relación');
  assert(typeof decision.createdAt === 'string' && typeof decision.confirmedAt === 'string', 'fechas presentes');
});

// ---------------------------------------------------------------------------
// 21) Alumno por clase suelta -> completamente excluido.
// ---------------------------------------------------------------------------

asyncTest('21) alumno con plan "por clase" (nunca mensual): completamente excluido, nunca inventa un prorrateo', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makePerClassProfile('qa_s1', 15000) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'not_applicable', '');
  if (outcome.status !== 'not_applicable') return;
  assertEqual(outcome.reason, 'no_monthly_plan', 'motivo exacto: no es un plan mensual');
  assertEqual(controller.getSnapshot().charges.length, 0, 'ningún cargo mensual inventado');
});

// ---------------------------------------------------------------------------
// 22) Alumno sin ninguna serie -> no inventar prorrateo.
// ---------------------------------------------------------------------------

asyncTest('22) alumno mensual sin ninguna serie activa: nada que hacer, nunca inventa un prorrateo', async () => {
  const { deps, controller } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'not_applicable', '');
  if (outcome.status !== 'not_applicable') return;
  assertEqual(outcome.reason, 'no_active_series', 'motivo exacto');
  assertEqual(controller.getSnapshot().charges.length, 0, 'sin cargos');
});

// ---------------------------------------------------------------------------
// 23) Fecha inválida / datos insuficientes -> nunca muta, devuelve un
// resultado explícito.
// ---------------------------------------------------------------------------

asyncTest('23) alumno inexistente (datos insuficientes): nunca muta nada, devuelve un resultado explícito', async () => {
  const rule = thursdayRule({ studentId: 'qa_fantasma' });
  const { deps, controller } = buildDeps({ profiles: {} }); // sin perfil real

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_fantasma', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'not_applicable', '');
  if (outcome.status !== 'not_applicable') return;
  assertEqual(outcome.reason, 'insufficient_data', 'motivo exacto');
  assertEqual(controller.getSnapshot().charges.length, 0, 'no muta nada');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27 (a pedido de Joaquín — EL PRIMER MES SIGUE COBRANDO
// LA CUOTA COMPLETA): reproduce el estado PERSISTIDO defectuoso real — una
// decisión de primer mes YA EXISTE para (alumno, período), pero el cargo
// real sigue en la cuota completa (o la decisión misma quedó mal calculada
// por un bug ya corregido). Antes, la sola EXISTENCIA de una decisión
// bloqueaba para siempre `ensureFirstMonthProrationDecision` — ahora se
// revalida contra los campos ya congelados de esa misma decisión (nunca
// contra el calendario actual) y se repara el ÚNICO cargo canónico si
// diverge y no tiene movimientos reales.
// ---------------------------------------------------------------------------

/** Decisión de primer mes construida a mano — simula un registro YA
 * persistido (automático, histórico sin `source`, manual, o correcto)
 * en vez de pasar por `confirmFirstMonthProration`. */
function makeStaleDecision(
  overrides: Partial<FirstMonthProrationDecision> & { studentId: string; billingPeriod: string; chargeId: string | null }
): FirstMonthProrationDecision {
  return {
    id: `qa_decision_${overrides.studentId}_${overrides.billingPeriod}`,
    effectiveJoinDate: `${overrides.billingPeriod}-18`,
    criterion: 'proportional',
    classesRemaining: 2,
    classesPerFullPeriod: 4,
    permanentMonthlyAmount: AUGUST_MONTHLY_AMOUNT,
    chargedAmount: 40000,
    createdAt: '2026-08-18T09:00:00.000Z',
    confirmedAt: '2026-08-18T09:00:00.000Z',
    source: 'automatic',
    ...overrides,
  };
}

function seedWrongFullCharge(studentId: string, billingPeriod: string, dueDate: string): PaymentsRepositoryState {
  const charge = buildMonthlyCharge({
    studentId,
    billingPeriod,
    dueDate,
    originalAmount: AUGUST_MONTHLY_AMOUNT, // cuota completa: el estado defectuoso real reportado
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  return { ...emptyPaymentsState(), charges: [charge] };
}

asyncTest('24) decisión AUTOMÁTICA ya existente pero con importe incorrecto (bug histórico ya corregido): se repara al importe canónico real', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const staleDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    source: 'automatic',
    chargedAmount: AUGUST_MONTHLY_AMOUNT, // incorrecto: su propia fórmula (2 de 4) da 40.000
  });
  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [staleDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'decided', 'la decisión automática vieja no bloquea la reparación');
  if (outcome.status !== 'decided') return;
  assertEqual(outcome.result.decision.chargedAmount, 40000, 'importe corregido: 2 de 4, igual que la fórmula canónica');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'el cargo real queda corregido, nunca en $80.000');
  assertEqual(decisionLog.entries().length, 2, 'se agrega una entrada NUEVA — la vieja incorrecta nunca se edita ni se borra');
});

asyncTest('25) [CORREGIDO, segunda ronda] decisión HISTÓRICA sin `source` y criterio `proportional` (ambiguo — pudo ser manual): NUNCA se asume automática, se señala para revisión, nada se toca', async () => {
  // Esta prueba reemplaza a la versión original (ronda 1), que asumía "sin
  // source = automática" — un hueco de seguridad real: el panel manual
  // también pudo producir criterion 'proportional' sin este campo.
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const staleDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    chargedAmount: AUGUST_MONTHLY_AMOUNT, // podría "parecer" incorrecto, pero el origen es ambiguo
  });
  delete (staleDecision as Partial<FirstMonthProrationDecision>).source; // simula un registro restaurado de antes de este campo

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [staleDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'needs_manual_review', 'origen ambiguo: nunca se asume automática sin evidencia');
  if (outcome.status !== 'needs_manual_review') return;
  assertEqual(outcome.reason, 'ambiguous_historical_decision', 'motivo exacto');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, AUGUST_MONTHLY_AMOUNT, 'el cargo no se toca — podría ser una elección manual real');
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión nueva agregada sobre un origen ambiguo');
});

asyncTest('25b) decisión MANUAL histórica sin `source` pero con criterio `full` (sólo el panel manual pudo elegirlo): NUNCA se toca, aunque el cargo "parezca" incorrecto', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const oldManualDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    criterion: 'full', // sólo el panel manual ofrece este criterio — nunca el camino automático
    chargedAmount: AUGUST_MONTHLY_AMOUNT,
  });
  delete (oldManualDecision as Partial<FirstMonthProrationDecision>).source; // de antes de que existiera el campo

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [oldManualDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'already_decided', 'criterion "full" sin source: reconocida como manual histórica, se preserva');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, AUGUST_MONTHLY_AMOUNT, 'nunca se pisa una elección manual real');
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión nueva agregada');
});

asyncTest('25c) decisión MANUAL histórica sin `source` con criterio `custom` (sólo el panel manual lo ofrece): NUNCA se toca', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const oldCustomDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    criterion: 'custom',
    chargedAmount: 55000, // importe personalizado real, elegido a mano
  });
  delete (oldCustomDecision as Partial<FirstMonthProrationDecision>).source;

  const customCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 55000,
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });

  const { deps, controller, decisionLog } = buildDeps({
    initialState: { ...emptyPaymentsState(), charges: [customCharge] },
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [oldCustomDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'already_decided', 'criterion "custom" sin source: reconocida como manual histórica, se preserva');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 55000, 'el importe personalizado real nunca se reinterpreta');
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión nueva agregada');
});

asyncTest('26) decisión CORRECTA (su propia fórmula ya da 40.000) pero el cargo real quedó desactualizado en $80.000: se resincroniza el cargo', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  // La decisión en sí YA es correcta (chargedAmount coincide con su propia
  // fórmula congelada) — el defecto está sólo en el cargo real, que alguna
  // otra vía dejó en la cuota completa.
  const correctDecision = makeStaleDecision({ studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, chargedAmount: 40000 });

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [correctDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'decided', 'el cargo desactualizado se repara aunque la decisión ya fuera correcta');
  if (outcome.status !== 'decided') return;
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'el cargo se resincroniza al importe que la propia decisión ya tenía correcto');
});

asyncTest('27) decisión MANUAL explícita (source: "manual") con un importe distinto al canónico: NUNCA se toca, ni el cargo ni la decisión', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  // La profesora eligió a mano cobrar la cuota completa este primer mes
  // (criterion 'full') — el canónico proporcional daría 40.000, pero es una
  // elección explícita suya: nunca se pisa en silencio.
  const manualDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    source: 'manual',
    criterion: 'full',
    chargedAmount: AUGUST_MONTHLY_AMOUNT,
  });

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [manualDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'already_decided', 'decisión manual: se preserva siempre, sin importar el canónico');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, AUGUST_MONTHLY_AMOUNT, 'el cargo queda exactamente como la profesora lo decidió');
  assertEqual(decisionLog.entries().length, 1, 'ninguna entrada nueva — nunca se reinterpreta una decisión manual');
});

asyncTest('28) decisión ya existente + cargo con pago PARCIAL real: skipped_has_movements, nada se toca (nunca se reescribe en silencio)', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const staleDecision = makeStaleDecision({ studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, chargedAmount: AUGUST_MONTHLY_AMOUNT });

  let state = seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18');
  const paymentRecord = recordPayment({
    id: 'qa_payment_28',
    studentId: 'qa_s1',
    amount: 30000,
    method: 'efectivo',
    paidAt: '2026-08-19',
    recordedAt: '2026-08-19T10:00:00.000Z',
    todayDateKey: '2026-08-19',
  });
  state = { ...state, payments: [...state.payments, paymentRecord] };
  const allocation = allocatePayment({ id: 'qa_alloc_28', paymentId: paymentRecord.id, chargeId, amount: 30000, state });
  state = { ...state, allocations: [...state.allocations, allocation] };

  const { deps, controller, decisionLog } = buildDeps({
    initialState: state,
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [staleDecision],
  });
  await controller.hydrate();
  const beforeSnapshot = JSON.stringify(controller.getSnapshot());

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'skipped_has_movements', 'tiene un pago real asignado: nunca se corrige en silencio');
  assertEqual(JSON.stringify(controller.getSnapshot()), beforeSnapshot, 'cargo, pago y asignación quedan byte a byte idénticos');
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión nueva agregada sobre un cargo con movimientos');
});

asyncTest('29) cargo ya VENCIDO ("Mes vencido") con decisión desactualizada: se repara igual, estar vencido no lo excluye', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const staleDecision = makeStaleDecision({ studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, chargedAmount: AUGUST_MONTHLY_AMOUNT });

  const { deps, controller, decisionLog } = buildDeps({
    // Vence 18/08, evaluado muchísimo después — exactamente el escenario
    // real reportado ("Mes vencido" en Centro de cobros).
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [staleDecision],
  });

  const outcome = await ensureAndSync(
    {
      studentId: 'qa_s1',
      activeSeries: [rule],
      exceptions: [],
      existingLessons: [],
      availability: null,
      realMutationDateKey: '2026-08-18',
      now: new Date('2026-09-15T12:00:00.000Z'),
    },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'decided', 'un cargo vencido también se repara');
  if (outcome.status !== 'decided') return;
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'corregido pese a estar vencido');
});

asyncTest('30) repetir la reparación no duplica nada: segunda ejecución es no-op, ninguna decisión ni cargo nuevos', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const staleDecision = makeStaleDecision({ studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, chargedAmount: AUGUST_MONTHLY_AMOUNT });

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [staleDecision],
  });

  const first = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(first.status, 'decided', 'primera ejecución: corrige');
  assertEqual(decisionLog.entries().length, 2, 'una única entrada nueva tras la primera corrida');

  const second = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(second.status, 'already_decided', 'segunda ejecución: no vuelve a modificar ni duplicar');
  assertEqual(decisionLog.entries().length, 2, 'sigue en 2 — la segunda corrida no agrega una tercera entrada');

  const charges = controller.getSnapshot().charges.filter((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assertEqual(charges.length, 1, 'un único cargo, nunca duplicado');
  assertEqual(charges[0].originalAmount, 40000, 'permanece en el importe corregido');
});

asyncTest('31) cierre y reapertura de la app conservan la reparación ya aplicada (simulado con una segunda corrida "en frío")', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const staleDecision = makeStaleDecision({ studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, chargedAmount: AUGUST_MONTHLY_AMOUNT });

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [staleDecision],
  });

  await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  const amountAfterRepair = controller.getSnapshot().charges[0].originalAmount;
  assertEqual(amountAfterRepair, 40000, 'reparado en la primera corrida (arranque)');

  // "Reapertura": misma reparación automática vuelve a correr en el próximo
  // arranque/vuelta a primer plano, sin ningún dato nuevo.
  const onReopen = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(onReopen.status, 'already_decided', 'la reapertura reconoce que ya está reparado');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, amountAfterRepair, 'conserva exactamente el importe ya corregido');
});

asyncTest('32) [CORREGIDO, segunda ronda] restauración desde respaldo: decisión sin `source` y criterio ambiguo, aunque el cargo YA coincida, se señala para revisión (nunca se asume automática)', async () => {
  // Reemplaza a la versión original (ronda 1): que el cargo ya coincida
  // numéricamente no prueba que el origen sea automático — sigue siendo
  // ambiguo, así que igual se señala, nunca se declara "ya decidido" sin más.
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const alreadyCorrectCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 40000, // ya coincide numéricamente
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  const restoredDecision = makeStaleDecision({ studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, chargedAmount: 40000 });
  delete (restoredDecision as Partial<FirstMonthProrationDecision>).source; // respaldo de antes del campo

  const { deps, controller, decisionLog } = buildDeps({
    initialState: { ...emptyPaymentsState(), charges: [alreadyCorrectCharge] },
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [restoredDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'needs_manual_review', 'origen ambiguo, aunque el importe ya coincida');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'sin cambios de todos modos');
  assertEqual(decisionLog.entries().length, 1, 'restaurar un respaldo nunca agrega una decisión de más, coincida o no');
});

asyncTest('32b) restauración desde respaldo: decisión con `source: "automatic"` explícito que YA coincide con el cargo real: se preserva sin agregar nada', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const alreadyCorrectCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 40000,
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  const restoredDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    chargedAmount: 40000,
    source: 'automatic',
  });

  const { deps, controller, decisionLog } = buildDeps({
    initialState: { ...emptyPaymentsState(), charges: [alreadyCorrectCharge] },
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [restoredDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'already_decided', 'origen automático confirmado y ya coincide: nada que reparar');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'sin cambios');
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión nueva de más');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, segunda ronda — HUECO 2: decisión internamente
// CONSISTENTE (su propio chargedAmount coincide con la fórmula aplicada a
// sus propios classesRemaining/classesPerFullPeriod) pero esos campos
// congelados en sí fueron calculados mal en su momento (classesRemaining
// quedó igual a classesPerFullPeriod — "100%" — pese a que el alta real fue
// a mitad de período). Recalcular con esos mismos campos defectuosos
// reproduce el mismo resultado incorrecto: no hay ninguna evidencia
// determinista, guardada en la propia decisión, que permita reconstruir la
// proporción real sin arriesgar usar el calendario actual (posibles
// cancelaciones posteriores) o inventar un dato. Con origen ambiguo (sin
// `source`), esto ya cae en la misma protección del HUECO 1 — se señala
// para revisión manual, nunca se repara a ciegas ni se declara "correcto"
// en silencio.
// ---------------------------------------------------------------------------

asyncTest('34) decisión internamente consistente pero calculada mal (classesRemaining === classesPerFullPeriod pese a alta real a mitad de período): nunca se repara a ciegas ni se da por buena, se señala para revisión', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  // Su propia fórmula (100% de un período completo) SÍ da $80.000 — la
  // decisión es matemáticamente autoconsistente — pero classesRemaining
  // debería haber sido menor: el alta real fue el 18/08 (effectiveJoinDate),
  // a mitad del período, no el día 1.
  const internallyConsistentButWrongDecision = makeStaleDecision({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    effectiveJoinDate: '2026-08-18', // alta real a mitad de período
    classesRemaining: 4,
    classesPerFullPeriod: 4, // "100%" — el bug histórico real: nunca debió coincidir con el total
    permanentMonthlyAmount: AUGUST_MONTHLY_AMOUNT,
    chargedAmount: AUGUST_MONTHLY_AMOUNT, // consistente con su propia fórmula (100% × cuota completa)
  });
  delete (internallyConsistentButWrongDecision as Partial<FirstMonthProrationDecision>).source;

  const { deps, controller, decisionLog } = buildDeps({
    initialState: seedWrongFullCharge('qa_s1', '2026-08', '2026-08-18'),
    profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) },
    decisions: [internallyConsistentButWrongDecision],
  });

  const outcome = await ensureAndSync(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    { deps, decisionLog }
  );
  assertEqual(outcome.status, 'needs_manual_review', 'sin evidencia determinista para reconstruir la proporción real: nunca se inventa, se señala');
  if (outcome.status !== 'needs_manual_review') return;
  assertEqual(outcome.reason, 'ambiguous_historical_decision', 'motivo exacto');
  assertEqual(
    controller.getSnapshot().charges[0].originalAmount,
    AUGUST_MONTHLY_AMOUNT,
    'el cargo NUNCA se reescribe a ciegas — recalcular con los propios campos defectuosos reproduciría el mismo error'
  );
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión inventada ni duplicada');
});

asyncTest('33) proporciones e importes pseudoaleatorios a través del camino de REPARACIÓN: siempre la fórmula central, nunca hardcodeado', async () => {
  // Corrección 2026-08-27 (quinta ronda — regla comercial por ESCALÓN de
  // ocurrencias): la regla vigente es más "gruesa" que la proporción lineal
  // anterior — varios valores de classesRemaining (3 en adelante) mapean al
  // mismo 100% que ya tenía el cargo "incorrecto a propósito" de este
  // fixture, así que para esas combinaciones aleatorias la reparación no
  // tiene nada que corregir (`already_decided`) en vez de aplicar un cambio
  // (`decided`) — ambos son resultados válidos según el caso. Lo único que
  // debe verificarse siempre, sin importar el status, es que el cargo real
  // final coincide con la fórmula central `computeProportionalAmount`.
  const random = pseudoRandom(19);
  for (let i = 0; i < 20; i++) {
    const monthlyAmount = 5000 + Math.floor(random() * 500000);
    const classesPerFullPeriod = 2 + Math.floor(random() * 6); // 2..7
    const classesRemaining = 1 + Math.floor(random() * (classesPerFullPeriod - 1)); // 1..(full-1), siempre proporcional real
    const studentId = `qa_repair_random_${i}`;
    const billingPeriod = '2026-08';
    const chargeId = buildMonthlyChargeId(studentId, billingPeriod);
    const rule = thursdayRule({ studentId, recurrenceId: `qa_rule_repair_${i}` });

    const staleDecision = makeStaleDecision({
      studentId,
      billingPeriod,
      chargeId,
      classesRemaining,
      classesPerFullPeriod,
      permanentMonthlyAmount: monthlyAmount,
      chargedAmount: monthlyAmount, // incorrecto a propósito: cuota completa en vez de proporcional
    });
    const wrongCharge = buildMonthlyCharge({
      studentId,
      billingPeriod,
      dueDate: '2026-08-18',
      originalAmount: monthlyAmount,
      createdAt: '2026-08-18T09:00:00.000Z',
      existingCharges: [],
    });

    const { deps, controller, decisionLog } = buildDeps({
      initialState: { ...emptyPaymentsState(), charges: [wrongCharge] },
      profiles: { [studentId]: makeMonthlyProfile(studentId, monthlyAmount) },
      decisions: [staleDecision],
    });

    const outcome = await ensureAndSync(
      { studentId, activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
      { deps, decisionLog }
    );
    const expected = computeProportionalAmount(monthlyAmount, classesRemaining, classesPerFullPeriod);
    assert(
      outcome.status === 'decided' || outcome.status === 'already_decided',
      `iteración ${i}: status inesperado ${outcome.status}`
    );
    if (outcome.status === 'decided') {
      assertEqual(outcome.result.decision.chargedAmount, expected, `iteración ${i}: ${classesRemaining}/${classesPerFullPeriod} de ${monthlyAmount}`);
    }
    assertEqual(controller.getSnapshot().charges[0].originalAmount, expected, `iteración ${i}: cargo real coincide con la fórmula central`);
  }
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, quinta ronda (a pedido de Joaquín — CORRECCIÓN
// DEFINITIVA DE LA REGLA DEL PRIMER MES): serie GRUPAL con fecha de
// incorporación DISTINTA por alumno — cada uno se calcula de forma
// independiente, con su propio escalón, aunque compartan exactamente la
// misma serie (mismo recurrenceId, mismo patrón semanal, misma cuota).
// ---------------------------------------------------------------------------

asyncTest('serie grupal con incorporación en fechas distintas por alumno: cada alumno recibe su propio escalón, calculado de forma independiente', async () => {
  // Misma serie grupal para los 3 (jueves, agosto 2026: 06, 13, 20, 27 -> 4 habituales).
  const groupRule = thursdayRule({ studentId: 'qa_group_a', participantIds: ['qa_group_a', 'qa_group_b', 'qa_group_c'] });

  const { deps: depsA, controller: controllerA } = buildDeps({
    profiles: { qa_group_a: makeMonthlyProfile('qa_group_a', AUGUST_MONTHLY_AMOUNT) },
  });
  const outcomeA = await ensureFirstMonthProrationDecision(
    // Se une el 18/08: quedan jueves 20 y 27 -> 2 restantes -> escalón 50%.
    { studentId: 'qa_group_a', activeSeries: [groupRule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    depsA
  );
  assertEqual(outcomeA.status, 'decided', 'alumno A');
  if (outcomeA.status === 'decided') {
    assertEqual(outcomeA.result.decision.chargedAmount, 40000, 'alumno A: 2 restantes -> exactamente 50%');
    assertEqual(controllerA.getSnapshot().charges[0].originalAmount, 40000, 'alumno A: cargo real 50%');
  }

  const { deps: depsB, controller: controllerB } = buildDeps({
    profiles: { qa_group_b: makeMonthlyProfile('qa_group_b', AUGUST_MONTHLY_AMOUNT) },
  });
  const outcomeB = await ensureFirstMonthProrationDecision(
    // Se une el 25/08: sólo queda el jueves 27 -> 1 restante -> valor de una clase.
    { studentId: 'qa_group_b', activeSeries: [groupRule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-25' },
    depsB
  );
  assertEqual(outcomeB.status, 'decided', 'alumno B');
  if (outcomeB.status === 'decided') {
    assertEqual(outcomeB.result.decision.chargedAmount, 20000, 'alumno B: 1 restante -> valor de una clase (80.000/4)');
    assertEqual(controllerB.getSnapshot().charges[0].originalAmount, 20000, 'alumno B: cargo real = valor de una clase');
  }

  const { deps: depsC, controller: controllerC } = buildDeps({
    profiles: { qa_group_c: makeMonthlyProfile('qa_group_c', AUGUST_MONTHLY_AMOUNT) },
  });
  const outcomeC = await ensureFirstMonthProrationDecision(
    // Se une el 01/08: quedan los 4 jueves -> 4 restantes -> cuota completa.
    { studentId: 'qa_group_c', activeSeries: [groupRule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-01' },
    depsC
  );
  assertEqual(outcomeC.status, 'decided', 'alumno C');
  if (outcomeC.status === 'decided') {
    assertEqual(outcomeC.result.decision.chargedAmount, 80000, 'alumno C: 4 restantes -> cuota completa');
    assertEqual(controllerC.getSnapshot().charges[0].originalAmount, 80000, 'alumno C: cargo real completo');
  }
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, cuarta ronda (a pedido de Joaquín — SOLUCIÓN
// ESTRUCTURAL DEFINITIVA — PRORRATEO AUTOMÁTICO AL VINCULAR UN ALUMNO):
// evidencia persistida en el mismo instante de la vinculación —
// recurrenceIds, patrón semanal congelado y versión de la regla. Congelada
// para siempre en la propia decisión: nunca se recalcula contra el store
// más tarde, así que sobrevive aunque la serie se edite, se pause o se
// elimine después.
// ---------------------------------------------------------------------------

asyncTest('35) evidencia persistida: recurrenceIds, patrón semanal congelado y versión de la regla quedan en la decisión automática', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;

  assertEqual(JSON.stringify(outcome.result.decision.recurrenceIds), JSON.stringify([rule.recurrenceId]), 'identidad de la serie real que aportó las clases');
  assertEqual(
    JSON.stringify(outcome.result.decision.seriesPatternSnapshot),
    JSON.stringify([{ recurrenceId: rule.recurrenceId, cycleLengthWeeks: rule.cycleLengthWeeks, weeks: rule.weeks }]),
    'copia congelada del patrón semanal vigente en el momento exacto de la decisión'
  );
  assertEqual(outcome.result.decision.ruleVersion, FIRST_MONTH_PRORATION_RULE_VERSION, 'versión de la regla vigente');
});

asyncTest('36) alumno con DOS series activas simultáneas: la evidencia incluye AMBOS recurrenceIds y AMBOS patrones, nunca sólo el último tocado', async () => {
  const ruleA = thursdayRule({ studentId: 'qa_s1', recurrenceId: 'qa_rule_a' });
  const ruleB: RecurrenceRule = {
    ...thursdayRule({ studentId: 'qa_s1', recurrenceId: 'qa_rule_b' }),
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 17, minute: 0, durationMinutes: 60 }] }], // lunes
  };
  const { deps } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [ruleA, ruleB], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;

  assertEqual(
    JSON.stringify([...(outcome.result.decision.recurrenceIds ?? [])].sort()),
    JSON.stringify(['qa_rule_a', 'qa_rule_b']),
    'las dos series activas quedan identificadas, nunca sólo una'
  );
  assertEqual(outcome.result.decision.seriesPatternSnapshot?.length, 2, 'un snapshot de patrón por cada serie que aportó clases');
});

asyncTest('37) la evidencia congelada nunca cambia si la serie se edita DESPUÉS — es una copia real, no una referencia compartida', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;
  const frozenSnapshotBefore = JSON.stringify(outcome.result.decision.seriesPatternSnapshot);

  // "Editar la serie DESPUÉS" — se muta el mismo objeto rule que se pasó
  // (simula lo que haría un editor real de RecurrenceOptions.tsx).
  rule.weeks[0].sessions[0].hour = 20;
  rule.weeks.push({ weekIndex: 1, sessions: [{ weekday: 5, hour: 10, minute: 0, durationMinutes: 45 }] });

  assertEqual(
    JSON.stringify(outcome.result.decision.seriesPatternSnapshot),
    frozenSnapshotBefore,
    'la copia congelada en la decisión ya devuelta nunca refleja una edición posterior de la serie'
  );
});

asyncTest('39) respaldo y restauración: la evidencia (recurrenceIds/seriesPatternSnapshot/ruleVersion) sobrevive un round-trip real de JSON.stringify/parse', async () => {
  const rule = thursdayRule({ studentId: 'qa_s1' });
  const { deps } = buildDeps({ profiles: { qa_s1: makeMonthlyProfile('qa_s1', AUGUST_MONTHLY_AMOUNT) } });

  const outcome = await ensureFirstMonthProrationDecision(
    { studentId: 'qa_s1', activeSeries: [rule], exceptions: [], existingLessons: [], availability: null, realMutationDateKey: '2026-08-18' },
    deps
  );
  assertEqual(outcome.status, 'decided', '');
  if (outcome.status !== 'decided') return;

  const persisted = JSON.stringify([outcome.result.decision]);
  const restored = parsePersistedFirstMonthProrationDecisionLog(persisted);
  assertEqual(restored.length, 1, 'la decisión sobrevive el round-trip completo');
  assertEqual(JSON.stringify(restored[0].recurrenceIds), JSON.stringify(outcome.result.decision.recurrenceIds), 'recurrenceIds conservado');
  assertEqual(
    JSON.stringify(restored[0].seriesPatternSnapshot),
    JSON.stringify(outcome.result.decision.seriesPatternSnapshot),
    'seriesPatternSnapshot conservado'
  );
  assertEqual(restored[0].ruleVersion, outcome.result.decision.ruleVersion, 'ruleVersion conservado');
});
