// Puerto VERBATIM del original (`src/features/payments/services/__tests__/chargeGenerationConcurrency.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentsRepositoryState } from '../../types/index.ts';
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { generateMonthlyChargesForCandidates } from '../monthlyChargeGenerationService.ts';
import { reconcileChargesForLessons } from '../perClassChargeReconciliationService.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../../utils/paymentDates.ts';
import type { SavedLesson } from '../../../new-class/types/index.ts';
import { asyncTest, assert, assertEqual } from '../../../calendar/utils/__tests__/testHarness.ts';

function makeFakeAdapter() {
  const store = { persisted: emptyPaymentsState() };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state: PaymentsRepositoryState) => {
      store.persisted = state;
    },
  };
  return { adapter, store };
}

function form(overrides: Partial<SavedLesson['form']> & { studentIds: string[] }): SavedLesson['form'] {
  return {
    eventType: 'clase_dictada',
    date: '2026-07-11',
    time: '10:00',
    scheduledDurationMinutes: 60,
    actualDurationMinutes: 60,
    modality: 'presencial',
    attendance: [],
    topics: [],
    objectives: [],
    activities: [],
    activityNotes: '',
    activityAttachments: [],
    materialIds: [],
    evaluations: [],
    internalNotes: '',
    homeworkDescription: '',
    homeworkDueDate: null,
    isBillable: true,
    lateCancellationPolicy: null,
    lateCancellationPercentage: null,
    consumesMonthlyPackage: true,
    holidayException: false,
    rescheduledFromLessonId: null,
    ...overrides,
  };
}

function savedLesson(overrides: Partial<SavedLesson> & { id: string; form: SavedLesson['form'] }): SavedLesson {
  return {
    createdAt: '2026-07-11T12:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
  };
}

asyncTest('dos generaciones mensuales simultáneas para el mismo alumno/mes terminan con un solo cargo', async () => {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const candidates = [{ studentId: 's1', price: 20000 }];

  // Dos "aperturas de la app" que arrancan casi juntas, sin esperar una a
  // la otra — exactamente el escenario reportado: ambas leerían el mismo
  // snapshot vacío si el plan se calculara ANTES de entrar a la cola.
  const [outcomeA, outcomeB] = await Promise.all([
    generateMonthlyChargesForCandidates(candidates, '2026-07', '2026-07-01T09:00:00.000Z', deps),
    generateMonthlyChargesForCandidates(candidates, '2026-07', '2026-07-01T09:00:01.000Z', deps),
  ]);

  assertEqual(store.persisted.charges.length, 1, 'sólo un cargo terminó persistido, no dos');
  const totalCreated = outcomeA.createdChargeIds.length + outcomeB.createdChargeIds.length;
  assertEqual(totalCreated, 1, 'sólo una de las dos llamadas reporta haber creado el cargo; la otra lo ve ya existente');

  const ids = new Set(store.persisted.charges.map((charge) => charge.id));
  assertEqual(ids.size, store.persisted.charges.length, 'sin ids financieros duplicados');
});

asyncTest('dos reconciliaciones de cargos por clase simultáneas para la misma clase terminan con un solo cargo', async () => {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1'] }),
    billedAmount: 9500,
    billedAmountByStudent: { s1: 9500 },
  });
  const getProfile = () => ({ billingType: 'por_clase' as const, price: 9500 });

  const [outcomeA, outcomeB] = await Promise.all([
    reconcileChargesForLessons([lesson], getProfile, '2026-07-11T12:00:00.000Z', deps),
    reconcileChargesForLessons([lesson], getProfile, '2026-07-11T12:00:01.000Z', deps),
  ]);

  assertEqual(store.persisted.charges.length, 1, 'sólo un cargo por clase terminó persistido, no dos');
  const totalCreated = outcomeA.createdChargeIds.length + outcomeB.createdChargeIds.length;
  assertEqual(totalCreated, 1, 'sólo una de las dos llamadas reporta haber creado el cargo');

  const ids = new Set(store.persisted.charges.map((charge) => charge.id));
  assertEqual(ids.size, store.persisted.charges.length, 'sin ids financieros duplicados');
});

