-- TeacherFlow Web — Fase 1: cobro de entrenamiento.
-- Espeja TrainingBillingAgreement (payments/types/index.ts) y
-- PendingTrainingBillingOperation (payments/hooks/pendingTrainingBillingOperationsStore.ts).

create table if not exists public.training_billing_agreements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  monthly_fee numeric(12, 2) not null check (monthly_fee > 0),
  pending_monthly_fee numeric(12, 2),
  pending_monthly_fee_effective_from text, -- 'YYYY-MM'
  start_period text not null, -- 'YYYY-MM'
  created_at timestamptz not null default now(),
  constraint training_billing_agreements_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.training_billing_agreements is
  'Espeja TrainingBillingAgreement — configuración financiera de UNA serie de entrenamiento. "Finalizar entrenamiento" reutiliza recurrence_rules.status/end_date, nunca un campo propio acá (mismo criterio que el móvil).';

create index if not exists training_billing_agreements_owner_idx on public.training_billing_agreements (owner_id);

alter table public.training_billing_agreements enable row level security;

drop policy if exists training_billing_agreements_owner_all on public.training_billing_agreements;
create policy training_billing_agreements_owner_all on public.training_billing_agreements
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Ahora que training_billing_agreements existe, se agrega la FK real
-- diferida desde recurrence_rules (creada en 20260916120200_calendar.sql
-- con la columna, sin la referencia) y desde payment_charges (creada en
-- 20260916120400_payments_core.sql).
alter table public.recurrence_rules
  drop constraint if exists recurrence_rules_training_billing_agreement_fk;
alter table public.recurrence_rules
  add constraint recurrence_rules_training_billing_agreement_fk
  foreign key (training_billing_agreement_id)
  references public.training_billing_agreements(id) on delete set null;

alter table public.payment_charges
  drop constraint if exists payment_charges_training_billing_agreement_fk;
alter table public.payment_charges
  add constraint payment_charges_training_billing_agreement_fk
  foreign key (training_billing_agreement_id)
  references public.training_billing_agreements(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Diario durable de operaciones financieras pendientes — espeja
-- PendingTrainingBillingOperation. Es la "libreta" de recuperación del
-- coordinador (runTrainingBillingConfiguration/reconcileTrainingCharges,
-- portados a Fase 5): registra la intención ANTES de escribir el acuerdo,
-- para poder rehacer la operación completa si el proceso se interrumpe a
-- mitad de camino. jsonb para los sub-planes (newRule/extraRulePatch/
-- splitPlan) — misma forma exacta que el móvil, nunca una reimplementación
-- paralela de esos campos.
-- ---------------------------------------------------------------------------

create table if not exists public.pending_training_billing_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- operation_id: determinístico por el llamador (ver comentario de
  -- PendingTrainingBillingOperation.operationId) — la identidad real de la
  -- operación pendiente, no el id de fila.
  operation_id text not null,
  kind text not null check (kind in ('create_series', 'convert_series', 'split_this_and_future')),
  agreement jsonb not null,
  new_rule jsonb,
  extra_rule_patch jsonb,
  split_plan jsonb,
  recurrence_ids_to_link text[] not null default '{}',
  expected_charge_ids text[] not null default '{}',
  start_period text not null,
  end_period text not null,
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  constraint pending_training_billing_operations_unique unique (owner_id, operation_id)
);

comment on table public.pending_training_billing_operations is
  'Espeja PendingTrainingBillingOperation — diario durable para recuperar una operación financiera de entrenamiento interrumpida. Se borra únicamente cuando la operación completa (acuerdo + vínculo + cargos) queda verificada, nunca antes.';

create index if not exists pending_training_billing_operations_owner_idx on public.pending_training_billing_operations (owner_id);

alter table public.pending_training_billing_operations enable row level security;

drop policy if exists pending_training_billing_operations_owner_all on public.pending_training_billing_operations;
create policy pending_training_billing_operations_owner_all on public.pending_training_billing_operations
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
