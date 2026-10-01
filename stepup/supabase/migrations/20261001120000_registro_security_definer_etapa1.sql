-- TeacherFlow Web — Fase 10, cierre de B/D por dominio, Etapa 1 (Registro).
--
-- Convierte las 3 RPC de Registro de clases a SECURITY DEFINER +
-- search_path fijo, auditadas línea por línea antes de tocarlas (ver
-- informe de esta ronda). Nunca cambia la lógica de negocio — la única
-- corrección real es la que se documenta abajo (dependencia implícita de
-- RLS encontrada y eliminada).
--
-- Por qué todavía NO se revocan los grants de tabla (lesson_registrations
-- + 4 hijas): esa es la Etapa 2, después del E2E real en navegador. Esta
-- migración sólo cambia CÓMO corren estas 3 funciones (con los privilegios
-- de su propio dueño, no con los de `authenticated`) — el resto del
-- sistema sigue exactamente igual hasta confirmar esto con datos reales.
--
-- Auditoría línea por línea (resumen — detalle completo en el informe):
-- las 3 funciones ya validaban `auth.uid()` obligatorio + ownership
-- explícito (`owner_id = v_owner`) en cada INSERT/UPDATE/SELECT ... FOR
-- UPDATE, y en cada id recibido por payload (calendar_lesson_id,
-- recurrence_id+occurrence_key, primary_student_id, participantes,
-- lesson_registration_id, rescheduled_from_registration_id) ANTES de
-- usarlo — ninguna de las dos funciones nuevas (`start_lesson_registration`,
-- `save_participant_registration`) tenía ninguna consulta dependiente de
-- RLS. Se encontró UNA sola dependencia implícita real en
-- `finalize_lesson_registration`: el conteo de participantes incompletos
-- (`select count(*) from public.lesson_registration_students where
-- lesson_registration_id = v_registration_id and participant_status <>
-- 'completed'`) nunca filtraba por `owner_id` — hoy funciona porque RLS
-- se lo agrega transparentemente (la sesión sólo puede ver filas propias),
-- pero bajo SECURITY DEFINER esa fila desaparece y la consulta vería
-- CUALQUIER fila con ese `lesson_registration_id`, sin importar su
-- `owner_id`. Corregida acá agregando el mismo filtro explícito que ya
-- usa el resto de la función — nunca cambia el resultado observable hoy
-- (estructuralmente sólo existen filas del propio owner para ese id, y
-- además ya lo garantiza el trigger `_enforce_owner_match_fk` sobre
-- `lesson_registration_students.lesson_registration_id`, aplicado en
-- `20261001110000`), pero deja de depender de RLS para serlo.
--
-- `search_path = ''` en las 3: todas las referencias a tablas/tipos ya
-- estaban 100% calificadas con `public.`/`auth.` (confirmado línea por
-- línea); los únicos identificadores sin calificar son funciones/tipos
-- built-in de `pg_catalog` (`coalesce`, `nullif`, `jsonb_array_elements`,
-- `now()`, `::uuid`, `::date`, etc.), que Postgres resuelve siempre vía
-- `pg_catalog`, implícito al principio de cualquier `search_path` —
-- incluido uno vacío — así que `search_path = ''` no cambia su
-- resolución, sólo elimina cualquier esquema intermedio que un atacante
-- pudiera intentar inyectar.

