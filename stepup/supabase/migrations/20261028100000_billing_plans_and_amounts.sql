-- TeacherFlow Web — Planes de cobro, monto mensual y cargos por período (paridad con la app original).
--
-- 1) student_billing_audit               — registro de auditoría de cambios de plan y de monto mensual (en el original: `monthlyAmountCorrectionLog`).
-- 2) set_student_billing_plan(payload)   — plan de cobro del alumno (por clase, semanal, quincenal, mensual, paquete, sin cargo). Una sola transacción; el monto de un plan que YA era mensual
--                                          sólo se cambia con change_student_monthly_amount (regla del original: nunca dejar plan y cargo divergir en silencio).
-- 3) change_student_monthly_amount(payload) — «Modificar monto mensual» con vigencia «este mes» / «próximo mes»: corrige el cargo del mes (o lo crea si todavía no existe) y el plan en la MISMA
--                                          transacción; nunca reescribe un período ya saldado ni baja el importe por debajo de lo ya asignado.
-- 4) ensure_periodic_charges(kind, candidates) — cargos semanales y quincenales del período vigente, idempotentes por (alumno, período).
--
-- Todas SECURITY INVOKER (RLS de quien llama), search_path vacío, sin acceso anónimo. Ninguna toca pagos ni asignaciones.

create table if not exists public.student_billing_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('plan_change', 'monthly_amount_change')),
  before_state jsonb,
  after_state jsonb,
  detail jsonb,
  created_at timestamptz not null default now()
);
comment on table public.student_billing_audit is 'Auditoría de cambios de plan de cobro y de monto mensual (nunca se edita ni se borra desde la aplicación).';
create index if not exists student_billing_audit_owner_student_idx on public.student_billing_audit (owner_id, student_id, created_at desc);
alter table public.student_billing_audit enable row level security;
drop policy if exists student_billing_audit_owner_all on public.student_billing_audit;
create policy student_billing_audit_owner_all on public.student_billing_audit for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on table public.student_billing_audit from anon;

-- ---------------------------------------------------------------------------
-- 2) Plan de cobro.
-- SECURITY DEFINER: `students` sólo deja actualizar columnas de una lista fija (billing_plan no está) y el plan sólo debe cambiar por estas reglas; cada consulta filtra por la dueña (auth.uid()).
-- p_payload = { "student_id": uuid, "plan": { "type": "per_class"|"weekly"|"biweekly"|"monthly"|"class_package"|"complimentary", "amount": n, ... } }
-- ---------------------------------------------------------------------------
create or replace function public.set_student_billing_plan(p_payload jsonb)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_student public.students;
  v_plan jsonb := p_payload->'plan';
  v_type text := p_payload->'plan'->>'type';
  v_current jsonb;
  v_new jsonb;
  v_amount numeric;
  v_weekday int;
  v_included int;
  v_from date;
  v_until date;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_plan is null or jsonb_typeof(v_plan) <> 'object' or v_type is null then
    raise exception 'Elegí un plan de cobro.' using errcode = '22023';
  end if;

  select * into v_student from public.students where id = nullif(p_payload->>'student_id', '')::uuid and owner_id = v_owner for update;
  if not found then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;

  -- Plan vigente (el mismo criterio que la aplicación: si no hay plan explícito se deriva del tipo de cobro y el precio).
  v_current := coalesce(
    v_student.billing_plan,
    case when v_student.billing_type = 'mensual'
         then jsonb_build_object('type', 'monthly', 'amount', v_student.price, 'dueDay', 10)
         else jsonb_build_object('type', 'per_class', 'amount', v_student.price) end
  );

  if v_type = 'complimentary' then
    v_new := jsonb_build_object('type', 'complimentary');
  elsif v_type in ('per_class', 'weekly', 'biweekly', 'monthly', 'class_package') then
    begin
      v_amount := (v_plan->>'amount')::numeric;
    exception when others then
      v_amount := null;
    end;
    if v_amount is null or v_amount <= 0 or v_amount >= 1000000000 then
      raise exception 'El importe debe ser un número mayor a cero.' using errcode = '22023';
    end if;
    v_amount := round(v_amount, 2);
    if v_type = 'per_class' then
      v_new := jsonb_build_object('type', 'per_class', 'amount', v_amount);
    elsif v_type = 'weekly' then
      begin
        v_weekday := (v_plan->>'dueWeekday')::int;
      exception when others then
        v_weekday := null;
      end;
      if v_weekday is null or v_weekday < 0 or v_weekday > 6 then
        raise exception 'Elegí el día de vencimiento de la semana.' using errcode = '22023';
      end if;
      v_new := jsonb_build_object('type', 'weekly', 'amount', v_amount, 'dueWeekday', v_weekday);
    elsif v_type = 'biweekly' then
      begin
        v_from := (v_plan->>'anchorDate')::date;
      exception when others then
        v_from := null;
      end;
      if v_from is null then
        raise exception 'La fecha de referencia no es válida.' using errcode = '22023';
      end if;
      v_new := jsonb_build_object('type', 'biweekly', 'amount', v_amount, 'anchorDate', to_char(v_from, 'YYYY-MM-DD'));
    elsif v_type = 'monthly' then
      if v_current->>'type' = 'monthly' then
        if round((v_current->>'amount')::numeric, 2) <> v_amount then
          raise exception 'Para cambiar el monto mensual usá «Modificar monto mensual»: corrige el cargo del mes junto con el plan, sin dejarlos desincronizados.' using errcode = '22023';
        end if;
        v_new := v_current; -- mismo plan mensual: se conserva tal cual (incluida una vigencia pendiente ya programada)
      else
        v_new := jsonb_build_object('type', 'monthly', 'amount', v_amount, 'dueDay', 10);
      end if;
    else
      begin
        v_included := (v_plan->>'includedClasses')::int;
        v_from := (v_plan->>'validFrom')::date;
        v_until := nullif(v_plan->>'validUntil', '')::date;
      exception when others then
        v_included := null;
      end;
      if v_included is null or v_included <= 0 then
        raise exception 'La cantidad de clases incluidas debe ser un entero mayor a cero.' using errcode = '22023';
      end if;
      if v_from is null then
        raise exception 'La fecha de inicio no es válida.' using errcode = '22023';
      end if;
      if v_until is not null and v_until < v_from then
        raise exception 'La fecha de fin no puede ser anterior a la de inicio.' using errcode = '22023';
      end if;
      v_new := jsonb_build_object('type', 'class_package', 'amount', v_amount, 'includedClasses', v_included, 'validFrom', to_char(v_from, 'YYYY-MM-DD'))
               || case when v_until is null then '{}'::jsonb else jsonb_build_object('validUntil', to_char(v_until, 'YYYY-MM-DD')) end;
    end if;
  else
    raise exception 'El tipo de plan no es válido.' using errcode = '22023';
  end if;

  update public.students
    set billing_plan = v_new,
        billing_type = case when v_type = 'monthly' then 'mensual' when v_type = 'per_class' then 'por_clase' else billing_type end
    where id = v_student.id and owner_id = v_owner
    returning * into v_student;

  insert into public.student_billing_audit (owner_id, student_id, kind, before_state, after_state)
  values (v_owner, v_student.id, 'plan_change', v_current, v_new);

  return v_student;
