// Puerto VERBATIM del original (`src/features/payments/hooks/trainingBillingAgreementsStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { TrainingBillingAgreement } from '../types/index.ts';
import { isValidBillingPeriod } from '../utils/paymentDates.ts';

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): configuración financiera de cada serie de entrenamiento
 * (`TrainingBillingAgreement`, ver `types/index.ts`) — nunca es la fuente de
 * verdad de un saldo (eso sigue siendo `PaymentCharge`), sólo la
 * configuración vigente (cuota, vigencia de cambio de precio, primer
 * período facturable) de cada acuerdo.
 *
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural, "STORE
 * CON COLA DE MUTACIONES"): el read-modify-write directo original (sin
 * cola) permitía que dos operaciones concurrentes (por ejemplo, dos
 * confirmaciones casi simultáneas) leyeran el MISMO estado de partida y que
 * la última escritura pisara/perdiera la de la primera. Ahora replica
 * EXACTAMENTE el mismo patrón de cola atómica que `paymentsStore.ts`
 * (`createPaymentsStoreController`): las mutaciones se serializan, cada una
 * calcula contra el ÚLTIMO estado ya confirmado (nunca un snapshot leído
 * antes de encolarse), se persiste, y sólo si la escritura tiene éxito se
 * actualiza el caché en memoria — si falla, el estado en memoria vuelve
 * exactamente al que había antes de intentar el cambio.
 */
export const TRAINING_BILLING_AGREEMENTS_STORAGE_KEY = '@teacherflow/training_billing_agreements';

function isValidTrainingBillingAgreement(value: unknown): value is TrainingBillingAgreement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.monthlyFee === 'number' &&
    Number.isFinite(candidate.monthlyFee) &&
    candidate.monthlyFee > 0 &&
    (candidate.pendingMonthlyFee === undefined ||
      (typeof candidate.pendingMonthlyFee === 'number' && Number.isFinite(candidate.pendingMonthlyFee) && candidate.pendingMonthlyFee > 0)) &&
    (candidate.pendingMonthlyFeeEffectiveFrom === undefined ||
      (typeof candidate.pendingMonthlyFeeEffectiveFrom === 'string' && isValidBillingPeriod(candidate.pendingMonthlyFeeEffectiveFrom))) &&
    typeof candidate.startPeriod === 'string' &&
    isValidBillingPeriod(candidate.startPeriod) &&
    typeof candidate.createdAt === 'string' &&
    !Number.isNaN(new Date(candidate.createdAt).getTime())
  );
}

/** Parseo puro, separado de AsyncStorage para poder probarlo directamente. Una entrada corrupta se descarta sin invalidar el resto. */
export function parsePersistedTrainingBillingAgreements(raw: string | null): TrainingBillingAgreement[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidTrainingBillingAgreement);
}

function cloneAgreements(entries: TrainingBillingAgreement[]): TrainingBillingAgreement[] {
  return entries.map((entry) => ({ ...entry }));
}

/** Reemplaza la entrada existente con el mismo `id`, o la agrega si es nueva — nunca duplica por id. Pura. */
export function upsertAgreementInList(
  entries: TrainingBillingAgreement[],
  entry: TrainingBillingAgreement
): TrainingBillingAgreement[] {
  const exists = entries.some((item) => item.id === entry.id);
  return exists ? entries.map((item) => (item.id === entry.id ? entry : item)) : [...entries, entry];
}

export function findTrainingBillingAgreement(
  entries: readonly TrainingBillingAgreement[],
  id: string
): TrainingBillingAgreement | null {
  return entries.find((entry) => entry.id === id) ?? null;
}

/**
 * Cómo se lee/escribe la lista completa — separado de la orquestación
 * (`createTrainingBillingAgreementsStoreController`) para poder probar
 * hidratación, mutaciones atómicas y rollback con un adaptador falso (que
 * puede fallar a pedido, ver pruebas de inyección de fallos), sin depender
 * de AsyncStorage real. Mismo patrón que `PaymentsPersistenceAdapter`.
 */
export interface TrainingBillingAgreementsPersistenceAdapter {
  readAll: () => Promise<TrainingBillingAgreement[]>;
  writeAll: (entries: TrainingBillingAgreement[]) => Promise<void>;
}

export interface TrainingBillingAgreementsStoreController {
  hydrate: () => Promise<TrainingBillingAgreement[]>;
  getSnapshot: () => TrainingBillingAgreement[];
  isHydrated: () => boolean;
  /**
   * Reemplaza y persiste la lista completa en una única operación atómica,
   * encolada detrás de cualquier mutación anterior — mismo contrato que
   * `PaymentsStoreController.applyMutation`: el `updater` recibe el ÚLTIMO
   * estado confirmado (nunca un snapshot stale), y si la escritura real
   * falla, el estado en memoria vuelve exactamente al que había antes.
   */
  applyMutation: (
    updater: (current: TrainingBillingAgreement[]) => TrainingBillingAgreement[]
  ) => Promise<TrainingBillingAgreement[]>;
  /** Conveniencia sobre `applyMutation`: upsert de una sola entrada por id. */
  upsert: (entry: TrainingBillingAgreement) => Promise<TrainingBillingAgreement[]>;
  /** Igual que en los demás stores: sincroniza sólo memoria, sin persistir (restauración de respaldos). */
  replaceInMemory: (nextEntries: TrainingBillingAgreement[]) => void;
  subscribe: (listener: () => void) => () => void;
  resetForTests: () => void;
}

