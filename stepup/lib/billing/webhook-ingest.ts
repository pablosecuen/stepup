import type { BillingFlags } from "./flags.ts";
import { logBilling } from "./log.ts";
import type { ProviderAdapter } from "./provider.ts";
import type { BillingStore, IngestRow } from "./store.ts";

/**
 * Recepción de avisos del proveedor (M1) — independiente del framework: recibe el cuerpo crudo y los encabezados, y devuelve el
 * estado HTTP y un cuerpo mínimo. La ruta HTTP real (M2) sólo delega acá.
 *
 * Reglas:
 *  - con la facturación apagada responde como si la ruta no existiera (404) y no guarda nada;
 *  - NUNCA se acepta un aviso sin verificar: lo decide el adaptador (`verifyWebhook`). Si el mecanismo no está documentado o no
 *    está configurado (Mobbex hoy) responde 401 sin guardar nada;
 *  - responde RÁPIDO: sólo verifica y guarda los campos normalizados (una escritura por lote); la conciliación y el resto del
 *    trabajo pesado se hacen después, por lotes (`processor.ts`);
 *  - la respuesta nunca incluye motivos, datos del aviso ni errores internos.
 */
export interface IngestDeps {
  readonly adapter: ProviderAdapter;
  readonly store: BillingStore;
  readonly flags: BillingFlags;
  readonly now: () => Date;
}

export interface IngestResponse {
  readonly status: 200 | 400 | 401 | 404 | 413 | 503;
  readonly body: { readonly ok: boolean };
}

export const MAX_BODY_BYTES = 64 * 1024;

export async function ingestWebhook(deps: IngestDeps, request: { rawBody: string; headers: Readonly<Record<string, string | undefined>> }): Promise<IngestResponse> {
  if (!deps.flags.enabled) return { status: 404, body: { ok: false } };
  if (Buffer.byteLength(request.rawBody, "utf8") > MAX_BODY_BYTES) return { status: 413, body: { ok: false } };

  const verification = deps.adapter.verifyWebhook({ rawBody: request.rawBody, headers: request.headers, now: deps.now() });
  if (!verification.verified) {
    logBilling("webhook", "rejected", { reason: verification.reason, provider: deps.adapter.name }, "warn");
    return verification.reason === "malformed" ? { status: 400, body: { ok: false } } : verification.reason === "too_large" ? { status: 413, body: { ok: false } } : { status: 401, body: { ok: false } };
  }

  const rows: IngestRow[] = verification.events.map((event) => ({
    dedupKey: event.dedupKey,
    provider: deps.adapter.name,
    eventType: event.eventType,
    payloadHash: event.payloadHash,
    normalized: { operation: event.operation, subscriberUid: event.subscriberUid, subscriberReference: event.subscriberReference },
    receivedAt: event.receivedAt,
  }));
  try {
    const result = await deps.store.ingestEvents(rows);
    logBilling("webhook", "stored", { count: result.inserted, provider: deps.adapter.name });
    return { status: 200, body: { ok: true } };
  } catch {
    // Base caída: se responde 503 para que el proveedor reintente; no se pierde nada porque todavía no se confirmó nada.
    logBilling("webhook", "store_failed", { provider: deps.adapter.name }, "error");
    return { status: 503, body: { ok: false } };
  }
}
