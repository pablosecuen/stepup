-- Reversión de R10 (traslado completo): vuelve a las definiciones de R9/R6 y quita lo agregado.
-- ATENCIÓN: borra las columnas nuevas (contenido de clases, notas originales, extras…), las tablas lesson_attachments / material_library_items / device_local_snapshots
-- y el bucket lesson-files de la lista (los objetos del bucket NO se borran desde SQL). Usar sólo si todavía no se confirmó ninguna importación real, o después de
-- exportar esos datos. Los reportes importados (report_records) y los historiales quedan: son datos de la cuenta.
drop function if exists public.register_transfer_file(text, text, text, text, bigint);
drop function if exists public.mark_transfer_file_unavailable(text, text);
drop function if exists public.record_phone_extraction_result(jsonb);
drop function if exists public.import_phone_extraction(jsonb);
-- Primero se vuelve a las funciones de R9 (dejan de referenciar lo nuevo) y recién después se quitan las columnas.
create or replace function public._import_check_payload(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lim jsonb := public._import_limits();
  v_collections text[] := array['students','pedagogicalLessons','calendarLessons','recurrenceRules','recurrenceExceptions','paymentCharges','payments','paymentAllocations','paymentAdjustments','reportRecords','packagePurchases','packageCreditMovements','monthlyAmountCorrections','initialPaidSurchargeCorrections','firstMonthProrationDecisions','trainingBillingAgreements','customLevels'];
  v_key text;
  v_val jsonb;
  v_len integer;
  v_total integer := 0;
  v_nested integer := 0;
  v_bad integer;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
  end if;

  foreach v_key in array v_collections loop
    v_val := p_payload -> v_key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) <> 'array' then
      raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
    end if;
    v_len := jsonb_array_length(v_val);
    if v_len > (v_lim ->> 'max_rows_per_collection')::int then
      raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
    end if;
    v_total := v_total + v_len;
    if v_total > (v_lim ->> 'max_rows_total')::int then
      raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
    end if;
    -- Cada elemento debe ser un objeto con `id` de texto (menos las excepciones de series, que se identifican por serie + ocurrencia).
    if v_key = 'recurrenceExceptions' then
      select count(*) into v_bad from jsonb_array_elements(v_val) e where jsonb_typeof(e) is distinct from 'object';
    else
      select count(*) into v_bad from jsonb_array_elements(v_val) e
        where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'id') is distinct from 'string' or btrim(e ->> 'id') = '';
    end if;
    if v_bad > 0 then
      raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
    end if;
  end loop;

  -- Referencias obligatorias entre filas financieras: una asignación sin pago o sin cobro, un ajuste sin cobro o un movimiento sin paquete
  -- no se pueden relacionar con nada (antes terminaban en un error interno al analizar).
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'paymentAllocations')) e
    where jsonb_typeof(e -> 'paymentId') is distinct from 'string' or jsonb_typeof(e -> 'chargeId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'paymentAdjustments')) e where jsonb_typeof(e -> 'chargeId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'packageCreditMovements')) e where jsonb_typeof(e -> 'packageId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;

  -- Filas anidadas que la cuenta de arriba no ve (lo que realmente se escribe además de las filas principales).
  select coalesce(sum(public._import_len(e -> 'participants')), 0) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'calendarLessons')) e;
  v_nested := v_nested + v_bad;
  select coalesce(sum(public._import_len(e -> 'participantStudentIds')), 0) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceRules')) e;
  v_nested := v_nested + v_bad;
  select coalesce(sum(public._import_len(e -> 'roster') + public._import_len(e -> 'attendance') + public._import_len(e -> 'evaluations') + public._import_len(e -> 'homeworkReviews')), 0)
    into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'pedagogicalLessons')) e;
  v_nested := v_nested + v_bad;
  if jsonb_typeof(p_payload -> 'profiles') = 'object' then
    select coalesce(sum(public._import_len(p.value -> 'levelHistory')), 0) into v_bad from jsonb_each(p_payload -> 'profiles') p where jsonb_typeof(p.value) = 'object';
    v_nested := v_nested + v_bad;
  end if;

  if v_nested > (v_lim ->> 'max_nested_rows')::int or v_total + v_nested > (v_lim ->> 'max_work_units')::int then
    raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
  end if;

  return jsonb_build_object('counted_rows', v_total, 'nested_rows', v_nested, 'work_units', v_total + v_nested);
