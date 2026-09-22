-- TeacherFlow Web — Fase 5: motor de Cobros real (mensualidad, clase
-- suelta, entrenamiento, pagos, anulaciones, Cancelada/Reprogramada del
-- registro ad-hoc). Migración ADITIVA — nunca edita las migraciones ya
-- aplicadas de Fases 1-4. El esquema base de Cobros (payment_charges,
-- payments, payment_allocations, payment_adjustments,
-- training_billing_agreements, pending_training_billing_operations) ya
-- existe desde Fase 1 (20260916120400/500) — esta migración sólo agrega lo
-- que faltaba para escribir de verdad: operation_id real de pagos, cierre
-- de Cancelada/Reprogramada en lesson_registrations, y las RPC atómicas.
--
-- NUNCA implementa recargos automáticos (decisión de negocio confirmada,
-- ver commit móvil `94ce7be`): ninguna función de acá calcula ni suma
-- recargo — el "adeudado" de un cargo es siempre su original_amount.
-- `surcharge_settings` (Fase 1) queda intacta y sin uso — no se crea
-- ninguna RPC ni política nueva sobre ella.

-- =============================================================================
-- 1) Idempotencia real de pagos — operation_id + UNIQUE real (mismo patrón
--    ya usado en Fase 4 para lesson_registrations.operation_id).
-- =============================================================================

alter table public.payments
  add column if not exists operation_id uuid;

comment on column public.payments.operation_id is
  'Idempotencia real: UUID generado UNA vez del lado del cliente (sessionStorage) antes de registrar un pago. Dos llamadas con el mismo operation_id convergen en la MISMA fila, nunca duplican el pago ni sus asignaciones.';

create unique index if not exists payments_owner_operation_unique
  on public.payments (owner_id, operation_id)
  where operation_id is not null;

-- =============================================================================
-- 2) Cierre de Cancelada/Reprogramada del registro ad-hoc (Fase 4, brecha
--    documentada) — ahora que existe el motor financiero. `outcome` gana 3
--    valores nuevos; se agregan los campos de política de cancelación
--    tardía y el enlace de reprogramación.
-- =============================================================================

alter table public.lesson_registrations
  drop constraint if exists lesson_registrations_outcome_check;
alter table public.lesson_registrations
  add constraint lesson_registrations_outcome_check
  check (outcome in (
    'clase_dictada', 'profesora_ausente', 'feriado',
    'cancelada_con_aviso', 'cancelada_tarde', 'reprogramada'
  ));

alter table public.lesson_registrations
  add column if not exists late_cancellation_policy text
    check (late_cancellation_policy is null or late_cancellation_policy in ('cobrar_100', 'cobrar_porcentaje', 'descontar_del_paquete', 'no_cobrar')),
  add column if not exists late_cancellation_percentage smallint
    check (late_cancellation_percentage is null or (late_cancellation_percentage >= 0 and late_cancellation_percentage <= 100)),
  add column if not exists rescheduled_from_registration_id uuid
    references public.lesson_registrations(id) on delete set null;

alter table public.lesson_registrations
  drop constraint if exists lesson_registrations_late_cancellation_policy_scope;
alter table public.lesson_registrations
  add constraint lesson_registrations_late_cancellation_policy_scope
  check (late_cancellation_policy is null or outcome = 'cancelada_tarde');

alter table public.lesson_registrations
  drop constraint if exists lesson_registrations_late_cancellation_percentage_scope;
alter table public.lesson_registrations
  add constraint lesson_registrations_late_cancellation_percentage_scope
  check (late_cancellation_percentage is null or late_cancellation_policy = 'cobrar_porcentaje');

comment on column public.lesson_registrations.late_cancellation_policy is
  'Sólo aplica cuando outcome = ''cancelada_tarde'' — espeja LateCancellationPolicy (móvil). Determina si/cuánto se cobra pese a no haberse dictado.';
comment on column public.lesson_registrations.rescheduled_from_registration_id is
  'Enlace de trazabilidad: el registro de la clase de RECUPERACIÓN apunta al registro original (outcome = ''reprogramada'') que reemplaza. El original NUNCA cobra (factor 0); la recuperación es un registro nuevo e independiente que cobra por sí mismo si corresponde — nunca un cargo duplicado por la reprogramación en sí.';

create index if not exists lesson_registrations_rescheduled_from_idx
  on public.lesson_registrations (rescheduled_from_registration_id);

