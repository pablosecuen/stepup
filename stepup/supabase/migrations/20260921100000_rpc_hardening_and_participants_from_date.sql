-- TeacherFlow Web — corrección aditiva sobre las RPC de Fase 2/3, NUNCA una
-- edición de las migraciones ya aplicadas (`20260920120000_student_mutation_rpcs.sql`,
-- `20260920130000_calendar_mutation_rpcs.sql`) — regla del proyecto. Toda
-- función se redefine con `create or replace function` (mismo nombre y
-- misma firma, salvo donde se indica explícitamente lo contrario).
--
-- Motivado por la auditoría de seguridad pedida al cerrar las brechas de
-- Fase 2/3. Cuatro problemas reales encontrados, los cuatro corregidos acá:
--
-- 1) `rename_custom_level`/`change_student_status` (Fase 2) nunca tenían un
--    `revoke ... from public` — Postgres otorga EXECUTE a PUBLIC por
--    defecto al crear una función. La protección real dependía únicamente
--    del chequeo interno `auth.uid() is null` (que sí funciona, confirmado
--    con sondeo anónimo), pero no había defensa en profundidad a nivel de
--    permisos, a diferencia de las 6 funciones de calendario (que sí
--    tenían el revoke desde el principio).
--
-- 2) `create_calendar_lesson`, `create_recurrence_series`,
--    `cancel_calendar_occurrence`, `reschedule_calendar_occurrence` nunca
--    verificaban que los `student_id`/`recurrence_id` referenciados en el
--    payload pertenecieran al propio `owner_id` — un usuario autenticado
--    que ya conociera (o adivinara) el UUID de un alumno o de una serie
--    ajena podía crear filas hijas (`calendar_lesson_participants`,
--    `recurrence_exceptions`, `calendar_lessons`) que referencian esa fila
--    ajena. RLS impide que el usuario ajeno LEA esas filas fabricadas (le
--    pertenecen sólo al atacante), pero la referencia cruzada igual es una
--    anomalía real de integridad — por ejemplo, puede bloquear con
--    `on delete restrict` el borrado legítimo del alumno por su verdadero
--    dueño. Ahora las 4 funciones verifican explícitamente la propiedad
--    antes de escribir cualquier fila hija.
--
-- 3) `split_recurrence_this_and_future`: el `delete` de limpieza comparaba
--    `coalesce(recurrence_original_start, start_at) >= v_effective_date::timestamptz`
--    — castear una fecha a `timestamptz` interpreta la medianoche en el
--    timezone de LA SESIÓN de Postgres (UTC en Supabase), no en
--    `America/Argentina/Buenos_Aires` (UTC-3). Una clase entre las 21:00 y
--    las 23:59 hora de Buenos Aires del día ANTERIOR a la fecha efectiva
--    podía borrarse por error (su instante UTC cae después de la
--    medianoche UTC, aunque en Buenos Aires todavía es el día de antes).
--    Corregido con `(fecha || ' 00:00:00')::timestamp at time zone tz`.
--
-- 4) Falta un mecanismo real para "cambiar participantes de una serie
--    desde una fecha, sin tocar el patrón" — la función
--    `set_recurrence_participants(uuid, uuid[])` existía pero NUNCA se
--    invocaba desde ninguna acción real (código muerto), y de haberse
--    usado directamente habría reescrito el roster de TODAS las
--    ocurrencias virtuales de la regla, incluidas las anteriores a "ahora"
--    — reinterpretando el pasado. El móvil resuelve esto con
--    `planParticipantsFromDate`: congela/materializa con el roster VIEJO
--    cualquier ocurrencia virtual entre "ahora" y la fecha efectiva que
--    todavía no esté materializada, y sólo entonces cambia el roster de la
--    regla. Se da de baja la función vieja (nunca se usó) y se agrega
--    `apply_recurrence_participants_from_date`, que hace ambas cosas en
--    una sola transacción atómica.

-- ---------------------------------------------------------------------------
-- 1) Fase 2 — agrega el revoke que faltaba (misma firma, mismo cuerpo).
-- ---------------------------------------------------------------------------
revoke all on function public.rename_custom_level(uuid, text) from public;
revoke all on function public.change_student_status(uuid, text, date, text, text) from public;

