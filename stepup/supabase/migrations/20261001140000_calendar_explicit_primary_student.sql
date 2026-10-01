-- TeacherFlow Web — Fase 10, bloque corto: selección explícita del alumno
-- principal en Calendario.
--
-- Hallazgo confirmado por auditoría (ver docs/WEB_PARITY_PLAN.md): hasta
-- esta migración, 4 RPC validaban que `primary_student_id` perteneciera al
-- owner autenticado, pero NINGUNA validaba que ese alumno estuviera
-- realmente DENTRO del roster de participantes que la misma llamada
-- enviaba — un payload podía (vía PostgREST directo, nunca desde la UI
-- real hasta ahora) declarar un principal que ni siquiera formara parte de
-- la clase/serie. Además, dos de las cuatro ni siquiera recibían un
-- `primary_student_id` nuevo:
--   - `split_recurrence_this_and_future` copiaba ciegamente
--     `v_original.primary_student_id` a la serie sucesora, sin validar que
--     siguiera en el roster nuevo (si se lo desmarcaba, la sucesora
--     quedaba con un `primary_student_id` que ya no era su propio
--     participante).
--   - `apply_recurrence_participants_from_date` nunca tocaba
--     `recurrence_rules.primary_student_id` en absoluto al cambiar el
--     roster — mismo problema si el principal se desmarcaba.
--
-- Esta migración, para las 4 RPC (`create_calendar_lesson`,
-- `create_recurrence_series`, `split_recurrence_this_and_future`,
-- `apply_recurrence_participants_from_date`), nunca cambia su modo de
-- seguridad (siguen `security invoker`, fuera de alcance del hardening de
-- B/D de Calendario — bloque aparte, no tocado acá):
--   1. `primary_student_id` pasa a ser SIEMPRE obligatorio (antes
--      `create_recurrence_series` lo permitía `null` si no se verificaba
--      — ya nunca lo hace).
--   2. Se valida que `primary_student_id` pertenezca al owner (ya existía
--      en 3 de las 4, agregado en la que faltaba).
--   3. NUEVO: se valida que `primary_student_id` esté DENTRO del roster de
--      participantes recibido en la MISMA llamada — un payload
--      contradictorio (principal fuera del roster) se rechaza siempre,
--      nunca se ignora en silencio.
--   4. `split_recurrence_this_and_future`/`apply_recurrence_participants_from_date`
--      ahora reciben y PERSISTEN el `primary_student_id` real (elegido
--      explícitamente por la profesora cuando corresponde, nunca inferido
--      por orden de array) en vez de heredarlo ciegamente o ignorarlo.
--
-- El resto de cada función queda idéntico — nunca se toca asistencia,
-- evaluación, cobros, archivado, ni el resto de las validaciones ya
-- existentes.