-- =============================================================================
-- 3) register_payment — registra un pago (completo, parcial o retroactivo),
--    contra UN cargo puntual o repartido "obligación más antigua primero".
--    Atómica, idempotente por operation_id, nunca deja saldo a favor, nunca
--    calcula recargo. Soporta corrección/reemplazo (replaces_payment_id):
--    anula el pago viejo en la MISMA transacción, ANTES de calcular la
--    capacidad del nuevo.
--
--    CORRECCIÓN REAL (ronda de revisión de concurrencia — a pedido explícito
--    de Joaquín, revisión del SQL real): la versión anterior calculaba
--    `saldo = original_amount - SUM(allocations)` con un `SELECT` simple,
--    SIN bloquear el cargo — dos llamadas concurrentes (operation_id
--    distintos, mismo cargo) podían leer el MISMO saldo pendiente antes de
--    que ninguna hubiera insertado su allocation, y ambas asignar de más
--    (SUM final > original_amount). Corregido con `SELECT ... FOR UPDATE`
--    sobre el/los `payment_charges` involucrados ANTES de recalcular lo
--    pagado — la segunda transacción concurrente queda bloqueada en el
--    `FOR UPDATE` hasta que la primera confirma (o revierte), y sólo
--    entonces recalcula con el estado YA real, nunca con uno obsoleto.
--    Modo general: bloquea TODOS los cargos elegibles del alumno en un
--    orden determinista real (`due_date, created_at, id`) — el mismo orden
--    en cualquier llamada concurrente evita deadlocks por construcción
--    (nunca dos transacciones bloqueadas esperándose en orden cruzado).
--
--    CORRECCIÓN REAL (segunda ronda de revisión de concurrencia — a pedido
--    explícito de Joaquín): el diseño anterior bloqueaba los cargos del
--    pago VIEJO (a reemplazar) en un paso, y los cargos DESTINO del pago
--    NUEVO en un paso posterior separado — dos órdenes de lock distintos
--    dentro de la MISMA función. Eso abre un deadlock real de manual: un
--    reemplazo cruzado real — "reemplazo X" (pago viejo con allocations en
--    el cargo A, nuevo pago apuntando al cargo B) corriendo en paralelo con
--    "reemplazo Y" (pago viejo con allocations en el cargo B, nuevo pago
--    apuntando al cargo A) — puede terminar con X sosteniendo el lock de A
--    y esperando B, mientras Y sostiene el lock de B y espera A: un ciclo
--    real (Postgres lo detecta y aborta una de las dos con
--    `deadlock_detected`, pero NUNCA debería llegar a ese punto). Corregido
--    calculando PRIMERO la unión completa de "cargos del pago viejo" +
--    "cargos candidatos del pago nuevo" (sin bloquear nada todavía), y
--    bloqueando esa unión ENTERA en una única pasada, en un único orden
--    determinista por `id` — nunca dos pasadas de lock separadas dentro de
--    la misma función. Con esto, ninguna llamada a `register_payment`
--    puede sostener el lock de un cargo mientras espera el de otro con id
--    MENOR — la ausencia de ciclos queda garantizada por construcción
--    (orden total estricto), no por suerte de timing.
-- =============================================================================

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

-- =============================================================================
-- 4) void_payment — anula un pago (nunca lo borra). Idempotente por id real
--    (natural key): reintentar anular el mismo pago nunca falla ni duplica
--    el efecto.
-- =============================================================================

create or replace function public.void_payment(p_payload jsonb)
returns public.payments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_payment_id uuid := nullif(p_payload->>'payment_id', '')::uuid;
  v_reason text := p_payload->>'void_reason';
  v_payment public.payments;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_payment_id is null or v_reason is null or btrim(v_reason) = '' then
    raise exception 'Falta el motivo de la anulación.' using errcode = '22023';
  end if;

  update public.payments
    set voided_at = now(), void_reason = v_reason
    where id = v_payment_id and owner_id = v_owner and voided_at is null
    returning * into v_payment;

  if found then
    return v_payment;
  end if;

  select * into v_payment from public.payments where id = v_payment_id and owner_id = v_owner;
  if not found then
    raise exception 'El pago no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  -- Ya estaba anulado (reintento/doble clic) — se devuelve tal cual, nunca se reprocesa ni se pisa el motivo original.
  return v_payment;
end;
$$;

revoke all on function public.void_payment(jsonb) from public;
grant execute on function public.void_payment(jsonb) to authenticated;
revoke execute on function public.void_payment(jsonb) from anon;

-- =============================================================================
-- 5) void_charge — anula un cobro erróneo. Bloqueado si tiene pagos VIGENTES
--    asignados (la profesora debe anular el pago primero) — nunca deja
--    asignaciones huérfanas. Idempotente por id real.
--
--    CORRECCIÓN REAL (ronda de revisión de concurrencia): la versión
--    anterior consultaba `payment_allocations` ANTES de validar/bloquear el
--    cargo propio — dos problemas reales: (1) carrera con `register_payment`
--    (que ahora bloquea el cargo con `FOR UPDATE` antes de asignar, ver
--    arriba): sin un lock simétrico acá, un pago podía asignarse ENTRE la
--    comprobación de "sin pagos" y el `UPDATE` de anulación, dejando un
--    cargo anulado con un pago vigente recién asignado; (2) filtración
--    entre dueños: la comprobación de `payment_allocations` no exigía
--    `owner_id`, así que el comportamiento (aceptar/rechazar) podía variar
--    según si un `charge_id` AJENO tenía pagos, revelando por timing/
--    comportamiento un dato de otro dueño antes de haber verificado
--    siquiera que el cargo es propio. Corregido: primero `SELECT ... FOR
--    UPDATE` filtrando `owner_id = auth.uid()` — si no existe (propio o
--    ajeno, da igual), siempre el mismo `P0002`, nunca distingue los dos
--    casos; recién con el lock adquirido se relee `payment_allocations`
--    (ahora sí con el estado real, serializado contra `register_payment`).
-- =============================================================================

create or replace function public.void_charge(p_payload jsonb)
returns public.payment_charges
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_charge_id uuid := nullif(p_payload->>'charge_id', '')::uuid;
  v_reason text := p_payload->>'void_reason';
  v_charge public.payment_charges;
  v_has_active_allocation boolean;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_charge_id is null or v_reason is null or btrim(v_reason) = '' then
    raise exception 'Falta el motivo de la anulación.' using errcode = '22023';
  end if;

  select * into v_charge from public.payment_charges where id = v_charge_id and owner_id = v_owner for update;
  if not found then
    raise exception 'El cobro no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  if v_charge.voided_at is not null then
    -- Idempotente: ya estaba anulado (reintento/doble clic) — se devuelve tal cual, nunca se reprocesa ni se pisa el motivo original.
    return v_charge;
  end if;

  select exists (
    select 1 from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.charge_id = v_charge_id and pa.owner_id = v_owner and p.voided_at is null
  ) into v_has_active_allocation;
  if v_has_active_allocation then
    raise exception 'Este cobro tiene pagos asignados — anulá primero el pago correspondiente.' using errcode = '22023';
  end if;

  update public.payment_charges
    set voided_at = now(), void_reason = v_reason
    where id = v_charge_id
    returning * into v_charge;

  return v_charge;
end;
$$;

revoke all on function public.void_charge(jsonb) from public;
grant execute on function public.void_charge(jsonb) to authenticated;
revoke execute on function public.void_charge(jsonb) from anon;

