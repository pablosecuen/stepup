-- Rollback de R13: vuelve a las definiciones de R10/R12 y quita lo que agregó. Falla (sin tocar nada) si ya hay cobros de importe 0, exceso separado o incidencias: no se destruye información sin decidirlo.

do $$
begin
  if exists (select 1 from public.payment_charges where original_amount = 0) then raise exception 'R13: hay cobros de importe 0; no se revierte.'; end if;
  if exists (select 1 from public.payment_allocations where excess_amount > 0) then raise exception 'R13: hay exceso de asignaciones separado; no se revierte.'; end if;
  if exists (select 1 from public.origin_incidents) then raise exception 'R13: hay incidencias del origen; no se revierte.'; end if;
  if exists (select 1 from public.initial_paid_surcharge_corrections where voided_payment_missing_ref is not null or new_payment_missing_ref is not null or student_missing_ref is not null) then raise exception 'R13: hay referencias originales inexistentes; no se revierte.'; end if;
end $$;

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
  select coalesce(sum(public._import_len(e -> 'roster') + public._import_len(e -> 'attendance') + public._import_len(e -> 'evaluations') + public._import_len(e -> 'homeworkReviews')
                              + public._import_len(e -> 'attachments') + public._import_len(e -> 'editHistory') + public._import_len(e -> 'participantProgress')), 0)
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
    when 'report_records' then 'id' when 'lesson_attachments' then 'id' when 'lesson_registration_edit_history' then 'id' when 'student_source_extras' then 'id'
  end
$$;

