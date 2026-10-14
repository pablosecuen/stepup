import { logBilling } from "./log.ts";
import { drainEvents, runClockSweep, runProviderSweep, runSubscriberPoll, type BatchStats, type PollStats, type ProcessorDeps, type ProviderSweepStats, type SweepStats } from "./processor.ts";
import type { QueueStats } from "./store.ts";

/**
 * Trabajos programados de la facturación (los invoca el cron con un secreto). Cada trabajo está ACOTADO por tiempo y por lotes: si
 * se corta, lo que falta queda en la cola y lo toma la próxima corrida (nada se pierde). Las métricas que devuelven son sólo
 * contadores y duraciones: ningún identificador, importe, correo ni dato de ninguna persona.
 *
 *   process    → vaciar la cola de avisos por lotes (consulta autenticada de cada pago) + sondeo por suscriptor
 *   reconcile  → barrido del reloj (vencimientos, fin de gracia, fin de cancelación) + barrido global del proveedor (si lo admite)
 *                + purga por retención + estadísticas de las colas
 */
export interface JobBudget {
  /** Milisegundos máximos que puede usar el trabajo (la plataforma corta la función después). */
  readonly budgetMs: number;
}

export interface ProcessJobMetrics {
  readonly kind: "process";
  readonly durationMs: number;
  readonly events: BatchStats;
  readonly polls: PollStats;
}

export interface ReconcileJobMetrics {
  readonly kind: "reconcile";
  readonly durationMs: number;
  readonly clock: SweepStats;
  readonly providerSweep: ProviderSweepStats;
  readonly purged: { readonly events: number; readonly reconciliations: number };
  readonly queues: QueueStats;
}

export async function runProcessJob(deps: ProcessorDeps, budget: JobBudget): Promise<ProcessJobMetrics> {
  const started = deps.now().getTime();
  const deadlineAt = started + budget.budgetMs;
  const events = await drainEvents(deps, 50, deadlineAt);
  const polls = await runSubscriberPoll(deps, { limit: 200, maxBatches: 20, deadlineAt });
  const durationMs = deps.now().getTime() - started;
  logBilling("job", "process_done", { count: events.claimed + polls.claimed, durationMs, provider: deps.provider.name });
  return { kind: "process", durationMs, events, polls };
}

export async function runReconcileJob(deps: ProcessorDeps, budget: JobBudget): Promise<ReconcileJobMetrics> {
  const started = deps.now().getTime();
  const clock = await runClockSweep(deps, { pageSize: 500, maxPages: 100 });
  const providerSweep = await runProviderSweep(deps, { maxPages: 100 });
  const purged = deps.now().getTime() - started < budget.budgetMs ? await deps.store.purgeRetention({ limit: 2_000 }) : { events: 0, reconciliations: 0 };
  const queues = await deps.store.queueStats();
  const durationMs = deps.now().getTime() - started;
  logBilling("job", "reconcile_done", { count: clock.evaluated, durationMs, provider: deps.provider.name });
  return { kind: "reconcile", durationMs, clock, providerSweep, purged, queues };
}
