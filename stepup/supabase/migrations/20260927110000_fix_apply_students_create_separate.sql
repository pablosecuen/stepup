-- Fase 9 — corrección puntual: la decisión de duplicado "crear aparte"
-- (create_separate) se validaba y se aceptaba, pero `_apply_students`
-- nunca la materializaba. Bug real, descubierto en vivo durante el E2E del
-- 2026-09-24 contra la cuenta QA (ver docs/WEB_PARITY_PLAN.md): al elegir
-- "Es otra persona: crear aparte" para "PRUEBA WEB F9 E2E SEPARAR",
-- `apply_backup_import` devolvía éxito ("11 fila(s) escrita(s)") sin haber
-- insertado el alumno nuevo — `_apply_students` sólo tenía un camino de
-- escritura para `decision = 'link'` (UPDATE de legacy_mobile_id), ninguno
-- para `create_separate`.
--
-- Migración aditiva nueva — NUNCA se edita
-- 20260927090000_backup_import.sql, ya aplicada. `create or replace
-- function` sobre las 3 funciones involucradas, mismo patrón usado en el
-- resto de Fase 9 para correcciones posteriores a un `db push`.
--
-- Alcance de esta corrección:
--   1. `_insert_student_from_backup_row`: nueva función privada, ÚNICA
--      implementación real del insert de `students` desde una fila cruda
--      del backup — antes vivía duplicada inline en la rama de altas; se
--      extrae para que altas y "crear aparte" nunca puedan divergir.
--   2. `_apply_students`: agrega el camino de escritura que faltaba para
--      `create_separate` — inserta un alumno NUEVO con el
--      `legacy_mobile_id` del backup (nunca toca `candidate_student_id`,
--      que sigue siendo el alumno web original intacto). Al llevar el
--      mismo `legacy_mobile_id`, TODO dato dependiente del backup (pagos,
--      cargos, clases, cuotas, historial) se conecta solo — cada
--      `_apply_*` financiero/de calendario ya resuelve `studentId` del
--      backup buscando por `legacy_mobile_id`, sin cambios necesarios ahí.
--   3. `apply_backup_import`: agrega un pre-chequeo defensivo simétrico al
--      que ya existía para altas, antes de invocar `_apply_students`.
--   4. `_validate_import_invariants`: agrega una invariante general (no
--      sólo para este bug puntual) — toda decisión de duplicado aceptada
--      (`link` o `create_separate`) registrada en `import_runs` debe haber
--      dejado un snapshot real que la respalde; si no, aborta TODA la
--      transacción (rollback nativo de Postgres, la misma garantía que ya
--      usa el resto de esta sección).
--
-- `counts_by_table`/`total_rows_written` en el resumen de
-- `apply_backup_import` NO necesitan tocarse: ya se calculan contando
-- `import_run_row_snapshots` real — una vez que el insert que faltaba
-- ahora sí escribe su snapshot, el conteo queda correcto por construcción.
--
-- Idempotencia/concurrencia: heredadas sin cambios de
-- `apply_backup_import` (advisory lock por owner + `unique
-- (owner_id, preview_id)` + `on conflict do nothing ... returning`) — esta
-- corrección sólo agrega un camino de escritura DENTRO de `_apply_students`,
-- que ya corre como máximo una vez por `import_run` bajo esa garantía
-- existente, sin tocar el orquestador de locks.
--
-- Deshacer (`apply_undo_backup_import`): sin cambios — ya es genérico por
-- `import_run_row_snapshots` (`table_name = 'students'`, `action =
-- 'inserted'`), indistinguible de una alta limpia. El alumno creado por
-- "crear aparte" queda correctamente cubierto por el undo existente en
-- cuanto tiene su snapshot.

-- =============================================================================
-- Helper único: insert real de `students` desde una fila cruda del backup.
-- =============================================================================

