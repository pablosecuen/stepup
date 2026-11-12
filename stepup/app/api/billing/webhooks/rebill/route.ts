import { NextResponse } from "next/server";
import { after } from "next/server";
import { getBillingFlags, getBillingRuntime, processorDeps } from "@/lib/billing/runtime";
import { clientKeyFrom, contentLengthOf, readBodyLimited } from "@/lib/billing/http";
import { ingestNotice, type IngestResponse } from "@/lib/billing/webhook-ingest";
import { drainEvents } from "@/lib/billing/processor";
import { logBilling } from "@/lib/billing/log";

// Recepción de avisos de Rebill. Se verifica la firma (`x-rebill-signature`, HMAC-SHA256 del cuerpo crudo) ANTES de guardar nada; el aviso se reduce a una pista
// y se guarda; la conciliación (consulta autenticada del pago) se hace después, también apenas responde esta ruta (`after`) y por el trabajo programado. Aun firmado,
// un aviso nunca activa nada por sí solo (ver lib/billing/webhook-ingest.ts y processor.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function respond(result: IngestResponse): NextResponse {
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store", ...(result.headers ?? {}) } });
}

async function handle(request: Request): Promise<NextResponse> {
  // Interruptor apagado: la ruta «no existe» (sin construir nada, sin leer el cuerpo).
  if (!getBillingFlags().enabled) return respond({ status: 404, body: { ok: false } });
  const runtime = getBillingRuntime();
  if (!runtime.store || runtime.provider.name !== "rebill") return respond({ status: 503, body: { ok: false } });
  const result = await ingestNotice(
    { adapter: runtime.provider, store: runtime.store, flags: runtime.flags, now: runtime.now, limiter: runtime.limiter },
    {
      method: request.method,
      contentType: request.headers.get("content-type") ?? undefined,
      declaredLength: contentLengthOf(request.headers),
      readBody: (maxBytes) => readBodyLimited(request, maxBytes),
      clientKey: clientKeyFrom(request.headers),
      signature: request.headers.get("x-rebill-signature") ?? undefined,
    },
  );
  if (result.status === 200) {
    const deps = processorDeps(runtime, `webhook-${Date.now().toString(36)}`);
    if (deps) {
      // La respuesta ya salió: el lote se concilia en segundo plano (idempotente; si falla, lo retoma el trabajo programado).
      after(async () => {
        try {
          await drainEvents(deps, 5, Date.now() + 20_000);
        } catch {
          logBilling("notice", "inline_process_failed", { provider: deps.provider.name }, "error");
        }
      });
    }
  }
  return respond(result);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
