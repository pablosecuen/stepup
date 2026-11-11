-- «cannot delete from scalar» al modificar el monto mensual (10/11/2026).
-- CAUSA: 13 alumnos tienen students.billing_plan = jsonb 'null' (el JSON null del traslado desde la app, NO el NULL de SQL). `coalesce(billing_plan, plan derivado)` no lo reemplaza porque
-- no es NULL de SQL; luego `v_plan->>'type' <> 'monthly'` da NULL (no lanza) y `v_plan - 'pendingAmount'` falla sobre un escalar. Lo mismo afectaba, con efectos distintos, a otras funciones
-- que resuelven el plan con el mismo coalesce (`v_plan || …` sobre un escalar arma un arreglo en vez de un objeto).
-- ARREGLO: una función única que resuelve el plan de forma explícita (objeto = el plan; NULL de SQL o JSON null = «sin plan», se deriva del tipo de cobro y el precio, igual que la web y la app;
-- cualquier otro tipo de valor se rechaza con un mensaje claro) y su uso en las cuatro funciones publicadas. No se toca ninguna fila existente: el plan derivado nunca se escribe hasta que el
-- usuario guarda un cambio, y ese cambio ya escribe un objeto completo.
begin;

create or replace function public.effective_student_billing_plan(p_plan jsonb, p_billing_type text, p_price numeric)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_plan is null or jsonb_typeof(p_plan) = 'null' then
    return case when p_billing_type = 'mensual'
                then jsonb_build_object('type', 'monthly', 'amount', p_price, 'dueDay', 10)
                else jsonb_build_object('type', 'per_class', 'amount', p_price) end;
  end if;
  if jsonb_typeof(p_plan) = 'object' then
    return p_plan;
  end if;
  raise exception 'El plan de cobro de este alumno tiene un formato no reconocido. Abrí «Plan de cobro» y guardalo de nuevo.' using errcode = '22023';
end;
$$;
revoke all on function public.effective_student_billing_plan(jsonb, text, numeric) from public, anon;
grant execute on function public.effective_student_billing_plan(jsonb, text, numeric) to authenticated;

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
  v_not_started boolean;
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
  -- Plan vigente: explícito (objeto) o derivado del tipo de cobro y el precio; un JSON null se trata como «sin plan» (ver effective_student_billing_plan).
  v_plan := public.effective_student_billing_plan(v_student.billing_plan, v_student.billing_type, v_student.price);
  if v_plan->>'type' is distinct from 'monthly' then
    raise exception 'Este alumno no tiene un plan de cobro mensual.' using errcode = '22023';
  end if;

  v_next := to_char((v_period || '-01')::date + interval '1 month', 'YYYY-MM');
  -- Una mensualidad que empieza en un período futuro (startPeriod) todavía no tiene cargo en el período vigente: no hay nada que corregir ni crear ahora.
  v_not_started := v_plan->>'startPeriod' is not null and v_plan->>'startPeriod' > v_period;

  select * into v_charge from public.payment_charges
    where owner_id = v_owner and student_id = v_student.id and charge_type = 'mensual' and billing_period = v_period and voided_at is null
    for update;
  v_previous := case when found then v_charge.original_amount else null end;

  if v_effective = 'next_month' then
    -- Nunca toca el cargo del período actual: el importe nuevo queda pendiente hasta que empiece el próximo.
    v_new_plan := v_plan || jsonb_build_object('pendingAmount', v_new, 'pendingAmountEffectiveFrom', v_next);
  elsif v_not_started then
    v_new_plan := (v_plan - 'pendingAmount' - 'pendingAmountEffectiveFrom') || jsonb_build_object('amount', v_new);
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
  v_period text := p_payload->>'current_period';
  v_start text := coalesce(nullif(p_payload->>'monthly_start', ''), 'this_period');
  v_ack boolean := coalesce(p_payload->>'acknowledge_overlap', 'false') = 'true';
  v_charge_type text;
  v_overlap_count int := 0;
  v_overlap_total numeric := 0;
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
  v_current := public.effective_student_billing_plan(v_student.billing_plan, v_student.billing_type, v_student.price);

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

  -- Transición entre planes: un cambio NUNCA borra ni reescribe cargos ni pagos existentes; sólo cambia lo que se genera de ahora en más. Si el período vigente ya tiene cobros de OTRO tipo de plan
  -- (por clase, semanal, quincenal o mensual), el nuevo plan también generará el suyo para ese período: se exige confirmación explícita (y, para el mensual, elegir desde cuándo empieza)
  -- en vez de duplicar la deuda en silencio. Cambiar al mismo tipo de plan (p. ej. otro día de la semana) no cuenta como transición.
  if v_start not in ('this_period', 'next_period') then
    raise exception 'Elegí desde cuándo empieza la mensualidad.' using errcode = '22023';
  end if;
  if v_type in ('per_class', 'weekly', 'biweekly', 'monthly') and v_type <> coalesce(v_current->>'type', '') then
    if v_period is null or v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'El período no es válido.' using errcode = '22023';
    end if;
    v_charge_type := case v_type when 'per_class' then 'por_clase' when 'weekly' then 'semanal' when 'biweekly' then 'quincenal' else 'mensual' end;
    select count(*), coalesce(sum(original_amount), 0) into v_overlap_count, v_overlap_total
      from public.payment_charges
      where owner_id = v_owner and student_id = v_student.id and voided_at is null
        and charge_type in ('por_clase', 'semanal', 'quincenal', 'mensual') and charge_type <> v_charge_type
        and to_char(due_date, 'YYYY-MM') = v_period;
    if v_overlap_count > 0 and not v_ack then
      raise exception 'Este mes ya tiene % cobro(s) de otro tipo de plan. Confirmá que se conservan antes de cambiar el plan: no se borran ni se modifican.', v_overlap_count using errcode = '22023';
    end if;
    if v_type = 'monthly' and v_start = 'next_period' then
      v_new := v_new || jsonb_build_object('startPeriod', to_char((v_period || '-01')::date + interval '1 month', 'YYYY-MM'));
    end if;
  end if;

  update public.students
    set billing_plan = v_new,
        billing_type = case when v_type = 'monthly' then 'mensual' when v_type = 'per_class' then 'por_clase' else billing_type end
    where id = v_student.id and owner_id = v_owner
    returning * into v_student;

  insert into public.student_billing_audit (owner_id, student_id, kind, before_state, after_state, detail)
  values (v_owner, v_student.id, 'plan_change', v_current, v_new,
          jsonb_build_object('period', v_period, 'overlap_count', v_overlap_count, 'overlap_total', v_overlap_total, 'acknowledged', v_ack, 'monthly_start', v_start));

  return v_student;
