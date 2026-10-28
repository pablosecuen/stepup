// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/paymentsStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentsRepositoryState } from '../../types/index.ts';
import { createPaymentsStoreController, emptyPaymentsState, parsePersistedPaymentsArray, parsePersistedPaymentsSchemaVersion, type PaymentsPersistenceAdapter } from '../paymentsStore.ts';
import { planPaymentRegistration } from '../../utils/registerPaymentPlan.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function sampleState(overrides: Partial<PaymentsRepositoryState> = {}): PaymentsRepositoryState {
  return {
    charges: [
      {
        id: 'charge-1',
        studentId: 's1',
        type: 'mensual',
        originalAmount: 10000,
        currency: 'ARS',
        dueDate: '2026-07-01',
        createdAt: '2026-07-01T00:00:00.000Z',
        billingPeriod: '2026-07',
        voidedAt: null,
        voidReason: null,
      },
    ],
    payments: [],
    allocations: [],
    adjustments: [],
    ...overrides,
  };
}

function makeFakeAdapter(initial: PaymentsRepositoryState) {
  const store = {
    persisted: initial,
    writeCallCount: 0,
    failNextWrite: false,
  };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state) => {
      store.writeCallCount += 1;
      if (store.failNextWrite) {
        store.failNextWrite = false;
        throw new Error('fallo simulado de escritura');
      }
      store.persisted = state;
    },
  };
  return { adapter, store };
}

asyncTest('hidrata en vacío cuando no hay nada persistido', async () => {
  const { adapter } = makeFakeAdapter(emptyPaymentsState());
  const controller = createPaymentsStoreController(adapter);
  const hydrated = await controller.hydrate();
  assertEqual(hydrated.charges.length, 0, 'sin cargos');
  assertEqual(hydrated.payments.length, 0, 'sin pagos');
});

asyncTest('applyMutation persiste y actualiza el snapshot en memoria', async () => {
  const { adapter, store } = makeFakeAdapter(emptyPaymentsState());
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();

  const next = sampleState();
  const result = await controller.applyMutation(() => next);

  assertEqual(result.charges.length, 1, 'el snapshot devuelto refleja el cambio');
  assertEqual(controller.getSnapshot().charges.length, 1, 'el snapshot en memoria también');
  assertEqual(store.persisted.charges.length, 1, 'quedó persistido');
  assertEqual(store.writeCallCount, 1, 'una sola escritura');
});

asyncTest('si la escritura falla, revierte el estado en memoria al anterior', async () => {
  const { adapter, store } = makeFakeAdapter(emptyPaymentsState());
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();
  await controller.applyMutation(() => sampleState()); // estado base válido, persistido con éxito

  store.failNextWrite = true;
  let rejected = false;
  try {
    await controller.applyMutation(() => sampleState({ charges: [] })); // intenta vaciar los cargos
  } catch {
    rejected = true;
  }

  assert(rejected, 'la mutación fallida se propaga');
  assertEqual(controller.getSnapshot().charges.length, 1, 'el estado en memoria vuelve al anterior, no queda vacío');
  assertEqual(store.persisted.charges.length, 1, 'lo persistido tampoco cambió');
});

