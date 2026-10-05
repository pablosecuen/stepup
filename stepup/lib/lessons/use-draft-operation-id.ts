"use client";

import { useEffect, useState } from "react";
import { clearDraftOperationId, resolveDraftOperationId, rotateDraftOperationId } from "./draft-operation-id-storage.ts";

const browserStorage = () => window.sessionStorage;
const newId = () => crypto.randomUUID();

/**
 * Idempotencia real de una operación en curso, persistida en
 * `sessionStorage` bajo `storageKey` — sobrevive una RECARGA de la misma
 * pestaña (o una pestaña duplicada, que en la mayoría de los navegadores
 * hereda una copia de `sessionStorage` al momento de duplicarse), nunca se
 * regenera mientras exista un intento todavía sin confirmar (error de
 * validación, respuesta perdida, reintento). `sessionStorage` es real por
 * origen y por pestaña — una pestaña genuinamente nueva (navegación fresca,
 * no una recarga ni una duplicación) arranca sin la clave y genera un id
 * nuevo, que es exactamente el comportamiento correcto para una acción
 * nueva y legítima. La lógica vive en `draft-operation-id-storage.ts`
 * (pura y probada); acá sólo se conecta con React.
 *
 * Devuelve `null` mientras todavía no se recuperó ni generó ningún id — el
 * llamador DEBE bloquear el envío en ese estado (el `useEffect` corre
 * después del primer render, así que hay un instante real, aunque breve,
 * en el que todavía no hay id). `clear()` sólo debe llamarse después de
 * una respuesta EXITOSA confirmada por el servidor — nunca antes, nunca
 * ante un error (ahí es exactamente donde hay que CONSERVAR el mismo id
 * para el reintento).
 */
export function useDraftOperationId(storageKey: string): { operationId: string | null; clear: () => void; rotate: () => void } {
  const [operationId, setOperationId] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setOperationId(resolveDraftOperationId(browserStorage, storageKey, newId));
  }, [storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function clear() {
    clearDraftOperationId(browserStorage, storageKey);
  }

  /**
   * Reemplaza la clave por una nueva (sessionStorage + estado) — para formularios que se
   * quedan en pantalla después de una operación confirmada y deben poder crear otra. Mismo
   * criterio que `clear()`: sólo después de una respuesta EXITOSA confirmada por el servidor.
   */
  function rotate() {
    setOperationId(rotateDraftOperationId(browserStorage, storageKey, newId));
  }

  return { operationId, clear, rotate };
}