-- =============================================================================
-- 6) ensure_monthly_charges — genera las mensualidades faltantes de un
--    período para los alumnos candidatos (ya filtrados/calculados en
--    TypeScript — resolveStudentBillingPlan/resolveEffectiveMonthlyAmount/
--    resolveMonthlyDueDate, lib/payments/). Idempotente por CLAVE NATURAL
--    (student_id, billing_period) — el índice único ya existe desde Fase 1,
--    ON CONFLICT DO NOTHING alcanza, sin necesitar operation_id: reintentar
--    con los mismos candidatos nunca duplica.
-- =============================================================================

create or replace function public.ensure_monthly_charges(p_billing_period text, p_candidates jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_candidate jsonb;
  v_inserted integer := 0;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_billing_period is null or p_billing_period !~ '^\d{4}-\d{2}$' then
    raise exception 'billing_period inválido.' using errcode = '22023';
  end if;

  for v_candidate in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb))
  loop
    if not exists (
      select 1 from public.students
      where id = nullif(v_candidate->>'student_id', '')::uuid and owner_id = v_owner
    ) then
      continue; -- nunca confía en un student_id ajeno colado en el payload.
    end if;

    insert into public.payment_charges (owner_id, student_id, charge_type, original_amount, due_date, billing_period)
    values (
      v_owner,
      (v_candidate->>'student_id')::uuid,
      'mensual',
      nullif(v_candidate->>'amount', '')::numeric,
      nullif(v_candidate->>'due_date', '')::date,
      p_billing_period
    )
    on conflict (student_id, billing_period) where charge_type = 'mensual' do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.ensure_monthly_charges(text, jsonb) from public;
grant execute on function public.ensure_monthly_charges(text, jsonb) to authenticated;
revoke execute on function public.ensure_monthly_charges(text, jsonb) from anon;

-- =============================================================================
-- 7) sync_per_class_charge — materializa (o corrige, o retira si ya no
--    corresponde) el cobro por clase de UN registro pedagógico, para los
--    alumnos con plan 'por_clase'. Se llama desde el mismo Server Action
--    que finaliza/edita el registro (Fase 4), inmediatamente después de esa
--    RPC — nunca la reemplaza ni la modifica. Idempotente por CLAVE NATURAL
--    (student_id, saved_lesson_id) — el índice único ya existe desde Fase 1.
--    Nunca pisa un cobro que ya tiene pagos asignados.
--
--    CORRECCIÓN REAL (ronda de revisión de concurrencia): la rama de retiro
--    (importe null/0) leía `payment_charges` con un `SELECT` simple y
--    decidía "tiene pagos" con otro `SELECT` sin lock — una asignación de
--    `register_payment` podía colarse justo entre ambas lecturas y el
--    `UPDATE` de anulación, dejando anulado un cargo que en realidad ya
--    tenía un pago vigente. Corregido con `SELECT ... FOR UPDATE` sobre el
--    cargo ANTES de recalcular si tiene pagos — serializa contra
--    `register_payment`/`void_charge` (mismo cargo = mismo lock). La rama
--    de creación/actualización (importe > 0) ya era segura: `INSERT ... ON
--    CONFLICT ... DO UPDATE ... WHERE` bloquea la fila en conflicto como
--    parte del propio UPSERT antes de evaluar el WHERE, sin necesitar un
--    lock explícito adicional.
-- =============================================================================

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

-- =============================================================================
-- 8) configure_training_billing — configura la cuota de UNA serie de
--    entrenamiento (o linaje "esta y las siguientes") y genera
--    automáticamente la obligación del período vigente para cada
--    participante, en una sola operación atómica. El plan completo
--    (agreement + reglas a vincular + cargos esperados) se computa UNA sola
--    vez en TypeScript (`buildTrainingBillingConfigurationPlan`,
--    lib/payments/) — la MISMA función arma la previsualización y el
--    payload real de esta RPC, así preview y ejecución NUNCA pueden
--    divergir (cierra el bug real del commit móvil `2068b3a`: antes, la
--    previsualización usaba un id de acuerdo hipotético propio y la
--    confirmación uno real distinto, y la verificación final fallaba
--    siempre). Idempotente por operation_id: `pending_training_billing_operations`
--    se usa como bitácora PERMANENTE de la operación ya resuelta (nunca se
--    borra al terminar) — un reintento con el mismo operation_id devuelve
--    el resultado ya persistido, sin volver a tocar nada.
--
--    CORRECCIÓN REAL (ronda de revisión de concurrencia — a pedido explícito
--    de Joaquín, revisión del SQL real): dos huecos reales de concurrencia:
--
--    (a) El `SELECT` inicial sobre `pending_training_billing_operations` NO
--    bloqueaba nada — dos llamadas simultáneas con el MISMO operation_id
--    podían ambas ver "no existe" y avanzar, y la segunda terminaba
--    chocando contra el UNIQUE real al insertar la bitácora (error crudo
--    de `unique_violation`, nunca la respuesta idempotente esperada).
--    Corregido con `pg_advisory_xact_lock` derivado de (owner_id,
--    operation_id) — serializa las llamadas con el MISMO operation_id: la
--    segunda espera a que la primera termine su transacción completa
--    (commit o rollback) y RECIÉN ENTONCES vuelve a consultar la bitácora,
--    que ya existe — nunca ve un `unique_violation`.
--
--    (b) Nada impedía que DOS operation_id DISTINTOS sobre la MISMA serie
--    (o el mismo linaje: una serie dividida con "esta y las siguientes"
--    conserva `supersedes_recurrence_id`/`superseded_by_recurrence_id`)
--    crearan DOS acuerdos reales, cada uno generando su propio cargo real
--    de entrenamiento para el mismo alumno/período — el índice único
--    existente (`training_billing_agreement_id, student_id, billing_period`)
--    nunca lo detecta porque el `agreement_id` es distinto en cada uno.
--    Corregido bloqueando TODA la regla y su linaje completo (recorrido
--    recursivo real de `supersedes_recurrence_id`/`superseded_by_recurrence_id`)
--    en orden determinista (por `id`) ANTES de decidir: si el linaje YA
--    tiene un acuerdo real vigente, se devuelve ESE acuerdo tal cual (nunca
--    crea uno nuevo, nunca duplica cargos); si el linaje tiene un estado
--    inconsistente (dos reglas del mismo linaje apuntando a acuerdos
--    DISTINTOS — sólo podría pasar por un dato corrupto anterior a esta
--    corrección), se rechaza explícitamente sin crear nada. Nunca hace
--    falta un índice único adicional por "identidad de serie": mientras
--    ninguna regla (ni su linaje) pueda terminar con dos `agreement_id`
--    distintos, el índice existente por `agreement_id` ya es la garantía
--    real — un índice más amplio (ej. por `student_id + billing_period`
--    solo) rompería el caso legítimo real de "alumno en 2 series de
--    entrenamiento distintas = 2 cargos reales del mismo período".
--
--    CORRECCIÓN REAL (tercera ronda de revisión — a pedido explícito de
--    Joaquín, revisión del código real): cuando el linaje YA tenía un
--    acuerdo, la versión anterior devolvía ese acuerdo y CORTABA ahí — sin
--    (1) vincular la regla concreta pedida si todavía no tenía
--    `training_billing_agreement_id` (podía quedar una regla activa del
--    mismo linaje real sin vínculo, por ejemplo una regla nueva de un split
--    "esta y las siguientes" a la que nunca se le pidió vincularse
--    explícitamente todavía), y (2) sin generar el cargo real de
--    participantes NUEVOS (agregados a la serie después de la
--    configuración original) — quedaban sin cobro hasta la próxima
--    ejecución de `ensure_training_charges`, en vez de recibirlo ahora
--    mismo, con su fecha efectiva real. Corregido: las dos ramas (crear
--    acuerdo nuevo / reutilizar uno existente) ahora CONVERGEN en el MISMO
--    bloque de vinculación + generación de cargos — nunca dos
--    implementaciones paralelas.
-- =============================================================================

