-- TeacherFlow Web — Fase 1: dominio Cobros (núcleo).
-- Espeja src/features/payments/types/index.ts (PaymentCharge, Payment,
-- PaymentAllocation, PaymentAdjustment) — el motor de cálculo (recargos,
-- saldo, etapa de vencimiento) sigue siendo un motor PURO en TypeScript,
-- portado sin cambios de regla; estas tablas sólo persisten los mismos
-- cuatro hechos atómicos que ya persiste el móvil. Nunca se guarda saldo,
-- recargo ni estado calculado.
--
-- Idempotencia relacional (reemplaza el esquema de ids string-codificados
-- del móvil, ver paymentIdempotency.ts, por restricciones UNIQUE reales —
-- misma garantía, forma idiomática de Postgres):
--   - 'mensual'      -> unique (student_id, billing_period)
--   - 'por_clase'    -> unique (student_id, calendar_lesson_id) [saved_lesson_id]
--   - 'entrenamiento'-> unique (training_billing_agreement_id, student_id, billing_period)
--   - 'semanal'/'quincenal'/'paquete' -> billing_period ya es la clave de período real.

create table if not exists public.payment_charges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete restrict,
  charge_type text not null check (charge_type in ('mensual', 'por_clase', 'semanal', 'quincenal', 'paquete', 'entrenamiento')),
  original_amount numeric(12, 2) not null check (original_amount > 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  due_date date not null,
  billing_period text,
  -- saved_lesson_id: referencia al registro pedagógico (lesson_registrations,
  -- creada en 20260916121000_lesson_registrations.sql) — FK real agregada
  -- ahí, esa tabla todavía no existe en esta migración.
  saved_lesson_id uuid,
  package_id uuid,
  training_billing_agreement_id uuid,
  training_series_name text,
  calendar_lesson_id uuid references public.calendar_lessons(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  constraint payment_charges_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id),
  constraint payment_charges_billing_period_required check (
    charge_type not in ('mensual', 'semanal', 'quincenal') or billing_period is not null
  ),
  constraint payment_charges_saved_lesson_required check (
    charge_type <> 'por_clase' or saved_lesson_id is not null
  ),
  constraint payment_charges_package_required check (
    charge_type <> 'paquete' or package_id is not null
  ),
  constraint payment_charges_training_fields_required check (
    charge_type <> 'entrenamiento' or (training_billing_agreement_id is not null and billing_period is not null)
  )
);

comment on table public.payment_charges is
  'Obligación de cobro — espeja PaymentCharge. Nunca guarda saldo/recargo/estado (siempre derivado de payments+payment_allocations+payment_adjustments en el momento de la consulta, igual que el motor puro móvil).';

-- Idempotencia real por tipo, vía índices únicos parciales (equivalente
-- relacional exacto de paymentIdempotency.ts).
create unique index if not exists payment_charges_mensual_unique
  on public.payment_charges (student_id, billing_period)
  where charge_type = 'mensual';

create unique index if not exists payment_charges_semanal_unique
  on public.payment_charges (student_id, billing_period)
  where charge_type = 'semanal';

create unique index if not exists payment_charges_quincenal_unique
  on public.payment_charges (student_id, billing_period)
  where charge_type = 'quincenal';

create unique index if not exists payment_charges_por_clase_unique
  on public.payment_charges (student_id, saved_lesson_id)
  where charge_type = 'por_clase';

create unique index if not exists payment_charges_entrenamiento_unique
  on public.payment_charges (training_billing_agreement_id, student_id, billing_period)
  where charge_type = 'entrenamiento';

create index if not exists payment_charges_owner_idx on public.payment_charges (owner_id);
create index if not exists payment_charges_owner_student_idx on public.payment_charges (owner_id, student_id);
create index if not exists payment_charges_owner_due_idx on public.payment_charges (owner_id, due_date);
create index if not exists payment_charges_training_agreement_idx on public.payment_charges (training_billing_agreement_id);
create index if not exists payment_charges_package_idx on public.payment_charges (package_id);

alter table public.payment_charges enable row level security;

drop policy if exists payment_charges_owner_all on public.payment_charges;
create policy payment_charges_owner_all on public.payment_charges
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Pagos reales — espeja Payment. Nunca se borra: se anula (voided_at/void_reason).
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'ARS' check (currency = 'ARS'),
  method text not null check (method in ('efectivo', 'transferencia', 'otro')),
  paid_at date not null,
  recorded_at timestamptz not null default now(),
  notes text,
  voided_at timestamptz,
  void_reason text,
  replaces_payment_id uuid references public.payments(id) on delete set null,
  source text check (source is null or source = 'initial_student_setup'),
  created_at timestamptz not null default now(),
  constraint payments_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.payments is
  'Pago real declarado por la profesora — espeja Payment. paid_at nunca puede ser posterior a recorded_at::date (ver constraint), igual regla que el móvil.';

create index if not exists payments_owner_idx on public.payments (owner_id);
create index if not exists payments_owner_student_idx on public.payments (owner_id, student_id);

alter table public.payments enable row level security;

drop policy if exists payments_owner_all on public.payments;
create policy payments_owner_all on public.payments
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Asignaciones pago -> cargo — espeja PaymentAllocation.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  payment_id uuid not null references public.payments(id) on delete cascade,
  charge_id uuid not null references public.payment_charges(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint payment_allocations_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.payment_allocations is
  'Reparto de un Payment entre una o más PaymentCharge — espeja PaymentAllocation. Un pago puede repartirse; una obligación puede recibir aportes de varios pagos (pagos parciales).';

create index if not exists payment_allocations_owner_idx on public.payment_allocations (owner_id);
create index if not exists payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index if not exists payment_allocations_charge_idx on public.payment_allocations (charge_id);
create index if not exists payment_allocations_student_idx on public.payment_allocations (student_id);

alter table public.payment_allocations enable row level security;

drop policy if exists payment_allocations_owner_all on public.payment_allocations;
create policy payment_allocations_owner_all on public.payment_allocations
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Condonaciones de recargo — espeja PaymentAdjustment.
-- ---------------------------------------------------------------------------

create table if not exists public.payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  charge_id uuid not null references public.payment_charges(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  constraint payment_adjustments_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.payment_adjustments is
  'Condonación manual del recargo de UNA obligación puntual — espeja PaymentAdjustment. Mientras exista un ajuste vigente (no anulado) para un charge_id, el total adeudado se calcula siempre como original_amount, sin importar los días de atraso.';

create index if not exists payment_adjustments_owner_idx on public.payment_adjustments (owner_id);
create index if not exists payment_adjustments_charge_idx on public.payment_adjustments (charge_id);

alter table public.payment_adjustments enable row level security;

drop policy if exists payment_adjustments_owner_all on public.payment_adjustments;
create policy payment_adjustments_owner_all on public.payment_adjustments
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