-- ---------------------------------------------------------------------------
-- 2) Fase 3 — verificación de propiedad de alumnos/series referenciados.
-- ---------------------------------------------------------------------------
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

create or replace function public.create_recurrence_series(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_rule public.recurrence_rules;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_primary_student_id is not null and not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
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

  for v_participant in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_rule.id, v_participant::uuid);
  end loop;

  return v_rule;
end;
$$;

create or replace function public.cancel_calendar_occurrence(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson_id uuid := nullif(p_payload->>'lesson_id', '')::uuid;
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_occurrence_key text := nullif(p_payload->>'occurrence_key', '');
  v_result public.calendar_lessons;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_recurrence_id is not null and not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
  end if;

  if v_recurrence_id is not null and v_occurrence_key is not null then
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type)
    values (v_owner, v_recurrence_id, v_occurrence_key, 'cancelled')
    on conflict (recurrence_id, occurrence_key) do update set exception_type = 'cancelled';

    if v_lesson_id is not null then
      update public.calendar_lessons
      set status = 'cancelled'
      where id = v_lesson_id and owner_id = v_owner
      returning * into v_result;
    else
      insert into public.calendar_lessons (
        owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
        modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
        recurrence_index, recurrence_original_start, class_title, activity_kind
      ) values (
        v_owner,
        (p_payload->>'primary_student_id')::uuid,
        p_payload->>'student_name',
        p_payload->>'level',
        p_payload->>'lesson_type',
        (p_payload->>'start_at')::timestamptz,
        (p_payload->>'end_at')::timestamptz,
        p_payload->>'modality',
        'cancelled',
        coalesce(p_payload->>'color', '#FCE4D2'),
        true,
        v_recurrence_id,
        v_occurrence_key,
        (p_payload->>'recurrence_index')::int,
        (p_payload->>'start_at')::timestamptz,
        nullif(p_payload->>'class_title', ''),
        coalesce(p_payload->>'activity_kind', 'class')
      )
      on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
      do update set status = 'cancelled'
      returning * into v_result;
    end if;
  else
    update public.calendar_lessons
    set status = 'cancelled'
    where id = v_lesson_id and owner_id = v_owner
    returning * into v_result;
  end if;

  if v_result.id is null then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.reschedule_calendar_occurrence(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_occurrence_key text := nullif(p_payload->>'occurrence_key', '');
  v_original_lesson_id uuid := nullif(p_payload->>'original_lesson_id', '')::uuid;
  v_primary_student_id uuid := (p_payload->>'primary_student_id')::uuid;
  v_new_lesson public.calendar_lessons;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if (p_payload->>'new_start_at')::timestamptz >= (p_payload->>'new_end_at')::timestamptz then
    raise exception 'El horario nuevo es inválido.' using errcode = '22023';
  end if;
  if v_recurrence_id is not null and not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
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

  insert into public.calendar_lessons (
    owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
    modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
    recurrence_original_start, class_title, activity_kind
  ) values (
    v_owner,
    v_primary_student_id,
    p_payload->>'student_name',
    p_payload->>'level',
    p_payload->>'lesson_type',
    (p_payload->>'new_start_at')::timestamptz,
    (p_payload->>'new_end_at')::timestamptz,
    p_payload->>'modality',
    'rescheduled',
    coalesce(p_payload->>'color', '#FCE4D2'),
    v_recurrence_id is not null,
    v_recurrence_id,
    null,
    coalesce((p_payload->>'original_start_at')::timestamptz, (p_payload->>'new_start_at')::timestamptz),
    nullif(p_payload->>'class_title', ''),
    coalesce(p_payload->>'activity_kind', 'class')
  )
  returning * into v_new_lesson;

  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
    values (v_owner, v_new_lesson.id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level');
  end loop;

  if v_recurrence_id is not null and v_occurrence_key is not null then
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type, replacement_lesson_id)
    values (v_owner, v_recurrence_id, v_occurrence_key, 'rescheduled', v_new_lesson.id)
    on conflict (recurrence_id, occurrence_key) do update set exception_type = 'rescheduled', replacement_lesson_id = v_new_lesson.id;
  elsif v_original_lesson_id is not null then
    update public.calendar_lessons set status = 'rescheduled' where id = v_original_lesson_id and owner_id = v_owner;
  end if;

  return v_new_lesson;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) split_recurrence_this_and_future — corte a medianoche real en el
