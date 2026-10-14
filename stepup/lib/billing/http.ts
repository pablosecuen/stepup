import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Utilidades HTTP puras de las rutas de facturación (sin Next.js, para poder probarlas): lectura de cuerpo con tope, identidad
 * anonimizada del cliente para el límite de frecuencia y comparación en tiempo constante del secreto de los trabajos programados.
 */

/** Lee el cuerpo sin pasar de `maxBytes`: corta apenas lo supera (no descarga el resto). Un cuerpo que no es UTF-8 válido se rechaza. */
export async function readBodyLimited(request: { readonly body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<string | "too_large"> {
  const stream = request.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } catch {
    return "�"; // no es texto válido: el análisis lo descartará como mal formado
  }
}

/** Clave anónima del cliente: hash corto del primer salto de `x-forwarded-for` (Vercel lo fija en el borde) o de `x-real-ip`. Nunca la IP en claro. */
export function clientKeyFrom(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return createHash("sha256").update(`tf-notice-client:${raw.slice(0, 64)}`).digest("hex").slice(0, 24);
}

export function contentLengthOf(headers: Pick<Headers, "get">): number | null {
  const value = headers.get("content-length");
  if (value === null || !/^[0-9]{1,12}$/.test(value)) return null;
  return Number(value);
}

/** ¿El encabezado `Authorization` es exactamente `Bearer <secreto>`? Comparación en tiempo constante; un secreto corto o ausente nunca coincide. */
export function bearerMatches(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string") return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
