-- TeacherFlow Web — Fase 1: auditoría financiera.
-- Espeja MonthlyAmountCorrectionEntry, InitialPaidSurchargeCorrectionEntry
-- y FirstMonthProrationDecision (payments/types/index.ts). Las tres son
-- append-only: nunca se anulan ni se borran — una corrección nueva siempre
-- agrega una entrada nueva, igual criterio que el móvil.

create table if not exists public.monthly_amount_corrections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete cascade,
  billing_period text not null, -- YYYY-MM
  previous_amount numeric(12, 2) not null,
  new_amount numeric(12, 2) not null,
  changed_at timestamptz not null default now(),
  reason text not null,
  effective_from text check (effective_from is null or effective_from in ('this_month', 'next_month')),
  constraint monthly_amount_corrections_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.monthly_amount_corrections is 'Espeja MonthlyAmountCorrectionEntry — auditoría de correcciones del importe mensual de un alumno desde Cobros.';
create index if not exists monthly_amount_corrections_owner_idx on public.monthly_amount_corrections (owner_id);
create index if not exists monthly_amount_corrections_student_idx on public.monthly_amount_corrections (student_id);
alter table public.monthly_amount_corrections enable row level security;
drop policy if exists monthly_amount_corrections_owner_all on public.monthly_amount_corrections;
create policy monthly_amount_corrections_owner_all on public.monthly_amount_corrections
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.initial_paid_surcharge_corrections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete cascade,
  billing_period text not null,
  previous_surcharge_amount numeric(12, 2) not null,
  voided_payment_id uuid references public.payments(id) on delete set null,
  new_payment_id uuid references public.payments(id) on delete set null,
  corrected_at timestamptz not null default now(),
  reason text not null,
  constraint initial_paid_surcharge_corrections_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.initial_paid_surcharge_corrections is 'Espeja InitialPaidSurchargeCorrectionEntry — auditoría de correcciones de recargo por alta financiera de alumnos nuevos.';
create index if not exists initial_paid_surcharge_corrections_owner_idx on public.initial_paid_surcharge_corrections (owner_id);
create index if not exists initial_paid_surcharge_corrections_student_idx on public.initial_paid_surcharge_corrections (student_id);
alter table public.initial_paid_surcharge_corrections enable row level security;
drop policy if exists initial_paid_surcharge_corrections_owner_all on public.initial_paid_surcharge_corrections;
create policy initial_paid_surcharge_corrections_owner_all on public.initial_paid_surcharge_corrections
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.first_month_proration_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete cascade,
  billing_period text not null, -- YYYY-MM
  effective_join_date date not null,
  criterion text not null check (criterion in ('proportional', 'full', 'custom', 'no_charge')),
  classes_remaining int not null,
  classes_per_full_period int not null,
  permanent_monthly_amount numeric(12, 2) not null,
  charged_amount numeric(12, 2) not null,
  charge_id uuid references public.payment_charges(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz not null,
  source text check (source is null or source in ('manual', 'automatic')),
  recurrence_ids text[],
  series_pattern_snapshot jsonb,
  rule_version int,
  constraint first_month_proration_decisions_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id),
  constraint first_month_proration_decisions_charge_required check (
    criterion = 'no_charge' or charge_id is not null
  )
);

comment on table public.first_month_proration_decisions is
  'Espeja FirstMonthProrationDecision — UNA entrada por (alumno, período), decisión del primer mes proporcional al incorporar un alumno a una serie. Nunca se anula ni se borra; una recalculación agrega una entrada nueva.';
create index if not exists first_month_proration_decisions_owner_idx on public.first_month_proration_decisions (owner_id);
create index if not exists first_month_proration_decisions_student_period_idx on public.first_month_proration_decisions (student_id, billing_period);
alter table public.first_month_proration_decisions enable row level security;
drop policy if exists first_month_proration_decisions_owner_all on public.first_month_proration_decisions;
create policy first_month_proration_decisions_owner_all on public.first_month_proration_decisions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
