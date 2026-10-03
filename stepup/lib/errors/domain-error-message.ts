import { NETWORK_ERROR_MESSAGE, isNetworkFailure } from "../actions/network-guard.ts";

// Normalizador SEGURO de errores desconocidos para mostrarlos a la usuaria.
//
// Hallazgo real: `supabase-js` devuelve los errores de PostgREST como un
// objeto plano `{ message, code, details, hint }` (no una instancia de
// `Error`), así que `if (error instanceof Error) return error.message;
// return "Ocurrió un error inesperado"` ocultaba incluso mensajes de
// dominio útiles (p. ej. "El preview de undo ya no es válido…") detrás de un
// genérico. Esta función los distingue SIN filtrar nada interno:
//   - nunca devuelve `details`, `hint`, SQL, nombres de tabla/columna/
//     constraint, URLs, tokens ni trazas;
//   - un mensaje sólo se muestra tal cual si lo levantó NUESTRO código
//     (códigos `P0001`/`22023`/`P0002`/`28000` de `raise exception` en las
//     RPC, o un `Error` de dominio) y pasa el filtro anti-fuga;
//   - los códigos de Postgres conocidos se traducen a un texto genérico;
//   - todo lo demás cae en un mensaje genérico.
// Pura (sin React/Next/Supabase) para probarse con `node --test`.

export const GENERIC_ERROR_MESSAGE = "Ocurrió un error inesperado. Intentá de nuevo.";

const MAX_DOMAIN_MESSAGE_LENGTH = 300;

// Códigos que levantan NUESTRAS funciones con `raise exception ... using errcode`
// (o el `raise exception` por defecto, P0001) — sus mensajes están escritos
// para la usuaria.
const DOMAIN_CODES = new Set(["P0001", "22023", "P0002", "28000"]);

const FRIENDLY_BY_CODE: Record<string, string> = {
  "42501": "No tenés permiso para realizar esta acción.",
  "23505": "Ese registro ya existe.",
  "23503": "No se pudo completar porque hay datos relacionados.",
  "23502": "Faltan datos obligatorios o no son válidos.",
  "23514": "Los datos enviados no son válidos.",
  "22P02": "Hay un dato con un formato inválido.",
  "22007": "Hay una fecha con un formato inválido.",
  "22008": "Hay una fecha fuera de rango.",
  "22003": "Hay un número fuera de rango.",
  "40001": "Hubo un conflicto con otra operación. Intentá de nuevo.",
  "40P01": "Hubo un conflicto con otra operación. Intentá de nuevo.",
};

// Fragmentos típicos de mensajes internos de Postgres/PostgREST/Node.
const LEAK_PATTERN =
  /relation "|column "|constraint "|violates|duplicate key|syntax error|\bpg_|\bpublic\.|sqlstate|\bat \S+ \(|https?:\/\/|eyJ[A-Za-z0-9_-]{10,}|\bnull value in\b/i;

function isSafeDomainMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_DOMAIN_MESSAGE_LENGTH && !LEAK_PATTERN.test(trimmed) && !trimmed.includes("\n");
}

function readStringField(value: unknown, key: string): string | null {
  if (value === null || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

/** Mensaje apto para mostrar a partir de CUALQUIER valor capturado en un `catch`. */
export function domainErrorMessage(error: unknown): string {
  if (isNetworkFailure(error)) return NETWORK_ERROR_MESSAGE;

  const message = error instanceof Error ? error.message : readStringField(error, "message");
  const code = readStringField(error, "code");

  // `supabase-js` envuelve un `fetch` caído del servidor hacia Supabase en un objeto con
  // message "TypeError: Failed to fetch" y código vacío — también es "no se pudo conectar".
  if (message !== null && !code && /failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return NETWORK_ERROR_MESSAGE;
  }

  if (code && FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];

  if (message !== null) {
    // Un `Error` normal sin código es de dominio (lo lanzó nuestro código). Un objeto PostgREST
    // sólo se muestra si su código es uno de los que levantan NUESTRAS RPC.
    const isDomain = error instanceof Error ? !code || DOMAIN_CODES.has(code) : !!code && DOMAIN_CODES.has(code);
    if (isDomain && isSafeDomainMessage(message)) return message.trim();
  }

  return GENERIC_ERROR_MESSAGE;
}
