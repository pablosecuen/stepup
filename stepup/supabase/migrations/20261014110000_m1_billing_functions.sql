-- M1 — Facturación: funciones de SERVIDOR (ADITIVA e IDEMPOTENTE: `create or replace`, sólo objetos nuevos `billing_*`).
--
-- Todas son INVOKER con `search_path = ''` y SÓLO ejecutables por `service_role` (la clave de servicio del servidor): ni `anon` ni
-- `authenticated` pueden llamarlas. El navegador nunca activa, paga, concilia ni edita una suscripción. Toda lectura y escritura es
-- POR LOTES (arreglos): ninguna función se invoca una vez por suscripción, y las consultas calientes tienen índice propio.
--
-- La LÓGICA del estado de una suscripción vive en el servidor de aplicación (lib/billing, pura y probada); acá sólo hay integridad:
-- control optimista de versión, claves únicas, validación contra el catálogo y atomicidad por lote.

-- ---------------------------------------------------------------------------
-- Cuenta: crea bajo demanda la fila de una propietaria (grandfathered si ya existía al fijar el corte; pending si es nueva).
-- ---------------------------------------------------------------------------
-- Única función SECURITY DEFINER del módulo: necesita leer `auth.users.created_at` (para decidir grandfathered/pending) y `service_role` no
-- tiene por qué poder leer el esquema `auth`. Dueño: el rol que migra; search_path vacío; sólo EXECUTE de service_role; sólo lee una
-- columna de una fila (la propietaria pedida) y sólo escribe en billing_subscriptions.
create or replace function public.billing_ensure_account(p_owner uuid)
returns public.billing_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_subscriptions;
  v_created timestamptz;
  v_cutoff timestamptz;
  v_legacy boolean;
begin
  select * into v_row from public.billing_subscriptions s where s.owner_id = p_owner;
  if found then return v_row; end if;

  select u.created_at into v_created from auth.users u where u.id = p_owner;
  if not found then raise exception 'billing_unknown_owner' using errcode = 'foreign_key_violation'; end if;
  select b.grandfather_cutoff into v_cutoff from public.billing_settings b where b.id;
  v_legacy := v_created <= v_cutoff;

  insert into public.billing_subscriptions (owner_id, status, grandfathered, provider_reference)
  values (p_owner, case when v_legacy then 'grandfathered' else 'pending' end, v_legacy, 'tfs_' || replace(pg_catalog.gen_random_uuid()::text, '-', ''))
  on conflict (owner_id) do nothing
  returning * into v_row;

  if v_row.owner_id is null then
    select * into v_row from public.billing_subscriptions s where s.owner_id = p_owner;
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecturas por lotes
-- ---------------------------------------------------------------------------
create or replace function public.billing_get_subscriptions(p_owner_ids uuid[])
returns setof public.billing_subscriptions
language sql
stable
set search_path = ''
as $$
  select s.* from public.billing_subscriptions s where s.owner_id = any (p_owner_ids);
$$;

-- Propietaria y planes aceptables de cada referencia de suscriptor (el vigente, el programado y el del intento reciente).
create or replace function public.billing_resolve_subscribers(p_refs text[])
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
   where s.provider_reference = any (p_refs);
$$;

