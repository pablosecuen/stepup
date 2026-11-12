-- Los otros puntos de entrada del JSON null (11/11/2026), a continuación de 20261111100000_student_plan_json_null.
-- ORIGEN: la importación del respaldo de la app (`billingPlan: profile.billingPlan ?? null`) llega con JSON null y `_import_stage` lo toma con `->` (jsonb 'null', NO NULL de SQL); `_import_apply_students` lo
-- insertaba tal cual en students.billing_plan. Así nacieron los alumnos con plan jsonb 'null'.
-- 1) `normalize_imported_billing_plan`: NULL de SQL y JSON null = «sin plan» (se guarda NULL de SQL, igual que cuando no viene la clave); un objeto se conserva; cualquier otro tipo (texto, número, arreglo,
--    booleano) se rechaza con un mensaje claro y la importación entera se revierte (la función corre dentro de la transacción de `apply_backup_import`). `_import_apply_students` la usa al insertar.
-- 2) `apply_financial_reconciliation` resolvía el plan con `coalesce(billing_plan, derivado)`: con jsonb 'null' el plan quedaba en 'null' y `plan->>'type'<>'monthly'` / `plan->>'amount'` daban NULL, de modo que
--    las comprobaciones «El importe no coincide con el plan vigente» y «El cargo no está cubierto por el plan individual» NO se aplicaban (fallaban abiertas). Ahora usa `effective_student_billing_plan`
--    (la misma resolución validada de la migración anterior): JSON null = plan derivado del tipo de cobro; un valor no reconocido se rechaza.
-- No se reescribe ninguna fila ni migración ya aplicada: los alumnos que ya tienen jsonb 'null' siguen igual y se resuelven al leer.
begin;

create or replace function public.normalize_imported_billing_plan(p_plan jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_plan is null or jsonb_typeof(p_plan) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_plan) = 'object' then
    return p_plan;
  end if;
  raise exception 'El plan de cobro de un alumno del respaldo tiene un formato no reconocido; la importación se canceló y no se guardó nada.' using errcode = '22023';
end;
$$;
revoke all on function public.normalize_imported_billing_plan(jsonb) from public, anon, authenticated;

