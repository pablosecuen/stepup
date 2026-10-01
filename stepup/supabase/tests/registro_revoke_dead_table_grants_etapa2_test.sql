-- TeacherFlow Web — Fase 10, Registro Etapa 2: pruebas reales contra la
-- migración PENDIENTE `20261001130000_registro_revoke_dead_table_grants_etapa2.sql`
-- (revoca INSERT/UPDATE directo en lesson_registrations + 4 hijas).
-- Mismo procedimiento transaccional descartable — ROLLBACK al final.

begin;
select plan(17);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('e2000000-0000-0000-0000-000000000001', 'qa-registro-etapa2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('e2100000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'E2 Alumno', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- ---------------------------------------------------------------------------
-- 1-10) Escritura directa bloqueada: INSERT y UPDATE en las 5 tablas.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "e2000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.lesson_registrations (owner_id, status) values ('e2000000-0000-0000-0000-000000000001', 'in_progress') $$,
  '42501', null, 'lesson_registrations: INSERT directo bloqueado'
);
select throws_ok(
  $$ update public.lesson_registrations set status = 'completed' where owner_id = 'e2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'lesson_registrations: UPDATE directo bloqueado'
);
select throws_ok(
  $$ insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id) values ('e2000000-0000-0000-0000-000000000001', gen_random_uuid(), 'e2100000-0000-0000-0000-000000000001') $$,
  '42501', null, 'lesson_registration_students: INSERT directo bloqueado'
);
select throws_ok(
  $$ update public.lesson_registration_students set participant_status = 'completed' where owner_id = 'e2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'lesson_registration_students: UPDATE directo bloqueado'
);
select throws_ok(
  $$ insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status) values ('e2000000-0000-0000-0000-000000000001', gen_random_uuid(), 'e2100000-0000-0000-0000-000000000001', 'presente') $$,
  '42501', null, 'lesson_registration_attendance: INSERT directo bloqueado'
);
select throws_ok(
  $$ update public.lesson_registration_attendance set status = 'tarde' where owner_id = 'e2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'lesson_registration_attendance: UPDATE directo bloqueado'
);
select throws_ok(
  $$ insert into public.lesson_registration_evaluations (owner_id, lesson_registration_id, student_id) values ('e2000000-0000-0000-0000-000000000001', gen_random_uuid(), 'e2100000-0000-0000-0000-000000000001') $$,
  '42501', null, 'lesson_registration_evaluations: INSERT directo bloqueado'
);
select throws_ok(
  $$ update public.lesson_registration_evaluations set general_grade = 10 where owner_id = 'e2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'lesson_registration_evaluations: UPDATE directo bloqueado'
);
select throws_ok(
  $$ insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome) values ('e2000000-0000-0000-0000-000000000001', gen_random_uuid(), 'e2100000-0000-0000-0000-000000000001', 'x', 'realizada') $$,
  '42501', null, 'lesson_registration_homework_reviews: INSERT directo bloqueado'
);
select throws_ok(
  $$ update public.lesson_registration_homework_reviews set outcome = 'parcial' where owner_id = 'e2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'lesson_registration_homework_reviews: UPDATE directo bloqueado'
);

-- DELETE ya estaba revocado desde la Remediación A — se re-confirma acá.
select throws_ok(
  $$ delete from public.lesson_registrations where owner_id = 'e2000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'lesson_registrations: DELETE directo sigue bloqueado (Remediación A, sin cambios)'
);

-- ---------------------------------------------------------------------------
-- 12-15) RPC legítimas (SECURITY DEFINER) siguen funcionando de punta a
-- punta pese a cero grants directos de tabla.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'operation_id', 'e2300000-0000-0000-0000-000000000001',
       'primary_student_id', 'e2100000-0000-0000-0000-000000000001',
       'student_name', 'E2 Alumno', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'e2100000-0000-0000-0000-000000000001', 'student_name', 'E2 Alumno', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'start_lesson_registration (SECURITY DEFINER) sigue funcionando sin ningún grant directo de tabla'
);
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where owner_id = 'e2000000-0000-0000-0000-000000000001' and operation_id = 'e2300000-0000-0000-0000-000000000001'),
       'student_id', 'e2100000-0000-0000-0000-000000000001', 'participant_status', 'completed',
       'attendance', jsonb_build_object('status', 'presente')
     )) $$,
  'save_participant_registration (SECURITY DEFINER) sigue funcionando sin ningún grant directo de tabla'
);
select lives_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where owner_id = 'e2000000-0000-0000-0000-000000000001' and operation_id = 'e2300000-0000-0000-0000-000000000001')
     )) $$,
  'finalize_lesson_registration (SECURITY DEFINER) sigue funcionando sin ningún grant directo de tabla'
);
select lives_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where owner_id = 'e2000000-0000-0000-0000-000000000001' and operation_id = 'e2300000-0000-0000-0000-000000000001'),
       'edit_operation_id', 'e2400000-0000-0000-0000-000000000001',
       'participants', '[]'::jsonb
     )) $$,
  'edit_completed_lesson_registration (SECURITY DEFINER, ya existía) sigue funcionando sin ningún grant directo de tabla'
);

-- ---------------------------------------------------------------------------
-- 16-17) Importación/undo (SECURITY DEFINER) sigue funcionando: inserta un
-- lesson_registration vía el motor de import, lo deshace vía undo.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, activity_kind) values
  ('e2500000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e2100000-0000-0000-0000-000000000001', 'E2 Alumno', 'B1', 'individual', '2026-10-06T21:00:00Z', '2026-10-06T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', 'class');
insert into public.lesson_registrations (id, owner_id, calendar_lesson_id, status) values
  ('e2600000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000001', 'in_progress');
insert into public.import_previews (id, owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status)
values ('e2700000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'qa-e2-checksum', 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'applied');
insert into public.import_runs (id, owner_id, preview_id, status, backup_checksum, schema_version, summary, field_overrides, duplicate_decisions)
values ('e2800000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000001', 'applied', 'qa-e2-checksum', 1, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
select 'e2800000-0000-0000-0000-000000000001', 'lesson_registrations', 'e2600000-0000-0000-0000-000000000001', 'inserted', null, to_jsonb(lr)
from public.lesson_registrations lr where lr.id = 'e2600000-0000-0000-0000-000000000001';
insert into public.import_undo_previews (id, import_run_id, owner_id, is_safe, unsafe_rows, status)
values ('e2900000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', true, '[]'::jsonb, 'pending');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "e2000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.apply_undo_backup_import('e2900000-0000-0000-0000-000000000001') $$,
  'apply_undo_backup_import (SECURITY DEFINER) sigue deshaciendo un lesson_registrations importado, sin ningún grant directo de tabla'
);
set local role postgres;
select is(
  (select count(*)::int from public.lesson_registrations where id = 'e2600000-0000-0000-0000-000000000001'),
  0,
  'el undo realmente borró el lesson_registrations importado'
);

select * from finish();
rollback;
