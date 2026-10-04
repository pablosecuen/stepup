import { safeJwtRejectionDetail } from "../errors/load-failure.ts";

/**
 * `fetch` para el cliente de Supabase del servidor: reintenta UNA sola vez una consulta de datos que PostgREST
 * rechazó con `401 PGRST303` ("JWT claims validation failed").
 *
 * Por qué existe (hallado en Production, 4/oct): justo después de iniciar sesión con contraseña, Inicio dispara
 * varias consultas en paralelo con el MISMO token recién emitido. En el registro de Supabase, `/auth/v1/user`,
 * `students` y `calendar_lessons` respondieron 200 y `recurrence_rules` 401, en el mismo segundo y para el mismo
 * usuario. Un token que PostgREST acepta en tres de cuatro consultas simultáneas no está roto: el rechazo es
 * transitorio y puntual de esa consulta, y Inicio entero mostraba "No pudimos cargar Inicio" por una sola.
 *
 * Alcance deliberadamente mínimo:
 * - sólo respuestas 401 de `/rest/v1/` cuyo cuerpo trae un código `PGRST303` (no se toca ningún otro error);
 * - un único reintento, con el mismo token y la misma consulta (PostgREST rechaza el JWT ANTES de ejecutar
 *   nada, así que repetir una escritura no puede duplicarla);
 * - si el reintento también falla, se devuelve esa respuesta 401 tal cual: el error llega a la pantalla igual
 *   que antes, nunca se convierte en una lista vacía;
 * - cada reintento deja una línea de log SIN token, correo ni datos (tabla, código, si se recuperó), para
 *   confirmar con datos reales la causa del rechazo transitorio.
 */
export const JWT_REJECTION_RETRY_DELAY_MS = 350;

/**
 * Motivo que PostgREST informó en Production (4/oct) cuando falló Inicio tras un login: "JWT issued at future", es decir,
 * el `iat` del token es POSTERIOR al reloj de PostgREST. El token es válido; sólo hay que esperar a que "envejezca" más
 * que el desfasaje entre los dos servicios. Con 350 ms no alcanzó (2 de 3 consultas siguieron rechazadas, con el token
 * de ~1,3 s de vida), así que para este motivo la espera se calcula con el `iat` del propio token: se aguarda hasta
 * que tenga `JWT_ISSUED_AT_SETTLE_MS` de vida, sin pasar de `JWT_ISSUED_AT_MAX_WAIT_MS`. Sigue siendo UN solo reintento.
 */
export const JWT_ISSUED_AT_FUTURE_DETAIL = "JWT issued at future";
export const JWT_ISSUED_AT_SETTLE_MS = 3000;
export const JWT_ISSUED_AT_MAX_WAIT_MS = 2500;

export interface JwtRejectionRetryEvent {
  table: string;
  code: string;
  detail: string | null;
  recovered: boolean;
  /** Cuánto se esperó antes del único reintento (sirve para calibrar la espera con datos reales). */
  waitedMs: number;
}

export interface JwtRejectionRetryOptions {
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (event: JwtRejectionRetryEvent) => void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Nombre de la tabla (o `rpc:función`) de una consulta a `/rest/v1/`, SIN query string ni filtros — es lo único de la
 * URL que llega al log. Sólo se aceptan `string`/`URL`: un objeto `Request` lleva su propio cuerpo, que no se puede
 * volver a enviar, así que nunca se reintenta.
 */
function restTableOf(input: RequestInfo | URL): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : null;
  if (raw === null) return null;
  const marker = "/rest/v1/";
  const index = raw.indexOf(marker);
  if (index < 0) return null;
  const [first, second] = raw.slice(index + marker.length).split("?")[0].split("/");
  const name = first === "rpc" && second ? `rpc:${second}` : first;
  return /^(rpc:)?[A-Za-z0-9_]{1,64}$/.test(name) ? name : null;
}

/** Sólo si el cuerpo se puede volver a enviar tal cual (supabase-js manda texto JSON o nada). */
function isReplayable(init: RequestInit | undefined): boolean {
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string";
}

async function readRejection(response: Response): Promise<{ code: string; detail: string | null } | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown; message?: unknown };
    if (body.code !== "PGRST303") return null;
    return { code: body.code, detail: safeJwtRejectionDetail(body.message) ?? null };
  } catch {
    return null;
  }
}

/** `iat` (en ms) del Bearer de la petición, o `null` si no se puede leer. El token jamás se guarda ni se registra. */
function tokenIssuedAtMs(init: RequestInit | undefined): number | null {
  try {
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const payload = authorization.replace(/^Bearer /i, "").split(".")[1];
    if (!payload) return null;
    const iat = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iat?: unknown }).iat;
    return typeof iat === "number" && Number.isFinite(iat) ? iat * 1000 : null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createJwtRejectionRetryFetch(baseFetch: FetchLike = fetch, options: JwtRejectionRetryOptions = {}): FetchLike {
  const delayMs = options.delayMs ?? JWT_REJECTION_RETRY_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 401) return response;

    const table = restTableOf(input);
    if (!table || !isReplayable(init)) return response;

    const rejection = await readRejection(response);
    if (!rejection) return response;

    let waitedMs = delayMs;
    if (rejection.detail === JWT_ISSUED_AT_FUTURE_DETAIL) {
      const issuedAtMs = tokenIssuedAtMs(init);
      // Sin `iat` legible no se puede calcular: se espera el máximo.
      waitedMs = issuedAtMs === null ? JWT_ISSUED_AT_MAX_WAIT_MS : clamp(issuedAtMs + JWT_ISSUED_AT_SETTLE_MS - now(), delayMs, JWT_ISSUED_AT_MAX_WAIT_MS);
    }
    await sleep(waitedMs);
    const retried = await baseFetch(input, init);
    options.onRetry?.({ table, code: rejection.code, detail: rejection.detail, recovered: retried.status !== 401, waitedMs: Math.round(waitedMs) });
    return retried;
  };
}

/** Línea de log segura del reintento (sin token, correo ni datos). */
export function formatJwtRejectionRetryLog(event: JwtRejectionRetryEvent): string {
  return `[jwt-retry] ${JSON.stringify({ table: event.table, code: event.code, detail: event.detail, recovered: event.recovered, waitedMs: event.waitedMs })}`;
}
