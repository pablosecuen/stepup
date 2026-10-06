import { GENERIC_ERROR_MESSAGE, domainErrorMessage } from "./domain-error-message.ts";
import { NETWORK_ERROR_MESSAGE } from "../actions/network-guard.ts";
import { describeLoadFailure } from "./load-failure.ts";

/**
 * ÚNICA vía por la que una Server Action convierte un error capturado en el texto que ve la persona (R1).
 *
 * - El mensaje sale SIEMPRE de `domainErrorMessage`: útil cuando lo escribió nuestro código (validaciones propias, `raise
 *   exception` de nuestras RPC) y genérico para todo lo demás. Nunca nombres de tablas, columnas, constraints, SQL, ids, JWT,
 *   URLs ni detalles internos.
 * - Los fallos inesperados (los que terminan en el texto genérico o de red) dejan UNA línea de log con sólo la categoría, el
 *   código seguro de Postgres/PostgREST y el nombre de la clase del error (`describeLoadFailure`): nunca el mensaje ni los
 *   datos. Las validaciones esperadas no se registran.
 *
 * Una guarda estructural (`lib/actions/__tests__/action-errors.test.ts`) impide devolver `error.message` directo desde una
 * Server Action: todo pasa por acá.
 */
export function actionErrorMessage(scope: string, error: unknown): string {
  const message = domainErrorMessage(error);
  if (message === GENERIC_ERROR_MESSAGE || message === NETWORK_ERROR_MESSAGE) {
    const failure = describeLoadFailure(error);
    console.error(`[action-error] ${JSON.stringify({ scope, kind: failure.kind, code: failure.code ?? null, name: failure.name ?? null })}`);
  }
  return message;
}
