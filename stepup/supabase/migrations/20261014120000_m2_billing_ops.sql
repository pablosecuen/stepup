-- M2 — Facturación: operación (ADITIVA e IDEMPOTENTE; depende de 20261014100000 y 20261014110000, que todavía NO se aplicaron en ningún entorno).
--
--   · avisos NO CONFIABLES: solo la pista mínima, deduplicada mientras el aviso anterior sigue pendiente (y con enfriamiento de 60 s);
--   · sondeo por suscriptor (tabla propia: no choca con el control optimista de versión de `billing_subscriptions`);
--   · devoluciones y contracargos como resultados de un cobro (`refunded`, `chargeback`), con período anulado (no borrado);
--   · registro fiscal mínimo y SEUDONIMIZADO que sobrevive a la eliminación de la cuenta (10 años);
--   · resolución de suscriptores por referencia O por uid; estadísticas de cola sin recorridos completos; revisión manual.
--
-- Todas las funciones son INVOKER con `search_path = ''` y SÓLO `service_role` puede ejecutarlas.

-- ---------------------------------------------------------------------------
-- Columnas y restricciones nuevas
-- ---------------------------------------------------------------------------
alter table public.billing_subscriptions add column if not exists chargeback_at timestamptz;
-- Plan de la suscripción (plantilla) del proveedor a la que pertenece el suscriptor: es con la que se lo consulta, se lo cancela o se lo mueve.
-- Existe desde que se crea el suscriptor, aunque todavía no haya pagado (`plan_code` sigue null hasta el primer cobro).
alter table public.billing_subscriptions add column if not exists provider_plan_code text references public.billing_plans(code);
alter table public.billing_periods add column if not exists voided_at timestamptz;
alter table public.billing_checkout_attempts add column if not exists redirect_url text check (redirect_url is null or (length(redirect_url) <= 512 and redirect_url ~ '^https://'));
alter table public.billing_settings add column if not exists fiscal_salt text not null default replace(gen_random_uuid()::text, '-', '');

grant select (voided_at) on public.billing_periods to authenticated;

do $do$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where contype = 'c'
       and ((conrelid = 'public.billing_executions'::regclass and pg_get_constraintdef(oid) like '%outcome%')
         or (conrelid = 'public.billing_reconciliations'::regclass and pg_get_constraintdef(oid) like '%unknown_reference%'))
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end
$do$;

alter table public.billing_executions add constraint billing_executions_outcome_check check (outcome in ('approved', 'rejected', 'refunded', 'chargeback'));
alter table public.billing_reconciliations add constraint billing_reconciliations_kind_check check (kind in (
  'unknown_reference', 'owner_mismatch', 'subscriber_mismatch', 'missing_execution', 'missing_due_date', 'amount_mismatch', 'currency_mismatch',
  'unknown_plan', 'inactive_plan', 'plan_not_expected', 'refund_review', 'refund_applied', 'chargeback_review', 'paid_after_cancel',
  'impossible_transition', 'provider_unreachable', 'provider_state_mismatch', 'manual_outcome'));

-- Un período anulado (devolución o contracargo) deja de respaldar el estado de una cuenta.
create or replace function public.billing_check_subscription_backed_by_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('active', 'past_due', 'grace_period', 'limited', 'cancel_at_period_end') then
    if not exists (select 1 from public.billing_periods p where p.owner_id = new.owner_id and p.period_end = new.current_period_end and p.voided_at is null) then
      raise exception 'billing_period_not_backed_by_payment' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Jerarquía entre resultados de la MISMA ejecución con el mismo instante: un cobro confirmado no se anula por empate, una devolución posterior sí.
