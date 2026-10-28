-- TeacherFlow Web — Situación mensual inicial, «marcar mes pagado», retomar el cobro al reactivar y datos del alta (paridad con la app original).
--
-- 1) students.birth_date pasa a la lista de columnas que la profesora puede actualizar (edad al editar el alumno).
-- 2) student_billing_audit admite tres tipos nuevos: situación inicial, retomar cobro.
-- 3) _apply_first_month_situation(...)  — núcleo ÚNICO (interno, sin acceso directo): crea o reutiliza el cargo mensual del período, y según la situación lo deja pendiente, registra el pago declarado
--                                          (pagos.source = 'initial_student_setup', con su asignación) o deja el plan para que empiece el mes siguiente. Port de `planEnsureMonthlyChargeSituation`.
-- 4) mark_current_month_paid(payload)   — «Marcar mes actual como pagado» (alumno mensual ya existente).
-- 5) resume_monthly_billing(payload)    — «Retomar el cobro mensual: cobrar desde este mes / comenzar el próximo mes» (reactivación).
-- 6) _validate_new_student_payload / create_student_with_operation — el alta guarda edad, objetivos y, en un alumno mensual, la situación del primer mes EN LA MISMA TRANSACCIÓN del alta.
--
-- Reglas que se conservan del original: nunca se crea una segunda mensualidad del mismo período (un período con cargo vigente se reutiliza); «ya pagado» no duplica el pago (se rechaza o repite el mismo
-- resultado con la misma clave de operación); la fecha de pago declarada en el alta nunca queda después del vencimiento (el alta no representa una mora real); nada se borra: lo anterior queda en
-- el historial. Ningún cambio toca pagos ya registrados, acuerdos de entrenamiento ni cargos de otros períodos.

-- 1) Columna actualizable.
grant update (birth_date) on public.students to authenticated;

-- 2) Tipos de auditoría.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
    where c.conrelid = 'public.student_billing_audit'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%plan_change%';
  if v_name is not null then
    execute format('alter table public.student_billing_audit drop constraint %I', v_name);
  end if;
  alter table public.student_billing_audit
    add constraint student_billing_audit_kind_check
    check (kind in ('plan_change', 'monthly_amount_change', 'initial_month_situation', 'monthly_billing_resume'));
end
$$;

-- 3) Núcleo.
-- p_situation: 'paid' | 'pending' | 'starts_next_month'.
-- p_start_mode: 'none' (no toca el plan) | 'current' (la mensualidad pasa a empezar en el período vigente) | 'next' (empieza el período siguiente).
-- p_strict: true = «empieza el mes siguiente» se rechaza si el mes actual ya tiene un cargo vigente (regla del alta); false = se acepta y el cargo existente se conserva (regla de «retomar el cobro»).
-- Interna: sin permisos para anon/authenticated; sólo la llaman las funciones públicas de abajo.
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
  v_plan := coalesce(
    v_student.billing_plan,
    case when v_student.billing_type = 'mensual' then jsonb_build_object('type', 'monthly', 'amount', v_student.price, 'dueDay', 10) else null end
  );
  if v_plan is null or v_plan->>'type' <> 'monthly' then
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

