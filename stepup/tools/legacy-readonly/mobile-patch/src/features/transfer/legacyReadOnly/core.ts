// Modo consulta de la app anterior (PREPARADO, NO aplicado a la app): núcleo puro, sin dependencias, probado en Node.
//
// Objetivo: tras el cierre del traslado (R11 «frozen») la app anterior sigue mostrando sus datos pero NO puede cargar ni cambiar nada, para que lo que quedó en
// el teléfono no se desvíe de lo que se copió a la web. Nunca borra datos, nunca cierra la sesión, nunca toca la autenticación ni el dispositivo activo.
//
// Reglas de diseño:
//  - Lo decide el SERVIDOR (`get_transfer_state()`), por cuenta; reabrir el traslado lo desactiva.
//  - Pegajoso: si alguna vez se supo que está congelado, un error de red o una respuesta rara NO lo reabre (sólo un «open» explícito del servidor).
//  - Sin información previa y sin respuesta (nunca se supo): NO bloquea (si no, una caída de red dejaría sin uso la app antes del cierre).
//  - La guarda sólo frena escrituras de datos de la app (`@teacherflow/`); las claves de la sesión (`sb-`) y la propia bandera quedan permitidas para no alterar la
//    autenticación.

export type TransferStatus = "open" | "frozen" | "unknown";

export const READ_ONLY_FLAG_KEY = "@teacherflow-legacy/read-only-v1";
export const DATA_KEY_PREFIX = "@teacherflow/";

/** Interpreta la respuesta de `get_transfer_state()`; cualquier cosa rara es «unknown». */
export function parseTransferState(raw: unknown): TransferStatus {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const status = (raw as Record<string, unknown>).status;
    if (status === "frozen") return "frozen";
    if (status === "open") return "open";
  }
  return "unknown";
}

/** Siguiente valor de la bandera pegajosa: sólo el servidor puede cambiarla. */
export function nextReadOnlyFlag(previous: boolean, observed: TransferStatus): boolean {
  if (observed === "frozen") return true;
  if (observed === "open") return false;
  return previous;
}

/** ¿Esta clave es un dato de la app anterior (lo que NO puede cambiar en modo consulta)? */
export function isProtectedDataKey(key: string): boolean {
  return key.startsWith(DATA_KEY_PREFIX);
}

type Entry = readonly [string, string | null];
export type GuardableStorage = {
  setItem(key: string, value: string, ...rest: unknown[]): Promise<void>;
  removeItem(key: string, ...rest: unknown[]): Promise<void>;
  mergeItem(key: string, value: string, ...rest: unknown[]): Promise<void>;
  clear(...rest: unknown[]): Promise<void>;
  multiSet(entries: readonly (readonly [string, string])[], ...rest: unknown[]): Promise<void>;
  multiRemove(keys: readonly string[], ...rest: unknown[]): Promise<void>;
  multiMerge(entries: readonly (readonly [string, string])[], ...rest: unknown[]): Promise<void>;
};

export type WriteGuard = {
  /** Cantidad de escrituras de datos evitadas (sólo número: nunca claves ni valores). */
  blockedCount: () => number;
  /** Quita la guarda (pruebas). */
  uninstall: () => void;
};

/**
 * Envuelve las escrituras de AsyncStorage (punto único: los 19 archivos que escriben usan el mismo módulo). En modo consulta las escrituras de datos NO se hacen y
 * se cuentan; las claves permitidas pasan igual. Instalar UNA vez, al arrancar, antes de cualquier lectura o escritura.
 */
export function installWriteGuard(storage: GuardableStorage, isReadOnly: () => boolean, onBlocked?: () => void): WriteGuard {
  let blocked = 0;
  const original = {
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    mergeItem: storage.mergeItem.bind(storage),
    clear: storage.clear.bind(storage),
    multiSet: storage.multiSet.bind(storage),
    multiRemove: storage.multiRemove.bind(storage),
    multiMerge: storage.multiMerge.bind(storage),
  };
  const deny = (): Promise<void> => {
    blocked += 1;
    onBlocked?.();
    return Promise.resolve();
  };
  const blocks = (key: string) => isReadOnly() && isProtectedDataKey(key);

  storage.setItem = (key, value, ...rest) => (blocks(key) ? deny() : original.setItem(key, value, ...rest));
  storage.removeItem = (key, ...rest) => (blocks(key) ? deny() : original.removeItem(key, ...rest));
  storage.mergeItem = (key, value, ...rest) => (blocks(key) ? deny() : original.mergeItem(key, value, ...rest));
  // `clear` borraría datos: en modo consulta nunca se ejecuta (el cierre de sesión de la app anterior no debe vaciar lo conservado).
  storage.clear = (...rest) => (isReadOnly() ? deny() : original.clear(...rest));
  const splitEntries = <T extends Entry | readonly [string, string]>(entries: readonly T[]) => ({
    allowed: entries.filter((e) => !blocks(e[0])),
    denied: entries.length - entries.filter((e) => !blocks(e[0])).length,
  });
  storage.multiSet = async (entries, ...rest) => {
    const { allowed, denied } = splitEntries(entries);
    if (denied > 0) await deny();
    if (allowed.length > 0) await original.multiSet(allowed, ...rest);
  };
  storage.multiMerge = async (entries, ...rest) => {
    const { allowed, denied } = splitEntries(entries);
    if (denied > 0) await deny();
    if (allowed.length > 0) await original.multiMerge(allowed, ...rest);
  };
  storage.multiRemove = async (keys, ...rest) => {
    const allowed = keys.filter((k) => !blocks(k));
    if (allowed.length !== keys.length) await deny();
    if (allowed.length > 0) await original.multiRemove(allowed, ...rest);
  };

  return {
    blockedCount: () => blocked,
    uninstall: () => Object.assign(storage, original),
  };
}

/** Texto del aviso visible permanente (siempre texto, nunca sólo color). */
export const READ_ONLY_BANNER_TEXT =
  "Esta aplicación quedó en modo consulta: tus datos siguen acá, pero ya no se cargan ni se cambian. Seguí trabajando desde la web de TeacherFlow.";
