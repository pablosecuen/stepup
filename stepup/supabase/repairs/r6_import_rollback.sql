-- R6 — Rollback MANUAL de las importaciones por lotes (NO es una migración; no se aplica con `db push`). Vuelve a definir las 4 RPC públicas con el
-- cuerpo EXACTO que tenían antes de R6 (c28e114, sacado de Production): firma, resultado y privilegios no cambian (CREATE OR REPLACE conserva el ACL),
-- así que la web desplegada sigue funcionando. Las funciones internas `_classify_*`, `_apply_*` y `_external_*` anteriores NUNCA se tocaron, por eso basta
-- con esto. Las funciones nuevas `_import_*` quedan en la base sin uso y sin EXECUTE para la API.
--
-- ES UNA REGRESIÓN deliberada: con este rollback vuelven (1) la vista previa y la aplicación cuadráticas (la aplicación pasa de 8 s con ~5.000 filas y se
-- cancela), (2) la imposibilidad de aplicar un respaldo con historial de niveles, (3) la imposibilidad de deshacer una importación con vínculos entre filas,
-- y desaparecen los límites por importación y la proyección de cuotas al analizar. Ejecutar sólo si R6 rompiera algo que la aplicación necesita, y volver a
-- aplicar R6 después de corregirlo (`supabase migration repair --status reverted 20261010100000 20261010110000 20261010120000 20261010130000`).