asyncTest(
  'fallo de persistencia (validación de dominio): un registro de pago inválido no deja estado parcial',
  async () => {
    // Caso real de dominio, no un throw genérico: un importe que supera lo
    // asignable hace que `planPaymentRegistration` lance DENTRO del
    // updater, antes de que `applyMutation` llegue siquiera a escribir.
    const initial = sampleState(); // un cargo de 10000
    const { adapter, store } = makeFakeAdapter(initial);
    const controller = createPaymentsStoreController(adapter);
    await controller.hydrate();

    let rejected = false;
    try {
      await controller.applyMutation((current) => {
        const result = planPaymentRegistration({
          paymentId: 'payment-excesivo',
          studentId: 's1',
          amount: 999999, // muy por encima de lo asignable
          method: 'efectivo',
          paidAt: '2026-07-05',
          recordedAt: '2026-07-05T12:00:00.000Z',
          todayDateKey: '2026-07-05',
          state: current,
          allocationIdPrefix: 'payment-excesivo_alloc_',
        });
        return {
          ...current,
          payments: [...current.payments, result.payment],
          allocations: [...current.allocations, ...result.allocations],
        };
      });
    } catch {
      rejected = true;
    }

    assert(rejected, 'la validación de dominio rechaza el registro');
    assertEqual(controller.getSnapshot().payments.length, 0, 'no queda ningún pago a medias en memoria');
    assertEqual(controller.getSnapshot().allocations.length, 0, 'no queda ninguna asignación a medias en memoria');
    assertEqual(store.persisted.payments.length, 0, 'tampoco se persistió nada parcial');
    assertEqual(store.writeCallCount, 0, 'ni siquiera se intentó escribir: el updater lanzó antes');
  }
);

asyncTest('applyMutation no muta el objeto de estado recibido', async () => {
  const { adapter } = makeFakeAdapter(emptyPaymentsState());
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();

  const next = sampleState();
  const snapshot = JSON.stringify(next);
  await controller.applyMutation(() => next);
  assertEqual(JSON.stringify(next), snapshot, 'el objeto pasado no cambia');

  // Mutar el objeto original después no debe afectar lo que el store guardó.
  next.charges[0].originalAmount = 999999;
  assertEqual(
    controller.getSnapshot().charges[0].originalAmount,
    10000,
    'el store guardó una copia, no una referencia'
  );
});

asyncTest('applyMutation recibe el snapshot ACTUAL, no uno viejo capturado antes', async () => {
  const { adapter } = makeFakeAdapter(emptyPaymentsState());
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();

  await controller.applyMutation(() => sampleState());
  // Esta mutación agrega un segundo cargo basándose en lo que el updater
  // recibe como parámetro, no en una variable capturada de antemano — así
  // dos mutaciones encadenadas nunca se pisan entre sí.
  const result = await controller.applyMutation((current) => ({
    ...current,
    charges: [
      ...current.charges,
      {
        id: 'charge-2',
        studentId: 's2',
        type: 'mensual',
        originalAmount: 5000,
        currency: 'ARS',
        dueDate: '2026-08-01',
        createdAt: '2026-08-01T00:00:00.000Z',
        billingPeriod: '2026-08',
        voidedAt: null,
        voidReason: null,
      },
    ],
  }));

  assertEqual(result.charges.length, 2, 'la segunda mutación ve y conserva lo que dejó la primera');
});

