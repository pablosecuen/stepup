-- TeacherFlow Web — Clase en curso (INI-07 / REG-11): «Comenzar clase», puntualidad del alumno, «Corregir hora de inicio» y «Finalizar clase».
--
-- En el original la clase en curso vive en el dispositivo (almacén local). En la web vive en el SERVIDOR (una fila por profesora), así sobrevive a una recarga, a otra pestaña y a otro navegador,
-- y no se pierde si se cierra la pestaña. Igual que el original: nunca hay más de UNA clase en curso a la vez.
--
-- Las funciones tienen `search_path` vacío, son idempotentes y de UNA transacción. Tres son SECURITY INVOKER (corren con la RLS de quien llama); `finish_live_class` es SECURITY DEFINER porque el encabezado
-- del registro sólo se escribe por funciones definer (INSERT/UPDATE directos revocados desde 20261001130000): filtra SIEMPRE por `auth.uid()` y sólo toca el registro de LA clase en curso de quien llama. Ninguna toca cobros, pagos, asistencias, notas ni
-- contenido pedagógico: lo único que escriben es la sesión en curso y, al finalizar, los datos de tiempo/puntualidad del encabezado del registro que YA existe (nunca crean un registro).
--
-- 1) start_live_class(p_calendar_lesson_id, p_arrival) — comienza la clase. Repetir con la misma clase devuelve la misma sesión (reintento seguro); otra clase mientras hay una en curso se rechaza.
-- 2) correct_live_class_start(p_started_at)            — «Corregir hora de inicio» (nunca toca el horario efectivo).
-- 3) discard_live_class()                              — descarta la sesión sin registrar nada.
-- 4) finish_live_class()                               — vuelca inicio/fin reales y puntualidad al registro en borrador y cierra la sesión.

-- ---------------------------------------------------------------------------
-- Datos de tiempo y puntualidad en el encabezado del registro (espejo de SavedLesson: effectiveStartAt, startSource, scheduleAdjustment, studentArrival).
-- ---------------------------------------------------------------------------
alter table public.lesson_registrations
  add column if not exists effective_start_at timestamptz,
  add column if not exists start_source text check (start_source in ('button', 'manual_correction')),
  add column if not exists schedule_adjustment jsonb,
  add column if not exists student_arrival jsonb,
  add column if not exists session_updated_at timestamptz;

comment on column public.lesson_registrations.student_arrival is
  'Respuesta de puntualidad {status, lateMinutes, manuallyCorrected, arrivedAt?} (StudentArrival del original). Null = sin dato: nunca se inventa una llegada.';