export function createTrainingBillingAgreementsStoreController(
  adapter: TrainingBillingAgreementsPersistenceAdapter
): TrainingBillingAgreementsStoreController {
  let current: TrainingBillingAgreement[] = [];
  let hydrationPromise: Promise<TrainingBillingAgreement[]> | null = null;
  let hasHydrated = false;
  const listeners = new Set<() => void>();

  // Misma cola interna que `paymentsStore.ts` — ver ese archivo para la
  // explicación completa de por qué es necesaria (sin ella, dos
  // `applyMutation` concurrentes pueden pisarse entre sí).
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function getSnapshot(): TrainingBillingAgreement[] {
    return cloneAgreements(current);
  }

  function hydrate(): Promise<TrainingBillingAgreement[]> {
    if (!hydrationPromise) {
      hydrationPromise = adapter
        .readAll()
        .then((entries) => {
          current = cloneAgreements(entries);
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
    updater: (current: TrainingBillingAgreement[]) => TrainingBillingAgreement[]
  ): Promise<TrainingBillingAgreement[]> {
    const previous = current;
    const nextEntries = updater(getSnapshot());
    current = cloneAgreements(nextEntries);
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
    updater: (current: TrainingBillingAgreement[]) => TrainingBillingAgreement[]
  ): Promise<TrainingBillingAgreement[]> {
    if (!hasHydrated) {
      return Promise.reject(new Error('No se puede modificar la configuración de entrenamientos antes de hidratarla.'));
    }
    const result = mutationQueue.catch(() => {}).then(() => runQueuedMutation(updater));
    mutationQueue = result.catch(() => {});
    return result;
  }

  function upsert(entry: TrainingBillingAgreement): Promise<TrainingBillingAgreement[]> {
    return applyMutation((currentEntries) => upsertAgreementInList(currentEntries, entry));
  }

  function replaceInMemory(nextEntries: TrainingBillingAgreement[]): void {
    current = cloneAgreements(nextEntries);
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
    current = [];
    mutationQueue = Promise.resolve();
  }

  return {
    hydrate,
    getSnapshot,
    isHydrated: () => hasHydrated,
    applyMutation,
    upsert,
    replaceInMemory,
    subscribe,
    resetForTests,
  };
}

// ---------------------------------------------------------------------------
// Adaptador real (AsyncStorage) y store de módulo singleton — mismo patrón
// que `paymentsStore.ts`.
// ---------------------------------------------------------------------------

const realAdapter: TrainingBillingAgreementsPersistenceAdapter = {
  readAll: async () => {
    const raw = await AsyncStorage.getItem(TRAINING_BILLING_AGREEMENTS_STORAGE_KEY);
    return parsePersistedTrainingBillingAgreements(raw);
  },
  writeAll: async (entries) => {
    await AsyncStorage.setItem(TRAINING_BILLING_AGREEMENTS_STORAGE_KEY, JSON.stringify(entries));
  },
};

const singleton = createTrainingBillingAgreementsStoreController(realAdapter);

export const hydrateTrainingBillingAgreements = singleton.hydrate;
export const getTrainingBillingAgreementsSnapshot = singleton.getSnapshot;
export const isTrainingBillingAgreementsCacheHydrated = singleton.isHydrated;
export const applyTrainingBillingAgreementsMutation = singleton.applyMutation;
/** Upsert atómico y encolado — reemplaza el read-modify-write directo anterior. */
export const upsertTrainingBillingAgreement = singleton.upsert;
export const replaceTrainingBillingAgreementsInMemory = singleton.replaceInMemory;
export const subscribeTrainingBillingAgreements = singleton.subscribe;
export const resetTrainingBillingAgreementsForTests = singleton.resetForTests;

// ---------------------------------------------------------------------------
// Compatibilidad con el resto del código/pruebas ya escritas contra el
// nombre anterior de estas funciones — mismo comportamiento real, nunca una
// segunda implementación paralela.
// ---------------------------------------------------------------------------

/** @deprecated usar `hydrateTrainingBillingAgreements` + `getTrainingBillingAgreementsSnapshot`. Lee directo de AsyncStorage, sin pasar por la cola/caché del store. */
export async function loadTrainingBillingAgreements(): Promise<TrainingBillingAgreement[]> {
  return realAdapter.readAll();
}

/** @deprecated usar `applyTrainingBillingAgreementsMutation`/`upsertTrainingBillingAgreement` — escribir directo salteando la cola puede perder una mutación concurrente. */
export async function saveTrainingBillingAgreements(entries: TrainingBillingAgreement[]): Promise<void> {
  await realAdapter.writeAll(entries);
}

export function replaceTrainingBillingAgreementsCacheForTests(entries: TrainingBillingAgreement[]): void {
  replaceTrainingBillingAgreementsInMemory(entries);
}

export function resetTrainingBillingAgreementsCacheForTests(): void {
  resetTrainingBillingAgreementsForTests();
}