create or replace function public.create_calendar_lesson(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_primary_student_id uuid := (p_payload->>'primary_student_id')::uuid;
  v_lesson public.calendar_lessons;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where not exists (select 1 from public.students where id = (p->>'student_id')::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where (p->>'student_id')::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  insert into public.calendar_lessons (
    owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
    modality, status, color, is_recurring, class_title, activity_kind, notes, freed_by_lesson_id
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
    false,
    nullif(p_payload->>'class_title', ''),
    coalesce(p_payload->>'activity_kind', 'class'),
    nullif(p_payload->>'notes', ''),
    nullif(p_payload->>'freed_by_lesson_id', '')::uuid
  )
  returning * into v_lesson;

  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
    values (v_owner, v_lesson.id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level');
  end loop;

  return v_lesson;
end;
$$;

revoke all on function public.create_calendar_lesson(jsonb) from public;
grant execute on function public.create_calendar_lesson(jsonb) to authenticated;
revoke execute on function public.create_calendar_lesson(jsonb) from anon;

create or replace function public.create_recurrence_series(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_rule public.recurrence_rules;
  v_participant_id text;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_primary_student_id is null then
    raise exception 'Elegí quién es el alumno principal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid where sid::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  insert into public.recurrence_rules (
    owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality,
    timezone, start_date, end_date, status, class_title, activity_kind
  ) values (
    v_owner,
    v_primary_student_id,
    p_payload->>'rule_type',
    (p_payload->>'cycle_length_weeks')::smallint,
    p_payload->'weeks',
    p_payload->>'modality',
    p_payload->>'timezone',
    (p_payload->>'start_date')::date,
    nullif(p_payload->>'end_date', '')::date,
    'active',
    nullif(p_payload->>'class_title', ''),
    coalesce(p_payload->>'activity_kind', 'class')
  )
  returning * into v_rule;

  for v_participant_id in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_rule.id, v_participant_id::uuid);
  end loop;

  return v_rule;
end;
$$;

revoke all on function public.create_recurrence_series(jsonb) from public;
grant execute on function public.create_recurrence_series(jsonb) to authenticated;
revoke execute on function public.create_recurrence_series(jsonb) from anon;

create or replace function public.split_recurrence_this_and_future(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_original_id uuid := (p_payload->>'original_recurrence_id')::uuid;
  v_effective_date date := (p_payload->>'effective_date')::date;
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_existing_successor public.recurrence_rules;
  v_original public.recurrence_rules;
  v_successor public.recurrence_rules;
  v_original_patch jsonb := p_payload->'original_patch';
  v_participant_id text;
  v_excluded_key text;
  v_effective_instant timestamptz;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_existing_successor
  from public.recurrence_rules
  where owner_id = v_owner and supersedes_recurrence_id = v_original_id and effective_from_date = v_effective_date
  limit 1;
  if found then
    return v_existing_successor;
  end if;

  select * into v_original from public.recurrence_rules where id = v_original_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Serie original no encontrada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  if v_primary_student_id is null then
    raise exception 'Elegí quién es el alumno principal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid where sid::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  v_effective_instant := (v_effective_date::text || ' 00:00:00')::timestamp at time zone v_original.timezone;

  update public.recurrence_rules
  set status = (v_original_patch->>'status'),
      end_date = nullif(v_original_patch->>'end_date', '')::date
  where id = v_original_id and owner_id = v_owner;

  insert into public.recurrence_rules (
    id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone,
    start_date, end_date, status, supersedes_recurrence_id, effective_from_date,
    class_title, activity_kind, training_billing_agreement_id
  ) values (
    (p_payload->>'successor_id')::uuid,
    v_owner,
    v_primary_student_id,
    p_payload->>'rule_type',
    (p_payload->>'cycle_length_weeks')::smallint,
    p_payload->'weeks',
    coalesce(p_payload->>'modality', v_original.modality),
    v_original.timezone,
    (p_payload->>'successor_start_date')::date,
    nullif(p_payload->>'successor_end_date', '')::date,
    'active',
    v_original_id,
    v_effective_date,
    coalesce(p_payload->>'class_title', v_original.class_title),
    coalesce(p_payload->>'activity_kind', v_original.activity_kind),
    v_original.training_billing_agreement_id
  )
  returning * into v_successor;

  update public.recurrence_rules set superseded_by_recurrence_id = v_successor.id where id = v_original_id and owner_id = v_owner;

  for v_participant_id in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_successor.id, v_participant_id::uuid)
    on conflict (recurrence_rule_id, student_id) do nothing;
  end loop;

  for v_excluded_key in select * from jsonb_array_elements_text(p_payload->'excluded_occurrence_keys')
  loop
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type)
    values (v_owner, v_successor.id, v_excluded_key, 'excluded')
    on conflict (recurrence_id, occurrence_key) do nothing;
  end loop;

  delete from public.calendar_lessons
  where owner_id = v_owner
    and recurrence_id = v_original_id
    and status not in ('completed', 'cancelled')
    and coalesce(recurrence_original_start, start_at) >= v_effective_instant;

  return v_successor;
end;
$$;

revoke all on function public.split_recurrence_this_and_future(jsonb) from public;
grant execute on function public.split_recurrence_this_and_future(jsonb) to authenticated;
revoke execute on function public.split_recurrence_this_and_future(jsonb) from anon;

create or replace function public.apply_recurrence_participants_from_date(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_rule_id uuid := (p_payload->>'rule_id')::uuid;
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_freeze jsonb;
  v_participant jsonb;
  v_new_lesson_id uuid;
  v_result public.recurrence_rules;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  perform 1 from public.recurrence_rules where id = v_rule_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'new_participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  if v_primary_student_id is null then
    raise exception 'Elegí quién es el alumno principal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(p_payload->'new_participant_ids') as sid where sid::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  for v_freeze in select * from jsonb_array_elements(p_payload->'freeze_occurrences')
  loop
    v_new_lesson_id := null;

    insert into public.calendar_lessons (
      owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
      modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
      recurrence_index, recurrence_original_start, class_title, activity_kind
    ) values (
      v_owner,
      (v_freeze->>'primary_student_id')::uuid,
      v_freeze->>'student_name',
      v_freeze->>'level',
      v_freeze->>'lesson_type',
      (v_freeze->>'start_at')::timestamptz,
      (v_freeze->>'end_at')::timestamptz,
      v_freeze->>'modality',
      'scheduled',
      coalesce(v_freeze->>'color', '#FCE4D2'),
      true,
      v_rule_id,
      v_freeze->>'occurrence_key',
      (v_freeze->>'recurrence_index')::int,
      (v_freeze->>'start_at')::timestamptz,
      nullif(v_freeze->>'class_title', ''),
      coalesce(v_freeze->>'activity_kind', 'class')
    )
    on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
    do nothing
    returning id into v_new_lesson_id;

    if v_new_lesson_id is not null then
      for v_participant in select * from jsonb_array_elements(v_freeze->'participants')
      loop
        insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
        values (v_owner, v_new_lesson_id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level')
        on conflict (calendar_lesson_id, student_id) do nothing;
      end loop;
    end if;
  end loop;

  delete from public.recurrence_rule_participants where recurrence_rule_id = v_rule_id and owner_id = v_owner;
  insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
  select v_owner, v_rule_id, x::uuid from jsonb_array_elements_text(p_payload->'new_participant_ids') as x;

  update public.recurrence_rules
  set updated_at = now(), primary_student_id = v_primary_student_id
  where id = v_rule_id and owner_id = v_owner
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.apply_recurrence_participants_from_date(jsonb) from public;
grant execute on function public.apply_recurrence_participants_from_date(jsonb) to authenticated;
revoke execute on function public.apply_recurrence_participants_from_date(jsonb) from anon;
