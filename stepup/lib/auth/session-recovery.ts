import { safeJwtRejectionDetail, type LoadFailure } from "../errors/load-failure.ts";

/**
 * Recuperación de la sesión recién iniciada cuando PostgREST rechaza el token con EXACTAMENTE
 * `PGRST303 · "JWT issued at future"` (hallado en Production, 4/oct): el token es válido, pero su hora de emisión es
 * posterior al reloj de la instancia de PostgREST que atendió la consulta (inconsistencia externa de reloj, aún sin
 * confirmar con Supabase). No hay una espera "correcta" que lo garantice, así que en lugar de esperar dentro del request:
 *
 *  1. Inicio, ante ese fallo exacto, redirige a `/iniciando-sesion` (una pantalla SIN navegación privada ni precargas).
 *  2. Esa pantalla espera con backoff, comprueba la sesión con consultas de SÓLO LECTURA (nunca vuelve a cargar Inicio,
 *     que puede escribir cargos) y recién cuando todas pasan entra a Inicio.
 *  3. Si se agota el límite, muestra el error normal con acciones claras.
 *
 * Nada de esto toca otros 401 ni otros PGRST303 ("JWT expired", claims inválidos…): ésos siguen siendo errores.
 */

/** Motivo exacto que activa la recuperación. */
export const ISSUED_AT_FUTURE_DETAIL = "JWT issued at future";

/** Esperas (ms) antes de CADA comprobación: progresivas y finitas. Tres comprobaciones como máximo. */
export const SESSION_RECOVERY_DELAYS_MS: readonly number[] = [2000, 3000, 5000];

/** Límite total explícito de espera (suma de las esperas). Tiene que coincidir con la suma; lo vigila una prueba. */
export const SESSION_RECOVERY_TOTAL_LIMIT_MS = 10_000;

/** Ruta de la pantalla transitoria y destino al recuperarse (fijos: nada llega por parámetro). */
export const SESSION_RECOVERY_PATH = "/iniciando-sesion";
export const SESSION_RECOVERED_DESTINATION = "/inicio?recuperada=1";

/** Un fallo de carga es "este caso" sólo con el código y el motivo exactos. */
export function isIssuedAtFutureFailure(failure: Pick<LoadFailure, "code" | "detail"> | null | undefined): boolean {
  return !!failure && failure.code === "PGRST303" && failure.detail === ISSUED_AT_FUTURE_DETAIL;
}

/** Idem para un error crudo de PostgREST. */
export function isIssuedAtFutureError(error: { code?: unknown; message?: unknown } | null | undefined): boolean {
  return !!error && error.code === "PGRST303" && safeJwtRejectionDetail(error.message) === ISSUED_AT_FUTURE_DETAIL;
}

// ----------------------------------------------------------------------------------------------------------------
// Comprobación de sólo lectura
// ----------------------------------------------------------------------------------------------------------------

export type SessionReadiness = { status: "ready" } | { status: "waiting" } | { status: "signed_out" } | { status: "error"; code: string | null };

interface ProbeError {
  code?: string;
  message?: string;
}

/** Lo mínimo del cliente de Supabase que usa la comprobación: un `select` con filtro y `limit`, nada que escriba. */
export interface ReadOnlyProbeClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        limit(count: number): PromiseLike<{ error: ProbeError | null }>;
      };
    };
  };
}

/** Las mismas tablas con las que arranca la carga de Inicio. */
const PROBE_TABLES = ["recurrence_rules", "students", "calendar_lessons"] as const;
/** Cada tabla se consulta varias veces en paralelo: un solo pedido podría caer en una instancia sana y dar un "listo" falso. */
const PROBE_REPEATS = 2;

export async function probeSessionReadiness(client: ReadOnlyProbeClient, ownerId: string): Promise<SessionReadiness> {
  const requests = PROBE_TABLES.flatMap((table) =>
    Array.from({ length: PROBE_REPEATS }, () => Promise.resolve(client.from(table).select("id").eq("owner_id", ownerId).limit(1)).then((result) => result.error, (): ProbeError => ({ code: "network" })))
  );
  const errors = (await Promise.all(requests)).filter((error): error is ProbeError => error !== null);

  if (errors.length === 0) return { status: "ready" };
  // Sólo si TODOS los rechazos son el caso exacto se espera; cualquier otro error (aunque venga mezclado) se informa tal cual.
  if (errors.every((error) => isIssuedAtFutureError(error))) return { status: "waiting" };
  const other = errors.find((error) => !isIssuedAtFutureError(error));
  return { status: "error", code: typeof other?.code === "string" && other.code.length > 0 && other.code.length <= 32 ? other.code : null };
}

// ----------------------------------------------------------------------------------------------------------------
// Bucle de recuperación (lo que corre en el navegador)
// ----------------------------------------------------------------------------------------------------------------

export type RecoveryOutcome =
  | { kind: "ready"; attempts: number }
  | { kind: "exhausted"; attempts: number }
  | { kind: "signed_out" }
  | { kind: "other_error"; code: string | null }
  | { kind: "cancelled" };

export interface RecoveryDeps {
  /** Comprobación de sólo lectura en el servidor. `attempt` empieza en 1. */
  check: (attempt: number) => Promise<SessionReadiness>;
  sleep: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  /** Se llama antes de cada espera (para mostrar el progreso). */
  onWait?: (attempt: number, delayMs: number) => void;
  delays?: readonly number[];
}

/**
 * Espera → comprueba, como máximo `delays.length` veces. Nunca vuelve a empezar sola: ni bucle, ni reintentos extra.
 * Cualquier resultado que no sea "waiting" corta de inmediato.
 */
export async function runSessionRecovery(deps: RecoveryDeps): Promise<RecoveryOutcome> {
  const delays = deps.delays ?? SESSION_RECOVERY_DELAYS_MS;
  for (let index = 0; index < delays.length; index += 1) {
    if (deps.isCancelled?.()) return { kind: "cancelled" };
    deps.onWait?.(index + 1, delays[index]);
    await deps.sleep(delays[index]);
    if (deps.isCancelled?.()) return { kind: "cancelled" };

    let readiness: SessionReadiness;
    try {
      readiness = await deps.check(index + 1);
    } catch {
      return { kind: "other_error", code: "network" };
    }
    if (deps.isCancelled?.()) return { kind: "cancelled" };

    if (readiness.status === "ready") return { kind: "ready", attempts: index + 1 };
    if (readiness.status === "signed_out") return { kind: "signed_out" };
    if (readiness.status === "error") return { kind: "other_error", code: readiness.code };
    // "waiting": sigue el backoff
  }
  return { kind: "exhausted", attempts: delays.length };
}

/** Línea de log segura (sin token, `iat`, UID, correo ni consultas). */
export function formatSessionRecoveryLog(event: { attempt: number; status: SessionReadiness["status"]; code?: string | null }): string {
  return `[session-recovery] ${JSON.stringify({ attempt: event.attempt, status: event.status, code: event.code ?? null })}`;
}
