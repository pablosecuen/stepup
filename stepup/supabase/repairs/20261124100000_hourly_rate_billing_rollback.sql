-- ROLLBACK de 20261124100000_hourly_rate_billing.sql (tarifa por hora).
-- Vuelve las dos funciones reemplazadas a su definición anterior (idéntica a 20260925100000 y 20261111100000), quita las funciones nuevas y, SÓLO si ningún cargo usa todavía las columnas nuevas,
-- las elimina. Si algún cargo ya guarda tarifa horaria, el rollback se detiene (no se pierde historia): primero hay que decidir qué hacer con esos cargos.
begin;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_charges' and column_name = 'rate_per_hour') then
    if exists (select 1 from public.payment_charges where rate_per_hour is not null or billed_minutes is not null) then
      raise exception 'Hay cargos con tarifa por hora calculada: no se revierte sin decidir antes qué hacer con ellos.';
    end if;
  end if;
end $$;

create or replace function public.sync_per_class_charge(p_lesson_registration_id uuid, p_participants jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_due_date date;
  v_participant jsonb;
  v_student_id uuid;
  v_amount numeric(12, 2);
  v_affected integer := 0;
  v_existing public.payment_charges;
  v_has_payments boolean;
  v_row_count integer;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select coalesce(actual_started_at, scheduled_start_at)::date into v_due_date
    from public.lesson_registrations
    where id = p_lesson_registration_id and owner_id = v_owner;
  if not found then
    raise exception 'El registro no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if v_due_date is null then
    v_due_date := current_date;
  end if;

  for v_participant in select * from jsonb_array_elements(coalesce(nullif(p_participants, 'null'::jsonb), '[]'::jsonb))
  loop
    v_student_id := nullif(v_participant->>'student_id', '')::uuid;
    v_amount := nullif(v_participant->>'amount', '')::numeric;
    if v_student_id is null or not exists (select 1 from public.students where id = v_student_id and owner_id = v_owner) then
      continue;
    end if;

    if v_amount is null or v_amount <= 0 then
      -- Ya no corresponde cobro (ej. se corrigió a "cancelada sin cobro").
      -- Bloquea el cargo existente ANTES de decidir — serializa contra
      -- register_payment/void_charge, nunca corre en carrera con una
      -- asignación real. Sólo retira un cobro TODAVÍA sin pagos — nunca
      -- borra historial financiero real.
      select * into v_existing from public.payment_charges
        where owner_id = v_owner and student_id = v_student_id and saved_lesson_id = p_lesson_registration_id and charge_type = 'por_clase'
        for update;
      if found and v_existing.voided_at is null then
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

    insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, saved_lesson_id)
    values (v_owner, v_student_id, 'por_clase', v_amount, v_due_date, p_lesson_registration_id)
    on conflict (student_id, saved_lesson_id) where charge_type = 'por_clase' do update
      set original_amount = excluded.original_amount
      where public.payment_charges.voided_at is null
        and not exists (
          select 1 from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id
          where pa.charge_id = public.payment_charges.id and p.voided_at is null
        );
    -- GET DIAGNOSTICS refleja sólo las filas realmente insertadas/actualizadas
    -- (un conflicto cuyo DO UPDATE ... WHERE dio falso — cobro ya con pagos —
    -- nunca cuenta acá, aunque la sentencia no haya lanzado error).
    get diagnostics v_row_count = row_count;
    v_affected := v_affected + v_row_count;
  end loop;

  return v_affected;
end;
$$;

revoke all on function public.sync_per_class_charge(uuid, jsonb) from public;
grant execute on function public.sync_per_class_charge(uuid, jsonb) to authenticated;
revoke execute on function public.sync_per_class_charge(uuid, jsonb) from anon;

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

drop function if exists public.rollback_hourly_charge_repairs(uuid[]);
drop function if exists public.apply_hourly_charge_repairs(uuid[]);
drop function if exists public.hourly_charge_review();
drop function if exists public.student_per_class_plan_on(uuid, date);
drop function if exists public.lesson_billable_minutes(uuid);
drop function if exists public.lesson_billed_amount(numeric, text, boolean, text, numeric);
drop function if exists public.lesson_hourly_amount(numeric, integer);
alter table public.payment_charges drop constraint if exists payment_charges_hourly_fields;
alter table public.payment_charges drop column if exists rate_per_hour;
alter table public.payment_charges drop column if exists billed_minutes;

commit;