create or replace function public.configure_training_billing(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_existing_op public.pending_training_billing_operations;
  v_rule_ids uuid[];
  v_lineage_rule_ids uuid[];
  v_monthly_fee numeric(12, 2) := nullif(p_payload->>'monthly_fee', '')::numeric;
  v_series_name text := p_payload->>'training_series_name';
  v_start_period text := p_payload->>'start_period';
  v_agreement_id uuid;
  v_existing_agreement_id uuid;
  v_distinct_agreement_count integer;
  v_agreement public.training_billing_agreements;
  v_charge jsonb;
  v_charge_ids uuid[] := '{}';
  v_new_charge_id uuid;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_operation_id is null then
    raise exception 'Falta operation_id.' using errcode = '22023';
  end if;
  if v_monthly_fee is null or v_monthly_fee <= 0 or v_start_period is null then
    raise exception 'Faltan campos obligatorios de la configuración.' using errcode = '22023';
  end if;

  -- (a) Serializa por (owner, operation_id) — ver comentario de arriba.
  -- `hashtext` es determinista para el mismo texto: dos llamadas con el
  -- mismo (owner_id, operation_id) SIEMPRE piden el mismo lock. El lock es
  -- de transacción (`_xact_`): se libera solo, automáticamente, al
  -- terminar esta función (commit o rollback) — nunca hace falta liberarlo
  -- a mano.
  perform pg_advisory_xact_lock(hashtext(v_owner::text), hashtext(v_operation_id::text));

  select * into v_existing_op from public.pending_training_billing_operations
    where owner_id = v_owner and operation_id = v_operation_id::text;
  if found then
    return jsonb_build_object(
      'agreement_id', v_existing_op.agreement->>'id',
      'charge_ids', to_jsonb(v_existing_op.expected_charge_ids)
    );
  end if;

  -- nullif(x, 'null'::jsonb) antes de coalesce: un `null` JSON explícito en
  -- la clave (no ausente) no es SQL NULL para `coalesce` — mismo hallazgo
  -- real corregido en Fase 4 (20260924100000_fix_json_null_attendance_evaluation.sql).
  select array_agg(value::uuid) into v_rule_ids
    from jsonb_array_elements_text(coalesce(nullif(p_payload->'recurrence_rule_ids', 'null'::jsonb), '[]'::jsonb));
  if v_rule_ids is null or array_length(v_rule_ids, 1) is null then
    raise exception 'Falta al menos una serie a vincular.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_rule_ids) as rid
    where not exists (select 1 from public.recurrence_rules where id = rid and owner_id = v_owner)
  ) then
    raise exception 'Una de las series no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  -- (b) Expande el linaje completo real (supersedes/superseded_by) de cada
  -- regla dada — nunca deja pasar una serie hermana del mismo linaje
  -- económico ya configurada por otra rama.
  with recursive lineage as (
    select id, supersedes_recurrence_id, superseded_by_recurrence_id
    from public.recurrence_rules where id = any(v_rule_ids) and owner_id = v_owner
    union
    select r.id, r.supersedes_recurrence_id, r.superseded_by_recurrence_id
    from public.recurrence_rules r
    join lineage l on r.id = l.supersedes_recurrence_id or r.id = l.superseded_by_recurrence_id
    where r.owner_id = v_owner
  )
  select coalesce(array_agg(distinct id order by id), '{}') into v_lineage_rule_ids from lineage;

  -- Bloquea TODAS las reglas del linaje en orden determinista (por id) —
  -- el mismo orden en cualquier llamada concurrente evita deadlocks por
  -- construcción.
  perform 1 from public.recurrence_rules where id = any(v_lineage_rule_ids) and owner_id = v_owner order by id for update;

  -- Tras el lock, releé el estado REAL de configuración de todo el linaje.
  -- (uuid no tiene agregado max/min real — se toma cualquiera de los
  -- distintos valores no nulos, alcanza porque el chequeo real de
  -- consistencia es `v_distinct_agreement_count`, no cuál en particular).
  select count(distinct training_billing_agreement_id) filter (where training_billing_agreement_id is not null)
    into v_distinct_agreement_count
    from public.recurrence_rules where id = any(v_lineage_rule_ids) and owner_id = v_owner;

  select training_billing_agreement_id into v_existing_agreement_id
    from public.recurrence_rules
    where id = any(v_lineage_rule_ids) and owner_id = v_owner and training_billing_agreement_id is not null
    limit 1;

  if v_distinct_agreement_count > 1 then
    raise exception 'Esta serie ya tiene cuotas configuradas de forma inconsistente (varios acuerdos en el mismo linaje) — revisalo manualmente antes de reintentar.' using errcode = '22023';
  end if;

  if v_distinct_agreement_count = 1 then
    -- Este linaje YA está configurado (por una llamada anterior, con OTRO
    -- operation_id) — nunca crea un segundo acuerdo. Usa el agreement_id
    -- real existente; el bloque compartido de abajo se encarga de vincular
    -- cualquier regla del linaje todavía suelta y de generar el cargo real
    -- de cualquier participante nuevo, sin duplicar nada ya existente.
    v_agreement_id := v_existing_agreement_id;
  else
    -- Ninguna regla del linaje está configurada todavía — crea el acuerdo real.
    insert into public.training_billing_agreements (owner_id, monthly_fee, start_period)
    values (v_owner, v_monthly_fee, v_start_period)
    returning id into v_agreement_id;
  end if;

  -- Vincula TODA regla del linaje que todavía no tenga acuerdo — cubre
  -- tanto el caso "acuerdo nuevo" (v_rule_ids reales) como el caso "linaje
  -- ya configurado, pero esta regla puntual/una hermana de un split
  -- todavía no vinculada" (resto del linaje) — nunca deja una regla activa
  -- del mismo linaje sin vínculo por haber retornado anticipadamente.
  update public.recurrence_rules
    set training_billing_agreement_id = v_agreement_id
    where id = any(v_lineage_rule_ids) and owner_id = v_owner and training_billing_agreement_id is null;

  -- Genera (o completa) los cargos del período vigente. Participantes ya
  -- facturados nunca se duplican (ON CONFLICT DO NOTHING, misma clave
  -- natural de siempre); participantes NUEVOS (agregados a la serie
  -- después de la configuración original) reciben acá su cargo real, con
  -- su propia fecha efectiva — el llamador (TypeScript,
  -- `buildTrainingBillingConfigurationPlan`) computa ese importe
  -- proporcional real para cada uno, esta RPC sólo lo persiste.
  for v_charge in select * from jsonb_array_elements(coalesce(nullif(p_payload->'charges', 'null'::jsonb), '[]'::jsonb))
  loop
    if not exists (select 1 from public.students where id = nullif(v_charge->>'student_id', '')::uuid and owner_id = v_owner) then
      continue;
    end if;
    insert into public.payment_charges (
      owner_id, student_id, charge_type, original_amount, due_date, billing_period,
      training_billing_agreement_id, training_series_name
    )
    values (
      v_owner,
      (v_charge->>'student_id')::uuid,
      'entrenamiento',
      nullif(v_charge->>'amount', '')::numeric,
      nullif(v_charge->>'due_date', '')::date,
      v_charge->>'billing_period',
      v_agreement_id,
      v_series_name
    )
    on conflict (training_billing_agreement_id, student_id, billing_period) where charge_type = 'entrenamiento' do nothing
    returning id into v_new_charge_id;

    if v_new_charge_id is not null then
      v_charge_ids := array_append(v_charge_ids, v_new_charge_id);
    end if;
  end loop;

  select * into v_agreement from public.training_billing_agreements where id = v_agreement_id;

  insert into public.pending_training_billing_operations (
    owner_id, operation_id, kind, agreement, recurrence_ids_to_link, expected_charge_ids, start_period, end_period
  )
  values (
    v_owner,
    v_operation_id::text,
    'create_series',
    to_jsonb(v_agreement),
    coalesce((select array_agg(rid::text) from unnest(v_lineage_rule_ids) as rid), '{}'),
    coalesce((select array_agg(cid::text) from unnest(v_charge_ids) as cid), '{}'),
    v_start_period,
    v_start_period
  )
  on conflict (owner_id, operation_id) do nothing;

  return jsonb_build_object('agreement_id', v_agreement_id, 'charge_ids', to_jsonb(v_charge_ids));
