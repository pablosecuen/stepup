// Puerto VERBATIM del original (`src/features/payments/hooks/surchargeSettingsStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import { DEFAULT_SURCHARGE_SETTINGS, sanitizeSurchargeSettings, type SurchargeSettings } from '../utils/surchargeSettings.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): fuente única
 * de verdad de `SurchargeSettings`, persistida y sincronizada — mismo patrón
 * exacto que `paymentsStore.ts` (hidratar, mutar atómicamente con cola y
 * rollback, `subscribe`, `replaceInMemory` para restauración de respaldos),
 * adaptado para UN único objeto de configuración en vez de cuatro
 * colecciones. Nunca hay copias divergentes de esta configuración en
 * componentes: todo consumidor debe leer `getSurchargeSettingsSnapshot()` o
 * suscribirse.
 */
export const SURCHARGE_SETTINGS_SCHEMA_VERSION = 1;

export const SURCHARGE_SETTINGS_STORAGE_KEYS = {
  schemaVersion: '@teacherflow/surcharge_settings_schema_version',
  settings: '@teacherflow/surcharge_settings',
} as const;

function cloneSettings(settings: SurchargeSettings): SurchargeSettings {
  return {
    current: { ...settings.current },
    pending: settings.pending ? { ...settings.pending } : null,
    pendingEffectiveFrom: settings.pendingEffectiveFrom,
  };
}

/**
 * Cómo se lee/escribe la configuración completa. Separado de la
 * orquestación para poder probar hidratación, mutación atómica y rollback
 * con un adaptador falso, sin depender de AsyncStorage real.
 */
export interface SurchargeSettingsPersistenceAdapter {
  readAll: () => Promise<SurchargeSettings>;
  writeAll: (settings: SurchargeSettings) => Promise<void>;
}

export interface SurchargeSettingsStoreController {
  hydrate: () => Promise<SurchargeSettings>;
  getSnapshot: () => SurchargeSettings;
  /**
   * Reemplaza y persiste la configuración completa en una única operación
   * atómica, a partir del snapshot ACTUAL (nunca uno capturado de antemano).
   * Exige hidratación previa. Si la escritura falla, revierte la memoria al
   * estado anterior y relanza el error — nunca deja memoria y
   * almacenamiento desincronizados.
   */
  applyMutation: (updater: (current: SurchargeSettings) => SurchargeSettings) => Promise<SurchargeSettings>;
  /** Sincroniza sólo memoria, sin persistir (restauración de respaldos). */
  replaceInMemory: (nextSettings: SurchargeSettings) => void;
  subscribe: (listener: () => void) => () => void;
  resetForTests: () => void;
}

export function createSurchargeSettingsStoreController(
  adapter: SurchargeSettingsPersistenceAdapter
): SurchargeSettingsStoreController {
  let current: SurchargeSettings = cloneSettings(DEFAULT_SURCHARGE_SETTINGS);
  let hydrationPromise: Promise<SurchargeSettings> | null = null;
  let hasHydrated = false;
  const listeners = new Set<() => void>();

  // Misma cola que `paymentsStore.ts`: sin esto, dos `applyMutation` sin
  // `await` entre sí podrían pisarse — la segunda persistiéndose con éxito
  // antes de que la primera falle y revierta la memoria al estado previo a
  // sí misma, perdiendo el cambio de la segunda en memoria.
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function getSnapshot(): SurchargeSettings {
    return cloneSettings(current);
  }

  function hydrate(): Promise<SurchargeSettings> {
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
    updater: (current: SurchargeSettings) => SurchargeSettings
  ): Promise<SurchargeSettings> {
    const previous = current;
    const nextSettings = updater(getSnapshot());
    current = cloneSettings(nextSettings);
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

  function applyMutation(updater: (current: SurchargeSettings) => SurchargeSettings): Promise<SurchargeSettings> {
    if (!hasHydrated) {
      return Promise.reject(new Error('No se puede modificar la configuración de recargos antes de hidratarla.'));
    }
    const result = mutationQueue.catch(() => {}).then(() => runQueuedMutation(updater));
    mutationQueue = result.catch(() => {});
    return result;
  }

  function replaceInMemory(nextSettings: SurchargeSettings): void {
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
    current = cloneSettings(DEFAULT_SURCHARGE_SETTINGS);
    mutationQueue = Promise.resolve();
  }

  return { hydrate, getSnapshot, applyMutation, replaceInMemory, subscribe, resetForTests };
}

// ---------------------------------------------------------------------------
// Adaptador real (AsyncStorage) y store de módulo singleton — mismo patrón
// que `paymentsStore.ts`/`studentStore.ts`.
//
// A propósito NUNCA se convierte JSON corrupto en la configuración por
// defecto: una instalación realmente nueva (clave inexistente) hidrata con
// `DEFAULT_SURCHARGE_SETTINGS` (= comportamiento actual, migración inicial),
// pero una clave que existe con contenido dañado o de tipo incorrecto debe
// fallar de forma explícita.
// ---------------------------------------------------------------------------

/**
 * Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
 * confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
 * monetarias automáticas"): sanitiza SIEMPRE antes de devolver — una
 * configuración histórica persistida ANTES de esta decisión (con
 * `enabled: true` real, guardada por la profesora en su momento) se
 * normaliza acá mismo, en la hidratación, a `enabled: false` — nunca se
 * reescribe el JSON crudo en disco (no hace falta: cada lectura futura
 * vuelve a sanitizar), pero la app nunca vuelve a ver ni a operar con un
 * `enabled: true` real.
 */
export function parsePersistedSurchargeSettings(raw: string | null): SurchargeSettings {
  if (raw === null) return cloneSettings(DEFAULT_SURCHARGE_SETTINGS);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El almacenamiento de recargos está dañado: no contiene JSON válido.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as SurchargeSettings).current !== 'object' ||
    (parsed as SurchargeSettings).current === null
  ) {
    throw new Error('El almacenamiento de recargos está dañado: no contiene una configuración válida.');
  }
  return sanitizeSurchargeSettings(parsed as SurchargeSettings);
}