-- Cobros recientes de cada cuenta (las últimas `p_per_owner`), en UNA sentencia: un recorrido por índice por cuenta, sin bucle en la aplicación.
create or replace function public.billing_owner_executions(p_owner_ids uuid[], p_per_owner int)
returns table (owner_id uuid, execution_uid text, outcome text, plan_code text, amount_minor bigint, due_at timestamptz, occurred_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select e.owner_id, e.execution_uid, e.outcome, e.plan_code, e.amount_minor, e.due_at, e.occurred_at
    from unnest(p_owner_ids) as o(owner_id)
   cross join lateral (
     select x.owner_id, x.execution_uid, x.outcome, x.plan_code, x.amount_minor, x.due_at, x.occurred_at
       from public.billing_executions x
      where x.owner_id = o.owner_id
      order by x.due_at desc, x.execution_uid
      limit greatest(1, least(p_per_owner, 200))
   ) e;
$$;

-- Cuentas cuyo estado puede cambiar por el reloj: paginado por cursor (next_check_at, owner_id) sobre el índice parcial.
create or replace function public.billing_due_subscriptions(p_now timestamptz, p_after_at timestamptz, p_after_owner uuid, p_limit int)
returns setof public.billing_subscriptions
language sql
stable
set search_path = ''
as $$
  select s.*
    from public.billing_subscriptions s
   where s.next_check_at is not null
     and s.next_check_at <= p_now
     and (p_after_at is null or (s.next_check_at, s.owner_id) > (p_after_at, p_after_owner))
   order by s.next_check_at, s.owner_id
   limit greatest(1, least(p_limit, 1000));
$$;

-- ---------------------------------------------------------------------------
-- Avisos: recepción idempotente (descarta duplicados por identidad semántica) y reclamo por lotes con arrendamiento.
-- ---------------------------------------------------------------------------
create or replace function public.billing_ingest_webhook_events(p_rows jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_total int;
  v_inserted int;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'billing_invalid_batch' using errcode = 'invalid_parameter_value'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 200 then raise exception 'billing_batch_too_large' using errcode = 'invalid_parameter_value'; end if;

  with input as (
    select * from jsonb_to_recordset(p_rows) as r (dedup_key text, provider text, event_type text, payload_hash text, normalized jsonb, received_at timestamptz)
  ), ins as (
    insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized, received_at)
    select i.dedup_key, i.provider, i.event_type, i.payload_hash, i.normalized, coalesce(i.received_at, now()) from input i
    on conflict (dedup_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_total - v_inserted);
end;
$$;

-- Reclama hasta `p_limit` avisos pendientes con un arrendamiento. Antes recupera los que quedaron «en proceso» con el arrendamiento
-- vencido (el proceso se interrumpió): vuelven a la cola, y tras `p_max_attempts` interrupciones pasan a `dead`. Nada se pierde.
create or replace function public.billing_claim_events(p_limit int, p_lease_seconds int, p_worker text, p_max_attempts int)
returns setof public.billing_webhook_events
language plpgsql
set search_path = ''
as $$
begin
  update public.billing_webhook_events e
     set status = case when e.attempts + 1 >= p_max_attempts then 'dead' else 'failed' end,
         attempts = e.attempts + 1,
         next_attempt_at = now(),
         locked_until = null,
         locked_by = null,
         result = 'lease_expired'
   where e.status = 'processing' and e.locked_until < now();

  return query
  with picked as (
    select x.id
      from public.billing_webhook_events x
     where x.status in ('received', 'failed') and x.next_attempt_at <= now()
     order by x.next_attempt_at, x.id
     limit greatest(1, least(p_limit, 1000))
       for update skip locked
  )
  update public.billing_webhook_events e
     set status = 'processing',
         locked_until = now() + pg_catalog.make_interval(secs => greatest(p_lease_seconds, 5)),
         locked_by = left(p_worker, 64)
    from picked
   where e.id = picked.id
  returning e.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Escritura por lote, ATÓMICA. Los cobros y períodos son idempotentes (clave única por ejecución; gana el resultado más reciente y,
-- a igual instante, `approved`); las suscripciones sólo se escriben si su versión sigue siendo la leída (control optimista); los
-- avisos de una cuenta cuya versión cambió vuelven a la cola. Devuelve las cuentas en conflicto y cuántas suscripciones se escribieron.
-- ---------------------------------------------------------------------------
create or replace function public.billing_commit_batch(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_conflicts uuid[];
  v_written int;
begin
  -- 1) Cobros: una fila por ejecución. Nunca cambia de propietaria; un resultado más viejo no pisa a uno más nuevo.
  insert into public.billing_executions (owner_id, provider, execution_uid, provider_payment_id, outcome, plan_code, amount_minor, currency, due_at, occurred_at)
  -- Varios avisos del MISMO cobro pueden venir en un lote: se queda el más reciente (a igual instante, el aprobado). Sin esto,
  -- `ON CONFLICT DO UPDATE` no puede afectar dos veces la misma fila y todo el lote fallaría.
  select d.owner_id, d.provider, d.execution_uid, d.provider_payment_id, d.outcome, d.plan_code, d.amount_minor, d.currency, d.due_at, d.occurred_at
    from (
      select distinct on (x.provider, x.execution_uid) x.owner_id, x.provider, x.execution_uid, x.provider_payment_id, x.outcome, x.plan_code, x.amount_minor, x.currency, x.due_at, x.occurred_at
        from jsonb_to_recordset(coalesce(p -> 'executions', '[]'::jsonb)) as x (owner_id uuid, provider text, execution_uid text, provider_payment_id text, outcome text, plan_code text, amount_minor bigint, currency text, due_at timestamptz, occurred_at timestamptz)
       -- Una cuenta eliminada entre la lectura y la escritura no puede envenenar el lote: sus filas simplemente no se escriben.
       where exists (select 1 from public.billing_subscriptions s where s.owner_id = x.owner_id)
       order by x.provider, x.execution_uid, x.occurred_at desc, (x.outcome = 'approved') desc
    ) d
  on conflict (provider, execution_uid) do update
     set outcome = excluded.outcome,
         provider_payment_id = coalesce(excluded.provider_payment_id, public.billing_executions.provider_payment_id),
         plan_code = excluded.plan_code,
         amount_minor = excluded.amount_minor,
         due_at = excluded.due_at,
         occurred_at = excluded.occurred_at
   where public.billing_executions.owner_id = excluded.owner_id
     and (excluded.occurred_at > public.billing_executions.occurred_at
          or (excluded.occurred_at = public.billing_executions.occurred_at and excluded.outcome = 'approved' and public.billing_executions.outcome <> 'approved'));

  -- 2) Períodos pagados (derivados): una fila por ejecución aprobada.
  insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end)
  select d.owner_id, d.provider, d.execution_uid, d.plan_code, d.price_version, d.amount_minor, d.currency, d.period_start, d.period_end
    from (
      select distinct on (x.provider, x.execution_uid) x.owner_id, x.provider, x.execution_uid, x.plan_code, x.price_version, x.amount_minor, x.currency, x.period_start, x.period_end
        from jsonb_to_recordset(coalesce(p -> 'periods', '[]'::jsonb)) as x (owner_id uuid, provider text, execution_uid text, plan_code text, price_version int, amount_minor bigint, currency text, period_start timestamptz, period_end timestamptz)
       where exists (select 1 from public.billing_subscriptions s where s.owner_id = x.owner_id)
       order by x.provider, x.execution_uid, x.period_end desc
    ) d
  on conflict (provider, execution_uid) do update
     set plan_code = excluded.plan_code,
         price_version = excluded.price_version,
         amount_minor = excluded.amount_minor,
         period_start = excluded.period_start,
         period_end = excluded.period_end
   where public.billing_periods.owner_id = excluded.owner_id;

  -- 3) Suscripciones: control optimista de versión.
  with input as (
    select * from jsonb_to_recordset(coalesce(p -> 'subscriptions', '[]'::jsonb)) as s (
      owner_id uuid, expected_version bigint, status text, grandfathered boolean, plan_code text, pending_plan_code text,
      current_period_start timestamptz, current_period_end timestamptz, renewal_rejected_due_at timestamptz, grace_ends_at timestamptz,
      cancel_requested_at timestamptz, provider_ended_at timestamptz, restarted_at timestamptz, next_check_at timestamptz)
  ), upd as (
    update public.billing_subscriptions t
       set status = i.status, grandfathered = i.grandfathered, plan_code = i.plan_code, pending_plan_code = i.pending_plan_code,
           current_period_start = i.current_period_start, current_period_end = i.current_period_end,
           renewal_rejected_due_at = i.renewal_rejected_due_at, grace_ends_at = i.grace_ends_at,
           cancel_requested_at = i.cancel_requested_at, provider_ended_at = i.provider_ended_at, restarted_at = i.restarted_at,
           next_check_at = i.next_check_at, version = t.version + 1
      from input i
     where t.owner_id = i.owner_id and t.version = i.expected_version
    returning t.owner_id
  )
  select coalesce(array_agg(i.owner_id) filter (where u.owner_id is null), '{}'::uuid[]), count(u.owner_id)::int
    into v_conflicts, v_written
    from input i left join upd u on u.owner_id = i.owner_id;

  -- 4) Cambios de plan / cancelaciones (sólo de las cuentas cuya escritura se aplicó). Un cambio de plan nuevo reemplaza al programado.
  update public.billing_plan_changes c
     set status = 'superseded'
   where c.kind = 'plan_change' and c.status = 'scheduled'
     and c.owner_id in (
       select x.owner_id
         from jsonb_to_recordset(coalesce(p -> 'changes', '[]'::jsonb)) as x (owner_id uuid, kind text, idempotency_key text)
        where x.kind = 'plan_change' and x.owner_id <> all (v_conflicts)
          and not exists (select 1 from public.billing_plan_changes y where y.owner_id = x.owner_id and y.idempotency_key = x.idempotency_key));

  insert into public.billing_plan_changes (owner_id, kind, from_plan_code, to_plan_code, effective_at, status, idempotency_key)
  select x.owner_id, x.kind, x.from_plan_code, x.to_plan_code, x.effective_at,
         case when x.kind = 'plan_change' then (case when x.to_plan_code is distinct from x.from_plan_code then 'scheduled' else 'canceled' end) else 'recorded' end,
         x.idempotency_key
    from jsonb_to_recordset(coalesce(p -> 'changes', '[]'::jsonb)) as x (owner_id uuid, kind text, from_plan_code text, to_plan_code text, effective_at timestamptz, idempotency_key text)
   where x.owner_id <> all (v_conflicts)
     and exists (select 1 from public.billing_subscriptions s where s.owner_id = x.owner_id)
  on conflict (owner_id, idempotency_key) do nothing;

  -- 5) Anomalías de conciliación (una abierta por clave).
  insert into public.billing_reconciliations (kind, owner_id, dedupe_key, detail)
  select x.kind, (select s.owner_id from public.billing_subscriptions s where s.owner_id = x.owner_id), x.dedupe_key, coalesce(x.detail, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p -> 'reconciliations', '[]'::jsonb)) as x (kind text, owner_id uuid, dedupe_key text, detail jsonb)
  on conflict (dedupe_key) where status = 'open' do nothing;

  -- 6) Avisos: resultado de cada uno. Los de una cuenta en conflicto vuelven a la cola.
  update public.billing_webhook_events e
     set status = case
                    when o.status in ('processed', 'ignored') and o.owner_id is not null and o.owner_id = any (v_conflicts) then 'received'
                    else o.status
                  end,
         attempts = case when o.status in ('failed', 'dead') or (o.owner_id is not null and o.owner_id = any (v_conflicts)) then e.attempts + 1 else e.attempts end,
         next_attempt_at = case
                             when o.status = 'failed' then now() + pg_catalog.make_interval(secs => greatest(o.retry_delay_seconds, 0))
                             when o.owner_id is not null and o.owner_id = any (v_conflicts) then now()
                             else e.next_attempt_at
                           end,
         processed_at = case when o.status in ('processed', 'ignored', 'dead') and not (o.owner_id is not null and o.owner_id = any (v_conflicts)) then now() else null end,
         result = left(o.result, 80),
         owner_id = (select s.owner_id from public.billing_subscriptions s where s.owner_id = o.owner_id),
         locked_until = null,
         locked_by = null
    from jsonb_to_recordset(coalesce(p -> 'events', '[]'::jsonb)) as o (id bigint, owner_id uuid, status text, result text, retry_delay_seconds int)
   where e.id = o.id and e.status = 'processing';

  return jsonb_build_object('conflicts', to_jsonb(v_conflicts), 'subscriptions_written', v_written);
