-- TeacherFlow Web — Fase 1: dominio Calendario.
-- Espeja src/features/calendar/types/index.ts (RecurrenceRule, CalendarLesson,
-- CalendarLessonParticipant, RecurrenceException) de la app móvil — misma
-- fuente de verdad funcional. `students` debe existir antes que esta
-- migración (creada en 20260916120100_students.sql).
--
-- Todas las tablas usan uuid nativo como PK y guardan `owner_id` propio
-- (denormalizado) para que cada política RLS sea `owner_id = auth.uid()`
-- directo, sin joins — nunca deriva la propiedad indirectamente. Un id
-- textual legado (`legacy_mobile_id`) queda reservado, sin usarse todavía,
-- para el futuro importador de respaldo (Fase 9): permite mapear el
-- `recurrenceId`/`id` string que ya existe en TeacherFlowBackupV2 a esta
-- fila real sin reescribir el esquema más adelante.

create table if not exists public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  primary_student_id uuid references public.students(id) on delete set null,
  rule_type text not null check (rule_type in ('weekly', 'custom')),
  cycle_length_weeks smallint not null check (cycle_length_weeks in (1, 2, 3, 4)),
  weeks jsonb not null,
  modality text not null check (modality in ('presencial', 'online', 'mixta')),
  timezone text not null,
  start_date date not null,
  end_date date,
  status text not null check (status in ('active', 'paused', 'ended')),
  supersedes_recurrence_id uuid references public.recurrence_rules(id) on delete set null,
  superseded_by_recurrence_id uuid references public.recurrence_rules(id) on delete set null,
  effective_from_date date,
  class_title text,
  activity_kind text not null default 'class' check (activity_kind in ('class', 'training')),
  -- training_billing_agreement_id: agregado con su FK real en
  -- 20260916120500_training_billing.sql (esa tabla todavía no existe acá).
  training_billing_agreement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurrence_rules_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.recurrence_rules is
  'Serie de recurrencia — espeja RecurrenceRule (calendar/types/index.ts). weeks guarda RecurrenceWeek[] tal cual (jsonb) para poder reutilizar sin cambios el motor puro de generación de ocurrencias ya escrito en TypeScript.';

create index if not exists recurrence_rules_owner_idx on public.recurrence_rules (owner_id);
create index if not exists recurrence_rules_owner_status_idx on public.recurrence_rules (owner_id, status);
create index if not exists recurrence_rules_primary_student_idx on public.recurrence_rules (primary_student_id);
create index if not exists recurrence_rules_supersedes_idx on public.recurrence_rules (supersedes_recurrence_id);
create index if not exists recurrence_rules_training_agreement_idx on public.recurrence_rules (training_billing_agreement_id);

drop trigger if exists set_updated_at on public.recurrence_rules;
create trigger set_updated_at before update on public.recurrence_rules
  for each row execute function public.set_updated_at();

alter table public.recurrence_rules enable row level security;

drop policy if exists recurrence_rules_owner_all on public.recurrence_rules;
create policy recurrence_rules_owner_all on public.recurrence_rules
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Participantes de una serie — espeja RecurrenceRule.participantIds (join
-- table, no array nativo, para poder tener una FK real a students y nunca
-- referenciar un alumno inexistente).
-- ---------------------------------------------------------------------------

create table if not exists public.recurrence_rule_participants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recurrence_rule_id uuid not null references public.recurrence_rules(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint recurrence_rule_participants_unique unique (recurrence_rule_id, student_id)
);

comment on table public.recurrence_rule_participants is
  'Espeja RecurrenceRule.participantIds — participantes reales de TODA la serie, no sólo el alumno principal (recurrence_rules.primary_student_id).';

create index if not exists recurrence_rule_participants_owner_idx on public.recurrence_rule_participants (owner_id);
create index if not exists recurrence_rule_participants_rule_idx on public.recurrence_rule_participants (recurrence_rule_id);
create index if not exists recurrence_rule_participants_student_idx on public.recurrence_rule_participants (student_id);

alter table public.recurrence_rule_participants enable row level security;