export function parsePersistedSurchargeSettingsSchemaVersion(raw: string | null): number | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('El almacenamiento de recargos está dañado: la versión interna no contiene JSON válido.');
  }
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error('El almacenamiento de recargos está dañado: la versión interna no es un número válido.');
  }
  if (parsed !== SURCHARGE_SETTINGS_SCHEMA_VERSION) {
    throw new Error(
      `Versión interna de recargos desconocida (${parsed}). Esta versión de TeacherFlow sólo admite la versión ${SURCHARGE_SETTINGS_SCHEMA_VERSION}.`
    );
  }
  return parsed;
}

const realAdapter: SurchargeSettingsPersistenceAdapter = {
  readAll: async () => {
    const schemaVersionRaw = await AsyncStorage.getItem(SURCHARGE_SETTINGS_STORAGE_KEYS.schemaVersion);
    parsePersistedSurchargeSettingsSchemaVersion(schemaVersionRaw);
    const settingsRaw = await AsyncStorage.getItem(SURCHARGE_SETTINGS_STORAGE_KEYS.settings);
    return parsePersistedSurchargeSettings(settingsRaw);
  },
  writeAll: async (settings) => {
    await AsyncStorage.multiSet([
      [SURCHARGE_SETTINGS_STORAGE_KEYS.schemaVersion, JSON.stringify(SURCHARGE_SETTINGS_SCHEMA_VERSION)],
      [SURCHARGE_SETTINGS_STORAGE_KEYS.settings, JSON.stringify(settings)],
    ]);
  },
};

const singleton = createSurchargeSettingsStoreController(realAdapter);

export const hydrateSurchargeSettingsStore = singleton.hydrate;
export const getSurchargeSettingsSnapshot = singleton.getSnapshot;
export const applySurchargeSettingsMutation = singleton.applyMutation;
export const replaceSurchargeSettingsStoreInMemory = singleton.replaceInMemory;
export const subscribeSurchargeSettings = singleton.subscribe;
export const resetSurchargeSettingsHydrationForTests = singleton.resetForTests;

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): usada
 * exclusivamente por la restauración de respaldo (`restoreService.ts`) —
 * a diferencia de `applyMutation`, escribe directo en AsyncStorage sin
 * exigir hidratación previa (una restauración en un dispositivo nuevo corre
 * antes de que este store llegue a hidratarse solo). `settings` ausente o
 * `null` (un respaldo v2 anterior a esta fase, o armado en un dispositivo
 * que nunca tocó esta configuración) NO toca nada — ni memoria ni disco —
 * para no pisar en silencio una configuración real ya guardada en ESTE
 * dispositivo, mismo criterio exacto que `replaceTeacherProfileFromBackup`.
 *
 * Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
 * confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
 * monetarias automáticas"): `settings` se sanitiza ANTES de persistir/
 * reemplazar en memoria — un backup ANTERIOR a esta decisión (con
 * `enabled: true` real, de un respaldo viejo) nunca reactiva recargos al
 * restaurarse en un dispositivo nuevo o al recuperar una cuenta existente.
 */
export async function replaceSurchargeSettingsFromBackup(
  settings: SurchargeSettings | null | undefined
): Promise<void> {
  if (!settings) return;
  const sanitized = sanitizeSurchargeSettings(settings);
  await realAdapter.writeAll(sanitized);
  singleton.replaceInMemory(sanitized);
}
