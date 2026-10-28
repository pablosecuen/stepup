// Puerto VERBATIM del original (`src/shared/backup/localRevisionStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../shims/async-storage.ts';

/**
 * Corrección 2026-07-23 (a pedido de Joaquín — protección integral de datos
 * y recuperación sin pérdidas silenciosas, Etapa 1): marcador persistente de
 * "cambios locales todavía no protegidos", independiente del chequeo
 * periódico de 3 minutos (que sigue existiendo como red de seguridad, ver
 * `useCloudBackupSync.ts`). Nunca depende de un bus de eventos unificado
 * entre alumnos/calendario/pagos (no existe uno en este proyecto, ver
 * auditoría previa) — en cambio, cualquier mutación real llama a
 * `markLocalDataChanged()` explícitamente, que:
 *   1. Incrementa `localRevision` (nunca se resetea, sólo crece).
 *   2. Marca `dirtySince` si todavía no había un cambio pendiente.
 *   3. Persiste el marcador de inmediato.
 *   4. Notifica a los suscriptores (`onLocalDataChanged`) para que
 *      `useCloudBackupSync` dispare un intento de protección casi
 *      inmediato (con debounce corto), sin esperar el temporizador.
 *
 * Persistido (no sólo en memoria) para sobrevivir un cierre de la app: si el
 * proceso se mata antes de subir, `localRevision > lastProtectedRevision`
 * sigue siendo verdad en la próxima apertura, y el chequeo inicial de
 * `useCloudBackupSync` lo detecta y reintenta de inmediato — nunca da por
 * protegidos datos que no llegaron a subirse.
 */
const PROTECTION_STATE_STORAGE_KEY = '@teacherflow/protection_state';

export interface ProtectionState {
  /** Crece con cada mutación real protegible. Nunca decrece. */
  localRevision: number;
  /** Última revisión que el servidor confirmó haber recibido y guardado. */
  lastProtectedRevision: number;
  /** ISO de cuándo empezó la racha de cambios sin proteger todavía, o `null` si no hay ninguno pendiente. */
  dirtySince: string | null;
  /** Cantidad de archivos (fotos/PDF) todavía sin confirmar en la nube — 0 hasta que exista la cola de archivos (Etapa 3). */
  pendingFileUploads: number;
  /** ISO de la última vez que una subida fue confirmada por el servidor. */
  lastSuccessfulProtectionAt: string | null;
}

export const INITIAL_PROTECTION_STATE: ProtectionState = {
  localRevision: 0,
  lastProtectedRevision: 0,
  dirtySince: null,
  pendingFileUploads: 0,
  lastSuccessfulProtectionAt: null,
};

/** true si hay al menos una mutación real todavía no confirmada por el servidor. */
export function hasUnprotectedChanges(state: ProtectionState): boolean {
  return state.localRevision > state.lastProtectedRevision;
}

/** Función pura: siguiente estado tras una mutación real. Nunca decrece `localRevision`, nunca pisa un `dirtySince` ya existente. */
export function applyLocalDataChanged(state: ProtectionState, nowIso: string): ProtectionState {
  return {
    ...state,
    localRevision: state.localRevision + 1,
    dirtySince: state.dirtySince ?? nowIso,
  };
}

/**
 * Función pura: siguiente estado tras una confirmación real del servidor
 * para la revisión `protectedRevision` (la que estaba vigente cuando
 * arrancó la subida). Si durante la subida ya hubo una mutación nueva
 * (`state.localRevision` avanzó más allá de `protectedRevision`), el
 * marcador de "pendiente" NUNCA se limpia — esos cambios nuevos todavía no
 * están protegidos, aunque la subida que acaba de terminar haya sido
 * exitosa para la revisión anterior.
 */
export function applyProtectionSucceeded(
  state: ProtectionState,
  protectedRevision: number,
  nowIso: string
): ProtectionState {
  const lastProtectedRevision = Math.max(state.lastProtectedRevision, protectedRevision);
  return {
    ...state,
    lastProtectedRevision,
    lastSuccessfulProtectionAt: nowIso,
    dirtySince: lastProtectedRevision >= state.localRevision ? null : state.dirtySince,
  };
}

let protectionState: ProtectionState = INITIAL_PROTECTION_STATE;
let hydrationPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function readProtectionState(): Promise<ProtectionState | null> {
  try {
    const raw = await AsyncStorage.getItem(PROTECTION_STATE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProtectionState;
  } catch (error) {
    console.error('Error leyendo el marcador de protección de datos', error);
    return null;
  }
}

async function writeProtectionState(state: ProtectionState): Promise<void> {
  try {
    await AsyncStorage.setItem(PROTECTION_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Error guardando el marcador de protección de datos', error);
  }
}

export function hydrateProtectionState(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = readProtectionState().then((stored) => {
      if (stored) protectionState = stored;
    });
  }
  return hydrationPromise;
}

export function getProtectionState(): ProtectionState {
  return protectionState;
}

/** Suscribe un listener a "hubo una mutación real protegible". Devuelve la función para desuscribirse. */
export function onLocalDataChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Debe llamarse después de cada mutación local real y confirmada de una
 * colección que participa del respaldo (alumnos, perfiles, clases,
 * calendario, disponibilidad, pagos, paquetes, reportes, perfil de la
 * profesora) — nunca por preferencias puramente locales del dispositivo
 * (navegación, seguimiento en vivo, avisos ya vistos), que deliberadamente
 * no forman parte del respaldo.
 */
export async function markLocalDataChanged(): Promise<void> {
  protectionState = applyLocalDataChanged(protectionState, new Date().toISOString());
  await writeProtectionState(protectionState);
  listeners.forEach((listener) => listener());
}

/** Debe llamarse sólo cuando el servidor confirmó de verdad haber recibido y guardado la revisión subida. */
export async function markProtectionSucceeded(protectedRevision: number): Promise<void> {
  protectionState = applyProtectionSucceeded(protectionState, protectedRevision, new Date().toISOString());
  await writeProtectionState(protectionState);
}
