-- TeacherFlow Web — Fase 1: paquetes de clases.
-- Espeja PackagePurchase / PackageCreditMovement (payments/types/index.ts).

create table if not exists public.package_purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete restrict,
  included_classes int not null check (included_classes > 0),
  amount numeric(12, 2) not null check (amount > 0),
  valid_from date not null,
  valid_until date,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  constraint package_purchases_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.package_purchases is 'Espeja PackagePurchase. La compra en sí se cobra como payment_charges.charge_type = ''paquete'' (payment_charges.package_id referencia esta tabla).';
create index if not exists package_purchases_owner_idx on public.package_purchases (owner_id);
create index if not exists package_purchases_student_idx on public.package_purchases (student_id);
alter table public.package_purchases enable row level security;
drop policy if exists package_purchases_owner_all on public.package_purchases;
create policy package_purchases_owner_all on public.package_purchases
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table public.payment_charges
  drop constraint if exists payment_charges_package_fk;
alter table public.payment_charges
  add constraint payment_charges_package_fk
  foreign key (package_id) references public.package_purchases(id) on delete restrict;

create table if not exists public.package_credit_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  package_id uuid not null references public.package_purchases(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  movement_type text not null check (movement_type in ('consumo', 'ajuste_manual')),
  amount int not null,
  -- saved_lesson_id: FK real agregada en 20260916121000_lesson_registrations.sql.
  saved_lesson_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  constraint package_credit_movements_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id),
  constraint package_credit_movements_consumo_requires_lesson check (
    movement_type <> 'consumo' or saved_lesson_id is not null
  ),
  constraint package_credit_movements_ajuste_requires_reason check (
    movement_type <> 'ajuste_manual' or reason is not null
  )
);

comment on table public.package_credit_movements is
  'Espeja PackageCreditMovement. Idempotencia real: unique (package_id, saved_lesson_id) para movement_type=''consumo'' — nunca descuenta dos créditos por la misma clase dictada, igual regla que el móvil.';

create unique index if not exists package_credit_movements_consumo_unique
  on public.package_credit_movements (package_id, saved_lesson_id)
  where movement_type = 'consumo';

create index if not exists package_credit_movements_owner_idx on public.package_credit_movements (owner_id);
create index if not exists package_credit_movements_package_idx on public.package_credit_movements (package_id);
alter table public.package_credit_movements enable row level security;
drop policy if exists package_credit_movements_owner_all on public.package_credit_movements;
create policy package_credit_movements_owner_all on public.package_credit_movements
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
