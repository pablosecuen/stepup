// Puerto VERBATIM del original (`src/features/payments/hooks/paymentsStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { Payment, PaymentAdjustment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../types/index.ts';

/**
 * Versión interna del store de pagos (independiente de `schemaVersion` del
 * respaldo, que versiona el documento exportado completo). Todavía no hay
 * una versión anterior de la que migrar; se persiste desde ya para que una
 * futura migración de este dominio tenga de dónde partir.
 */
export const PAYMENTS_SCHEMA_VERSION = 1;

export const PAYMENTS_STORAGE_KEYS = {
  schemaVersion: '@teacherflow/payments_schema_version',
  charges: '@teacherflow/payment_charges',
  payments: '@teacherflow/payments',
  allocations: '@teacherflow/payment_allocations',
  adjustments: '@teacherflow/payment_adjustments',
} as const;

export function emptyPaymentsState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function cloneState(state: PaymentsRepositoryState): PaymentsRepositoryState {
  return {
    charges: state.charges.map((charge) => ({ ...charge })),
    payments: state.payments.map((payment) => ({ ...payment })),
    allocations: state.allocations.map((allocation) => ({ ...allocation })),
    adjustments: state.adjustments.map((adjustment) => ({ ...adjustment })),
  };
}

/**
 * Cómo se lee/escribe el estado completo. Separado de la orquestación (ver
 * `createPaymentsStoreController`) para poder probar hidratación,
 * mutaciones atómicas y rollback con un adaptador falso, sin depender de
 * AsyncStorage real — igual que `RestoreIoAdapters` en el módulo de
 * respaldo.
 */
export interface PaymentsPersistenceAdapter {
  readAll: () => Promise<PaymentsRepositoryState>;
  writeAll: (state: PaymentsRepositoryState) => Promise<void>;
}

export interface PaymentsStoreController {
  hydrate: () => Promise<PaymentsRepositoryState>;
  getSnapshot: () => PaymentsRepositoryState;
  /**
   * Reemplaza y persiste el estado completo en una única operación
   * atómica. Recibe una función basada en el snapshot ACTUAL (no un valor
   * ya armado de antemano) para que dos mutaciones encadenadas nunca
   * sobrescriban una a la otra con un estado viejo. Exige que el store ya
   * esté hidratado: mutar antes de hidratar arriesgaría sobrescribir datos
   * persistidos reales con un estado que arrancó vacío. Si la escritura
   * falla, revierte el estado en memoria al que había antes de intentar el
   * cambio y relanza el error — nunca deja memoria y almacenamiento
   * desincronizados. No guarda ningún estado derivado (recargos, saldos,
   * scoring): eso siempre se recalcula con el motor puro a partir de estas
   * cuatro colecciones.
   */
  applyMutation: (
    updater: (current: PaymentsRepositoryState) => PaymentsRepositoryState
  ) => Promise<PaymentsRepositoryState>;
  /** Igual que en los demás stores: sincroniza sólo memoria, sin persistir (restauración de respaldos). */
  replaceInMemory: (nextState: PaymentsRepositoryState) => void;
  subscribe: (listener: () => void) => () => void;
  resetForTests: () => void;
}

