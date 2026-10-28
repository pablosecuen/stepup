// Puerto VERBATIM del original (`src/features/payments/hooks/budgetDistributionStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import { markLocalDataChanged } from '../../../shared/backup/localRevisionStore.ts';
import { DEFAULT_BUDGET_DISTRIBUTION_SETTINGS, DEFAULT_SAVINGS_GOAL, normalizeBudgetDistribution, type BudgetDistributionSettings } from '../utils/budgetDistribution.ts';

/**
 * Fase financiera — Plan de distribución 50/30/20 (a pedido de Joaquín):
 * fuente única de verdad de la distribución elegida por la profesora y de
 * su objetivo de ahorro opcional — mismo patrón exacto que
 * `surchargeSettingsStore.ts` (hidratar, mutar atómicamente con cola y
 * rollback, `subscribe`, `replaceInMemory` para restauración de respaldos),
 * simplificado (un único objeto sin vigencia futura escalonada — acá un
 * cambio de distribución rige de inmediato, nunca "a partir del próximo
 * mes"). A diferencia de `surchargeSettingsStore.ts`, cada escritura exitosa
 * avisa a `markLocalDataChanged()` (protección automática en la nube casi
 * inmediata, mismo mecanismo que alumnos/clases/pagos).
 */
export const BUDGET_DISTRIBUTION_SCHEMA_VERSION = 1;

export const BUDGET_DISTRIBUTION_STORAGE_KEYS = {
  schemaVersion: '@teacherflow/budget_distribution_schema_version',
  settings: '@teacherflow/budget_distribution',
} as const;

function cloneSettings(settings: BudgetDistributionSettings): BudgetDistributionSettings {
  return {
    distribution: { ...settings.distribution },
    savingsGoal: { ...settings.savingsGoal },
  };
}

export interface BudgetDistributionPersistenceAdapter {
  readAll: () => Promise<BudgetDistributionSettings>;
  writeAll: (settings: BudgetDistributionSettings) => Promise<void>;
}

export interface BudgetDistributionStoreController {
  hydrate: () => Promise<BudgetDistributionSettings>;
  getSnapshot: () => BudgetDistributionSettings;
  applyMutation: (
    updater: (current: BudgetDistributionSettings) => BudgetDistributionSettings
  ) => Promise<BudgetDistributionSettings>;
  replaceInMemory: (nextSettings: BudgetDistributionSettings) => void;
  subscribe: (listener: () => void) => () => void;
  resetForTests: () => void;
}