asyncTest('applyMutation rechaza mutar antes de hidratar', async () => {
  const { adapter } = makeFakeAdapter(sampleState());
  const controller = createPaymentsStoreController(adapter);

  let rejected = false;
  try {
    await controller.applyMutation(() => emptyPaymentsState());
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se puede mutar sin hidratar antes: arriesgaría sobrescribir datos persistidos reales');
});

asyncTest(
  'applyMutation serializa mutaciones concurrentes: si A falla después de que B ya se persistió, memoria y almacenamiento terminan iguales',
  async () => {
    // Reproduce exactamente la carrera reportada: la mutación A arranca y
    // su escritura queda pendiente (controlada manualmente por el test); la
    // mutación B arranca sin esperar a A, y su escritura se persiste
    // primero; recién después, la escritura de A falla. Sin cola interna,
    // el catch de A revertía `current` al estado anterior a la propia A
    // (perdiendo el cambio de B en memoria, aunque B ya estuviera
    // persistido) — memoria terminaba vacía y almacenamiento con A+B.
    const rejectFirstWriteHolder: Array<(error: Error) => void> = [];
    let writeCallCount = 0;
    const store = { persisted: emptyPaymentsState() };

    const adapter: PaymentsPersistenceAdapter = {
      readAll: async () => store.persisted,
      writeAll: async (state) => {
        writeCallCount += 1;
        if (writeCallCount === 1) {
          // La primera escritura (mutación A) no se resuelve sola: el test
          // decide explícitamente cuándo y cómo termina, más abajo.
          await new Promise<void>((_resolve, reject) => {
            rejectFirstWriteHolder.push(reject);
          });
        }
        store.persisted = state;
      },
    };

    const controller = createPaymentsStoreController(adapter);
    await controller.hydrate();

    const chargeA = sampleState().charges[0];
    const chargeB = { ...chargeA, id: 'charge-B', billingPeriod: '2026-08', dueDate: '2026-08-01' };

    const promiseA = controller.applyMutation((current) => ({
      ...current,
      charges: [...current.charges, chargeA],
    }));
    const promiseB = controller.applyMutation((current) => ({
      ...current,
      charges: [...current.charges, chargeB],
    }));

    // Deja correr la cadena de microtareas (`.catch().then()` de la cola
    // interna) hasta que la escritura de A quede efectivamente en curso.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Con la cola interna, la mutación B ni siquiera empezó a ejecutar su
    // updater todavía — está esperando a que A termine (con éxito o error).
    assertEqual(writeCallCount, 1, 'sólo la escritura de A está en curso; B todavía no arrancó');
    assertEqual(rejectFirstWriteHolder.length, 1, 'la primera escritura ya debería estar en curso');
    rejectFirstWriteHolder[0](new Error('fallo simulado de la mutación A'));

    let rejectedA = false;
    try {
      await promiseA;
    } catch {
      rejectedA = true;
    }
    assert(rejectedA, 'la mutación A efectivamente falla');

    const resultB = await promiseB;
    assertEqual(resultB.charges.map((c) => c.id).sort().join(','), 'charge-B', 'B se persiste sin el cargo de A');

    assertEqual(
      JSON.stringify(controller.getSnapshot()),
      JSON.stringify(store.persisted),
      'memoria y almacenamiento terminan exactamente iguales'
    );
    assertEqual(
      controller.getSnapshot().charges.map((c) => c.id).sort().join(','),
      'charge-B',
      'sólo queda el cargo de B: el de A se revirtió correctamente antes de que B empezara'
    );
  }
);

asyncTest('hydrate es idempotente: no vuelve a leer una vez hidratado', async () => {
  let readCalls = 0;
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => {
      readCalls += 1;
      return emptyPaymentsState();
    },
    writeAll: async () => {},
  };
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();
  await controller.hydrate();
  await controller.hydrate();
  assertEqual(readCalls, 1, 'sólo lee una vez, aunque se llame varias veces');
});

asyncTest('replaceInMemory sincroniza sin persistir', async () => {
  let writeCalls = 0;
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => emptyPaymentsState(),
    writeAll: async () => {
      writeCalls += 1;
    },
  };
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();
  controller.replaceInMemory(sampleState());
  assertEqual(controller.getSnapshot().charges.length, 1, 'el snapshot en memoria cambia');
  assertEqual(writeCalls, 0, 'nunca escribe: la persistencia ya ocurrió por otra vía (restauración)');
});

// ---------------------------------------------------------------------------
// parsePersistedPaymentsArray / parsePersistedPaymentsSchemaVersion: la
// lógica de parseo pura que usa el adaptador real de AsyncStorage. Probada
// directamente con strings crudos porque AsyncStorage no funciona fuera de
// un runtime de React Native (no se puede probar aquí llamando al adaptador
// real). Nunca debe convertir JSON corrupto en una colección vacía.
// ---------------------------------------------------------------------------

test('parsePersistedPaymentsArray hidrata en vacío cuando la clave no existe (instalación nueva)', () => {
  const result = parsePersistedPaymentsArray(null, 'pagos');
  assertEqual(result.length, 0, 'clave inexistente es una colección vacía válida, no un error');
});

