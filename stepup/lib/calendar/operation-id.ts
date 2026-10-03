// Lógica PURA de la clave de idempotencia (`operation_id`) de la creación de
// clase única / serie — separada de las Server Actions y del formulario para
// poder probarse con `node --test` (mismo patrón que `primary-selection.ts`).
//
// Contrato (Fase 10, 20261001150000):
//   - el CLIENTE genera el UUID una sola vez por borrador (sessionStorage) y lo
//     envía en un campo oculto; la Server Action nunca lo genera ni lo repone;
//   - sobrevive recarga, error de red y respuesta perdida;
//   - recién se rota cuando el servidor confirma que la operación existe.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MISSING_OPERATION_ID_MESSAGE = "No pudimos identificar este envío. Recargá la página e intentá de nuevo.";

/** UUID válido normalizado a minúsculas, o `null` si falta o está mal formado (nunca se inventa uno). */
export function parseOperationId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/**
 * ¿Hay que rotar la clave del borrador? Sólo cuando la respuesta canónica del
 * servidor corresponde a la clave ACTUAL: así un estado viejo (p. ej. el que
 * conserva una falla de red posterior) nunca vuelve a rotar una clave ya nueva.
 */
export function shouldRotateOperationId(createdOperationId: string | undefined, currentOperationId: string | null): boolean {
  return !!createdOperationId && !!currentOperationId && createdOperationId === currentOperationId;
}