end;
$$;

create or replace function public._import_apply_histories(p_run_id uuid, p_owner uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profiles jsonb := case when jsonb_typeof(p_payload -> 'profiles') = 'object' then p_payload -> 'profiles' else '{}'::jsonb end;
  v_corr jsonb := public._import_arr(p_payload, 'monthlyAmountCorrections');
begin
  -- Historial de estados: sólo de los alumnos agregados en ESTA corrida (los que ya existían en la web conservan el suyo; nunca se duplica).
  with src as (
    select st.id as student_id, e.entry ->> 'status' as status, (e.entry ->> 'date')::date as occurred_on, e.entry ->> 'reason' as reason, e.entry ->> 'internalNote' as internal_note, e.ord
      from _ia_stu s
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.lid
      cross join lateral jsonb_array_elements(case when jsonb_typeof(v_profiles -> s.lid -> 'statusHistory') = 'array' then v_profiles -> s.lid -> 'statusHistory' else '[]'::jsonb end) with ordinality as e(entry, ord)
     where e.entry ->> 'status' is not null and e.entry ->> 'date' is not null
  ), ins as (
    insert into public.student_status_history (owner_id, student_id, status, occurred_on, reason, internal_note)
      select p_owner, student_id, status, occurred_on, reason, internal_note from src order by student_id, ord
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_status_history', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with src as (
    select st.id as student_id, (e.entry ->> 'price')::numeric as price, (e.entry ->> 'date')::date as effective_on, e.ord
      from _ia_stu s
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.lid
      cross join lateral jsonb_array_elements(case when jsonb_typeof(v_profiles -> s.lid -> 'priceHistory') = 'array' then v_profiles -> s.lid -> 'priceHistory' else '[]'::jsonb end) with ordinality as e(entry, ord)
     where e.entry ->> 'price' is not null and e.entry ->> 'date' is not null
  ), ins as (
    insert into public.student_price_history (owner_id, student_id, price, effective_on)
      select p_owner, student_id, price, effective_on from src order by student_id, ord
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_price_history', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- Correcciones de importe mensual (auditoría): por identificador de origen, una sola vez; sólo si el alumno ya existe en la web.
  with src as (
    select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r as r
      from jsonb_array_elements(v_corr) with ordinality as x(r, ord) where x.r ->> 'id' is not null order by x.r ->> 'id', x.ord
  ), ins as (
    insert into public.monthly_amount_corrections (owner_id, legacy_mobile_id, student_id, billing_period, previous_amount, new_amount, changed_at, reason, effective_from)
      select p_owner, s.lid, st.id, s.r ->> 'billingPeriod', (s.r ->> 'previousAmount')::numeric, (s.r ->> 'newAmount')::numeric,
             coalesce((s.r ->> 'changedAt')::timestamptz, now()), coalesce(s.r ->> 'reason', ''), s.r ->> 'effectiveFrom'
        from src s
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.r ->> 'studentId'
       where s.r ->> 'billingPeriod' is not null and not exists (select 1 from public.monthly_amount_corrections w where w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'monthly_amount_corrections', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

create or replace function public._import_undo_analyze(p_run_id uuid, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tbl text;
  v_key text;
  v_rel record;
  v_unsafe jsonb;
begin
  drop table if exists _iu_state;
  drop table if exists _iu_blockers;
  create temporary table _iu_state (table_name text not null, row_id uuid not null, action text not null, ok boolean not null) on commit drop;
  create temporary table _iu_blockers (parent_table text not null, parent_id uuid not null, child_table text not null, child_id uuid) on commit drop;

  -- 1) ¿La fila misma cambió desde que la importación la escribió? (una consulta por tabla; huella canónica de la fila viva vs. la de la instantánea)
  for v_tbl in select distinct s.table_name from public.import_run_row_snapshots s where s.import_run_id = p_run_id loop
    v_key := public._import_row_key(v_tbl);
    if v_key is null then raise exception 'Tabla no reconocida al deshacer.'; end if;
    -- Se une SÓLO por la clave de la fila (el dueño se comprueba después, en el CASE): con el dueño dentro del JOIN y sin estadísticas de las filas
    -- recién importadas el planificador elegía un lazo anidado de cientos de miles de comparaciones.
    execute format(
      'insert into _iu_state (table_name, row_id, action, ok)
         select s.table_name, s.row_id, s.action,
                case when t.owner_id is distinct from $2 then false else public._fingerprint_canonical(%L, to_jsonb(t)) = public._fingerprint_canonical(%L, s.new_row) end
           from public.import_run_row_snapshots s
           left join public.%I t on t.%I = s.row_id
          where s.import_run_id = $1 and s.table_name = %L',
      v_tbl, v_tbl, v_tbl, v_key, v_tbl) using p_run_id, p_owner;
  end loop;
  create index on _iu_state (table_name, row_id);

  -- 2) Dependencias ajenas a la importación sobre las filas «padre» agregadas y sin cambios (una consulta por relación).
  for v_rel in select * from public._import_undo_relations() loop
    execute format(
      'insert into _iu_blockers (parent_table, parent_id, child_table, child_id)
         select %L, p.row_id, %L, c.id
           from _iu_state p
           join public.%I c on c.%I = p.row_id
           left join _iu_state cs on cs.table_name = %L and cs.row_id = c.id and cs.action = ''inserted''
          where p.table_name = %L and p.action = ''inserted'' and p.ok and (cs.row_id is null or not cs.ok)',
      v_rel.parent_table, v_rel.child_table, v_rel.child_table, v_rel.fk_column, v_rel.child_table, v_rel.parent_table);
  end loop;
  -- `report_draft_claims` no tiene `id`: su sola existencia ya significa «hay un reporte en curso para este alumno».
  insert into _iu_blockers (parent_table, parent_id, child_table, child_id)
    select 'students', p.row_id, 'report_draft_claims', null
      from _iu_state p
     where p.table_name = 'students' and p.action = 'inserted' and p.ok
       and exists (select 1 from public.report_draft_claims d where d.student_id = p.row_id);

  select coalesce(jsonb_agg(u.entry), '[]'::jsonb) into v_unsafe from (
    select jsonb_build_object('table_name', s.table_name, 'row_id', s.row_id, 'reason', 'editada después de la importación') as entry
      from _iu_state s where not s.ok
    union all
    select jsonb_build_object(
             'table_name', b.parent_table, 'row_id', b.parent_id,
             'reason', 'tiene datos creados después de la importación que dependen de ella',
             'blocking_children', jsonb_agg(case when b.child_table = 'report_draft_claims'
                then jsonb_build_object('table_name', b.child_table, 'row_id', null, 'reason', 'hay un reporte en curso para este alumno')
                else jsonb_build_object('table_name', b.child_table, 'row_id', b.child_id) end))
      from _iu_blockers b group by b.parent_table, b.parent_id
  ) u;
  return v_unsafe;
end;
$$;

create or replace function public._import_row_key(p_table_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_table_name
    when 'teacher_profiles' then 'owner_id' when 'budget_distribution_settings' then 'owner_id' when 'teacher_availability' then 'owner_id' when 'surcharge_settings' then 'owner_id'
    when 'students' then 'id' when 'custom_levels' then 'id' when 'training_billing_agreements' then 'id' when 'student_level_history' then 'id'
    when 'recurrence_rules' then 'id' when 'recurrence_rule_participants' then 'id' when 'recurrence_exceptions' then 'id'
    when 'calendar_lessons' then 'id' when 'calendar_lesson_participants' then 'id'
    when 'lesson_registrations' then 'id' when 'lesson_registration_students' then 'id' when 'lesson_registration_attendance' then 'id'
    when 'lesson_registration_evaluations' then 'id' when 'lesson_registration_homework_reviews' then 'id'
    when 'package_purchases' then 'id' when 'package_credit_movements' then 'id'
    when 'payment_charges' then 'id' when 'payments' then 'id' when 'payment_allocations' then 'id' when 'payment_adjustments' then 'id'
    when 'initial_paid_surcharge_corrections' then 'id' when 'first_month_proration_decisions' then 'id'
    when 'student_status_history' then 'id' when 'student_price_history' then 'id' when 'monthly_amount_corrections' then 'id'
  end
$$;

create or replace function public._import_undo_relations()
returns table(parent_table text, child_table text, fk_column text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('students', 'student_status_history', 'student_id'), ('students', 'student_level_history', 'student_id'), ('students', 'student_price_history', 'student_id'),
    ('students', 'recurrence_rule_participants', 'student_id'), ('students', 'calendar_lessons', 'primary_student_id'), ('students', 'calendar_lesson_participants', 'student_id'),
    ('students', 'lesson_registration_students', 'student_id'), ('students', 'lesson_registration_attendance', 'student_id'), ('students', 'lesson_registration_evaluations', 'student_id'),
    ('students', 'lesson_registration_homework_reviews', 'student_id'), ('students', 'payment_charges', 'student_id'), ('students', 'payments', 'student_id'),
    ('students', 'payment_allocations', 'student_id'), ('students', 'payment_adjustments', 'student_id'), ('students', 'package_purchases', 'student_id'),
    ('students', 'package_credit_movements', 'student_id'), ('students', 'monthly_amount_corrections', 'student_id'), ('students', 'initial_paid_surcharge_corrections', 'student_id'),
    ('students', 'first_month_proration_decisions', 'student_id'), ('students', 'report_records', 'student_id'), ('students', 'recurrence_rules', 'primary_student_id'),
    ('students', 'student_creation_claims', 'student_id'),
    ('training_billing_agreements', 'recurrence_rules', 'training_billing_agreement_id'), ('training_billing_agreements', 'payment_charges', 'training_billing_agreement_id'),
    ('recurrence_rules', 'recurrence_rule_participants', 'recurrence_rule_id'), ('recurrence_rules', 'recurrence_exceptions', 'recurrence_id'),
    ('recurrence_rules', 'calendar_lessons', 'recurrence_id'), ('recurrence_rules', 'recurrence_rules', 'supersedes_recurrence_id'), ('recurrence_rules', 'recurrence_rules', 'superseded_by_recurrence_id'),
    ('calendar_lessons', 'calendar_lesson_participants', 'calendar_lesson_id'), ('calendar_lessons', 'recurrence_exceptions', 'replacement_lesson_id'),
    ('calendar_lessons', 'lesson_registrations', 'calendar_lesson_id'), ('calendar_lessons', 'payment_charges', 'calendar_lesson_id'), ('calendar_lessons', 'calendar_lessons', 'freed_by_lesson_id'),
    ('lesson_registrations', 'lesson_registration_students', 'lesson_registration_id'), ('lesson_registrations', 'lesson_registration_attendance', 'lesson_registration_id'),
    ('lesson_registrations', 'lesson_registration_evaluations', 'lesson_registration_id'), ('lesson_registrations', 'lesson_registration_homework_reviews', 'lesson_registration_id'),
    ('lesson_registrations', 'payment_charges', 'saved_lesson_id'), ('lesson_registrations', 'package_credit_movements', 'saved_lesson_id'),
    ('lesson_registrations', 'lesson_registrations', 'rescheduled_from_registration_id'),
    ('package_purchases', 'package_credit_movements', 'package_id'), ('package_purchases', 'payment_charges', 'package_id'),
    ('payment_charges', 'payment_allocations', 'charge_id'), ('payment_charges', 'payment_adjustments', 'charge_id'), ('payment_charges', 'first_month_proration_decisions', 'charge_id'),
    ('payments', 'payment_allocations', 'payment_id'), ('payments', 'payments', 'replaces_payment_id'),
    ('payments', 'initial_paid_surcharge_corrections', 'voided_payment_id'), ('payments', 'initial_paid_surcharge_corrections', 'new_payment_id')
  ) as t(parent_table, child_table, fk_column)
$$;

create or replace function public.apply_backup_import(p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns table(import_run_id uuid, summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_preview record;
  v_payload jsonb;
  v_run_id uuid;
  v_summary jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  -- ---- Fase 1: SIN lock de cuenta. Sólo lee la vista previa (inmutable) y prepara todo lo que se puede preparar antes. ----
  select ip.id, ip.status, ip.expires_at, ip.classification into v_preview from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner;
  if not found then raise exception 'El preview no existe o no te pertenece.'; end if;

  -- Reintento (respuesta perdida / doble clic): la importación ya se aplicó para esta vista previa → resultado canónico, cero escrituras.
  select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
  if found then
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  if v_preview.status <> 'pending' or v_preview.expires_at < now() then
    raise exception 'El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.';
  end if;

  perform public._import_validate_selection(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  select ip.normalized_payload into v_payload from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner;
  perform public._import_stage(v_owner, v_payload, v_preview.classification, p_field_overrides, p_duplicate_decisions);

  -- ---- Fase 2: lock de la cuenta (serializa importaciones y deshacer de la misma cuenta). Sólo cubre re-verificación + escritura. ----
  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select ip.id, ip.status, ip.expires_at, ip.backup_checksum, ip.schema_version, ip.app_version, ip.classification
    into v_preview from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner for update;
  if not found then raise exception 'El preview no existe o no te pertenece.'; end if;

  select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
  if found then
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;
  if v_preview.status <> 'pending' or v_preview.expires_at < now() then
    raise exception 'El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.';
  end if;

  insert into public.import_runs (owner_id, preview_id, backup_checksum, schema_version, app_version, summary, field_overrides, duplicate_decisions, retained_payload)
    values (v_owner, p_preview_id, v_preview.backup_checksum, v_preview.schema_version, v_preview.app_version, '{}'::jsonb,
            coalesce(p_field_overrides, '[]'::jsonb), coalesce(p_duplicate_decisions, '[]'::jsonb), v_payload)
    on conflict (owner_id, preview_id) do nothing
    returning id into v_run_id;
  if v_run_id is null then
    select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  perform public._import_verify_fingerprints(p_preview_id, v_owner);

  -- Orden topológico (igual que antes): alumnos → niveles → perfil/presupuesto/disponibilidad → acuerdos → historial de niveles → recargos →
  -- series → clases → excepciones → registros → cobros.
  perform public._import_apply_students(v_run_id, v_owner, p_preview_id);
  perform public._import_apply_custom_levels(v_run_id, v_owner);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_profiles', v_payload -> 'teacherProfile', v_preview.classification -> 'maestros' -> 'teacher_profiles', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'budget_distribution_settings', v_payload -> 'budgetDistribution', v_preview.classification -> 'maestros' -> 'budget_distribution_settings', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_availability', v_payload -> 'teacherAvailability', v_preview.classification -> 'maestros' -> 'teacher_availability', p_field_overrides);
  perform public._import_apply_agreements(v_run_id, v_owner);
  perform public._import_apply_level_history(v_run_id, v_owner);
  perform public._apply_surcharge_settings(v_run_id, v_owner, v_payload, v_preview.classification);
  perform public._import_apply_recurrence_rules(v_run_id, v_owner);
  perform public._import_apply_calendar_lessons(v_run_id, v_owner);
  perform public._import_apply_recurrence_exceptions(v_run_id, v_owner);
  perform public._import_apply_lesson_registrations(v_run_id, v_owner);
  perform public._import_apply_financial(v_run_id, v_owner);
  -- R9: historiales de estado y de precio de los alumnos agregados + correcciones de importe mensual (antes se descartaban).
  perform public._import_apply_histories(v_run_id, v_owner, v_payload);

  perform public._import_validate_invariants(v_run_id, v_owner);

  select jsonb_build_object(
    'replayed', false,
    'counts_by_table', (
      select jsonb_object_agg(s.table_name, s.cnt) from (
        select rs.table_name, count(*) as cnt from public.import_run_row_snapshots as rs where rs.import_run_id = v_run_id group by rs.table_name
      ) s
    ),
    'total_rows_written', (select count(*) from public.import_run_row_snapshots as rs2 where rs2.import_run_id = v_run_id)
  ) into v_summary;

  update public.import_runs set summary = v_summary where id = v_run_id;
  update public.import_previews set status = 'applied' where id = p_preview_id;

  return query select v_run_id, v_summary;
end;
$$;

create or replace function public.apply_undo_backup_import(p_undo_preview_id uuid)
returns table(summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_undo_preview public.import_undo_previews%rowtype;
  v_run public.import_runs%rowtype;
  v_unsafe jsonb;
  v_reverse_order text[] := array[
    'package_credit_movements','first_month_proration_decisions','initial_paid_surcharge_corrections','payment_adjustments','payment_allocations',
    'payment_charges','payments','package_purchases',
    'lesson_registration_homework_reviews','lesson_registration_evaluations','lesson_registration_attendance','lesson_registration_students','lesson_registrations',
    'recurrence_exceptions','calendar_lesson_participants','calendar_lessons','recurrence_rule_participants','recurrence_rules',
    'surcharge_settings','student_level_history','training_billing_agreements',
    'teacher_availability','budget_distribution_settings','teacher_profiles','custom_levels',
    'student_status_history','student_price_history','monthly_amount_corrections','students'
  ];
  v_table text;
  v_restored_count int;
  v_deleted_count int;
  v_summary jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_undo_preview from public.import_undo_previews where id = p_undo_preview_id and owner_id = v_owner for update;
  if not found then raise exception 'El preview de undo no existe o no te pertenece.'; end if;

  -- Reintento (respuesta perdida / doble clic / segunda llamada simultánea): el undo ya se aplicó para este preview — resultado canónico, cero escrituras.
  if v_undo_preview.status = 'applied' then
    select * into v_run from public.import_runs where id = v_undo_preview.import_run_id and owner_id = v_owner;
    if found and v_run.status = 'undone' then
      return query select coalesce(v_run.undo_summary, '{}'::jsonb) || jsonb_build_object('replayed', true);
      return;
    end if;
  end if;

  if v_undo_preview.status <> 'pending' or v_undo_preview.expires_at < now() then
    raise exception 'El preview de undo ya no es válido. Generá uno nuevo con preview_undo_backup_import.';
  end if;

  select * into v_run from public.import_runs where id = v_undo_preview.import_run_id and owner_id = v_owner for update;
  if not found or v_run.status <> 'applied' then raise exception 'Esta importación ya no puede deshacerse.'; end if;
  if v_run.snapshots_purged_at is not null then
    raise exception 'Ya renunciaste a poder deshacer esta importación.';
  end if;

  -- Re-verificación COMPLETA bajo el lock, nunca confía en `is_safe` de la fase 1.
  v_unsafe := public._import_undo_analyze(v_run.id, v_owner);
  if exists (select 1 from _iu_state where not ok) then
    raise exception 'Una fila cambió desde el preview de undo — deshacer bloqueado por completo, no se tocó nada. Generá un preview de undo nuevo.';
  end if;
  if exists (select 1 from _iu_blockers) then
    raise exception 'Una fila tiene dependencias creadas después de la importación — deshacer bloqueado por completo, no se tocó nada.';
  end if;

  select count(*) filter (where action = 'inserted'), count(*) filter (where action in ('field_overwritten', 'identity_linked'))
    into v_deleted_count, v_restored_count from public.import_run_row_snapshots where import_run_id = v_run.id;

  -- Todo verificado limpio: borra en orden inverso real, tabla por tabla (una sentencia por tabla; las referencias entre filas de la MISMA tabla se
  -- comprueban al final de la sentencia, así que el orden dentro de la tabla no importa).
  foreach v_table in array v_reverse_order loop
    execute format(
      'delete from public.%I t using public.import_run_row_snapshots s
        where s.import_run_id = $1 and s.table_name = %L and s.action = ''inserted'' and t.%I = s.row_id and t.owner_id = $2',
      v_table, v_table, public._import_row_key(v_table)) using v_run.id, v_owner;
  end loop;

  -- Restauración de lo que la importación sólo MODIFICÓ (reemplazos de campos y vínculos de identidad). Si una fila tiene dos instantáneas
  -- (vínculo + reemplazo) se restaura al estado ANTERIOR a la importación: el vínculo es siempre el primero.
  update public.students st set
      name = coalesce(sp.prev ->> 'name', st.name), phone = sp.prev ->> 'phone', whatsapp = sp.prev ->> 'whatsapp',
      email = sp.prev ->> 'email', notes = sp.prev ->> 'notes', birth_date = (sp.prev ->> 'birth_date')::date,
      current_goals = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'current_goals', '[]'::jsonb))),
      strengths = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'strengths', '[]'::jsonb))),
      areas_to_improve = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'areas_to_improve', '[]'::jsonb))),
      alerts = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'alerts', '[]'::jsonb))),
      usual_days = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'usual_days', '[]'::jsonb))),
      usual_time = sp.prev ->> 'usual_time', legacy_mobile_id = sp.prev ->> 'legacy_mobile_id'
    from (
      select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
       where s.import_run_id = v_run.id and s.table_name = 'students' and s.action in ('field_overwritten', 'identity_linked')
       order by s.row_id, (s.action = 'identity_linked') desc
    ) sp
   where st.id = sp.row_id and st.owner_id = v_owner;

  update public.custom_levels cl set name = sp.prev ->> 'name'
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'custom_levels' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where cl.id = sp.row_id and cl.owner_id = v_owner;

  update public.teacher_profiles tp set display_name = coalesce(sp.prev ->> 'display_name', '')
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'teacher_profiles' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where tp.owner_id = sp.row_id and tp.owner_id = v_owner;

  update public.budget_distribution_settings b set
      needs_percent = (sp.prev ->> 'needs_percent')::smallint, wants_percent = (sp.prev ->> 'wants_percent')::smallint, savings_percent = (sp.prev ->> 'savings_percent')::smallint,
      savings_goal_enabled = coalesce((sp.prev ->> 'savings_goal_enabled')::boolean, false), savings_goal_target_amount = (sp.prev ->> 'savings_goal_target_amount')::numeric,
      savings_goal_target_date = (sp.prev ->> 'savings_goal_target_date')::date
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'budget_distribution_settings' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where b.owner_id = sp.row_id and b.owner_id = v_owner;

  update public.teacher_availability ta set
      timezone = sp.prev ->> 'timezone', weekly_blocks = coalesce(sp.prev -> 'weekly_blocks', '[]'::jsonb), exceptions = coalesce(sp.prev -> 'exceptions', '[]'::jsonb)
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'teacher_availability' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where ta.owner_id = sp.row_id and ta.owner_id = v_owner;

  v_summary := jsonb_build_object('deleted_rows', v_deleted_count, 'restored_rows', v_restored_count);

  update public.import_runs set status = 'undone', undone_at = now(), undo_summary = v_summary where id = v_run.id;
  update public.import_undo_previews set status = 'applied' where id = p_undo_preview_id;

  return query select v_summary || jsonb_build_object('replayed', false);
