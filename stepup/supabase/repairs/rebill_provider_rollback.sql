-- ROLLBACK de 20261112120000_billing_rebill_provider.sql (sólo si hace falta volver atrás ANTES de que exista alguna fila del proveedor `rebill`).
--
-- Seguro por diseño: si ya hay filas con `provider = 'rebill'`, volver a la restricción de dos proveedores FALLA (no borra ni altera datos) y la transacción entera se revierte.
-- Para volver atrás con cobros de Rebill ya registrados NO se usa este script: esos registros (cobros, períodos y registro fiscal de 10 años) son historia que se conserva.
-- Sólo toca objetos billing_*.
begin;

drop function if exists public.billing_bind_subscribers(jsonb);
drop function if exists public.billing_resolve_subscribers(text[], text[], text[]);

create or replace function public.billing_resolve_subscribers(p_refs text[], p_uids text[])
returns table (owner_id uuid, provider_reference text, provider_subscriber_uid text, acceptable_plans text[])
language sql
stable
set search_path = ''
as $$
  select s.owner_id, s.provider_reference, s.provider_subscriber_uid,
         array_remove(array[s.plan_code, s.pending_plan_code, a.plan_code], null)
    from public.billing_subscriptions s
    left join lateral (
      select x.plan_code from public.billing_checkout_attempts x
       where x.owner_id = s.owner_id and x.status in ('open', 'completed') and x.created_at > now() - interval '30 days'
       order by x.created_at desc limit 1
    ) a on true
   where s.provider_reference = any (coalesce(p_refs, '{}'::text[]))
      or s.provider_subscriber_uid = any (coalesce(p_uids, '{}'::text[]));
$$;
revoke all on function public.billing_resolve_subscribers(text[], text[]) from public, anon, authenticated;
grant execute on function public.billing_resolve_subscribers(text[], text[]) to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['billing_subscriptions', 'billing_executions', 'billing_periods', 'billing_checkout_attempts', 'billing_webhook_events', 'billing_fiscal_records']
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_provider_check');
    execute format('alter table public.%I add constraint %I check (provider in (''mobbex'', ''fake''))', t, t || '_provider_check');
  end loop;
end;
$$;

commit;
