-- TeacherFlow Web — Fase 1: dominio Alumnos.
-- Espeja src/features/students/types/index.ts (StudentListItem) y
-- src/features/student-profile/types/index.ts (StudentProfile) de la app
-- móvil, UNIFICADOS en una sola tabla relacional — el móvil los separa en
-- dos claves de AsyncStorage (`@teacherflow/students` array +
-- `@teacherflow/profiles` mapa por id) sólo por ser un document-store; acá
-- es una única fila por alumno, misma identidad (`id`), sin duplicar datos.
--
-- DECISIÓN DE ARQUITECTURA (documentada explícitamente — ver
-- docs/WEB_PARITY_PLAN.md): los campos de StudentListItem que el móvil
-- CALCULA en el momento de leer (nextClassAt, classesThisMonth,
-- averageGrade, paymentStatus, hasOverduePayment, hasPendingReport,
-- hasPendingHomework, lastPaymentAt, totalClasses, totalHoursTaken,
-- totalInvested, attendanceRate) NUNCA se guardan como columna acá — se
-- calculan con SQL (vistas/consultas) contra calendar_lessons,
-- lesson_registrations y payment_charges/payments en la Fase 2/4/5, cuando
-- esas tablas existan y tengan datos reales. Guardarlos como columna
-- duplicaría una regla en dos lugares (prohibido explícitamente en las
-- reglas de esta tarea) y arriesgaría quedar desactualizados.
--
-- `levels`/`initial_level` siguen el mismo criterio (débil, por NOMBRE, no
-- por id) que el móvil: un nivel personalizado se referencia por su
-- `name`, nunca por `custom_levels.id` — replicar la regla de negocio real,
-- no "mejorarla" acá sin pedido explícito.

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  name text not null,
  phone text,
  whatsapp text,
  email text,
  usual_days text[] not null default '{}',
  usual_time text,
  notes text,
  birth_date date,
  levels text[] not null default '{}',
  initial_level text not null default '',
  modality text not null check (modality in ('presencial', 'online', 'mixta')),
  status text not null default 'activo' check (status in ('activo', 'pausado', 'inactivo', 'archivado')),
  category text not null check (category in (
    'primaria', 'secundaria', 'profesorado_ingles', 'universitario',
    'adulto_interes_personal', 'adulto_laboral', 'examen_internacional',
    'apoyo_escolar', 'otro'
  )),
  billing_type text not null check (billing_type in ('por_clase', 'mensual')),
  -- StudentBillingPlan (unión discriminada) — se guarda tal cual como jsonb,
  -- mismo criterio que weeks en recurrence_rules: permite reutilizar sin
  -- reescribir las funciones puras de studentBillingPlan.ts al portarlas.
  billing_plan jsonb,
  date_joined date not null,
  last_reactivated_at date,
  status_change_date date,
  usual_duration_minutes int not null default 60 check (usual_duration_minutes > 0),
  weekly_frequency int not null default 1 check (weekly_frequency >= 0),
  price numeric(12, 2) not null default 0 check (price >= 0),
  pending_homework text,
  alerts text[] not null default '{}',
  current_goals text[] not null default '{}',
  strengths text[] not null default '{}',
  areas_to_improve text[] not null default '{}',
  is_featured boolean not null default false,
  is_new boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.students is
  'Alumno — unifica StudentListItem + StudentProfile del móvil en una sola fila. Los campos calculados en el móvil (próxima clase, pagos, promedio, etc.) NUNCA se guardan acá — se derivan por SQL de calendar_lessons/lesson_registrations/payment_charges en fases posteriores.';

create index if not exists students_owner_idx on public.students (owner_id);
create index if not exists students_owner_status_idx on public.students (owner_id, status);
create index if not exists students_owner_name_idx on public.students (owner_id, name);

drop trigger if exists set_updated_at on public.students;
create trigger set_updated_at before update on public.students
  for each row execute function public.set_updated_at();

alter table public.students enable row level security;

