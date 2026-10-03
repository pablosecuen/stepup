-- TeacherFlow Web — Fase 10: dos correcciones del dominio Respaldo
-- (importación), encontradas por el E2E de red.
--
-- A) Singletons opcionales con JSON null (teacherProfile, budgetDistribution,
--    teacherAvailability, surchargeSettings.current).
--    Causa raíz: `validateBackupPayload` normaliza una colección ausente con
--    `?? null`, así que el payload guardado en `import_previews` trae JSON
--    `null`. En Postgres `payload->'clave'` sobre un JSON null devuelve el
--    escalar `'null'::jsonb`, que NO es SQL NULL: `_classify_singleton`
--    (guarda `p_backup_doc is null`) la trataba como presente y anunciaba
--    "se creará"; `_apply_singleton` intentaba `INSERT ... VALUES (owner,
--    NULL, NULL, NULL, ...)` en `budget_distribution_settings` -> 23502 y
--    se revertía TODA la importación. El contrato real del móvil
--    (`buildBackupV2.ts`) SIEMPRE emite estas claves, con `null` cuando la
--    profesora nunca las configuró — o sea, el caso común, no un caso raro.
--    Corrección: un singleton cuenta como AUSENTE si es SQL NULL o
--    `jsonb_typeof = 'null'` (nueva `_jsonb_is_absent`). Ausente => la vista
--    previa no anuncia crear/vincular/sobrescribir, y el apply no inserta ni
--    modifica nada (tampoco con una vista previa vieja ya guardada: la
--    guarda se repite en el apply). Un objeto NO nulo pero incompleto o
--    inválido se rechaza con un mensaje claro (22023) — en la vista previa,
--    antes de escribir ninguna tabla, y de nuevo en el apply (rollback
--    completo). Nunca se inventan valores predeterminados.
--
-- B) `apply_undo_backup_import` no era idempotente: si la respuesta del primer
--    deshacer se perdía, el reintento con el MISMO preview de undo ya
--    aplicado devolvía "El preview de undo ya no es válido" aunque la
--    importación ya estaba deshecha. Ahora el primer llamado seguro aplica;
--    un reintento para un run ya `undone` devuelve el resultado canónico
--    (guardado en `import_runs.undo_summary`) sin volver a borrar ni
--    restaurar nada. Dos llamadas simultáneas ya se serializaban con el
--    advisory lock por owner: la segunda espera, ve el preview `applied` y
--    converge en la respuesta canónica. Un run ajeno, un preview vencido o
--    un run cuyo "deshacer" fue descartado (snapshots purgados) siguen
--    rechazándose; los snapshots y el historial se conservan.
--
-- Sólo se reemplazan las funciones necesarias; todo lo demás queda idéntico.
-- Las funciones internas nuevas/reemplazadas conservan el revoke masivo de
-- `20260927090000` (sección 12): nunca invocables directamente.

alter table public.import_runs add column if not exists undo_summary jsonb;

comment on column public.import_runs.undo_summary is
  'Resultado canónico del deshacer (filas borradas/restauradas), guardado al aplicarlo: un reintento tras una respuesta perdida lo devuelve sin volver a ejecutar nada. NULL en runs no deshechos y en los deshechos antes de esta migración.';

-- ---------------------------------------------------------------------------
-- A) Singletons: ausencia y validación
-- ---------------------------------------------------------------------------