--    timezone de la regla (nunca UTC implícito) + verificación de
--    propiedad de los participantes de la sucesora.
-- ---------------------------------------------------------------------------
create or replace function public.split_recurrence_this_and_future(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_original_id uuid := (p_payload->>'original_recurrence_id')::uuid;
  v_effective_date date := (p_payload->>'effective_date')::date;
  v_existing_successor public.recurrence_rules;
  v_original public.recurrence_rules;
  v_successor public.recurrence_rules;
  v_original_patch jsonb := p_payload->'original_patch';
  v_participant jsonb;
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

  -- Medianoche real en el timezone de la propia regla (nunca la medianoche
  -- UTC de la sesión de Postgres) — una clase entre las 21:00 y las 23:59
  -- hora de Buenos Aires del día anterior nunca debe caer del lado
  -- "futuro" de este corte.
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
    v_original.primary_student_id,
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

  for v_participant in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_successor.id, v_participant::uuid)
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

-- ---------------------------------------------------------------------------
-- 4) set_recurrence_participants(uuid, uuid[]) — código muerto, nunca
--    invocado desde ninguna acción real; se da de baja porque su reemplazo
--    (abajo) es la única forma segura de cambiar participantes.
-- ---------------------------------------------------------------------------
drop function if exists public.set_recurrence_participants(uuid, uuid[]);

-- ---------------------------------------------------------------------------
-- 5) apply_recurrence_participants_from_date — cambiar participantes de una
--    serie DESDE una fecha, sin tocar el patrón ni crear una serie nueva.
--    Congela/materializa con el roster VIEJO cualquier ocurrencia virtual
--    entre "ahora" y la fecha efectiva que todavía no esté materializada
--    (payload ya calculado en TypeScript con `planParticipantFreeze`,
--    puerto de `planParticipantsFromDate` del móvil), y sólo entonces
--    reemplaza el roster de la regla. Atómico: si cualquier paso falla,
--    ninguna clase queda congelada a medias y el roster no cambia.
-- ---------------------------------------------------------------------------
create or replace function public.apply_recurrence_participants_from_date(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_rule_id uuid := (p_payload->>'rule_id')::uuid;
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
    -- Nunca pisa una ocurrencia que otra operación haya materializado mientras
    -- tanto (cancelación, reprogramación) — esta función sólo congela roster,
    -- nunca compite por el estado real de la clase.
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

  select * into v_result from public.recurrence_rules where id = v_rule_id and owner_id = v_owner;
  return v_result;
end;
$$;

revoke all on function public.create_calendar_lesson(jsonb) from public;
revoke all on function public.create_recurrence_series(jsonb) from public;
revoke all on function public.cancel_calendar_occurrence(jsonb) from public;
revoke all on function public.reschedule_calendar_occurrence(jsonb) from public;
revoke all on function public.split_recurrence_this_and_future(jsonb) from public;
revoke all on function public.apply_recurrence_participants_from_date(jsonb) from public;

grant execute on function public.create_calendar_lesson(jsonb) to authenticated;
grant execute on function public.create_recurrence_series(jsonb) to authenticated;
grant execute on function public.cancel_calendar_occurrence(jsonb) to authenticated;
grant execute on function public.reschedule_calendar_occurrence(jsonb) to authenticated;
grant execute on function public.split_recurrence_this_and_future(jsonb) to authenticated;
grant execute on function public.apply_recurrence_participants_from_date(jsonb) to authenticated;

comment on function public.apply_recurrence_participants_from_date(jsonb) is
  'Cambia el roster de una serie desde una fecha efectiva: congela con el roster viejo toda ocurrencia virtual no materializada entre ahora y esa fecha, después reemplaza el roster de la regla. Nunca crea una serie nueva (a diferencia de split_recurrence_this_and_future, que es sólo para cambios de patrón).';