/** Orquestación pura (salvo por el adaptador inyectado): hidratar, mutar atómicamente, revertir si falla. */
export function createPaymentsStoreController(adapter: PaymentsPersistenceAdapter): PaymentsStoreController {
  let current: PaymentsRepositoryState = emptyPaymentsState();
  let hydrationPromise: Promise<PaymentsRepositoryState> | null = null;
  let hasHydrated = false;
  const listeners = new Set<() => void>();

  // Cola interna de mutaciones: sin esto, dos `applyMutation` sin `await`
  // entre sí corren en paralelo. Si la primera (A) queda con la escritura
  // pendiente, la segunda (B) puede capturar el estado optimista de A como
  // "anterior", persistirse con éxito, y recién ahí A falla y revierte
  // `current` al estado previo a la propia A (perdiendo el cambio de B en
  // memoria, aunque B ya haya quedado escrito en el almacenamiento real).
  // Encolar garantiza que cada mutación arranca recién cuando la anterior
  // terminó (con éxito o con error) — nunca hay dos escrituras en vuelo a
  // la vez, así que "previous" siempre es el último estado confirmado.
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function getSnapshot(): PaymentsRepositoryState {
    return cloneState(current);
  }

  function hydrate(): Promise<PaymentsRepositoryState> {
    if (!hydrationPromise) {
      hydrationPromise = adapter
        .readAll()
        .then((state) => {
          current = cloneState(state);
          hasHydrated = true;
          notify();
          return getSnapshot();
        })
        .catch((error) => {
          // Si la lectura falla (por ejemplo, corrupción detectada), NO se
          // deja `hydrationPromise` cacheado como rechazado para siempre:
          // eso dejaría a la app sin forma de reintentar. Se limpia para
          // que la próxima llamada a `hydrate()` vuelva a intentar leer el
          // almacenamiento real. `current`/`hasHydrated` nunca se tocan acá
          // (el estado en memoria sigue vacío/no hidratado, tal cual antes
          // del intento fallido).
          hydrationPromise = null;
          throw error;
        });
    }
    return hydrationPromise;
  }

  async function runQueuedMutation(
    updater: (current: PaymentsRepositoryState) => PaymentsRepositoryState
  ): Promise<PaymentsRepositoryState> {
    const previous = current;
    const nextState = updater(getSnapshot());
    current = cloneState(nextState);
    notify();
    try {
      await adapter.writeAll(current);
    } catch (error) {
      current = previous;
      notify();
      throw error;
    }
    return getSnapshot();
  }

  function applyMutation(
    updater: (current: PaymentsRepositoryState) => PaymentsRepositoryState
  ): Promise<PaymentsRepositoryState> {
    if (!hasHydrated) {
      return Promise.reject(new Error('No se puede modificar el store de pagos antes de hidratarlo.'));
    }
    // Encadena esta mutación después de que la anterior TERMINE, sea cual
    // sea su resultado. El `.catch(() => {})` intermedio evita que un
    // fallo previo deje `mutationQueue` como una promesa rechazada para
    // siempre — la cola debe poder seguir procesando mutaciones después de
    // un error; el error real de ESTA mutación se sigue propagando al
    // llamador a través de `result`.
    const result = mutationQueue.catch(() => {}).then(() => runQueuedMutation(updater));
    mutationQueue = result.catch(() => {});
    return result;
  }

  function replaceInMemory(nextState: PaymentsRepositoryState): void {
    current = cloneState(nextState);
    hasHydrated = true;
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function resetForTests(): void {
    hydrationPromise = null;
    hasHydrated = false;
    current = emptyPaymentsState();
    mutationQueue = Promise.resolve();
  }

  return { hydrate, getSnapshot, applyMutation, replaceInMemory, subscribe, resetForTests };
}

// ---------------------------------------------------------------------------
// Adaptador real (AsyncStorage) y store de módulo singleton, usado por el
// resto de la app — mismo patrón que `studentStore.ts`/`teacherAvailabilityStore.ts`.
//
// A propósito NUNCA se convierte JSON corrupto en una colección vacía: una
// instalación realmente nueva (clave inexistente) hidrata en vacío, pero una
// clave que existe con contenido dañado o de tipo incorrecto debe fallar de
// forma explícita — lo contrario arriesgaría "perder" pagos ya cargados sin
// que nadie se entere.
// ---------------------------------------------------------------------------

/**
 * Lógica de parseo pura, separada de la lectura en AsyncStorage para poder
 * probarla directamente con distintos strings crudos (Node no puede llamar
 * a AsyncStorage fuera de un runtime de React Native). `raw === null`
 * significa clave inexistente (instalación nueva, o colección que nunca se
 * escribió todavía) y nunca es un error — cualquier otro contenido dañado
 * (JSON inválido, tipo incorrecto) sí lo es.
 */
export function parsePersistedPaymentsArray<T>(raw: string | null, label: string): T[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`El almacenamiento de pagos está dañado: "${label}" no contiene JSON válido.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`El almacenamiento de pagos está dañado: "${label}" no contiene una lista.`);
  }
  return parsed as T[];
}

/**
 * Valida la versión interna persistida. `raw === null` significa clave
 * inexistente (instalación nueva) — no es un error. Cualquier otro valor
 * debe ser exactamente `PAYMENTS_SCHEMA_VERSION`; una versión distinta (de
 * una build futura o corrupta) se rechaza en vez de intentar leerla como si
 * fuera compatible.
 */
export function parsePersistedPaymentsSchemaVersion(raw: string | null): number | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El almacenamiento de pagos está dañado: la versión interna no contiene JSON válido.');
  }
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error('El almacenamiento de pagos está dañado: la versión interna no es un número válido.');
  }
  if (parsed !== PAYMENTS_SCHEMA_VERSION) {
    throw new Error(
      `Versión interna de pagos desconocida (${parsed}). Esta versión de TeacherFlow sólo admite la versión ${PAYMENTS_SCHEMA_VERSION}.`
    );
  }
  return parsed;
}

async function readArray<T>(key: string, label: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  return parsePersistedPaymentsArray<T>(raw, label);
}

const realAdapter: PaymentsPersistenceAdapter = {
  readAll: async () => {
    const schemaVersionRaw = await AsyncStorage.getItem(PAYMENTS_STORAGE_KEYS.schemaVersion);
    parsePersistedPaymentsSchemaVersion(schemaVersionRaw);
    const [charges, payments, allocations, adjustments] = await Promise.all([
      readArray<PaymentCharge>(PAYMENTS_STORAGE_KEYS.charges, 'obligaciones de cobro'),
      readArray<Payment>(PAYMENTS_STORAGE_KEYS.payments, 'pagos'),
      readArray<PaymentAllocation>(PAYMENTS_STORAGE_KEYS.allocations, 'asignaciones de pago'),
      readArray<PaymentAdjustment>(PAYMENTS_STORAGE_KEYS.adjustments, 'condonaciones'),
    ]);
    return { charges, payments, allocations, adjustments };
  },
  writeAll: async (state) => {
    await AsyncStorage.multiSet([
      [PAYMENTS_STORAGE_KEYS.schemaVersion, JSON.stringify(PAYMENTS_SCHEMA_VERSION)],
      [PAYMENTS_STORAGE_KEYS.charges, JSON.stringify(state.charges)],
      [PAYMENTS_STORAGE_KEYS.payments, JSON.stringify(state.payments)],
      [PAYMENTS_STORAGE_KEYS.allocations, JSON.stringify(state.allocations)],
      [PAYMENTS_STORAGE_KEYS.adjustments, JSON.stringify(state.adjustments)],
    ]);
  },
};

const singleton = createPaymentsStoreController(realAdapter);

export const hydratePaymentsStore = singleton.hydrate;
export const getPaymentsSnapshot = singleton.getSnapshot;
export const applyPaymentsMutation = singleton.applyMutation;
export const replacePaymentsStoreInMemory = singleton.replaceInMemory;
export const subscribePayments = singleton.subscribe;
export const resetPaymentsHydrationForTests = singleton.resetForTests;