end;
$$;

drop function if exists public._import_apply_extras(uuid, uuid, jsonb);
drop function if exists public._import_project_row(jsonb, jsonb);
drop function if exists public._import_inserted_ids(uuid, text);
drop function if exists public._import_text_array(jsonb);
drop function if exists public._import_ts(text);

drop policy if exists lesson_files_owner_select on storage.objects;
drop policy if exists lesson_files_owner_insert on storage.objects;
drop policy if exists lesson_files_owner_delete on storage.objects;
delete from storage.buckets b where b.id = 'lesson-files' and not exists (select 1 from storage.objects o where o.bucket_id = 'lesson-files');

delete from public.import_undo_dependency_registry where child_table in ('lesson_attachments', 'student_source_extras');
drop table if exists public.student_source_extras;
drop table if exists public.lesson_attachments;
drop table if exists public.material_library_items;
drop table if exists public.device_local_snapshots;
drop table if exists public.phone_extraction_results;

alter table public.teacher_profiles drop column if exists source_updated_at;
alter table public.student_price_history drop column if exists source_entry;
alter table public.calendar_lessons drop column if exists legacy_overlap_group_id;
alter table public.lesson_registration_evaluations drop column if exists source_grades;
alter table public.lesson_registration_students drop column if exists participant_position;
alter table public.lesson_registrations
  drop constraint if exists lesson_registrations_topics_is_array,
  drop constraint if exists lesson_registrations_source_extras_is_object,
  drop constraint if exists lesson_registrations_source_event_type_check,
  drop column if exists topics, drop column if exists objectives, drop column if exists activities, drop column if exists activity_notes, drop column if exists internal_notes,
  drop column if exists material_ids, drop column if exists is_billable, drop column if exists consumes_monthly_package, drop column if exists source_event_type,
  drop column if exists scheduled_duration_minutes, drop column if exists actual_duration_minutes, drop column if exists source_extras;
