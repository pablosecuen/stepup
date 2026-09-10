// Saneamiento del parámetro `next` (a dónde volver tras iniciar sesión,
// confirmar correo, etc.). Sólo puede apuntar a una ruta interna permitida
// — nunca a un dominio externo. Esto es lo único que evita un "open
// redirect": nunca confiar en el valor crudo de la URL.

const ALLOWED_NEXT_PREFIXES = ["/inicio", "/alumnos", "/calendario", "/cobros", "/configuracion"] as const;

export const DEFAULT_AUTH_REDIRECT = "/inicio";

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

  return isAllowed ? candidate : fallback;
}

/** true si `pathname` pertenece al área privada (protegida por sesión). */
export function isPrivatePath(pathname: string): boolean {
  return ALLOWED_NEXT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
