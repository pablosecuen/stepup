import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { StateStore, TransferState } from "./orchestrator.ts";

/**
 * Registro de avance del traslado (para reanudar tras una interrupción). Sólo guarda identificadores técnicos, huellas, fechas y cantidades: nunca nombres, teléfonos, importes ni
 * credenciales. Es sólo una ayuda: cada fase vuelve a mirar lo que hay en la cuenta, así que perder este archivo no duplica ni pierde datos.
 */
export function emptyState(): TransferState {
  return { version: 1, backups: [] };
}

export function createFileStateStore(path: string): StateStore {
  return {
    read() {
      if (!existsSync(path)) return emptyState();
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as TransferState;
        return parsed?.version === 1 && Array.isArray(parsed.backups) ? parsed : emptyState();
      } catch {
        return emptyState();
      }
    },
    write(state) {
      const partial = `${path}.parcial`;
      writeFileSync(partial, JSON.stringify(state, null, 2), { mode: 0o600 });
      renameSync(partial, path);
    },
  };
}

export function createMemoryStateStore(initial: TransferState = emptyState()): StateStore & { snapshot(): TransferState } {
  let state = structuredClone(initial);
  return { read: () => structuredClone(state), write: (s) => void (state = structuredClone(s)), snapshot: () => structuredClone(state) };
}