end;
$$;
revoke all on function public.set_student_billing_plan(jsonb) from public, anon;
grant execute on function public.set_student_billing_plan(jsonb) to authenticated;

create or replace function public._apply_first_month_situation(
  p_owner uuid,
  p_student_id uuid,
  p_situation text,
  p_period text,
  p_due_date date,
  p_paid_at date,
  p_clamp boolean,
  p_operation_id uuid,
  p_start_mode text,
  p_strict boolean,
  p_audit_kind text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_student public.students;
  v_plan jsonb;
  v_new_plan jsonb;
  v_amount numeric;
  v_next text;
  v_charge public.payment_charges;
  v_payment public.payments;
  v_created boolean := false;
  v_balance numeric;
  v_pay numeric;
  v_safe_paid date;
  v_start text;
begin
  if p_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_situation not in ('paid', 'pending', 'starts_next_month') then
    raise exception 'Elegí desde cuándo querés comenzar a controlar sus pagos.' using errcode = '22023';
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'El período no es válido.' using errcode = '22023';
  end if;
  if p_period <> to_char(v_today, 'YYYY-MM') then
    raise exception 'El mes cambió mientras tenías esta pantalla abierta. Recargá la página y volvé a intentarlo.' using errcode = '22023';
  end if;

  select * into v_student from public.students where id = p_student_id and owner_id = p_owner for update;
  if not found then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  v_plan := public.effective_student_billing_plan(v_student.billing_plan, v_student.billing_type, v_student.price);
  if v_plan->>'type' is distinct from 'monthly' then
    raise exception 'Este alumno no tiene un plan de cobro mensual.' using errcode = '22023';
  end if;

  -- Repetir la misma operación (reintento, doble toque, respuesta perdida) devuelve el MISMO resultado, sin un segundo pago.
  if p_situation = 'paid' and p_operation_id is not null then
    select * into v_payment from public.payments where owner_id = p_owner and operation_id = p_operation_id;
    if found then
      if v_payment.student_id is distinct from p_student_id then raise exception 'La operación corresponde a otro alumno.' using errcode='22023'; end if;
      select * into v_charge from public.payment_charges
        where owner_id = p_owner and student_id = p_student_id and charge_type = 'mensual' and billing_period = p_period and voided_at is null;
      return jsonb_build_object('situation', p_situation, 'billing_period', p_period, 'charge_id', v_charge.id, 'charge_created', false, 'payment_id', v_payment.id, 'replayed', true);
    end if;
  end if;

  v_amount := case
    when v_plan ? 'pendingAmount' and v_plan ? 'pendingAmountEffectiveFrom' and p_period >= v_plan->>'pendingAmountEffectiveFrom' then (v_plan->>'pendingAmount')::numeric
    else (v_plan->>'amount')::numeric
  end;
  if v_amount is null or v_amount <= 0 then
    raise exception 'El plan mensual no tiene un importe válido.' using errcode = '22023';
  end if;
  v_next := to_char((p_period || '-01')::date + interval '1 month', 'YYYY-MM');

  select * into v_charge from public.payment_charges
    where owner_id = p_owner and student_id = p_student_id and charge_type = 'mensual' and billing_period = p_period and voided_at is null
    for update;

  if p_situation = 'starts_next_month' then
    if found and p_strict then
      raise exception 'Ya existe una obligación mensual para el mes actual: no corresponde marcar «comienza a pagar el mes siguiente».' using errcode = '22023';
    end if;
  else
    if not found then
      if v_student.status <> 'activo' then
        raise exception 'Sólo se puede generar la mensualidad de un alumno activo.' using errcode = '22023';
      end if;
      if p_due_date is null or to_char(p_due_date, 'YYYY-MM') < p_period or p_due_date > (p_period || '-01')::date + interval '1 month' + interval '6 days' then
        raise exception 'El vencimiento del cargo nuevo no es válido.' using errcode = '22023';
      end if;
      insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, billing_period)
        values (p_owner, p_student_id, 'mensual', v_amount, p_due_date, p_period)
        on conflict (student_id, billing_period) where charge_type = 'mensual' do nothing
        returning * into v_charge;
      if v_charge.id is null then
        if exists (select 1 from public.payment_charges where student_id = p_student_id and charge_type = 'mensual' and billing_period = p_period and voided_at is not null) then
          raise exception 'La mensualidad de este mes fue anulada: no se puede volver a generar. Registrá un pago desde Cobros o avisá para revisarlo.' using errcode = '22023';
        end if;
        raise exception 'El cargo del mes cambió mientras se guardaba. Volvé a intentarlo.' using errcode = '40001';
      end if;
      v_created := true;
    end if;
  end if;

  if p_situation = 'paid' then
    if p_paid_at is null then
      raise exception 'Indicá la fecha real del pago.' using errcode = '22023';
    end if;
    if p_paid_at > v_today then
      raise exception 'La fecha del pago no puede ser futura.' using errcode = '22023';
    end if;
    if p_operation_id is null then
      raise exception 'Falta la clave de la operación.' using errcode = '22023';
    end if;
    select coalesce(sum(a.amount), 0) into v_balance
      from public.payment_allocations a join public.payments p on p.id = a.payment_id
      where a.charge_id = v_charge.id and p.voided_at is null;
    v_pay := v_charge.original_amount - v_balance;
    if v_pay <= 0 then
      raise exception 'Este período ya está saldado — no hay saldo pendiente para registrar.' using errcode = '22023';
    end if;
    v_safe_paid := case when coalesce(p_clamp, true) and p_paid_at > v_charge.due_date then v_charge.due_date else p_paid_at end;
    insert into public.payments (owner_id, operation_id, student_id, amount, method, paid_at, source)
      values (p_owner, p_operation_id, p_student_id, v_pay, 'efectivo', v_safe_paid, 'initial_student_setup')
      returning * into v_payment;
    insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount)
      values (p_owner, v_payment.id, v_charge.id, p_student_id, v_pay);
  end if;

  v_start := case p_start_mode when 'current' then p_period when 'next' then v_next else null end;
  v_new_plan := v_plan;
  if v_start is not null then
    v_new_plan := v_plan || jsonb_build_object('startPeriod', v_start);
    update public.students set billing_plan = v_new_plan where id = p_student_id and owner_id = p_owner;
  end if;

  insert into public.student_billing_audit (owner_id, student_id, kind, before_state, after_state, detail)
  values (p_owner, p_student_id, p_audit_kind, v_plan, v_new_plan,
          jsonb_build_object('situation', p_situation, 'period', p_period, 'charge_id', v_charge.id, 'charge_created', v_created, 'payment_id', v_payment.id, 'start_period', v_start));

  return jsonb_build_object('situation', p_situation, 'billing_period', p_period, 'charge_id', v_charge.id, 'charge_created', v_created, 'payment_id', v_payment.id, 'replayed', false, 'start_period', v_start);
