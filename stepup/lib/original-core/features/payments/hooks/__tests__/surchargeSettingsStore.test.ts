// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/surchargeSettingsStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { createSurchargeSettingsStoreController, parsePersistedSurchargeSettings, parsePersistedSurchargeSettingsSchemaVersion, SURCHARGE_SETTINGS_SCHEMA_VERSION, type SurchargeSettingsPersistenceAdapter } from '../surchargeSettingsStore.ts';
import { DEFAULT_SURCHARGE_SETTINGS, DEFAULT_SURCHARGE_TIER_VALUES, type SurchargeSettings } from '../../utils/surchargeSettings.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): pruebas del
 * store nuevo, mismo patrón exacto que `paymentsStore.test.ts` — cubre los
 * casos 18 (rollback ante fallo de persistencia), 19 (cierre y reapertura) y
 * 27 (actualización inmediata vía `subscribe`) del pedido.
 */

function customSettings(overrides: Partial<SurchargeSettings> = {}): SurchargeSettings {
  return {
    current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false, graceDay: 7 },
    pending: null,
    pendingEffectiveFrom: null,
    ...overrides,
  };
}

function makeFakeAdapter(initial: SurchargeSettings) {
  const store = { persisted: initial, writeCallCount: 0, failNextWrite: false };
  const adapter: SurchargeSettingsPersistenceAdapter = {
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

asyncTest('hidrata con DEFAULT_SURCHARGE_SETTINGS cuando no hay nada persistido (instalación nueva): sin recargos automáticos por defecto', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const controller = createSurchargeSettingsStoreController(adapter);
  const hydrated = await controller.hydrate();
  assertEqual(hydrated.current.enabled, false, 'ninguna cuenta nueva obtiene un recargo automático por defecto (decisión de negocio 2026-09-16)');
  assertEqual(hydrated.pending, null, 'sin cambio pendiente en una instalación nueva');
});

asyncTest('applyMutation persiste y actualiza el snapshot en memoria', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const controller = createSurchargeSettingsStoreController(adapter);
  await controller.hydrate();

  const next = customSettings();
  const result = await controller.applyMutation(() => next);

  assertEqual(result.current.enabled, false, 'el snapshot devuelto refleja el cambio');
  assertEqual(controller.getSnapshot().current.enabled, false, 'el snapshot en memoria también');
  assertEqual(store.persisted.current.enabled, false, 'quedó persistido');
  assertEqual(store.writeCallCount, 1, 'una sola escritura');
});

// Caso 18: error de persistencia con rollback.
asyncTest('caso 18 — si la escritura falla, revierte el estado en memoria al anterior (nunca queda a medias)', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const controller = createSurchargeSettingsStoreController(adapter);
  await controller.hydrate();
  await controller.applyMutation(() => customSettings()); // estado base válido, persistido con éxito

  store.failNextWrite = true;
  let rejected = false;
  try {
    await controller.applyMutation(() => customSettings({ current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true } }));
  } catch {
    rejected = true;
  }

  assert(rejected, 'la mutación fallida se propaga');
  assertEqual(controller.getSnapshot().current.enabled, false, 'el estado en memoria vuelve exactamente al anterior');
  assertEqual(store.persisted.current.enabled, false, 'lo persistido tampoco cambió');
});

asyncTest('applyMutation rechaza mutar antes de hidratar', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const controller = createSurchargeSettingsStoreController(adapter);

  let rejected = false;
  try {
    await controller.applyMutation(() => customSettings());
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se puede mutar sin hidratar antes: arriesgaría sobrescribir una configuración real ya guardada');
});

asyncTest('applyMutation no muta el objeto recibido ni deja referencias compartidas', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const controller = createSurchargeSettingsStoreController(adapter);
  await controller.hydrate();

  const next = customSettings();
  const snapshot = JSON.stringify(next);
  await controller.applyMutation(() => next);
  assertEqual(JSON.stringify(next), snapshot, 'el objeto pasado no cambia');

  next.current.graceDay = 999;
  assertEqual(controller.getSnapshot().current.graceDay, 7, 'el store guardó una copia, no una referencia');
});

// Caso 19: cierre y reapertura — un segundo controller (simula reabrir la
// app) leyendo del MISMO almacenamiento persistido recupera exactamente lo
// que el primero guardó.
asyncTest('caso 19 — cierre y reapertura: un controller nuevo sobre el mismo almacenamiento recupera la configuración guardada', async () => {
  const { adapter, store } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const firstController = createSurchargeSettingsStoreController(adapter);
  await firstController.hydrate();
  await firstController.applyMutation(() => customSettings({ current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false, graceDay: 12 } }));

  // "Reabrir la app": un controller nuevo, mismo adaptador (mismo
  // almacenamiento real subyacente, representado por `store.persisted`).
  const secondController = createSurchargeSettingsStoreController(adapter);
  const reopened = await secondController.hydrate();

  assertEqual(reopened.current.enabled, false, 'sobrevive el cierre y la reapertura');
  assertEqual(reopened.current.graceDay, 12, 'con el mismo valor exacto guardado antes de cerrar');
  assertEqual(store.writeCallCount, 1, 'la reapertura sólo lee, nunca vuelve a escribir');
});