create or replace function public._insert_student_from_backup_row(p_owner uuid, p_row jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_new_id uuid;
begin
  insert into public.students (
    owner_id, legacy_mobile_id, name, phone, whatsapp, email, usual_days, usual_time, notes, birth_date,
    levels, initial_level, modality, status, category, billing_type, billing_plan, date_joined,
    last_reactivated_at, status_change_date, usual_duration_minutes, weekly_frequency, price,
    pending_homework, alerts, current_goals, strengths, areas_to_improve, is_featured, is_new
  ) values (
    p_owner, p_row->>'id', p_row->>'name', p_row->>'phone', p_row->>'whatsapp', p_row->>'email',
    array(select jsonb_array_elements_text(coalesce(p_row->'usualDays', '[]'::jsonb))), p_row->>'usualTime', p_row->>'notes', (p_row->>'birthDate')::date,
    array(select jsonb_array_elements_text(coalesce(p_row->'levels', '[]'::jsonb))), coalesce(p_row->>'initialLevel', ''), p_row->>'modality', p_row->>'status', p_row->>'category', p_row->>'billingType',
    p_row->'billingPlan', (p_row->>'dateJoined')::date,
    (p_row->>'lastReactivatedAt')::date, (p_row->>'statusChangeDate')::date, coalesce((p_row->>'usualDurationMinutes')::int, 60), coalesce((p_row->>'weeklyFrequency')::int, 1), coalesce((p_row->>'price')::numeric, 0),
    p_row->>'pendingHomework', array(select jsonb_array_elements_text(coalesce(p_row->'alerts', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_row->'currentGoals', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(p_row->'strengths', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_row->'areasToImprove', '[]'::jsonb))), coalesce((p_row->>'isFeatured')::boolean, false), coalesce((p_row->>'isNew')::boolean, true)
  ) returning id into v_new_id;
  return v_new_id;
end;
$$;

-- =============================================================================
-- `_apply_students`: agrega el camino de "crear aparte" que faltaba.
-- =============================================================================

create or replace function public._apply_students(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ins record;
  v_row jsonb;
  v_new_id uuid;
  v_ov record;
  v_before jsonb;
  v_after jsonb;
  v_field text;
  v_dec record;
begin
  -- Altas (re-verificadas: ni por legacy_mobile_id ni por la heurística de duplicado)
  for v_ins in select * from jsonb_to_recordset(p_classification->'maestros'->'students'->'inserts') as x(legacy_mobile_id text)
  loop
    select r into v_row from jsonb_array_elements(p_payload->'students') t(r) where r->>'id' = v_ins.legacy_mobile_id;
    if exists(select 1 from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El alumno % ya existe — el preview quedó desactualizado.', v_ins.legacy_mobile_id;
    end if;
    if exists(
      select 1 from public.students s where s.owner_id = p_owner and s.legacy_mobile_id is null
        and (
          (btrim(s.name) <> '' and lower(btrim(s.name)) = lower(btrim(v_row->>'name')))
          or (s.email is not null and v_row->>'email' is not null and public._normalize_email(s.email) = public._normalize_email(v_row->>'email') and public._normalize_email(s.email) <> '')
          or (s.phone is not null and v_row->>'phone' is not null and public._normalize_phone(s.phone) = public._normalize_phone(v_row->>'phone') and public._normalize_phone(s.phone) <> '')
        )
    ) then
      raise exception 'Apareció una coincidencia heurística nueva para % desde que se generó el preview — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;

    v_new_id := public._insert_student_from_backup_row(p_owner, v_row);

    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_new_id, 'inserted', null, (select to_jsonb(s) from public.students s where s.id = v_new_id));
  end loop;

  -- Duplicados "crear aparte": alta de un alumno NUEVO con el
  -- legacy_mobile_id del backup. Nunca toca `candidate_student_id` — el
  -- alumno web original (la otra mitad de la decisión) queda intacto. El
  -- chequeo heurístico de la rama de Altas NO se repite acá a propósito:
  -- la profesora ya vio esa coincidencia y decidió explícitamente crear
  -- igual — repetirlo la bloquearía siempre. `apply_backup_import` ya
  -- re-verificó (antes de llamar acá) que el candidato web no cambió
  -- desde el preview.
  for v_dec in select * from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
    where decision = 'create_separate'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'students') t(r) where r->>'id' = v_dec.backup_legacy_mobile_id;
    if v_row is null then
      raise exception 'No se encontró en el backup el alumno duplicado % — el preview quedó desactualizado.', v_dec.backup_legacy_mobile_id;
    end if;
    if exists(select 1 from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_dec.backup_legacy_mobile_id) then
      raise exception 'El alumno % ya existe — el preview quedó desactualizado.', v_dec.backup_legacy_mobile_id;
    end if;

    v_new_id := public._insert_student_from_backup_row(p_owner, v_row);

    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_new_id, 'inserted', null, (select to_jsonb(s) from public.students s where s.id = v_new_id));
  end loop;

  -- Vínculos de identidad (duplicados "link"): asigna legacy_mobile_id,
  -- NUNCA otro campo salvo que además venga en p_field_overrides.
  for v_dec in select * from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
    where decision = 'link'
  loop
    select to_jsonb(s) into v_before from public.students s where s.id = v_dec.candidate_student_id and s.owner_id = p_owner;
    update public.students set legacy_mobile_id = v_dec.backup_legacy_mobile_id where id = v_dec.candidate_student_id and owner_id = p_owner;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_dec.candidate_student_id, 'identity_linked', v_before, (select to_jsonb(s) from public.students s where s.id = v_dec.candidate_student_id));
  end loop;

  -- Overrides de campo (ya validados por `_validate_field_overrides`).
  for v_ov in select * from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as x(table_name text, row_id uuid, fields text[])
    where table_name = 'students'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'students') t(r)
      where r->>'id' = coalesce(
        (select dc.backup_legacy_mobile_id from public.import_preview_duplicate_candidates dc where dc.candidate_student_id = v_ov.row_id limit 1),
        (select s.legacy_mobile_id from public.students s where s.id = v_ov.row_id)
      );
    select to_jsonb(s) into v_before from public.students s where s.id = v_ov.row_id and s.owner_id = p_owner;

    foreach v_field in array v_ov.fields
    loop
      case v_field
        when 'name' then update public.students set name = btrim(coalesce(v_row->>'name','')) where id = v_ov.row_id;
        when 'phone' then update public.students set phone = v_row->>'phone' where id = v_ov.row_id;
        when 'whatsapp' then update public.students set whatsapp = v_row->>'whatsapp' where id = v_ov.row_id;
        when 'email' then update public.students set email = v_row->>'email' where id = v_ov.row_id;
        when 'notes' then update public.students set notes = v_row->>'notes' where id = v_ov.row_id;
        when 'birth_date' then update public.students set birth_date = (v_row->>'birthDate')::date where id = v_ov.row_id;
        when 'current_goals' then update public.students set current_goals = array(select jsonb_array_elements_text(coalesce(v_row->'currentGoals','[]'::jsonb))) where id = v_ov.row_id;
        when 'strengths' then update public.students set strengths = array(select jsonb_array_elements_text(coalesce(v_row->'strengths','[]'::jsonb))) where id = v_ov.row_id;
        when 'areas_to_improve' then update public.students set areas_to_improve = array(select jsonb_array_elements_text(coalesce(v_row->'areasToImprove','[]'::jsonb))) where id = v_ov.row_id;
        when 'alerts' then update public.students set alerts = array(select jsonb_array_elements_text(coalesce(v_row->'alerts','[]'::jsonb))) where id = v_ov.row_id;
        when 'usual_days' then update public.students set usual_days = array(select jsonb_array_elements_text(coalesce(v_row->'usualDays','[]'::jsonb))) where id = v_ov.row_id;
        when 'usual_time' then update public.students set usual_time = v_row->>'usualTime' where id = v_ov.row_id;
        else raise exception 'Campo % inesperado en override de students.', v_field;
      end case;
    end loop;

    select to_jsonb(s) into v_after from public.students s where s.id = v_ov.row_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_ov.row_id, 'field_overwritten', v_before, v_after);
  end loop;
