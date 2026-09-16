-- TeacherFlow Web — Fase 1: disponibilidad del profesor.
-- Espeja TeacherAvailability (calendar/types/teacherAvailability.ts) — un
-- único documento por profesor en el móvil (AsyncStorage
-- `@teacherflow/teacher_availability_v1`); acá, una única fila por
-- owner_id. weekly_blocks/exceptions se guardan como jsonb (arrays de
-- WeeklyAvailabilityBlock/AvailabilityException) para poder reutilizar sin
-- reescribir el motor puro de conflictos/disponibilidad ya escrito en
-- TypeScript (teacherAvailabilityEngine.ts) contra la misma forma exacta.

create table if not exists public.teacher_availability (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  weekly_blocks jsonb not null default '[]'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.teacher_availability is
  'Espeja TeacherAvailability — un documento por profesor (owner_id es la PK, no hay múltiples filas). weekly_blocks/exceptions son WeeklyAvailabilityBlock[]/AvailabilityException[] tal cual, en jsonb.';

drop trigger if exists set_updated_at on public.teacher_availability;
create trigger set_updated_at before update on public.teacher_availability
  for each row execute function public.set_updated_at();

alter table public.teacher_availability enable row level security;

drop policy if exists teacher_availability_owner_all on public.teacher_availability;
create policy teacher_availability_owner_all on public.teacher_availability
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
