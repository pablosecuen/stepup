-- TeacherFlow Web — Acciones de clase del Calendario (paridad con la app original): nombre, duración, restaurar y eliminar una clase cancelada.
--
-- Todas son SECURITY INVOKER (corren con los permisos y la RLS de quien llama: una clase o serie ajena no existe a sus ojos), con `search_path` vacío, idempotentes y de UNA sola
-- transacción cada una. Ninguna toca cobros, pagos, registros, asistencias, adjuntos ni reportes: lo único que cambian son campos de `calendar_lessons` / `recurrence_rules` /
-- `recurrence_exceptions`. Una clase con registro pedagógico (aunque sea un borrador) o con cobro asociado nunca se restaura ni se elimina desde acá (se conserva el historial).
--
-- 1) edit_calendar_lesson(p_payload)            — nombre y/o duración de UNA clase («sólo esta clase»). Si es una ocurrencia virtual de una serie la materializa en el mismo horario.
-- 2) edit_recurrence_class_title(p_payload)     — nombre de TODA la serie: la regla y sus clases ya creadas que todavía no pasaron.
-- 3) restore_calendar_occurrence(p_payload)     — vuelve a dejar activa la fecha original de una ocurrencia cancelada o reprogramada.
-- 4) delete_cancelled_calendar_lesson(p_payload) — elimina la tarjeta de una clase cancelada (y excluye la fecha de su serie para que no vuelva a generarse).

