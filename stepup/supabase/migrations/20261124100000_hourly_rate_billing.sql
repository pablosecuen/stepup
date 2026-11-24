-- Tarifa POR HORA: cobrar según la duración de la clase (24/11/2026).
--
-- CAUSA: el importe de una clase de un alumno «por clase» era SIEMPRE `plan.amount` (un importe fijo), sin ninguna relación con la duración: una clase de 90 minutos con un plan de $36.000 generaba
-- $36.000 aunque esa cifra correspondiera a una hora. El modelo no distinguía «importe fijo por clase» de «tarifa por hora», así que tampoco se podía declarar.
--
-- QUÉ HACE (todo ADITIVO y compatible: ningún plan, cargo ni pago existente cambia por correr esta migración):
--  1) payment_charges.rate_per_hour / billed_minutes — la tarifa horaria y los minutos CONGELADOS en el cargo de una clase cobrada por hora (NULL en todos los cargos existentes y en los de importe fijo).
--     Una actualización de tarifas nunca recalcula un cargo ya generado: al editar la duración de ESA clase se vuelve a calcular con la tarifa congelada, no con la vigente.
--  2) lesson_hourly_amount / lesson_billed_amount / lesson_billable_minutes — la regla compartida en SQL: tarifa × minutos / 60 con redondeo al centavo, y el factor de resultado de la clase (dictada,
--     cancelada tarde con política, no dictada). Repite exactamente `lib/payments/lesson-amount.ts`.
--  3) student_per_class_plan_on — el plan «por clase» VIGENTE EN LA FECHA de una clase (la auditoría de cambios de plan decide; un cambio hecho durante el día vale para todo ese día).
--  4) sync_per_class_charge (reemplazo, mismo contrato) — para un alumno con tarifa por hora la base CALCULA el importe (la autoridad es el servidor, no el navegador); para importe fijo se comporta
--     exactamente como antes, salvo que un cambio de tarifa POSTERIOR a la fecha de la clase ya no reprecia un cargo existente sin pagos.
--     Nunca modifica un cargo con pagos, ni uno anterior a la tarifa horaria (cargo sin tarifa congelada de un alumno que hoy paga por hora).
--  5) set_student_billing_plan (reemplazo) — conserva `rateBasis: "hour"` en el plan «por clase» y rechaza una base desconocida.
--  6) hourly_charge_review / apply_hourly_charge_repairs / rollback_hourly_charge_repairs — la CORRECCIÓN de cargos pendientes generados antes de declarar la tarifa horaria. La revisión es sólo lectura;
--     la aplicación corrige únicamente cargos AUTOMÁTICOS, SIN NINGÚN PAGO, que coinciden con la regla anterior (importe fijo), guarda el estado anterior en financial_repair_audit y se puede revertir.
--     Un cargo con pagos (parciales o saldados) o con un importe distinto de la regla automática se informa para revisión humana y NUNCA se toca. Nada de esto se ejecuta solo: lo invoca la dueña.
begin;

-- 1) Tarifa y minutos congelados en el cargo.
alter table public.payment_charges add column if not exists rate_per_hour numeric(12, 2);
alter table public.payment_charges add column if not exists billed_minutes integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.payment_charges'::regclass and conname = 'payment_charges_hourly_fields') then
    alter table public.payment_charges add constraint payment_charges_hourly_fields check (
      (rate_per_hour is null and billed_minutes is null)
      or (charge_type = 'por_clase' and rate_per_hour > 0 and billed_minutes between 1 and 1440)
    );
  end if;
end $$;
comment on column public.payment_charges.rate_per_hour is 'Tarifa por hora aplicada a este cargo por clase (congelada al generarlo). NULL = importe fijo por clase o cargo anterior a la tarifa horaria.';
comment on column public.payment_charges.billed_minutes is 'Minutos facturados de la clase (con rate_per_hour). Se recalcula sólo al editar la duración de ESA clase.';

-- 2) La regla compartida.
create or replace function public.lesson_hourly_amount(p_rate numeric, p_minutes integer)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rate is null or p_rate <= 0 or p_minutes is null then 0::numeric
    else round(p_rate * least(1440, greatest(0, p_minutes)) / 60, 2)
  end;
$$;
revoke all on function public.lesson_hourly_amount(numeric, integer) from public, anon;
grant execute on function public.lesson_hourly_amount(numeric, integer) to authenticated;