end;
$$;

revoke all on function public.configure_training_billing(jsonb) from public;
grant execute on function public.configure_training_billing(jsonb) to authenticated;
revoke execute on function public.configure_training_billing(jsonb) from anon;

-- =============================================================================
-- 9) edit_training_billing_fee — cambia la cuota de una serie YA
--    configurada, vigente desde el PRÓXIMO período (nunca altera el
--    período actual ni los anteriores) — espeja
--    MonthlyBillingPlan.pendingAmount/pendingAmountEffectiveFrom aplicado a
--    TrainingBillingAgreement. UPDATE simple: repetirla con los mismos
--    valores es naturalmente inofensivo (nunca inserta, nunca duplica).
-- =============================================================================

create or replace function public.edit_training_billing_fee(p_payload jsonb)
returns public.training_billing_agreements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_agreement_id uuid := nullif(p_payload->>'agreement_id', '')::uuid;
  v_pending_fee numeric(12, 2) := nullif(p_payload->>'pending_monthly_fee', '')::numeric;
  v_effective_from text := p_payload->>'pending_monthly_fee_effective_from';
  v_agreement public.training_billing_agreements;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_agreement_id is null or v_pending_fee is null or v_pending_fee <= 0 or v_effective_from is null then
    raise exception 'Faltan campos obligatorios.' using errcode = '22023';
  end if;

  update public.training_billing_agreements
    set pending_monthly_fee = v_pending_fee, pending_monthly_fee_effective_from = v_effective_from
    where id = v_agreement_id and owner_id = v_owner
    returning * into v_agreement;

  if not found then
    raise exception 'El acuerdo de cuota no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  return v_agreement;