create or replace function public.billing_outcome_rank(p_outcome text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_outcome when 'rejected' then 0 when 'approved' then 1 when 'refunded' then 2 when 'chargeback' then 3 else -1 end;
$$;

-- ---------------------------------------------------------------------------
-- Avisos: la deduplicación ya no es eterna. Mientras el aviso anterior sigue pendiente (o llegó hace menos de 60 s) un repetido se
-- descarta; una vez procesado, un aviso nuevo del mismo pago vuelve a encolar (por ejemplo, una devolución posterior a la aprobación).
-- ---------------------------------------------------------------------------
do $do$
declare
  c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.billing_webhook_events'::regclass and contype = 'u' and pg_get_constraintdef(oid) like '%dedup_key%' loop
    execute format('alter table public.billing_webhook_events drop constraint %I', c.conname);
  end loop;
end
$do$;

create unique index if not exists billing_webhook_events_open_dedup_idx on public.billing_webhook_events (dedup_key) where status in ('received', 'processing', 'failed');
create index if not exists billing_webhook_events_dedup_recent_idx on public.billing_webhook_events (dedup_key, received_at desc);

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
    select distinct on (r.dedup_key) r.dedup_key, r.provider, r.event_type, r.payload_hash, r.normalized, r.received_at
      from jsonb_to_recordset(p_rows) as r (dedup_key text, provider text, event_type text, payload_hash text, normalized jsonb, received_at timestamptz)
     order by r.dedup_key, r.received_at desc nulls last
  ), fresh as (
    select i.* from input i
     where not exists (
       select 1 from public.billing_webhook_events e
        where e.dedup_key = i.dedup_key
          and (e.status in ('received', 'processing', 'failed') or e.received_at > now() - interval '60 seconds'))
  ), ins as (
    insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized, received_at)
    select f.dedup_key, f.provider, f.event_type, f.payload_hash, f.normalized, coalesce(f.received_at, now()) from fresh f
    on conflict (dedup_key) where status in ('received', 'processing', 'failed') do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_total - v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Suscriptores: resolución por referencia o por uid (una consulta por lote).
-- ---------------------------------------------------------------------------
drop function if exists public.billing_resolve_subscribers(text[]);
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

