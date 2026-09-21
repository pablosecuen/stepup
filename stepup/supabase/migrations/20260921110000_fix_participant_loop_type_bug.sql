-- TeacherFlow Web — corrección aditiva de un bug real encontrado en la
-- PRIMERA verificación end-to-end real de "crear serie" y "esta y las
-- siguientes" en el navegador (con datos reales, cuenta de prueba). NUNCA
-- edita las migraciones ya aplicadas — redefine las funciones con
-- `create or replace function`, mismo nombre y firma.
--
-- Causa raíz: en `create_recurrence_series` y `split_recurrence_this_and_future`,
-- la variable de bucle usada para recorrer `participant_ids` estaba
-- declarada `jsonb`:
--
--   v_participant jsonb;
--   ...
--   for v_participant in select * from jsonb_array_elements_text(p_payload->'participant_ids')
--
-- `jsonb_array_elements_text` devuelve TEXTO plano (un uuid como
-- "900fa18b-deba-437a-a521-d5d34526847f"), no jsonb. Asignar ese texto a
-- una variable declarada `jsonb` dispara un cast implícito text->jsonb, que
-- Postgres intenta resolver parseando el valor como JSON — y un uuid sin
-- comillas no es JSON válido, así que la llamada fallaba siempre con
-- `22P02 invalid input syntax for type json` en cuanto `participant_ids`
-- tenía al menos un elemento (es decir, siempre en el uso real). Este bug
-- ya estaba en la migración original de Fase 3
-- (`20260920130000_calendar_mutation_rpcs.sql`, nunca antes probada
-- end-to-end con datos reales) y se heredó sin querer al reescribir estas
-- dos funciones completas en la migración correctiva anterior
-- (`20260921100000_...`). Nunca se detectó porque hasta esta ronda de
-- verificación ninguna sesión había creado una serie real en el navegador.
--
-- Corrección: la variable de bucle pasa a ser `text` (coincide con lo que
-- `jsonb_array_elements_text` realmente devuelve); el resto de cada función
-- queda idéntico, incluidas las verificaciones de propiedad agregadas en la
-- migración correctiva anterior.

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
