-- M1 — Facturación: esquema base. ADITIVO e IDEMPOTENTE: sólo crea objetos nuevos (`billing_*`), no toca ninguna tabla, función ni
-- política existente, y se puede re-ejecutar sin error. NO activa nada: con BILLING_ENABLED y BILLING_ENFORCEMENT_ENABLED apagados
-- (el estado de Production) la aplicación no lee ni escribe estas tablas.
--
-- Principios (ver docs/billing/M1_ARQUITECTURA.md):
--  * El navegador nunca decide si una cuenta está paga: la propietaria sólo LEE su estado y sus períodos (RLS + privilegios por
--    columna). Toda escritura la hace el servidor con la clave de servicio (`service_role`); `anon` no tiene ningún acceso.
--  * Importes, moneda y plan se validan SIEMPRE contra `billing_plans` (espejo del catálogo del servidor): un trigger rechaza cualquier
--    fila cuyo importe o moneda no coincida con el precio completo del plan.
--  * Nunca se guardan tarjetas, CVC, datos bancarios, tokens ni secretos. De un aviso del proveedor sólo se conservan campos
--    normalizados y un hash (límite de tamaño por CHECK), con retención definida (`purge_after`).
--  * Una cuenta no puede quedar en un estado con período pagado sin un período registrado que lo respalde (trigger).
--  * Si se elimina la cuenta (`delete_own_account`), todo lo suyo se elimina en cascada; los avisos y las anomalías conservan sólo
--    metadatos sin datos personales y pierden la referencia a la cuenta.

-- ---------------------------------------------------------------------------
-- Catálogo de planes (espejo del servidor: lib/billing/plans.ts). Un precio nuevo es un CÓDIGO nuevo (`..._v2`); jamás se edita.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plans (
  code text primary key check (code ~ '^tf_[a-z]+_ars_v[0-9]+$'),
  name text not null,
  currency text not null check (currency = 'ARS'),
  amount_minor bigint not null check (amount_minor > 0),
  interval_months int not null check (interval_months in (1, 3, 6, 12)),
  months_of_access int not null,
  provider_interval text not null check (provider_interval in ('1m', '3m', '6m', '1y')),
  active boolean not null default true,
  price_version int not null check (price_version >= 1),
  created_at timestamptz not null default now(),
  constraint billing_plans_access_matches_interval check (months_of_access = interval_months)
);

comment on table public.billing_plans is 'Espejo del catálogo autoritativo de planes (lib/billing/plans.ts). Importe en centavos de peso. Sólo el servidor lo lee.';

insert into public.billing_plans (code, name, currency, amount_minor, interval_months, months_of_access, provider_interval, active, price_version) values
  ('tf_monthly_ars_v1',    'Mensual',    'ARS',  2490000,  1,  1, '1m', true, 1),
  ('tf_quarterly_ars_v1',  'Trimestral', 'ARS',  6990000,  3,  3, '3m', true, 1),
  ('tf_semiannual_ars_v1', 'Semestral',  'ARS', 13390000,  6,  6, '6m', true, 1),
  ('tf_annual_ars_v1',     'Anual',      'ARS', 24900000, 12, 12, '1y', true, 1)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Configuración única de facturación (corte de «cuentas actuales»).
-- ---------------------------------------------------------------------------
create table if not exists public.billing_settings (
  id boolean primary key default true check (id),
  -- Toda cuenta creada hasta este instante es `grandfathered` (no se bloquea). Se fija UNA vez, al aplicar esta migración.
  grandfather_cutoff timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Suscripción actual de cada propietaria (una fila por cuenta).
-- ---------------------------------------------------------------------------
create table if not exists public.billing_subscriptions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('grandfathered', 'pending', 'active', 'past_due', 'grace_period', 'limited', 'cancel_at_period_end', 'canceled', 'expired')),
  grandfathered boolean not null default false,
  provider text not null default 'mobbex' check (provider in ('mobbex', 'fake')),
  -- Referencia propia y opaca que se envía al proveedor como referencia del suscriptor (sin datos personales). Única.
  provider_reference text not null unique check (provider_reference ~ '^tfs_[0-9a-f]{32}$'),
  provider_subscriber_uid text unique check (provider_subscriber_uid is null or length(provider_subscriber_uid) <= 128),
  plan_code text references public.billing_plans(code),
  pending_plan_code text references public.billing_plans(code),
  current_period_start timestamptz,
  current_period_end timestamptz,
  renewal_rejected_due_at timestamptz,
  grace_ends_at timestamptz,
  cancel_requested_at timestamptz,
  provider_ended_at timestamptz,
  -- Instante en que la cuenta volvió a empezar (nuevo intento de pago tras cancelar o expirar): el período anterior ya no cuenta.
  restarted_at timestamptz,
  -- Próximo instante en que el estado puede cambiar sólo por el reloj; índice parcial para barrer únicamente lo que vence.
  next_check_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscriptions_period_order check (current_period_start is null or current_period_end is null or current_period_end > current_period_start),
  constraint billing_subscriptions_paid_states_have_period check (
    status not in ('active', 'past_due', 'grace_period', 'limited', 'cancel_at_period_end') or (current_period_end is not null and plan_code is not null)
  )
);

