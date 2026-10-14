import type { BillingSnapshot } from "./ledger.ts";
import type { BillingHistory } from "./store.ts";
import { localDateTimeToInstantIso } from "../calendar/timezone.ts";

/**
 * Escenarios de DEMOSTRACIÓN de las pantallas de facturación (capturas y revisión visual). Datos inventados y deterministas, sin
 * ninguna cuenta real. Sólo se usan en el servidor de desarrollo local con el adaptador falso (`demoScenariosAllowed`): en cualquier
 * otro entorno la pantalla ignora el parámetro `escenario` y lee el estado real.
 */
export const DEMO_NOW = new Date(localDateTimeToInstantIso({ date: "2026-10-20", hour: 12, minute: 0, timeZone: "America/Argentina/Buenos_Aires" }));

const ar = (date: string, hour = 0) => localDateTimeToInstantIso({ date, hour, minute: 0, timeZone: "America/Argentina/Buenos_Aires" });

const OWNER = "00000000-0000-4000-8000-0000000000de";

function snapshot(overrides: Partial<BillingSnapshot>): BillingSnapshot {
  return {
    ownerId: OWNER,
    providerReference: "tfs_" + "d".repeat(32),
    providerSubscriberUid: "demo_subscriber",
    providerPlanCode: null,
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
    chargebackAt: null,
    nextCheckAt: null,
    pendingPlanCode: null,
    version: 1,
    ...overrides,
  };
}

const MONTHLY = "tf_monthly_ars_v1" as const;
const ANNUAL = "tf_annual_ars_v1" as const;

const HISTORY: BillingHistory = {
  periods: [
    { planCode: MONTHLY, amountMinor: 2_490_000, periodStart: ar("2026-10-01"), periodEnd: ar("2026-11-01"), voidedAt: null },
    { planCode: MONTHLY, amountMinor: 2_490_000, periodStart: ar("2026-09-01"), periodEnd: ar("2026-10-01"), voidedAt: null },
    { planCode: MONTHLY, amountMinor: 2_490_000, periodStart: ar("2026-08-01"), periodEnd: ar("2026-09-01"), voidedAt: ar("2026-08-12") },
  ],
  charges: [
    { outcome: "approved", planCode: MONTHLY, amountMinor: 2_490_000, dueAt: ar("2026-10-01", 10), occurredAt: ar("2026-10-01", 10) },
    { outcome: "approved", planCode: MONTHLY, amountMinor: 2_490_000, dueAt: ar("2026-09-01", 10), occurredAt: ar("2026-09-01", 10) },
    { outcome: "rejected", planCode: MONTHLY, amountMinor: 2_490_000, dueAt: ar("2026-08-01", 10), occurredAt: ar("2026-08-01", 10) },
    { outcome: "refunded", planCode: MONTHLY, amountMinor: 2_490_000, dueAt: ar("2026-08-01", 9), occurredAt: ar("2026-08-12", 10) },
  ],
};

export interface DemoScenario {
  readonly snapshot: BillingSnapshot | null;
  readonly history: BillingHistory;
  readonly available: boolean;
}

const PAID = { planCode: MONTHLY, providerPlanCode: MONTHLY, currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") } as const;

export const DEMO_SCENARIOS: Readonly<Record<string, DemoScenario>> = {
  unavailable: { snapshot: null, history: { periods: [], charges: [] }, available: false },
  none: { snapshot: snapshot({ providerSubscriberUid: null }), history: { periods: [], charges: [] }, available: true },
  grandfathered: { snapshot: snapshot({ status: "grandfathered", grandfathered: true, providerSubscriberUid: null }), history: { periods: [], charges: [] }, available: true },
  processing: { snapshot: snapshot({ providerPlanCode: ANNUAL }), history: { periods: [], charges: [] }, available: true },
  active: { snapshot: snapshot({ status: "active", ...PAID, nextCheckAt: ar("2026-11-01") }), history: HISTORY, available: true },
  "active-annual": {
    snapshot: snapshot({ status: "active", planCode: ANNUAL, providerPlanCode: ANNUAL, currentPeriodStart: ar("2026-03-01"), currentPeriodEnd: ar("2027-03-01"), graceEndsAt: ar("2027-03-07"), pendingPlanCode: MONTHLY }),
    history: { periods: [{ planCode: ANNUAL, amountMinor: 24_900_000, periodStart: ar("2026-03-01"), periodEnd: ar("2027-03-01"), voidedAt: null }], charges: [{ outcome: "approved", planCode: ANNUAL, amountMinor: 24_900_000, dueAt: ar("2026-03-01", 10), occurredAt: ar("2026-03-01", 10) }] },
    available: true,
  },
  renewing: { snapshot: snapshot({ status: "past_due", ...PAID, currentPeriodStart: ar("2026-09-20"), currentPeriodEnd: ar("2026-10-20"), graceEndsAt: ar("2026-10-26") }), history: HISTORY, available: true },
  grace: { snapshot: snapshot({ status: "grace_period", ...PAID, currentPeriodStart: ar("2026-09-18"), currentPeriodEnd: ar("2026-10-18"), renewalRejectedDueAt: ar("2026-10-18", 10), graceEndsAt: ar("2026-10-24") }), history: HISTORY, available: true },
  limited: { snapshot: snapshot({ status: "limited", ...PAID, currentPeriodStart: ar("2026-09-01"), currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-07") }), history: HISTORY, available: true },
  chargeback: { snapshot: snapshot({ status: "limited", ...PAID, chargebackAt: ar("2026-10-15", 12) }), history: HISTORY, available: true },
  ending: { snapshot: snapshot({ status: "cancel_at_period_end", ...PAID, cancelRequestedAt: ar("2026-10-10") }), history: HISTORY, available: true },
  canceled: { snapshot: snapshot({ status: "canceled", planCode: MONTHLY, providerPlanCode: MONTHLY, currentPeriodStart: ar("2026-09-01"), currentPeriodEnd: ar("2026-10-01"), cancelRequestedAt: ar("2026-09-20") }), history: HISTORY, available: true },
  expired: { snapshot: snapshot({ status: "expired", planCode: MONTHLY, providerPlanCode: MONTHLY, currentPeriodStart: ar("2026-09-01"), currentPeriodEnd: ar("2026-10-01"), providerEndedAt: ar("2026-09-25") }), history: HISTORY, available: true },
};

export function demoScenario(name: unknown): DemoScenario | null {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(DEMO_SCENARIOS, name) ? DEMO_SCENARIOS[name] : null;
}
