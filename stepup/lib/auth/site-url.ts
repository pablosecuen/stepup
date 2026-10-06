import "server-only";
import { headers } from "next/headers";
import { resolveSiteOrigin } from "@/lib/auth/site-origin";

/** El origen canónico no está disponible (falta, es inválido o no está permitido): se falla de forma controlada. */
export class SiteOriginUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("El origen del sitio no está configurado.");
    this.name = "SiteOriginUnavailableError";
    this.reason = reason;
  }
}

/**
 * Origen público del sitio, para construir `emailRedirectTo`/`redirectTo` absolutos (ver lib/auth/site-origin.ts).
 *
 * - Production: SIEMPRE `NEXT_PUBLIC_SITE_URL` (HTTPS y host permitido). Si falta o es inválida, lanza
 *   `SiteOriginUnavailableError`; nunca se infiere de los encabezados.
 * - Desarrollo local: si la variable no está, se usa el host de la propia solicitud (localhost), que es el comportamiento de
 *   siempre y no sale de la máquina.
 */
export async function getSiteOrigin(): Promise<string> {
  const resolved = resolveSiteOrigin();
  if (resolved.ok) return resolved.origin;

  if (process.env.NODE_ENV !== "production" && resolved.reason === "missing") {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (!host) return "http://localhost:3000";
    return `${host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https"}://${host}`;
  }
  // Sólo el motivo (missing/invalid/not_allowed), nunca el valor de la variable.
  console.error(`[site-origin] ${JSON.stringify({ reason: resolved.reason })}`);
  throw new SiteOriginUnavailableError(resolved.reason);
}