create or replace function public.lesson_billed_amount(p_base numeric, p_outcome text, p_counts boolean, p_policy text, p_percentage numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_factor numeric;
begin
  if p_base is null or p_base <= 0 then
    return 0;
  end if;
  if p_outcome = 'cancelada_tarde' and p_policy is not null then
    v_factor := case p_policy
      when 'cobrar_100' then 1
      when 'cobrar_porcentaje' then case when p_percentage is not null and p_percentage > 0 then p_percentage / 100 else 0 end
      else 0
    end;
  else
    v_factor := case when coalesce(p_counts, false) then 1 else 0 end;
  end if;
  if v_factor = 1 then
    return round(p_base, 2);
  end if;
  return round(p_base * v_factor, 0);
end;
$$;
revoke all on function public.lesson_billed_amount(numeric, text, boolean, text, numeric) from public, anon;
grant execute on function public.lesson_billed_amount(numeric, text, boolean, text, numeric) to authenticated;

-- Duración facturable de un registro: la real (inicio y fin reales) si existe; si no, la programada del propio registro o, si éste no la guarda, la de su clase del calendario; 60 como último recurso.
create or replace function public.lesson_billable_minutes(p_registration_id uuid)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  r public.lesson_registrations;
  v_minutes integer;
begin
  select * into r from public.lesson_registrations where id = p_registration_id and owner_id = auth.uid();
  if not found then
    return 60;
  end if;
  if r.actual_started_at is not null and r.actual_ended_at is not null then
    v_minutes := round(extract(epoch from (r.actual_ended_at - r.actual_started_at)) / 60)::integer;
    if v_minutes > 0 then
      return least(1440, v_minutes);
    end if;
  end if;
  if r.scheduled_start_at is not null and r.scheduled_end_at is not null then
    v_minutes := round(extract(epoch from (r.scheduled_end_at - r.scheduled_start_at)) / 60)::integer;
    return case when v_minutes > 0 then least(1440, v_minutes) else 60 end;
  end if;
  if r.calendar_lesson_id is not null then
    select round(extract(epoch from (c.end_at - c.start_at)) / 60)::integer into v_minutes
      from public.calendar_lessons c where c.id = r.calendar_lesson_id and c.owner_id = auth.uid();
    if v_minutes is not null and v_minutes > 0 then
      return least(1440, v_minutes);
    end if;
  end if;
  return 60;
end;
$$;
revoke all on function public.lesson_billable_minutes(uuid) from public, anon;
grant execute on function public.lesson_billable_minutes(uuid) to authenticated;

-- 3) El plan «por clase» vigente en una FECHA (hora de Argentina). La auditoría de cambios de plan es la historia: el último cambio hecho hasta ese día (incluido) fija el plan; si todos los cambios
--    son posteriores, rige el «antes» del primero; sin cambios, el plan actual. Un plan que no era «por clase» ese día devuelve el plan actual (quien llama decide).
create or replace function public.student_per_class_plan_on(p_student_id uuid, p_on date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_student public.students;
  v_now jsonb;
  v_plan jsonb;
begin
  select * into v_student from public.students where id = p_student_id and owner_id = v_owner;
  if not found then
    return null;
  end if;
  begin
    v_now := public.effective_student_billing_plan(v_student.billing_plan, v_student.billing_type, v_student.price);
  exception when others then
    return null;
  end;
  select a.after_state into v_plan
    from public.student_billing_audit a
    where a.owner_id = v_owner and a.student_id = p_student_id and a.kind = 'plan_change'
      and (a.created_at at time zone 'America/Argentina/Buenos_Aires')::date <= p_on
    order by a.created_at desc, a.id desc
    limit 1;
  if not found then
    select a.before_state into v_plan
      from public.student_billing_audit a
      where a.owner_id = v_owner and a.student_id = p_student_id and a.kind = 'plan_change'
        and (a.created_at at time zone 'America/Argentina/Buenos_Aires')::date > p_on
      order by a.created_at asc, a.id asc
      limit 1;
  end if;
  if v_plan is null or jsonb_typeof(v_plan) <> 'object' or v_plan->>'type' is distinct from 'per_class' then
    return v_now;
  end if;
  return v_plan;
end;
$$;
revoke all on function public.student_per_class_plan_on(uuid, date) from public, anon;
grant execute on function public.student_per_class_plan_on(uuid, date) to authenticated;

-- 4) sync_per_class_charge — mismo contrato (registro, participantes {student_id, amount}); `amount` nulo/0 sigue significando «ya no corresponde cobro».
create or replace function public.sync_per_class_charge(p_lesson_registration_id uuid, p_participants jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_reg public.lesson_registrations;
  v_start timestamptz;
  v_due_date date;
  v_class_date date;
  v_minutes integer;
  v_participant jsonb;
  v_student_id uuid;
  v_student public.students;
  v_amount numeric(12, 2);
  v_plan_now jsonb;
  v_plan_at jsonb;
  v_now_per_class boolean;
  v_now_hour boolean;
  v_at_hour boolean;
  v_changed boolean;
  v_frozen boolean;
  v_rate numeric(12, 2);
  v_rate_store numeric(12, 2);
  v_minutes_store integer;
  v_existing public.payment_charges;
  v_has_existing boolean;
  v_has_payments boolean;
  v_affected integer := 0;
  v_row_count integer;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_reg from public.lesson_registrations where id = p_lesson_registration_id and owner_id = v_owner;
  if not found then
    raise exception 'El registro no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  v_start := coalesce(v_reg.actual_started_at, v_reg.scheduled_start_at);
  v_due_date := coalesce(v_start::date, current_date);
  v_class_date := (coalesce(v_start, now()) at time zone 'America/Argentina/Buenos_Aires')::date;
  v_minutes := public.lesson_billable_minutes(p_lesson_registration_id);

  for v_participant in select * from jsonb_array_elements(coalesce(nullif(p_participants, 'null'::jsonb), '[]'::jsonb))
  loop
    v_student_id := nullif(v_participant->>'student_id', '')::uuid;
    v_amount := nullif(v_participant->>'amount', '')::numeric;
    select * into v_student from public.students where id = v_student_id and owner_id = v_owner;
    if v_student_id is null or not found then
      continue;
    end if;

    -- Bloquea el cargo existente ANTES de decidir: serializa contra register_payment/void_charge (mismo cargo = mismo lock).
    select * into v_existing from public.payment_charges
      where owner_id = v_owner and student_id = v_student_id and saved_lesson_id = p_lesson_registration_id and charge_type = 'por_clase'
      for update;
    v_has_existing := found;
    v_frozen := v_has_existing and v_existing.voided_at is null and v_existing.rate_per_hour is not null;
    v_rate_store := null;
    v_minutes_store := null;

    if v_amount is not null and v_amount > 0 then
      begin
        v_plan_now := public.effective_student_billing_plan(v_student.billing_plan, v_student.billing_type, v_student.price);
      exception when others then
        v_plan_now := null;
      end;
      v_now_per_class := v_plan_now is not null and v_plan_now->>'type' = 'per_class';
      v_now_hour := v_now_per_class and coalesce(v_plan_now->>'rateBasis', '') = 'hour';

      if v_frozen then
        -- Cargo ya calculado por hora: se conserva SU tarifa (nunca la vigente) y sólo cambian los minutos de ESTA clase.
        v_rate := v_existing.rate_per_hour;
        v_at_hour := true;
      else
        v_plan_at := public.student_per_class_plan_on(v_student_id, v_class_date);
        v_at_hour := v_plan_at is not null and v_plan_at->>'type' = 'per_class' and coalesce(v_plan_at->>'rateBasis', '') = 'hour';
        v_rate := case when v_plan_at is not null and v_plan_at->>'type' = 'per_class' then (v_plan_at->>'amount')::numeric else null end;
      end if;

      if v_at_hour then
        if v_has_existing and v_existing.voided_at is null and v_existing.rate_per_hour is null then
          continue; -- cargo generado ANTES de la tarifa horaria: no se reescribe solo (ver apply_hourly_charge_repairs).
        end if;
        v_rate_store := v_rate;
        v_minutes_store := v_minutes;
        v_amount := public.lesson_billed_amount(public.lesson_hourly_amount(v_rate, v_minutes), v_reg.outcome, v_reg.counts_as_class, v_reg.late_cancellation_policy, v_reg.late_cancellation_percentage);
      elsif v_now_per_class and v_plan_at is not null and v_plan_at->>'type' = 'per_class' then
        -- Importe fijo: se confía en el cálculo del servidor de aplicación salvo que la tarifa haya cambiado DESPUÉS de la fecha de la clase (entonces rige la de esa fecha).
        v_changed := (v_plan_at->>'amount')::numeric is distinct from (v_plan_now->>'amount')::numeric or v_now_hour;
        if v_changed then
          v_amount := public.lesson_billed_amount((v_plan_at->>'amount')::numeric, v_reg.outcome, v_reg.counts_as_class, v_reg.late_cancellation_policy, v_reg.late_cancellation_percentage);
        end if;
      end if;
    end if;

    if v_amount is null or v_amount <= 0 then
      -- Ya no corresponde cobro (ej. se corrigió a «cancelada sin cobro»). Sólo retira un cobro TODAVÍA sin pagos — nunca borra historial financiero real.
      if v_has_existing and v_existing.voided_at is null then
        select exists (
          select 1 from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id
          where pa.charge_id = v_existing.id and p.voided_at is null
        ) into v_has_payments;
        if not v_has_payments then
          update public.payment_charges
            set voided_at = now(), void_reason = 'Corrección automática: la clase ya no genera cobro.'
            where id = v_existing.id;
          v_affected := v_affected + 1;
        end if;
      end if;
      continue;
    end if;

    insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id, rate_per_hour, billed_minutes)
    values (v_owner, v_student_id, 'por_clase', v_amount, v_due_date, p_lesson_registration_id, v_rate_store, v_minutes_store)
    on conflict (student_id, saved_lesson_id) where charge_type = 'por_clase' do update
      set original_amount = excluded.original_amount,
          rate_per_hour = excluded.rate_per_hour,
          billed_minutes = excluded.billed_minutes
      where public.payment_charges.voided_at is null
        and not exists (
          select 1 from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id
          where pa.charge_id = public.payment_charges.id and p.voided_at is null
        );
    get diagnostics v_row_count = row_count;
    v_affected := v_affected + v_row_count;
  end loop;

  return v_affected;
