-- TeacherFlow Web — Fase 1: perfil de profesora, recargos, plan 50/30/20 y
-- reportes generados.
--
-- IMPORTANTE: `active_sessions` y `cloud_backups` YA EXISTEN en este mismo
-- proyecto Supabase (creadas por la app móvil — ver
-- supabase/migrations/20260715120000_cloud_backups.sql y
-- 20260716120000_fix_cloud_backup_upload.sql en el repo móvil, y las RPC
-- transfer_active_session/touch_active_session/end_active_session/
-- delete_own_account). Esta migración NUNCA las toca ni las redefine — son
-- infraestructura compartida real, no un fixture a recrear.

create table if not exists public.teacher_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  completed_tutorial_version int,
  tutorial_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.teacher_profiles is 'Espeja TeacherProfile — datos de perfil propios de la app, no cubiertos por auth.users.';
drop trigger if exists set_updated_at on public.teacher_profiles;
create trigger set_updated_at before update on public.teacher_profiles
  for each row execute function public.set_updated_at();
alter table public.teacher_profiles enable row level security;
drop policy if exists teacher_profiles_owner_all on public.teacher_profiles;
create policy teacher_profiles_owner_all on public.teacher_profiles
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Recargos — espeja SurchargeSettings (un documento por profesor).
-- ---------------------------------------------------------------------------

create table if not exists public.surcharge_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  grace_day smallint not null default 10 check (grace_day between 1 and 31),
  first_late_day smallint not null default 11 check (first_late_day between 1 and 31),
  first_late_percentage smallint not null default 10 check (first_late_percentage >= 0),
  second_late_day smallint not null default 19 check (second_late_day between 1 and 31),
  second_late_percentage smallint not null default 15 check (second_late_percentage >= 0),
  last_late_day smallint not null default 27 check (last_late_day between 1 and 31),
  last_late_percentage smallint not null default 20 check (last_late_percentage >= 0),
  -- pending_*: cambio programado, mismo criterio de vigencia diferida que
  -- TrainingBillingAgreement.pendingMonthlyFee — nunca pisa "current" hasta
  -- pending_effective_from.
  pending jsonb,
  pending_effective_from text, -- 'YYYY-MM'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint surcharge_settings_day_order check (
    grace_day < first_late_day and first_late_day < second_late_day and second_late_day < last_late_day
  )
);

comment on table public.surcharge_settings is 'Espeja SurchargeSettings — escalera de recargos por atraso (3 etapas + día de gracia), un documento por profesor.';
drop trigger if exists set_updated_at on public.surcharge_settings;
create trigger set_updated_at before update on public.surcharge_settings
  for each row execute function public.set_updated_at();
alter table public.surcharge_settings enable row level security;
drop policy if exists surcharge_settings_owner_all on public.surcharge_settings;
create policy surcharge_settings_owner_all on public.surcharge_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Plan 50/30/20 — espeja BudgetDistributionSettings (un documento por profesor).
-- ---------------------------------------------------------------------------

create table if not exists public.budget_distribution_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  needs_percent smallint not null default 50 check (needs_percent between 0 and 100),
  wants_percent smallint not null default 30 check (wants_percent between 0 and 100),
  savings_percent smallint not null default 20 check (savings_percent between 0 and 100),
  savings_goal_enabled boolean not null default false,
  savings_goal_target_amount numeric(12, 2),
  savings_goal_target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_distribution_settings_sum_100 check (needs_percent + wants_percent + savings_percent = 100)
);

comment on table public.budget_distribution_settings is 'Espeja BudgetDistributionSettings — preferencia 50/30/20 + meta de ahorro, un documento por profesor.';
drop trigger if exists set_updated_at on public.budget_distribution_settings;
create trigger set_updated_at before update on public.budget_distribution_settings
  for each row execute function public.set_updated_at();
alter table public.budget_distribution_settings enable row level security;
drop policy if exists budget_distribution_settings_owner_all on public.budget_distribution_settings;
create policy budget_distribution_settings_owner_all on public.budget_distribution_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Reportes PDF generados — espeja ReportRecord (reportes/types/index.ts).
-- `pdf_url` reemplaza `permanentPdfUri` (ruta local de archivo en el
-- móvil): en la web apunta a un objeto de Supabase Storage, nunca al disco
-- local del servidor.
-- ---------------------------------------------------------------------------

create table if not exists public.report_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  student_id uuid not null references public.students(id) on delete cascade,
  title text not null,
  selected_months text[] not null default '{}', -- 'YYYY-MM'[]
  period_start date not null,
  period_end date not null,
  generated_at timestamptz not null default now(),
  pdf_url text,
  snapshot jsonb not null,
  schema_version int not null default 1,
  constraint report_records_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.report_records is 'Espeja ReportRecord — historial de reportes PDF generados por alumno. snapshot conserva {data, narrativeText, includeClassDetail, selectedEvidenceIds, includePunctualitySummary?} tal cual, para poder re-renderizar sin recalcular.';
create index if not exists report_records_owner_idx on public.report_records (owner_id);
create index if not exists report_records_student_idx on public.report_records (student_id);
alter table public.report_records enable row level security;
drop policy if exists report_records_owner_all on public.report_records;
create policy report_records_owner_all on public.report_records
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
