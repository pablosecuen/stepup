import { OWNER_A, ar } from "./helpers.ts";

/** Fila de `billing_subscriptions` tal como la devuelve PostgREST (fechas en texto con huso, `version` como número o texto). */
export const MONTHLY_ROW = {
  owner_id: OWNER_A,
  provider_reference: "tfs_" + "a".repeat(32),
  provider_subscriber_uid: "SUBR1",
  status: "active",
  grandfathered: false,
  plan_code: "tf_monthly_ars_v1",
  pending_plan_code: null,
  current_period_start: ar("2026-10-01").replace("Z", "+00:00"),
  current_period_end: ar("2026-11-01").replace("Z", "+00:00"),
  renewal_rejected_due_at: null,
  grace_ends_at: ar("2026-11-07"),
  cancel_requested_at: null,
  provider_ended_at: null,
  restarted_at: null,
  next_check_at: ar("2026-11-01"),
  version: 3,
};