comment on table public.billing_subscriptions is 'Estado de suscripción de cada propietaria. Lectura propia (RLS); escritura sólo del servidor.';
create index if not exists billing_subscriptions_next_check_idx on public.billing_subscriptions (next_check_at, owner_id) where next_check_at is not null;

-- ---------------------------------------------------------------------------
-- Cobros informados por el proveedor (uno por ejecución; un reintento actualiza la misma fila).
-- ---------------------------------------------------------------------------
create table if not exists public.billing_executions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.billing_subscriptions(owner_id) on delete cascade,
  provider text not null check (provider in ('mobbex', 'fake')),
  execution_uid text not null check (length(execution_uid) between 1 and 128),
  provider_payment_id text check (provider_payment_id is null or length(provider_payment_id) <= 128),
  outcome text not null check (outcome in ('approved', 'rejected')),
  plan_code text not null references public.billing_plans(code),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'ARS'),
  due_at timestamptz not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_executions_provider_uid_unique unique (provider, execution_uid)
);

create index if not exists billing_executions_owner_due_idx on public.billing_executions (owner_id, due_at desc);

-- ---------------------------------------------------------------------------
-- Historial de períodos pagados (derivado de los cobros aprobados; una fila por ejecución aprobada).
-- ---------------------------------------------------------------------------
create table if not exists public.billing_periods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.billing_subscriptions(owner_id) on delete cascade,
  provider text not null check (provider in ('mobbex', 'fake')),
  execution_uid text not null check (length(execution_uid) between 1 and 128),
  plan_code text not null references public.billing_plans(code),
  price_version int not null check (price_version >= 1),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'ARS'),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_periods_order check (period_end > period_start),
  constraint billing_periods_provider_uid_unique unique (provider, execution_uid)
);

create index if not exists billing_periods_owner_end_idx on public.billing_periods (owner_id, period_end desc);

-- ---------------------------------------------------------------------------
-- Intentos de checkout (importe y plan los fija el servidor; uno solo abierto por cuenta).
-- ---------------------------------------------------------------------------
create table if not exists public.billing_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.billing_subscriptions(owner_id) on delete cascade,
  plan_code text not null references public.billing_plans(code),
  price_version int not null check (price_version >= 1),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'ARS'),
  provider text not null check (provider in ('mobbex', 'fake')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  status text not null default 'open' check (status in ('open', 'completed', 'expired', 'failed', 'superseded')),
  provider_checkout_uid text check (provider_checkout_uid is null or length(provider_checkout_uid) <= 128),
  provider_subscriber_uid text check (provider_subscriber_uid is null or length(provider_subscriber_uid) <= 128),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_checkout_attempts_owner_key_unique unique (owner_id, idempotency_key)
);