drop policy if exists students_owner_all on public.students;
create policy students_owner_all on public.students
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Niveles personalizados — espeja CustomLevel. El móvil no los escopea por
-- profesor (app single-tenant por dispositivo); acá se agrega owner_id
-- porque la web es multi-tenant real, requisito nuevo de esta tarea, nunca
-- un cambio de regla de negocio del propio nivel.
-- ---------------------------------------------------------------------------

create table if not exists public.custom_levels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  name text not null,
  created_at timestamptz not null default now(),
  constraint custom_levels_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id),
  -- Mismo criterio de duplicado insensible a mayúsculas/espacios que
  -- isDuplicateCustomLevelName (customLevelsCore.ts) — nunca dos niveles
  -- personalizados del mismo profesor con el mismo nombre normalizado.
  constraint custom_levels_name_not_blank check (btrim(name) <> '')
);

comment on table public.custom_levels is
  'Espeja CustomLevel. Un nivel se referencia en students.levels por NAME (nunca por id) — mismo criterio débil que el móvil, ver customLevelsCore.ts. Renombrar un nivel debe cascadear reescribiendo students.levels (lógica de repositorio, Fase 2), igual que renameCustomLevel/renameStudentsLevel en el móvil.';

create unique index if not exists custom_levels_owner_name_unique
  on public.custom_levels (owner_id, lower(btrim(name)));

create index if not exists custom_levels_owner_idx on public.custom_levels (owner_id);

alter table public.custom_levels enable row level security;

drop policy if exists custom_levels_owner_all on public.custom_levels;
create policy custom_levels_owner_all on public.custom_levels
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Historial — espeja StatusHistoryEntry[] / LevelHistoryEntry[] /
-- PriceHistoryEntry[]. Append-only, nunca se edita ni se borra una entrada
-- ya escrita (mismo criterio que el resto de los historiales del móvil).
-- ---------------------------------------------------------------------------

create table if not exists public.student_status_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('activo', 'pausado', 'inactivo', 'archivado')),
  occurred_on date not null,
  reason text,
  internal_note text,
  created_at timestamptz not null default now()
);

comment on table public.student_status_history is 'Espeja StatusHistoryEntry[] — historial de cambios de estado de un alumno, nunca se borra ni se edita.';
create index if not exists student_status_history_owner_idx on public.student_status_history (owner_id);
create index if not exists student_status_history_student_idx on public.student_status_history (student_id);
alter table public.student_status_history enable row level security;
drop policy if exists student_status_history_owner_all on public.student_status_history;
create policy student_status_history_owner_all on public.student_status_history
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.student_level_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  legacy_mobile_id text,
  level text not null,
  from_level text,
  achieved_on date not null,
  recorded_at timestamptz,
  previous_milestone_at timestamptz,
  duration_days int,
  note text,
  origin text check (origin is null or origin = 'manual'),
  created_at timestamptz not null default now(),
  constraint student_level_history_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.student_level_history is 'Espeja LevelHistoryEntry[] — hitos de nivel alcanzados por un alumno, nunca se borra ni se edita.';
create index if not exists student_level_history_owner_idx on public.student_level_history (owner_id);
create index if not exists student_level_history_student_idx on public.student_level_history (student_id);
alter table public.student_level_history enable row level security;
drop policy if exists student_level_history_owner_all on public.student_level_history;
create policy student_level_history_owner_all on public.student_level_history
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.student_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0),
  effective_on date not null,
  created_at timestamptz not null default now()
);

comment on table public.student_price_history is 'Espeja PriceHistoryEntry[] — historial de precio de referencia del alumno, nunca se borra ni se edita.';
create index if not exists student_price_history_owner_idx on public.student_price_history (owner_id);
create index if not exists student_price_history_student_idx on public.student_price_history (student_id);
alter table public.student_price_history enable row level security;
drop policy if exists student_price_history_owner_all on public.student_price_history;
create policy student_price_history_owner_all on public.student_price_history
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