create or replace function public.start_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_calendar_lesson_id uuid := nullif(p_payload->>'calendar_lesson_id', '')::uuid;
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_occurrence_key text := nullif(p_payload->>'occurrence_key', '');
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_activity_kind text := coalesce(p_payload->>'activity_kind', 'class');
  v_outcome text := coalesce(p_payload->>'outcome', 'clase_dictada');
  v_holiday_exception boolean := coalesce((p_payload->>'holiday_exception')::boolean, false);
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_late_cancellation_policy text := nullif(p_payload->>'late_cancellation_policy', '');
  v_late_cancellation_percentage smallint := nullif(p_payload->>'late_cancellation_percentage', '')::smallint;
  v_rescheduled_from_registration_id uuid := nullif(p_payload->>'rescheduled_from_registration_id', '')::uuid;
  v_class_held boolean := (coalesce(p_payload->>'outcome', 'clase_dictada') = 'clase_dictada')
    or (p_payload->>'outcome' = 'feriado' and coalesce((p_payload->>'holiday_exception')::boolean, false));
  v_registration public.lesson_registrations;
  v_participant jsonb;
  v_participant_status text;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  if v_recurrence_id is not null and v_occurrence_key is null then
    raise exception 'recurrence_id sin occurrence_key — estado inválido.' using errcode = '22023';
  end if;
  if v_occurrence_key is not null and v_recurrence_id is null then
    raise exception 'occurrence_key sin recurrence_id — estado inválido.' using errcode = '22023';
  end if;
  if v_recurrence_id is not null and v_occurrence_key is not null
     and v_occurrence_key !~ ('^' || v_recurrence_id::text || ':') then
    raise exception 'occurrence_key no pertenece a la serie indicada.' using errcode = '22023';
  end if;

  if v_recurrence_id is not null and not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
  end if;
  if v_calendar_lesson_id is not null and not exists (select 1 from public.calendar_lessons where id = v_calendar_lesson_id and owner_id = v_owner) then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;

  if v_calendar_lesson_id is not null and v_recurrence_id is not null
     and not exists (
       select 1 from public.calendar_lessons
       where id = v_calendar_lesson_id and owner_id = v_owner
         and recurrence_id = v_recurrence_id and recurrence_occurrence_key = v_occurrence_key
     ) then
    raise exception 'calendar_lesson_id y recurrence_id/occurrence_key no corresponden a la misma clase.' using errcode = '22023';
  end if;

  if v_primary_student_id is not null and not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if v_rescheduled_from_registration_id is not null and not exists (select 1 from public.lesson_registrations where id = v_rescheduled_from_registration_id and owner_id = v_owner) then
    raise exception 'El registro original de la reprogramación no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where not exists (select 1 from public.students where id = (p->>'student_id')::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if jsonb_array_length(coalesce(p_payload->'participants', '[]'::jsonb)) = 0 then
    raise exception 'Elegí al menos un alumno.' using errcode = '22023';
  end if;

  if v_calendar_lesson_id is null and v_recurrence_id is null and v_operation_id is null then
    raise exception 'operation_id es obligatorio para un registro ad-hoc.' using errcode = '22023';
  end if;

  if v_calendar_lesson_id is null and v_recurrence_id is not null and v_occurrence_key is not null then
    insert into public.calendar_lessons (
      owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
      modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
      recurrence_index, recurrence_original_start, class_title, activity_kind
    ) values (
      v_owner,
      v_primary_student_id,
      p_payload->>'student_name',
      p_payload->>'level',
      p_payload->>'lesson_type',
      (p_payload->>'start_at')::timestamptz,
      (p_payload->>'end_at')::timestamptz,
      p_payload->>'modality',
      'scheduled',
      coalesce(p_payload->>'color', '#FCE4D2'),
      true,
      v_recurrence_id,
      v_occurrence_key,
      (p_payload->>'recurrence_index')::int,
      (p_payload->>'start_at')::timestamptz,
      nullif(p_payload->>'class_title', ''),
      v_activity_kind
    )
    on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
    do update set updated_at = now()
    returning id into v_calendar_lesson_id;

    for v_participant in select * from jsonb_array_elements(p_payload->'participants')
    loop
      insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
      values (v_owner, v_calendar_lesson_id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level')
      on conflict (calendar_lesson_id, student_id) do nothing;
    end loop;
  end if;

  if v_calendar_lesson_id is not null then
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status
    ) values (
      v_owner, v_calendar_lesson_id, v_activity_kind, coalesce((p_payload->>'counts_as_class')::boolean, true),
      (p_payload->>'start_at')::timestamptz, 'in_progress'
    )
    on conflict (owner_id, calendar_lesson_id) where calendar_lesson_id is not null
    do nothing
    returning * into v_registration;

    if not found then
      select * into v_registration from public.lesson_registrations where owner_id = v_owner and calendar_lesson_id = v_calendar_lesson_id;
      return v_registration;
    end if;
  else
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, scheduled_end_at,
      outcome, holiday_exception, modality, operation_id,
      late_cancellation_policy, late_cancellation_percentage, rescheduled_from_registration_id, status
    ) values (
      v_owner, null, v_activity_kind, v_class_held,
      nullif(p_payload->>'start_at', '')::timestamptz, nullif(p_payload->>'end_at', '')::timestamptz,
      v_outcome, v_holiday_exception, nullif(p_payload->>'modality', ''), v_operation_id,
      v_late_cancellation_policy, v_late_cancellation_percentage, v_rescheduled_from_registration_id, 'in_progress'
    )
    on conflict (owner_id, operation_id) where operation_id is not null
    do nothing
    returning * into v_registration;

    if not found then
      select * into v_registration from public.lesson_registrations where owner_id = v_owner and operation_id = v_operation_id;
      return v_registration;
    end if;
  end if;

  v_participant_status := case when v_class_held then 'pending' else 'completed' end;
  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id, participant_status)
    values (v_owner, v_registration.id, (v_participant->>'student_id')::uuid, v_participant_status)
    on conflict (lesson_registration_id, student_id) do nothing;
  end loop;

  return v_registration;