-- ---------------------------------------------------------------------------
-- Sondeo por suscriptor
-- ---------------------------------------------------------------------------
create table if not exists public.billing_poll_schedule (
  owner_id uuid primary key references public.billing_subscriptions(owner_id) on delete cascade,
  due_at timestamptz not null,
  failures int not null default 0 check (failures >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.billing_poll_schedule is 'Próxima consulta autenticada de cada suscriptor al proveedor. Sólo servidor.';
create index if not exists billing_poll_schedule_due_idx on public.billing_poll_schedule (due_at, owner_id);
alter table public.billing_poll_schedule enable row level security;
revoke all on table public.billing_poll_schedule from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_poll_schedule to service_role;

-- Reclama hasta `p_limit` suscriptores para sondear, con arrendamiento (se corre la próxima consulta `p_lease_seconds` hacia adelante:
-- si el proceso muere, vuelven a ser elegibles solos). Las cuentas nuevas abandonadas (sin intento de pago reciente) se descartan del
-- sondeo. `for update skip locked`: dos trabajadores jamás reciben al mismo suscriptor.
create or replace function public.billing_claim_polls(p_now timestamptz, p_limit int, p_lease_seconds int)
returns table (owner_id uuid)
language plpgsql
set search_path = ''
as $$
begin
  delete from public.billing_poll_schedule ps
   using public.billing_subscriptions s
   where ps.owner_id = s.owner_id and ps.due_at <= p_now
     and (s.provider_subscriber_uid is null
          or (s.status in ('pending', 'grandfathered')
              and not exists (select 1 from public.billing_checkout_attempts a where a.owner_id = s.owner_id and a.status in ('open', 'completed') and a.expires_at > p_now - interval '14 days')));

  return query
  with picked as (
    select ps.owner_id
      from public.billing_poll_schedule ps
     where ps.due_at <= p_now
     order by ps.due_at, ps.owner_id
     limit greatest(1, least(p_limit, 1000))
       for update skip locked
  ), leased as (
    update public.billing_poll_schedule ps
       set due_at = p_now + pg_catalog.make_interval(secs => greatest(p_lease_seconds, 30)), updated_at = now()
      from picked
     where ps.owner_id = picked.owner_id
    returning ps.owner_id as o
  )
  select l.o from leased l order by l.o;
end;
$$;

-- Resultado de cada sondeo: `next_at` null = ya no hace falta sondear; `failed` = el proveedor no respondió (reintento con espera exponencial
-- acotada a 6 h; tras 8 fallas seguidas queda una revisión abierta).
create or replace function public.billing_mark_polled(p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_done int;
  v_failed int;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'billing_invalid_batch' using errcode = 'invalid_parameter_value'; end if;

  delete from public.billing_poll_schedule ps
   using jsonb_to_recordset(p_items) as x (owner_id uuid, next_at timestamptz, failed boolean)
   where ps.owner_id = x.owner_id and x.next_at is null and not coalesce(x.failed, false);

  with upd as (
    update public.billing_poll_schedule ps
       set due_at = case when coalesce(x.failed, false)
                         then now() + pg_catalog.make_interval(secs => least(21600, 300 * (2 ^ least(ps.failures, 7))::int))
                         else x.next_at end,
           failures = case when coalesce(x.failed, false) then ps.failures + 1 else 0 end,
           updated_at = now()
      from jsonb_to_recordset(p_items) as x (owner_id uuid, next_at timestamptz, failed boolean)
     where ps.owner_id = x.owner_id and (x.next_at is not null or coalesce(x.failed, false))
    returning ps.owner_id, ps.failures, coalesce(x.failed, false) as failed
  ), stuck as (
    insert into public.billing_reconciliations (kind, owner_id, dedupe_key, detail)
    select 'provider_unreachable', u.owner_id, 'poll_stuck:' || u.owner_id::text, jsonb_build_object('failures', u.failures)
      from upd u where u.failed and u.failures >= 8
    on conflict (dedupe_key) where status = 'open' do nothing
    returning 1
  )
  select count(*) filter (where not u.failed), count(*) filter (where u.failed) into v_done, v_failed from upd u;
  return jsonb_build_object('rescheduled', coalesce(v_done, 0), 'failed', coalesce(v_failed, 0));
end;
$$;

-- Sondeo PRIORITARIO (conciliación pedida por el acceso o por un aviso): vence ahora, sólo para suscriptores del proveedor.
create or replace function public.billing_prioritize_polls(p_owner_ids uuid[])
returns int
language sql
set search_path = ''
as $$
  with up as (
    insert into public.billing_poll_schedule (owner_id, due_at)
    select s.owner_id, now() from public.billing_subscriptions s
     where s.owner_id = any (p_owner_ids) and s.provider_subscriber_uid is not null
    on conflict (owner_id) do update set due_at = least(public.billing_poll_schedule.due_at, excluded.due_at), updated_at = now()
    returning 1
  )
  select count(*)::int from up;
$$;

-- Al completar el intento de pago el suscriptor ya existe en el proveedor: se guarda su uid, el plan de su suscripción allá y el enlace donde carga
-- el medio de pago (un destino HTTPS del proveedor: permite reutilizar el mismo intento sin crear un segundo suscriptor) y empieza a sondearse
-- (primer sondeo en 5 minutos). Un suscriptor nuevo reemplaza al anterior SÓLO mientras la cuenta no tiene un período pagado.
drop function if exists public.billing_complete_checkout_attempt(uuid, text, text);
create or replace function public.billing_complete_checkout_attempt(p_attempt uuid, p_checkout_uid text, p_subscriber_uid text, p_redirect_url text)
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
  update public.billing_checkout_attempts a
     set status = 'completed', provider_checkout_uid = p_checkout_uid, provider_subscriber_uid = p_subscriber_uid, redirect_url = p_redirect_url
   where a.id = p_attempt;
  if p_subscriber_uid is not null then
    update public.billing_subscriptions s
       set provider_subscriber_uid = p_subscriber_uid,
           provider_plan_code = (select a.plan_code from public.billing_checkout_attempts a where a.id = p_attempt),
           version = s.version + 1
     where s.owner_id = v_owner and s.status in ('grandfathered', 'pending') and s.provider_subscriber_uid is distinct from p_subscriber_uid;
    insert into public.billing_poll_schedule (owner_id, due_at) values (v_owner, now() + interval '5 minutes')
    on conflict (owner_id) do update set due_at = least(public.billing_poll_schedule.due_at, excluded.due_at), updated_at = now();
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro fiscal mínimo y seudonimizado (10 años). SIN propietaria, SIN datos personales, SIN tarjeta, SIN cargas útiles: sobrevive a
-- la eliminación de la cuenta (no tiene clave foránea). La huella de la cuenta es SHA-256 con una sal que sólo conoce la base.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_fiscal_records (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('mobbex', 'fake')),
  operation_ref text not null check (length(operation_ref) between 1 and 128),
  owner_hash text not null check (owner_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'ARS'),
  status text not null check (status in ('approved', 'refunded', 'chargeback')),
  receipt_ref text check (receipt_ref is null or length(receipt_ref) <= 128),
  reconciliation_hash text not null check (reconciliation_hash ~ '^[0-9a-f]{64}$'),
  retain_until date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_fiscal_records_operation_unique unique (provider, operation_ref)
);
comment on table public.billing_fiscal_records is 'Registro fiscal mínimo y seudonimizado, conservado 10 años (ARCA). Sin datos personales ni propietaria.';
create index if not exists billing_fiscal_records_retain_idx on public.billing_fiscal_records (retain_until);
alter table public.billing_fiscal_records enable row level security;
revoke all on table public.billing_fiscal_records from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_fiscal_records to service_role;

create or replace function public.billing_capture_fiscal_record()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_salt text;
begin
  if new.outcome = 'rejected' then return new; end if; -- un cobro rechazado no es una operación fiscal
  select b.fiscal_salt into v_salt from public.billing_settings b where b.id;
  insert into public.billing_fiscal_records (provider, operation_ref, owner_hash, occurred_at, amount_minor, currency, status, receipt_ref, reconciliation_hash, retain_until)
  values (
    new.provider, new.execution_uid,
    encode(sha256(convert_to(coalesce(v_salt, '') || ':' || new.owner_id::text, 'UTF8')), 'hex'),
    new.occurred_at, new.amount_minor, new.currency, new.outcome, new.provider_payment_id,
    encode(sha256(convert_to(concat_ws('|', new.provider, new.execution_uid, new.outcome, new.amount_minor::text, new.currency, extract(epoch from new.occurred_at)::text), 'UTF8')), 'hex'),
    ((new.occurred_at at time zone 'UTC')::date + interval '10 years')::date)
  on conflict (provider, operation_ref) do update
     set status = excluded.status, occurred_at = excluded.occurred_at, receipt_ref = coalesce(excluded.receipt_ref, public.billing_fiscal_records.receipt_ref),
         reconciliation_hash = excluded.reconciliation_hash, retain_until = excluded.retain_until, updated_at = now();
  return new;
end;
$$;

drop trigger if exists billing_executions_fiscal on public.billing_executions;
create trigger billing_executions_fiscal after insert or update of outcome, occurred_at, provider_payment_id on public.billing_executions
  for each row execute function public.billing_capture_fiscal_record();

-- Único borrado del registro fiscal: lo que ya cumplió su plazo de conservación.
create or replace function public.billing_purge_fiscal_records(p_limit int)
returns int
language sql
set search_path = ''
as $$
  with doomed as (
    select f.id from public.billing_fiscal_records f where f.retain_until < current_date order by f.retain_until limit greatest(1, least(p_limit, 5000))
  ), del as (delete from public.billing_fiscal_records f using doomed d where f.id = d.id returning 1)
  select count(*)::int from del;
$$;

-- ---------------------------------------------------------------------------
-- Resultado manual conciliado (contracargo o devolución confirmados por quien opera el sistema fuera de la API). Sólo SUBE la jerarquía
-- del resultado de una ejecución EXISTENTE, deja una revisión abierta y pide recalcular la cuenta. Nunca crea un cobro.
-- ---------------------------------------------------------------------------
create or replace function public.billing_record_manual_outcome(p_owner uuid, p_execution_uid text, p_outcome text, p_occurred_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_exec public.billing_executions;
begin
  if p_outcome not in ('refunded', 'chargeback') then return jsonb_build_object('ok', false, 'reason', 'outcome_invalid'); end if;
  select * into v_exec from public.billing_executions e where e.owner_id = p_owner and e.execution_uid = p_execution_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'execution_not_found'); end if;
  if public.billing_outcome_rank(p_outcome) <= public.billing_outcome_rank(v_exec.outcome) then return jsonb_build_object('ok', true, 'changed', false); end if;

  update public.billing_executions e set outcome = p_outcome, occurred_at = greatest(e.occurred_at, coalesce(p_occurred_at, now())) where e.id = v_exec.id;
  insert into public.billing_reconciliations (kind, owner_id, dedupe_key, detail)
  values ('manual_outcome', p_owner, 'manual_outcome:' || p_execution_uid, jsonb_build_object('outcome', p_outcome))
  on conflict (dedupe_key) where status = 'open' do nothing;
  -- La cuenta se recalcula en el próximo barrido del reloj (con todos sus cobros guardados).
  update public.billing_subscriptions s set next_check_at = now(), version = s.version + 1 where s.owner_id = p_owner;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operación: colas, revisión y reintento de avisos muertos
-- ---------------------------------------------------------------------------
create or replace function public.billing_queue_stats()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pending_events', (select count(*) from (select 1 from public.billing_webhook_events e where e.status in ('received', 'failed') limit 10001) x),
    'processing_events', (select count(*) from (select 1 from public.billing_webhook_events e where e.status = 'processing' limit 10001) x),
    'oldest_pending_at', (select min(e.next_attempt_at) from public.billing_webhook_events e where e.status in ('received', 'failed')),
    'due_polls', (select count(*) from (select 1 from public.billing_poll_schedule ps where ps.due_at <= now() limit 10001) x),
    'due_clock', (select count(*) from (select 1 from public.billing_subscriptions s where s.next_check_at is not null and s.next_check_at <= now() limit 10001) x),
    'open_reviews', (select count(*) from (select 1 from public.billing_reconciliations r where r.status = 'open' limit 10001) x));
$$;

create or replace function public.billing_requeue_dead_events(p_ids bigint[])
returns int
language sql
set search_path = ''
as $$
  with up as (
    update public.billing_webhook_events e
       set status = 'received', attempts = 0, next_attempt_at = now(), locked_until = null, locked_by = null, result = null, processed_at = null
     where e.id = any (p_ids) and e.status = 'dead'
    returning 1
  )
  select count(*)::int from up;
$$;

create or replace function public.billing_resolve_reconciliations(p_ids bigint[])
returns int
language sql
set search_path = ''
as $$
  with up as (
    update public.billing_reconciliations r set status = 'resolved', resolved_at = now() where r.id = any (p_ids) and r.status = 'open' returning 1
  )
  select count(*)::int from up;
$$;

-- ---------------------------------------------------------------------------
-- Checkout (versión M2): devuelve el enlace ya creado del intento y los suscriptores de intentos reemplazados.
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
  v_stale jsonb := '[]'::jsonb;
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
        -- Suscriptores ya creados en el proveedor por intentos que se reemplazan: el servidor los cancela allá (nunca dos suscriptores con medio de pago).
        select coalesce(jsonb_agg(jsonb_build_object('uid', a.provider_subscriber_uid, 'plan_code', a.plan_code)), '[]'::jsonb) into v_stale
          from public.billing_checkout_attempts a
         where a.owner_id = p_owner and a.status in ('open', 'completed') and a.expires_at > now() and a.provider_subscriber_uid is not null;
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

  return jsonb_build_object('ok', true, 'created', v_created, 'superseded', v_superseded, 'stale', v_stale,
    'attempt', jsonb_build_object('id', v_attempt.id, 'owner_id', v_attempt.owner_id, 'plan_code', v_attempt.plan_code, 'price_version', v_attempt.price_version,
      'amount_minor', v_attempt.amount_minor, 'currency', v_attempt.currency, 'status', v_attempt.status, 'idempotency_key', v_attempt.idempotency_key, 'subscriber_reference', v_sub.provider_reference,
      'redirect_url', v_attempt.redirect_url, 'provider_subscriber_uid', v_attempt.provider_subscriber_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- Historial de la propietaria para la pantalla de facturación: períodos y cobros, SIN identificadores internos del proveedor.
-- ---------------------------------------------------------------------------
create or replace function public.billing_owner_history(p_owner uuid, p_limit int)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object('plan_code', x.plan_code, 'amount_minor', x.amount_minor, 'period_start', x.period_start, 'period_end', x.period_end, 'voided_at', x.voided_at) order by x.period_end desc)
        from (select p.plan_code, p.amount_minor, p.period_start, p.period_end, p.voided_at from public.billing_periods p where p.owner_id = p_owner order by p.period_end desc limit greatest(1, least(p_limit, 100))) x), '[]'::jsonb),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object('outcome', y.outcome, 'plan_code', y.plan_code, 'amount_minor', y.amount_minor, 'due_at', y.due_at, 'occurred_at', y.occurred_at) order by y.due_at desc)
        from (select e.outcome, e.plan_code, e.amount_minor, e.due_at, e.occurred_at from public.billing_executions e where e.owner_id = p_owner order by e.due_at desc limit greatest(1, least(p_limit, 100))) y), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Escritura por lote (versión M2): resultados con jerarquía (aprobado < devuelto < contracargo), períodos anulados y contracargo vigente.
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
       order by x.provider, x.execution_uid, x.occurred_at desc, public.billing_outcome_rank(x.outcome) desc
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
          or (excluded.occurred_at = public.billing_executions.occurred_at and public.billing_outcome_rank(excluded.outcome) > public.billing_outcome_rank(public.billing_executions.outcome)));

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
         period_end = excluded.period_end,
         voided_at = null
   where public.billing_periods.owner_id = excluded.owner_id;

  -- 2b) Períodos ANULADOS (la ejecución fue devuelta o contracargada): se conservan en el historial, pero dejan de respaldar el estado.
  update public.billing_periods bp
     set voided_at = now()
    from jsonb_to_recordset(coalesce(p -> 'voided_periods', '[]'::jsonb)) as v (owner_id uuid, provider text, execution_uid text)
   where bp.owner_id = v.owner_id and bp.provider = v.provider and bp.execution_uid = v.execution_uid and bp.voided_at is null;

  -- 3) Suscripciones: control optimista de versión.
  with input as (
    select * from jsonb_to_recordset(coalesce(p -> 'subscriptions', '[]'::jsonb)) as s (
      owner_id uuid, expected_version bigint, status text, grandfathered boolean, plan_code text, pending_plan_code text,
      current_period_start timestamptz, current_period_end timestamptz, renewal_rejected_due_at timestamptz, grace_ends_at timestamptz,
      cancel_requested_at timestamptz, provider_ended_at timestamptz, restarted_at timestamptz, chargeback_at timestamptz, provider_plan_code text, next_check_at timestamptz)
  ), upd as (
    update public.billing_subscriptions t
       set status = i.status, grandfathered = i.grandfathered, plan_code = i.plan_code, pending_plan_code = i.pending_plan_code,
           current_period_start = i.current_period_start, current_period_end = i.current_period_end,
           renewal_rejected_due_at = i.renewal_rejected_due_at, grace_ends_at = i.grace_ends_at,
           cancel_requested_at = i.cancel_requested_at, provider_ended_at = i.provider_ended_at, restarted_at = i.restarted_at, chargeback_at = i.chargeback_at, provider_plan_code = i.provider_plan_code,
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
-- Permisos: SÓLO `service_role`.
-- ---------------------------------------------------------------------------
revoke all on function public.billing_outcome_rank(text) from public, anon, authenticated;
grant execute on function public.billing_outcome_rank(text) to service_role;
revoke all on function public.billing_capture_fiscal_record() from public, anon, authenticated;
revoke all on function public.billing_resolve_subscribers(text[], text[]) from public, anon, authenticated;
revoke all on function public.billing_claim_polls(timestamptz, int, int) from public, anon, authenticated;
revoke all on function public.billing_mark_polled(jsonb) from public, anon, authenticated;
revoke all on function public.billing_prioritize_polls(uuid[]) from public, anon, authenticated;
revoke all on function public.billing_purge_fiscal_records(int) from public, anon, authenticated;
revoke all on function public.billing_record_manual_outcome(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_queue_stats() from public, anon, authenticated;
revoke all on function public.billing_owner_history(uuid, int) from public, anon, authenticated;
revoke all on function public.billing_requeue_dead_events(bigint[]) from public, anon, authenticated;
revoke all on function public.billing_resolve_reconciliations(bigint[]) from public, anon, authenticated;
revoke all on function public.billing_ingest_webhook_events(jsonb) from public, anon, authenticated;
revoke all on function public.billing_commit_batch(jsonb) from public, anon, authenticated;
revoke all on function public.billing_complete_checkout_attempt(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.billing_open_checkout_attempt(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_check_subscription_backed_by_payment() from public, anon, authenticated;

grant execute on function public.billing_resolve_subscribers(text[], text[]) to service_role;
grant execute on function public.billing_claim_polls(timestamptz, int, int) to service_role;
grant execute on function public.billing_mark_polled(jsonb) to service_role;
grant execute on function public.billing_prioritize_polls(uuid[]) to service_role;
grant execute on function public.billing_purge_fiscal_records(int) to service_role;
grant execute on function public.billing_record_manual_outcome(uuid, text, text, timestamptz) to service_role;
grant execute on function public.billing_queue_stats() to service_role;
grant execute on function public.billing_owner_history(uuid, int) to service_role;
grant execute on function public.billing_requeue_dead_events(bigint[]) to service_role;
grant execute on function public.billing_resolve_reconciliations(bigint[]) to service_role;
grant execute on function public.billing_ingest_webhook_events(jsonb) to service_role;
grant execute on function public.billing_commit_batch(jsonb) to service_role;
grant execute on function public.billing_complete_checkout_attempt(uuid, text, text, text) to service_role;
grant execute on function public.billing_open_checkout_attempt(uuid, text, text, text, timestamptz) to service_role;
