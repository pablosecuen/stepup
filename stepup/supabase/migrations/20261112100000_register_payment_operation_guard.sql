-- register_payment: una clave de operación reutilizada con OTROS datos ya no devuelve el pago anterior como si fuera éxito.
--
-- Antes (20260925100000): `insert … on conflict (owner_id, operation_id) do nothing` y, si la clave ya existía, se devolvía la fila existente sin mirar el contenido. Un segundo pago sobre el mismo
-- cobro con la clave vieja (error de cliente corregido el 12/11/2026) «salía bien» sin escribir nada. Ahora: misma clave y mismo contenido = reintento seguro (la misma fila, sin duplicar);
-- misma clave con otro alumno, importe, método, fecha, notas, pago reemplazado o cobro = error claro (22023). Aislamiento por cuenta (owner_id) y atomicidad sin cambios; mismos permisos.
-- Migración NUEVA e idempotente (create or replace): la anterior no se edita.

create or replace function public.register_payment(p_payload jsonb)
returns public.payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_student_id uuid := nullif(p_payload->>'student_id', '')::uuid;
  v_amount numeric(12, 2) := nullif(p_payload->>'amount', '')::numeric;
  v_method text := p_payload->>'method';
  v_paid_at date := nullif(p_payload->>'paid_at', '')::date;
  v_notes text := p_payload->>'notes';
  v_charge_id uuid := nullif(p_payload->>'charge_id', '')::uuid;
  v_replaces_payment_id uuid := nullif(p_payload->>'replaces_payment_id', '')::uuid;
  v_payment public.payments;
  v_old_payment public.payments;
  v_old_charge_ids uuid[];
  v_target_charge_ids uuid[];
  v_all_charge_ids uuid[];
  v_charge record;
  v_paid numeric(12, 2);
  v_capacity numeric(12, 2);
  v_remaining numeric(12, 2);
  v_allocated numeric(12, 2);
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_operation_id is null then
    raise exception 'Falta operation_id.' using errcode = '22023';
  end if;
  if v_student_id is null or v_amount is null or v_amount <= 0 or v_paid_at is null or v_method is null then
    raise exception 'Faltan campos obligatorios del pago.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_student_id and owner_id = v_owner) then
    raise exception 'El alumno no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  -- Idempotencia real: INSERT ... ON CONFLICT ... DO NOTHING RETURNING —
  -- nunca SELECT previo para decidir. Si ya existía (reintento/doble clic),
  -- se devuelve la fila real de inmediato, sin volver a anular el pago
  -- viejo (si lo hubiera) ni reprocesar ninguna asignación.
  insert into public.payments (owner_id, operation_id, student_id, amount, method, paid_at, notes, replaces_payment_id)
  values (v_owner, v_operation_id, v_student_id, v_amount, v_method, v_paid_at, v_notes, v_replaces_payment_id)
  on conflict (owner_id, operation_id) where operation_id is not null do nothing
  returning * into v_payment;

  if not found then
    select * into v_payment from public.payments where owner_id = v_owner and operation_id = v_operation_id;
    -- Misma clave: sólo es un REINTENTO si es la MISMA operación (alumno, importe, método, fecha, notas, pago reemplazado y, en modo cobro único, el cobro).
    -- Con otros datos NO se devuelve el pago anterior como si fuera éxito: se rechaza (el cliente rota la clave y la persona revisa los pagos antes de reintentar).
    if v_payment.student_id is distinct from v_student_id
       or v_payment.amount is distinct from v_amount
       or v_payment.method is distinct from v_method
       or v_payment.paid_at is distinct from v_paid_at
       or v_payment.notes is distinct from v_notes
       or v_payment.replaces_payment_id is distinct from v_replaces_payment_id
       or (v_charge_id is not null and not exists (select 1 from public.payment_allocations pa where pa.payment_id = v_payment.id and pa.charge_id = v_charge_id and pa.owner_id = v_owner))
    then
      raise exception 'Esta operación ya se registró con otros datos (otro importe, cobro o fecha). Revisá los pagos del alumno antes de intentarlo de nuevo.' using errcode = '22023';
    end if;
    return v_payment;
  end if;

  -- 1) Si hay reemplazo: bloquea y valida el pago viejo (nunca sus cargos
  -- todavía) — el orden acá es siempre pago-viejo-primero, nunca depende de
  -- cuál cargo toque, así que nunca puede ser el origen de un ciclo entre
  -- dos llamadas.
  if v_replaces_payment_id is not null then
    select * into v_old_payment from public.payments where id = v_replaces_payment_id and owner_id = v_owner for update;
    if not found then
      raise exception 'El pago a reemplazar no existe o no te pertenece.' using errcode = 'P0002';
    end if;
    if v_old_payment.student_id <> v_student_id then
      raise exception 'El pago a reemplazar no pertenece a este alumno.' using errcode = '22023';
    end if;
    if v_old_payment.id = v_payment.id then
      raise exception 'Un pago no puede reemplazarse a sí mismo.' using errcode = '22023';
    end if;
    if v_old_payment.voided_at is not null then
      raise exception 'El pago a reemplazar ya está anulado.' using errcode = '22023';
    end if;

    select coalesce(array_agg(distinct charge_id), '{}') into v_old_charge_ids
      from public.payment_allocations where payment_id = v_old_payment.id;
  end if;

  -- 2) Calcula el conjunto de cargos CANDIDATOS del pago nuevo — sin
  -- bloquear nada todavía (sólo lee ids).
  if v_charge_id is not null then
    v_target_charge_ids := array[v_charge_id];
  else
    select coalesce(array_agg(id), '{}') into v_target_charge_ids
      from public.payment_charges where owner_id = v_owner and student_id = v_student_id and voided_at is null;
  end if;

  -- 3) Unión real de "cargos del pago viejo" + "cargos candidatos del pago
  -- nuevo", bloqueada ENTERA en una única pasada, en un único orden
  -- determinista por id — ver comentario de arriba (nunca dos pasadas de
  -- lock separadas, nunca un ciclo posible entre dos reemplazos cruzados).
  select coalesce(array_agg(distinct cid order by cid), '{}') into v_all_charge_ids
    from unnest(coalesce(v_old_charge_ids, '{}') || coalesce(v_target_charge_ids, '{}')) as cid;

  if array_length(v_all_charge_ids, 1) > 0 then
    perform 1 from public.payment_charges where id = any(v_all_charge_ids) and owner_id = v_owner order by id for update;
  end if;

  -- 4) Recién con TODOS los locks ya adquiridos, anula el pago viejo (si
  -- corresponde) — su saldo queda liberado de verdad para el cálculo de
  -- abajo, dentro de la MISMA transacción. Cualquier error de acá en
  -- adelante revierte TODO, incluida esta anulación y el INSERT de arriba.
  if v_replaces_payment_id is not null then
    update public.payments
      set voided_at = now(), void_reason = coalesce(void_reason, 'Reemplazado por una corrección (pago ' || v_payment.id::text || ').')
      where id = v_old_payment.id and owner_id = v_owner;
  end if;

  if v_charge_id is not null then
    -- Modo cargo único: el saldo mostrado y la asignación salen EXCLUSIVAMENTE
    -- de ESE cargo. Ya está bloqueado (paso 3) — este SELECT sólo relee el
    -- estado real, nunca vuelve a esperar un lock nuevo.
    select * into v_charge from public.payment_charges where id = v_charge_id and owner_id = v_owner and voided_at is null;
    if not found then
      raise exception 'El cobro no existe, no te pertenece o ya está anulado.' using errcode = 'P0002';
    end if;
    if v_charge.student_id <> v_student_id then
      raise exception 'El cobro no pertenece a este alumno.' using errcode = '22023';
    end if;

    select coalesce(sum(pa.amount), 0) into v_paid
      from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id
      where pa.charge_id = v_charge_id and p.voided_at is null;

    v_capacity := v_charge.original_amount - v_paid;
    if v_amount > v_capacity then
      raise exception 'El importe supera el saldo pendiente de este cobro. Todavía no se admite saldo a favor.' using errcode = '22023';
    end if;

    insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount)
    values (v_owner, v_payment.id, v_charge_id, v_student_id, v_amount);
  else
    -- Modo general: reparte "obligación más antigua primero" entre TODAS las
    -- obligaciones vigentes del alumno. Ya están todas bloqueadas (paso 3) —
    -- el cursor sólo relee el estado real en el mismo orden determinista
    -- (due_date, created_at, id), sin volver a esperar ningún lock nuevo.
    v_remaining := v_amount;
    for v_charge in
      select pc.* from public.payment_charges pc
      where pc.owner_id = v_owner and pc.student_id = v_student_id and pc.voided_at is null
      order by pc.due_date asc, pc.created_at asc, pc.id asc
    loop
      exit when v_remaining <= 0;

      select coalesce(sum(pa.amount), 0) into v_paid
        from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id
        where pa.charge_id = v_charge.id and p.voided_at is null;

      v_capacity := v_charge.original_amount - v_paid;
      if v_capacity <= 0 then
        continue;
      end if;

      v_allocated := least(v_remaining, v_capacity);
      insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount)
      values (v_owner, v_payment.id, v_charge.id, v_student_id, v_allocated);
      v_remaining := v_remaining - v_allocated;
    end loop;

    if v_remaining > 0 then
      -- Rechaza la operación COMPLETA — Postgres revierte TODA la función
      -- (incluido el INSERT de payments de arriba), nunca queda un pago sin asignar.
      raise exception 'El importe supera lo que se puede asignar a las obligaciones pendientes del alumno. Todavía no se admite saldo a favor.' using errcode = '22023';
    end if;
  end if;

  return v_payment;
end;
$$;

revoke all on function public.register_payment(jsonb) from public;
grant execute on function public.register_payment(jsonb) to authenticated;
revoke execute on function public.register_payment(jsonb) from anon;
