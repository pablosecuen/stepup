-- Rollback de R12: vuelve al invariante de R6 (suma TODAS las asignaciones de un cobro, también las de pagos anulados).

create or replace function public._import_validate_invariants(p_run_id uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Una sola pasada por las instantáneas de la corrida (antes cada regla las recorría de nuevo y releía el JSON de cada fila).
  drop table if exists _iv_snap;
  create temporary table _iv_snap on commit drop as
    select s.table_name, s.row_id, s.action, (s.new_row ->> 'amount') as amount_txt, (s.new_row ->> 'student_id') as student_txt,
           (s.new_row ->> 'charge_type') as charge_type, (s.new_row ->> 'package_id') as package_id, (s.new_row ->> 'legacy_mobile_id') as legacy_id
      from public.import_run_row_snapshots s where s.import_run_id = p_run_id;
  create index on _iv_snap (table_name, row_id);

  if exists (select 1 from _iv_snap s where s.amount_txt is not null and s.amount_txt::numeric < 0) then
    raise exception 'Invariante violada: una fila importada tiene un importe negativo.';
  end if;

  if exists (
    select 1 from public.payments p
      join _iv_snap s on s.table_name = 'payments' and s.row_id = p.id
      left join public.payment_allocations pa on pa.payment_id = p.id
     where p.owner_id = p_owner
     group by p.id, p.amount
    having coalesce(sum(pa.amount), 0) > p.amount
  ) then
    raise exception 'Invariante violada: las asignaciones de un pago superan su importe.';
  end if;

  if exists (
    select 1 from public.payment_charges c
      join _iv_snap s on s.table_name = 'payment_charges' and s.row_id = c.id
      left join public.payment_allocations pa on pa.charge_id = c.id
     where c.owner_id = p_owner
     group by c.id, c.original_amount
    having coalesce(sum(pa.amount), 0) > c.original_amount
  ) then
    raise exception 'Invariante violada: las asignaciones de un cargo superan su importe original.';
  end if;

  -- Asume `movement_type='consumo'` cuenta clases consumidas como cantidad positiva en `amount` — mismo criterio que el motor de paquetes existente.
  if exists (
    select 1 from public.package_purchases pp
      join _iv_snap s on s.table_name = 'package_purchases' and s.row_id = pp.id
      left join public.package_credit_movements m on m.package_id = pp.id
     where pp.owner_id = p_owner
     group by pp.id, pp.included_classes
    having coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) > pp.included_classes
  ) then
    raise exception 'Invariante violada: un paquete tiene más clases consumidas que incluidas.';
  end if;

  -- (EXCEPT en lugar de un anti-join: con las filas recién insertadas aún sin estadísticas el planificador elegía un lazo anidado de ~770.000 comparaciones.)
  if exists (
    select s.student_txt::uuid from _iv_snap s
     where s.table_name in ('recurrence_rule_participants','calendar_lesson_participants','lesson_registration_students','lesson_registration_attendance','lesson_registration_evaluations','lesson_registration_homework_reviews')
       and s.student_txt is not null
    except
    select st.id from public.students st where st.owner_id = p_owner
  ) then
    raise exception 'Invariante violada: un participante referencia un alumno de otro owner.';
  end if;

  if exists (
    select 1 from _iv_snap s where s.table_name = 'payment_charges' and s.action = 'inserted' and s.charge_type = 'paquete' and s.package_id is null
  ) then
    raise exception 'Invariante violada: un cargo de tipo paquete quedó sin compra asociada.';
  end if;

  -- Toda decisión de duplicado aceptada debe haberse materializado realmente (`skip` es, a propósito, un no-op) — comprobación por lote.
  if exists (
    select 1 from public.import_runs ir
      cross join lateral jsonb_to_recordset(coalesce(ir.duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
      left join _iv_snap s on s.table_name = 'students' and s.action = 'inserted' and s.legacy_id = x.backup_legacy_mobile_id
     where ir.id = p_run_id and x.decision = 'create_separate' and s.row_id is null
  ) then
    raise exception 'Invariante violada: una decisión «crear aparte» no se materializó.';
  end if;
  if exists (
    select 1 from public.import_runs ir
      cross join lateral jsonb_to_recordset(coalesce(ir.duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
      left join _iv_snap s on s.table_name = 'students' and s.action = 'identity_linked' and s.row_id = x.candidate_student_id
     where ir.id = p_run_id and x.decision = 'link' and s.row_id is null
  ) then
    raise exception 'Invariante violada: una decisión «vincular» no se materializó.';
  end if;
end;
$$;

revoke all on function public._import_validate_invariants(uuid, uuid) from public, anon, authenticated;
