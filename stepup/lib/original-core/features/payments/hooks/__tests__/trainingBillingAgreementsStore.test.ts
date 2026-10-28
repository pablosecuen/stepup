// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/trainingBillingAgreementsStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS, punto 18 de la matriz pedida): pruebas del parseo puro de
 * `trainingBillingAgreementsStore.ts` — mismo patrón que
 * `firstMonthProrationDecisionStore.test.ts` (nunca invoca AsyncStorage real).
 * Cubre "reiniciar y restaurar un respaldo" vía un round-trip
 * JSON.stringify/parse, que es exactamente lo que hace
 * `saveTrainingBillingAgreements`/`loadTrainingBillingAgreements`.
 */
import type { TrainingBillingAgreement } from '../../types/index.ts';
import { createTrainingBillingAgreementsStoreController, findTrainingBillingAgreement, getTrainingBillingAgreementsSnapshot, isTrainingBillingAgreementsCacheHydrated, parsePersistedTrainingBillingAgreements, replaceTrainingBillingAgreementsCacheForTests, resetTrainingBillingAgreementsCacheForTests, subscribeTrainingBillingAgreements, type TrainingBillingAgreementsPersistenceAdapter } from '../trainingBillingAgreementsStore.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const validAgreement: TrainingBillingAgreement = {
  id: 'qa_agreement_1',
  monthlyFee: 15000,
  startPeriod: '2026-06',
  createdAt: '2026-06-01T00:00:00.000Z',
};

test('parsePersistedTrainingBillingAgreements: clave inexistente (null) da lista vacía', () => {
  assertEqual(parsePersistedTrainingBillingAgreements(null).length, 0, 'instalación nueva, ninguna serie configurada todavía');
});

test('parsePersistedTrainingBillingAgreements: JSON corrupto da lista vacía, nunca lanza', () => {
  assertEqual(parsePersistedTrainingBillingAgreements('{esto no es JSON').length, 0, 'best-effort: nunca bloquea nada');
});

test('parsePersistedTrainingBillingAgreements: descarta sólo la entrada corrupta, conserva el resto', () => {
  const raw = JSON.stringify([validAgreement, { id: 'roto', monthlyFee: -5 }]);
  const restored = parsePersistedTrainingBillingAgreements(raw);
  assertEqual(restored.length, 1, 'sólo la entrada válida sobrevive');
  assertEqual(restored[0].id, 'qa_agreement_1', 'es la entrada real, no la corrupta');
});

test('18) Reiniciar y restaurar: round-trip JSON.stringify/parse conserva el acuerdo completo, campo por campo', () => {
  const withPending: TrainingBillingAgreement = {
    ...validAgreement,
    pendingMonthlyFee: 18000,
    pendingMonthlyFeeEffectiveFrom: '2026-08',
  };
  const restored = parsePersistedTrainingBillingAgreements(JSON.stringify([withPending]));
  assertEqual(restored.length, 1, 'sobrevive el round-trip');
  assertEqual(restored[0].monthlyFee, 15000, 'cuota vigente conservada');
  assertEqual(restored[0].pendingMonthlyFee, 18000, 'cambio de precio pendiente conservado');
  assertEqual(restored[0].pendingMonthlyFeeEffectiveFrom, '2026-08', 'vigencia del cambio conservada');
  assertEqual(restored[0].startPeriod, '2026-06', 'período de inicio conservado');
});

test('findTrainingBillingAgreement: encuentra por id exacto, null si no existe', () => {
  assertEqual(findTrainingBillingAgreement([validAgreement], 'qa_agreement_1')?.monthlyFee, 15000, 'lo encuentra');
  assertEqual(findTrainingBillingAgreement([validAgreement], 'inexistente'), null, 'null si no existe');
});

