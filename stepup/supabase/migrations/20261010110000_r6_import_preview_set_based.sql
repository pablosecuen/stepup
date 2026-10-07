-- R6 — Importaciones grandes (2/4): vista previa por LOTES. ADITIVA e idempotente: funciones nuevas `_import_classify_*` (internas, sin EXECUTE para la
-- API) y `preview_backup_import` redefinida con la MISMA firma, el mismo resultado y los mismos privilegios (CREATE OR REPLACE conserva el ACL).
-- Las funciones anteriores (`_classify_*`, `_external_ref_available`) NO se tocan: quedan sin llamadas desde la vista previa y permiten volver
-- atrás con `supabase/repairs/r6_import_rollback.sql` (basta redefinir `preview_backup_import` con el cuerpo anterior).
--
-- Qué cambia respecto de la versión anterior (todo medido, ver docs/R6_IMPORTACIONES_GRANDES.md):
--   * Cada clasificador es UNA sentencia con uniones por hash (antes: una consulta y una concatenación jsonb por elemento → O(n²)).
--   * `_external_ref_available` (recorría la lista clasificada para cada referencia) se reemplaza por un conjunto de ids unido por hash.
--   * Componentes financieras: union-find en arreglos (antes: un UPDATE de todos los nodos por cada arista y una búsqueda lineal en el
--     respaldo por cada miembro → O(n²) y el 75 % del tiempo de la vista previa).
--   * Huellas y candidatos a duplicado se insertan por lote. Se rechaza ANTES de procesar lo que excede los límites.
-- El resultado (`classification`) conserva exactamente la misma forma y orden; las componentes financieras ahora tienen un orden de miembros
-- DETERMINISTA (el de aparición en el respaldo) en lugar del orden físico de una tabla temporal.