end;
$$;

revoke all on function public.edit_training_billing_fee(jsonb) from public;
grant execute on function public.edit_training_billing_fee(jsonb) to authenticated;
revoke execute on function public.edit_training_billing_fee(jsonb) from anon;

-- =============================================================================
-- 9.5) ensure_training_charges — generación PERIÓDICA real de cuotas de
--    entrenamiento (brecha real encontrada en la revisión de esta ronda: la
--    versión anterior sólo generaba el cargo del período INICIAL desde
--    `configure_training_billing` — nunca existía nada que generara
--    octubre, noviembre, etc. de una serie ya configurada, ni que
--    consumiera `pending_monthly_fee` una vez llegado su período). Mismo
--    patrón que `ensure_monthly_charges`: el cálculo real (qué alumnos son
--    candidatos, qué importe corresponde — proporcional para su propio
--    primer período real, completo con `resolveEffectiveTrainingFee` para
--    el resto, elegibilidad estricta de entrenamiento, linaje real de
--    reglas por acuerdo) se hace en TypeScript
--    (`lib/repositories/payments.ts::ensureTrainingCharges`, reutilizando
--    el MISMO motor puro que `configure_training_billing` — nunca una
--    fórmula paralela) — esta RPC sólo persiste los candidatos ya
--    calculados, de forma atómica e idempotente por la clave natural real
--    (`training_billing_agreement_id, student_id, billing_period`, el
--    mismo índice único de siempre) — reintentar/recargar/dos llamadas
--    concurrentes con candidatos solapados nunca duplica un cargo.
-- =============================================================================

create or replace function public.ensure_training_charges(p_candidates jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_candidate jsonb;
  v_agreement_id uuid;
  v_student_id uuid;
  v_inserted integer := 0;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  for v_candidate in select * from jsonb_array_elements(coalesce(nullif(p_candidates, 'null'::jsonb), '[]'::jsonb))
  loop
    v_agreement_id := nullif(v_candidate->>'agreement_id', '')::uuid;
    v_student_id := nullif(v_candidate->>'student_id', '')::uuid;
    if v_agreement_id is null or v_student_id is null then
      continue; -- nunca confía en ids ajenos/incompletos colados en el payload.
    end if;
    if not exists (select 1 from public.training_billing_agreements where id = v_agreement_id and owner_id = v_owner) then
      continue;
    end if;
    if not exists (select 1 from public.students where id = v_student_id and owner_id = v_owner) then
      continue;
    end if;

    insert into public.payment_charges (
      owner_id, student_id, charge_type, original_amount, due_date, billing_period,
      training_billing_agreement_id, training_series_name
    )
    values (
      v_owner,
      v_student_id,
      'entrenamiento',
      nullif(v_candidate->>'amount', '')::numeric,
      nullif(v_candidate->>'due_date', '')::date,
      v_candidate->>'billing_period',
      v_agreement_id,
      nullif(v_candidate->>'training_series_name', '')
    )
    on conflict (training_billing_agreement_id, student_id, billing_period) where charge_type = 'entrenamiento' do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.ensure_training_charges(jsonb) from public;
grant execute on function public.ensure_training_charges(jsonb) to authenticated;
revoke execute on function public.ensure_training_charges(jsonb) from anon;

-- =============================================================================
-- 10) Cierre de Cancelada/Reprogramada — se reemplazan `start_lesson_registration`
--    y `edit_completed_lesson_registration` (Fase 4) para aceptar
--    late_cancellation_policy/late_cancellation_percentage/
--    rescheduled_from_registration_id. Reproduce el cuerpo COMPLETO vigente
--    de cada función (HEAD real: 20260922100000 + 20260924100000) — nunca
--    una reescritura parcial — sumando SÓLO estos 3 campos nuevos, sin
--    tocar ninguna otra regla ya verificada. El cómputo de facturación
--    (computeLateCancellationBillingFactor, lib/payments/adhoc-billing.ts)
--    vive en TypeScript, igual criterio que `isAdhocClassHeld` — esta RPC
--    sólo persiste los campos, nunca decide cuánto se cobra.
-- =============================================================================