test('cache en memoria: replaceTrainingBillingAgreementsCacheForTests puebla el snapshot y notifica a los suscriptores', () => {
  resetTrainingBillingAgreementsCacheForTests();
  assertEqual(isTrainingBillingAgreementsCacheHydrated(), false, 'sin hidratar todavía');
  let notified = false;
  const unsubscribe = subscribeTrainingBillingAgreements(() => {
    notified = true;
  });
  replaceTrainingBillingAgreementsCacheForTests([validAgreement]);
  assert(notified, 'notifica a los suscriptores reales, mismo patrón que el resto de los stores');
  assertEqual(getTrainingBillingAgreementsSnapshot().length, 1, 'snapshot sincrónico actualizado');
  assertEqual(isTrainingBillingAgreementsCacheHydrated(), true, 'ya hidratado');
  unsubscribe();
  resetTrainingBillingAgreementsCacheForTests();
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural, "STORE
// CON COLA DE MUTACIONES"): mismo patrón EXACTO de prueba que
// `paymentsStore.test.ts` — un adaptador falso controla manualmente cuándo
// termina cada escritura, para reproducir la carrera real sin depender de
// temporizadores frágiles.
// ---------------------------------------------------------------------------

function agreementFixture(overrides: Partial<TrainingBillingAgreement> = {}): TrainingBillingAgreement {
  return {
    id: 'qa_agreement_base',
    monthlyFee: 10000,
    startPeriod: '2026-06',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

asyncTest(
  'applyMutation serializa dos ALTAS concurrentes: si la primera falla después de que la segunda ya se persistió, memoria y almacenamiento terminan iguales (nunca se pierde la segunda)',
  async () => {
    const rejectFirstWriteHolder: Array<(error: Error) => void> = [];
    let writeCallCount = 0;
    const store = { persisted: [] as TrainingBillingAgreement[] };

    const adapter: TrainingBillingAgreementsPersistenceAdapter = {
      readAll: async () => store.persisted,
      writeAll: async (entries) => {
        writeCallCount += 1;
        if (writeCallCount === 1) {
          await new Promise<void>((_resolve, reject) => {
            rejectFirstWriteHolder.push(reject);
          });
        }
        store.persisted = entries;
      },
    };

    const controller = createTrainingBillingAgreementsStoreController(adapter);
    await controller.hydrate();

    const agreementA = agreementFixture({ id: 'qa_agreement_a' });
    const agreementB = agreementFixture({ id: 'qa_agreement_b' });

    const promiseA = controller.upsert(agreementA);
    const promiseB = controller.upsert(agreementB);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEqual(writeCallCount, 1, 'sólo la escritura de A está en curso; B todavía no arrancó (encolada detrás)');
    assertEqual(rejectFirstWriteHolder.length, 1, 'la primera escritura ya debería estar en curso');
    rejectFirstWriteHolder[0](new Error('fallo simulado del alta A'));

    let rejectedA = false;
    try {
      await promiseA;
    } catch {
      rejectedA = true;
    }
    assert(rejectedA, 'el alta A efectivamente falla');

    const resultB = await promiseB;
    assertEqual(resultB.map((entry) => entry.id).join(','), 'qa_agreement_b', 'B se persiste solo, sin el acuerdo de A');
    assertEqual(
      JSON.stringify(controller.getSnapshot()),
      JSON.stringify(store.persisted),
      'memoria y almacenamiento terminan exactamente iguales tras la carrera'
    );
    assertEqual(
      controller.getSnapshot().map((entry) => entry.id).join(','),
      'qa_agreement_b',
      'sólo queda el acuerdo de B — el de A se revirtió correctamente en memoria, nunca se perdió el de B'
    );
  }
);

asyncTest(
  'applyMutation serializa dos CAMBIOS DE PRECIO concurrentes sobre el MISMO acuerdo: nunca se pierde uno de los dos (la segunda mutación siempre ve el resultado real de la primera)',
  async () => {
    const store = { persisted: [agreementFixture({ id: 'qa_agreement_shared', monthlyFee: 10000 })] };
    const adapter: TrainingBillingAgreementsPersistenceAdapter = {
      readAll: async () => store.persisted,
      writeAll: async (entries) => {
        // Simula latencia real de AsyncStorage — sin cola, dos escrituras
        // concurrentes podrían intercalarse y una pisar a la otra.
        await new Promise((resolve) => setTimeout(resolve, 5));
        store.persisted = entries;
      },
    };

    const controller = createTrainingBillingAgreementsStoreController(adapter);
    await controller.hydrate();

    // Dos "cambios de precio" concurrentes, cada uno leyendo el estado
    // dentro de su propio updater (nunca un snapshot externo capturado de
    // antemano) — la cola debe garantizar que el segundo vea el resultado
    // real del primero.
    const promiseA = controller.applyMutation((current) =>
      current.map((entry) => (entry.id === 'qa_agreement_shared' ? { ...entry, monthlyFee: entry.monthlyFee + 1000 } : entry))
    );
    const promiseB = controller.applyMutation((current) =>
      current.map((entry) => (entry.id === 'qa_agreement_shared' ? { ...entry, monthlyFee: entry.monthlyFee + 2000 } : entry))
    );

    await Promise.all([promiseA, promiseB]);

    const final = controller.getSnapshot().find((entry) => entry.id === 'qa_agreement_shared');
    assert(final !== undefined, 'el acuerdo sigue existiendo');
    assertEqual(final!.monthlyFee, 13000, 'los dos incrementos se aplicaron sobre el mismo estado base, nunca uno pisó al otro (10000 + 1000 + 2000)');
    assertEqual(
      JSON.stringify(controller.getSnapshot()),
      JSON.stringify(store.persisted),
      'memoria y almacenamiento terminan exactamente iguales'
    );
  }
);

asyncTest('applyMutation: si la escritura falla, el estado en memoria vuelve exactamente al anterior (nunca queda un acuerdo fantasma)', async () => {
  const store = { persisted: [] as TrainingBillingAgreement[] };
  const adapter: TrainingBillingAgreementsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async () => {
      throw new Error('fallo simulado de escritura');
    },
  };
  const controller = createTrainingBillingAgreementsStoreController(adapter);
  await controller.hydrate();

  let threw = false;
  try {
    await controller.upsert(agreementFixture({ id: 'qa_agreement_fantasma' }));
  } catch {
    threw = true;
  }
  assert(threw, 'la mutación propaga el error real');
  assertEqual(controller.getSnapshot().length, 0, 'la memoria vuelve exactamente al estado anterior — ningún acuerdo fantasma queda en el snapshot');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-14, segunda ronda (a pedido de Joaquín — revisión
// INDEPENDIENTE, punto 11: "un fallo al restaurar los acuerdos de
// entrenamiento no puede ocultarse como éxito"): comportamiento REAL del
// patrón que usa `restoreTrainingBillingAgreementsBestEffort`
// (`restoreService.ts`) — hidratar y luego reemplazar la lista completa
// mediante `applyMutation`, nunca una escritura directa que deje el caché
// desincronizado. Se reproduce acá el mismo llamado exacto, contra un
// adaptador en memoria real que puede fallar a pedido — no un mock que
// reimplemente la restauración por su cuenta.
// ---------------------------------------------------------------------------

async function simulateRestoreTrainingBillingAgreements(
  controller: ReturnType<typeof createTrainingBillingAgreementsStoreController>,
  agreements: TrainingBillingAgreement[] | undefined
): Promise<boolean> {
  try {
    await controller.hydrate();
    await controller.applyMutation(() => agreements ?? []);
    return true;
  } catch {
    return false;
  }
}

asyncTest('restauración exitosa: la lista completa del respaldo queda persistida Y el caché en memoria coherente con ella, en la misma operación', async () => {
  const store = { persisted: [agreementFixture({ id: 'qa_agreement_viejo' })] as TrainingBillingAgreement[] };
  const adapter: TrainingBillingAgreementsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (entries) => {
      store.persisted = entries;
    },
  };
  const controller = createTrainingBillingAgreementsStoreController(adapter);

  const backupAgreements = [agreementFixture({ id: 'qa_agreement_restaurado', monthlyFee: 22000 })];
  const restored = await simulateRestoreTrainingBillingAgreements(controller, backupAgreements);

  assert(restored, 'la restauración se reporta exitosa');
  assertEqual(store.persisted.length, 1, 'la lista completa del respaldo reemplazó a la anterior — "la nube siempre gana"');
  assertEqual(store.persisted[0]?.id, 'qa_agreement_restaurado', 'el contenido persistido es el del respaldo');
  assertEqual(controller.getSnapshot().length, 1, 'el caché en memoria queda coherente con lo persistido — nunca desactualizado');
  assertEqual(controller.getSnapshot()[0]?.id, 'qa_agreement_restaurado', 'el caché refleja exactamente lo restaurado, no lo viejo');
});

asyncTest('fallo de restauración: se reporta false (nunca oculto como éxito) y ni el caché ni lo persistido cambian', async () => {
  const store = { persisted: [agreementFixture({ id: 'qa_agreement_viejo' })] as TrainingBillingAgreement[] };
  const adapter: TrainingBillingAgreementsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async () => {
      throw new Error('fallo simulado de restauración');
    },
  };
  const controller = createTrainingBillingAgreementsStoreController(adapter);

  const backupAgreements = [agreementFixture({ id: 'qa_agreement_restaurado' })];
  const restored = await simulateRestoreTrainingBillingAgreements(controller, backupAgreements);

  assert(!restored, 'un fallo real de escritura se reporta como false — nunca se anuncia éxito silencioso');
  assertEqual(store.persisted.length, 1, 'lo persistido no cambió');
  assertEqual(store.persisted[0]?.id, 'qa_agreement_viejo', 'sigue siendo el dato anterior, nunca un escrito parcial');
  assertEqual(controller.getSnapshot().length, 1, 'el caché tampoco cambió — memoria y almacenamiento siguen coherentes entre sí');
  assertEqual(controller.getSnapshot()[0]?.id, 'qa_agreement_viejo', 'el caché conserva el estado anterior, nunca queda a medio actualizar');
});
