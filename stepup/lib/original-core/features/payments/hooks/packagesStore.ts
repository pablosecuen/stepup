// Puerto VERBATIM del original (`src/features/payments/hooks/packagesStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { PackageCreditMovement, PackagePurchase, PackagesRepositoryState } from '../types/index.ts';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): store de paquetes de clases, separado de `paymentsStore.ts`
 * a propósito — mismo patrón exacto de hidratación perezosa, mutación
 * atómica encolada y rollback ante fallo de escritura, pero como store
 * independiente para no arriesgar el motor financiero ya probado
 * (293 pruebas) al extenderlo. La COMPRA del paquete se cobra como un
 * `PaymentCharge` normal en el store de pagos; acá sólo vive el paquete en
 * sí y sus movimientos de crédito.
 */
export const PACKAGES_SCHEMA_VERSION = 1;

export const PACKAGES_STORAGE_KEYS = {
  schemaVersion: '@teacherflow/packages_schema_version',
  purchases: '@teacherflow/package_purchases',
  creditMovements: '@teacherflow/package_credit_movements',
} as const;

export function emptyPackagesState(): PackagesRepositoryState {
  return { purchases: [], creditMovements: [] };
}

function cloneState(state: PackagesRepositoryState): PackagesRepositoryState {
  return {
    purchases: state.purchases.map((purchase) => ({ ...purchase })),
    creditMovements: state.creditMovements.map((movement) => ({ ...movement })),
  };
}

export interface PackagesPersistenceAdapter {
  readAll: () => Promise<PackagesRepositoryState>;
  writeAll: (state: PackagesRepositoryState) => Promise<void>;
}

export interface PackagesStoreController {
  hydrate: () => Promise<PackagesRepositoryState>;
  getSnapshot: () => PackagesRepositoryState;
  applyMutation: (
    updater: (current: PackagesRepositoryState) => PackagesRepositoryState
  ) => Promise<PackagesRepositoryState>;
  replaceInMemory: (nextState: PackagesRepositoryState) => void;
  subscribe: (listener: () => void) => () => void;
  resetForTests: () => void;
}

export function createPackagesStoreController(adapter: PackagesPersistenceAdapter): PackagesStoreController {
  let current: PackagesRepositoryState = emptyPackagesState();
  let hydrationPromise: Promise<PackagesRepositoryState> | null = null;
  let hasHydrated = false;
  const listeners = new Set<() => void>();
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function getSnapshot(): PackagesRepositoryState {
    return cloneState(current);
  }

  function hydrate(): Promise<PackagesRepositoryState> {
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
          hydrationPromise = null;
          throw error;
        });
    }
    return hydrationPromise;
  }

  async function runQueuedMutation(
    updater: (current: PackagesRepositoryState) => PackagesRepositoryState
  ): Promise<PackagesRepositoryState> {
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
    updater: (current: PackagesRepositoryState) => PackagesRepositoryState
  ): Promise<PackagesRepositoryState> {
    if (!hasHydrated) {
      return Promise.reject(new Error('No se puede modificar el store de paquetes antes de hidratarlo.'));
    }
    const result = mutationQueue.catch(() => {}).then(() => runQueuedMutation(updater));
    mutationQueue = result.catch(() => {});
    return result;
  }

  function replaceInMemory(nextState: PackagesRepositoryState): void {
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
    current = emptyPackagesState();
    mutationQueue = Promise.resolve();
  }

  return { hydrate, getSnapshot, applyMutation, replaceInMemory, subscribe, resetForTests };
}

export function parsePersistedPackagesArray<T>(raw: string | null, label: string): T[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`El almacenamiento de paquetes está dañado: "${label}" no contiene JSON válido.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`El almacenamiento de paquetes está dañado: "${label}" no contiene una lista.`);
  }
  return parsed as T[];
}

export function parsePersistedPackagesSchemaVersion(raw: string | null): number | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El almacenamiento de paquetes está dañado: la versión interna no contiene JSON válido.');
  }
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error('El almacenamiento de paquetes está dañado: la versión interna no es un número válido.');
  }
  if (parsed !== PACKAGES_SCHEMA_VERSION) {
    throw new Error(
      `Versión interna de paquetes desconocida (${parsed}). Esta versión de TeacherFlow sólo admite la versión ${PACKAGES_SCHEMA_VERSION}.`
    );
  }
  return parsed;
}

async function readArray<T>(key: string, label: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  return parsePersistedPackagesArray<T>(raw, label);
}

const realAdapter: PackagesPersistenceAdapter = {
  readAll: async () => {
    const schemaVersionRaw = await AsyncStorage.getItem(PACKAGES_STORAGE_KEYS.schemaVersion);
    parsePersistedPackagesSchemaVersion(schemaVersionRaw);
    const [purchases, creditMovements] = await Promise.all([
      readArray<PackagePurchase>(PACKAGES_STORAGE_KEYS.purchases, 'paquetes comprados'),
      readArray<PackageCreditMovement>(PACKAGES_STORAGE_KEYS.creditMovements, 'movimientos de crédito'),
    ]);
    return { purchases, creditMovements };
  },
  writeAll: async (state) => {
    await AsyncStorage.multiSet([
      [PACKAGES_STORAGE_KEYS.schemaVersion, JSON.stringify(PACKAGES_SCHEMA_VERSION)],
      [PACKAGES_STORAGE_KEYS.purchases, JSON.stringify(state.purchases)],
      [PACKAGES_STORAGE_KEYS.creditMovements, JSON.stringify(state.creditMovements)],
    ]);
  },
};

const singleton = createPackagesStoreController(realAdapter);

export const hydratePackagesStore = singleton.hydrate;
export const getPackagesSnapshot = singleton.getSnapshot;
export const applyPackagesMutation = singleton.applyMutation;
export const replacePackagesStoreInMemory = singleton.replaceInMemory;
export const subscribePackages = singleton.subscribe;
export const resetPackagesHydrationForTests = singleton.resetForTests;
