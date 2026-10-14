import { NextResponse } from "next/server";
import { getBillingFlags, getBillingRuntime } from "@/lib/billing/runtime";
import { clientKeyFrom, contentLengthOf, readBodyLimited } from "@/lib/billing/http";
import { ingestNotice, type IngestResponse } from "@/lib/billing/webhook-ingest";

// Recepción de avisos de Mobbex. Los avisos son señales NO CONFIABLES: sólo se reducen a una pista y se guardan; el trabajo pesado
// y toda decisión se hacen después, con la consulta autenticada (ver lib/billing/webhook-ingest.ts y processor.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function respond(result: IngestResponse): NextResponse {
  return NextResponse.json(result.body, { status: result.status, headers: { "cache-control": "no-store", ...(result.headers ?? {}) } });
}

async function handle(request: Request): Promise<NextResponse> {
  // Interruptor apagado: la ruta «no existe» (sin construir nada, sin leer el cuerpo).
  if (!getBillingFlags().enabled) return respond({ status: 404, body: { ok: false } });
  const runtime = getBillingRuntime();
  if (!runtime.store) return respond({ status: 503, body: { ok: false } });
  const result = await ingestNotice(
    { adapter: runtime.provider, store: runtime.store, flags: runtime.flags, now: runtime.now, limiter: runtime.limiter },
    {
      method: request.method,
      contentType: request.headers.get("content-type") ?? undefined,
      declaredLength: contentLengthOf(request.headers),
      readBody: (maxBytes) => readBodyLimited(request, maxBytes),
      clientKey: clientKeyFrom(request.headers),
    },
  );
  return respond(result);
}

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