end;
$$;

revoke all on function public.set_student_billing_plan(jsonb) from public, anon;
grant execute on function public.set_student_billing_plan(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Monto mensual.
-- p_payload = { "student_id": uuid, "new_amount": n, "effective_from": "this_month"|"next_month", "current_period": "YYYY-MM", "due_date": "YYYY-MM-DD" }
-- «this_month»: corrige el cargo mensual vigente del período (o lo crea con `due_date` si todavía no existe) y el plan. «next_month»: sólo deja el importe pendiente en el plan.
-- ---------------------------------------------------------------------------
create or replace function public.change_student_monthly_amount(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_student public.students;
  v_plan jsonb;
  v_new numeric;
  v_effective text := p_payload->>'effective_from';
  v_period text := p_payload->>'current_period';
  v_next text;
  v_due date;
  v_charge public.payment_charges;
  v_paid numeric;
  v_created boolean := false;
  v_updated boolean := false;
  v_previous numeric;
  v_new_plan jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  begin
    v_new := round((p_payload->>'new_amount')::numeric, 2);
  exception when others then
    v_new := null;
  end;
  if v_new is null or v_new <= 0 or v_new >= 1000000000 then
    raise exception 'El nuevo importe mensual debe ser un número mayor a cero.' using errcode = '22023';
  end if;
  if v_effective not in ('this_month', 'next_month') then
    raise exception 'Elegí desde cuándo se aplica el nuevo monto.' using errcode = '22023';
  end if;
  if v_period is null or v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'El período no es válido.' using errcode = '22023';
  end if;

  select * into v_student from public.students where id = nullif(p_payload->>'student_id', '')::uuid and owner_id = v_owner for update;
  if not found then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  v_plan := coalesce(
    v_student.billing_plan,
    case when v_student.billing_type = 'mensual' then jsonb_build_object('type', 'monthly', 'amount', v_student.price, 'dueDay', 10) else null end
  );
  if v_plan is null or v_plan->>'type' <> 'monthly' then
    raise exception 'Este alumno no tiene un plan de cobro mensual.' using errcode = '22023';
  end if;

  v_next := to_char((v_period || '-01')::date + interval '1 month', 'YYYY-MM');

  select * into v_charge from public.payment_charges
    where owner_id = v_owner and student_id = v_student.id and charge_type = 'mensual' and billing_period = v_period and voided_at is null
    for update;
  v_previous := case when found then v_charge.original_amount else null end;

  if v_effective = 'next_month' then
    -- Nunca toca el cargo del período actual: el importe nuevo queda pendiente hasta que empiece el próximo.
    v_new_plan := v_plan || jsonb_build_object('pendingAmount', v_new, 'pendingAmountEffectiveFrom', v_next);
  else
    if v_charge.id is null then
      begin
        v_due := (p_payload->>'due_date')::date;
      exception when others then
        v_due := null;
      end;
      if v_due is null or to_char(v_due, 'YYYY-MM') <> v_period then
        raise exception 'El vencimiento del cargo nuevo no es válido.' using errcode = '22023';
      end if;
      insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, billing_period)
        values (v_owner, v_student.id, 'mensual', v_new, v_due, v_period)
        on conflict (student_id, billing_period) where charge_type = 'mensual' do nothing
        returning * into v_charge;
      if v_charge.id is null then
        raise exception 'El cargo del mes cambió mientras se guardaba. Volvé a intentarlo.' using errcode = '40001';
      end if;
      v_created := true;
      v_updated := true;
    else
      select coalesce(sum(a.amount), 0) into v_paid
        from public.payment_allocations a join public.payments p on p.id = a.payment_id
        where a.charge_id = v_charge.id and p.voided_at is null;
      if v_charge.original_amount - v_paid <= 0 then
        raise exception 'Este período ya está pagado en su totalidad: no se puede modificar retroactivamente. Elegí «Aplicar desde el próximo mes».' using errcode = '22023';
      end if;
      if v_paid > v_new then
        raise exception 'Ya se asignó un pago a este período: el nuevo importe no puede ser menor a lo ya pagado. Elegí «Aplicar desde el próximo mes» o un importe mayor o igual a lo ya asignado.' using errcode = '22023';
      end if;
      update public.payment_charges set original_amount = v_new where id = v_charge.id and owner_id = v_owner;
      v_updated := true;
    end if;
    v_new_plan := (v_plan - 'pendingAmount' - 'pendingAmountEffectiveFrom') || jsonb_build_object('amount', v_new);
  end if;

  update public.students set billing_plan = v_new_plan where id = v_student.id and owner_id = v_owner;

  insert into public.student_billing_audit (owner_id, student_id, kind, before_state, after_state, detail)
  values (v_owner, v_student.id, 'monthly_amount_change', v_plan, v_new_plan,
          jsonb_build_object('effective_from', v_effective, 'period', v_period, 'charge_created', v_created, 'charge_updated', v_updated, 'previous_charge_amount', v_previous));

  return jsonb_build_object('charge_id', v_charge.id, 'charge_created', v_created, 'charge_updated', v_updated, 'previous_charge_amount', v_previous, 'effective_from', v_effective);
end;
$$;

revoke all on function public.change_student_monthly_amount(jsonb) from public, anon;
grant execute on function public.change_student_monthly_amount(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Cargos semanales y quincenales.
-- p_kind: 'semanal' | 'quincenal'. p_candidates = [{ "student_id": uuid, "amount": n, "period_key": text, "due_date": "YYYY-MM-DD" }, ...]
-- Idempotente por (alumno, período); un alumno ajeno colado en el payload se ignora; un importe inválido se omite (nunca un cargo en 0).
-- ---------------------------------------------------------------------------
create or replace function public.ensure_periodic_charges(p_kind text, p_candidates jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_candidate jsonb;
  v_inserted integer := 0;
  v_amount numeric;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_kind not in ('semanal', 'quincenal') then
    raise exception 'El tipo de cargo no es válido.' using errcode = '22023';
  end if;

  for v_candidate in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb))
  loop
    if not exists (select 1 from public.students where id = nullif(v_candidate->>'student_id', '')::uuid and owner_id = v_owner) then
      continue;
    end if;
    begin
      v_amount := round((v_candidate->>'amount')::numeric, 2);
    exception when others then
      continue;
    end;
    if v_amount is null or v_amount <= 0 or coalesce(v_candidate->>'period_key', '') = '' then
      continue;
    end if;
    -- Dos sentencias (una por índice único parcial): el predicado de ON CONFLICT tiene que ser un literal para que la base reconozca el índice.
    if p_kind = 'semanal' then
      insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, billing_period)
      values (v_owner, (v_candidate->>'student_id')::uuid, 'semanal', v_amount, (v_candidate->>'due_date')::date, v_candidate->>'period_key')
      on conflict (student_id, billing_period) where charge_type = 'semanal' do nothing;
    else
      insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, billing_period)
      values (v_owner, (v_candidate->>'student_id')::uuid, 'quincenal', v_amount, (v_candidate->>'due_date')::date, v_candidate->>'period_key')
      on conflict (student_id, billing_period) where charge_type = 'quincenal' do nothing;
    end if;
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.ensure_periodic_charges(text, jsonb) from public, anon;
grant execute on function public.ensure_periodic_charges(text, jsonb) to authenticated;
