import { NextResponse } from "next/server";
import { getBillingFlags, getBillingRuntime, processorDeps } from "@/lib/billing/runtime";
import { bearerMatches } from "@/lib/billing/http";
import { runProcessJob } from "@/lib/billing/jobs";
import { logBilling } from "@/lib/billing/log";

// Trabajo programado: procesa la cola de avisos por lotes y sondea a los suscriptores que corresponde. Lo invoca el cron con
// `Authorization: Bearer <CRON_SECRET>`. Con la facturación apagada la ruta «no existe» (404) aunque el secreto sea correcto.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JSON_HEADERS = { "cache-control": "no-store" } as const;

async function handle(request: Request): Promise<NextResponse> {
  if (!getBillingFlags().enabled) return NextResponse.json({ ok: false }, { status: 404, headers: JSON_HEADERS });
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401, headers: JSON_HEADERS });
  const runtime = getBillingRuntime();
  const deps = processorDeps(runtime, `cron-process-${Date.now().toString(36)}`);
  if (!deps) return NextResponse.json({ ok: false }, { status: 503, headers: JSON_HEADERS });
  try {
    const metrics = await runProcessJob(deps, { budgetMs: 45_000 });
    return NextResponse.json({ ok: true, metrics }, { headers: JSON_HEADERS });
  } catch {
    // Sin detalles: el trabajo es idempotente y la próxima corrida retoma lo que quedó (arrendamientos y reintentos).
    logBilling("job", "process_failed", { provider: deps.provider.name }, "error");
    return NextResponse.json({ ok: false }, { status: 500, headers: JSON_HEADERS });
  }
}

export const GET = handle;
export const POST = handle;
