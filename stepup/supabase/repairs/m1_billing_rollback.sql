-- M1 + M2 — Rollback de la facturación. Elimina ÚNICAMENTE objetos `billing_*` (funciones, triggers y tablas creados por
-- 20261014100000_m1_billing_core.sql, 20261014110000_m1_billing_functions.sql y 20261015100000_m2_billing_ops.sql). No toca
-- `auth.users`, ni ninguna tabla, función o política de la aplicación. Idempotente (`if exists`) y válido con M1 solo o con M1 + M2.
--
-- DESTRUCTIVO para los datos de facturación: usarlo sólo antes de que existan cobros reales (o después de exportar
-- `billing_subscriptions`, `billing_periods`, `billing_executions`, `billing_plan_changes` y `billing_poll_schedule`).
--
-- EXCEPCIÓN DELIBERADA: `billing_fiscal_records` (registro fiscal mínimo y seudonimizado, conservación obligatoria de 10 años) NO se
-- elimina acá. Si realmente hubiera que borrarlo (por ejemplo, un ensayo sin datos reales), se hace con la sentencia comentada del final,
-- a mano y sabiendo lo que se borra.
--
-- Con los interruptores BILLING_ENABLED y BILLING_ENFORCEMENT_ENABLED apagados la aplicación no usa nada de esto, así que quitarlo no
-- cambia su comportamiento.

-- Funciones de M2
drop function if exists public.billing_owner_history(uuid, int);
drop function if exists public.billing_resolve_reconciliations(bigint[]);
drop function if exists public.billing_requeue_dead_events(bigint[]);
drop function if exists public.billing_queue_stats();
drop function if exists public.billing_record_manual_outcome(uuid, text, text, timestamptz);
drop function if exists public.billing_purge_fiscal_records(int);
drop function if exists public.billing_prioritize_polls(uuid[]);
drop function if exists public.billing_mark_polled(jsonb);
drop function if exists public.billing_claim_polls(timestamptz, int, int);
drop function if exists public.billing_resolve_subscribers(text[], text[]);
drop function if exists public.billing_complete_checkout_attempt(uuid, text, text, text);

-- Funciones de M1
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

drop table if exists public.billing_poll_schedule;
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

-- Los triggers de integridad se eliminan junto con sus tablas (drop table); las funciones de trigger y de apoyo se eliminan al final.
drop function if exists public.billing_capture_fiscal_record();
drop function if exists public.billing_outcome_rank(text);
drop function if exists public.billing_forbid_owner_change();
drop function if exists public.billing_enforce_version_bump();
drop function if exists public.billing_check_subscription_backed_by_payment();
drop function if exists public.billing_check_amount_vs_catalog();

-- Sólo si se decide borrar también el registro fiscal (NO es parte del rollback normal):
-- drop table if exists public.billing_fiscal_records;
