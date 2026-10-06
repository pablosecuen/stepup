// Saneamiento del parámetro `next` (a dónde volver tras iniciar sesión,
// confirmar correo, etc.). Sólo puede apuntar a una ruta interna permitida
// — nunca a un dominio externo. Esto es lo único que evita un "open
// redirect": nunca confiar en el valor crudo de la URL.

/**
 * Las rutas del área privada: EXACTAMENTE las carpetas de `app/(app)/`. Es la única lista: `proxy.ts` (`isPrivatePath`) la usa para
 * exigir sesión y `sanitizeNextPath` para decidir a qué rutas se puede volver tras iniciar sesión. Una ruta privada que falte acá
 * no la protege el proxy (sólo el layout, que no conoce la URL) y, sin sesión, el login volvía a `/inicio` en vez de a la
 * página pedida (`/resumen-financiero`, `/recordatorios`). Una prueba compara esta lista con las carpetas reales de `app/(app)/`.
 */
export const PRIVATE_ROUTE_PREFIXES = [
  "/inicio",
  "/alumnos",
  "/calendario",
  "/cobros",
  "/configuracion",
  "/recordatorios",
  "/registro",
  "/resumen-financiero",
] as const;

const ALLOWED_NEXT_PREFIXES = PRIVATE_ROUTE_PREFIXES;

export const DEFAULT_AUTH_REDIRECT = "/inicio";

/**
 * Destino de la recuperación de contraseña. NO es un área privada (no está en
 * `ALLOWED_NEXT_PREFIXES`, así que `isPrivatePath` sigue siendo falso), pero sí
 * un `next` válido de `/auth/callback`: antes quedaba fuera de la lista y el
 * callback reemplazaba `/nueva-contrasena` por `/inicio`, dejando a la persona
 * dentro de la app sin pasar nunca por "Nueva contraseña". Sólo la ruta exacta.
 */
export const RECOVERY_PASSWORD_PATH = "/nueva-contrasena";

/** C0 (incluye tabulación, salto de línea y NUL), DEL y C1. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isSingleInternalPath(candidate: string): boolean {
  // Debe empezar con exactamente una barra (no "//", que el navegador
  // interpreta como protocol-relative hacia otro host) y no contener un
  // esquema ("http://", "https:", "javascript:", etc.) ni backslashes,
  // que algunos navegadores normalizan como si fueran barras.
  if (!candidate.startsWith("/")) return false;
  if (candidate.startsWith("//")) return false;
  if (candidate.includes("\\")) return false;
  if (/^\/[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate)) return false;
  if (candidate.includes("://")) return false;
  // Los navegadores quitan tabulaciones y saltos de línea de una URL (una barra, una tabulación y otra barra se leen como "//"):
  // ningún carácter de control entra.
  if (hasControlCharacter(candidate)) return false;
  // Sin segmentos "." ni "..": un `next` no puede escaparse de la ruta permitida con "/alumnos/../login".
  if (candidate.split(/[?#]/)[0].split("/").some((segment) => segment === "." || segment === "..")) return false;
  return true;
}

/**
 * Devuelve `rawNext` sólo si es una ruta interna permitida; si no,
 * `fallback`. Nunca redirige a un origen distinto del propio sitio.
 */
export function sanitizeNextPath(rawNext: string | null | undefined, fallback: string = DEFAULT_AUTH_REDIRECT): string {
  if (!rawNext) return fallback;

  let candidate: string;
  try {
    candidate = decodeURIComponent(rawNext);
  } catch {
    return fallback;
  }

  if (!isSingleInternalPath(candidate)) return fallback;

  const isAllowed = ALLOWED_NEXT_PREFIXES.some(
    (prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`) || candidate.startsWith(`${prefix}?`)
  );

  if (candidate === RECOVERY_PASSWORD_PATH) return candidate;

  return isAllowed ? candidate : fallback;
}

/** true si `pathname` pertenece al área privada (protegida por sesión). */
export function isPrivatePath(pathname: string): boolean {
  return ALLOWED_NEXT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