end;
$$;

comment on function public.start_lesson_registration(jsonb) is
  'Empieza (o retoma) un registro de clase — materializa la ocurrencia si es virtual, crea/recupera el encabezado y el roster inclusivo real. SECURITY DEFINER desde 20261001120000 (Etapa 1 de Registro, cierre de B/D): corre con los privilegios de su dueño, nunca de authenticated — ownership ya era 100% explícito en cada acceso, sin ninguna dependencia de RLS.';

revoke all on function public.start_lesson_registration(jsonb) from public, anon, authenticated;
grant execute on function public.start_lesson_registration(jsonb) to authenticated;

-- ---------------------------------------------------------------------------

create or replace function public.save_participant_registration(p_payload jsonb)
returns public.lesson_registration_students
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_student_id uuid := (p_payload->>'student_id')::uuid;
  v_registration_status text;
  v_participant_status text := p_payload->>'participant_status';
  v_attendance jsonb := nullif(p_payload->'attendance', 'null'::jsonb);
  v_evaluation jsonb := nullif(p_payload->'evaluation', 'null'::jsonb);
  v_homework_reviews jsonb := coalesce(nullif(p_payload->'homework_reviews', 'null'::jsonb), '[]'::jsonb);
  v_homework_review jsonb;
  v_result public.lesson_registration_students;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select status into v_registration_status from public.lesson_registrations where id = v_registration_id and owner_id = v_owner;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if v_registration_status = 'completed' then
    raise exception 'Este registro ya está finalizado — usá edit_completed_lesson_registration para editarlo.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.lesson_registration_students where lesson_registration_id = v_registration_id and student_id = v_student_id and owner_id = v_owner) then
    raise exception 'Ese alumno no forma parte de este registro.' using errcode = 'P0002';
  end if;

  if v_attendance is not null then
    insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status, late_minutes)
    values (v_owner, v_registration_id, v_student_id, v_attendance->>'status', nullif(v_attendance->>'late_minutes', '')::int)
    on conflict (lesson_registration_id, student_id)
    do update set status = excluded.status, late_minutes = excluded.late_minutes;
  end if;

  if v_evaluation is not null then
    insert into public.lesson_registration_evaluations (
      owner_id, lesson_registration_id, student_id, general_grade, skill_grades, strengths, areas_to_improve,
      individual_observation, individual_homework_description, individual_homework_due_date, billed_amount
    ) values (
      v_owner, v_registration_id, v_student_id,
      nullif(v_evaluation->>'general_grade', '')::numeric,
      coalesce(v_evaluation->'skill_grades', '{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(v_evaluation->'strengths')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_evaluation->'areas_to_improve')), '{}'),
      nullif(v_evaluation->>'individual_observation', ''),
      nullif(v_evaluation->>'individual_homework_description', ''),
      nullif(v_evaluation->>'individual_homework_due_date', '')::date,
      nullif(v_evaluation->>'billed_amount', '')::numeric
    )
    on conflict (lesson_registration_id, student_id)
    do update set
      general_grade = excluded.general_grade,
      skill_grades = excluded.skill_grades,
      strengths = excluded.strengths,
      areas_to_improve = excluded.areas_to_improve,
      individual_observation = excluded.individual_observation,
      individual_homework_description = excluded.individual_homework_description,
      individual_homework_due_date = excluded.individual_homework_due_date,
      billed_amount = excluded.billed_amount;
  end if;

  for v_homework_review in select * from jsonb_array_elements(v_homework_reviews)
  loop
    insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
    values (v_owner, v_registration_id, v_student_id, v_homework_review->>'task_id', v_homework_review->>'outcome', now())
    on conflict (lesson_registration_id, student_id, task_id)
    do update set outcome = excluded.outcome, reviewed_at = now();
  end loop;

  update public.lesson_registration_students
  set participant_status = coalesce(v_participant_status, participant_status)
  where lesson_registration_id = v_registration_id and student_id = v_student_id and owner_id = v_owner
  returning * into v_result;

  update public.lesson_registrations set updated_at = now() where id = v_registration_id and owner_id = v_owner;

  return v_result;
end;
$$;

comment on function public.save_participant_registration(jsonb) is
  'Guarda asistencia/evaluación/tareas de un participante en un registro en curso. SECURITY DEFINER desde 20261001120000 (Etapa 1 de Registro, cierre de B/D): corre con los privilegios de su dueño — ownership ya era 100% explícito en cada acceso, sin ninguna dependencia de RLS.';

revoke all on function public.save_participant_registration(jsonb) from public, anon, authenticated;
grant execute on function public.save_participant_registration(jsonb) to authenticated;

-- ---------------------------------------------------------------------------

create or replace function public.finalize_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_registration public.lesson_registrations;
  v_incomplete_count int;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_registration from public.lesson_registrations where id = v_registration_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if v_registration.status = 'completed' then
    raise exception 'Este registro ya está finalizado — usá edit_completed_lesson_registration para editarlo.' using errcode = '22023';
  end if;

  -- CORREGIDO (Etapa 1, 20261001120000): faltaba "and owner_id = v_owner"
  -- acá — bajo security invoker funcionaba porque RLS se lo agregaba
  -- transparentemente; bajo security definer ya no hay ningún filtro
  -- implícito, así que queda explícito, igual que el resto de la función.
  select count(*) into v_incomplete_count
  from public.lesson_registration_students
  where lesson_registration_id = v_registration_id and owner_id = v_owner and participant_status <> 'completed';
  if v_incomplete_count > 0 then
    raise exception 'Faltan participantes por completar.' using errcode = '22023';
  end if;

  update public.lesson_registrations
  set
    status = 'completed',
    homework_description = case when p_payload ? 'homework_description' then nullif(p_payload->>'homework_description', '') else homework_description end,
    homework_due_date = case when p_payload ? 'homework_due_date' then nullif(p_payload->>'homework_due_date', '')::date else homework_due_date end,
    billed_amount = case when p_payload ? 'billed_amount' then nullif(p_payload->>'billed_amount', '')::numeric else billed_amount end,
    counts_as_class = case when p_payload ? 'counts_as_class' then (p_payload->>'counts_as_class')::boolean else counts_as_class end,
    actual_started_at = case when p_payload ? 'actual_started_at' then nullif(p_payload->>'actual_started_at', '')::timestamptz else actual_started_at end,
    actual_ended_at = case when p_payload ? 'actual_ended_at' then nullif(p_payload->>'actual_ended_at', '')::timestamptz else actual_ended_at end,
    updated_at = now()
  where id = v_registration_id and owner_id = v_owner
  returning * into v_registration;

  if v_registration.actual_started_at is not null and v_registration.actual_ended_at is not null
     and v_registration.actual_ended_at <= v_registration.actual_started_at then
    raise exception 'La hora de fin real debe ser posterior a la de inicio.' using errcode = '22023';
  end if;

  if v_registration.calendar_lesson_id is not null then
    update public.calendar_lessons set status = 'completed' where id = v_registration.calendar_lesson_id and owner_id = v_owner;
  end if;

  return v_registration;
end;
$$;

comment on function public.finalize_lesson_registration(jsonb) is
  'Finaliza un registro (todos los participantes completos) y, si está ligado a Calendario, marca la clase como completed. SECURITY DEFINER desde 20261001120000 (Etapa 1 de Registro, cierre de B/D): se corrigió la única dependencia implícita de RLS real encontrada en la auditoría (conteo de participantes incompletos sin owner_id explícito) — nunca cambia el comportamiento observable hoy, sólo deja de depender de RLS. Nunca genera payment_charges acá — sync_per_class_charge es una RPC separada del dominio Cobros, llamada por el cliente inmediatamente después, fuera del alcance de esta Etapa 1.';

revoke all on function public.finalize_lesson_registration(jsonb) from public, anon, authenticated;
grant execute on function public.finalize_lesson_registration(jsonb) to authenticated;