asyncTest('tres generaciones mensuales simultáneas (dos para el mismo alumno, una para otro) crean exactamente dos cargos, sin duplicados', async () => {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const candidatesA = [{ studentId: 's1', price: 20000 }];
  const candidatesB = [{ studentId: 's2', price: 15000 }];
  const candidatesC = [{ studentId: 's1', price: 20000 }]; // mismo alumno que A, a propósito

  await Promise.all([
    generateMonthlyChargesForCandidates(candidatesA, '2026-07', '2026-07-01T09:00:00.000Z', deps),
    generateMonthlyChargesForCandidates(candidatesB, '2026-07', '2026-07-01T09:00:00.000Z', deps),
    generateMonthlyChargesForCandidates(candidatesC, '2026-07', '2026-07-01T09:00:00.000Z', deps),
  ]);

  assertEqual(store.persisted.charges.length, 2, 'dos alumnos distintos: dos cargos, aunque s1 se haya pedido dos veces');
  const ids = store.persisted.charges.map((charge) => charge.id);
  assertEqual(new Set(ids).size, ids.length, 'sin ids financieros duplicados');
  assert(ids.includes('charge_mensual_s1_2026-07'), 'incluye el cargo de s1');
  assert(ids.includes('charge_mensual_s2_2026-07'), 'incluye el cargo de s2');
});

asyncTest(
  'mensualidad y reconciliación por clase corriendo a la vez (el caso real de App.tsx al iniciar) no se pisan entre sí',
  async () => {
    const { adapter, store } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

    const candidates = [{ studentId: 's1', price: 20000 }];
    const lesson = savedLesson({
      id: 'lesson-1',
      form: form({ studentIds: ['s2'] }),
      billedAmount: 9500,
      billedAmountByStudent: { s2: 9500 },
    });
    const getProfile = () => ({ billingType: 'por_clase' as const, price: 9500 });

    // Ambas comparten la MISMA cola interna (mismo `deps`/controller) — es
    // exactamente lo que hace App.tsx con `Promise.all([runMonthlyChargeGeneration(), reconcilePerClassCharges()])`.
    const [monthlyOutcome, perClassOutcome] = await Promise.all([
      generateMonthlyChargesForCandidates(candidates, '2026-07', '2026-07-01T09:00:00.000Z', deps),
      reconcileChargesForLessons([lesson], getProfile, '2026-07-01T09:00:00.000Z', deps),
    ]);

    assertEqual(store.persisted.charges.length, 2, 'un cargo mensual y un cargo por clase, ninguno se perdió');
    assertEqual(monthlyOutcome.createdChargeIds.length, 1, 'la generación mensual creó su cargo');
    assertEqual(perClassOutcome.createdChargeIds.length, 1, 'la reconciliación por clase creó su cargo');
    const ids = store.persisted.charges.map((charge) => charge.id);
    assertEqual(new Set(ids).size, ids.length, 'sin ids financieros duplicados entre ambos tipos de cargo');
  }
);

// ---------------------------------------------------------------------------
// Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
// cambio de mes real, a través del servicio inyectable (no sólo del plan
// puro) — julio ya tiene su cargo, se abre agosto.
// ---------------------------------------------------------------------------

asyncTest('3. El 01/08 aparece una única obligación pendiente de agosto (julio ya tenía la suya)', async () => {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const candidates = [{ studentId: 's1', price: 20000 }];
  await generateMonthlyChargesForCandidates(candidates, '2026-07', '2026-07-05T09:00:00.000Z', deps);
  const outcome = await generateMonthlyChargesForCandidates(candidates, '2026-08', '2026-08-01T09:00:00.000Z', deps);

  assertEqual(outcome.createdChargeIds.length, 1, 'crea una única obligación para agosto');
  assertEqual(store.persisted.charges.length, 2, 'julio queda intacto, agosto se agrega aparte');
  assert(
    store.persisted.charges.some((charge) => charge.billingPeriod === '2026-07'),
    'la obligación de julio sigue existiendo'
  );
  assert(
    store.persisted.charges.some((charge) => charge.billingPeriod === '2026-08'),
    'la obligación de agosto se creó'
  );
});