end;
$$;

-- ---------------------------------------------------------------------------
-- Checkout: abre (o reutiliza) el intento de pago de forma ATÓMICA. El precio sale de `billing_plans`, nunca del llamador.
-- Sólo desde estados que permiten empezar una suscripción (espeja `checkout_started` de la máquina de estados del servidor):
-- grandfathered, pending, canceled, expired. Uno solo abierto por cuenta; la misma clave de idempotencia devuelve el mismo intento.
-- ---------------------------------------------------------------------------
create or replace function public.billing_open_checkout_attempt(p_owner uuid, p_plan_code text, p_provider text, p_idempotency_key text, p_expires_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.billing_subscriptions;
  v_plan public.billing_plans;
  v_attempt public.billing_checkout_attempts;
  v_created boolean := false;
  v_superseded boolean := false;
begin
  begin
    perform public.billing_ensure_account(p_owner);
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end;
  select * into v_sub from public.billing_subscriptions s where s.owner_id = p_owner for update;

  select * into v_plan from public.billing_plans p where p.code = p_plan_code and p.active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'plan_invalid'); end if;
  if v_sub.status not in ('grandfathered', 'pending', 'canceled', 'expired') then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;

  update public.billing_checkout_attempts a set status = 'expired' where a.owner_id = p_owner and a.status = 'open' and a.expires_at <= now();

  select * into v_attempt from public.billing_checkout_attempts a where a.owner_id = p_owner and a.idempotency_key = p_idempotency_key;
  if found then
    if v_attempt.plan_code <> v_plan.code then return jsonb_build_object('ok', false, 'reason', 'plan_invalid'); end if;
    if v_attempt.status in ('failed', 'expired') then
      -- Reintento con la misma clave tras un fallo del proveedor o un vencimiento: se reabre el mismo intento.
      update public.billing_checkout_attempts a set status = 'superseded' where a.owner_id = p_owner and a.status = 'open' and a.id <> v_attempt.id;
      update public.billing_checkout_attempts a set status = 'open', expires_at = p_expires_at where a.id = v_attempt.id returning * into v_attempt;
    end if;
  else
    -- Intento vivo = abierto o completado (el proveedor ya devolvió el enlace) y no vencido. Otra pestaña, o un doble clic, lo reutiliza:
    -- jamás se crea un segundo suscriptor en el proveedor para la misma cuenta mientras haya un intento vivo del mismo plan.
    select * into v_attempt from public.billing_checkout_attempts a
     where a.owner_id = p_owner and a.status in ('open', 'completed') and a.expires_at > now()
     order by a.created_at desc limit 1;
    if found and v_attempt.plan_code = v_plan.code then
      null;
    else
      if found then
        update public.billing_checkout_attempts a set status = 'superseded' where a.owner_id = p_owner and a.status in ('open', 'completed') and a.expires_at > now();
        v_superseded := true;
      end if;
      insert into public.billing_checkout_attempts (owner_id, plan_code, price_version, amount_minor, currency, provider, idempotency_key, expires_at)
      values (p_owner, v_plan.code, v_plan.price_version, v_plan.amount_minor, v_plan.currency, p_provider, p_idempotency_key, p_expires_at)
      returning * into v_attempt;
      v_created := true;
    end if;
  end if;

  -- Volver a suscribirse desde canceled/expired: la cuenta vuelve a `pending` y el período anterior deja de contar.
  if v_sub.status in ('canceled', 'expired') then
    update public.billing_subscriptions s
       set status = 'pending', cancel_requested_at = null, provider_ended_at = null, restarted_at = now(), grandfathered = false,
           renewal_rejected_due_at = null, grace_ends_at = null, pending_plan_code = null, next_check_at = null, version = s.version + 1
     where s.owner_id = p_owner;
  end if;

  return jsonb_build_object('ok', true, 'created', v_created, 'superseded', v_superseded,
    'attempt', jsonb_build_object('id', v_attempt.id, 'owner_id', v_attempt.owner_id, 'plan_code', v_attempt.plan_code, 'price_version', v_attempt.price_version,
      'amount_minor', v_attempt.amount_minor, 'currency', v_attempt.currency, 'status', v_attempt.status, 'idempotency_key', v_attempt.idempotency_key, 'subscriber_reference', v_sub.provider_reference));