end;
$$;
revoke all on function public._apply_first_month_situation(uuid, uuid, text, text, date, date, boolean, uuid, text, boolean, text) from public, anon, authenticated;

create or replace function public.reactivate_student_with_billing(p_student_id uuid,p_occurred_on date,p_reason text,p_internal_note text,p_choice text,p_period text,p_due_date date)
returns public.students language plpgsql security definer set search_path='' as $$
declare s public.students; plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='28000'; end if;
 select * into s from public.students where id=p_student_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Alumno no encontrado' using errcode='P0002'; end if;
 plan:=public.effective_student_billing_plan(s.billing_plan, s.billing_type, s.price);
 if plan->>'type'='monthly' and (p_choice is null or p_choice not in ('this_month','next_month')) then raise exception 'Elegí desde cuándo retomar el cobro mensual' using errcode='22023'; end if;
 if s.status='activo' then return s; end if;
 s:=public.change_student_status(p_student_id,'activo',p_occurred_on,p_reason,p_internal_note);
 if plan->>'type'='monthly' then
  perform public.resume_monthly_billing(jsonb_build_object('student_id',p_student_id,'choice',p_choice,'current_period',p_period,'due_date',p_due_date));
 end if;
 return s;
end $$;
revoke all on function public.reactivate_student_with_billing(uuid,date,text,text,text,text,date) from public,anon;
grant execute on function public.reactivate_student_with_billing(uuid,date,text,text,text,text,date) to authenticated;

commit;