create or replace function public.start_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_calendar_lesson_id uuid := nullif(p_payload->>'calendar_lesson_id', '')::uuid;
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_occurrence_key text := nullif(p_payload->>'occurrence_key', '');
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_activity_kind text := coalesce(p_payload->>'activity_kind', 'class');
  v_outcome text := coalesce(p_payload->>'outcome', 'clase_dictada');
  v_holiday_exception boolean := coalesce((p_payload->>'holiday_exception')::boolean, false);
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_late_cancellation_policy text := nullif(p_payload->>'late_cancellation_policy', '');
  v_late_cancellation_percentage smallint := nullif(p_payload->>'late_cancellation_percentage', '')::smallint;
  v_rescheduled_from_registration_id uuid := nullif(p_payload->>'rescheduled_from_registration_id', '')::uuid;
  v_class_held boolean := (coalesce(p_payload->>'outcome', 'clase_dictada') = 'clase_dictada')
    or (p_payload->>'outcome' = 'feriado' and coalesce((p_payload->>'holiday_exception')::boolean, false));
  v_registration public.lesson_registrations;
  v_participant jsonb;
  v_participant_status text;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  if v_recurrence_id is not null and not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
  end if;
  if v_calendar_lesson_id is not null and not exists (select 1 from public.calendar_lessons where id = v_calendar_lesson_id and owner_id = v_owner) then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;
  if v_primary_student_id is not null and not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if v_rescheduled_from_registration_id is not null and not exists (select 1 from public.lesson_registrations where id = v_rescheduled_from_registration_id and owner_id = v_owner) then
    raise exception 'El registro original de la reprogramación no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where not exists (select 1 from public.students where id = (p->>'student_id')::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if jsonb_array_length(coalesce(p_payload->'participants', '[]'::jsonb)) = 0 then
    raise exception 'Elegí al menos un alumno.' using errcode = '22023';
  end if;
  if v_calendar_lesson_id is null and v_operation_id is null then
    raise exception 'operation_id es obligatorio para un registro ad-hoc.' using errcode = '22023';
  end if;

  -- Materializa la ocurrencia de serie si todavía es virtual — nunca crea
  -- una segunda fila si (recurrence_id, occurrence_key) ya estaba
  -- materializada (mismo índice único que usan cancel/reschedule).
  if v_calendar_lesson_id is null and v_recurrence_id is not null and v_occurrence_key is not null then
    insert into public.calendar_lessons (
      owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
      modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
      recurrence_index, recurrence_original_start, class_title, activity_kind
    ) values (
      v_owner,
      v_primary_student_id,
      p_payload->>'student_name',
      p_payload->>'level',
      p_payload->>'lesson_type',
      (p_payload->>'start_at')::timestamptz,
      (p_payload->>'end_at')::timestamptz,
      p_payload->>'modality',
      'scheduled',
      coalesce(p_payload->>'color', '#FCE4D2'),
      true,
      v_recurrence_id,
      v_occurrence_key,
      (p_payload->>'recurrence_index')::int,
      (p_payload->>'start_at')::timestamptz,
      nullif(p_payload->>'class_title', ''),
      v_activity_kind
    )
    on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
    do update set updated_at = now()
    returning id into v_calendar_lesson_id;

    for v_participant in select * from jsonb_array_elements(p_payload->'participants')
    loop
      insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
      values (v_owner, v_calendar_lesson_id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level')
      on conflict (calendar_lesson_id, student_id) do nothing;
    end loop;
  end if;

  if v_calendar_lesson_id is not null then
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status
    ) values (
      v_owner, v_calendar_lesson_id, v_activity_kind, coalesce((p_payload->>'counts_as_class')::boolean, true),
      (p_payload->>'start_at')::timestamptz, 'in_progress'
    )
    on conflict (owner_id, calendar_lesson_id) where calendar_lesson_id is not null
    do nothing
    returning * into v_registration;

    if not found then
      select * into v_registration from public.lesson_registrations where owner_id = v_owner and calendar_lesson_id = v_calendar_lesson_id;
      return v_registration;
    end if;
  else
    -- Ad-hoc (sin reserva de calendario, como NewClassScreen.tsx en el
    -- móvil) — idempotente por `operation_id`: dos llamadas con el mismo
    -- id SIEMPRE convergen en la misma fila. Un operation_id nuevo SIEMPRE
    -- inserta una fila nueva, sin importar si alumno/fecha/hora coinciden
    -- con un registro anterior. Suma (Fase 5) late_cancellation_policy/
    -- late_cancellation_percentage/rescheduled_from_registration_id —
    -- cierre de Cancelada/Reprogramada del registro ad-hoc.
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, scheduled_end_at,
      outcome, holiday_exception, modality, operation_id,
      late_cancellation_policy, late_cancellation_percentage, rescheduled_from_registration_id, status
    ) values (
      v_owner, null, v_activity_kind, v_class_held,
      nullif(p_payload->>'start_at', '')::timestamptz, nullif(p_payload->>'end_at', '')::timestamptz,
      v_outcome, v_holiday_exception, nullif(p_payload->>'modality', ''), v_operation_id,
      v_late_cancellation_policy, v_late_cancellation_percentage, v_rescheduled_from_registration_id, 'in_progress'
    )
    on conflict (owner_id, operation_id) where operation_id is not null
    do nothing
    returning * into v_registration;

    if not found then
      select * into v_registration from public.lesson_registrations where owner_id = v_owner and operation_id = v_operation_id;
      return v_registration;
    end if;
  end if;

  -- Cuando la actividad no se dictó (profesora ausente, o feriado sin
  -- excepción), no hay asistencia/evaluación/tarea que completar por
  -- participante — se insertan directamente 'completed' para habilitar
  -- "Finalizar registro" de inmediato, mismo criterio que `classHeld` del
  -- móvil (esas secciones ni se muestran en ese caso).
  v_participant_status := case when v_class_held then 'pending' else 'completed' end;
  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id, participant_status)
    values (v_owner, v_registration.id, (v_participant->>'student_id')::uuid, v_participant_status)
    on conflict (lesson_registration_id, student_id) do nothing;
  end loop;

  return v_registration;
end;
$$;

revoke all on function public.start_lesson_registration(jsonb) from public;
grant execute on function public.start_lesson_registration(jsonb) to authenticated;
revoke execute on function public.start_lesson_registration(jsonb) from anon;

