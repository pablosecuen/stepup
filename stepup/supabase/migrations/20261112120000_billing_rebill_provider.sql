-- Rebill como proveedor de cobro de suscripciones (aditiva e idempotente; no edita migraciones históricas).
--
--   · el proveedor `rebill` pasa a ser un valor válido en las seis tablas que lo registran (las filas históricas de Mobbex y del adaptador falso se conservan);
--   · `billing_resolve_subscribers` también resuelve por id de pago (un aviso de Rebill que sólo trae el pago, p. ej. una devolución, se asigna a la cuenta por los
--     cobros ya conciliados) y devuelve qué ids de pago coincidieron;
--   · `billing_bind_subscribers`: Rebill crea la suscripción DESPUÉS del primer cobro aprobado, así que el uid del suscriptor se vincula a la cuenta cuando ese cobro se
--     concilia (la referencia opaca `tf_ref` viaja en el pago). Sólo servidor (service_role), como el resto de `billing_*`.

-- ---------------------------------------------------------------------------
-- 1. Valores de `provider` admitidos: se reemplaza la restricción de cada tabla, sea cual sea su nombre.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['billing_subscriptions', 'billing_executions', 'billing_periods', 'billing_checkout_attempts', 'billing_webhook_events', 'billing_fiscal_records']
  loop
    for c in
      select con.conname
        from pg_catalog.pg_constraint con
        join pg_catalog.pg_class cl on cl.oid = con.conrelid
        join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
       where ns.nspname = 'public' and cl.relname = t and con.contype = 'c'
         and pg_catalog.pg_get_constraintdef(con.oid) ~ '^CHECK \(\(?provider(::text)? = ANY'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (provider in (''mobbex'', ''fake'', ''rebill''))', t, t || '_provider_check');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Resolución de suscriptores por referencia, uid o id de pago.
-- ---------------------------------------------------------------------------
drop function if exists public.billing_resolve_subscribers(text[], text[]);
create or replace function public.billing_resolve_subscribers(p_refs text[], p_uids text[], p_payment_ids text[] default '{}'::text[])
returns table (owner_id uuid, provider_reference text, provider_subscriber_uid text, acceptable_plans text[], payment_ids text[])
language sql
stable
set search_path = ''
as $$
  with by_payment as (
    select e.owner_id as o, array_agg(distinct m) as ids
      from public.billing_executions e
      cross join lateral unnest(array[e.execution_uid, e.provider_payment_id]) as m
     where m is not null and m = any (coalesce(p_payment_ids, '{}'::text[]))
     group by e.owner_id
  )
  select s.owner_id, s.provider_reference, s.provider_subscriber_uid,
         array_remove(array[s.plan_code, s.pending_plan_code, a.plan_code], null),
         coalesce(bp.ids, '{}'::text[])
    from public.billing_subscriptions s
    left join lateral (
      select x.plan_code from public.billing_checkout_attempts x
       where x.owner_id = s.owner_id and x.status in ('open', 'completed') and x.created_at > now() - interval '30 days'
       order by x.created_at desc limit 1
    ) a on true
    left join by_payment bp on bp.o = s.owner_id
   where s.provider_reference = any (coalesce(p_refs, '{}'::text[]))
      or s.provider_subscriber_uid = any (coalesce(p_uids, '{}'::text[]))
      or bp.o is not null;
$$;

-- ---------------------------------------------------------------------------
-- 3. Vinculación del suscriptor del proveedor a la cuenta (primer cobro aprobado).
--    Entrada: [{ owner_id, subscriber_uid, plan_code }]. Devuelve por cuenta: el uid anterior (si lo había y era otro) y si quedó vinculado.
--    Nunca vincula un uid que ya pertenece a OTRA cuenta (`bound = false`). Programa una consulta inmediata del suscriptor.
-- ---------------------------------------------------------------------------
create or replace function public.billing_bind_subscribers(p_items jsonb)
returns table (owner_id uuid, previous_uid text, bound boolean)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_prev text;
  v_exists boolean;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'billing_invalid_batch' using errcode = 'invalid_parameter_value'; end if;
  for r in
    select x.owner_id as o, x.subscriber_uid as uid, x.plan_code as plan
      from jsonb_to_recordset(p_items) as x (owner_id uuid, subscriber_uid text, plan_code text)
     where x.owner_id is not null and x.subscriber_uid is not null and length(x.subscriber_uid) between 1 and 128
  loop
    select s.provider_subscriber_uid into v_prev from public.billing_subscriptions s where s.owner_id = r.o for update;
    if not found then continue; end if;
    select exists (select 1 from public.billing_subscriptions s where s.provider_subscriber_uid = r.uid and s.owner_id <> r.o) into v_exists;
    if v_exists then
      owner_id := r.o; previous_uid := null; bound := false;
      return next;
      continue;
    end if;
    if v_prev is not distinct from r.uid then
      owner_id := r.o; previous_uid := null; bound := false;
      return next;
      continue;
    end if;
    update public.billing_subscriptions s
       set provider_subscriber_uid = r.uid,
           provider = 'rebill',
           provider_plan_code = coalesce((select p.code from public.billing_plans p where p.code = r.plan), s.provider_plan_code),
           version = s.version + 1
     where s.owner_id = r.o;
    insert into public.billing_poll_schedule (owner_id, due_at) values (r.o, now())
    on conflict (owner_id) do update set due_at = least(public.billing_poll_schedule.due_at, excluded.due_at), updated_at = now();
    owner_id := r.o; previous_uid := v_prev; bound := true;
    return next;
  end loop;
end;
$$;

revoke all on function public.billing_resolve_subscribers(text[], text[], text[]) from public, anon, authenticated;
revoke all on function public.billing_bind_subscribers(jsonb) from public, anon, authenticated;
grant execute on function public.billing_resolve_subscribers(text[], text[], text[]) to service_role;
grant execute on function public.billing_bind_subscribers(jsonb) to service_role;