create or replace function public._import_apply_students(p_run_id uuid, p_owner uuid, p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id = s.lid) then
    raise exception 'Un alumno ya existe — el preview quedó desactualizado.' using errcode = '22023';
  end if;
  -- Coincidencia heurística NUEVA (sólo para las altas; los «crear aparte» ya la vio la profesora). Una unión por hash por señal.
  if exists (
    select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id is null and lower(btrim(w.name)) = lower(btrim(s.name))
     where s.kind = 'insert' and btrim(w.name) <> '')
  or exists (
    select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id is null and public._normalize_email(w.email) = public._normalize_email(s.email)
     where s.kind = 'insert' and w.email is not null and s.email is not null and public._normalize_email(w.email) <> '')
  or exists (
    select 1 from _ia_stu s join public.students w on w.owner_id = p_owner and w.legacy_mobile_id is null and public._normalize_phone(w.phone) = public._normalize_phone(s.phone)
     where s.kind = 'insert' and w.phone is not null and s.phone is not null and public._normalize_phone(w.phone) <> '')
  then
    raise exception 'Apareció una coincidencia heurística nueva desde que se generó el preview — generá un preview nuevo.' using errcode = '22023';
  end if;

  with ins as (
    insert into public.students (
      owner_id, legacy_mobile_id, name, phone, whatsapp, email, usual_days, usual_time, notes, birth_date,
      levels, initial_level, modality, status, category, billing_type, billing_plan, date_joined,
      last_reactivated_at, status_change_date, usual_duration_minutes, weekly_frequency, price,
      pending_homework, alerts, current_goals, strengths, areas_to_improve, is_featured, is_new
    )
    select p_owner, s.lid, s.name, s.phone, s.whatsapp, s.email, s.usual_days, s.usual_time, s.notes, s.birth_date,
           s.levels, s.initial_level, s.modality, s.status, s.category, s.billing_type, public.normalize_imported_billing_plan(s.billing_plan), s.date_joined,
           s.last_reactivated_at, s.status_change_date, s.usual_duration_minutes, s.weekly_frequency, s.price,
           s.pending_homework, s.alerts, s.current_goals, s.strengths, s.areas_to_improve, s.is_featured, s.is_new
      from _ia_stu s
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'students', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- Vínculos de identidad («vincular»): asigna legacy_mobile_id al alumno web candidato, NUNCA otro campo salvo que además venga en los reemplazos.
  with tgt as (
    select d.bid, d.cid from _ia_dec d where d.decision = 'link'
  ), before as (
    select s.id, to_jsonb(s) as b from public.students s join tgt on tgt.cid = s.id where s.owner_id = p_owner
  ), upd as (
    update public.students s set legacy_mobile_id = tgt.bid from tgt where s.id = tgt.cid and s.owner_id = p_owner returning s.*
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'students', u.id, 'identity_linked', b.b, to_jsonb(u) from upd u join before b on b.id = u.id;

  -- Reemplazos de campos elegidos (ya validados por `_import_validate_selection`).
  with ov as (
    select o.row_id, o.fields, r.raw
      from _ia_ov o
      join public.students s on s.id = o.row_id and s.owner_id = p_owner
      left join lateral (
        select dc.backup_legacy_mobile_id from public.import_preview_duplicate_candidates dc
         where dc.preview_id = p_preview_id and dc.candidate_student_id = o.row_id order by dc.id limit 1) d on true
      join _ia_stu_raw r on r.lid = coalesce(d.backup_legacy_mobile_id, s.legacy_mobile_id)
     where o.table_name = 'students'
  ), before as (
    select s.id, to_jsonb(s) as b from public.students s join ov on ov.row_id = s.id
  ), upd as (
    update public.students s set
      name = case when 'name' = any(ov.fields) then btrim(coalesce(ov.raw ->> 'name', '')) else s.name end,
      phone = case when 'phone' = any(ov.fields) then ov.raw ->> 'phone' else s.phone end,
      whatsapp = case when 'whatsapp' = any(ov.fields) then ov.raw ->> 'whatsapp' else s.whatsapp end,
      email = case when 'email' = any(ov.fields) then ov.raw ->> 'email' else s.email end,
      notes = case when 'notes' = any(ov.fields) then ov.raw ->> 'notes' else s.notes end,
      birth_date = case when 'birth_date' = any(ov.fields) then (ov.raw ->> 'birthDate')::date else s.birth_date end,
      current_goals = case when 'current_goals' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'currentGoals', '[]'::jsonb))) else s.current_goals end,
      strengths = case when 'strengths' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'strengths', '[]'::jsonb))) else s.strengths end,
      areas_to_improve = case when 'areas_to_improve' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'areasToImprove', '[]'::jsonb))) else s.areas_to_improve end,
      alerts = case when 'alerts' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'alerts', '[]'::jsonb))) else s.alerts end,
      usual_days = case when 'usual_days' = any(ov.fields) then array(select jsonb_array_elements_text(coalesce(ov.raw -> 'usualDays', '[]'::jsonb))) else s.usual_days end,
      usual_time = case when 'usual_time' = any(ov.fields) then ov.raw ->> 'usualTime' else s.usual_time end
    from ov where s.id = ov.row_id returning s.*
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'students', u.id, 'field_overwritten', b.b, to_jsonb(u) from upd u join before b on b.id = u.id;
end;
$$;