-- ---------------------------------------------------------------------------------------------------------------------
-- Alumnos
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_classify_students(p_owner uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := public._import_arr(p_payload, 'students');
begin
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), m as (
      select b.ord, b.r, s.id as sid, case when s.id is not null then to_jsonb(s) end as srow
        from b left join public.students s on s.owner_id = p_owner and s.legacy_mobile_id = b.r ->> 'id'
    ), hit as (
      -- Heurística de duplicado (alumno de la copia sin id coincidente que parece un alumno web sin id): una unión por hash por señal.
      select m.ord, nl.id as cid, nl.created_at as c_at
        from m join public.students nl on nl.owner_id = p_owner and nl.legacy_mobile_id is null
          and lower(btrim(nl.name)) = lower(btrim(coalesce(m.r ->> 'name', '')))
       where m.sid is null and btrim(coalesce(nl.name, '')) <> ''
      union
      select m.ord, nl.id, nl.created_at
        from m join public.students nl on nl.owner_id = p_owner and nl.legacy_mobile_id is null
          and public._normalize_email(nl.email) = public._normalize_email(m.r ->> 'email')
       where m.sid is null and nl.email is not null and m.r ->> 'email' is not null and public._normalize_email(nl.email) <> ''
      union
      select m.ord, nl.id, nl.created_at
        from m join public.students nl on nl.owner_id = p_owner and nl.legacy_mobile_id is null
          and public._normalize_phone(nl.phone) = public._normalize_phone(m.r ->> 'phone')
       where m.sid is null and nl.phone is not null and m.r ->> 'phone' is not null and public._normalize_phone(nl.phone) <> ''
    ), pick as (
      select distinct on (h.ord) h.ord, h.cid from hit h order by h.ord, h.c_at, h.cid
    ), cls as (
      select m.ord, m.r, m.r ->> 'id' as lid, m.sid, pk.cid, dup.dj,
             case when m.sid is not null then public._diff_student_fields(m.srow, m.r) end as diff
        from m
        left join pick pk on pk.ord = m.ord
        left join lateral (select to_jsonb(d) as dj from public.students d where d.id = pk.cid) dup on true
    ), k as (
      select cls.*, case when cls.sid is not null then case when cls.diff = '{}'::jsonb then 'equal' else 'conflict' end
                         when cls.cid is not null then 'duplicate' else 'insert' end as kind
        from cls
    )
    select jsonb_build_object(
      'inserts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid) order by k.ord) from k where k.kind = 'insert'), '[]'::jsonb),
      'equal', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'row_id', k.sid) order by k.ord) from k where k.kind = 'equal'), '[]'::jsonb),
      'conflicts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'row_id', k.sid, 'fields', k.diff) order by k.ord) from k where k.kind = 'conflict'), '[]'::jsonb),
      'duplicates', coalesce((
        select jsonb_agg(jsonb_build_object(
          'backup_legacy_mobile_id', k.lid,
          'candidate_student_id', k.cid,
          'match_signals', to_jsonb(public._student_match_signals(k.dj ->> 'name', k.dj ->> 'email', k.dj ->> 'phone', k.r ->> 'name', k.r ->> 'email', k.r ->> 'phone')),
          'candidate_fingerprint', public._fingerprint_canonical('students', k.dj),
          'field_diff', public._diff_student_fields(k.dj, k.r)
        ) order by k.ord) from k where k.kind = 'duplicate'), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Niveles personalizados
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_classify_custom_levels(p_owner uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := public._import_arr(p_payload, 'customLevels');
begin
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), k as (
      select b.ord, b.r ->> 'id' as lid, cl.id as cid, cl.name as web_name, b.r ->> 'name' as backup_name,
             case when cl.id is null then 'insert'
                  when btrim(cl.name) = btrim(coalesce(b.r ->> 'name', '')) then 'equal' else 'conflict' end as kind
        from b left join public.custom_levels cl on cl.owner_id = p_owner and cl.legacy_mobile_id = b.r ->> 'id'
    )
    select jsonb_build_object(
      'inserts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid) order by k.ord) from k where k.kind = 'insert'), '[]'::jsonb),
      'equal', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'row_id', k.cid) order by k.ord) from k where k.kind = 'equal'), '[]'::jsonb),
      'conflicts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'row_id', k.cid,
          'fields', jsonb_build_object('name', jsonb_build_object('web', k.web_name, 'backup', k.backup_name))) order by k.ord) from k where k.kind = 'conflict'), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Sólo-altas (acuerdos de cuota y historial de niveles)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_classify_insert_only(p_table_name text, p_owner uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end;
begin
  if p_table_name not in ('training_billing_agreements', 'student_level_history') then
    raise exception 'Tabla insert-only no reconocida: %', p_table_name;
  end if;
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), k as (
      select b.ord, b.r ->> 'id' as lid,
             case when p_table_name = 'training_billing_agreements' then t.id is not null else h.id is not null end as ex,
             case when p_table_name = 'training_billing_agreements' and t.id is not null then (t.monthly_fee is distinct from (b.r ->> 'monthlyFee')::numeric) else false end as differs
        from b
        left join public.training_billing_agreements t on p_table_name = 'training_billing_agreements' and t.owner_id = p_owner and t.legacy_mobile_id = b.r ->> 'id'
        left join public.student_level_history h on p_table_name = 'student_level_history' and h.owner_id = p_owner and h.legacy_mobile_id = b.r ->> 'id'
    )
    select jsonb_build_object(
      'inserts', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid) order by k.ord) from k where not k.ex), '[]'::jsonb),
      'preserved', coalesce((select jsonb_agg(jsonb_build_object('legacy_mobile_id', k.lid, 'differs', k.differs) order by k.ord) from k where k.ex), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Series
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_classify_recurrence_rules(p_owner uuid, p_payload jsonb, p_students_classified jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := public._import_arr(p_payload, 'recurrenceRules');
begin
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), st as (
      select distinct a from public._import_available_ids('students', p_owner, p_students_classified) a
    ), c as (
      select b.ord, b.r ->> 'id' as lid, rr.id is not null as in_web,
             (b.r ->> 'primaryStudentId' is null or st.a is not null) as stu_ok,
             (b.r ->> 'trainingBillingAgreementId' is null or ta.id is not null) as agr_ok
        from b
        left join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = b.r ->> 'id'
        left join st on st.a = b.r ->> 'primaryStudentId'
        left join public.training_billing_agreements ta on ta.owner_id = p_owner and ta.legacy_mobile_id = b.r ->> 'trainingBillingAgreementId'
    )
    select coalesce(jsonb_agg(
      case when c.in_web then jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'preserved', 'reason', 'la regla ya existe en la web')
           when not c.stu_ok or not c.agr_ok then jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'omitted_broken_reference',
             'reason', case when not c.stu_ok then 'referencia a alumno inexistente' else 'referencia a acuerdo de entrenamiento inexistente' end)
           else jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'insertable') end
      order by c.ord), '[]'::jsonb)
    from c
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Clases de calendario
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_classify_calendar_lessons(p_owner uuid, p_payload jsonb, p_students_classified jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := public._import_arr(p_payload, 'calendarLessons');
begin
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), st as (
      select distinct a from public._import_available_ids('students', p_owner, p_students_classified) a
    ), c as (
      select b.ord, b.r ->> 'id' as lid, cl.id is not null as in_web,
             (b.r ->> 'primaryStudentId' is null or st.a is not null) as stu_ok,
             (b.r ->> 'recurrenceId' is null or rr.id is not null) as rec_ok
        from b
        left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = b.r ->> 'id'
        left join st on st.a = b.r ->> 'primaryStudentId'
        left join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = b.r ->> 'recurrenceId'
    )
    select coalesce(jsonb_agg(
      case when c.in_web then jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'preserved', 'reason', 'la clase ya existe en la web')
           when not c.stu_ok or not c.rec_ok then jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'omitted_broken_reference',
             'reason', case when not c.stu_ok then 'referencia a alumno inexistente' else 'referencia a una serie que no se importó' end)
           else jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'insertable') end
      order by c.ord), '[]'::jsonb)
    from c
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Registros de clase
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_classify_lesson_registrations(p_owner uuid, p_payload jsonb, p_students_classified jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_arr jsonb := public._import_arr(p_payload, 'pedagogicalLessons');
begin
  return (
    with b as (
      select x.ord, x.r from jsonb_array_elements(v_arr) with ordinality as x(r, ord)
    ), st as (
      select distinct a from public._import_available_ids('students', p_owner, p_students_classified) a
    ), bad_roster as (
      -- Registros con algún integrante que no se puede resolver (se aplana el roster y se compara por hash; nunca por registro).
      select distinct b.ord
        from b
        cross join lateral jsonb_array_elements(case when jsonb_typeof(b.r -> 'roster') = 'array' then b.r -> 'roster' else '[]'::jsonb end) e
        left join st on st.a = e ->> 'studentId'
       where e ->> 'studentId' is not null and st.a is null
    ), c as (
      select b.ord, b.r ->> 'id' as lid, lr.id is not null as in_web,
             (b.r ->> 'calendarLessonId' is null or cl.id is not null) as les_ok,
             (br.ord is null) as ros_ok
        from b
        left join public.lesson_registrations lr on lr.owner_id = p_owner and lr.legacy_mobile_id = b.r ->> 'id'
        left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = b.r ->> 'calendarLessonId'
        left join bad_roster br on br.ord = b.ord
    )
    select coalesce(jsonb_agg(
      case when c.in_web then jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'preserved', 'reason', 'el registro ya existe en la web')
           when not c.les_ok or not c.ros_ok then jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'omitted_broken_reference',
             'reason', case when not c.les_ok then 'referencia a una clase de calendario que no se importó' else 'roster con un alumno inexistente' end)
           else jsonb_build_object('legacy_mobile_id', c.lid, 'status', 'insertable') end
      order by c.ord), '[]'::jsonb)
    from c
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Componentes financieras (grafo de pagos, cobros, asignaciones, ajustes y paquetes)
-- ---------------------------------------------------------------------------------------------------------------------
-- Una componente es el conjunto de filas conectadas por referencias: se importa entera o se omite entera. Las componentes se calculan con un
-- union-find en arreglos (O(n·α)); el resto son sentencias por lote. Un destino de arista que no existe se agrega como nodo FANTASMA
-- («MISSING»): la unión SIEMPRE ocurre y la componente completa se omite (nunca se inserta un cobro sin su pago).
create or replace function public._import_classify_financial_components(
  p_owner uuid, p_payload jsonb, p_students_classified jsonb, p_training_agreements_classified jsonb,
  p_calendar_lessons_classified jsonb, p_lesson_registrations_classified jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay jsonb := public._import_arr(p_payload, 'payments');
  v_chg jsonb := public._import_arr(p_payload, 'paymentCharges');
  v_alloc jsonb := public._import_arr(p_payload, 'paymentAllocations');
  v_adj jsonb := public._import_arr(p_payload, 'paymentAdjustments');
  v_isc jsonb := public._import_arr(p_payload, 'initialPaidSurchargeCorrections');
  v_fm jsonb := public._import_arr(p_payload, 'firstMonthProrationDecisions');
  v_pk jsonb := public._import_arr(p_payload, 'packagePurchases');
  v_pm jsonb := public._import_arr(p_payload, 'packageCreditMovements');
  v_n integer;
  v_parent integer[];
  v_roots integer[];
  v_e record;
  v_a integer;
  v_b integer;
  v_i integer;
  v_result jsonb;
begin
  -- `on commit drop` sólo limpia al COMMIT real: el `drop … if exists` previo hace segura una segunda llamada en la misma transacción.
  drop table if exists _fin_nodes;
  drop table if exists _fin_edge_keys;
  drop table if exists _fin_edges;
  create temporary table _fin_nodes (
    idx integer generated always as identity, node_key text primary key, table_name text not null, legacy_id text, r jsonb,
    in_web boolean not null default false, root_idx integer, comp text
  ) on commit drop;
  create temporary table _fin_edge_keys (a text not null, b text not null, b_table text not null, b_legacy text) on commit drop;
  create temporary table _fin_edges (a_idx integer not null, b_idx integer not null) on commit drop;

  -- Nodos reales (el primero que aparece con un id gana; los repetidos se ignoran, igual que antes).
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'payments:' || (e.r ->> 'id'), 'payments', e.r ->> 'id', e.r from jsonb_array_elements(v_pay) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'payment_charges:' || (e.r ->> 'id'), 'payment_charges', e.r ->> 'id', e.r from jsonb_array_elements(v_chg) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'payment_allocations:' || (e.r ->> 'id'), 'payment_allocations', e.r ->> 'id', e.r from jsonb_array_elements(v_alloc) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'payment_adjustments:' || (e.r ->> 'id'), 'payment_adjustments', e.r ->> 'id', e.r from jsonb_array_elements(v_adj) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'initial_paid_surcharge_corrections:' || (e.r ->> 'id'), 'initial_paid_surcharge_corrections', e.r ->> 'id', e.r from jsonb_array_elements(v_isc) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'first_month_proration_decisions:' || (e.r ->> 'id'), 'first_month_proration_decisions', e.r ->> 'id', e.r from jsonb_array_elements(v_fm) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'package_purchases:' || (e.r ->> 'id'), 'package_purchases', e.r ->> 'id', e.r from jsonb_array_elements(v_pk) with ordinality as e(r, ord) order by e.ord on conflict do nothing;
  insert into _fin_nodes (node_key, table_name, legacy_id, r) select 'package_credit_movements:' || (e.r ->> 'id'), 'package_credit_movements', e.r ->> 'id', e.r from jsonb_array_elements(v_pm) with ordinality as e(r, ord) order by e.ord on conflict do nothing;

  -- Aristas (origen → destino) en el mismo orden de aparición que antes.
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'payment_allocations:' || (e.r ->> 'id'), 'payments:' || (e.r ->> 'paymentId'), 'payments', e.r ->> 'paymentId' from jsonb_array_elements(v_alloc) with ordinality as e(r, ord) order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'payment_allocations:' || (e.r ->> 'id'), 'payment_charges:' || (e.r ->> 'chargeId'), 'payment_charges', e.r ->> 'chargeId' from jsonb_array_elements(v_alloc) with ordinality as e(r, ord) order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'payment_adjustments:' || (e.r ->> 'id'), 'payment_charges:' || (e.r ->> 'chargeId'), 'payment_charges', e.r ->> 'chargeId' from jsonb_array_elements(v_adj) with ordinality as e(r, ord) order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'payments:' || (e.r ->> 'id'), 'payments:' || (e.r ->> 'replacesPaymentId'), 'payments', e.r ->> 'replacesPaymentId' from jsonb_array_elements(v_pay) with ordinality as e(r, ord) where e.r ->> 'replacesPaymentId' is not null order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'initial_paid_surcharge_corrections:' || (e.r ->> 'id'), 'payments:' || (e.r ->> 'voidedPaymentId'), 'payments', e.r ->> 'voidedPaymentId' from jsonb_array_elements(v_isc) with ordinality as e(r, ord) where e.r ->> 'voidedPaymentId' is not null order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'initial_paid_surcharge_corrections:' || (e.r ->> 'id'), 'payments:' || (e.r ->> 'newPaymentId'), 'payments', e.r ->> 'newPaymentId' from jsonb_array_elements(v_isc) with ordinality as e(r, ord) where e.r ->> 'newPaymentId' is not null order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'first_month_proration_decisions:' || (e.r ->> 'id'), 'payment_charges:' || (e.r ->> 'chargeId'), 'payment_charges', e.r ->> 'chargeId' from jsonb_array_elements(v_fm) with ordinality as e(r, ord) where e.r ->> 'chargeId' is not null order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'payment_charges:' || (e.r ->> 'id'), 'package_purchases:' || (e.r ->> 'packageId'), 'package_purchases', e.r ->> 'packageId' from jsonb_array_elements(v_chg) with ordinality as e(r, ord) where e.r ->> 'packageId' is not null order by e.ord;
  insert into _fin_edge_keys (a, b, b_table, b_legacy)
    select 'package_credit_movements:' || (e.r ->> 'id'), 'package_purchases:' || (e.r ->> 'packageId'), 'package_purchases', e.r ->> 'packageId' from jsonb_array_elements(v_pm) with ordinality as e(r, ord) order by e.ord;

  -- Nodos fantasma: destinos que no existen entre los nodos reales.
  insert into _fin_nodes (node_key, table_name, legacy_id)
    select t.b, 'MISSING', t.b_legacy from (select distinct on (k.b) k.b, k.b_legacy from _fin_edge_keys k order by k.b) t
    where not exists (select 1 from _fin_nodes n where n.node_key = t.b)
    on conflict do nothing;
  insert into _fin_edges (a_idx, b_idx)
    select na.idx, nb.idx from _fin_edge_keys k join _fin_nodes na on na.node_key = k.a join _fin_nodes nb on nb.node_key = k.b;

  -- Componentes conexas (union-find con compresión de caminos; la raíz es el menor índice de la componente).
  select coalesce(max(idx), 0) into v_n from _fin_nodes;
  v_parent := array(select generate_series(1, v_n));
  for v_e in select a_idx, b_idx from _fin_edges loop
    v_a := v_e.a_idx;
    while v_parent[v_a] <> v_a loop
      v_parent[v_a] := v_parent[v_parent[v_a]];
      v_a := v_parent[v_a];
    end loop;
    v_b := v_e.b_idx;
    while v_parent[v_b] <> v_b loop
      v_parent[v_b] := v_parent[v_parent[v_b]];
      v_b := v_parent[v_b];
    end loop;
    if v_a <> v_b then
      if v_a < v_b then v_parent[v_b] := v_a; else v_parent[v_a] := v_b; end if;
    end if;
  end loop;
  v_roots := v_parent;
  for v_i in 1 .. v_n loop
    v_a := v_i;
    while v_parent[v_a] <> v_a loop
      v_parent[v_a] := v_parent[v_parent[v_a]];
      v_a := v_parent[v_a];
    end loop;
    v_roots[v_i] := v_a;
  end loop;
  update _fin_nodes n set root_idx = u.root from unnest(v_roots) with ordinality as u(root, i) where n.idx = u.i;
  -- Identificador de la componente = la menor clave de sus nodos (mismo criterio que antes).
  update _fin_nodes n set comp = c.k from (select root_idx, min(node_key) as k from _fin_nodes group by root_idx) c where n.root_idx = c.root_idx;

  -- ¿Ya existe en la web? (una sola unión por tabla)
  update _fin_nodes n set in_web = true from public.payments t where n.table_name = 'payments' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.payment_charges t where n.table_name = 'payment_charges' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.payment_allocations t where n.table_name = 'payment_allocations' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.payment_adjustments t where n.table_name = 'payment_adjustments' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.initial_paid_surcharge_corrections t where n.table_name = 'initial_paid_surcharge_corrections' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.first_month_proration_decisions t where n.table_name = 'first_month_proration_decisions' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.package_purchases t where n.table_name = 'package_purchases' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;
  update _fin_nodes n set in_web = true from public.package_credit_movements t where n.table_name = 'package_credit_movements' and t.owner_id = p_owner and t.legacy_mobile_id = n.legacy_id;

  with st as (select distinct a from public._import_available_ids('students', p_owner, p_students_classified) a),
       ag as (select distinct a from public._import_available_ids('training_billing_agreements', p_owner, p_training_agreements_classified) a),
       lr as (select distinct a from public._import_available_ids('lesson_registrations', p_owner, p_lesson_registrations_classified) a),
       cl as (select distinct a from public._import_available_ids('calendar_lessons', p_owner, p_calendar_lessons_classified) a),
       -- Motivo de cada nodo: primero los de la fase 1 (fantasma / ya existe en la web), después los de la fase 2 (referencias sin resolver).
       nr as (
         select n.idx, n.comp, n.table_name, n.legacy_id,
                case when n.table_name = 'MISSING' then format('referencia a %s no existe ni en el backup ni en la web', n.legacy_id)
                     when n.in_web then format('%s con legacy_mobile_id %s ya existe en la web', n.table_name, n.legacy_id) end as reason1,
                case when n.table_name <> 'MISSING' and n.r ? 'studentId' and n.r ->> 'studentId' is not null and s.a is null then 'referencia a alumno inexistente'
                     when n.table_name = 'payment_charges' and n.r ->> 'trainingBillingAgreementId' is not null and a.a is null then 'referencia a acuerdo de entrenamiento inexistente'
                     when n.table_name = 'payment_charges' and n.r ->> 'savedLessonId' is not null and l.a is null then 'referencia a registro de clase inexistente'
                     when n.table_name = 'payment_charges' and n.r ->> 'calendarLessonId' is not null and c.a is null then 'referencia a clase de calendario inexistente'
                end as reason2
           from _fin_nodes n
           left join st s on s.a = n.r ->> 'studentId'
           left join ag a on a.a = n.r ->> 'trainingBillingAgreementId'
           left join lr l on l.a = n.r ->> 'savedLessonId'
           left join cl c on c.a = n.r ->> 'calendarLessonId'
       ), comp as (
         select nr.comp,
                (array_agg(nr.reason1 order by nr.idx) filter (where nr.reason1 is not null))[1] as r1,
                (array_agg(nr.reason2 order by nr.idx) filter (where nr.reason2 is not null))[1] as r2,
                coalesce(jsonb_agg(jsonb_build_object('table_name', nr.table_name, 'legacy_mobile_id', nr.legacy_id) order by nr.idx) filter (where nr.table_name <> 'MISSING'), '[]'::jsonb) as members
           from nr group by nr.comp
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'component_id', comp.comp, 'members', comp.members,
           'status', case when comp.r1 is null and comp.r2 is null then 'insertable' else 'omitted' end,
           'reason', coalesce(comp.r1, comp.r2)) order by comp.comp), '[]'::jsonb)
    into v_result from comp;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Proyección de cuotas (R3): rechaza ANTES de guardar la vista previa lo que de todas formas se frenaría al aplicar
