import type { BillingFlags } from "./flags.ts";
import { logBilling } from "./log.ts";
import type { ProviderAdapter } from "./provider.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { BillingStore, IngestRow } from "./store.ts";

/**
 * Recepción de avisos del proveedor — independiente del framework. Los avisos son SEÑALES NO CONFIABLES (decisión cerrada 2):
 *
 *  - con la facturación apagada responde 404 como si la ruta no existiera, sin leer el cuerpo ni guardar nada;
 *  - sólo POST (`405` con `Allow: POST`), sólo `Content-Type` esperado (`415`), cuerpo pequeño (`413` ANTES de interpretarlo),
 *    límite de frecuencia por cliente y global (`429`);
 *  - el cuerpo se reduce a una pista mínima (identificadores): ningún estado, importe ni plan se toma de él. No hay forma de que un
 *    aviso falso active nada: lo único que produce es una consulta autenticada posterior;
 *  - RESPUESTA UNIFORME: un aviso bien formado recibe siempre `200 {"ok":true}`, exista o no la referencia, esté repetido o no.
 *    Nada de la respuesta (estado, tiempo o texto) permite saber si un suscriptor existe;
 *  - responde RÁPIDO: sólo reduce y guarda (una escritura por lote); la conciliación se hace después, por lotes (`processor.ts`);
 *  - la respuesta nunca incluye motivos, datos del aviso ni errores internos.
 */
export interface IngestDeps {
  readonly adapter: ProviderAdapter;
  readonly store: BillingStore;
  readonly flags: BillingFlags;
  readonly now: () => Date;
  readonly limiter: RateLimiter;
}

export interface IngestRequest {
  readonly method: string;
  readonly contentType: string | undefined;
  /** `Content-Length` declarado, si vino. */
  readonly declaredLength: number | null;
  /** Lee el cuerpo con un tope: devuelve `"too_large"` apenas lo supera (sin leer el resto). */
  readonly readBody: (maxBytes: number) => Promise<string | "too_large">;
  /** Identidad del cliente para el límite de frecuencia (ya anonimizada: nunca una IP en claro). */
  readonly clientKey: string;
}

export interface IngestResponse {
  readonly status: 200 | 400 | 404 | 405 | 413 | 415 | 429 | 503;
  readonly body: { readonly ok: boolean };
  readonly headers?: Readonly<Record<string, string>>;
}

/** Los avisos reales pesan unos pocos KB; 16 KB es holgado y corta el abuso. */
export const MAX_BODY_BYTES = 16 * 1024;

const NOT_FOUND: IngestResponse = { status: 404, body: { ok: false } };

export async function ingestNotice(deps: IngestDeps, request: IngestRequest): Promise<IngestResponse> {
  if (!deps.flags.enabled) return NOT_FOUND;
  if (request.method !== "POST") return { status: 405, body: { ok: false }, headers: { allow: "POST" } };

  const decision = deps.limiter.check(request.clientKey);
  if (!decision.allowed) {
    logBilling("notice", "rate_limited", { provider: deps.adapter.name });
    return { status: 429, body: { ok: false }, headers: { "retry-after": String(decision.retryAfterSeconds) } };
  }

  const declared = (request.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (declared !== "application/x-www-form-urlencoded" && declared !== "application/json") return { status: 415, body: { ok: false } };
  if (request.declaredLength !== null && request.declaredLength > MAX_BODY_BYTES) return { status: 413, body: { ok: false } };

  const rawBody = await request.readBody(MAX_BODY_BYTES);
  if (rawBody === "too_large") return { status: 413, body: { ok: false } };

  const parsed = deps.adapter.parseNotice({ rawBody, contentType: request.contentType, now: deps.now() });
  if (!parsed.ok) {
    logBilling("notice", "rejected", { reason: parsed.reason, provider: deps.adapter.name }, "warn");
    return parsed.reason === "too_large" ? { status: 413, body: { ok: false } } : parsed.reason === "unsupported_content_type" ? { status: 415, body: { ok: false } } : { status: 400, body: { ok: false } };
  }
  if (parsed.notices.length === 0) return { status: 200, body: { ok: true } }; // tipo de aviso que no nos interesa: se reconoce y se ignora

  const rows: IngestRow[] = parsed.notices.map((notice) => ({
    dedupKey: notice.dedupKey,
    provider: deps.adapter.name,
    eventType: notice.eventType,
    payloadHash: notice.payloadHash,
    hint: notice.hint,
    receivedAt: notice.receivedAt,
  }));
  try {
    const result = await deps.store.ingestEvents(rows);
    logBilling("notice", "stored", { count: result.inserted, provider: deps.adapter.name });
    return { status: 200, body: { ok: true } };
  } catch {
    // Base caída: 503 para que el proveedor reintente; no se pierde nada porque todavía no se confirmó nada (y el sondeo recupera el resto).
    logBilling("notice", "store_failed", { provider: deps.adapter.name }, "error");
    return { status: 503, body: { ok: false } };
  }
}
