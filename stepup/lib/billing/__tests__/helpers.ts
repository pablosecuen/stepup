import type { BillingSnapshot, ExecutionFact } from "../ledger.ts";
import type { BillingStatus } from "../state-machine.ts";
import { localDateTimeToInstantIso } from "../../calendar/timezone.ts";

/** Instante de una fecha y hora CIVIL de Argentina (nunca UTC): `ar("2026-10-01", 23, 30)` = 23:30 del 1/oct en Buenos Aires. */
export function ar(date: string, hour = 0, minute = 0): string {
  return localDateTimeToInstantIso({ date, hour, minute, timeZone: "America/Argentina/Buenos_Aires" });
}

export const OWNER_A = "00000000-0000-4000-8000-00000000000a";
export const OWNER_B = "00000000-0000-4000-8000-00000000000b";

export function snap(overrides: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return {
    ownerId: OWNER_A,
    providerReference: "tfs_" + "a".repeat(32),
    providerSubscriberUid: null,
    status: "pending",
    planCode: null,
    grandfathered: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    renewalRejectedDueAt: null,
    graceEndsAt: null,
    cancelRequestedAt: null,
    providerEndedAt: null,
    restartedAt: null,
    nextCheckAt: null,
    pendingPlanCode: null,
    version: 1,
    ...overrides,
  };
}

export function approved(executionId: string, dueDate: string, extra: Partial<ExecutionFact> = {}): ExecutionFact {
  return { executionId, outcome: "approved", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar(dueDate, 10), occurredAt: ar(dueDate, 10, 5), ...extra };
}

export function rejected(executionId: string, dueDate: string, extra: Partial<ExecutionFact> = {}): ExecutionFact {
  return { executionId, outcome: "rejected", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar(dueDate, 10), occurredAt: ar(dueDate, 10, 5), ...extra };
}

/** Generador pseudoaleatorio determinista (mulberry32): las pruebas de orden aleatorio son reproducibles. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

/** Instante de referencia de las pruebas de comandos y de acceso: 15/10/2026, 12:00 en Argentina. */
export const NOW_AR = new Date(Date.parse(ar("2026-10-15", 12)));

/** Un snapshot COHERENTE con el estado pedido al instante `NOW_AR` (las fechas son las que ese estado tendría de verdad). */
export function coherent(status: BillingStatus): BillingSnapshot {
  const paid = { planCode: "tf_monthly_ars_v1" as const, providerSubscriberUid: "SUBR1" };
  switch (status) {
    case "grandfathered":
      return snap({ status, grandfathered: true });
    case "pending":
      return snap({ status });
    case "active":
      return snap({ status, ...paid, currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") });
    case "past_due":
      return snap({ status, ...paid, currentPeriodStart: ar("2026-09-10"), currentPeriodEnd: ar("2026-10-10"), graceEndsAt: ar("2026-10-16") });
    case "grace_period":
      return snap({ status, ...paid, currentPeriodStart: ar("2026-09-10"), currentPeriodEnd: ar("2026-10-10"), renewalRejectedDueAt: ar("2026-10-10", 10), graceEndsAt: ar("2026-10-16") });
    case "limited":
      return snap({ status, ...paid, currentPeriodStart: ar("2026-08-01"), currentPeriodEnd: ar("2026-09-01"), graceEndsAt: ar("2026-09-07") });
    case "cancel_at_period_end":
      return snap({ status, ...paid, currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07"), cancelRequestedAt: ar("2026-10-10") });
    case "canceled":
      return snap({ status, cancelRequestedAt: ar("2026-09-01") });
    case "expired":
      return snap({ status, providerEndedAt: ar("2026-10-01") });
  }
}