asyncTest('4. Reabrir la app varias veces en agosto no duplica la mensualidad de agosto', async () => {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const candidates = [{ studentId: 's1', price: 20000 }];
  for (let i = 0; i < 10; i++) {
    await generateMonthlyChargesForCandidates(candidates, '2026-08', `2026-08-0${(i % 9) + 1}T09:00:00.000Z`, deps);
  }

  const augustCharges = store.persisted.charges.filter((charge) => charge.billingPeriod === '2026-08');
  assertEqual(augustCharges.length, 1, 'diez "aperturas" de agosto producen un único cargo');
});

asyncTest(
  '5. App cerrada el 01/08 y abierta recién el 05/08 genera la mensualidad de agosto una sola vez',
  async () => {
    const { adapter, store } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

    const candidates = [{ studentId: 's1', price: 20000 }];
    // La app nunca se abrió el 01/08 — la primera apertura real es el 05/08,
    // pero `billingPeriod` sigue siendo 'agosto' (se resuelve por el mes de
    // "hoy" real, nunca por cuándo tendría que haberse abierto).
    const openedAt = new Date('2026-08-05T14:00:00.000Z');
    const billingPeriod = localDateKeyInTimeZone(openedAt, ARGENTINA_TIME_ZONE).slice(0, 7);
    assertEqual(billingPeriod, '2026-08', 'el 05/08 en Buenos Aires sigue siendo agosto');

    const outcome = await generateMonthlyChargesForCandidates(candidates, billingPeriod, openedAt.toISOString(), deps);
    assertEqual(outcome.createdChargeIds.length, 1, 'genera agosto una única vez, aunque hayan pasado varios días');
    assertEqual(store.persisted.charges.length, 1, 'un solo cargo, sin ningún rastro de los días sin abrir la app');
  }
);

asyncTest('12. Zona horaria de Buenos Aires: un instante ya "agosto" en UTC pero todavía "julio" en AR no adelanta el cambio de mes', async () => {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  // 2026-08-01T02:00:00.000Z es, en Buenos Aires (UTC-3), 2026-07-31T23:00 — todavía julio.
  const stillJulyInAr = new Date('2026-08-01T02:00:00.000Z');
  const julyPeriod = localDateKeyInTimeZone(stillJulyInAr, ARGENTINA_TIME_ZONE).slice(0, 7);
  assertEqual(julyPeriod, '2026-07', 'sigue siendo julio en Buenos Aires aunque UTC ya sea 1° de agosto');

  const candidates = [{ studentId: 's1', price: 20000 }];
  await generateMonthlyChargesForCandidates(candidates, julyPeriod, stillJulyInAr.toISOString(), deps);
  assertEqual(store.persisted.charges[0].billingPeriod, '2026-07', 'genera julio, nunca agosto adelantado por UTC');

  // Una hora más tarde en UTC (2026-08-01T03:00:00.000Z) ya es 2026-08-01T00:00 en AR: recién ahí es agosto.
  const nowAugustInAr = new Date('2026-08-01T03:00:00.000Z');
  const augustPeriod = localDateKeyInTimeZone(nowAugustInAr, ARGENTINA_TIME_ZONE).slice(0, 7);
  assertEqual(augustPeriod, '2026-08', 'recién acá empieza agosto en Buenos Aires');

  const outcome = await generateMonthlyChargesForCandidates(candidates, augustPeriod, nowAugustInAr.toISOString(), deps);
  assertEqual(outcome.createdChargeIds.length, 1, 'agosto se genera exactamente una vez al llegar su momento real en AR');
});