end;
$$;
revoke all on function public.sync_per_class_charge(uuid, jsonb) from public;
grant execute on function public.sync_per_class_charge(uuid, jsonb) to authenticated;
revoke execute on function public.sync_per_class_charge(uuid, jsonb) from anon;

-- 5) set_student_billing_plan — igual que la vigente, salvo que el plan «por clase» conserva `rateBasis: "hour"`.
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
      -- Base de la tarifa: ausente (o 'class') = importe fijo por clase; 'hour' = tarifa por hora. Cualquier otro valor se rechaza.
      if v_plan ? 'rateBasis' and jsonb_typeof(v_plan->'rateBasis') <> 'null' and coalesce(v_plan->>'rateBasis', '') not in ('hour', 'class') then
        raise exception 'La base de la tarifa no es válida.' using errcode = '22023';
      end if;
      v_new := jsonb_build_object('type', 'per_class', 'amount', v_amount)
               || case when v_plan->>'rateBasis' = 'hour' then jsonb_build_object('rateBasis', 'hour') else '{}'::jsonb end;
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

-- 6) Revisión (sólo lectura) y corrección de cargos pendientes generados antes de la tarifa horaria.
--    Alcance: cargos por clase VIGENTES, sin tarifa congelada, de alumnos cuyo plan ACTUAL es «por clase» con tarifa por hora, cuyo importe difiere del que da la regla nueva.
--      automatico_sin_pagos : sin ninguna asignación de pago y con el importe que daba la regla anterior (tarifa × resultado de la clase) → corregible.
--      con_pagos            : tiene asignaciones de pago (parcial o saldado) → revisión humana, no se toca.
--      personalizado        : su importe no coincide con la regla anterior → pudo fijarlo la profesora → revisión humana, no se toca.
create or replace function public.hourly_charge_review()
returns table (charge_id uuid, student_id uuid, saved_lesson_id uuid, due_date date, current_amount numeric, expected_amount numeric, previous_rule_amount numeric, billed_minutes integer, rate_per_hour numeric, paid_amount numeric, category text)
language plpgsql
stable
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select c.id as cid, c.student_id as sid, c.saved_lesson_id as lid, c.due_date as ddate, c.original_amount as cur,
           (s.billing_plan->>'amount')::numeric as rate,
           public.lesson_billable_minutes(c.saved_lesson_id) as mins,
           r.outcome as outcome, r.counts_as_class as counts, r.late_cancellation_policy as pol, r.late_cancellation_percentage as pct
      from public.payment_charges c
      join public.students s on s.id = c.student_id and s.owner_id = auth.uid()
      join public.lesson_registrations r on r.id = c.saved_lesson_id and r.owner_id = auth.uid()
     where c.owner_id = auth.uid() and c.charge_type = 'por_clase' and c.voided_at is null and c.rate_per_hour is null
       and s.billing_plan is not null and jsonb_typeof(s.billing_plan) = 'object'
       and s.billing_plan->>'type' = 'per_class' and coalesce(s.billing_plan->>'rateBasis', '') = 'hour'
  ), priced as (
    select k.*,
           public.lesson_billed_amount(public.lesson_hourly_amount(k.rate, k.mins), k.outcome, k.counts, k.pol, k.pct) as expected,
           public.lesson_billed_amount(k.rate, k.outcome, k.counts, k.pol, k.pct) as previous_rule,
           coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id where a.charge_id = k.cid and p.voided_at is null), 0) as paid,
           exists (select 1 from public.payment_allocations a where a.charge_id = k.cid) as has_alloc
      from candidates k
  )
  select p.cid, p.sid, p.lid, p.ddate, p.cur, p.expected, p.previous_rule, p.mins, p.rate, p.paid,
         case when p.has_alloc then 'con_pagos' when p.cur = p.previous_rule then 'automatico_sin_pagos' else 'personalizado' end
    from priced p
   where p.cur is distinct from p.expected and p.expected > 0
   order by p.ddate, p.cid;
