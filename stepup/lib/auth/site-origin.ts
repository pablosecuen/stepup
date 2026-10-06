/**
 * Origen canónico del sitio para los enlaces que viajan por correo (confirmación de alta, recuperación de contraseña):
 * `emailRedirectTo` / `redirectTo`. Función PURA (sin Next) para probarla.
 *
 * Regla (R1): en Production el origen sale SIEMPRE de `NEXT_PUBLIC_SITE_URL`, que debe ser HTTPS y de un host permitido.
 * Nunca se infiere de los encabezados de la solicitud (`Host`/`X-Forwarded-Host`): un enlace de correo que apunte a un
 * origen elegido por quien hace la solicitud sería un envenenamiento del enlace de recuperación. Si falta o es inválida,
 * se falla de forma controlada; no hay ningún origen de reserva en Production.
 *
 * Los redireccionamientos internos de la propia solicitud (`/auth/callback`, login) NO usan este origen: siguen siendo
 * relativos al dominio por el que entró la persona (teacherflowapp.com o el alias de Vercel), así su cookie de sesión
 * (propia de ese host) sigue valiendo.
 */
export const ALLOWED_PRODUCTION_SITE_HOSTS: readonly string[] = ["teacherflowapp.com"];

export type SiteOriginResult =
  | { ok: true; origin: string }
  | { ok: false; reason: "missing" | "invalid" | "not_allowed" };

type Env = Record<string, string | undefined>;

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

export function resolveSiteOrigin(env: Env = process.env): SiteOriginResult {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  const production = env.NODE_ENV === "production";
  if (!raw) return { ok: false, reason: "missing" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  // Sólo un origen: sin credenciales, sin ruta, sin consulta ni fragmento.
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return { ok: false, reason: "invalid" };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid" };

  if (production) {
    if (url.protocol === "https:" && ALLOWED_PRODUCTION_SITE_HOSTS.includes(url.hostname)) return { ok: true, origin: url.origin };
    // `next start` en una máquina local (nunca en Vercel): se admite un origen de bucle local para poder probar el build.
    if (!env.VERCEL && isLoopback(url.hostname)) return { ok: true, origin: url.origin };
    return { ok: false, reason: url.protocol === "https:" ? "not_allowed" : "invalid" };
  }
  return { ok: true, origin: url.origin };
}
