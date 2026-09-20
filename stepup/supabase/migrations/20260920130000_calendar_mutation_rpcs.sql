-- TeacherFlow Web — Fase 3: RPCs de Calendario.
-- Migración aditiva — ninguna tabla nueva, ninguna columna nueva. Todas las
-- funciones son `security invoker` (RLS sigue aplicando exactamente igual
-- que en una consulta directa) y validan `auth.uid()` explícitamente como
-- defensa en profundidad. `revoke ... from public` + `grant ... to
-- authenticated` en todas — nunca ejecutables por `anon`.
--
-- IMPORTANTE: escrita en la sesión de Fase 3, pendiente de autorización
-- explícita del usuario antes de `supabase db push` (regla de la tarea).
-- Mientras no se aplique, ninguna de las mutaciones de calendario funciona
-- contra la base real.

-- ---------------------------------------------------------------------------
-- 1) Crear una clase única (sin recurrencia) + sus participantes, atómico.
-- ---------------------------------------------------------------------------
create or replace function public.create_calendar_lesson(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.calendar_lessons;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  insert into public.calendar_lessons (
    owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
    modality, status, color, is_recurring, class_title, activity_kind, notes, freed_by_lesson_id
  ) values (
    v_owner,
    (p_payload->>'primary_student_id')::uuid,
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
    -- "Reemplazar con otro alumno": esta clase nueva libera/reemplaza a la
    -- cancelada que apunta acá — trazabilidad pura, nunca afecta conflictos
    -- ni cobros (ver lib/calendar/mutations.ts, `getCancelledSlotReuseDecision`).
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

-- ---------------------------------------------------------------------------
-- 2) Crear una serie recurrente + sus participantes, atómico. NUNCA
--    materializa ocurrencias futuras — sólo la regla; las ocurrencias se
--    generan en memoria al leer (ver lib/calendar/recurrence-engine.ts).
-- ---------------------------------------------------------------------------
create or replace function public.create_recurrence_series(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_rule public.recurrence_rules;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  insert into public.recurrence_rules (
    owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality,
    timezone, start_date, end_date, status, class_title, activity_kind
  ) values (
    v_owner,
    nullif(p_payload->>'primary_student_id', '')::uuid,
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

revoke all on function public.create_recurrence_series(jsonb) from public;
grant execute on function public.create_recurrence_series(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Cancelar una ocurrencia (virtual o ya materializada), atómico e
--    idempotente. Si es de una serie: upsert de la clase materializada con
--    status='cancelled' (por (recurrence_id, recurrence_occurrence_key),
--    único real) + excepción 'cancelled' (upsert por (recurrence_id,
--    occurrence_key), único real) — repetir la operación nunca duplica
--    nada, sólo confirma el mismo resultado. Si es una clase suelta (sin
--    recurrence_id): sólo actualiza su propio status.
-- ---------------------------------------------------------------------------
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

revoke all on function public.cancel_calendar_occurrence(jsonb) from public;
grant execute on function public.cancel_calendar_occurrence(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Reprogramar una ocurrencia — crea una clase nueva en el horario nuevo
--    (status='rescheduled') y, si es de una serie, la excepción
--    'rescheduled' con `replacement_lesson_id`. Atómico.
-- ---------------------------------------------------------------------------
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
  v_new_lesson public.calendar_lessons;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if (p_payload->>'new_start_at')::timestamptz >= (p_payload->>'new_end_at')::timestamptz then
    raise exception 'El horario nuevo es inválido.' using errcode = '22023';
  end if;

  insert into public.calendar_lessons (
    owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
    modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
    recurrence_original_start, class_title, activity_kind
  ) values (
    v_owner,
    (p_payload->>'primary_student_id')::uuid,
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
    -- La clase NUEVA nunca reutiliza el occurrence_key original (ese key
    -- identifica el slot viejo, que queda marcado 'rescheduled' vía la
    -- excepción); se guarda null para no violar el índice único.
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

revoke all on function public.reschedule_calendar_occurrence(jsonb) from public;
grant execute on function public.reschedule_calendar_occurrence(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) "Esta y las siguientes" — split de una serie en original truncada +
--    sucesora. Atómico e IDEMPOTENTE: la identidad real de la operación es
--    (supersedes_recurrence_id, effective_from_date) — si ya existe una
--    sucesora con esa combinación exacta, se devuelve tal cual, nunca se
--    crea una segunda (nunca hace falta un id determinístico inventado,
--    a diferencia del móvil sobre AsyncStorage).
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
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  -- Idempotencia real: ¿ya existe una sucesora de este linaje con esta
  -- misma fecha efectiva? Si sí, esta llamada es un no-op — nunca duplica.
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

  update public.recurrence_rules
  set status = (v_original_patch->>'status'),
      end_date = nullif(v_original_patch->>'end_date', '')::date
  where id = v_original_id and owner_id = v_owner;

  -- El id de la sucesora se genera en TypeScript ANTES de llamar a este RPC
  -- (nunca el default `gen_random_uuid()`) porque `excluded_occurrence_keys`
  -- ya viene calculado con ese id embebido en cada `occurrence_key`
  -- (ver lib/calendar/split.ts, `buildExcludedOccurrenceKeys`) — evita el
  -- problema de "necesito el id antes de que exista la fila". Un reintento
  -- (id nuevo, mismo original+fecha) nunca llega a usarse: la verificación
  -- de idempotencia de arriba ya devolvió la sucesora real antes de este insert.
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

  -- Nunca modifica ocurrencias anteriores: las clases materializadas ya
  -- pasadas o `completed` de la regla original no se tocan acá. Sólo se
  -- retiran las materializaciones FUTURAS y no completadas que hayan
  -- quedado fuera del nuevo límite de la original (si existieran) —
  -- limpieza mínima, nunca borra historial real.
  delete from public.calendar_lessons
  where owner_id = v_owner
    and recurrence_id = v_original_id
    and status not in ('completed', 'cancelled')
    and coalesce(recurrence_original_start, start_at) >= v_effective_date::timestamptz;

  return v_successor;
end;
$$;

revoke all on function public.split_recurrence_this_and_future(jsonb) from public;
grant execute on function public.split_recurrence_this_and_future(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Cambiar participantes de una serie completa (alcance "esta y las
--    siguientes" simplificado — ver nota en lib/calendar/participants.ts):
--    reemplaza el roster completo de `recurrence_rule_participants` en una
--    sola transacción.
-- ---------------------------------------------------------------------------
create or replace function public.set_recurrence_participants(p_rule_id uuid, p_participant_ids uuid[])
returns void
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  perform 1 from public.recurrence_rules where id = p_rule_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
  end if;

  delete from public.recurrence_rule_participants where recurrence_rule_id = p_rule_id and owner_id = v_owner;
  insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
  select v_owner, p_rule_id, unnest(p_participant_ids);
end;
$$;

revoke all on function public.set_recurrence_participants(uuid, uuid[]) from public;
grant execute on function public.set_recurrence_participants(uuid, uuid[]) to authenticated;
