-- TeacherFlow Web — Fase 4 (corrección real, hallazgo de la verificación
-- en navegador de esta ronda): corrige un bug real de manejo de `null`
-- JSON en `save_participant_registration` y `edit_completed_lesson_registration`.
-- Migración aditiva — NUNCA edita las migraciones ya aplicadas.
--
-- Hallazgo real (reproducido primero en el navegador con la cuenta QA —
-- un registro ad-hoc con resultado "Profesora ausente" fallaba siempre al
-- finalizar con "Ocurrió un error inesperado" — y confirmado después
-- contra la base real con una llamada directa): cuando el cliente envía
-- `"attendance": null` (JSON null EXPLÍCITO, no la clave ausente — es
-- justamente lo que manda `saveParticipantAction` cuando todavía no se
-- eligió asistencia, camino real para un participante cuya tarjeta nunca
-- se muestra porque `countsAsClass` es `false`), `p_payload->'attendance'`
-- (flecha simple) devuelve el jsonb escalar `null` — que en Postgres NO
-- es SQL NULL. `if v_attendance is not null then` evalúa VERDADERO
-- igual, así que el código entraba al INSERT e intentaba escribir
-- `v_attendance->>'status'` (que sí es SQL NULL real) en una columna
-- `not null`, reventando con `23502`. Nunca se había disparado antes
-- porque hasta esta ronda, todo llamado real a `save_participant_registration`
-- exigía asistencia ya resuelta en el cliente antes de guardar
-- (`hasResolvedAttendanceStatus`) — el nuevo camino de resultados que no
-- implican que la clase se dictó (`profesora_ausente`/`feriado` sin
-- excepción) es el primero que legítimamente nunca completa ese campo.
--
-- Corrección real: `nullif(x, 'null'::jsonb)` — convierte el jsonb
-- escalar `null` en un SQL NULL real, la única forma correcta de
-- distinguir "no se envió/se limpió explícitamente" de un objeto real,
-- para cualquier acceso `->` (flecha simple) que después se compara con
-- `is not null`. Se aplica en las 4 posiciones reales con este mismo
-- patrón — 2 en cada función.
create or replace function public.save_participant_registration(p_payload jsonb)
returns public.lesson_registration_students
language plpgsql
security invoker
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

revoke all on function public.save_participant_registration(jsonb) from public;
grant execute on function public.save_participant_registration(jsonb) to authenticated;
revoke execute on function public.save_participant_registration(jsonb) from anon;

-- Mismo fix, mismo patrón, para cada participante del bucle de edición.
create or replace function public.edit_completed_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_edit_operation_id uuid := nullif(p_payload->>'edit_operation_id', '')::uuid;
  v_registration public.lesson_registrations;
  v_history_id uuid;
  v_participants jsonb := coalesce(nullif(p_payload->'participants', 'null'::jsonb), '[]'::jsonb);
  v_participant jsonb;
  v_student_id uuid;
  v_attendance jsonb;
  v_evaluation jsonb;
  v_homework_reviews jsonb;
  v_homework_review jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_edit_operation_id is null then
    raise exception 'edit_operation_id es obligatorio.' using errcode = '22023';
  end if;

  select * into v_registration from public.lesson_registrations where id = v_registration_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if v_registration.status <> 'completed' then
    raise exception 'Esta RPC sólo edita registros ya finalizados — usá start_lesson_registration/save_participant_registration/finalize_lesson_registration para el registro inicial.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_participants) as p
    where not exists (
      select 1 from public.lesson_registration_students s
      where s.lesson_registration_id = v_registration_id and s.student_id = (p->>'student_id')::uuid and s.owner_id = v_owner
    )
  ) then
    raise exception 'Ese alumno no forma parte de este registro.' using errcode = 'P0002';
  end if;

  insert into public.lesson_registration_edit_history (owner_id, lesson_registration_id, edit_operation_id, edited_at, previous_snapshot)
  values (
    v_owner, v_registration_id, v_edit_operation_id, now(),
    jsonb_build_object(
      'registration', to_jsonb(v_registration),
      'participants', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.lesson_registration_students s where s.lesson_registration_id = v_registration_id and s.owner_id = v_owner),
      'attendance', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.lesson_registration_attendance a where a.lesson_registration_id = v_registration_id and a.owner_id = v_owner),
      'evaluations', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.lesson_registration_evaluations e where e.lesson_registration_id = v_registration_id and e.owner_id = v_owner),
      'homework_reviews', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.lesson_registration_homework_reviews h where h.lesson_registration_id = v_registration_id and h.owner_id = v_owner)
    )
  )
  on conflict (lesson_registration_id, edit_operation_id) do nothing
  returning id into v_history_id;

  if v_history_id is null then
    return v_registration;
  end if;

  for v_participant in select * from jsonb_array_elements(v_participants)
  loop
    v_student_id := (v_participant->>'student_id')::uuid;
    v_attendance := nullif(v_participant->'attendance', 'null'::jsonb);
    v_evaluation := nullif(v_participant->'evaluation', 'null'::jsonb);
    v_homework_reviews := coalesce(nullif(v_participant->'homework_reviews', 'null'::jsonb), '[]'::jsonb);

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
  end loop;

  update public.lesson_registrations
  set
    homework_description = case when p_payload ? 'homework_description' then nullif(p_payload->>'homework_description', '') else homework_description end,
    homework_due_date = case when p_payload ? 'homework_due_date' then nullif(p_payload->>'homework_due_date', '')::date else homework_due_date end,
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

  return v_registration;
end;
$$;

revoke all on function public.edit_completed_lesson_registration(jsonb) from public;
grant execute on function public.edit_completed_lesson_registration(jsonb) to authenticated;
revoke execute on function public.edit_completed_lesson_registration(jsonb) from anon;
