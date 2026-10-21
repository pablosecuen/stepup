-- R9 — Traslado desde la app móvil (1/1): ARCHIVO DEL ORIGEN + historiales que antes se descartaban. ADITIVA e idempotente. NO se aplica a Production sin autorización.
--
-- Qué agrega:
--   1. `import_source_archives`: una copia COMPLETA del respaldo recibido por cada importación confirmada (el documento ya adaptado, que lleva dentro el objeto
--      original de cada clase registrada: temas, objetivos, actividades, notas internas, adjuntos, historial de ediciones, avance del registro grupal…). Se escribe
--      con un disparador sobre `import_runs` (misma transacción: si la importación falla o se revierte, el archivo tampoco queda). A diferencia del payload
--      retenido de R4 (se purga a los 30 días), el archivo NO se purga: es el origen del traslado. Sólo lectura propia para la API (sin insertar, actualizar ni borrar);
--      se elimina con la cuenta (ON DELETE CASCADE). Deshacer una importación NO lo borra (el origen sigue conservado).
--   2. `_import_apply_histories`: importa lo que la importación todavía descartaba y que SÍ tiene tabla en la web: historial de estados y de precios de los alumnos
--      AGREGADOS en esta corrida, y las correcciones de importe mensual (idempotente por identificador de origen). Cada fila escrita deja su instantánea, así que
--      deshacer las revierte y bloquea si alguien las modificó (mismo mecanismo que el resto).
--   3. Redefine, con la MISMA firma, resultado e idempotencia: `apply_backup_import` (una llamada más), `apply_undo_backup_import` (las tres tablas nuevas en el orden
--      de borrado) y `_import_row_key` (las tres tablas nuevas). Todo lo demás queda igual.
-- Reversión: supabase/repairs/r9_transfer_rollback.sql (vuelve a las definiciones de R6/R6.1 y quita el archivo).

create table if not exists public.import_source_archives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  import_run_id uuid not null unique references public.import_runs(id) on delete cascade,
  backup_checksum text not null,
  schema_version int not null,
  app_version text,
  source_payload jsonb not null,
  created_at timestamptz not null default now()
);
comment on table public.import_source_archives is 'Copia completa del respaldo móvil recibido en cada importación confirmada (el origen del traslado). No se purga; se elimina con la cuenta. Sin escritura desde la API.';
create index if not exists import_source_archives_owner_idx on public.import_source_archives (owner_id);
alter table public.import_source_archives enable row level security;
revoke all on public.import_source_archives from anon, authenticated;
grant select on public.import_source_archives to authenticated;
drop policy if exists import_source_archives_owner_select on public.import_source_archives;
create policy import_source_archives_owner_select on public.import_source_archives for select to authenticated using (owner_id = auth.uid());

create or replace function public._import_archive_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.retained_payload is not null then
    insert into public.import_source_archives (owner_id, import_run_id, backup_checksum, schema_version, app_version, source_payload)
      values (new.owner_id, new.id, new.backup_checksum, new.schema_version, new.app_version, new.retained_payload)
      on conflict (import_run_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public._import_archive_source() from public, anon, authenticated;

drop trigger if exists import_runs_archive_source on public.import_runs;
create trigger import_runs_archive_source after insert on public.import_runs for each row execute function public._import_archive_source();

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
revoke all on function public._import_apply_histories(uuid, uuid, jsonb) from public, anon, authenticated;

-- Redefinidas (misma firma; sólo cambia lo marcado como R9):
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