asyncTest('hydrate es idempotente: no vuelve a leer una vez hidratado', async () => {
  let readCalls = 0;
  const adapter: SurchargeSettingsPersistenceAdapter = {
    readAll: async () => {
      readCalls += 1;
      return DEFAULT_SURCHARGE_SETTINGS;
    },
    writeAll: async () => {},
  };
  const controller = createSurchargeSettingsStoreController(adapter);
  await controller.hydrate();
  await controller.hydrate();
  await controller.hydrate();
  assertEqual(readCalls, 1, 'sólo lee una vez, aunque se llame varias veces');
});

asyncTest('si hydrate() falla, una nueva llamada reintenta leer en vez de quedar rechazada para siempre', async () => {
  let attempt = 0;
  const adapter: SurchargeSettingsPersistenceAdapter = {
    readAll: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fallo simulado de lectura (transitorio)');
      return customSettings();
    },
    writeAll: async () => {},
  };
  const controller = createSurchargeSettingsStoreController(adapter);

  let firstRejected = false;
  try {
    await controller.hydrate();
  } catch {
    firstRejected = true;
  }
  assert(firstRejected, 'el primer intento falla');

  const secondResult = await controller.hydrate();
  assertEqual(attempt, 2, 'el segundo llamado vuelve a leer, no reutiliza la promesa rechazada');
  assertEqual(secondResult.current.enabled, false, 'el reintento exitoso hidrata con los datos reales');
});

asyncTest('replaceInMemory sincroniza sin persistir (usado por la restauración de respaldo)', async () => {
  let writeCalls = 0;
  const adapter: SurchargeSettingsPersistenceAdapter = {
    readAll: async () => DEFAULT_SURCHARGE_SETTINGS,
    writeAll: async () => {
      writeCalls += 1;
    },
  };
  const controller = createSurchargeSettingsStoreController(adapter);
  await controller.hydrate();
  controller.replaceInMemory(customSettings());
  assertEqual(controller.getSnapshot().current.enabled, false, 'el snapshot en memoria cambia');
  assertEqual(writeCalls, 0, 'nunca escribe: la persistencia ya ocurrió por otra vía');
});

// Caso 27 (actualización inmediata de todas las pantallas): cualquier
// consumidor suscripto se entera de un cambio en el mismo instante en que
// se aplica, sin necesidad de refetch manual.
asyncTest('caso 27 — subscribe notifica inmediatamente ante cualquier applyMutation, incluso antes de que termine la escritura', async () => {
  const { adapter } = makeFakeAdapter(DEFAULT_SURCHARGE_SETTINGS);
  const controller = createSurchargeSettingsStoreController(adapter);
  await controller.hydrate();

  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications += 1;
  });

  await controller.applyMutation(() => customSettings());
  assertEqual(notifications, 1, 'una notificación por cada mutación aplicada');
  assertEqual(controller.getSnapshot().current.enabled, false, 'el snapshot ya refleja el cambio para cualquier pantalla que lo lea ahora');

  unsubscribe();
  await controller.applyMutation(() => DEFAULT_SURCHARGE_SETTINGS);
  assertEqual(notifications, 1, 'tras darse de baja, no se notifica más');
});

// ---------------------------------------------------------------------------
// parsePersistedSurchargeSettings / parsePersistedSurchargeSettingsSchemaVersion
// ---------------------------------------------------------------------------

test('parsePersistedSurchargeSettings devuelve DEFAULT_SURCHARGE_SETTINGS cuando la clave no existe (instalación nueva)', () => {
  const result = parsePersistedSurchargeSettings(null);
  assertEqual(JSON.stringify(result), JSON.stringify(DEFAULT_SURCHARGE_SETTINGS), 'clave inexistente = comportamiento actual migrado');
});

test('parsePersistedSurchargeSettings rechaza JSON corrupto en vez de convertirlo en el default silenciosamente', () => {
  let rejected = false;
  try {
    parsePersistedSurchargeSettings('{esto no es JSON válido');
  } catch {
    rejected = true;
  }
  assert(rejected, 'JSON corrupto debe fallar explícitamente');
});

test('parsePersistedSurchargeSettings rechaza un valor sin forma de SurchargeSettings', () => {
  let rejected = false;
  try {
    parsePersistedSurchargeSettings(JSON.stringify({ foo: 'bar' }));
  } catch {
    rejected = true;
  }
  assert(rejected, 'un objeto sin "current" debe fallar explícitamente');
});

test('parsePersistedSurchargeSettings acepta un valor válido tal cual', () => {
  const result = parsePersistedSurchargeSettings(JSON.stringify(customSettings()));
  assertEqual(result.current.enabled, false, 'conserva el valor guardado');
});

test('parsePersistedSurchargeSettingsSchemaVersion acepta clave inexistente (instalación nueva)', () => {
  assertEqual(parsePersistedSurchargeSettingsSchemaVersion(null), null, 'clave inexistente no es un error');
});

test('parsePersistedSurchargeSettingsSchemaVersion rechaza una versión interna desconocida', () => {
  let rejected = false;
  try {
    parsePersistedSurchargeSettingsSchemaVersion(JSON.stringify(99));
  } catch {
    rejected = true;
  }
  assert(rejected, 'una versión distinta de SURCHARGE_SETTINGS_SCHEMA_VERSION debe rechazarse');
});

test('parsePersistedSurchargeSettingsSchemaVersion acepta la versión actual', () => {
  const result = parsePersistedSurchargeSettingsSchemaVersion(JSON.stringify(SURCHARGE_SETTINGS_SCHEMA_VERSION));
  assertEqual(result, SURCHARGE_SETTINGS_SCHEMA_VERSION, 'la versión actual se acepta tal cual');
});