-- Dos pestañas (o un doble clic) nunca producen dos intentos abiertos.
create unique index if not exists billing_checkout_attempts_one_open_idx on public.billing_checkout_attempts (owner_id) where status = 'open';
create index if not exists billing_checkout_attempts_owner_created_idx on public.billing_checkout_attempts (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cambios de plan, cancelaciones y reactivaciones (historial; nada se borra al cancelar).
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plan_changes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.billing_subscriptions(owner_id) on delete cascade,
  kind text not null check (kind in ('plan_change', 'cancel', 'reactivate')),
  from_plan_code text references public.billing_plans(code),
  to_plan_code text references public.billing_plans(code),
  effective_at timestamptz,
  status text not null check (status in ('scheduled', 'applied', 'superseded', 'canceled', 'recorded')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  created_at timestamptz not null default now(),
  constraint billing_plan_changes_owner_key_unique unique (owner_id, idempotency_key)
);

-- Un solo cambio de plan programado por cuenta: cambiar de plan dos veces seguidas reemplaza al anterior, no lo duplica.
create unique index if not exists billing_plan_changes_one_scheduled_idx on public.billing_plan_changes (owner_id) where kind = 'plan_change' and status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Avisos del proveedor (idempotentes por identidad semántica). SIN cuerpo crudo: sólo campos normalizados y un hash.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_webhook_events (
  id bigint generated always as identity primary key,
  dedup_key text not null unique check (dedup_key ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('mobbex', 'fake')),
  event_type text not null check (event_type in ('subscription:execution', 'subscription:registration', 'subscription:change_source', 'subscription:subscriber:suspended', 'subscription:subscriber:active', 'checkout', 'other')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  -- Sólo identificadores, importes, moneda, estado y fechas (ver lib/billing/providers/mobbex-normalize.ts). Tamaño acotado: no es
  -- un lugar para guardar el payload ni datos personales.
  normalized jsonb not null check (octet_length(normalized::text) <= 4096),
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed', 'dead')),
  attempts int not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  locked_by text check (locked_by is null or length(locked_by) <= 64),
  next_attempt_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  result text check (result is null or length(result) <= 80),
  owner_id uuid references auth.users(id) on delete set null,
  -- Retención definida: los avisos ya resueltos se purgan a los 90 días.
  purge_after timestamptz not null default (now() + interval '90 days')
);

create index if not exists billing_webhook_events_claim_idx on public.billing_webhook_events (next_attempt_at, id) where status in ('received', 'failed');
create index if not exists billing_webhook_events_lease_idx on public.billing_webhook_events (locked_until) where status = 'processing';
create index if not exists billing_webhook_events_purge_idx on public.billing_webhook_events (purge_after) where status in ('processed', 'ignored', 'dead');

-- ---------------------------------------------------------------------------
-- Conciliación: todo lo que no cierra (referencia desconocida, importe distinto, pago tras cancelar…) queda registrado para revisión.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_reconciliations (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('unknown_reference', 'owner_mismatch', 'subscriber_mismatch', 'missing_execution', 'missing_due_date', 'amount_mismatch', 'currency_mismatch', 'unknown_plan', 'inactive_plan', 'plan_not_expected', 'refund_review', 'paid_after_cancel', 'impossible_transition', 'provider_unreachable')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  owner_id uuid references auth.users(id) on delete set null,
  dedupe_key text not null check (length(dedupe_key) <= 200),
  detail jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 1024),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists billing_reconciliations_open_dedupe_idx on public.billing_reconciliations (dedupe_key) where status = 'open';
create index if not exists billing_reconciliations_status_created_idx on public.billing_reconciliations (status, created_at);

-- Cursor del barrido periódico contra el proveedor.
create table if not exists public.billing_sweep_cursors (
  name text primary key check (length(name) <= 64),
  cursor_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers de integridad
-- ---------------------------------------------------------------------------

-- Importe y moneda SIEMPRE iguales al precio completo del plan en el catálogo de la base.
create or replace function public.billing_check_amount_vs_catalog()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_amount bigint;
  v_version int;
begin
  select p.amount_minor, p.price_version into v_amount, v_version from public.billing_plans p where p.code = new.plan_code;
  if v_amount is null or new.amount_minor <> v_amount or new.currency <> 'ARS' then
    raise exception 'billing_amount_mismatch' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) ? 'price_version') and (to_jsonb(new) ->> 'price_version')::int <> v_version then
    raise exception 'billing_price_version_mismatch' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Una cuenta en un estado con período pagado exige un período registrado que termine exactamente donde dice la suscripción.
create or replace function public.billing_check_subscription_backed_by_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('active', 'past_due', 'grace_period', 'limited', 'cancel_at_period_end') then
    if not exists (select 1 from public.billing_periods p where p.owner_id = new.owner_id and p.period_end = new.current_period_end) then
      raise exception 'billing_period_not_backed_by_payment' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Toda escritura de una suscripción sube la versión en uno (control optimista; un UPDATE directo que no la suba se rechaza).
create or replace function public.billing_enforce_version_bump()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'billing_version_not_bumped' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Importe/propietaria de un período o cobro ya registrado no se reescriben con otra propietaria (no se «roba» una ejecución).
create or replace function public.billing_forbid_owner_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'billing_owner_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_executions_catalog on public.billing_executions;
create trigger billing_executions_catalog before insert or update on public.billing_executions for each row execute function public.billing_check_amount_vs_catalog();
drop trigger if exists billing_periods_catalog on public.billing_periods;
create trigger billing_periods_catalog before insert or update on public.billing_periods for each row execute function public.billing_check_amount_vs_catalog();
drop trigger if exists billing_checkout_attempts_catalog on public.billing_checkout_attempts;
create trigger billing_checkout_attempts_catalog before insert or update on public.billing_checkout_attempts for each row execute function public.billing_check_amount_vs_catalog();

drop trigger if exists billing_subscriptions_backed on public.billing_subscriptions;
create trigger billing_subscriptions_backed before insert or update on public.billing_subscriptions for each row execute function public.billing_check_subscription_backed_by_payment();
drop trigger if exists billing_subscriptions_version on public.billing_subscriptions;
create trigger billing_subscriptions_version before update on public.billing_subscriptions for each row execute function public.billing_enforce_version_bump();
drop trigger if exists billing_executions_owner on public.billing_executions;
create trigger billing_executions_owner before update on public.billing_executions for each row execute function public.billing_forbid_owner_change();
drop trigger if exists billing_periods_owner on public.billing_periods;
create trigger billing_periods_owner before update on public.billing_periods for each row execute function public.billing_forbid_owner_change();

drop trigger if exists set_updated_at on public.billing_subscriptions;
create trigger set_updated_at before update on public.billing_subscriptions for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.billing_executions;
create trigger set_updated_at before update on public.billing_executions for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.billing_periods;
create trigger set_updated_at before update on public.billing_periods for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.billing_checkout_attempts;
create trigger set_updated_at before update on public.billing_checkout_attempts for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS y privilegios: la propietaria sólo LEE su estado y sus períodos; el resto es exclusivo del servidor. `anon` no tiene nada.
-- ---------------------------------------------------------------------------
alter table public.billing_plans enable row level security;
alter table public.billing_settings enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_executions enable row level security;
alter table public.billing_periods enable row level security;
alter table public.billing_checkout_attempts enable row level security;
alter table public.billing_plan_changes enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_reconciliations enable row level security;
alter table public.billing_sweep_cursors enable row level security;

revoke all on table public.billing_plans, public.billing_settings, public.billing_subscriptions, public.billing_executions, public.billing_periods,
  public.billing_checkout_attempts, public.billing_plan_changes, public.billing_webhook_events, public.billing_reconciliations, public.billing_sweep_cursors
  from public, anon, authenticated;

grant select, insert, update, delete on table public.billing_plans, public.billing_settings, public.billing_subscriptions, public.billing_executions, public.billing_periods,
  public.billing_checkout_attempts, public.billing_plan_changes, public.billing_webhook_events, public.billing_reconciliations, public.billing_sweep_cursors
  to service_role;

-- Lectura propia, sólo columnas sin identificadores del proveedor (la web debe pedir columnas explícitas, nunca `select *`).
grant select (owner_id, status, grandfathered, plan_code, pending_plan_code, current_period_start, current_period_end, grace_ends_at, cancel_requested_at, created_at, updated_at)
  on public.billing_subscriptions to authenticated;
grant select (owner_id, plan_code, amount_minor, currency, period_start, period_end, created_at) on public.billing_periods to authenticated;

drop policy if exists billing_subscriptions_owner_select on public.billing_subscriptions;
create policy billing_subscriptions_owner_select on public.billing_subscriptions for select to authenticated using (owner_id = auth.uid());
drop policy if exists billing_periods_owner_select on public.billing_periods;
create policy billing_periods_owner_select on public.billing_periods for select to authenticated using (owner_id = auth.uid());

-- Relleno de las cuentas EXISTENTES al aplicar esta migración: quedan `grandfathered` (acceso completo, sin cobro). Sólo escribe en
-- la tabla nueva. Las cuentas creadas después se crean bajo demanda (`billing_ensure_account`) como `pending`.
insert into public.billing_subscriptions (owner_id, status, grandfathered, provider_reference)
select u.id, 'grandfathered', true, 'tfs_' || replace(gen_random_uuid()::text, '-', '')
from auth.users u
on conflict (owner_id) do nothing;
