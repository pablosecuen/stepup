-- R6 — Importaciones grandes (4/4): deshacer por LOTES. ADITIVA e idempotente: funciones nuevas `_import_undo_*` (internas, sin EXECUTE para la API) y
-- `preview_undo_backup_import` / `apply_undo_backup_import` redefinidas con la MISMA firma, el mismo resultado, la misma idempotencia y los mismos
-- privilegios. Las funciones anteriores (`_external_dependency_blockers`, `_blocks_undo_via_child`, `_collect_blockers`) NO se tocan.
--
-- Qué cambia (medido, ver docs/R6_IMPORTACIONES_GRANDES.md):
--   * La huella de cada fila importada se compara UNA vez por lote (antes: dos veces por fila, más una por cada hija de cada fila padre) y las
--     dependencias externas se buscan con una consulta por RELACIÓN (≈50 en total) en lugar de ≈22 consultas por alumno.
--   * La vista previa de deshacer y la confirmación comparten el mismo análisis (`_import_undo_analyze`): la confirmación sigue re-verificando TODO
--     bajo el lock y nunca confía en `is_safe` (misma garantía que antes).
--   * El borrado y la restauración van por tabla (una sentencia por tabla, en el mismo orden inverso real).
-- Las relaciones padre → hija salen de `_import_undo_relations()`, que repite EXACTAMENTE las ramas tipadas anteriores (50 relaciones + el caso especial de
-- `report_draft_claims`); una prueba la compara con `import_undo_dependency_registry` (la auditoría contra pg_constraint no cambia).

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

-- Tablas que una importación puede escribir y cómo se identifica su fila (id, u owner_id en las de una sola fila por cuenta).
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
  end
$$;

-- Análisis común de deshacer: ¿cada fila importada sigue idéntica a como la dejó la importación y nada ajeno depende de las filas «padre»?
-- Deja `_iu_state` (una fila por instantánea con `ok`) y devuelve la lista de filas que bloquean (vacía = se puede deshacer).
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

-- ---------------------------------------------------------------------------------------------------------------------
-- Vista previa de deshacer (misma firma, mismo resultado)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.preview_undo_backup_import(p_import_run_id uuid)
returns table(undo_preview_id uuid, is_safe boolean, unsafe_rows jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_run public.import_runs%rowtype;
  v_unsafe jsonb;
  v_id uuid;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  delete from public.import_undo_previews where owner_id = v_owner and (status <> 'pending' or expires_at < now() - interval '24 hours');

  select * into v_run from public.import_runs where id = p_import_run_id and owner_id = v_owner;
  if not found then raise exception 'Importación no encontrada.'; end if;
  if v_run.status <> 'applied' then raise exception 'Esta importación ya fue deshecha.'; end if;
  if v_run.undo_expires_at < now() then raise exception 'El plazo para deshacer esta importación ya venció (%).', v_run.undo_expires_at; end if;

  v_unsafe := public._import_undo_analyze(p_import_run_id, v_owner);

  insert into public.import_undo_previews (import_run_id, owner_id, is_safe, unsafe_rows)
    values (p_import_run_id, v_owner, jsonb_array_length(v_unsafe) = 0, v_unsafe)
    returning id into v_id;

  return query select v_id, (jsonb_array_length(v_unsafe) = 0), v_unsafe;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Deshacer (misma firma, mismo resultado, misma idempotencia)
-- ---------------------------------------------------------------------------------------------------------------------
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
    'teacher_availability','budget_distribution_settings','teacher_profiles','custom_levels','students'
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

revoke all on function public._import_undo_relations() from public, anon, authenticated;
revoke all on function public._import_row_key(text) from public, anon, authenticated;
revoke all on function public._import_undo_analyze(uuid, uuid) from public, anon, authenticated;