-- ---------------------------------------------------------------------------
-- 1) Una sola clase.
-- p_payload = {
--   "lesson_id": uuid | null,                        -- clase ya creada
--   "recurrence_id": uuid | null, "occurrence_key": text | null,   -- ocurrencia virtual de una serie (se materializa)
--   "base": { primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, color, recurrence_index, class_title, activity_kind,
--             participants: [{ student_id, student_name, level }] },   -- sólo si hay que materializar
--   "changes": { "class_title": text | null, "end_at": timestamptz }   -- sólo las claves presentes se cambian; class_title null/vacío vuelve al nombre automático
-- }
-- ---------------------------------------------------------------------------
create or replace function public.edit_calendar_lesson(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson_id uuid := nullif(p_payload->>'lesson_id', '')::uuid;
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_key text := nullif(p_payload->>'occurrence_key', '');
  v_base jsonb := p_payload->'base';
  v_changes jsonb := coalesce(p_payload->'changes', '{}'::jsonb);
  v_lesson public.calendar_lessons;
  v_participant jsonb;
  v_title text;
  v_end timestamptz;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if not (v_changes ? 'class_title' or v_changes ? 'end_at') then
    raise exception 'No hay ningún cambio para guardar.' using errcode = '22023';
  end if;

  if v_lesson_id is not null then
    select * into v_lesson from public.calendar_lessons where id = v_lesson_id and owner_id = v_owner for update;
    if not found then
      raise exception 'Clase no encontrada.' using errcode = 'P0002';
    end if;
  elsif v_recurrence_id is not null and v_key is not null and v_base is not null then
    select * into v_lesson from public.calendar_lessons
      where owner_id = v_owner and recurrence_id = v_recurrence_id and recurrence_occurrence_key = v_key for update;
    if not found then
      if not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
        raise exception 'La serie ya no existe.' using errcode = 'P0002';
      end if;
      if exists (select 1 from public.recurrence_exceptions where recurrence_id = v_recurrence_id and occurrence_key = v_key and owner_id = v_owner) then
        raise exception 'Esta fecha ya no está activa en la serie. Recargá el calendario.' using errcode = '22023';
      end if;
      if not exists (select 1 from public.students where id = (v_base->>'primary_student_id')::uuid and owner_id = v_owner) then
        raise exception 'Alumno no encontrado.' using errcode = 'P0002';
      end if;
      insert into public.calendar_lessons (
        owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color,
        is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_index, recurrence_original_start, class_title, activity_kind
      ) values (
        v_owner,
        (v_base->>'primary_student_id')::uuid,
        v_base->>'student_name',
        v_base->>'level',
        v_base->>'lesson_type',
        (v_base->>'start_at')::timestamptz,
        (v_base->>'end_at')::timestamptz,
        v_base->>'modality',
        'scheduled',
        coalesce(v_base->>'color', '#FCE4D2'),
        true,
        v_recurrence_id,
        v_key,
        (v_base->>'recurrence_index')::int,
        (v_base->>'start_at')::timestamptz,
        nullif(v_base->>'class_title', ''),
        coalesce(v_base->>'activity_kind', 'class')
      )
      on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null do nothing
      returning * into v_lesson;
      if not found then
        select * into v_lesson from public.calendar_lessons
          where owner_id = v_owner and recurrence_id = v_recurrence_id and recurrence_occurrence_key = v_key for update;
      else
        for v_participant in select * from jsonb_array_elements(coalesce(v_base->'participants', '[]'::jsonb))
        loop
          insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
          values (v_owner, v_lesson.id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level')
          on conflict do nothing;
        end loop;
      end if;
    end if;
  else
    raise exception 'Falta identificar la clase.' using errcode = '22023';
  end if;

  if v_lesson.status not in ('scheduled', 'rescheduled') then
    raise exception 'Sólo se puede editar una clase programada: esta ya se dictó o está cancelada.' using errcode = '22023';
  end if;

  if v_changes ? 'class_title' then
    v_title := nullif(btrim(coalesce(v_changes->>'class_title', '')), '');
    if v_title is not null and char_length(v_title) > 60 then
      raise exception 'El nombre no puede superar los 60 caracteres.' using errcode = '22023';
    end if;
    update public.calendar_lessons set class_title = v_title where id = v_lesson.id and owner_id = v_owner returning * into v_lesson;
  end if;
  if v_changes ? 'end_at' then
    v_end := (v_changes->>'end_at')::timestamptz;
    if v_end is null or v_end <= v_lesson.start_at then
      raise exception 'La finalización debe ser posterior al inicio.' using errcode = '22023';
    end if;
    update public.calendar_lessons set end_at = v_end where id = v_lesson.id and owner_id = v_owner returning * into v_lesson;
  end if;

  return v_lesson;
end;
$$;

revoke all on function public.edit_calendar_lesson(jsonb) from public, anon;
grant execute on function public.edit_calendar_lesson(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Nombre de toda la serie. p_payload = { "rule_id": uuid, "class_title": text | null }
-- Devuelve cuántas clases ya creadas (futuras y programadas) se renombraron. Las pasadas no se tocan.
-- ---------------------------------------------------------------------------
create or replace function public.edit_recurrence_class_title(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_rule_id uuid := nullif(p_payload->>'rule_id', '')::uuid;
  v_title text := nullif(btrim(coalesce(p_payload->>'class_title', '')), '');
  v_count int;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_rule_id is null then
    raise exception 'Falta la serie.' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 60 then
    raise exception 'El nombre no puede superar los 60 caracteres.' using errcode = '22023';
  end if;
  update public.recurrence_rules set class_title = v_title where id = v_rule_id and owner_id = v_owner;
  if not found then
    raise exception 'La serie ya no existe.' using errcode = 'P0002';
  end if;
  update public.calendar_lessons
    set class_title = v_title
    where owner_id = v_owner and recurrence_id = v_rule_id and status in ('scheduled', 'rescheduled') and start_at > now();
  get diagnostics v_count = row_count;
  return jsonb_build_object('lessons', v_count);
end;
$$;

revoke all on function public.edit_recurrence_class_title(jsonb) from public, anon;
grant execute on function public.edit_recurrence_class_title(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Restaurar una ocurrencia cancelada o reprogramada. p_payload = { "lesson_id": uuid }
-- Vuelve a su fecha y hora originales (conserva la duración) y deja de figurar como excepción de la serie. No se restaura una clase con registro o con cobro asociado.
-- ---------------------------------------------------------------------------
create or replace function public.restore_calendar_occurrence(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.calendar_lessons;
  v_original timestamptz;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  select * into v_lesson from public.calendar_lessons where id = nullif(p_payload->>'lesson_id', '')::uuid and owner_id = v_owner for update;
  if not found then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;
  if v_lesson.recurrence_id is null or v_lesson.recurrence_occurrence_key is null then
    raise exception 'La clase cancelada no pertenece a una repetición: no hay una fecha original para restaurar.' using errcode = '22023';
  end if;
  if v_lesson.status = 'scheduled' then
    return v_lesson; -- ya estaba restaurada (reintento)
  end if;
  if v_lesson.status not in ('cancelled', 'rescheduled') then
    raise exception 'Sólo se restaura una clase cancelada o reprogramada.' using errcode = '22023';
  end if;
  if exists (select 1 from public.lesson_registrations r where r.calendar_lesson_id = v_lesson.id and r.owner_id = v_owner)
     or exists (select 1 from public.payment_charges c where c.calendar_lesson_id = v_lesson.id and c.owner_id = v_owner) then
    raise exception 'Esta clase tiene un registro o un cobro asociado: no se restaura para conservar el historial.' using errcode = '22023';
  end if;

  v_original := coalesce(v_lesson.recurrence_original_start, v_lesson.start_at);
  update public.calendar_lessons
    set status = 'scheduled', start_at = v_original, end_at = v_original + (v_lesson.end_at - v_lesson.start_at), recurrence_original_start = v_original
    where id = v_lesson.id and owner_id = v_owner
    returning * into v_lesson;

  delete from public.recurrence_exceptions
    where owner_id = v_owner and recurrence_id = v_lesson.recurrence_id and occurrence_key = v_lesson.recurrence_occurrence_key and exception_type in ('cancelled', 'rescheduled');

  return v_lesson;
end;
$$;

revoke all on function public.restore_calendar_occurrence(jsonb) from public, anon;
grant execute on function public.restore_calendar_occurrence(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Eliminar la tarjeta de una clase cancelada. p_payload = { "lesson_id": uuid }
-- Una ocurrencia de serie queda EXCLUIDA (no vuelve a generarse); una clase suelta se elimina. Nunca si tiene registro o cobro asociado.
-- ---------------------------------------------------------------------------
create or replace function public.delete_cancelled_calendar_lesson(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.calendar_lessons;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  select * into v_lesson from public.calendar_lessons where id = nullif(p_payload->>'lesson_id', '')::uuid and owner_id = v_owner for update;
  if not found then
    -- Ya eliminada (reintento o doble envío): no es un error.
    return jsonb_build_object('deleted', false);
  end if;
  if v_lesson.status <> 'cancelled' then
    raise exception 'Primero cancelá la clase antes de eliminarla.' using errcode = '22023';
  end if;
  if exists (select 1 from public.lesson_registrations r where r.calendar_lesson_id = v_lesson.id and r.owner_id = v_owner)
     or exists (select 1 from public.payment_charges c where c.calendar_lesson_id = v_lesson.id and c.owner_id = v_owner) then
    raise exception 'Esta clase cancelada tiene un registro o un cobro asociado: no se elimina para conservar el historial.' using errcode = '22023';
  end if;

  if v_lesson.recurrence_id is not null and v_lesson.recurrence_occurrence_key is not null then
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type)
    values (v_owner, v_lesson.recurrence_id, v_lesson.recurrence_occurrence_key, 'excluded')
    on conflict (recurrence_id, occurrence_key) do update set exception_type = 'excluded', replacement_lesson_id = null;
  end if;
  delete from public.calendar_lessons where id = v_lesson.id and owner_id = v_owner;

  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.delete_cancelled_calendar_lesson(jsonb) from public, anon;
grant execute on function public.delete_cancelled_calendar_lesson(jsonb) to authenticated;
