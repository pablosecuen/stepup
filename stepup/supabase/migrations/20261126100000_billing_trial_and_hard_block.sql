-- PRUEBA GRATUITA DE 15 DÍAS Y BLOQUEO TOTAL SIN GRACIA (condición comercial aprobada el 25/11/2026).
--
-- Qué agrega (idempotente; nunca edita una migración ya aplicada):
--   1. `billing_subscriptions.trial_started_at / trial_ends_at`: la prueba es una ventana de acceso ANTERIOR al primer cobro. Empieza cuando Rebill confirma la suscripción y
--      la tarjeta (pago aprobado de 0) y termina a las 00:00 de Argentina del día inicio + 15 (el primer cobro). Una vez guardada NO se puede borrar ni reiniciar (un disparador
--      conserva el valor original): es la marca de «prueba ya usada» que evita pruebas repetidas.
--   2. Una cuenta con estado de período puede apoyarse en la prueba (no sólo en un pago aprobado) para cumplir «período respaldado».
--   3. `billing_commit_batch` escribe los dos campos nuevos (resto idéntico).
--   4. Tipos de conciliación nuevos: `trial_schedule` (no se pudo fijar el primer cobro a las 00:00) y `trial_reused` (un segundo intento de prueba en la misma cuenta).
--   5. El espejo SQL del acceso (`tf_write_access`) deja de dar gracia: pasado el fin del período (o de la prueba) sin un pago aprobado, no se puede escribir.
-- No toca datos existentes: las cuentas `grandfathered` y los pagos siguen exactamente igual.

alter table public.billing_subscriptions add column if not exists trial_started_at timestamptz;
alter table public.billing_subscriptions add column if not exists trial_ends_at timestamptz;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_subscriptions_trial_order' and conrelid = 'public.billing_subscriptions'::regclass) then
    alter table public.billing_subscriptions add constraint billing_subscriptions_trial_order
      check ((trial_started_at is null and trial_ends_at is null) or (trial_started_at is not null and trial_ends_at is not null and trial_ends_at > trial_started_at));
  end if;
end;
$do$;

-- La prueba, una vez registrada, es inmutable (ni se borra ni se reinicia): conserva el valor original ante cualquier escritura posterior.
create or replace function public.billing_trial_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.trial_started_at is not null then
    new.trial_started_at := old.trial_started_at;
    new.trial_ends_at := old.trial_ends_at;
  end if;
  return new;
end;
$$;
drop trigger if exists billing_trial_immutable on public.billing_subscriptions;
create trigger billing_trial_immutable before update on public.billing_subscriptions for each row execute function public.billing_trial_immutable();
revoke all on function public.billing_trial_immutable() from public, anon, authenticated;

-- Una cuenta en un estado con período vigente exige un período pagado registrado O la prueba que termina exactamente donde dice la suscripción.
create or replace function public.billing_check_subscription_backed_by_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('active', 'past_due', 'grace_period', 'limited', 'cancel_at_period_end') then
    if not exists (select 1 from public.billing_periods p where p.owner_id = new.owner_id and p.period_end = new.current_period_end and p.voided_at is null)
       and not (new.trial_ends_at is not null and new.trial_ends_at = new.current_period_end) then
      raise exception 'billing_period_not_backed_by_payment' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

alter table public.billing_reconciliations drop constraint if exists billing_reconciliations_kind_check;
alter table public.billing_reconciliations add constraint billing_reconciliations_kind_check check (kind in (
  'unknown_reference', 'owner_mismatch', 'subscriber_mismatch', 'missing_execution', 'missing_due_date', 'amount_mismatch', 'currency_mismatch',
  'unknown_plan', 'inactive_plan', 'plan_not_expected', 'refund_review', 'refund_applied', 'chargeback_review', 'paid_after_cancel',
  'impossible_transition', 'provider_unreachable', 'provider_state_mismatch', 'manual_outcome', 'trial_schedule', 'trial_reused'));

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
      cancel_requested_at timestamptz, provider_ended_at timestamptz, restarted_at timestamptz, chargeback_at timestamptz, provider_plan_code text, next_check_at timestamptz,
      trial_started_at timestamptz, trial_ends_at timestamptz)
  ), upd as (
    update public.billing_subscriptions t
       set status = i.status, grandfathered = i.grandfathered, plan_code = i.plan_code, pending_plan_code = i.pending_plan_code,
           current_period_start = i.current_period_start, current_period_end = i.current_period_end,
           renewal_rejected_due_at = i.renewal_rejected_due_at, grace_ends_at = i.grace_ends_at,
           cancel_requested_at = i.cancel_requested_at, provider_ended_at = i.provider_ended_at, restarted_at = i.restarted_at, chargeback_at = i.chargeback_at, provider_plan_code = i.provider_plan_code,
           trial_started_at = i.trial_started_at, trial_ends_at = i.trial_ends_at,
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

revoke all on function public.billing_commit_batch(jsonb) from public, anon, authenticated;
grant execute on function public.billing_commit_batch(jsonb) to service_role;

-- Espejo SQL del acceso SIN gracia (ver lib/billing/ledger.ts: projectStatus + cancelAccessEnd y lib/billing/access.ts). Escribe sólo quien está en grandfathered, activa
-- (período pagado o prueba vigente) o cancelada con lo ya pagado por delante. Vencido el período (o la prueba) sin un pago aprobado: no.
create or replace function public.tf_write_access(p_owner uuid, p_now timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.billing_subscriptions;
  v_end timestamptz;
  v_cutoff timestamptz;
  v_created timestamptz;
  v_allowed boolean;
begin
  if p_owner is null then return false; end if;
  select * into s from public.billing_subscriptions b where b.owner_id = p_owner;
  if not found then
    select u.created_at into v_created from auth.users u where u.id = p_owner;
    select b.grandfather_cutoff into v_cutoff from public.billing_settings b where b.id;
    return v_created is not null and v_cutoff is not null and v_created <= v_cutoff;
  end if;
  v_end := case when s.current_period_end is not null and (s.restarted_at is null or s.current_period_end > s.restarted_at) then s.current_period_end end;
  if v_end is null then
    if s.cancel_requested_at is not null then return false; end if;
    if s.provider_ended_at is not null then return false; end if;
    return s.grandfathered;
  end if;
  if s.cancel_requested_at is not null then
    v_allowed := p_now < v_end;
  elsif p_now < v_end then
    v_allowed := true;
  else
    v_allowed := false; -- sin gracia: pasado el fin del período o de la prueba, sin pago aprobado, no hay acceso
  end if;
  if v_allowed and s.chargeback_at is not null and p_now >= s.chargeback_at then return false; end if;
  return v_allowed;
end;
$$;
revoke all on function public.tf_write_access(uuid, timestamptz) from public, anon, authenticated;