create or replace function public._import_validate_invariants(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Una sola pasada por las instantáneas de la corrida (antes cada regla las recorría de nuevo y releía el JSON de cada fila).
  drop table if exists _iv_snap;
  create temporary table _iv_snap on commit drop as
    select s.table_name, s.row_id, s.action, (s.new_row ->> 'amount') as amount_txt, (s.new_row ->> 'student_id') as student_txt,
           (s.new_row ->> 'charge_type') as charge_type, (s.new_row ->> 'package_id') as package_id, (s.new_row ->> 'legacy_mobile_id') as legacy_id
      from public.import_run_row_snapshots s where s.import_run_id = p_run_id;
  create index on _iv_snap (table_name, row_id);

  if exists (select 1 from _iv_snap s where s.amount_txt is not null and s.amount_txt::numeric < 0) then
    raise exception 'Invariante violada: una fila importada tiene un importe negativo.';
  end if;

  if exists (
    select 1 from public.payments p
      join _iv_snap s on s.table_name = 'payments' and s.row_id = p.id
      left join public.payment_allocations pa on pa.payment_id = p.id
     where p.owner_id = p_owner
     group by p.id, p.amount
    having coalesce(sum(pa.amount), 0) > p.amount
  ) then
    raise exception 'Invariante violada: las asignaciones de un pago superan su importe.';
  end if;

  -- Cargos: sólo cuentan las asignaciones VIGENTES (de pagos NO anulados). La asignación de un pago anulado queda registrada pero ya no paga nada: es la misma regla del motor de
  -- cobros de la web (calculatePaidAmountForCharge) y de la app. Antes se sumaban también las de pagos anulados y un cobro corregido (pago anulado y vuelto a cargar) abortaba la importación.
  -- Las asignaciones vigentes que SIGUEN superando el importe original no se toleran ni se «arreglan»: la importación se detiene y se informa.
  if exists (
    select 1 from public.payment_charges c
      join _iv_snap s on s.table_name = 'payment_charges' and s.row_id = c.id
      left join public.payment_allocations pa on pa.charge_id = c.id
      left join public.payments pm on pm.id = pa.payment_id and pm.voided_at is null
     where c.owner_id = p_owner
     group by c.id, c.original_amount
    having coalesce(sum(pa.amount) filter (where pm.id is not null), 0) > c.original_amount
  ) then
    raise exception 'Invariante violada: las asignaciones de un cargo superan su importe original.';
  end if;

  -- Asume `movement_type='consumo'` cuenta clases consumidas como cantidad positiva en `amount` — mismo criterio que el motor de paquetes existente.
  if exists (
    select 1 from public.package_purchases pp
      join _iv_snap s on s.table_name = 'package_purchases' and s.row_id = pp.id
      left join public.package_credit_movements m on m.package_id = pp.id
     where pp.owner_id = p_owner
     group by pp.id, pp.included_classes
    having coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) > pp.included_classes
  ) then
    raise exception 'Invariante violada: un paquete tiene más clases consumidas que incluidas.';
  end if;

  -- (EXCEPT en lugar de un anti-join: con las filas recién insertadas aún sin estadísticas el planificador elegía un lazo anidado de ~770.000 comparaciones.)
  if exists (
    select s.student_txt::uuid from _iv_snap s
     where s.table_name in ('recurrence_rule_participants','calendar_lesson_participants','lesson_registration_students','lesson_registration_attendance','lesson_registration_evaluations','lesson_registration_homework_reviews')
       and s.student_txt is not null
    except
    select st.id from public.students st where st.owner_id = p_owner
  ) then
    raise exception 'Invariante violada: un participante referencia un alumno de otro owner.';
  end if;

  if exists (
    select 1 from _iv_snap s where s.table_name = 'payment_charges' and s.action = 'inserted' and s.charge_type = 'paquete' and s.package_id is null
  ) then
    raise exception 'Invariante violada: un cargo de tipo paquete quedó sin compra asociada.';
  end if;

  -- Toda decisión de duplicado aceptada debe haberse materializado realmente (`skip` es, a propósito, un no-op) — comprobación por lote.
  if exists (
    select 1 from public.import_runs ir
      cross join lateral jsonb_to_recordset(coalesce(ir.duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
      left join _iv_snap s on s.table_name = 'students' and s.action = 'inserted' and s.legacy_id = x.backup_legacy_mobile_id
     where ir.id = p_run_id and x.decision = 'create_separate' and s.row_id is null
  ) then
    raise exception 'Invariante violada: una decisión «crear aparte» no se materializó.';
  end if;
  if exists (
    select 1 from public.import_runs ir
      cross join lateral jsonb_to_recordset(coalesce(ir.duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
      left join _iv_snap s on s.table_name = 'students' and s.action = 'identity_linked' and s.row_id = x.candidate_student_id
     where ir.id = p_run_id and x.decision = 'link' and s.row_id is null
  ) then
    raise exception 'Invariante violada: una decisión «vincular» no se materializó.';
  end if;
end;
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
  -- R10: contenido pedagógico, estado de registros grupales, fechas originales, historial de ediciones, adjuntos, reportes y extras (antes sólo quedaban en el archivo).
  perform public._import_apply_extras(v_run_id, v_owner, v_payload);

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
    'report_records','lesson_attachments','lesson_registration_edit_history','student_source_extras',
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


revoke all on function public._import_validate_invariants(uuid, uuid) from public, anon, authenticated;

drop function if exists public._import_apply_fidelity(uuid, uuid, jsonb);
drop table if exists public.origin_incidents;
alter table public.initial_paid_surcharge_corrections drop constraint if exists initial_paid_surcharge_corrections_missing_refs_check;
alter table public.initial_paid_surcharge_corrections alter column student_id set not null;
alter table public.initial_paid_surcharge_corrections drop column if exists voided_payment_missing_ref, drop column if exists new_payment_missing_ref, drop column if exists student_missing_ref;
alter table public.payment_allocations drop constraint if exists payment_allocations_excess_check;
alter table public.payment_allocations drop column if exists excess_amount, drop column if exists excess_status, drop column if exists excess_evidence;
alter table public.payment_charges drop constraint if exists payment_charges_original_amount_check;
alter table public.payment_charges add constraint payment_charges_original_amount_check check (original_amount > 0);
