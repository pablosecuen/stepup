-- Rollback de R15: quita los disparadores y vuelve cada clave de ocurrencia de una serie importada a la forma de la app anterior (id VIEJO de la serie + el resto de la clave).
-- Es reversible porque cada serie conserva su id original (`legacy_mobile_id`). Las series creadas en la web (sin `legacy_mobile_id`) no se tocan.
-- Con las claves viejas la web vuelve a NO reconocer las clases ya registradas de las series importadas (vuelven a figurar «por registrar»).

drop trigger if exists normalize_occurrence_key on public.calendar_lessons;
drop trigger if exists normalize_occurrence_key on public.recurrence_exceptions;

do $$
declare
  v_ids uuid[];
begin
  -- Primero se cambian las claves y recién DESPUÉS (otra sentencia) se refresca la instantánea: dentro de una misma sentencia la copia de la fila todavía mostraría la clave vieja.
  with upd as (
    update public.calendar_lessons c
       set recurrence_occurrence_key = r.legacy_mobile_id || substr(c.recurrence_occurrence_key, length(r.id::text) + 1)
      from public.recurrence_rules r
     where r.id = c.recurrence_id and r.legacy_mobile_id is not null
       and left(c.recurrence_occurrence_key, length(r.id::text) + 1) = r.id::text || ':'
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from upd;
  update public.import_run_row_snapshots rs set new_row = to_jsonb(t)
    from public.calendar_lessons t, public.import_runs ir
   where t.id = any(v_ids) and rs.table_name = 'calendar_lessons' and rs.row_id = t.id and rs.action = 'inserted'
     and ir.id = rs.import_run_id and ir.status = 'applied';

  with upd as (
    update public.recurrence_exceptions e
       set occurrence_key = r.legacy_mobile_id || substr(e.occurrence_key, length(r.id::text) + 1)
      from public.recurrence_rules r
     where r.id = e.recurrence_id and r.legacy_mobile_id is not null
       and left(e.occurrence_key, length(r.id::text) + 1) = r.id::text || ':'
    returning e.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from upd;
  update public.import_run_row_snapshots rs set new_row = to_jsonb(t)
    from public.recurrence_exceptions t, public.import_runs ir
   where t.id = any(v_ids) and rs.table_name = 'recurrence_exceptions' and rs.row_id = t.id and rs.action = 'inserted'
     and ir.id = rs.import_run_id and ir.status = 'applied';
end
$$;

drop function if exists public._trg_normalize_lesson_occurrence_key();
drop function if exists public._trg_normalize_exception_occurrence_key();
drop function if exists public._normalize_occurrence_key(uuid, text);

-- Vuelve a la definición de R10 de la función que fija las fechas originales (busca la excepción por la clave tal como venía del origen).
create or replace function public._import_apply_extras(p_run_id uuid, p_owner uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regs jsonb := public._import_arr(p_payload, 'pedagogicalLessons');
  v_spec record;
begin
  -- 4.1) Clases registradas: contenido pedagógico, marcas, duraciones, estado del registro, fechas originales y extras.
  with src as (
    select r.id as reg_id, e as j
      from jsonb_array_elements(v_regs) e
      join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
     where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations'))
  ), upd as (
    update public.lesson_registrations r set
        topics = case when jsonb_typeof(s.j -> 'topics') = 'array' then s.j -> 'topics' else '[]'::jsonb end,
        objectives = public._import_text_array(s.j -> 'objectives'),
        activities = public._import_text_array(s.j -> 'activities'),
        activity_notes = coalesce(s.j ->> 'activityNotes', ''),
        internal_notes = coalesce(s.j ->> 'internalNotes', ''),
        material_ids = public._import_text_array(s.j -> 'materialIds'),
        is_billable = coalesce((s.j ->> 'isBillable')::boolean, true),
        consumes_monthly_package = coalesce((s.j ->> 'consumesMonthlyPackage')::boolean, true),
        source_event_type = s.j ->> 'sourceEventType',
        scheduled_duration_minutes = case when jsonb_typeof(s.j -> 'scheduledDurationMinutes') = 'number' then round((s.j ->> 'scheduledDurationMinutes')::numeric)::int end,
        actual_duration_minutes = case when jsonb_typeof(s.j -> 'actualDurationMinutes') = 'number' then round((s.j ->> 'actualDurationMinutes')::numeric)::int end,
        source_extras = case when jsonb_typeof(s.j -> 'sourceExtras') = 'object' then s.j -> 'sourceExtras' else '{}'::jsonb end,
        status = case when s.j ->> 'registrationStatus' = 'in_progress' then 'in_progress' else r.status end,
        created_at = coalesce(public._import_ts(s.j ->> 'createdAt'), r.created_at),
        updated_at = coalesce(public._import_ts(s.j ->> 'updatedAt'), r.updated_at)
      from src s where r.id = s.reg_id
    returning r.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'lesson_registrations' and rs.row_id = u.id;

  -- 4.2) Participantes: estado y orden de cada uno. Un registro finalizado deja a TODOS «completados» (así lo deja la web al finalizar);
  --      uno «en curso» conserva el estado que traía cada participante.
  with prog as (
    select r.id as reg_id, st.id as student_id, pp ->> 'status' as status, (pp ->> 'position')::int as position
      from jsonb_array_elements(v_regs) e
      join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'participantProgress') = 'array' then e -> 'participantProgress' else '[]'::jsonb end) pp
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = pp ->> 'studentId'
     where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations'))
       and pp ->> 'status' in ('pending', 'completed', 'omitted')
  ), upd as (
    update public.lesson_registration_students lrs set
        participant_status = coalesce(
          (select p.status from prog p where p.reg_id = lrs.lesson_registration_id and p.student_id = lrs.student_id),
          case when r.status = 'completed' then 'completed' else lrs.participant_status end),
        participant_position = (select p.position::smallint from prog p where p.reg_id = lrs.lesson_registration_id and p.student_id = lrs.student_id)
      from public.lesson_registrations r
     where r.id = lrs.lesson_registration_id and lrs.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registration_students'))
    returning lrs.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'lesson_registration_students' and rs.row_id = u.id;

  -- 4.2b) Series: «reemplazada por» (la importación por conjuntos sólo cargaba «reemplaza a»; el origen trae las dos puntas).
  with upd as (
    update public.recurrence_rules r set superseded_by_recurrence_id = t.id
      from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceRules')) e
      join public.recurrence_rules t on t.owner_id = p_owner and t.legacy_mobile_id = e ->> 'supersededByRecurrenceId'
     where r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id' and nullif(e ->> 'supersededByRecurrenceId', '') is not null
       and r.id in (select row_id from public._import_inserted_ids(p_run_id, 'recurrence_rules'))
    returning r.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'recurrence_rules' and rs.row_id = u.id;

  -- 4.3) Evaluaciones: notas ORIGINALES (la nota válida ya se cargó sólo si estaba en 1–10).
  with src as (
    select r.id as reg_id, st.id as student_id, ev -> 'sourceGrades' as source_grades
      from jsonb_array_elements(v_regs) e
      join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'evaluations') = 'array' then e -> 'evaluations' else '[]'::jsonb end) ev
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = ev ->> 'studentId'
     where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations')) and jsonb_typeof(ev -> 'sourceGrades') = 'object'
  ), upd as (
    update public.lesson_registration_evaluations le set source_grades = s.source_grades
      from src s where le.lesson_registration_id = s.reg_id and le.student_id = s.student_id
       and le.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registration_evaluations'))
    returning le.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'lesson_registration_evaluations' and rs.row_id = u.id;

  -- 4.4) Historial de ediciones de la clase (auditoría append-only de la app).
  with ins as (
    insert into public.lesson_registration_edit_history (owner_id, lesson_registration_id, edit_operation_id, edited_at, previous_snapshot)
      select p_owner, r.id, md5(p_owner::text || '|edit|' || (e ->> 'id') || '|' || (h ->> 'index'))::uuid, public._import_ts(h ->> 'editedAt'),
             jsonb_build_object('_format', 'mobile_v1') || coalesce(h -> 'snapshot', '{}'::jsonb)
        from jsonb_array_elements(v_regs) e
        join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'editHistory') = 'array' then e -> 'editHistory' else '[]'::jsonb end) h
       where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations')) and public._import_ts(h ->> 'editedAt') is not null
       order by r.id, (h ->> 'index')::int
    on conflict (lesson_registration_id, edit_operation_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registration_edit_history', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- 4.5) Adjuntos de la clase: la fila existe desde ya (nombre, tipo, tamaño, a qué alumno pertenece); el archivo se completa al extraerlo del teléfono.
  with ins as (
    insert into public.lesson_attachments (owner_id, legacy_mobile_id, lesson_registration_id, student_id, name, kind, mime_type, size_bytes, caption, added_at, source_uri)
      select p_owner, a ->> 'id', r.id, st.id, coalesce(a ->> 'name', ''), case when a ->> 'kind' = 'image' then 'image' else 'pdf' end, a ->> 'mimeType',
             case when jsonb_typeof(a -> 'sizeBytes') = 'number' then (a ->> 'sizeBytes')::numeric::bigint end, a ->> 'caption', public._import_ts(a ->> 'addedAt'), a ->> 'sourceUri'
        from jsonb_array_elements(v_regs) e
        join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'attachments') = 'array' then e -> 'attachments' else '[]'::jsonb end) a
        left join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = a ->> 'studentId'
       where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations')) and a ->> 'id' is not null
         and (nullif(a ->> 'studentId', '') is null or st.id is not null)
    on conflict (owner_id, legacy_mobile_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_attachments', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- 4.6) Clases de calendario: grupo de superposición (el original como texto + el uuid derivado: mismo grupo ⇒ mismo uuid).
  with upd as (
    update public.calendar_lessons c set
        legacy_overlap_group_id = e ->> 'overlapGroupId',
        overlap_group_id = md5(p_owner::text || '|overlap|' || (e ->> 'overlapGroupId'))::uuid
      from jsonb_array_elements(public._import_arr(p_payload, 'calendarLessons')) e
     where c.owner_id = p_owner and c.legacy_mobile_id = e ->> 'id' and nullif(e ->> 'overlapGroupId', '') is not null
       and c.id in (select row_id from public._import_inserted_ids(p_run_id, 'calendar_lessons'))
    returning c.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'calendar_lessons' and rs.row_id = u.id;

  -- 4.7) Alumnos: extras del origen (datos calculados por la app y entradas de historial inválidas) en su propia tabla.
  with ins as (
    insert into public.student_source_extras (owner_id, student_id, extras)
      select p_owner, s.id, e -> 'sourceExtras'
        from jsonb_array_elements(public._import_arr(p_payload, 'students')) e
        join public.students s on s.owner_id = p_owner and s.legacy_mobile_id = e ->> 'id'
       where jsonb_typeof(e -> 'sourceExtras') = 'object' and e -> 'sourceExtras' <> '{}'::jsonb
         and s.id in (select row_id from public._import_inserted_ids(p_run_id, 'students'))
       order by s.id
    on conflict (student_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_source_extras', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- 4.8) Fechas originales de creación / registro (una sola sentencia por tabla; sólo filas de esta corrida y sólo si el origen trae una fecha válida).
  for v_spec in
    select * from (values
      ('payment_charges', 'paymentCharges', 'created_at', 'createdAt'),
      ('payments', 'payments', 'recorded_at', 'recordedAt'),
      ('payment_adjustments', 'paymentAdjustments', 'created_at', 'createdAt'),
      ('payment_allocations', 'paymentAllocations', 'created_at', 'createdAt'),
      ('package_purchases', 'packagePurchases', 'created_at', 'createdAt'),
      ('package_credit_movements', 'packageCreditMovements', 'created_at', 'createdAt'),
      ('training_billing_agreements', 'trainingBillingAgreements', 'created_at', 'createdAt'),
      ('custom_levels', 'customLevels', 'created_at', 'createdAt'),
      ('first_month_proration_decisions', 'firstMonthProrationDecisions', 'created_at', 'createdAt')
    ) as t(table_name, payload_key, column_name, field_name)
  loop
    execute format($q$
      with src as (
        select e ->> 'id' as lid, public._import_ts(e ->> %2$L) as ts from jsonb_array_elements($1) e where e ->> 'id' is not null
      ), upd as (
        update public.%1$I t set %3$I = s.ts from src s
         where t.owner_id = $2 and t.legacy_mobile_id = s.lid and s.ts is not null
           and t.id in (select row_id from public._import_inserted_ids($3, %1$L))
        returning t.*
      )
      update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
        from upd u where rs.import_run_id = $3 and rs.table_name = %1$L and rs.row_id = u.id
    $q$, v_spec.table_name, v_spec.field_name, v_spec.column_name)
    using public._import_arr(p_payload, v_spec.payload_key), p_owner, p_run_id;
  end loop;

  -- Excepciones de series: se identifican por serie + ocurrencia.
  with upd as (
    update public.recurrence_exceptions x set created_at = s.ts
      from (
        select rr.id as rid, e ->> 'occurrenceKey' as k, public._import_ts(e ->> 'createdAt') as ts
          from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceExceptions')) e
          join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = e ->> 'recurrenceId'
      ) s
     where x.owner_id = p_owner and x.recurrence_id = s.rid and x.occurrence_key = s.k and s.ts is not null
       and x.id in (select row_id from public._import_inserted_ids(p_run_id, 'recurrence_exceptions'))
    returning x.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'recurrence_exceptions' and rs.row_id = u.id;

  -- 4.9) Primer mes proporcional: series y versión de regla con las que se decidió.
  with upd as (
    update public.first_month_proration_decisions d set
        recurrence_ids = case when jsonb_typeof(e -> 'recurrenceIds') = 'array' then public._import_text_array(e -> 'recurrenceIds') end,
        series_pattern_snapshot = case when jsonb_typeof(e -> 'seriesPatternSnapshot') in ('object', 'array') then e -> 'seriesPatternSnapshot' end,
        rule_version = case when jsonb_typeof(e -> 'ruleVersion') = 'number' then round((e ->> 'ruleVersion')::numeric)::int end
      from jsonb_array_elements(public._import_arr(p_payload, 'firstMonthProrationDecisions')) e
     where d.owner_id = p_owner and d.legacy_mobile_id = e ->> 'id'
       and d.id in (select row_id from public._import_inserted_ids(p_run_id, 'first_month_proration_decisions'))
    returning d.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'first_month_proration_decisions' and rs.row_id = u.id;

  -- 4.10) Perfil de la profesora: avance del tutorial y fecha de creación (sólo si el perfil lo creó esta importación).
  if jsonb_typeof(p_payload -> 'teacherProfile') = 'object' then
    with upd as (
      update public.teacher_profiles tp set
          completed_tutorial_version = case when jsonb_typeof(p_payload -> 'teacherProfile' -> 'completedTutorialVersion') = 'number' then round((p_payload -> 'teacherProfile' ->> 'completedTutorialVersion')::numeric)::int end,
          tutorial_completed_at = public._import_ts(p_payload -> 'teacherProfile' ->> 'tutorialCompletedAt'),
          created_at = coalesce(public._import_ts(p_payload -> 'teacherProfile' ->> 'createdAt'), tp.created_at),
          source_updated_at = public._import_ts(p_payload -> 'teacherProfile' ->> 'updatedAt')
       where tp.owner_id = p_owner and p_owner in (select row_id from public._import_inserted_ids(p_run_id, 'teacher_profiles'))
      returning tp.*
    )
    update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
      from upd u where rs.import_run_id = p_run_id and rs.table_name = 'teacher_profiles' and rs.row_id = u.owner_id;
  end if;

  -- 4.11) Reportes generados: el snapshot ya viene en el formato de la web (con el registro original adentro). El PDF se vincula al extraerlo del teléfono.
  with ins as (
    insert into public.report_records (owner_id, legacy_mobile_id, student_id, title, selected_months, period_start, period_end, generated_at, snapshot, schema_version)
      select p_owner, e ->> 'id', st.id, coalesce(e ->> 'title', ''), public._import_text_array(e -> 'selectedMonths'), (e ->> 'periodStart')::date, (e ->> 'periodEnd')::date,
             public._import_ts(e ->> 'generatedAt'), e -> 'snapshot', coalesce(round((e ->> 'schemaVersion')::numeric)::int, 1)
        from jsonb_array_elements(public._import_arr(p_payload, 'reportRecords')) e
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = e ->> 'studentId'
       where e ->> 'id' is not null and public._import_ts(e ->> 'generatedAt') is not null and jsonb_typeof(e -> 'snapshot') = 'object'
       order by e ->> 'id'
    on conflict (owner_id, legacy_mobile_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'report_records', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;
revoke all on function public._import_apply_extras(uuid, uuid, jsonb) from public, anon, authenticated;