end;
$$;

-- =============================================================================
-- `apply_backup_import`: pre-chequeo defensivo simétrico al de altas, para
-- decisiones "crear aparte", antes de invocar `_apply_students`.
-- =============================================================================

create or replace function public.apply_backup_import(p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns table (import_run_id uuid, summary jsonb)
language plpgsql security definer set search_path = '' as $$
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
$$;

revoke all on function public.apply_backup_import(uuid, jsonb, jsonb) from public;
revoke all on function public.apply_backup_import(uuid, jsonb, jsonb) from anon;
grant execute on function public.apply_backup_import(uuid, jsonb, jsonb) to authenticated;

-- =============================================================================
-- `_validate_import_invariants`: agrega la invariante general "toda
-- decisión de duplicado aceptada debe haberse materializado" — cubre
-- `create_separate` (el bug real) y `link`, de una sola vez.
-- =============================================================================

create or replace function public._validate_import_invariants(p_run_id uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bad record;
  v_run_decisions jsonb;
  v_dec record;
begin
  if exists(
    select 1 from public.import_run_row_snapshots s
      where s.import_run_id = p_run_id
        and s.new_row ? 'amount' and (s.new_row->>'amount')::numeric < 0
  ) then
    raise exception 'Invariante violada: una fila importada tiene un importe negativo.';
  end if;

  for v_bad in
    select p.id, p.amount, coalesce(sum(pa.amount), 0) as allocated
      from public.payments p
      join public.import_run_row_snapshots s on s.import_run_id = p_run_id and s.table_name = 'payments' and s.row_id = p.id
      left join public.payment_allocations pa on pa.payment_id = p.id
      where p.owner_id = p_owner
      group by p.id, p.amount
      having coalesce(sum(pa.amount), 0) > p.amount
  loop
    raise exception 'Invariante violada: las asignaciones del pago % (%) superan su importe (%).', v_bad.id, v_bad.allocated, v_bad.amount;
  end loop;

  for v_bad in
    select c.id, c.original_amount, coalesce(sum(pa.amount), 0) as allocated
      from public.payment_charges c
      join public.import_run_row_snapshots s on s.import_run_id = p_run_id and s.table_name = 'payment_charges' and s.row_id = c.id
      left join public.payment_allocations pa on pa.charge_id = c.id
      where c.owner_id = p_owner
      group by c.id, c.original_amount
      having coalesce(sum(pa.amount), 0) > c.original_amount
  loop
    raise exception 'Invariante violada: las asignaciones del cargo % (%) superan su importe original (%).', v_bad.id, v_bad.allocated, v_bad.original_amount;
  end loop;

  -- Asume `movement_type='consumo'` cuenta clases consumidas como cantidad
  -- positiva en `amount` — mismo criterio que ya usa el motor de paquetes existente.
  for v_bad in
    select pp.id, pp.included_classes, coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) as consumed
      from public.package_purchases pp
      join public.import_run_row_snapshots s on s.import_run_id = p_run_id and s.table_name = 'package_purchases' and s.row_id = pp.id
      left join public.package_credit_movements m on m.package_id = pp.id
      where pp.owner_id = p_owner
      group by pp.id, pp.included_classes
      having coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) > pp.included_classes
  loop
    raise exception 'Invariante violada: el paquete % tiene más clases consumidas (%) que incluidas (%).', v_bad.id, v_bad.consumed, v_bad.included_classes;
  end loop;

  if exists(
    select 1 from public.import_run_row_snapshots s
      where s.import_run_id = p_run_id and s.table_name in ('recurrence_rule_participants','calendar_lesson_participants','lesson_registration_students','lesson_registration_attendance','lesson_registration_evaluations','lesson_registration_homework_reviews')
        and s.new_row ? 'student_id'
        and not exists(select 1 from public.students st where st.id = (s.new_row->>'student_id')::uuid and st.owner_id = p_owner)
  ) then
    raise exception 'Invariante violada: un participante referencia un alumno de otro owner.';
  end if;

  if exists(
    select 1 from public.import_run_row_snapshots parent
      where parent.import_run_id = p_run_id and parent.table_name = 'payment_charges' and parent.action = 'inserted'
        and (parent.new_row->>'charge_type') = 'paquete'
        and (parent.new_row->>'package_id') is null
  ) then
    raise exception 'Invariante violada: un cargo de tipo paquete quedó sin compra asociada.';
  end if;

  -- Toda decisión de duplicado aceptada por esta importación debe haberse
  -- materializado realmente — nunca un éxito reportado sin la escritura
  -- correspondiente (bug real de 'create_separate' descubierto 2026-09-24,
  -- corrección 20260927110000). `skip` no requiere nada: es, a propósito,
  -- un no-op.
  select ir.duplicate_decisions into v_run_decisions from public.import_runs ir where ir.id = p_run_id;

  for v_dec in select * from jsonb_to_recordset(coalesce(v_run_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
  loop
    if v_dec.decision = 'create_separate' then
      if not exists(
        select 1 from public.import_run_row_snapshots s
          where s.import_run_id = p_run_id and s.table_name = 'students' and s.action = 'inserted'
            and (s.new_row->>'legacy_mobile_id') = v_dec.backup_legacy_mobile_id
      ) then
        raise exception 'Invariante violada: la decisión "crear aparte" para % no se materializó.', v_dec.backup_legacy_mobile_id;
      end if;
    elsif v_dec.decision = 'link' then
      if not exists(
        select 1 from public.import_run_row_snapshots s
          where s.import_run_id = p_run_id and s.table_name = 'students' and s.action = 'identity_linked'
            and s.row_id = v_dec.candidate_student_id
      ) then
        raise exception 'Invariante violada: la decisión "vincular" para % no se materializó.', v_dec.backup_legacy_mobile_id;
      end if;
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- Mismo barrido de seguridad que la migración original (Sección 12): revoca
-- EXECUTE de `public`/`anon`/`authenticated` de TODAS las funciones
-- internas (prefijo `_`) — incluye la nueva `_insert_student_from_backup_row`.
-- Lee `pg_proc`/`pg_namespace` reales, nunca datos de cliente.
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