end;
$$;

create or replace function public.billing_complete_checkout_attempt(p_attempt uuid, p_checkout_uid text, p_subscriber_uid text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select a.owner_id, a.status into v_owner, v_status from public.billing_checkout_attempts a where a.id = p_attempt for update;
  if not found then return false; end if;
  if v_status = 'completed' then return true; end if; -- repetir no cambia nada
  if v_status <> 'open' then return false; end if;
  update public.billing_checkout_attempts a set status = 'completed', provider_checkout_uid = p_checkout_uid, provider_subscriber_uid = p_subscriber_uid where a.id = p_attempt;
  if p_subscriber_uid is not null then
    update public.billing_subscriptions s set provider_subscriber_uid = p_subscriber_uid, version = s.version + 1 where s.owner_id = v_owner and s.provider_subscriber_uid is null;
  end if;
  return true;
end;
$$;

create or replace function public.billing_fail_checkout_attempt(p_attempt uuid)
returns void
language sql
set search_path = ''
as $$
  update public.billing_checkout_attempts a set status = 'failed' where a.id = p_attempt and a.status = 'open';
$$;

-- ---------------------------------------------------------------------------
-- Cursor del barrido contra el proveedor y retención
-- ---------------------------------------------------------------------------
create or replace function public.billing_sweep_cursor_get(p_name text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select c.cursor_at from public.billing_sweep_cursors c where c.name = p_name;
$$;

create or replace function public.billing_sweep_cursor_set(p_name text, p_at timestamptz)
returns void
language sql
set search_path = ''
as $$
  insert into public.billing_sweep_cursors (name, cursor_at) values (p_name, p_at)
  on conflict (name) do update set cursor_at = greatest(public.billing_sweep_cursors.cursor_at, excluded.cursor_at), updated_at = now();
$$;

-- Retención: avisos resueltos a los 90 días; anomalías resueltas al año. En lotes acotados (no bloquea la tabla).
create or replace function public.billing_purge_retention(p_limit int)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_events int;
  v_recs int;
begin
  with doomed as (
    select e.id from public.billing_webhook_events e
     where e.purge_after < now() and e.status in ('processed', 'ignored', 'dead')
     order by e.purge_after limit greatest(1, least(p_limit, 5000))
  ), del as (delete from public.billing_webhook_events e using doomed d where e.id = d.id returning 1)
  select count(*) into v_events from del;

  with doomed as (
    select r.id from public.billing_reconciliations r
     where r.status = 'resolved' and r.resolved_at < now() - interval '365 days'
     order by r.resolved_at limit greatest(1, least(p_limit, 5000))
  ), del as (delete from public.billing_reconciliations r using doomed d where r.id = d.id returning 1)
  select count(*) into v_recs from del;

  return jsonb_build_object('events', v_events, 'reconciliations', v_recs);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos: SÓLO `service_role`.
-- ---------------------------------------------------------------------------
revoke all on function public.billing_ensure_account(uuid) from public, anon, authenticated;
revoke all on function public.billing_get_subscriptions(uuid[]) from public, anon, authenticated;
revoke all on function public.billing_resolve_subscribers(text[]) from public, anon, authenticated;
revoke all on function public.billing_owner_executions(uuid[], int) from public, anon, authenticated;
revoke all on function public.billing_due_subscriptions(timestamptz, timestamptz, uuid, int) from public, anon, authenticated;
revoke all on function public.billing_ingest_webhook_events(jsonb) from public, anon, authenticated;
revoke all on function public.billing_claim_events(int, int, text, int) from public, anon, authenticated;
revoke all on function public.billing_commit_batch(jsonb) from public, anon, authenticated;
revoke all on function public.billing_open_checkout_attempt(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_complete_checkout_attempt(uuid, text, text) from public, anon, authenticated;
revoke all on function public.billing_fail_checkout_attempt(uuid) from public, anon, authenticated;
revoke all on function public.billing_sweep_cursor_get(text) from public, anon, authenticated;
revoke all on function public.billing_sweep_cursor_set(text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_purge_retention(int) from public, anon, authenticated;
revoke all on function public.billing_check_amount_vs_catalog() from public, anon, authenticated;
revoke all on function public.billing_check_subscription_backed_by_payment() from public, anon, authenticated;
revoke all on function public.billing_enforce_version_bump() from public, anon, authenticated;
revoke all on function public.billing_forbid_owner_change() from public, anon, authenticated;

grant execute on function public.billing_ensure_account(uuid) to service_role;
grant execute on function public.billing_get_subscriptions(uuid[]) to service_role;
grant execute on function public.billing_resolve_subscribers(text[]) to service_role;
grant execute on function public.billing_owner_executions(uuid[], int) to service_role;
grant execute on function public.billing_due_subscriptions(timestamptz, timestamptz, uuid, int) to service_role;
grant execute on function public.billing_ingest_webhook_events(jsonb) to service_role;
grant execute on function public.billing_claim_events(int, int, text, int) to service_role;
grant execute on function public.billing_commit_batch(jsonb) to service_role;
grant execute on function public.billing_open_checkout_attempt(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.billing_complete_checkout_attempt(uuid, text, text) to service_role;
grant execute on function public.billing_fail_checkout_attempt(uuid) to service_role;
grant execute on function public.billing_sweep_cursor_get(text) to service_role;
grant execute on function public.billing_sweep_cursor_set(text, timestamptz) to service_role;
grant execute on function public.billing_purge_retention(int) to service_role;