-- ---------------------------------------------------------------------------
-- La clase en curso: una sola por profesora (clave primaria = dueña).
-- ---------------------------------------------------------------------------
create table if not exists public.live_class_sessions (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  calendar_lesson_id uuid not null references public.calendar_lessons(id) on delete cascade,
  scheduled_duration_minutes integer not null check (scheduled_duration_minutes > 0),
  started_at timestamptz not null default now(),
  scheduled_start_at timestamptz not null,
  effective_start_at timestamptz not null,
  schedule_adjustment jsonb,
  student_arrival jsonb not null,
  start_source text not null default 'button' check (start_source in ('button', 'manual_correction')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.live_class_sessions enable row level security;
drop policy if exists live_class_sessions_owner_all on public.live_class_sessions;
create policy live_class_sessions_owner_all on public.live_class_sessions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Validación de la respuesta de puntualidad (mismos estados que el original).
-- ---------------------------------------------------------------------------
create or replace function public.live_class_arrival_is_valid(p_arrival jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_arrival is not null
    and jsonb_typeof(p_arrival) = 'object'
    and (p_arrival->>'status') in ('on_time', 'within_grace', 'late', 'teacher_delayed', 'mutual_adjustment', 'unknown', 'no_show')
    and case when jsonb_typeof(p_arrival->'lateMinutes') = 'number'
        then (p_arrival->>'lateMinutes')::numeric >= 0 and (p_arrival->>'lateMinutes')::numeric = trunc((p_arrival->>'lateMinutes')::numeric)
        else false end
    and jsonb_typeof(p_arrival->'manuallyCorrected') = 'boolean'
    and (not (p_arrival ? 'arrivedAt') or p_arrival->>'arrivedAt' ~ '^\d{4}-\d{2}-\d{2}T'), false);
$$;

revoke all on function public.live_class_arrival_is_valid(jsonb) from public;
grant execute on function public.live_class_arrival_is_valid(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Comenzar la clase.
-- ---------------------------------------------------------------------------
create or replace function public.start_live_class(p_calendar_lesson_id uuid, p_arrival jsonb)
returns public.live_class_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.calendar_lessons;
  v_registration_status text;
  v_session public.live_class_sessions;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if not public.live_class_arrival_is_valid(p_arrival) then
    raise exception 'La respuesta de puntualidad no es válida.' using errcode = '22023';
  end if;

  select * into v_lesson from public.calendar_lessons where id = p_calendar_lesson_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;

  -- Reintento (doble toque, respuesta perdida, otra pestaña): la misma clase devuelve la misma sesión, sin cambiar nada.
  select * into v_session from public.live_class_sessions where owner_id = v_owner;
  if found then
    if v_session.calendar_lesson_id = p_calendar_lesson_id then
      return v_session;
    end if;
    raise exception 'Ya hay otra clase en curso. Finalizala antes de comenzar una nueva.' using errcode = 'P0001';
  end if;

  if v_lesson.status <> 'scheduled' then
    raise exception 'Sólo se puede comenzar una clase agendada.' using errcode = '22023';
  end if;
  if (v_lesson.start_at at time zone 'America/Argentina/Buenos_Aires')::date <> (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    raise exception 'Sólo se puede comenzar una clase de hoy.' using errcode = '22023';
  end if;

  select status into v_registration_status from public.lesson_registrations where owner_id = v_owner and calendar_lesson_id = p_calendar_lesson_id;
  if not found then
    raise exception 'Primero hay que iniciar el registro de la clase.' using errcode = '22023';
  end if;
  if v_registration_status = 'completed' then
    raise exception 'Esta clase ya está registrada.' using errcode = '22023';
  end if;

  insert into public.live_class_sessions (
    owner_id, calendar_lesson_id, scheduled_duration_minutes, started_at, scheduled_start_at, effective_start_at, student_arrival
  ) values (
    v_owner,
    p_calendar_lesson_id,
    greatest(1, round(extract(epoch from (v_lesson.end_at - v_lesson.start_at)) / 60)::integer),
    now(),
    v_lesson.start_at,
    v_lesson.start_at,
    p_arrival
  )
  on conflict (owner_id) do nothing
  returning * into v_session;

  if not found then
    -- Otra llamada simultánea ganó la carrera: si fue por esta misma clase es un reintento; si no, ya hay otra en curso.
    select * into v_session from public.live_class_sessions where owner_id = v_owner;
    if v_session.calendar_lesson_id = p_calendar_lesson_id then
      return v_session;
    end if;
    raise exception 'Ya hay otra clase en curso. Finalizala antes de comenzar una nueva.' using errcode = 'P0001';
  end if;

  return v_session;
end;
$$;

revoke all on function public.start_live_class(uuid, jsonb) from public;
grant execute on function public.start_live_class(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Corregir la hora de inicio (la profesora puede haberse olvidado de tocar «Comenzar clase» a tiempo). Nunca toca el horario efectivo.
-- ---------------------------------------------------------------------------
create or replace function public.correct_live_class_start(p_started_at timestamptz)
returns public.live_class_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_session public.live_class_sessions;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_started_at is null then
    raise exception 'Indicá la hora de inicio.' using errcode = '22023';
  end if;
  if p_started_at > now() + interval '1 minute' then
    raise exception 'La hora de inicio no puede ser futura.' using errcode = '22023';
  end if;
  if p_started_at < now() - interval '24 hours' then
    raise exception 'La hora de inicio es demasiado antigua para una clase en curso.' using errcode = '22023';
  end if;

  update public.live_class_sessions
    set started_at = p_started_at, start_source = 'manual_correction', updated_at = now()
    where owner_id = v_owner
    returning * into v_session;
  if not found then
    raise exception 'No hay una clase en curso.' using errcode = 'P0002';
  end if;
  return v_session;
end;
$$;

revoke all on function public.correct_live_class_start(timestamptz) from public;
grant execute on function public.correct_live_class_start(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Descartar la clase en curso sin registrar nada. Idempotente: sin sesión devuelve false.
-- ---------------------------------------------------------------------------
create or replace function public.discard_live_class()
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_deleted integer;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  delete from public.live_class_sessions where owner_id = v_owner;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.discard_live_class() from public;
grant execute on function public.discard_live_class() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Finalizar la clase: vuelca inicio/fin reales y puntualidad al encabezado del registro en borrador y cierra la sesión, todo junto. Si el registro ya se completó mientras tanto
--    (por ejemplo desde otra pestaña) NO se pisan sus datos: sólo se cierra la sesión.
-- Devuelve {calendar_lesson_id, elapsed_minutes, applied}.
-- ---------------------------------------------------------------------------
create or replace function public.finish_live_class()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_session public.live_class_sessions;
  v_end timestamptz;
  v_minutes integer;
  v_updated integer;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_session from public.live_class_sessions where owner_id = v_owner for update;
  if not found then
    raise exception 'No hay una clase en curso.' using errcode = 'P0002';
  end if;

  v_minutes := greatest(1, round(extract(epoch from (now() - v_session.started_at)) / 60)::integer);
  v_end := greatest(now(), v_session.started_at + interval '1 minute');

  update public.lesson_registrations
    set actual_started_at = v_session.started_at,
        actual_ended_at = v_end,
        effective_start_at = v_session.effective_start_at,
        start_source = v_session.start_source,
        schedule_adjustment = v_session.schedule_adjustment,
        student_arrival = v_session.student_arrival,
        session_updated_at = now(),
        updated_at = now()
    where owner_id = v_owner and calendar_lesson_id = v_session.calendar_lesson_id and status = 'in_progress';
  get diagnostics v_updated = row_count;

  delete from public.live_class_sessions where owner_id = v_owner;

  return jsonb_build_object('calendar_lesson_id', v_session.calendar_lesson_id, 'elapsed_minutes', v_minutes, 'applied', v_updated > 0);
end;
$$;

revoke all on function public.finish_live_class() from public;
grant execute on function public.finish_live_class() to authenticated;