drop policy if exists recurrence_rule_participants_owner_all on public.recurrence_rule_participants;
create policy recurrence_rule_participants_owner_all on public.recurrence_rule_participants
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Clases materializadas — espeja CalendarLesson.
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_lessons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  primary_student_id uuid not null references public.students(id) on delete restrict,
  -- Nombre/nivel del alumno principal CONGELADOS al momento de crear la
  -- clase — mismo criterio que el móvil (CalendarLesson.studentName/level
  -- nunca se releen del perfil actual del alumno).
  student_name text not null,
  level text not null,
  lesson_type text not null check (lesson_type in ('individual', 'group')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  modality text not null check (modality in ('presencial', 'online', 'mixta')),
  status text not null check (status in ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  color text not null,
  overlap_allowed boolean not null default false,
  overlap_group_id uuid,
  notes text,
  is_recurring boolean not null default false,
  recurrence_id uuid references public.recurrence_rules(id) on delete set null,
  recurrence_occurrence_key text,
  recurrence_index int,
  recurrence_original_start timestamptz,
  schedule_adjustment jsonb,
  class_title text,
  freed_by_lesson_id uuid references public.calendar_lessons(id) on delete set null,
  activity_kind text not null default 'class' check (activity_kind in ('class', 'training')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_lessons_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id),
  constraint calendar_lessons_end_after_start check (end_at > start_at)
);

comment on table public.calendar_lessons is
  'Clase materializada (ocurrencia real, no virtual) — espeja CalendarLesson. Idempotencia de recreación: recurrence_id + recurrence_occurrence_key identifica de forma única una ocurrencia de serie ya materializada.';

create unique index if not exists calendar_lessons_recurrence_occurrence_unique
  on public.calendar_lessons (recurrence_id, recurrence_occurrence_key)
  where recurrence_id is not null and recurrence_occurrence_key is not null;

create index if not exists calendar_lessons_owner_idx on public.calendar_lessons (owner_id);
create index if not exists calendar_lessons_owner_start_idx on public.calendar_lessons (owner_id, start_at);
create index if not exists calendar_lessons_owner_status_idx on public.calendar_lessons (owner_id, status);
create index if not exists calendar_lessons_primary_student_idx on public.calendar_lessons (primary_student_id);
create index if not exists calendar_lessons_recurrence_idx on public.calendar_lessons (recurrence_id);

drop trigger if exists set_updated_at on public.calendar_lessons;
create trigger set_updated_at before update on public.calendar_lessons
  for each row execute function public.set_updated_at();

alter table public.calendar_lessons enable row level security;

drop policy if exists calendar_lessons_owner_all on public.calendar_lessons;
create policy calendar_lessons_owner_all on public.calendar_lessons
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Participantes de una clase — espeja CalendarLessonParticipant[].
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_lesson_participants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  calendar_lesson_id uuid not null references public.calendar_lessons(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  -- Congelados al momento de la clase, igual que primary_student_id/level arriba.
  student_name text not null,
  level text not null,
  created_at timestamptz not null default now(),
  constraint calendar_lesson_participants_unique unique (calendar_lesson_id, student_id)
);

comment on table public.calendar_lesson_participants is
  'Espeja CalendarLesson.participants — nombre/nivel congelados en el momento de la clase, nunca releídos del perfil actual del alumno.';

create index if not exists calendar_lesson_participants_owner_idx on public.calendar_lesson_participants (owner_id);
create index if not exists calendar_lesson_participants_lesson_idx on public.calendar_lesson_participants (calendar_lesson_id);
create index if not exists calendar_lesson_participants_student_idx on public.calendar_lesson_participants (student_id);

alter table public.calendar_lesson_participants enable row level security;

drop policy if exists calendar_lesson_participants_owner_all on public.calendar_lesson_participants;
create policy calendar_lesson_participants_owner_all on public.calendar_lesson_participants
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Excepciones de recurrencia — espeja RecurrenceException.
-- ---------------------------------------------------------------------------

create table if not exists public.recurrence_exceptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recurrence_id uuid not null references public.recurrence_rules(id) on delete cascade,
  occurrence_key text not null,
  exception_type text not null check (exception_type in ('cancelled', 'rescheduled', 'excluded')),
  replacement_lesson_id uuid references public.calendar_lessons(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recurrence_exceptions_unique unique (recurrence_id, occurrence_key)
);

comment on table public.recurrence_exceptions is
  'Espeja RecurrenceException — historial de ocurrencias canceladas/reprogramadas/excluidas de una serie. Nunca se borra (append-only), igual criterio que el móvil.';

create index if not exists recurrence_exceptions_owner_idx on public.recurrence_exceptions (owner_id);
create index if not exists recurrence_exceptions_recurrence_idx on public.recurrence_exceptions (recurrence_id);

alter table public.recurrence_exceptions enable row level security;

drop policy if exists recurrence_exceptions_owner_all on public.recurrence_exceptions;
create policy recurrence_exceptions_owner_all on public.recurrence_exceptions
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
