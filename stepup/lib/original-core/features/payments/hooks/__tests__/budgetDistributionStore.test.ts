// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/budgetDistributionStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { createBudgetDistributionStoreController, parsePersistedBudgetDistributionSchemaVersion, parsePersistedBudgetDistributionSettings, BUDGET_DISTRIBUTION_SCHEMA_VERSION, type BudgetDistributionPersistenceAdapter } from '../budgetDistributionStore.ts';
import { DEFAULT_BUDGET_DISTRIBUTION_SETTINGS, DEFAULT_SAVINGS_GOAL, type BudgetDistributionSettings } from '../../utils/budgetDistribution.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Fase financiera — "Plan de distribución 50/30/20": pruebas del store de
 * persistencia, mismo patrón exacto que `surchargeSettingsStore.test.ts`.
 * Nunca usa AsyncStorage real (adaptador falso en memoria, como el resto de
 * la suite).
 */

function customSettings(overrides: Partial<BudgetDistributionSettings> = {}): BudgetDistributionSettings {
  return {
    distribution: { needs: 40, wants: 40, savings: 20 },
    savingsGoal: { enabled: true, targetAmount: 500000, targetDate: '2026-12-31' },
    ...overrides,
  };
}

function makeFakeAdapter(initial: BudgetDistributionSettings) {
  const store = { persisted: initial, writeCallCount: 0, failNextWrite: false };
  const adapter: BudgetDistributionPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (settings) => {
      store.writeCallCount += 1;
      if (store.failNextWrite) {
        store.failNextWrite = false;
        throw new Error('fallo simulado de escritura');
      }
      store.persisted = settings;
    },
  };
  return { adapter, store };
}

asyncTest('hidrata con DEFAULT_BUDGET_DISTRIBUTION_SETTINGS cuando no hay nada persistido (instalación nueva)', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  const hydrated = await controller.hydrate();
  assertEqual(hydrated.distribution.needs, 50, 'necesidades 50 por defecto');
  assertEqual(hydrated.distribution.wants, 30, 'gustos 30 por defecto');
  assertEqual(hydrated.distribution.savings, 20, 'ahorro 20 por defecto');
  assertEqual(hydrated.savingsGoal.enabled, false, 'objetivo de ahorro apagado por defecto');
});

asyncTest('applyMutation persiste y actualiza el snapshot en memoria', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  await controller.hydrate();

  const next = customSettings();
  const result = await controller.applyMutation(() => next);

  assertEqual(result.distribution.needs, 40, 'el snapshot devuelto refleja el cambio');
  assertEqual(controller.getSnapshot().distribution.needs, 40, 'el snapshot en memoria también');
  assertEqual(store.persisted.distribution.needs, 40, 'quedó persistido');
  assertEqual(store.writeCallCount, 1, 'una sola escritura');
});

asyncTest('si la escritura falla, revierte el estado en memoria al anterior (nunca queda a medias)', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  await controller.hydrate();
  await controller.applyMutation(() => customSettings());

  store.failNextWrite = true;
  let rejected = false;
  try {
    await controller.applyMutation(() => customSettings({ distribution: { needs: 90, wants: 5, savings: 5 } }));
  } catch {
    rejected = true;
  }

  assert(rejected, 'la mutación fallida se propaga');
  assertEqual(controller.getSnapshot().distribution.needs, 40, 'el estado en memoria vuelve exactamente al anterior');
  assertEqual(store.persisted.distribution.needs, 40, 'lo persistido tampoco cambió');
});

asyncTest('applyMutation rechaza mutar antes de hidratar', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const controller = createBudgetDistributionStoreController(adapter, () => {});

  let rejected = false;
  try {
    await controller.applyMutation(() => customSettings());
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se puede mutar sin hidratar antes');
});

asyncTest('applyMutation no muta el objeto recibido ni deja referencias compartidas', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  await controller.hydrate();

  const next = customSettings();
  const snapshot = JSON.stringify(next);
  await controller.applyMutation(() => next);
  assertEqual(JSON.stringify(next), snapshot, 'el objeto pasado no cambia');

  next.distribution.needs = 999;
  assertEqual(controller.getSnapshot().distribution.needs, 40, 'el store guardó una copia, no una referencia');
});