-- 4) «Marcar mes actual como pagado».
-- p_payload = { operation_id, student_id, current_period, due_date (sólo hace falta si el cargo no existe todavía), paid_at }.
-- A diferencia del alta, la fecha de pago es la real de la confirmación: no se recorta contra el vencimiento.
create or replace function public.mark_current_month_paid(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_op uuid;
  v_student uuid;
  v_due date;
  v_paid date;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  begin
    v_op := nullif(p_payload->>'operation_id', '')::uuid;
    v_student := nullif(p_payload->>'student_id', '')::uuid;
    v_due := nullif(p_payload->>'due_date', '')::date;
    v_paid := coalesce(nullif(p_payload->>'paid_at', '')::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  exception when others then
    raise exception 'Los datos del pago no son válidos.' using errcode = '22023';
  end;
  return public._apply_first_month_situation(v_owner, v_student, 'paid', p_payload->>'current_period', v_due, v_paid, false, v_op, 'none', true, 'initial_month_situation');
end;
$$;

revoke all on function public.mark_current_month_paid(jsonb) from public, anon;
grant execute on function public.mark_current_month_paid(jsonb) to authenticated;

-- 5) «Retomar el cobro mensual».
-- p_payload = { student_id, choice: 'this_month'|'next_month', current_period, due_date (sólo si hay que crear el cargo del mes) }.
-- this_month: la mensualidad pasa a empezar en el período vigente y se genera su cargo si no existía (nunca un segundo cargo). next_month: la mensualidad empieza el período siguiente; un cargo ya existente
-- del mes actual se conserva tal cual.
create or replace function public.resume_monthly_billing(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_choice text := p_payload->>'choice';
  v_student uuid;
  v_due date;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_choice not in ('this_month', 'next_month') then
    raise exception 'Elegí desde cuándo corresponde cobrarle.' using errcode = '22023';
  end if;
  begin
    v_student := nullif(p_payload->>'student_id', '')::uuid;
    v_due := nullif(p_payload->>'due_date', '')::date;
  exception when others then
    raise exception 'Los datos no son válidos.' using errcode = '22023';
  end;
  if v_choice = 'this_month' then
    return public._apply_first_month_situation(v_owner, v_student, 'pending', p_payload->>'current_period', v_due, null, true, null, 'current', false, 'monthly_billing_resume');
  end if;
  return public._apply_first_month_situation(v_owner, v_student, 'starts_next_month', p_payload->>'current_period', null, null, true, null, 'next', false, 'monthly_billing_resume');
end;
$$;

revoke all on function public.resume_monthly_billing(jsonb) from public, anon;
grant execute on function public.resume_monthly_billing(jsonb) to authenticated;

-- 6) Alta: validación y creación.
create or replace function public._validate_new_student_payload(p_payload jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_birth date;
begin
  if btrim(coalesce(p_payload->>'name', '')) = '' then
    raise exception 'El nombre es obligatorio.';
  end if;
  if p_payload->>'price' is null or (p_payload->>'price')::numeric <= 0 then
    raise exception 'El precio debe ser un número mayor a cero.';
  end if;
  if p_payload ? 'usualDurationMinutes' and p_payload->>'usualDurationMinutes' is not null
     and ((p_payload->>'usualDurationMinutes')::numeric <= 0 or (p_payload->>'usualDurationMinutes')::numeric > 480) then
    raise exception 'La duración habitual debe ser mayor a cero y no superar 480 minutos.';
  end if;
  if p_payload ? 'weeklyFrequency' and p_payload->>'weeklyFrequency' is not null
     and ((p_payload->>'weeklyFrequency')::numeric < 0 or (p_payload->>'weeklyFrequency')::numeric > 14) then
    raise exception 'La frecuencia semanal debe estar entre 0 y 14 clases.';
  end if;
  if btrim(coalesce(p_payload->>'email', '')) <> '' and btrim(p_payload->>'email') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'El email ingresado no es válido.';
  end if;
  if btrim(coalesce(p_payload->>'dateJoined', '')) = '' then
    raise exception 'La fecha de alta es obligatoria.';
  end if;
  if btrim(coalesce(p_payload->>'birthDate', '')) <> '' then
    begin
      v_birth := (p_payload->>'birthDate')::date;
    exception when others then
      raise exception 'La edad no es válida.';
    end;
    if extract(year from age((now() at time zone 'America/Argentina/Buenos_Aires')::date,v_birth)) not between 3 and 120 then
      raise exception 'La edad debe estar entre 3 y 120 años.';
    end if;
  end if;
  if p_payload ? 'currentGoals' and p_payload->'currentGoals' is not null and jsonb_typeof(p_payload->'currentGoals') <> 'array' then
    raise exception 'Los objetivos no son válidos.';
  end if;
end;
$$;
revoke all on function public._validate_new_student_payload(jsonb) from public, anon, authenticated;

-- Misma función y mismo contrato que 20261005160000 (clave de operación, duplicados, reintentos), más edad, objetivos y situación del primer mes.
-- payload.firstMonth = { situation: 'paid'|'pending'|'starts_next_month', currentPeriod, dueDate, paidAt } — sólo para billingType = 'mensual'; se aplica en la MISMA transacción (si falla, no queda ni el alumno ni el claim). Sin firstMonth el alta se comporta como hasta ahora (no toca cargos ni plan).
create or replace function public.create_student_with_operation(
  p_operation_id uuid,
  p_payload jsonb,
  p_confirm_duplicate boolean default false
)
returns table (status text, student_id uuid, replayed boolean, candidates jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_claim public.student_creation_claims;
  v_existing boolean;
  v_candidates jsonb;
  v_fingerprint text;
  v_candidate_ids uuid[];
  v_new_id uuid;
  v_first jsonb := p_payload->'firstMonth';
  v_situation text;
  v_paid_at date;
  v_due date;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_operation_id is null then
    raise exception 'Falta la clave de la operación de alta.';
  end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  delete from public.student_creation_claims scc
    where scc.owner_id = v_owner and scc.status = 'pending' and scc.expires_at < now() - interval '24 hours';

  select * into v_claim
    from public.student_creation_claims scc
    where scc.owner_id = v_owner and scc.operation_id = p_operation_id
    for update;
  v_existing := found;

  if v_existing and v_claim.status = 'created' then
    return query select 'created'::text, v_claim.student_id, true, null::jsonb;
    return;
  end if;

  perform public._validate_new_student_payload(p_payload);

  if p_payload->>'billingType' = 'mensual' and v_first is not null then
    v_situation := coalesce(v_first->>'situation', 'starts_next_month');
    if v_situation not in ('paid', 'pending', 'starts_next_month') then
      raise exception 'Elegí desde cuándo querés comenzar a controlar sus pagos.';
    end if;
  end if;

  if not v_existing then
    insert into public.student_creation_claims (owner_id, operation_id, status, expires_at)
      values (v_owner, p_operation_id, 'pending', now() + interval '30 minutes')
      returning * into v_claim;
  elsif v_claim.expires_at < now() then
    update public.student_creation_claims scc
      set expires_at = now() + interval '30 minutes',
          candidate_ids = null, candidates_snapshot = null, candidates_fingerprint = null,
          updated_at = now()
      where scc.id = v_claim.id
      returning * into v_claim;
  end if;

  v_candidates := public._find_student_duplicate_candidates(v_owner, p_payload);
  v_fingerprint := public._student_candidates_fingerprint(v_candidates);
  select coalesce(array_agg((c->>'id')::uuid), array[]::uuid[]) into v_candidate_ids from jsonb_array_elements(v_candidates) c;

  if p_confirm_duplicate then
    if v_claim.candidates_fingerprint is null then
      raise exception 'No hay una revisión de posibles duplicados previa para confirmar en este borrador.';
    end if;

    if v_claim.candidates_fingerprint <> v_fingerprint then
      update public.student_creation_claims scc
        set candidate_ids = v_candidate_ids, candidates_snapshot = v_candidates, candidates_fingerprint = v_fingerprint, updated_at = now()
        where scc.id = v_claim.id;
      return query select 'possible_duplicate'::text, null::uuid, false, v_candidates;
      return;
    end if;
  else
    if jsonb_array_length(v_candidates) > 0 then
      update public.student_creation_claims scc
        set candidate_ids = v_candidate_ids, candidates_snapshot = v_candidates, candidates_fingerprint = v_fingerprint, updated_at = now()
        where scc.id = v_claim.id;
      return query select 'possible_duplicate'::text, null::uuid, false, v_candidates;
      return;
    end if;
  end if;

  insert into public.students (
    owner_id, name, phone, whatsapp, email, notes,
    levels, initial_level, modality, category, billing_type, date_joined,
    usual_duration_minutes, weekly_frequency, price, birth_date, current_goals
  ) values (
    v_owner,
    btrim(coalesce(p_payload->>'name', '')),
    p_payload->>'phone', p_payload->>'whatsapp', p_payload->>'email', p_payload->>'notes',
    array(select jsonb_array_elements_text(coalesce(p_payload->'levels', '[]'::jsonb))),
    coalesce(p_payload->>'initialLevel', ''),
    p_payload->>'modality', p_payload->>'category', p_payload->>'billingType',
    (p_payload->>'dateJoined')::date,
    coalesce((p_payload->>'usualDurationMinutes')::int, 60),
    coalesce((p_payload->>'weeklyFrequency')::int, 1),
    coalesce((p_payload->>'price')::numeric, 0),
    nullif(btrim(coalesce(p_payload->>'birthDate', '')), '')::date,
    array(select jsonb_array_elements_text(coalesce(p_payload->'currentGoals', '[]'::jsonb)))
  ) returning id into v_new_id;

  if p_payload->>'billingType' = 'mensual' and v_first is not null then
    if v_situation = 'paid' then
      v_paid_at := coalesce(nullif(v_first->>'paidAt', '')::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
    end if;
    if v_situation <> 'starts_next_month' then
      v_due := nullif(v_first->>'dueDate', '')::date;
    end if;
    -- Misma transacción: si la situación del primer mes no se puede aplicar, tampoco se crea el alumno.
    perform public._apply_first_month_situation(
      v_owner, v_new_id, v_situation, v_first->>'currentPeriod', v_due, v_paid_at, true,
      md5(p_operation_id::text || ':initial-month')::uuid,
      case when v_situation = 'starts_next_month' then 'next' else 'none' end,
      true, 'initial_month_situation'
    );
  end if;

  update public.student_creation_claims scc
    set status = 'created', student_id = v_new_id, completed_at = now(), updated_at = now()
    where scc.id = v_claim.id;

  return query select 'created'::text, v_new_id, false, null::jsonb;
end;
$$;

revoke all on function public.create_student_with_operation(uuid, jsonb, boolean) from public;
revoke all on function public.create_student_with_operation(uuid, jsonb, boolean) from anon;
grant execute on function public.create_student_with_operation(uuid, jsonb, boolean) to authenticated;

comment on function public.create_student_with_operation(uuid, jsonb, boolean) is
  'Alta de alumno idempotente por (owner, operation_id), con edad, objetivos y situación del primer mes (alumno mensual) en la misma transacción. Si algo falla se revierte todo, sin claims huérfanos.';

notify pgrst, 'reload schema';

-- Integración: reactivar y decidir el mes de cobro forman una sola transacción.
create function public.reactivate_student_with_billing(p_student_id uuid,p_occurred_on date,p_reason text,p_internal_note text,p_choice text,p_period text,p_due_date date)
returns public.students language plpgsql security definer set search_path='' as $$
declare s public.students; plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='28000'; end if;
 select * into s from public.students where id=p_student_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Alumno no encontrado' using errcode='P0002'; end if;
 plan:=coalesce(s.billing_plan,case when s.billing_type='mensual' then jsonb_build_object('type','monthly') end);
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
