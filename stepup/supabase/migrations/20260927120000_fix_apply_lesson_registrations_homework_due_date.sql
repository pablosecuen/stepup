-- Fase 9 — corrección puntual #2, independiente de la de create_separate
-- (20260927110000): `_apply_lesson_registrations` (migración
-- 20260927090000_backup_import.sql, YA APLICADA — nunca se edita)
-- insertaba `homework_due_date` (columna real `date`) directamente desde
-- `v_row->>'homeworkDueDate'` (siempre `text`), sin castear — a diferencia
-- de TODAS las demás columnas de fecha/hora del mismo INSERT, que sí
-- tienen `::date`/`::timestamptz`. Postgres rechaza ese INSERT por tipos
-- incompatibles en tiempo de parseo del statement, sin importar el valor
-- — así que CUALQUIER importación real con al menos un registro
-- pedagógico insertable fallaba siempre. Bug real, descubierto en vivo el
-- 2026-09-24 al ejecutar `_apply_lesson_registrations` de verdad durante
-- la batería de pruebas de la corrección de `create_separate`.
--
-- Migración aditiva nueva, separada de 20260927110000 — no tiene relación
-- de dependencia con esa corrección (dominios distintos: alta de alumnos
-- vs. registro pedagógico), así que se prepara como archivo propio.
-- `create or replace function` sobre UNA sola función; el resto del
-- cuerpo queda carácter por carácter igual al original — el único cambio
-- real es:
--
--   v_row->>'homeworkDueDate'   ->   (v_row->>'homeworkDueDate')::date
--
-- Por qué este cast es correcto y suficiente:
--   - `->>'homeworkDueDate'` ya devuelve SQL NULL tanto si la clave no
--     está presente como si el valor JSON es `null` — el cast no cambia
--     eso, `null::date` sigue siendo NULL real. Nunca hace falta un
--     `coalesce`/`nullif` adicional.
--   - El cast a `date` de Postgres interpreta un literal `'YYYY-MM-DD'`
--     como fecha civil pura — no hay conversión a `timestamp`, no hay
--     zona horaria ni objeto `Date` de por medio en ningún punto de este
--     camino (a diferencia del código de cliente en TypeScript, este es
--     SQL puro operando sobre el string tal cual llega del backup). No
--     hay desplazamiento posible: la fecha que se guarda es exactamente
--     la fecha del string de entrada.
--
-- Grants: `_apply_lesson_registrations` ya tenía revocado EXECUTE de
-- `public`/`anon`/`authenticated` desde el barrido masivo de la migración
-- original (Sección 12) — `create or replace function` sobre una función
-- YA EXISTENTE nunca resetea sus privilegios ya otorgados/revocados en
-- Postgres real (sólo pasa si cambia la firma, y acá no cambia). Aun así,
-- este archivo repite el mismo barrido dinámico al final (idéntico al de
-- 20260927110000) para reverificarlo explícitamente en vez de asumirlo.