CREATE OR REPLACE FUNCTION public.preview_backup_import(p_payload jsonb, p_excluded_collections jsonb)
 RETURNS TABLE(preview_id uuid, expires_at timestamp with time zone, summary jsonb, classification jsonb, excluded_collections jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_size_bytes int;
  v_students jsonb; v_custom_levels jsonb;
  v_teacher_profile jsonb; v_budget jsonb; v_availability jsonb;
  v_training_agreements jsonb; v_level_history jsonb; v_surcharge jsonb;
  v_recurrence jsonb; v_calendar jsonb; v_lesson_registrations jsonb;
  v_financial jsonb;
  v_classification jsonb;
  v_preview_id uuid;
  v_checksum text;
  v_row jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  v_size_bytes := pg_column_size(p_payload);
  if v_size_bytes > 20 * 1024 * 1024 then
    raise exception 'El backup supera el tamaño máximo permitido.';
  end if;

  -- Limpieza perezosa de previews propios PENDIENTES vencidos (>24h) —
  -- nunca de otra cuenta. Nunca de un preview 'applied': `import_runs.preview_id`
  -- lo referencia sin cascada a propósito (retención real del run, ver
  -- sección 7 del diseño) — intentar borrarlo violaría esa FK.
  delete from public.import_previews as ip
    where ip.owner_id = v_owner and ip.status = 'pending' and ip.expires_at < now() - interval '24 hours';

  v_students := public._classify_students(v_owner, p_payload);
  v_custom_levels := public._classify_custom_levels(v_owner, p_payload);
  v_teacher_profile := public._classify_singleton('teacher_profiles', v_owner, p_payload->'teacherProfile');
  v_budget := public._classify_singleton('budget_distribution_settings', v_owner, p_payload->'budgetDistribution');
  v_availability := public._classify_singleton('teacher_availability', v_owner, p_payload->'teacherAvailability');
  v_training_agreements := public._classify_insert_only('training_billing_agreements', v_owner, p_payload->'trainingBillingAgreements');
  v_level_history := public._classify_insert_only('student_level_history', v_owner, (
    select coalesce(jsonb_agg(jsonb_build_object('id', entry->>'id', 'studentId', key)), '[]'::jsonb)
      from jsonb_each(coalesce(p_payload->'profiles', '{}'::jsonb)) as p(key, profile)
      cross join lateral jsonb_array_elements(coalesce(profile->'levelHistory', '[]'::jsonb)) as entry
      where entry->>'id' is not null
  ));
  v_surcharge := public._classify_singleton('surcharge_settings', v_owner, p_payload->'surchargeSettings'->'current');

  v_recurrence := public._classify_recurrence_rules(v_owner, p_payload, v_students);
  v_calendar := public._classify_calendar_lessons(v_owner, p_payload, v_students);
  v_lesson_registrations := public._classify_lesson_registrations(v_owner, p_payload, v_students);

  -- package_purchases/package_credit_movements no tienen clasificador
  -- propio: siempre viajan dentro del grafo financiero (ver comentario en
  -- la sección 4, justo antes de `_external_ref_available`).
  v_financial := public._classify_financial_components(v_owner, p_payload, v_students, v_training_agreements, v_calendar, v_lesson_registrations);

  v_classification := jsonb_build_object(
    'maestros', jsonb_build_object(
      'students', v_students,
      'custom_levels', v_custom_levels,
      'teacher_profiles', v_teacher_profile,
      'budget_distribution_settings', v_budget,
      'teacher_availability', v_availability
    ),
    'insert_only', jsonb_build_object(
      'training_billing_agreements', v_training_agreements,
      'student_level_history', v_level_history,
      'surcharge_settings', v_surcharge
    ),
    'aggregates', jsonb_build_object(
      'recurrence_rules', v_recurrence,
      'calendar_lessons', v_calendar,
      'lesson_registrations', v_lesson_registrations,
      'financial_components', v_financial
    )
  );

  v_checksum := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.import_previews (owner_id, backup_checksum, schema_version, app_version, normalized_payload, classification, excluded_collections)
    values (v_owner, v_checksum, coalesce((p_payload->>'schemaVersion')::int, 2), p_payload->>'appVersion', p_payload, v_classification, coalesce(p_excluded_collections, '{}'::jsonb))
    returning id into v_preview_id;

  -- Huellas de todas las filas YA EXISTENTES matched (maestros con
  -- override real: students/custom_levels/singletons) — nunca de las
  -- filas "alta" (nada que proteger todavía) ni de las insert-only (sin
  -- override posible, no hace falta protegerlas fila por fila).
  for v_row in select * from jsonb_array_elements(coalesce(v_students->'equal', '[]'::jsonb) || coalesce(v_students->'conflicts', '[]'::jsonb))
  loop
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'students', (v_row->>'row_id')::uuid, public._fingerprint_row('students', (v_row->>'row_id')::uuid, v_owner));
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(v_custom_levels->'equal', '[]'::jsonb) || coalesce(v_custom_levels->'conflicts', '[]'::jsonb))
  loop
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'custom_levels', (v_row->>'row_id')::uuid, public._fingerprint_row('custom_levels', (v_row->>'row_id')::uuid, v_owner));
  end loop;
  if v_teacher_profile ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_profiles', v_owner, public._fingerprint_row('teacher_profiles', v_owner, v_owner));
  end if;
  if v_budget ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'budget_distribution_settings', v_owner, public._fingerprint_row('budget_distribution_settings', v_owner, v_owner));
  end if;
  if v_availability ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_availability', v_owner, public._fingerprint_row('teacher_availability', v_owner, v_owner));
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(v_students->'duplicates', '[]'::jsonb))
  loop
    insert into public.import_preview_duplicate_candidates (preview_id, backup_legacy_mobile_id, candidate_student_id, match_signals, candidate_fingerprint, field_diff)
      values (
        v_preview_id, v_row->>'backup_legacy_mobile_id', (v_row->>'candidate_student_id')::uuid,
        array(select jsonb_array_elements_text(v_row->'match_signals')),
        v_row->>'candidate_fingerprint', v_row->'field_diff'
      );
  end loop;

  return query
    select v_preview_id, ip.expires_at,
      jsonb_build_object(
        'students', jsonb_build_object(
          'inserts', jsonb_array_length(v_students->'inserts'), 'equal', jsonb_array_length(v_students->'equal'),
          'conflicts', jsonb_array_length(v_students->'conflicts'), 'possible_duplicates', jsonb_array_length(v_students->'duplicates')
        )
      ),
      v_classification, coalesce(p_excluded_collections, '{}'::jsonb)
    from public.import_previews ip where ip.id = v_preview_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_backup_import(p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb)
 RETURNS TABLE(import_run_id uuid, summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_preview public.import_previews%rowtype;
  v_run_id uuid;
  v_summary jsonb;
  v_fp record;
  v_current_fp text;
  v_dup record;
  v_current_dup_fp text;
  v_ins record;
  v_item record;
  v_dec record;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_preview from public.import_previews where id = p_preview_id and owner_id = v_owner for update;
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
    values (v_owner, p_preview_id, v_preview.backup_checksum, v_preview.schema_version, v_preview.app_version, '{}'::jsonb, coalesce(p_field_overrides, '[]'::jsonb), coalesce(p_duplicate_decisions, '[]'::jsonb), v_preview.normalized_payload)
    on conflict (owner_id, preview_id) do nothing
    returning id into v_run_id;

  if v_run_id is null then
    select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  for v_fp in select * from public.import_preview_row_fingerprints where preview_id = p_preview_id
  loop
    v_current_fp := public._fingerprint_row(v_fp.table_name, v_fp.row_id, v_owner);
    if v_current_fp is distinct from v_fp.fingerprint then
      raise exception 'La fila % de % cambió desde que se generó el preview. Generá un preview nuevo.', v_fp.row_id, v_fp.table_name;
    end if;
  end loop;

  for v_dup in select * from public.import_preview_duplicate_candidates where preview_id = p_preview_id
  loop
    v_current_dup_fp := public._fingerprint_row('students', v_dup.candidate_student_id, v_owner);
    if v_current_dup_fp is distinct from v_dup.candidate_fingerprint then
      raise exception 'El alumno candidato a duplicado % cambió desde el preview. Generá uno nuevo.', v_dup.candidate_student_id;
    end if;
  end loop;

  for v_ins in select * from jsonb_to_recordset(v_preview.classification->'maestros'->'students'->'inserts') as x(legacy_mobile_id text)
  loop
    if exists(select 1 from public.students s where s.owner_id = v_owner and s.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El alumno % ya existe — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;
  end loop;
  for v_ins in select * from jsonb_to_recordset(v_preview.classification->'maestros'->'custom_levels'->'inserts') as x(legacy_mobile_id text)
  loop
    if exists(select 1 from public.custom_levels c where c.owner_id = v_owner and c.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El nivel % ya existe — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;
  end loop;
  for v_ins in select * from jsonb_to_recordset(v_preview.classification->'insert_only'->'training_billing_agreements'->'inserts') as x(legacy_mobile_id text)
  loop
    if exists(select 1 from public.training_billing_agreements a where a.owner_id = v_owner and a.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El acuerdo % ya existe — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;
  end loop;
  -- Duplicados "crear aparte": mismo pre-chequeo defensivo que altas, antes
  -- de invocar `_apply_students` (corrección 20260927110000).
  for v_dec in select * from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
    where decision = 'create_separate'
  loop
    if exists(select 1 from public.students s where s.owner_id = v_owner and s.legacy_mobile_id = v_dec.backup_legacy_mobile_id) then
      raise exception 'El alumno % ya existe — generá un preview nuevo.', v_dec.backup_legacy_mobile_id;
    end if;
  end loop;
  for v_item in select value as v from jsonb_array_elements(v_preview.classification->'aggregates'->'recurrence_rules') where value->>'status' = 'insertable'
  loop
    if exists(select 1 from public.recurrence_rules r where r.owner_id = v_owner and r.legacy_mobile_id = v_item.v->>'legacy_mobile_id') then
      raise exception 'La regla % ya existe — generá un preview nuevo.', v_item.v->>'legacy_mobile_id';
    end if;
  end loop;
  for v_item in select value as v from jsonb_array_elements(v_preview.classification->'aggregates'->'calendar_lessons') where value->>'status' = 'insertable'
  loop
    if exists(select 1 from public.calendar_lessons c where c.owner_id = v_owner and c.legacy_mobile_id = v_item.v->>'legacy_mobile_id') then
      raise exception 'La clase % ya existe — generá un preview nuevo.', v_item.v->>'legacy_mobile_id';
    end if;
  end loop;
  for v_item in select value as v from jsonb_array_elements(v_preview.classification->'aggregates'->'lesson_registrations') where value->>'status' = 'insertable'
  loop
    if exists(select 1 from public.lesson_registrations l where l.owner_id = v_owner and l.legacy_mobile_id = v_item.v->>'legacy_mobile_id') then
      raise exception 'El registro % ya existe — generá un preview nuevo.', v_item.v->>'legacy_mobile_id';
    end if;
  end loop;
  -- Las filas de componentes financieros se re-verifican individualmente
  -- dentro de cada `_apply_*` financiero (misma defensa exacta, evita
  -- duplicar 8 ramas de existencia acá).

  perform public._validate_field_overrides(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  perform public._validate_duplicate_decisions(p_preview_id, p_duplicate_decisions);

  perform public._apply_students(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  perform public._apply_custom_levels(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification, p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_profiles', v_preview.normalized_payload->'teacherProfile', v_preview.classification->'maestros'->'teacher_profiles', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'budget_distribution_settings', v_preview.normalized_payload->'budgetDistribution', v_preview.classification->'maestros'->'budget_distribution_settings', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_availability', v_preview.normalized_payload->'teacherAvailability', v_preview.classification->'maestros'->'teacher_availability', p_field_overrides);
  perform public._apply_training_billing_agreements(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_student_level_history(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_surcharge_settings(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_recurrence_rules(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_calendar_lessons(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_recurrence_exceptions(v_run_id, v_owner, v_preview.normalized_payload);
  perform public._apply_lesson_registrations(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_financial_components(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);

  perform public._validate_import_invariants(v_run_id, v_owner);

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
$function$
;

CREATE OR REPLACE FUNCTION public.preview_undo_backup_import(p_import_run_id uuid)
 RETURNS TABLE(undo_preview_id uuid, is_safe boolean, unsafe_rows jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_run public.import_runs%rowtype;
  v_unsafe jsonb := '[]'::jsonb;
  v_snap record;
  v_current text;
  v_deps jsonb;
  v_id uuid;
  v_parent_tables text[] := array['students','training_billing_agreements','recurrence_rules','calendar_lessons','lesson_registrations','package_purchases','payment_charges','payments'];
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  delete from public.import_undo_previews where owner_id = v_owner and (status <> 'pending' or expires_at < now() - interval '24 hours');

  select * into v_run from public.import_runs where id = p_import_run_id and owner_id = v_owner;
  if not found then raise exception 'Importación no encontrada.'; end if;
  if v_run.status <> 'applied' then raise exception 'Esta importación ya fue deshecha.'; end if;
  if v_run.undo_expires_at < now() then raise exception 'El plazo para deshacer esta importación ya venció (%).', v_run.undo_expires_at; end if;

  for v_snap in select * from public.import_run_row_snapshots where import_run_id = p_import_run_id
  loop
    -- 1) ¿La fila misma cambió desde que la importación la escribió?
    v_current := public._fingerprint_row(v_snap.table_name, v_snap.row_id, v_owner);
    if v_current is distinct from public._fingerprint_canonical(v_snap.table_name, v_snap.new_row) then
      v_unsafe := v_unsafe || jsonb_build_object('table_name', v_snap.table_name, 'row_id', v_snap.row_id, 'reason', 'editada después de la importación');
      continue;
    end if;

    -- 2) Si es una tabla "padre" real, ¿alguna dependencia externa (ajena a este run) la referencia ahora?
    if v_snap.action = 'inserted' and v_snap.table_name = any(v_parent_tables) then
      v_deps := public._external_dependency_blockers(v_snap.table_name, v_snap.row_id, p_import_run_id, v_owner);
      if jsonb_array_length(v_deps) > 0 then
        v_unsafe := v_unsafe || jsonb_build_object('table_name', v_snap.table_name, 'row_id', v_snap.row_id, 'reason', 'tiene datos creados después de la importación que dependen de ella', 'blocking_children', v_deps);
      end if;
    end if;
  end loop;

  insert into public.import_undo_previews (import_run_id, owner_id, is_safe, unsafe_rows)
    values (p_import_run_id, v_owner, jsonb_array_length(v_unsafe) = 0, v_unsafe)
    returning id into v_id;

  return query select v_id, (jsonb_array_length(v_unsafe) = 0), v_unsafe;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_undo_backup_import(p_undo_preview_id uuid)
 RETURNS TABLE(summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_undo_preview public.import_undo_previews%rowtype;
  v_run public.import_runs%rowtype;
  v_snap record;
  v_current text;
  v_deps jsonb;
  v_parent_tables text[] := array['students','training_billing_agreements','recurrence_rules','calendar_lessons','lesson_registrations','package_purchases','payment_charges','payments'];
  v_reverse_order text[] := array[
    'package_credit_movements','first_month_proration_decisions','initial_paid_surcharge_corrections','payment_adjustments','payment_allocations',
    'payment_charges','payments','package_purchases',
    'lesson_registration_homework_reviews','lesson_registration_evaluations','lesson_registration_attendance','lesson_registration_students','lesson_registrations',
    'recurrence_exceptions','calendar_lesson_participants','calendar_lessons','recurrence_rule_participants','recurrence_rules',
    'surcharge_settings','student_level_history','training_billing_agreements',
    'teacher_availability','budget_distribution_settings','teacher_profiles','custom_levels','students'
  ];
  v_table text;
  v_restored_count int := 0;
  v_deleted_count int := 0;
  v_summary jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_undo_preview from public.import_undo_previews where id = p_undo_preview_id and owner_id = v_owner for update;
  if not found then raise exception 'El preview de undo no existe o no te pertenece.'; end if;

  -- Reintento (respuesta perdida / doble clic / segunda llamada simultánea):
  -- el undo ya se aplicó para este preview — resultado canónico, cero escrituras.
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

  -- Re-verificación COMPLETA, nunca confía en `is_safe` de la fase 1.
  for v_snap in select * from public.import_run_row_snapshots where import_run_id = v_run.id
  loop
    v_current := public._fingerprint_row(v_snap.table_name, v_snap.row_id, v_owner);
    if v_current is distinct from public._fingerprint_canonical(v_snap.table_name, v_snap.new_row) then
      raise exception 'La fila % de % cambió desde el preview de undo — deshacer bloqueado por completo, no se tocó nada. Generá un preview de undo nuevo.', v_snap.row_id, v_snap.table_name;
    end if;
    if v_snap.action = 'inserted' and v_snap.table_name = any(v_parent_tables) then
      v_deps := public._external_dependency_blockers(v_snap.table_name, v_snap.row_id, v_run.id, v_owner);
      if jsonb_array_length(v_deps) > 0 then
        raise exception 'La fila % de % tiene dependencias creadas después de la importación — deshacer bloqueado por completo, no se tocó nada.', v_snap.row_id, v_snap.table_name;
      end if;
    end if;
  end loop;

  -- Todo verificado limpio: borra/restaura en orden inverso real, tabla por tabla, ramas tipadas.
  foreach v_table in array v_reverse_order
  loop
    for v_snap in select * from public.import_run_row_snapshots where import_run_id = v_run.id and table_name = v_table
    loop
      if v_snap.action = 'inserted' then
        case v_table
          when 'students' then delete from public.students where id = v_snap.row_id and owner_id = v_owner;
          when 'custom_levels' then delete from public.custom_levels where id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_profiles' then delete from public.teacher_profiles where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'budget_distribution_settings' then delete from public.budget_distribution_settings where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_availability' then delete from public.teacher_availability where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'training_billing_agreements' then delete from public.training_billing_agreements where id = v_snap.row_id and owner_id = v_owner;
          when 'student_level_history' then delete from public.student_level_history where id = v_snap.row_id and owner_id = v_owner;
          when 'surcharge_settings' then delete from public.surcharge_settings where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'recurrence_rules' then delete from public.recurrence_rules where id = v_snap.row_id and owner_id = v_owner;
          when 'recurrence_rule_participants' then delete from public.recurrence_rule_participants where id = v_snap.row_id and owner_id = v_owner;
          when 'calendar_lessons' then delete from public.calendar_lessons where id = v_snap.row_id and owner_id = v_owner;
          when 'calendar_lesson_participants' then delete from public.calendar_lesson_participants where id = v_snap.row_id and owner_id = v_owner;
          when 'recurrence_exceptions' then delete from public.recurrence_exceptions where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registrations' then delete from public.lesson_registrations where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_students' then delete from public.lesson_registration_students where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_attendance' then delete from public.lesson_registration_attendance where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_evaluations' then delete from public.lesson_registration_evaluations where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_homework_reviews' then delete from public.lesson_registration_homework_reviews where id = v_snap.row_id and owner_id = v_owner;
          when 'package_purchases' then delete from public.package_purchases where id = v_snap.row_id and owner_id = v_owner;
          when 'package_credit_movements' then delete from public.package_credit_movements where id = v_snap.row_id and owner_id = v_owner;
          when 'payment_charges' then delete from public.payment_charges where id = v_snap.row_id and owner_id = v_owner;
          when 'payments' then delete from public.payments where id = v_snap.row_id and owner_id = v_owner;
          when 'payment_allocations' then delete from public.payment_allocations where id = v_snap.row_id and owner_id = v_owner;
          when 'payment_adjustments' then delete from public.payment_adjustments where id = v_snap.row_id and owner_id = v_owner;
          when 'initial_paid_surcharge_corrections' then delete from public.initial_paid_surcharge_corrections where id = v_snap.row_id and owner_id = v_owner;
          when 'first_month_proration_decisions' then delete from public.first_month_proration_decisions where id = v_snap.row_id and owner_id = v_owner;
          else raise exception 'Tabla no reconocida al deshacer: %', v_table;
        end case;
        v_deleted_count := v_deleted_count + 1;
      elsif v_snap.action in ('field_overwritten', 'identity_linked') then
        case v_table
          when 'students' then
            update public.students set
              name = coalesce(v_snap.previous_row->>'name', name), phone = v_snap.previous_row->>'phone', whatsapp = v_snap.previous_row->>'whatsapp',
              email = v_snap.previous_row->>'email', notes = v_snap.previous_row->>'notes', birth_date = (v_snap.previous_row->>'birth_date')::date,
              current_goals = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'current_goals','[]'::jsonb))),
              strengths = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'strengths','[]'::jsonb))),
              areas_to_improve = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'areas_to_improve','[]'::jsonb))),
              alerts = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'alerts','[]'::jsonb))),
              usual_days = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'usual_days','[]'::jsonb))),
              usual_time = v_snap.previous_row->>'usual_time',
              legacy_mobile_id = v_snap.previous_row->>'legacy_mobile_id'
              where id = v_snap.row_id and owner_id = v_owner;
          when 'custom_levels' then
            update public.custom_levels set name = v_snap.previous_row->>'name' where id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_profiles' then
            update public.teacher_profiles set display_name = coalesce(v_snap.previous_row->>'display_name', '') where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'budget_distribution_settings' then
            update public.budget_distribution_settings set
              needs_percent = (v_snap.previous_row->>'needs_percent')::smallint, wants_percent = (v_snap.previous_row->>'wants_percent')::smallint, savings_percent = (v_snap.previous_row->>'savings_percent')::smallint,
              savings_goal_enabled = coalesce((v_snap.previous_row->>'savings_goal_enabled')::boolean, false), savings_goal_target_amount = (v_snap.previous_row->>'savings_goal_target_amount')::numeric, savings_goal_target_date = (v_snap.previous_row->>'savings_goal_target_date')::date
              where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_availability' then
            update public.teacher_availability set timezone = v_snap.previous_row->>'timezone', weekly_blocks = coalesce(v_snap.previous_row->'weekly_blocks','[]'::jsonb), exceptions = coalesce(v_snap.previous_row->'exceptions','[]'::jsonb)
              where owner_id = v_snap.row_id and owner_id = v_owner;
          else raise exception 'Tabla no reconocida al restaurar override: %', v_table;
        end case;
        v_restored_count := v_restored_count + 1;
      end if;
    end loop;
  end loop;

  v_summary := jsonb_build_object('deleted_rows', v_deleted_count, 'restored_rows', v_restored_count);

  update public.import_runs set status = 'undone', undone_at = now(), undo_summary = v_summary where id = v_run.id;
  update public.import_undo_previews set status = 'applied' where id = p_undo_preview_id;

  return query select v_summary || jsonb_build_object('replayed', false);
end;
$function$
;
