import { NextResponse } from "next/server";
import { getBillingFlags, getBillingRuntime, processorDeps } from "@/lib/billing/runtime";
import { bearerMatches } from "@/lib/billing/http";
import { runReconcileJob } from "@/lib/billing/jobs";
import { logBilling } from "@/lib/billing/log";

// Trabajo programado de conciliación: barrido del reloj (vencimientos y fin de gracia), barrido global del proveedor (si lo admite),
// purga por retención y estadísticas de las colas. Mismo control de acceso que `cron/process`.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JSON_HEADERS = { "cache-control": "no-store" } as const;

async function handle(request: Request): Promise<NextResponse> {
  if (!getBillingFlags().enabled) return NextResponse.json({ ok: false }, { status: 404, headers: JSON_HEADERS });
  if (!bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401, headers: JSON_HEADERS });
  const runtime = getBillingRuntime();
  const deps = processorDeps(runtime, `cron-reconcile-${Date.now().toString(36)}`);
  if (!deps) return NextResponse.json({ ok: false }, { status: 503, headers: JSON_HEADERS });
  try {
    const metrics = await runReconcileJob(deps, { budgetMs: 45_000 });
    return NextResponse.json({ ok: true, metrics }, { headers: JSON_HEADERS });
  } catch {
    logBilling("job", "reconcile_failed", { provider: deps.provider.name }, "error");
    return NextResponse.json({ ok: false }, { status: 500, headers: JSON_HEADERS });
  }
}

export const GET = handle;
export const POST = handle;