asyncTest('cierre y reapertura: un controller nuevo sobre el mismo almacenamiento recupera la configuración guardada', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const firstController = createBudgetDistributionStoreController(adapter, () => {});
  await firstController.hydrate();
  await firstController.applyMutation(() => customSettings());

  const secondController = createBudgetDistributionStoreController(adapter, () => {});
  const reopened = await secondController.hydrate();

  assertEqual(reopened.distribution.needs, 40, 'sobrevive el cierre y la reapertura');
  assertEqual(reopened.savingsGoal.targetAmount, 500000, 'incluye el objetivo de ahorro guardado');
  assertEqual(store.writeCallCount, 1, 'la reapertura sólo lee, nunca vuelve a escribir');
});

asyncTest('hydrate es idempotente: no vuelve a leer una vez hidratado', async () => {
  let readCalls = 0;
  const adapter: BudgetDistributionPersistenceAdapter = {
    readAll: async () => {
      readCalls += 1;
      return DEFAULT_BUDGET_DISTRIBUTION_SETTINGS;
    },
    writeAll: async () => {},
  };
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  await controller.hydrate();
  await controller.hydrate();
  await controller.hydrate();
  assertEqual(readCalls, 1, 'sólo lee una vez, aunque se llame varias veces');
});

asyncTest('replaceInMemory sincroniza sin persistir (usado por la restauración de respaldo)', async () => {
  let writeCalls = 0;
  const adapter: BudgetDistributionPersistenceAdapter = {
    readAll: async () => DEFAULT_BUDGET_DISTRIBUTION_SETTINGS,
    writeAll: async () => {
      writeCalls += 1;
    },
  };
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  await controller.hydrate();
  controller.replaceInMemory(customSettings());
  assertEqual(controller.getSnapshot().distribution.needs, 40, 'el snapshot en memoria cambia');
  assertEqual(writeCalls, 0, 'nunca escribe: la persistencia ya ocurrió por otra vía');
});

asyncTest('subscribe notifica inmediatamente ante cualquier applyMutation', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  const controller = createBudgetDistributionStoreController(adapter, () => {});
  await controller.hydrate();

  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications += 1;
  });

  await controller.applyMutation(() => customSettings());
  assertEqual(notifications, 1, 'una notificación por cada mutación aplicada');

  unsubscribe();
  await controller.applyMutation(() => DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  assertEqual(notifications, 1, 'tras darse de baja, no se notifica más');
});

// ---------------------------------------------------------------------------
// Protección automática en la nube: cada escritura exitosa avisa a
// `onDataChanged` — a diferencia de `surchargeSettingsStore.ts`, acá es
// explícitamente requerido por el pedido ("protección automática en la
// nube"). Nunca se llama si la mutación falla ni durante la hidratación.
// ---------------------------------------------------------------------------

asyncTest('cada escritura exitosa avisa a onDataChanged exactamente una vez', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  let calls = 0;
  const controller = createBudgetDistributionStoreController(adapter, () => {
    calls += 1;
  });
  await controller.hydrate();
  assertEqual(calls, 0, 'hidratar solo no avisa nada');

  await controller.applyMutation(() => customSettings());
  assertEqual(calls, 1, 'una escritura exitosa avisa una vez');

  await controller.applyMutation(() => DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  assertEqual(calls, 2, 'cada escritura exitosa avisa de nuevo');
});

asyncTest('una escritura fallida nunca avisa a onDataChanged', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  let calls = 0;
  const controller = createBudgetDistributionStoreController(adapter, () => {
    calls += 1;
  });
  await controller.hydrate();

  store.failNextWrite = true;
  try {
    await controller.applyMutation(() => customSettings());
  } catch {
    // esperado
  }
  assertEqual(calls, 0, 'una escritura que falló nunca avisa cambio local');
});

// ---------------------------------------------------------------------------
// parsePersistedBudgetDistributionSettings
// ---------------------------------------------------------------------------

test('parsePersistedBudgetDistributionSettings devuelve el default cuando la clave no existe (instalación nueva)', () => {
  const result = parsePersistedBudgetDistributionSettings(null);
  assertEqual(JSON.stringify(result), JSON.stringify(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS), 'clave inexistente = default');
});