end;
$$;
revoke all on function public.hourly_charge_review() from public, anon;
grant execute on function public.hourly_charge_review() to authenticated;

create or replace function public.apply_hourly_charge_repairs(p_charge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_row record;
  v_charge public.payment_charges;
  v_total integer := 0;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_charge_ids is null or cardinality(p_charge_ids) = 0 or cardinality(p_charge_ids) > 500 then
    raise exception 'Elegí entre 1 y 500 cargos para corregir.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':hourly-charge-repair', 0));
  for v_row in select * from public.hourly_charge_review() r where r.charge_id = any (p_charge_ids) and r.category = 'automatico_sin_pagos' order by r.charge_id
  loop
    select * into v_charge from public.payment_charges where id = v_row.charge_id and owner_id = v_owner for update;
    -- Re-verifica ya con el cargo bloqueado: sigue vigente, sin tarifa congelada y SIN ninguna asignación.
    if not found or v_charge.voided_at is not null or v_charge.rate_per_hour is not null
       or exists (select 1 from public.payment_allocations a where a.charge_id = v_charge.id) then
      continue;
    end if;
    update public.payment_charges
       set original_amount = v_row.expected_amount, rate_per_hour = v_row.rate_per_hour, billed_minutes = v_row.billed_minutes
     where id = v_charge.id;
    insert into public.financial_repair_audit (owner_id, charge_id, before_state, after_state, reason)
    values (v_owner, v_charge.id, to_jsonb(v_charge), (select to_jsonb(x) from public.payment_charges x where x.id = v_charge.id), 'hourly_rate_repair');
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.apply_hourly_charge_repairs(uuid[]) from public, anon;
grant execute on function public.apply_hourly_charge_repairs(uuid[]) to authenticated;

-- Revierte las correcciones ya aplicadas (sólo si el cargo sigue sin ninguna asignación de pago y conserva el importe corregido).
create or replace function public.rollback_hourly_charge_repairs(p_charge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_audit record;
  v_charge public.payment_charges;
  v_total integer := 0;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_charge_ids is null or cardinality(p_charge_ids) = 0 or cardinality(p_charge_ids) > 500 then
    raise exception 'Elegí entre 1 y 500 cargos para revertir.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':hourly-charge-repair', 0));
  for v_audit in
    select distinct on (a.charge_id) a.* from public.financial_repair_audit a
     where a.owner_id = v_owner and a.reason = 'hourly_rate_repair' and a.charge_id = any (p_charge_ids)
     order by a.charge_id, a.created_at desc
  loop
    select * into v_charge from public.payment_charges where id = v_audit.charge_id and owner_id = v_owner for update;
    if not found or v_charge.voided_at is not null or v_charge.rate_per_hour is null
       or v_charge.original_amount <> (v_audit.after_state->>'original_amount')::numeric
       or exists (select 1 from public.payment_allocations x where x.charge_id = v_charge.id) then
      continue;
    end if;
    update public.payment_charges
       set original_amount = (v_audit.before_state->>'original_amount')::numeric, rate_per_hour = null, billed_minutes = null
     where id = v_charge.id;
    insert into public.financial_repair_audit (owner_id, charge_id, before_state, after_state, reason)
    values (v_owner, v_charge.id, to_jsonb(v_charge), (select to_jsonb(x) from public.payment_charges x where x.id = v_charge.id), 'hourly_rate_repair_rollback');
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.rollback_hourly_charge_repairs(uuid[]) from public, anon;
grant execute on function public.rollback_hourly_charge_repairs(uuid[]) to authenticated;

commit;