export function createBudgetDistributionStoreController(
  adapter: BudgetDistributionPersistenceAdapter,
  onDataChanged: () => void = () => {
    void markLocalDataChanged();
  }
): BudgetDistributionStoreController {
  let current: BudgetDistributionSettings = cloneSettings(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  let hydrationPromise: Promise<BudgetDistributionSettings> | null = null;
  let hasHydrated = false;
  const listeners = new Set<() => void>();

  // Misma cola que `surchargeSettingsStore.ts`/`paymentsStore.ts`: evita que
  // dos `applyMutation` sin `await` entre sí se pisen.
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function getSnapshot(): BudgetDistributionSettings {
    return cloneSettings(current);
  }

  function hydrate(): Promise<BudgetDistributionSettings> {
    if (!hydrationPromise) {
      hydrationPromise = adapter
        .readAll()
        .then((settings) => {
          current = cloneSettings(settings);
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
    updater: (current: BudgetDistributionSettings) => BudgetDistributionSettings
  ): Promise<BudgetDistributionSettings> {
    const previous = current;
    const nextSettings = updater(getSnapshot());
    current = cloneSettings(nextSettings);
    notify();
    try {
      await adapter.writeAll(current);
      onDataChanged();
    } catch (error) {
      current = previous;
      notify();
      throw error;
    }
    return getSnapshot();
  }

  function applyMutation(
    updater: (current: BudgetDistributionSettings) => BudgetDistributionSettings
  ): Promise<BudgetDistributionSettings> {
    if (!hasHydrated) {
      return Promise.reject(new Error('No se puede modificar el plan de distribución antes de hidratarlo.'));
    }
    const result = mutationQueue.catch(() => {}).then(() => runQueuedMutation(updater));
    mutationQueue = result.catch(() => {});
    return result;
  }

  function replaceInMemory(nextSettings: BudgetDistributionSettings): void {
    current = cloneSettings(nextSettings);
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
    current = cloneSettings(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
    mutationQueue = Promise.resolve();
  }

  return { hydrate, getSnapshot, applyMutation, replaceInMemory, subscribe, resetForTests };
}

// ---------------------------------------------------------------------------
// Adaptador real (AsyncStorage) y store de módulo singleton — mismo patrón
// que `surchargeSettingsStore.ts`.
//
// Migración segura para usuarios anteriores a esta fase: una clave
// inexistente (nunca se tocó esta preferencia) hidrata con
// `DEFAULT_BUDGET_DISTRIBUTION_SETTINGS` (50/30/20, objetivo desactivado) —
// nunca un error, nunca datos inventados. Una clave que existe pero con
// contenido dañado o de tipo incorrecto sí falla de forma explícita (mismo
// criterio que `surchargeSettingsStore.ts`).
// ---------------------------------------------------------------------------

export function parsePersistedBudgetDistributionSettings(raw: string | null): BudgetDistributionSettings {
  if (raw === null) return cloneSettings(DEFAULT_BUDGET_DISTRIBUTION_SETTINGS);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El almacenamiento del plan de distribución está dañado: no contiene JSON válido.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as BudgetDistributionSettings).distribution !== 'object' ||
    (parsed as BudgetDistributionSettings).distribution === null
  ) {
    throw new Error('El almacenamiento del plan de distribución está dañado: no contiene una configuración válida.');
  }
  const value = parsed as BudgetDistributionSettings;
  return {
    // Corrección (a pedido de Joaquín — planificador 50/30/20
    // desequilibrado): un registro histórico cuya suma ya no sea 100 (o con
    // decimales/negativos/NaN, p. ej. por una versión anterior con el bug de
    // redondeo) se normaliza al LEERLO, preservando sus proporciones
    // relativas — nunca se reemplaza por 50/30/20 ni se borra el registro
    // original en el almacenamiento. Idempotente: un valor ya válido vuelve
    // exactamente igual.
    distribution: normalizeBudgetDistribution(value.distribution),
    // Migración segura: respaldos/instalaciones de antes de que existiera
    // el objetivo de ahorro opcional no tienen este campo — se completa con
    // el valor por defecto (desactivado), nunca se inventa un objetivo.
    savingsGoal: value.savingsGoal ?? DEFAULT_SAVINGS_GOAL,
  };
}

export function parsePersistedBudgetDistributionSchemaVersion(raw: string | null): number | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El almacenamiento del plan de distribución está dañado: la versión interna no contiene JSON válido.');
  }
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error('El almacenamiento del plan de distribución está dañado: la versión interna no es un número válido.');
  }
  if (parsed !== BUDGET_DISTRIBUTION_SCHEMA_VERSION) {
    throw new Error(
      `Versión interna del plan de distribución desconocida (${parsed}). Esta versión de TeacherFlow sólo admite la versión ${BUDGET_DISTRIBUTION_SCHEMA_VERSION}.`
    );
  }
  return parsed;
}

const realAdapter: BudgetDistributionPersistenceAdapter = {
  readAll: async () => {
    const schemaVersionRaw = await AsyncStorage.getItem(BUDGET_DISTRIBUTION_STORAGE_KEYS.schemaVersion);
    parsePersistedBudgetDistributionSchemaVersion(schemaVersionRaw);
    const settingsRaw = await AsyncStorage.getItem(BUDGET_DISTRIBUTION_STORAGE_KEYS.settings);
    return parsePersistedBudgetDistributionSettings(settingsRaw);
  },
  writeAll: async (settings) => {
    await AsyncStorage.multiSet([
      [BUDGET_DISTRIBUTION_STORAGE_KEYS.schemaVersion, JSON.stringify(BUDGET_DISTRIBUTION_SCHEMA_VERSION)],
      [BUDGET_DISTRIBUTION_STORAGE_KEYS.settings, JSON.stringify(settings)],
    ]);
  },
};

const singleton = createBudgetDistributionStoreController(realAdapter);

export const hydrateBudgetDistributionStore = singleton.hydrate;
export const getBudgetDistributionSnapshot = singleton.getSnapshot;
export const applyBudgetDistributionMutation = singleton.applyMutation;
export const replaceBudgetDistributionStoreInMemory = singleton.replaceInMemory;
export const subscribeBudgetDistribution = singleton.subscribe;
export const resetBudgetDistributionHydrationForTests = singleton.resetForTests;

/**
 * Usada exclusivamente por la restauración de respaldo (`restoreService.ts`)
 * — escribe directo en AsyncStorage sin exigir hidratación previa. Ausente
 * o `null` (respaldo de antes de esta fase, o de un dispositivo que nunca
 * tocó esta preferencia) NO toca nada — mismo criterio exacto que
 * `replaceSurchargeSettingsFromBackup`.
 */
export async function replaceBudgetDistributionFromBackup(
  settings: BudgetDistributionSettings | null | undefined
): Promise<void> {
  if (!settings) return;
  await realAdapter.writeAll(settings);
  singleton.replaceInMemory(settings);
}