test('parsePersistedBudgetDistributionSettings rechaza JSON corrupto', () => {
  let rejected = false;
  try {
    parsePersistedBudgetDistributionSettings('{esto no es JSON válido');
  } catch {
    rejected = true;
  }
  assert(rejected, 'JSON corrupto debe fallar explícitamente');
});

test('parsePersistedBudgetDistributionSettings rechaza un valor sin forma válida', () => {
  let rejected = false;
  try {
    parsePersistedBudgetDistributionSettings(JSON.stringify({ foo: 'bar' }));
  } catch {
    rejected = true;
  }
  assert(rejected, 'un objeto sin "distribution" debe fallar explícitamente');
});

test('parsePersistedBudgetDistributionSettings acepta un valor válido tal cual', () => {
  const result = parsePersistedBudgetDistributionSettings(JSON.stringify(customSettings()));
  assertEqual(result.distribution.needs, 40, 'conserva el valor guardado');
  assertEqual(result.savingsGoal.targetAmount, 500000, 'conserva el objetivo guardado');
});

// Migración segura: un registro guardado ANTES de que existiera el objetivo
// de ahorro opcional no tiene ese campo — nunca debe fallar, se completa con
// el default (desactivado), nunca se inventa un objetivo.
test('parsePersistedBudgetDistributionSettings migra un registro anterior sin savingsGoal, completando con el default desactivado', () => {
  const legacyRecord = { distribution: { needs: 45, wants: 35, savings: 20 } }; // sin savingsGoal
  const result = parsePersistedBudgetDistributionSettings(JSON.stringify(legacyRecord));
  assertEqual(result.distribution.needs, 45, 'conserva la distribución guardada');
  assertEqual(JSON.stringify(result.savingsGoal), JSON.stringify(DEFAULT_SAVINGS_GOAL), 'completa con el objetivo por defecto, desactivado');
});

test('parsePersistedBudgetDistributionSchemaVersion acepta clave inexistente (instalación nueva)', () => {
  assertEqual(parsePersistedBudgetDistributionSchemaVersion(null), null, 'clave inexistente no es un error');
});

test('parsePersistedBudgetDistributionSchemaVersion rechaza una versión interna desconocida', () => {
  let rejected = false;
  try {
    parsePersistedBudgetDistributionSchemaVersion(JSON.stringify(99));
  } catch {
    rejected = true;
  }
  assert(rejected, 'una versión distinta debe rechazarse');
});

test('parsePersistedBudgetDistributionSchemaVersion acepta la versión actual', () => {
  const result = parsePersistedBudgetDistributionSchemaVersion(JSON.stringify(BUDGET_DISTRIBUTION_SCHEMA_VERSION));
  assertEqual(result, BUDGET_DISTRIBUTION_SCHEMA_VERSION, 'la versión actual se acepta tal cual');
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (a pedido de Joaquín — planificador 50/30/20 desequilibrado):
// un registro histórico cuya suma ya no sea 100 (p. ej. por una versión
// anterior con el bug de redondeo) se normaliza AL LEERLO, nunca se
// reemplaza por 50/30/20 ni se pierde — sin tocar el registro persistido.
// ---------------------------------------------------------------------------

test('parsePersistedBudgetDistributionSettings normaliza una suma histórica inválida al leerla, preservando la proporción', () => {
  const legacyInvalidRecord = { distribution: { needs: 40, wants: 41, savings: 22 } }; // suma 103
  const result = parsePersistedBudgetDistributionSettings(JSON.stringify(legacyInvalidRecord));
  assertEqual(result.distribution.needs + result.distribution.wants + result.distribution.savings, 100, 'la suma queda exactamente 100 al leerla');
  assert(result.distribution.wants > result.distribution.needs, 'conserva que "gustos" seguía siendo el mayor de los tres, como en el original');
});

test('parsePersistedBudgetDistributionSettings conserva un valor histórico ya válido exactamente igual (nunca lo reinicia a 50/30/20)', () => {
  const legacyValidRecord = { distribution: { needs: 45, wants: 35, savings: 20 } };
  const result = parsePersistedBudgetDistributionSettings(JSON.stringify(legacyValidRecord));
  assertEqual(result.distribution.needs, 45, 'no se toca');
  assertEqual(result.distribution.wants, 35, 'no se toca');
  assertEqual(result.distribution.savings, 20, 'no se toca');
});