create or replace function public._apply_lesson_registrations(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_row jsonb; v_new_id uuid; v_calendar_lesson_id uuid; v_roster jsonb; v_att jsonb; v_ev jsonb; v_hr jsonb;
  v_student_id uuid; v_child_id uuid;
begin
  for v_item in select * from jsonb_to_recordset(p_classification->'aggregates'->'lesson_registrations') as x(legacy_mobile_id text, status text)
    where status = 'insertable'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'pedagogicalLessons') t(r) where r->>'id' = v_item.legacy_mobile_id;
    if exists(select 1 from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id = v_item.legacy_mobile_id) then
      raise exception 'El registro % ya existe — preview desactualizado.', v_item.legacy_mobile_id;
    end if;

    v_calendar_lesson_id := null;
    if v_row->>'calendarLessonId' is not null then
      select c.id into v_calendar_lesson_id from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'calendarLessonId';
    end if;

    insert into public.lesson_registrations (
      owner_id, legacy_mobile_id, calendar_lesson_id, activity_kind, counts_as_class, homework_description, homework_due_date,
      billed_amount, scheduled_start_at, actual_started_at, actual_ended_at, outcome, holiday_exception, modality, scheduled_end_at,
      late_cancellation_policy, late_cancellation_percentage
    ) values (
      p_owner, v_row->>'id', v_calendar_lesson_id, coalesce(v_row->>'activityKind', 'class'), coalesce((v_row->>'countsAsClass')::boolean, true), v_row->>'homeworkDescription', (v_row->>'homeworkDueDate')::date,
      (v_row->>'billedAmount')::numeric, (v_row->>'scheduledStartAt')::timestamptz, (v_row->>'actualStartedAt')::timestamptz, (v_row->>'actualEndedAt')::timestamptz,
      coalesce(v_row->>'outcome', 'clase_dictada'), coalesce((v_row->>'holidayException')::boolean, false), v_row->>'modality', (v_row->>'scheduledEndAt')::timestamptz,
      v_row->>'lateCancellationPolicy', (v_row->>'lateCancellationPercentage')::smallint
    ) returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'lesson_registrations', v_new_id, 'inserted', null, (select to_jsonb(l) from public.lesson_registrations l where l.id = v_new_id));

    for v_roster in select * from jsonb_array_elements(coalesce(v_row->'roster', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_roster->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id) values (p_owner, v_new_id, v_student_id)
          on conflict (lesson_registration_id, student_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_students', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_students x where x.id = v_child_id));
        end if;
      end if;
    end loop;

    for v_att in select * from jsonb_array_elements(coalesce(v_row->'attendance', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_att->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status, late_minutes) values (p_owner, v_new_id, v_student_id, v_att->>'status', (v_att->>'lateMinutes')::int)
          on conflict (lesson_registration_id, student_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_attendance', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_attendance x where x.id = v_child_id));
        end if;
      end if;
    end loop;

    for v_ev in select * from jsonb_array_elements(coalesce(v_row->'evaluations', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_ev->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_evaluations (owner_id, lesson_registration_id, student_id, general_grade, skill_grades, strengths, areas_to_improve, individual_observation, individual_homework_description, individual_homework_due_date, billed_amount)
          values (p_owner, v_new_id, v_student_id, (v_ev->>'generalGrade')::numeric, coalesce(v_ev->'skillGrades', '{}'::jsonb),
                  array(select jsonb_array_elements_text(coalesce(v_ev->'strengths', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(v_ev->'areasToImprove', '[]'::jsonb))),
                  v_ev->>'individualObservation', v_ev->>'individualHomeworkDescription', (v_ev->>'individualHomeworkDueDate')::date, (v_ev->>'billedAmount')::numeric)
          on conflict (lesson_registration_id, student_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_evaluations', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_evaluations x where x.id = v_child_id));
        end if;
      end if;
    end loop;

    for v_hr in select * from jsonb_array_elements(coalesce(v_row->'homeworkReviews', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_hr->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
          values (p_owner, v_new_id, v_student_id, v_hr->>'taskId', v_hr->>'outcome', coalesce((v_hr->>'reviewedAt')::timestamptz, now()))
          on conflict (lesson_registration_id, student_id, task_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_homework_reviews', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_homework_reviews x where x.id = v_child_id));
        end if;
      end if;
    end loop;
  end loop;

  -- 2ª pasada: rescheduled_from_registration_id (auto-FK nullable) entre registros insertados en esta corrida.
  update public.lesson_registrations lr set rescheduled_from_registration_id = prev.id
    from public.lesson_registrations prev, jsonb_array_elements(p_payload->'pedagogicalLessons') t(r)
    where lr.owner_id = p_owner and lr.legacy_mobile_id = t.r->>'id' and t.r->>'rescheduledFromRegistrationId' is not null
      and prev.owner_id = p_owner and prev.legacy_mobile_id = t.r->>'rescheduledFromRegistrationId'
      and exists(select 1 from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = 'lesson_registrations' and s.row_id = lr.id);
end;
$$;

-- =============================================================================
-- Reverificación explícita del barrido de seguridad (idéntico al de
-- 20260927110000) — confirma que `_apply_lesson_registrations` (y toda
-- función interna prefijo `_`) sigue sin EXECUTE para
-- `public`/`anon`/`authenticated` después de este `create or replace`.
-- =============================================================================

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
