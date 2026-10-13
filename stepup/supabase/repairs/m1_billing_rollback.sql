-- M1 — Rollback de la facturación. Elimina ÚNICAMENTE objetos `billing_*` (funciones, triggers y tablas creados por
-- 20261014100000_m1_billing_core.sql y 20261014110000_m1_billing_functions.sql). No toca `auth.users`, ni ninguna tabla, función o
-- política de la aplicación. DESTRUCTIVO para los datos de facturación: usarlo sólo antes de que existan cobros reales (o después de
-- exportar `billing_subscriptions`, `billing_periods`, `billing_executions` y `billing_plan_changes`).
--
-- Con los interruptores BILLING_ENABLED y BILLING_ENFORCEMENT_ENABLED apagados la aplicación no usa nada de esto, así que quitarlo no
-- cambia su comportamiento.

drop function if exists public.billing_purge_retention(int);
drop function if exists public.billing_sweep_cursor_set(text, timestamptz);
drop function if exists public.billing_sweep_cursor_get(text);
drop function if exists public.billing_fail_checkout_attempt(uuid);
drop function if exists public.billing_complete_checkout_attempt(uuid, text, text);
drop function if exists public.billing_open_checkout_attempt(uuid, text, text, text, timestamptz);
drop function if exists public.billing_commit_batch(jsonb);
drop function if exists public.billing_claim_events(int, int, text, int);
drop function if exists public.billing_ingest_webhook_events(jsonb);
drop function if exists public.billing_due_subscriptions(timestamptz, timestamptz, uuid, int);
drop function if exists public.billing_owner_executions(uuid[], int);
drop function if exists public.billing_resolve_subscribers(text[]);
drop function if exists public.billing_get_subscriptions(uuid[]);
drop function if exists public.billing_ensure_account(uuid);

drop table if exists public.billing_sweep_cursors;
drop table if exists public.billing_reconciliations;
drop table if exists public.billing_webhook_events;
drop table if exists public.billing_plan_changes;
drop table if exists public.billing_checkout_attempts;
drop table if exists public.billing_periods;
drop table if exists public.billing_executions;
drop table if exists public.billing_subscriptions;
drop table if exists public.billing_settings;
drop table if exists public.billing_plans;

-- Los triggers de integridad se eliminan junto con sus tablas (drop table); las funciones de trigger se eliminan al final.
drop function if exists public.billing_forbid_owner_change();
drop function if exists public.billing_enforce_version_bump();
drop function if exists public.billing_check_subscription_backed_by_payment();
drop function if exists public.billing_check_amount_vs_catalog();
