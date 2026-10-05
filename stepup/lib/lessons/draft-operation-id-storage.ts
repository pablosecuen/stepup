import { parseOperationId } from "../calendar/operation-id.ts";

/**
 * Lógica PURA de la clave de operación de un borrador (la usa `useDraftOperationId`), separada del hook de React para
 * poder probarla con `node --test` y un `Storage` de mentira. Contrato:
 *   - RECARGA de la misma pestaña: `sessionStorage` conserva la clave → el mismo id.
 *   - PESTAÑA DUPLICADA: el navegador copia `sessionStorage` al duplicar → el mismo id (misma operación canónica).
 *   - PESTAÑA INDEPENDIENTE (navegación nueva): `sessionStorage` vacío → id nuevo.
 *   - `sessionStorage` inaccesible (navegación privada, storage bloqueado): id sólo en memoria; el formulario no se bloquea.
 *   - Un valor guardado que NO es un UUID (corrupto, manipulado) se descarta y se reemplaza: reenviarlo haría que el servidor
 *     rechace el envío para siempre sin que recargar lo arregle.
 */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Recupera la clave guardada o genera y guarda una nueva. Nunca lanza. */
export function resolveDraftOperationId(getStorage: () => DraftStorage, key: string, generate: () => string): string {
  let fresh: string | null = null;
  try {
    const storage = getStorage();
    const existing = parseOperationId(storage.getItem(key));
    if (existing) return existing;
    fresh = generate();
    storage.setItem(key, fresh);
    return fresh;
  } catch {
    return fresh ?? generate();
  }
}

/** Quita la clave (después de una respuesta EXITOSA confirmada por el servidor). Nunca lanza. */
export function clearDraftOperationId(getStorage: () => DraftStorage, key: string): void {
  try {
    getStorage().removeItem(key);
  } catch {
    // sin storage no hay nada real que limpiar
  }
}

/** Reemplaza la clave por una nueva y la devuelve (aunque no se pueda guardar, la nueva vive en memoria). Nunca lanza. */
export function rotateDraftOperationId(getStorage: () => DraftStorage, key: string, generate: () => string): string {
  const fresh = generate();
  try {
    getStorage().setItem(key, fresh);
  } catch {
    // sessionStorage inaccesible — la clave nueva igual vive en memoria
  }
  return fresh;
}
