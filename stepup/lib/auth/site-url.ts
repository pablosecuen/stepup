import "server-only";
import { headers } from "next/headers";

/**
 * Origen público del sitio, para construir `emailRedirectTo`/`redirectTo`
 * absolutos. `NEXT_PUBLIC_SITE_URL` es opcional — sin ella, se deriva de
 * los headers de la propia request (funciona en cualquier entorno sin
 * necesidad de una variable nueva obligatoria).
 */
export async function getSiteOrigin(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, "");

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return "http://localhost:3000";

  const proto = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
