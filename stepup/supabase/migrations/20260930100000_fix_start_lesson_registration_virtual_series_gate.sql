-- TeacherFlow Web — corrección aditiva de un bug preexistente (ajeno a
-- Fase 10/archivado, encontrado durante el E2E de archivado al intentar
-- registrar la primera vez una ocurrencia de serie todavía virtual).
--
-- Causa exacta: `start_lesson_registration` (definida originalmente en
-- 20260921120000, redefinida en 20260922100000 al sumar el registro
-- ad-hoc, y de nuevo sin cambios en este punto en 20260925100000 — todas
-- YA APLICADAS, ninguna se toca acá) exige `operation_id` cuando
-- `calendar_lesson_id is null`, SIN considerar que una ocurrencia de serie
-- todavía virtual también tiene `calendar_lesson_id = null` de forma
-- legítima (se materializa recién más abajo, en el bloque siguiente). El
-- chequeo de `operation_id` corre ANTES de ese bloque de materialización,
-- así que cualquier primer registro de una ocurrencia de serie (individual
-- O grupal, nunca fue específico de grupo) se rechaza con "operation_id es
-- obligatorio para un registro ad-hoc." — un falso rechazo, reproducido
-- real vía SQL directo contra ambos casos.
--
-- Auditoría de restricciones reales (ya aplicadas, confirmadas suficientes
-- — no hace falta ninguna restricción nueva):
--   - `calendar_lessons_recurrence_occurrence_unique` on
--     (recurrence_id, recurrence_occurrence_key) where ambos not null
--     (20260916120200) — protege la materialización: dos intentos para la
--     misma ocurrencia nunca crean dos calendar_lessons. No incluye
--     owner_id en la clave, pero `occurrence_key` siempre empieza con el
--     propio `recurrence_id` (ver `buildOccurrenceKey`,
--     lib/calendar/recurrence-engine.ts) y `recurrence_id` ya es único por
--     owner vía FK a `recurrence_rules` — una colisión entre owners es
--     estructuralmente imposible.
--   - `lesson_registrations_owner_calendar_lesson_unique` on
--     (owner_id, calendar_lesson_id) where calendar_lesson_id not null
--     (20260921120000) — protege tanto el camino ya-materializado como el
--     recién-materializado-acá (calendar_lesson_id siempre queda seteado
--     antes del insert de lesson_registrations).
--   - `lesson_registrations_owner_operation_unique` on
--     (owner_id, operation_id) where operation_id not null (20260922100000)
--     — protege el camino ad-hoc real.
--
-- Corrección mínima: se reordena/corrige la validación —
--   1) primero se exige que recurrence_id/occurrence_key vengan siempre
--      juntos o ninguno (estado inválido si sólo viene uno);
--   2) se valida que occurrence_key realmente pertenezca a la regla
--      indicada (prefijo estructural real: `occurrence_key` siempre
--      empieza con `recurrence_id || ':'`);
--   3) si además viene calendar_lesson_id junto con recurrence_id, se
--      exige que la fila real de calendar_lessons coincida EXACTO con esa
--      serie/occurrence_key (ids contradictorios se rechazan, nunca se
--      ignoran en silencio);
--   4) recién ahí se define qué es "ad-hoc" de verdad: calendar_lesson_id
--      Y recurrence_id ambos ausentes — nunca sólo calendar_lesson_id
--      ausente. El resto de la función (materialización, roster
--      inclusivo, idempotencia por índice único, inserts) queda
--      exactamente igual que la versión real aplicada.
--
-- SECURITY/privilegios: igual que la función real actual — `security
-- invoker` (se apoya en RLS + verificación explícita de owner_id en cada
-- referencia, igual que ya hacía), todas las tablas referenciadas
-- calificadas con `public.` (ya lo estaban), `revoke all ... from public`
-- + `grant execute ... to authenticated` + `revoke execute ... from anon`
-- al final, igual patrón que toda otra RPC de este proyecto.

create or replace function public.start_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security invoker
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

  -- ---------------------------------------------------------------------
  -- NUEVO: estados inválidos de recurrence_id/occurrence_key, ANTES que
  -- cualquier otra cosa — recurrence_id y occurrence_key sólo pueden venir
  -- juntos o ninguno de los dos.
  -- ---------------------------------------------------------------------
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

  -- NUEVO: si vienen calendar_lesson_id Y recurrence_id a la vez, deben
  -- ser consistentes entre sí — ids contradictorios se rechazan, nunca se
  -- ignora uno en silencio.
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

  -- CORREGIDO: ad-hoc real es "ni clase materializada NI serie" — antes
  -- sólo miraba calendar_lesson_id, tratando una ocurrencia de serie
  -- todavía virtual (calendar_lesson_id null, pero recurrence_id +
  -- occurrence_key reales) como si fuera ad-hoc.
  if v_calendar_lesson_id is null and v_recurrence_id is null and v_operation_id is null then
    raise exception 'operation_id es obligatorio para un registro ad-hoc.' using errcode = '22023';
  end if;

  -- Materializa la ocurrencia de serie si todavía es virtual — nunca crea
  -- una segunda fila si (recurrence_id, occurrence_key) ya estaba
  -- materializada (mismo índice único que usan cancel/reschedule). El
  -- roster que se inserta es el que mandó el cliente en `participants`
  -- (roster inclusivo real — incluye al primario, igual que en toda otra
  -- ocurrencia materializada de este proyecto).
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
    -- Ad-hoc (sin reserva de calendario, como NewClassScreen.tsx en el
    -- móvil) — idempotente por `operation_id`: dos llamadas con el mismo
    -- id SIEMPRE convergen en la misma fila. Un operation_id nuevo SIEMPRE
    -- inserta una fila nueva, sin importar si alumno/fecha/hora coinciden
    -- con un registro anterior.
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

  -- Cuando la actividad no se dictó (profesora ausente, o feriado sin
  -- excepción), no hay asistencia/evaluación/tarea que completar por
  -- participante — se insertan directamente 'completed' para habilitar
  -- "Finalizar registro" de inmediato, mismo criterio que `classHeld` del
  -- móvil (esas secciones ni se muestran en ese caso).
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
  'Empieza (o retoma) un registro de clase — materializa la ocurrencia si es virtual, crea/recupera el encabezado y el roster inclusivo real. Corrección (20260930100000): ad-hoc real es "ni calendar_lesson_id ni recurrence_id" — antes rechazaba con error falso "operation_id obligatorio" cualquier primer registro de una ocurrencia de serie (individual o grupal) todavía virtual. Suma validación explícita de recurrence_id/occurrence_key incompletos, occurrence_key ajeno a la serie, e ids contradictorios entre calendar_lesson_id y recurrence_id.';

revoke all on function public.start_lesson_registration(jsonb) from public;
grant execute on function public.start_lesson_registration(jsonb) to authenticated;
revoke execute on function public.start_lesson_registration(jsonb) from anon;
