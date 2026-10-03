"use client";

import { useActionState } from "react";
import { guardFormAction } from "./network-guard";

/**
 * Reemplazo directo de `useActionState` para formularios que invocan un
 * Server Action: una falla de red devuelve el estado con el mensaje humano
 * (y repone lo escrito) en vez de romper la pantalla. Ver `network-guard.ts`.
 */
export function useGuardedActionState<S extends { error?: string }>(
  action: (prev: S, formData: FormData) => Promise<S>,
  initialState: S
): [state: S, formAction: (payload: FormData) => void, isPending: boolean] {
  const guarded = (prev: S, formData: FormData) => guardFormAction(action, prev, formData);
  // `Awaited<S>` no se reduce para un `S` genérico — S es siempre un objeto plano, nunca una promesa.
  return useActionState(guarded as unknown as (prev: Awaited<S>, formData: FormData) => Promise<Awaited<S>>, initialState as Awaited<S>) as unknown as [
    S,
    (payload: FormData) => void,
    boolean,
  ];
}
