/**
 * Diagnóstico de una pantalla que no pudo cargar. Antes `Inicio` hacía
 * `catch {}` y mostraba siempre "No pudimos cargar Inicio.": cualquier causa
 * (sesión vencida, permiso de base, timeout, error de datos, red) se veía igual
 * y no quedaba rastro en los logs. Esto clasifica el error SIN exponer nada
 * sensible: sólo el tipo, el código de Postgres/PostgREST y el nombre de la
 * clase del error — nunca el mensaje (puede traer nombres de columna o datos),
 * ni `details`/`hint`, ni la fila fallida.
 */
export type LoadFailureKind = "unauthenticated" | "not_configured" | "network" | "database" | "unknown";

export interface LoadFailure {
  kind: LoadFailureKind;
  /** Código SQLSTATE/PostgREST (p. ej. 42501, 57014, PGRST301), si lo hay. */
  code?: string;
  /** Nombre de la clase del error (p. ej. TypeError), si lo hay. */
  name?: string;
  /**
   * Sólo para el rechazo del JWT por PostgREST (PGRST300–303): el texto genérico del motivo ("JWT expired", etc.).
   * `PGRST303` por sí solo no distingue "venció" de "emitido en el futuro" u otro reclamo, y esa diferencia es la
   * que decide la causa. Nunca se copia el mensaje de ningún otro error.
   */
  detail?: string;
}

// Mensajes de PostgREST sobre el JWT: texto corto y genérico, sin datos. Cualquier otra cosa se descarta.
const JWT_REJECTION_CODE = /^PGRST30[0-3]$/;
const JWT_REJECTION_DETAIL = /^JWT( [A-Za-z]{1,16}){0,8}$/;

/** El motivo genérico de un rechazo de JWT ("JWT expired"), o `undefined` si el texto no es exactamente eso. */
export function safeJwtRejectionDetail(message: unknown): string | undefined {
  return typeof message === "string" && JWT_REJECTION_DETAIL.test(message) ? message : undefined;
}

const NETWORK_NAMES = new Set(["AuthRetryableFetchError"]);

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 && field.length <= 64 ? field : undefined;
}

export function describeLoadFailure(error: unknown): LoadFailure {
  const name = readString(error, "name");
  const code = readString(error, "code");

  if (name === "DbUnauthenticatedError") return { kind: "unauthenticated", name };
  if (name === "DbNotConfiguredError") return { kind: "not_configured", name };
  if ((name && NETWORK_NAMES.has(name)) || (error instanceof TypeError && /fetch failed|failed to fetch/i.test(error.message))) {
    return { kind: "network", name };
  }
  // Un error de PostgREST es un objeto plano con `code`; se identifica por el código, no por el texto.
  if (code && /^([0-9A-Z]{5}|PGRST\d+)$/.test(code)) {
    const message = typeof error === "object" && error !== null ? (error as Record<string, unknown>).message : undefined;
    const detail = JWT_REJECTION_CODE.test(code) ? safeJwtRejectionDetail(message) : undefined;
    return detail ? { kind: "database", code, name, detail } : { kind: "database", code, name };
  }
  return { kind: "unknown", name, code };
}

/** Línea de log segura (sin mensajes ni datos) para `console.error`. */
export function formatLoadFailureLog(scope: string, failure: LoadFailure): string {
  const fields: Record<string, string | null> = { scope, kind: failure.kind, code: failure.code ?? null, name: failure.name ?? null };
  if (failure.detail) fields.detail = failure.detail;
  return `[load-failure] ${JSON.stringify(fields)}`;
}

export function logLoadFailure(scope: string, error: unknown): LoadFailure {
  const failure = describeLoadFailure(error);
  console.error(formatLoadFailureLog(scope, failure));
  return failure;
}
