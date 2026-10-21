-- R16 — Carga de la lista de alumnos de PRUEBA confirmados. SÓLO se ejecuta después de que la usuaria confirme la lista. No borra ni modifica datos: únicamente inserta filas en
-- `public.test_data_exclusions`. Idempotente (no duplica un alumno ya marcado y vigente). Todo o nada: si CUALQUIER verificación falla, no se escribe nada.
--
-- Verificaciones previas (todas deben cumplirse):
--   1. Los 6 alumnos existen con ese id y ese nombre y NO tienen id de origen (no vinieron del teléfono).
--   2. Ningún otro alumno comparte con ellos una serie, una clase ni un registro (nada «mixto»).
--   3. No tienen cobros vigentes ni pagos vigentes (todos anulados), para no ocultar dinero real.
--   4. Ninguno aparece como participante de filas importadas del origen.

do $r16$
declare
  v_ids uuid[] := array[
    '900fa18b-deba-437a-a521-d5d34526847f',  -- QA Alumno Editado
    '48cf7afc-2eb4-485b-a6e7-e0a6778f35f9',  -- QA Alumno Dos
    '2a31eb0f-19ce-465a-9e2a-07820bc24f6b',  -- PRUEBA WEB F5 Mensual
    'f3888fe5-65fb-4309-be71-60a170fd4d8e',  -- PRUEBA WEB F5 Entrenamiento
    '90f8125b-7a21-42e1-97b9-29654bfce199',  -- PRUEBA WEB FECHA Alumno
    '92fc1a5d-f696-43f9-8122-91b357146331'   -- PRUEBA WEB F6 Mensual
  ]::uuid[];
  v_found int;
  v_bad int;
  v_owner uuid;
begin
  select count(*), min(owner_id::text)::uuid into v_found, v_owner
    from public.students
   where id = any (v_ids) and legacy_mobile_id is null and (name like 'QA %' or name like 'PRUEBA WEB %');
  if v_found <> 6 then raise exception 'R16: se esperaban 6 alumnos de prueba sin id de origen y se encontraron %', v_found; end if;
  if (select count(distinct owner_id) from public.students where id = any (v_ids)) <> 1 then raise exception 'R16: los alumnos pertenecen a más de una cuenta'; end if;

  -- 2) Nada compartido con alumnos que no están en la lista.
  select count(*) into v_bad from (
    select rp.recurrence_rule_id from public.recurrence_rule_participants rp
     where rp.recurrence_rule_id in (select recurrence_rule_id from public.recurrence_rule_participants where student_id = any (v_ids))
       and rp.student_id <> all (v_ids)
    union all
    select lp.calendar_lesson_id from public.calendar_lesson_participants lp
     where lp.calendar_lesson_id in (select calendar_lesson_id from public.calendar_lesson_participants where student_id = any (v_ids))
       and lp.student_id <> all (v_ids)
    union all
    select rs.lesson_registration_id from public.lesson_registration_students rs
     where rs.lesson_registration_id in (select lesson_registration_id from public.lesson_registration_students where student_id = any (v_ids))
       and rs.student_id <> all (v_ids)
    union all
    select r.id from public.recurrence_rules r where r.primary_student_id = any (v_ids) and exists (select 1 from public.recurrence_rule_participants p where p.recurrence_rule_id = r.id and p.student_id <> all (v_ids))
    union all
    select l.id from public.calendar_lessons l where l.primary_student_id = any (v_ids) and exists (select 1 from public.calendar_lesson_participants p where p.calendar_lesson_id = l.id and p.student_id <> all (v_ids))
  ) x;
  if v_bad <> 0 then raise exception 'R16: % filas comparten participantes con alumnos que no son de prueba', v_bad; end if;

  -- 3) Nada de dinero vigente.
  select count(*) into v_bad from (
    select id from public.payment_charges where student_id = any (v_ids) and voided_at is null
    union all
    select id from public.payments where student_id = any (v_ids) and voided_at is null
  ) y;
  if v_bad <> 0 then raise exception 'R16: hay % cobros o pagos vigentes de alumnos de prueba', v_bad; end if;

  -- 4) Ninguna fila importada del origen involucra a estos alumnos.
  select count(*) into v_bad from (
    select id from public.calendar_lessons where legacy_mobile_id is not null and primary_student_id = any (v_ids)
    union all
    select id from public.recurrence_rules where legacy_mobile_id is not null and primary_student_id = any (v_ids)
    union all
    select r.id from public.lesson_registrations r join public.lesson_registration_students s on s.lesson_registration_id = r.id where r.legacy_mobile_id is not null and s.student_id = any (v_ids)
    union all
    select id from public.payment_charges where legacy_mobile_id is not null and student_id = any (v_ids)
  ) z;
  if v_bad <> 0 then raise exception 'R16: % filas importadas del origen involucran a alumnos de prueba', v_bad; end if;

  insert into public.test_data_exclusions (owner_id, student_id, reason, evidence)
  select s.owner_id, s.id, 'r16-qa: alumno de prueba confirmado por la usuaria',
         jsonb_build_object('nombre', s.name, 'creado', s.created_at, 'sin_id_de_origen', true, 'confirmado', 'lista revisada por la usuaria antes de cargar')
    from public.students s
   where s.id = any (v_ids)
     and not exists (select 1 from public.test_data_exclusions e where e.student_id = s.id and e.revoked_at is null);
end
$r16$;