test('parsePersistedPaymentsArray rechaza JSON corrupto en vez de convertirlo en vacío', () => {
  let rejected = false;
  try {
    parsePersistedPaymentsArray('{esto no es JSON válido', 'pagos');
  } catch {
    rejected = true;
  }
  assert(rejected, 'JSON corrupto debe fallar explícitamente, nunca silenciarse como []');
});

test('parsePersistedPaymentsArray rechaza un valor de tipo incorrecto (no es una lista)', () => {
  let rejected = false;
  try {
    parsePersistedPaymentsArray(JSON.stringify({ no: 'es un array' }), 'pagos');
  } catch {
    rejected = true;
  }
  assert(rejected, 'un objeto en vez de un array debe fallar explícitamente');
});

test('parsePersistedPaymentsArray acepta una lista válida tal cual', () => {
  const result = parsePersistedPaymentsArray<{ id: string }>(JSON.stringify([{ id: 'a' }]), 'pagos');
  assertEqual(result.length, 1, 'conserva los elementos de una lista válida');
});

test('parsePersistedPaymentsSchemaVersion acepta clave inexistente (instalación nueva)', () => {
  const result = parsePersistedPaymentsSchemaVersion(null);
  assertEqual(result, null, 'clave inexistente no es un error');
});

test('parsePersistedPaymentsSchemaVersion rechaza JSON corrupto', () => {
  let rejected = false;
  try {
    parsePersistedPaymentsSchemaVersion('{esto no es JSON válido');
  } catch {
    rejected = true;
  }
  assert(rejected, 'JSON corrupto en la versión interna debe fallar explícitamente');
});

test('parsePersistedPaymentsSchemaVersion rechaza un valor que no es un número', () => {
  let rejected = false;
  try {
    parsePersistedPaymentsSchemaVersion(JSON.stringify('1'));
  } catch {
    rejected = true;
  }
  assert(rejected, 'una versión interna que no es un número debe fallar explícitamente');
});

test('parsePersistedPaymentsSchemaVersion rechaza una versión interna desconocida', () => {
  let rejected = false;
  try {
    parsePersistedPaymentsSchemaVersion(JSON.stringify(99));
  } catch {
    rejected = true;
  }
  assert(rejected, 'una versión distinta de PAYMENTS_SCHEMA_VERSION debe rechazarse, no leerse como compatible');
});

test('parsePersistedPaymentsSchemaVersion acepta la versión actual', () => {
  const result = parsePersistedPaymentsSchemaVersion(JSON.stringify(1));
  assertEqual(result, 1, 'la versión actual se acepta tal cual');
});

asyncTest('si la lectura real detecta corrupción, hydrate() propaga el error en vez de hidratar vacío', async () => {
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => {
      // Simula lo que haría el adaptador real al toparse con JSON corrupto:
      // lanzar, no devolver un estado vacío.
      parsePersistedPaymentsArray('{corrupto', 'obligaciones de cobro');
      return emptyPaymentsState(); // inalcanzable
    },
    writeAll: async () => {},
  };
  const controller = createPaymentsStoreController(adapter);

  let rejected = false;
  try {
    await controller.hydrate();
  } catch {
    rejected = true;
  }
  assert(rejected, 'la corrupción detectada en la lectura real nunca se convierte en un store vacío silencioso');
});

asyncTest('si hydrate() falla, una nueva llamada reintenta leer en vez de quedar rechazada para siempre', async () => {
  let attempt = 0;
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('fallo simulado de lectura (transitorio)');
      }
      return sampleState();
    },
    writeAll: async () => {},
  };
  const controller = createPaymentsStoreController(adapter);

  let firstRejected = false;
  try {
    await controller.hydrate();
  } catch {
    firstRejected = true;
  }
  assert(firstRejected, 'el primer intento falla');

  const secondResult = await controller.hydrate();
  assertEqual(attempt, 2, 'el segundo llamado a hydrate() vuelve a leer, no reutiliza la promesa rechazada');
  assertEqual(secondResult.charges.length, 1, 'el reintento exitoso hidrata con los datos reales');
});