-- ---------------------------------------------------------------------------------------------------------------------
-- Sólo las categorías cuyo conteo es EXACTO (filas principales que se insertarán); las anidadas siguen protegidas por los disparadores de la
-- aplicación. Mismo error que el disparador (`quota_exceeded`, SQLSTATE 53400, detalle = categoría): la web ya lo traduce a un texto claro.
create or replace function public._import_project_quotas(p_owner uuid, p_classification jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_current bigint;
  v_max integer;
begin
  for v_row in
    select t.quota_key, t.planned from (
      select 'students' as quota_key, public._import_len(p_classification -> 'maestros' -> 'students' -> 'inserts') as planned
      union all select 'custom_levels', public._import_len(p_classification -> 'maestros' -> 'custom_levels' -> 'inserts')
      union all select 'training_billing_agreements', public._import_len(p_classification -> 'insert_only' -> 'training_billing_agreements' -> 'inserts')
      union all select 'student_level_history', public._import_len(p_classification -> 'insert_only' -> 'student_level_history' -> 'inserts')
      union all select 'recurrence_rules', count(*)::int from jsonb_array_elements(p_classification -> 'aggregates' -> 'recurrence_rules') e where e ->> 'status' = 'insertable'
      union all select 'calendar_lessons', count(*)::int from jsonb_array_elements(p_classification -> 'aggregates' -> 'calendar_lessons') e where e ->> 'status' = 'insertable'
      union all select 'lesson_registrations', count(*)::int from jsonb_array_elements(p_classification -> 'aggregates' -> 'lesson_registrations') e where e ->> 'status' = 'insertable'
      union all
      select m ->> 'table_name', count(*)::int
        from jsonb_array_elements(p_classification -> 'aggregates' -> 'financial_components') c
        cross join lateral jsonb_array_elements(c -> 'members') m
       where c ->> 'status' = 'insertable'
       group by m ->> 'table_name'
    ) t
    where t.planned > 0
  loop
    select coalesce(o.max_total, d.max_total) into v_max
      from public.quota_defaults d
      left join public.account_quota_overrides o on o.owner_id = p_owner and o.quota_key = d.quota_key
     where d.quota_key = v_row.quota_key;
    if v_max is null then continue; end if;
    execute format('select count(*) from public.%I where owner_id = $1', v_row.quota_key) into v_current using p_owner;
    if v_current + v_row.planned > v_max then
      raise exception 'quota_exceeded' using errcode = '53400', detail = v_row.quota_key;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Vista previa de la importación (misma firma, mismo resultado)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.preview_backup_import(p_payload jsonb, p_excluded_collections jsonb)
returns table(preview_id uuid, expires_at timestamptz, summary jsonb, classification jsonb, excluded_collections jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_size_bytes int;
  v_students jsonb; v_custom_levels jsonb;
  v_teacher_profile jsonb; v_budget jsonb; v_availability jsonb;
  v_training_agreements jsonb; v_level_history jsonb; v_surcharge jsonb;
  v_recurrence jsonb; v_calendar jsonb; v_lesson_registrations jsonb;
  v_financial jsonb;
  v_classification jsonb;
  v_preview_id uuid;
  v_checksum text;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  -- 1) Rechazo ANTES de procesar: tamaño, forma y cantidad de filas (límites en `_import_limits`). Nada se escribe si se rechaza.
  v_size_bytes := pg_column_size(p_payload);
  if v_size_bytes > (public._import_limits() ->> 'max_payload_bytes')::int then
    raise exception 'El backup supera el tamaño máximo permitido.';
  end if;
  perform public._import_check_payload(p_payload);

  -- Limpieza perezosa de previews propios PENDIENTES vencidos (>24h) — nunca de otra cuenta. Nunca de un preview 'applied': `import_runs.preview_id`
  -- lo referencia sin cascada a propósito (retención real del run).
  delete from public.import_previews as ip
    where ip.owner_id = v_owner and ip.status = 'pending' and ip.expires_at < now() - interval '24 hours';

  -- 2) Clasificación por lotes (sin ningún lock de cuenta: es sólo lectura de datos de negocio).
  v_students := public._import_classify_students(v_owner, p_payload);
  v_custom_levels := public._import_classify_custom_levels(v_owner, p_payload);
  v_teacher_profile := public._classify_singleton('teacher_profiles', v_owner, p_payload -> 'teacherProfile');
  v_budget := public._classify_singleton('budget_distribution_settings', v_owner, p_payload -> 'budgetDistribution');
  v_availability := public._classify_singleton('teacher_availability', v_owner, p_payload -> 'teacherAvailability');
  v_training_agreements := public._import_classify_insert_only('training_billing_agreements', v_owner, p_payload -> 'trainingBillingAgreements');
  v_level_history := public._import_classify_insert_only('student_level_history', v_owner, (
    select coalesce(jsonb_agg(jsonb_build_object('id', entry ->> 'id', 'studentId', key)), '[]'::jsonb)
      from jsonb_each(case when jsonb_typeof(p_payload -> 'profiles') = 'object' then p_payload -> 'profiles' else '{}'::jsonb end) as p(key, profile)
      cross join lateral jsonb_array_elements(case when jsonb_typeof(profile -> 'levelHistory') = 'array' then profile -> 'levelHistory' else '[]'::jsonb end) as entry
      where entry ->> 'id' is not null
  ));
  v_surcharge := public._classify_singleton('surcharge_settings', v_owner, p_payload -> 'surchargeSettings' -> 'current');

  v_recurrence := public._import_classify_recurrence_rules(v_owner, p_payload, v_students);
  v_calendar := public._import_classify_calendar_lessons(v_owner, p_payload, v_students);
  v_lesson_registrations := public._import_classify_lesson_registrations(v_owner, p_payload, v_students);
  v_financial := public._import_classify_financial_components(v_owner, p_payload, v_students, v_training_agreements, v_calendar, v_lesson_registrations);

  v_classification := jsonb_build_object(
    'maestros', jsonb_build_object(
      'students', v_students,
      'custom_levels', v_custom_levels,
      'teacher_profiles', v_teacher_profile,
      'budget_distribution_settings', v_budget,
      'teacher_availability', v_availability
    ),
    'insert_only', jsonb_build_object(
      'training_billing_agreements', v_training_agreements,
      'student_level_history', v_level_history,
      'surcharge_settings', v_surcharge
    ),
    'aggregates', jsonb_build_object(
      'recurrence_rules', v_recurrence,
      'calendar_lessons', v_calendar,
      'lesson_registrations', v_lesson_registrations,
      'financial_components', v_financial
    )
  );

  -- 3) Lo que se va a AGREGAR no puede repetir identificadores (antes terminaba en «ya existe» al confirmar, con todo el trabajo hecho).
  if exists (
    select 1 from (
      select e ->> 'legacy_mobile_id' as lid, 'a' as grp from jsonb_array_elements(v_students -> 'inserts') e
      union all select e ->> 'backup_legacy_mobile_id', 'a' from jsonb_array_elements(v_students -> 'duplicates') e
      union all select e ->> 'legacy_mobile_id', 'b' from jsonb_array_elements(v_custom_levels -> 'inserts') e
      union all select e ->> 'legacy_mobile_id', 'c' from jsonb_array_elements(v_training_agreements -> 'inserts') e
      union all select e ->> 'legacy_mobile_id', 'd' from jsonb_array_elements(v_level_history -> 'inserts') e
      union all select e ->> 'legacy_mobile_id', 'e' from jsonb_array_elements(v_recurrence) e where e ->> 'status' = 'insertable'
      union all select e ->> 'legacy_mobile_id', 'f' from jsonb_array_elements(v_calendar) e where e ->> 'status' = 'insertable'
      union all select e ->> 'legacy_mobile_id', 'g' from jsonb_array_elements(v_lesson_registrations) e where e ->> 'status' = 'insertable'
    ) t group by t.grp, t.lid having count(*) > 1
  ) then
    raise exception 'El backup tiene datos repetidos.' using errcode = '22023';
  end if;

  -- 4) Cuotas de la cuenta (R3): si de todas formas se frenaría al aplicar, se avisa ahora y no se guarda nada.
  perform public._import_project_quotas(v_owner, v_classification);

  v_checksum := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.import_previews (owner_id, backup_checksum, schema_version, app_version, normalized_payload, classification, excluded_collections)
    values (v_owner, v_checksum, coalesce((p_payload ->> 'schemaVersion')::int, 2), p_payload ->> 'appVersion', p_payload, v_classification, coalesce(p_excluded_collections, '{}'::jsonb))
    returning id into v_preview_id;

  -- Huellas de todas las filas YA EXISTENTES matched (maestros con override real) — por lote, una consulta por tabla.
  insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
    select v_preview_id, 'students', s.id, public._fingerprint_canonical('students', to_jsonb(s))
      from public.students s
      join (select distinct (e ->> 'row_id')::uuid as rid from jsonb_array_elements(coalesce(v_students -> 'equal', '[]'::jsonb) || coalesce(v_students -> 'conflicts', '[]'::jsonb)) e) x on x.rid = s.id
     where s.owner_id = v_owner;
  insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
    select v_preview_id, 'custom_levels', c.id, public._fingerprint_canonical('custom_levels', to_jsonb(c))
      from public.custom_levels c
      join (select distinct (e ->> 'row_id')::uuid as rid from jsonb_array_elements(coalesce(v_custom_levels -> 'equal', '[]'::jsonb) || coalesce(v_custom_levels -> 'conflicts', '[]'::jsonb)) e) x on x.rid = c.id
     where c.owner_id = v_owner;
  if v_teacher_profile ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_profiles', v_owner, public._fingerprint_row('teacher_profiles', v_owner, v_owner));
  end if;
  if v_budget ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'budget_distribution_settings', v_owner, public._fingerprint_row('budget_distribution_settings', v_owner, v_owner));
  end if;
  if v_availability ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_availability', v_owner, public._fingerprint_row('teacher_availability', v_owner, v_owner));
  end if;

  insert into public.import_preview_duplicate_candidates (preview_id, backup_legacy_mobile_id, candidate_student_id, match_signals, candidate_fingerprint, field_diff)
    select v_preview_id, d ->> 'backup_legacy_mobile_id', (d ->> 'candidate_student_id')::uuid,
           array(select jsonb_array_elements_text(d -> 'match_signals')), d ->> 'candidate_fingerprint', d -> 'field_diff'
      from jsonb_array_elements(coalesce(v_students -> 'duplicates', '[]'::jsonb)) d;

  return query
    select v_preview_id, ip.expires_at,
      jsonb_build_object(
        'students', jsonb_build_object(
          'inserts', jsonb_array_length(v_students -> 'inserts'), 'equal', jsonb_array_length(v_students -> 'equal'),
          'conflicts', jsonb_array_length(v_students -> 'conflicts'), 'possible_duplicates', jsonb_array_length(v_students -> 'duplicates')
        )
      ),
      v_classification, coalesce(p_excluded_collections, '{}'::jsonb)
    from public.import_previews ip where ip.id = v_preview_id;
end;
$$;

revoke all on function public._import_classify_students(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_custom_levels(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_insert_only(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_recurrence_rules(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_calendar_lessons(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_lesson_registrations(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._import_classify_financial_components(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._import_project_quotas(uuid, jsonb) from public, anon, authenticated;