-- Mismo criterio: se agregan late_cancellation_policy/late_cancellation_percentage
-- al encabezado editable de un registro ya finalizado — mismo patrón
-- "campo ausente nunca pisa lo ya guardado" (`p_payload ? 'campo'`) que el
-- resto de los campos del encabezado. `rescheduled_from_registration_id`
-- NO se vuelve editable acá a propósito: es un enlace de identidad fijado
-- al crear el registro, nunca reasignado después.
create or replace function public.edit_completed_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_edit_operation_id uuid := nullif(p_payload->>'edit_operation_id', '')::uuid;
  v_registration public.lesson_registrations;
  v_history_id uuid;
  v_participants jsonb := coalesce(nullif(p_payload->'participants', 'null'::jsonb), '[]'::jsonb);
  v_participant jsonb;
  v_student_id uuid;
  v_attendance jsonb;
  v_evaluation jsonb;
  v_homework_reviews jsonb;
  v_homework_review jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_edit_operation_id is null then
    raise exception 'edit_operation_id es obligatorio.' using errcode = '22023';
  end if;

  select * into v_registration from public.lesson_registrations where id = v_registration_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if v_registration.status <> 'completed' then
    raise exception 'Esta RPC sólo edita registros ya finalizados — usá start_lesson_registration/save_participant_registration/finalize_lesson_registration para el registro inicial.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_participants) as p
    where not exists (
      select 1 from public.lesson_registration_students s
      where s.lesson_registration_id = v_registration_id and s.student_id = (p->>'student_id')::uuid and s.owner_id = v_owner
    )
  ) then
    raise exception 'Ese alumno no forma parte de este registro.' using errcode = 'P0002';
  end if;

  insert into public.lesson_registration_edit_history (owner_id, lesson_registration_id, edit_operation_id, edited_at, previous_snapshot)
  values (
    v_owner, v_registration_id, v_edit_operation_id, now(),
    jsonb_build_object(
      'registration', to_jsonb(v_registration),
      'participants', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.lesson_registration_students s where s.lesson_registration_id = v_registration_id and s.owner_id = v_owner),
      'attendance', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.lesson_registration_attendance a where a.lesson_registration_id = v_registration_id and a.owner_id = v_owner),
      'evaluations', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.lesson_registration_evaluations e where e.lesson_registration_id = v_registration_id and e.owner_id = v_owner),
      'homework_reviews', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.lesson_registration_homework_reviews h where h.lesson_registration_id = v_registration_id and h.owner_id = v_owner)
    )
  )
  on conflict (lesson_registration_id, edit_operation_id) do nothing
  returning id into v_history_id;

  if v_history_id is null then
    return v_registration;
  end if;

  for v_participant in select * from jsonb_array_elements(v_participants)
  loop
    v_student_id := (v_participant->>'student_id')::uuid;
    v_attendance := nullif(v_participant->'attendance', 'null'::jsonb);
    v_evaluation := nullif(v_participant->'evaluation', 'null'::jsonb);
    v_homework_reviews := coalesce(nullif(v_participant->'homework_reviews', 'null'::jsonb), '[]'::jsonb);

    if v_attendance is not null then
      insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status, late_minutes)
      values (v_owner, v_registration_id, v_student_id, v_attendance->>'status', nullif(v_attendance->>'late_minutes', '')::int)
      on conflict (lesson_registration_id, student_id)
      do update set status = excluded.status, late_minutes = excluded.late_minutes;
    end if;

    if v_evaluation is not null then
      insert into public.lesson_registration_evaluations (
        owner_id, lesson_registration_id, student_id, general_grade, skill_grades, strengths, areas_to_improve,
        individual_observation, individual_homework_description, individual_homework_due_date, billed_amount
      ) values (
        v_owner, v_registration_id, v_student_id,
        nullif(v_evaluation->>'general_grade', '')::numeric,
        coalesce(v_evaluation->'skill_grades', '{}'::jsonb),
        coalesce(array(select jsonb_array_elements_text(v_evaluation->'strengths')), '{}'),
        coalesce(array(select jsonb_array_elements_text(v_evaluation->'areas_to_improve')), '{}'),
        nullif(v_evaluation->>'individual_observation', ''),
        nullif(v_evaluation->>'individual_homework_description', ''),
        nullif(v_evaluation->>'individual_homework_due_date', '')::date,
        nullif(v_evaluation->>'billed_amount', '')::numeric
      )
      on conflict (lesson_registration_id, student_id)
      do update set
        general_grade = excluded.general_grade,
        skill_grades = excluded.skill_grades,
        strengths = excluded.strengths,
        areas_to_improve = excluded.areas_to_improve,
        individual_observation = excluded.individual_observation,
        individual_homework_description = excluded.individual_homework_description,
        individual_homework_due_date = excluded.individual_homework_due_date,
        billed_amount = excluded.billed_amount;
    end if;

    for v_homework_review in select * from jsonb_array_elements(v_homework_reviews)
    loop
      insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
      values (v_owner, v_registration_id, v_student_id, v_homework_review->>'task_id', v_homework_review->>'outcome', now())
      on conflict (lesson_registration_id, student_id, task_id)
      do update set outcome = excluded.outcome, reviewed_at = now();
    end loop;
  end loop;

  update public.lesson_registrations
  set
    homework_description = case when p_payload ? 'homework_description' then nullif(p_payload->>'homework_description', '') else homework_description end,
    homework_due_date = case when p_payload ? 'homework_due_date' then nullif(p_payload->>'homework_due_date', '')::date else homework_due_date end,
    counts_as_class = case when p_payload ? 'counts_as_class' then (p_payload->>'counts_as_class')::boolean else counts_as_class end,
    actual_started_at = case when p_payload ? 'actual_started_at' then nullif(p_payload->>'actual_started_at', '')::timestamptz else actual_started_at end,
    actual_ended_at = case when p_payload ? 'actual_ended_at' then nullif(p_payload->>'actual_ended_at', '')::timestamptz else actual_ended_at end,
    late_cancellation_policy = case when p_payload ? 'late_cancellation_policy' then nullif(p_payload->>'late_cancellation_policy', '') else late_cancellation_policy end,
    late_cancellation_percentage = case when p_payload ? 'late_cancellation_percentage' then nullif(p_payload->>'late_cancellation_percentage', '')::smallint else late_cancellation_percentage end,
    updated_at = now()
  where id = v_registration_id and owner_id = v_owner
  returning * into v_registration;

  if v_registration.actual_started_at is not null and v_registration.actual_ended_at is not null
     and v_registration.actual_ended_at <= v_registration.actual_started_at then
    raise exception 'La hora de fin real debe ser posterior a la de inicio.' using errcode = '22023';
  end if;

  return v_registration;
end;
$$;

revoke all on function public.edit_completed_lesson_registration(jsonb) from public;
grant execute on function public.edit_completed_lesson_registration(jsonb) to authenticated;
revoke execute on function public.edit_completed_lesson_registration(jsonb) from anon;
