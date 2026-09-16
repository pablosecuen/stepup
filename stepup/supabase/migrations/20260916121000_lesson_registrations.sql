-- TeacherFlow Web — Fase 1: registro pedagógico de clases.
-- Espeja SavedLesson + NewClassFormState (new-class/types/index.ts):
-- asistencia, evaluación (nota general + por habilidad), tareas y su
-- revisión. Se separa en tablas normalizadas (una fila por alumno cuando
-- corresponde) en vez de un único jsonb — permite FKs reales a students y
-- consultas directas para "Progreso"/reportes (Fase 4/7), evitando
-- duplicar en SQL la lógica de agregación que hoy vive en funciones puras
-- de TypeScript sobre el array plano.

create table if not exists public.lesson_registrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text,
  calendar_lesson_id uuid references public.calendar_lessons(id) on delete set null,
  activity_kind text not null default 'class' check (activity_kind in ('class', 'training')),
  counts_as_class boolean not null default true,
  homework_description text,
  homework_due_date date,
  billed_amount numeric(12, 2),
  scheduled_start_at timestamptz,
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lesson_registrations_legacy_mobile_id_unique unique (owner_id, legacy_mobile_id)
);

comment on table public.lesson_registrations is
  'Espeja SavedLesson — registro pedagógico real de una clase dictada (asistencia, evaluación, tareas). Independiente de calendar_lessons a propósito (mismo criterio del móvil: el registro pedagógico nunca se pierde aunque la reserva de calendario cambie).';

create index if not exists lesson_registrations_owner_idx on public.lesson_registrations (owner_id);
create index if not exists lesson_registrations_calendar_lesson_idx on public.lesson_registrations (calendar_lesson_id);

alter table public.lesson_registrations enable row level security;
drop policy if exists lesson_registrations_owner_all on public.lesson_registrations;
create policy lesson_registrations_owner_all on public.lesson_registrations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- FKs diferidas ahora que lesson_registrations existe.
alter table public.payment_charges drop constraint if exists payment_charges_saved_lesson_fk;
alter table public.payment_charges
  add constraint payment_charges_saved_lesson_fk
  foreign key (saved_lesson_id) references public.lesson_registrations(id) on delete restrict;

alter table public.package_credit_movements drop constraint if exists package_credit_movements_saved_lesson_fk;
alter table public.package_credit_movements
  add constraint package_credit_movements_saved_lesson_fk
  foreign key (saved_lesson_id) references public.lesson_registrations(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Roster real de la clase registrada — espeja NewClassFormState.studentIds.
-- ---------------------------------------------------------------------------

create table if not exists public.lesson_registration_students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  constraint lesson_registration_students_unique unique (lesson_registration_id, student_id)
);

create index if not exists lesson_registration_students_owner_idx on public.lesson_registration_students (owner_id);
create index if not exists lesson_registration_students_lesson_idx on public.lesson_registration_students (lesson_registration_id);
create index if not exists lesson_registration_students_student_idx on public.lesson_registration_students (student_id);
alter table public.lesson_registration_students enable row level security;
drop policy if exists lesson_registration_students_owner_all on public.lesson_registration_students;
create policy lesson_registration_students_owner_all on public.lesson_registration_students
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Asistencia — espeja StudentAttendanceEntry.
-- ---------------------------------------------------------------------------

create table if not exists public.lesson_registration_attendance (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  status text not null check (status in ('presente', 'ausente', 'tarde', 'ausente_aviso', 'sin_registrar')),
  late_minutes int,
  constraint lesson_registration_attendance_unique unique (lesson_registration_id, student_id)
);

create index if not exists lesson_registration_attendance_owner_idx on public.lesson_registration_attendance (owner_id);
create index if not exists lesson_registration_attendance_lesson_idx on public.lesson_registration_attendance (lesson_registration_id);
alter table public.lesson_registration_attendance enable row level security;
drop policy if exists lesson_registration_attendance_owner_all on public.lesson_registration_attendance;
create policy lesson_registration_attendance_owner_all on public.lesson_registration_attendance
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Evaluación por alumno — espeja StudentEvaluationEntry (incluye
-- skill_grades como jsonb, Partial<Record<Skill, number>>, mismo criterio
-- que el resto de los blobs pequeños y siempre-juntos de este esquema).
-- ---------------------------------------------------------------------------

create table if not exists public.lesson_registration_evaluations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  general_grade numeric(4, 2) check (general_grade is null or (general_grade >= 1 and general_grade <= 10)),
  skill_grades jsonb not null default '{}'::jsonb,
  strengths text[] not null default '{}',
  areas_to_improve text[] not null default '{}',
  individual_observation text,
  individual_homework_description text,
  individual_homework_due_date date,
  billed_amount numeric(12, 2),
  constraint lesson_registration_evaluations_unique unique (lesson_registration_id, student_id)
);

comment on table public.lesson_registration_evaluations is
  '0 nunca es una nota real (mismo criterio que el móvil, calculateAverageGrade): general_grade se guarda NULL cuando no hay calificación, nunca 0.';

create index if not exists lesson_registration_evaluations_owner_idx on public.lesson_registration_evaluations (owner_id);
create index if not exists lesson_registration_evaluations_lesson_idx on public.lesson_registration_evaluations (lesson_registration_id);
create index if not exists lesson_registration_evaluations_student_idx on public.lesson_registration_evaluations (student_id);
alter table public.lesson_registration_evaluations enable row level security;
drop policy if exists lesson_registration_evaluations_owner_all on public.lesson_registration_evaluations;
create policy lesson_registration_evaluations_owner_all on public.lesson_registration_evaluations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Revisión de tareas — espeja HomeworkReviewEntry[] (SavedLesson.homeworkReviews).
-- task_id conserva EXACTAMENTE el esquema de identidad estable del móvil
-- (`common:<originLessonId>` / `individual:<originLessonId>:<studentId>`) —
-- necesario para que una tarea sobreviva ediciones/reordenamientos, igual
-- criterio documentado en homeworkPendingDomain.ts.
-- ---------------------------------------------------------------------------

create table if not exists public.lesson_registration_homework_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- lesson_registration_id: la clase EN LA QUE se hizo la revisión (nunca la clase de origen de la tarea).
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  task_id text not null,
  outcome text not null check (outcome in ('realizada', 'parcial', 'no_realizada', 'ya_no_corresponde')),
  reviewed_at timestamptz not null default now(),
  constraint lesson_registration_homework_reviews_unique unique (lesson_registration_id, student_id, task_id)
);

comment on table public.lesson_registration_homework_reviews is
  'Espeja HomeworkReviewEntry. task_id = common:<originLessonId> | individual:<originLessonId>:<studentId> — misma identidad estable que homeworkPendingDomain.ts en el móvil.';

create index if not exists lesson_registration_homework_reviews_owner_idx on public.lesson_registration_homework_reviews (owner_id);
create index if not exists lesson_registration_homework_reviews_task_idx on public.lesson_registration_homework_reviews (owner_id, task_id);
alter table public.lesson_registration_homework_reviews enable row level security;
drop policy if exists lesson_registration_homework_reviews_owner_all on public.lesson_registration_homework_reviews;
create policy lesson_registration_homework_reviews_owner_all on public.lesson_registration_homework_reviews
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