create or replace function public._jsonb_is_absent(p_doc jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_doc is null or jsonb_typeof(p_doc) = 'null';
$$;

/**
 * Valida un documento singleton NO ausente. Nunca completa ni corrige
 * nada: lo incompleto/inválido se rechaza (22023) con un mensaje claro.
 * El contrato es el del móvil (`BudgetDistributionSettings`,
 * `TeacherAvailability`, `TeacherProfile`, `SurchargeSettings.current`).
 */
create or replace function public._validate_singleton_doc(p_table_name text, p_doc jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_key text;
  v_value numeric;
  v_needs numeric; v_wants numeric; v_savings numeric;
  v_grace numeric; v_first numeric; v_second numeric; v_last numeric;
begin
  if public._jsonb_is_absent(p_doc) then return; end if;

  case p_table_name
    when 'teacher_profiles' then
      if jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_doc->'displayName') is distinct from 'string' then
        raise exception 'El respaldo trae el perfil de la profesora incompleto o inválido (falta el nombre). No se importó nada.' using errcode = '22023';
      end if;

    when 'budget_distribution_settings' then
      if jsonb_typeof(p_doc) <> 'object'
         or jsonb_typeof(p_doc->'distribution') is distinct from 'object'
         or jsonb_typeof(p_doc->'savingsGoal') is distinct from 'object' then
        raise exception 'El respaldo trae la distribución 50/30/20 incompleta o inválida (faltan la distribución o el objetivo de ahorro). No se importó nada.' using errcode = '22023';
      end if;
      foreach v_key in array array['needs', 'wants', 'savings']
      loop
        if jsonb_typeof(p_doc->'distribution'->v_key) is distinct from 'number' then
          raise exception 'El respaldo trae la distribución 50/30/20 incompleta o inválida (falta o no es numérico: %). No se importó nada.', v_key using errcode = '22023';
        end if;
        v_value := (p_doc->'distribution'->>v_key)::numeric;
        if v_value <> trunc(v_value) or v_value < 0 or v_value > 100 then
          raise exception 'El respaldo trae la distribución 50/30/20 inválida (% debe ser un entero entre 0 y 100). No se importó nada.', v_key using errcode = '22023';
        end if;
      end loop;
      v_needs := (p_doc->'distribution'->>'needs')::numeric;
      v_wants := (p_doc->'distribution'->>'wants')::numeric;
      v_savings := (p_doc->'distribution'->>'savings')::numeric;
      if v_needs + v_wants + v_savings <> 100 then
        raise exception 'El respaldo trae la distribución 50/30/20 inválida (los porcentajes deben sumar 100). No se importó nada.' using errcode = '22023';
      end if;
      if jsonb_typeof(p_doc->'savingsGoal'->'enabled') is distinct from 'boolean'
         or coalesce(jsonb_typeof(p_doc->'savingsGoal'->'targetAmount'), 'missing') not in ('number', 'null')
         or coalesce(jsonb_typeof(p_doc->'savingsGoal'->'targetDate'), 'missing') not in ('string', 'null') then
        raise exception 'El respaldo trae el objetivo de ahorro incompleto o inválido. No se importó nada.' using errcode = '22023';
      end if;
      if jsonb_typeof(p_doc->'savingsGoal'->'targetDate') = 'string' then
        begin
          perform (p_doc->'savingsGoal'->>'targetDate')::date;
        exception when others then
          raise exception 'El respaldo trae el objetivo de ahorro con una fecha inválida. No se importó nada.' using errcode = '22023';
        end;
      end if;

    when 'teacher_availability' then
      if jsonb_typeof(p_doc) <> 'object'
         or jsonb_typeof(p_doc->'timezone') is distinct from 'string'
         or btrim(p_doc->>'timezone') = ''
         or jsonb_typeof(p_doc->'weeklyBlocks') is distinct from 'array'
         or jsonb_typeof(p_doc->'exceptions') is distinct from 'array' then
        raise exception 'El respaldo trae la disponibilidad incompleta o inválida (faltan la zona horaria, los bloques semanales o las excepciones). No se importó nada.' using errcode = '22023';
      end if;

    when 'surcharge_settings' then
      if jsonb_typeof(p_doc) <> 'object' then
        raise exception 'El respaldo trae la configuración de recargos incompleta o inválida. No se importó nada.' using errcode = '22023';
      end if;
      foreach v_key in array array['graceDay', 'firstLateDay', 'firstLatePercentage', 'secondLateDay', 'secondLatePercentage', 'lastLateDay', 'lastLatePercentage']
      loop
        if jsonb_typeof(p_doc->v_key) is distinct from 'number' then
          raise exception 'El respaldo trae la configuración de recargos incompleta o inválida (falta o no es numérico: %). No se importó nada.', v_key using errcode = '22023';
        end if;
        v_value := (p_doc->>v_key)::numeric;
        if v_value <> trunc(v_value) or v_value < 0
           or (v_key like '%Day' and (v_value < 1 or v_value > 31)) then
          raise exception 'El respaldo trae la configuración de recargos inválida (%: valor fuera de rango). No se importó nada.', v_key using errcode = '22023';
        end if;
      end loop;
      v_grace := (p_doc->>'graceDay')::numeric; v_first := (p_doc->>'firstLateDay')::numeric;
      v_second := (p_doc->>'secondLateDay')::numeric; v_last := (p_doc->>'lastLateDay')::numeric;
      if not (v_grace < v_first and v_first < v_second and v_second < v_last) then
        raise exception 'El respaldo trae la configuración de recargos inválida (los días deben ir en orden creciente). No se importó nada.' using errcode = '22023';
      end if;

    else
      raise exception 'Tabla singleton no reconocida: %', p_table_name;
  end case;
end;
$$;

/**
 * Singleton (teacher_profiles/budget_distribution_settings/teacher_availability/
 * surcharge_settings): a lo sumo 1 fila, PK=owner_id. Idéntica a la versión
 * de 20260927090000 salvo: (1) un documento SQL NULL o JSON null es AUSENTE
 * (`present_in_backup=false`, nunca "se creará"); (2) un documento no nulo se
 * valida antes de clasificar (22023 si está incompleto o es inválido).
 */
create or replace function public._classify_singleton(p_table_name text, p_owner uuid, p_backup_doc jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_web_c jsonb;
  v_backup_c jsonb;
begin
  if public._jsonb_is_absent(p_backup_doc) then
    return jsonb_build_object('present_in_backup', false);
  end if;

  perform public._validate_singleton_doc(p_table_name, p_backup_doc);

  -- surcharge_settings: insert-only puro (decisión de Joaquín, Fase 8 —
  -- recargos automáticos desactivados estructuralmente): nunca ofrece
  -- override ni "conflicto" resoluble.
  if p_table_name = 'surcharge_settings' then
    if exists(select 1 from public.surcharge_settings s where s.owner_id = p_owner) then
      return jsonb_build_object('present_in_backup', true, 'status', 'preserved');
    end if;
    return jsonb_build_object('present_in_backup', true, 'status', 'insert');
  end if;

  case p_table_name
    when 'teacher_profiles' then
      select jsonb_build_object('display_name', btrim(coalesce(t.display_name, ''))) into v_web_c
        from public.teacher_profiles t where t.owner_id = p_owner;
      v_backup_c := jsonb_build_object('display_name', btrim(coalesce(p_backup_doc->>'displayName', '')));
    when 'budget_distribution_settings' then
      select jsonb_build_object('needs_percent', t.needs_percent, 'wants_percent', t.wants_percent, 'savings_percent', t.savings_percent) into v_web_c
        from public.budget_distribution_settings t where t.owner_id = p_owner;
      v_backup_c := jsonb_build_object(
        'needs_percent', (p_backup_doc->'distribution'->>'needs')::smallint,
        'wants_percent', (p_backup_doc->'distribution'->>'wants')::smallint,
        'savings_percent', (p_backup_doc->'distribution'->>'savings')::smallint
      );
    when 'teacher_availability' then
      select jsonb_build_object(
        'timezone', t.timezone,
        'weekly_blocks', public._sorted_jsonb_array_by_key(t.weekly_blocks, 'id'),
        'exceptions', public._sorted_jsonb_array_by_key(t.exceptions, 'id')
      ) into v_web_c
        from public.teacher_availability t where t.owner_id = p_owner;
      v_backup_c := jsonb_build_object(
        'timezone', p_backup_doc->>'timezone',
        'weekly_blocks', public._sorted_jsonb_array_by_key(p_backup_doc->'weeklyBlocks', 'id'),
        'exceptions', public._sorted_jsonb_array_by_key(p_backup_doc->'exceptions', 'id')
      );
    else raise exception 'Tabla singleton no reconocida: %', p_table_name;
  end case;

  if v_web_c is null then
    return jsonb_build_object('present_in_backup', true, 'status', 'insert');
  end if;

  if v_web_c = v_backup_c then
    return jsonb_build_object('present_in_backup', true, 'status', 'equal', 'row_id', p_owner);
  end if;
  return jsonb_build_object('present_in_backup', true, 'status', 'conflict', 'row_id', p_owner, 'web', v_web_c, 'backup', v_backup_c);
end;
$$;

/**
 * Idéntica a 20260927090000 salvo: documento ausente (SQL NULL o JSON null) =>
 * no inserta ni modifica nada, aun si una vista previa ANTERIOR a esta
 * migración lo había clasificado como alta; un documento no nulo se valida
 * (22023, rollback completo) y se inserta SIN valores predeterminados
 * inventados.
 */
create or replace function public._apply_singleton(p_run_id uuid, p_owner uuid, p_table_name text, p_backup_doc jsonb, p_classification_entry jsonb, p_field_overrides jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_fields text[];
  v_field text;
  v_exists boolean;
begin
  if public._jsonb_is_absent(p_backup_doc) then
    return; -- el backup no traía esta colección (o la traía null): nada que hacer
  end if;
  if not (p_classification_entry ? 'present_in_backup') or not (p_classification_entry->>'present_in_backup')::boolean then
    return; -- la vista previa tampoco la consideró presente
  end if;

  perform public._validate_singleton_doc(p_table_name, p_backup_doc);

  case p_table_name
    when 'teacher_profiles' then select exists(select 1 from public.teacher_profiles t where t.owner_id = p_owner) into v_exists;
    when 'budget_distribution_settings' then select exists(select 1 from public.budget_distribution_settings t where t.owner_id = p_owner) into v_exists;
    when 'teacher_availability' then select exists(select 1 from public.teacher_availability t where t.owner_id = p_owner) into v_exists;
  end case;

  if not v_exists then
    case p_table_name
      when 'teacher_profiles' then
        insert into public.teacher_profiles (owner_id, display_name) values (p_owner, btrim(p_backup_doc->>'displayName'));
      when 'budget_distribution_settings' then
        insert into public.budget_distribution_settings (owner_id, needs_percent, wants_percent, savings_percent, savings_goal_enabled, savings_goal_target_amount, savings_goal_target_date)
          values (p_owner, (p_backup_doc->'distribution'->>'needs')::smallint, (p_backup_doc->'distribution'->>'wants')::smallint, (p_backup_doc->'distribution'->>'savings')::smallint,
                  (p_backup_doc->'savingsGoal'->>'enabled')::boolean, (p_backup_doc->'savingsGoal'->>'targetAmount')::numeric, (p_backup_doc->'savingsGoal'->>'targetDate')::date);
      when 'teacher_availability' then
        insert into public.teacher_availability (owner_id, timezone, weekly_blocks, exceptions)
          values (p_owner, p_backup_doc->>'timezone', p_backup_doc->'weeklyBlocks', p_backup_doc->'exceptions');
    end case;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, p_table_name, p_owner, 'inserted', null, public._singleton_row_json(p_table_name, p_owner));
    return;
  end if;

  -- Ya existe: sólo se toca si hay overrides autorizados para esta tabla.
  select array_agg(distinct x.field) into v_fields
    from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as e(table_name text, row_id uuid, fields text[])
    cross join lateral unnest(e.fields) as x(field)
    where e.table_name = p_table_name and e.row_id = p_owner;

  if v_fields is null then return; end if; -- sin override -> se conserva la web, sin tocar nada

  v_before := public._singleton_row_json(p_table_name, p_owner);
  foreach v_field in array v_fields
  loop
    case p_table_name || ':' || v_field
      when 'teacher_profiles:display_name' then update public.teacher_profiles set display_name = btrim(p_backup_doc->>'displayName') where owner_id = p_owner;
      when 'budget_distribution_settings:needs_percent' then update public.budget_distribution_settings set needs_percent = (p_backup_doc->'distribution'->>'needs')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:wants_percent' then update public.budget_distribution_settings set wants_percent = (p_backup_doc->'distribution'->>'wants')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:savings_percent' then update public.budget_distribution_settings set savings_percent = (p_backup_doc->'distribution'->>'savings')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_enabled' then update public.budget_distribution_settings set savings_goal_enabled = (p_backup_doc->'savingsGoal'->>'enabled')::boolean where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_target_amount' then update public.budget_distribution_settings set savings_goal_target_amount = (p_backup_doc->'savingsGoal'->>'targetAmount')::numeric where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_target_date' then update public.budget_distribution_settings set savings_goal_target_date = (p_backup_doc->'savingsGoal'->>'targetDate')::date where owner_id = p_owner;
      when 'teacher_availability:timezone' then update public.teacher_availability set timezone = p_backup_doc->>'timezone' where owner_id = p_owner;
      when 'teacher_availability:weekly_blocks' then update public.teacher_availability set weekly_blocks = p_backup_doc->'weeklyBlocks' where owner_id = p_owner;
      when 'teacher_availability:exceptions' then update public.teacher_availability set exceptions = p_backup_doc->'exceptions' where owner_id = p_owner;
      else raise exception 'Override singleton inesperado: %.%', p_table_name, v_field;
    end case;
  end loop;

  -- Constraint real de la base (budget_distribution_settings_sum_100) es el respaldo final si un
  -- override parcial dejara una suma inválida — la transacción completa fallaría y todo se revertiría.
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    values (p_run_id, p_table_name, p_owner, 'field_overwritten', v_before, public._singleton_row_json(p_table_name, p_owner));
end;
$$;

/** Idéntica salvo: current ausente (SQL NULL o JSON null) => no inserta nada; objeto no nulo se valida y se inserta sin valores inventados. */
create or replace function public._apply_surcharge_settings(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_current jsonb;
begin
  v_current := p_payload->'surchargeSettings'->'current';
  if public._jsonb_is_absent(v_current) then return; end if;
  if coalesce((p_classification->'insert_only'->'surcharge_settings'->>'status'), '') <> 'insert' then return; end if;
  if exists(select 1 from public.surcharge_settings s where s.owner_id = p_owner) then return; end if;

  perform public._validate_singleton_doc('surcharge_settings', v_current);

  insert into public.surcharge_settings (owner_id, enabled, grace_day, first_late_day, first_late_percentage, second_late_day, second_late_percentage, last_late_day, last_late_percentage, pending, pending_effective_from)
    values (
      p_owner, false, -- Fase 8: `enabled` siempre false, recargos automáticos desactivados estructuralmente, nunca se reactiva desde un backup
      (v_current->>'graceDay')::smallint, (v_current->>'firstLateDay')::smallint, (v_current->>'firstLatePercentage')::smallint,
      (v_current->>'secondLateDay')::smallint, (v_current->>'secondLatePercentage')::smallint,
      (v_current->>'lastLateDay')::smallint, (v_current->>'lastLatePercentage')::smallint,
      p_payload->'surchargeSettings'->'pending', p_payload->'surchargeSettings'->>'pendingEffectiveFrom'
    );
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    values (p_run_id, 'surcharge_settings', p_owner, 'inserted', null, public._singleton_row_json('surcharge_settings', p_owner));
end;
$$;

revoke all on function public._jsonb_is_absent(jsonb) from public, anon, authenticated;
revoke all on function public._validate_singleton_doc(text, jsonb) from public, anon, authenticated;
revoke all on function public._classify_singleton(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._apply_singleton(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._apply_surcharge_settings(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B) apply_undo_backup_import idempotente
-- ---------------------------------------------------------------------------

/**
 * Fase 2 del deshacer. Idéntica a 20260927090000 salvo:
 *  - un preview de undo YA aplicado cuyo run está `undone` devuelve el
 *    resultado canónico (`undo_summary` + `replayed: true`) sin tocar nada
 *    — reintento seguro tras una respuesta perdida;
 *  - rechaza (nunca "deshace" en vacío) un run cuyo deshacer fue descartado
 *    (`snapshots_purged_at`);
 *  - guarda el resultado del primer deshacer en `import_runs.undo_summary`.
 * La concurrencia sigue resuelta por el advisory lock por owner: la segunda
 * llamada espera, ve el preview `applied` y converge en la respuesta canónica.
 */
create or replace function public.apply_undo_backup_import(p_undo_preview_id uuid)
returns table (summary jsonb)
language plpgsql security definer set search_path = '' as $$
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
$$;

revoke all on function public.apply_undo_backup_import(uuid) from public;
revoke all on function public.apply_undo_backup_import(uuid) from anon;
grant execute on function public.apply_undo_backup_import(uuid) to authenticated;