revoke all on function public._import_apply_students(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_financial_reconciliation(p_token text,p_patches jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare t text; patch jsonb; c public.payment_charges; s public.students; plan jsonb; paid numeric; amount numeric; due date; total integer=0; reason text; period text=to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM');
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if jsonb_typeof(p_patches)<>'array' or jsonb_array_length(p_patches)>500 then raise exception 'Reparación inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':financial-reconciliation',0));
 foreach t in array array['students','lesson_registrations','payment_charges','payments','payment_allocations','payment_adjustments','first_month_proration_decisions'] loop
  execute format('select id from public.%I where owner_id=$1 order by id for update',t) using auth.uid();
 end loop;
 if public.financial_reconciliation_snapshot()->>'token' is distinct from p_token then raise exception 'Los cobros cambiaron; volvé a revisar'; end if;
 for patch in select value from jsonb_array_elements(p_patches) loop
  select * into c from public.payment_charges where id=(patch->>'id')::uuid and owner_id=auth.uid();
  if not found or c.voided_at is not null then raise exception 'Cargo no disponible'; end if;
  select coalesce(sum(a.amount),0) into paid from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.charge_id=c.id and a.owner_id=auth.uid() and p.voided_at is null;
  amount=(patch->>'amount')::numeric; due=(patch->>'dueDate')::date; reason=patch->>'reason';
  select * into s from public.students where owner_id=auth.uid() and id=c.student_id;
  plan=public.effective_student_billing_plan(s.billing_plan,s.billing_type,s.price);
  if reason not in ('duplicate','monthly_amount','inactive','monthly_coverage','first_due_date') or amount<=0 or amount<paid then raise exception 'Corrección no segura'; end if;
  if patch->>'voidedAt' is not null and (paid>0 or exists(select 1 from public.payment_allocations where charge_id=c.id)) then raise exception 'Un cargo con pagos no se anula automáticamente'; end if;
  if patch->>'voidedAt' is not null then
   if reason='inactive' and not(c.charge_type='mensual' and s.status<>'activo' and s.status_change_date is not null and c.billing_period>to_char(s.status_change_date,'YYYY-MM')) then raise exception 'La baja no demuestra este cargo'; end if;
   if reason='monthly_coverage' and not(c.charge_type='por_clase' and s.status='activo' and plan->>'type'='monthly' and coalesce(plan->>'startPeriod',period)<=period and to_char(c.due_date,'YYYY-MM')>=period and not exists(select 1 from public.lesson_registrations where id=c.saved_lesson_id and activity_kind='training')) then raise exception 'El cargo no está cubierto por el plan individual'; end if;
   if reason='duplicate' and not(c.charge_type='mensual' and exists(select 1 from public.payment_charges other where other.owner_id=auth.uid() and other.student_id=c.student_id and other.billing_period=c.billing_period and other.charge_type=c.charge_type and other.id<>c.id and other.voided_at is null)) then raise exception 'No es un duplicado técnico'; end if;
   if reason not in ('inactive','monthly_coverage','duplicate') then raise exception 'Motivo de anulación inválido'; end if;
  end if;
  if amount<>c.original_amount and (reason<>'monthly_amount' or c.charge_type<>'mensual' or c.billing_period<>to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM') or paid>=c.original_amount or exists(select 1 from public.first_month_proration_decisions where owner_id=auth.uid() and student_id=c.student_id and billing_period=c.billing_period)) then raise exception 'No se puede reescribir este importe'; end if;
  if amount<>c.original_amount and (s.status<>'activo' or plan->>'type'<>'monthly' or coalesce(plan->>'startPeriod',period)>period or amount<>case when plan->>'pendingAmount' is not null and plan->>'pendingAmountEffectiveFrom'<=period then (plan->>'pendingAmount')::numeric else (plan->>'amount')::numeric end) then raise exception 'El importe no coincide con el plan vigente'; end if;
  if due<>c.due_date and (reason<>'first_due_date' or due<c.due_date or paid>0 or not exists(select 1 from public.first_month_proration_decisions where owner_id=auth.uid() and charge_id=c.id)) then raise exception 'No se puede cambiar este vencimiento'; end if;
  update public.payment_charges set original_amount=amount,due_date=due,voided_at=(patch->>'voidedAt')::timestamptz,void_reason=patch->>'voidReason' where id=c.id;
  insert into public.financial_repair_audit(owner_id,charge_id,before_state,after_state,reason) values(auth.uid(),c.id,to_jsonb(c),(select to_jsonb(x) from public.payment_charges x where id=c.id),reason);
  total=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.apply_financial_reconciliation(text,jsonb) from public,anon;
grant execute on function public.apply_financial_reconciliation(text,jsonb) to authenticated;

commit;
