-- TeacherFlow Web — pruebas pgTAP de las RPC de registro de clases (Fase 4)
-- contra referencias cruzadas de propietario, mismo criterio que
-- `calendar_rpc_ownership_test.sql` (Fase 3). Mismo aviso: este entorno no
-- tiene Docker ni el CLI de Supabase — nunca corrió contra una base real
-- todavía. Listo para `supabase test db` una vez aplicada la migración
-- `20260921120000_lesson_registration_rpcs.sql`.

begin;
select plan(10);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('f0000000-0000-0000-0000-000000000001', 'qa-lr-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000002', 'qa-lr-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Alumno QA LR 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'Alumno QA LR 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring)
values (
  'f2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001', 'Alumno QA LR 1', 'B1', 'individual',
  '2026-09-20T21:00:00Z', '2026-09-20T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false
);

-- ---------------------------------------------------------------------------
-- start_lesson_registration
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', 'f2000000-0000-0000-0000-000000000001',
       'primary_student_id', 'f1000000-0000-0000-0000-000000000002',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'activity_kind', 'class', 'counts_as_class', true,
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000002', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'P0002',
  null,
  'start_lesson_registration rechaza un participante ajeno'
);

select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', 'f2000000-0000-0000-0000-000000000001',
       'primary_student_id', 'f1000000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'activity_kind', 'class', 'counts_as_class', true,
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000002', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'P0002',
  null,
  'start_lesson_registration rechaza un participante ajeno en la lista de participantes aunque el principal sea propio'
);

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', 'f2000000-0000-0000-0000-000000000001',
       'primary_student_id', 'f1000000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'activity_kind', 'class', 'counts_as_class', true,
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'start_lesson_registration con datos propios funciona'
);

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', 'f2000000-0000-0000-0000-000000000001',
       'primary_student_id', 'f1000000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'activity_kind', 'class', 'counts_as_class', true,
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'start_lesson_registration es idempotente — reintentar con el mismo calendar_lesson_id nunca falla ni duplica'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001'),
  1,
  'el doble toque de start_lesson_registration nunca duplica el encabezado del registro'
);

-- ---------------------------------------------------------------------------
-- save_participant_registration — alumno ajeno al registro (aunque exista, si no es del roster de ESTE registro se rechaza)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001'),
       'student_id', 'f1000000-0000-0000-0000-000000000002',
       'participant_status', 'completed',
       'homework_reviews', '[]'::jsonb
     )) $$,
  'P0002',
  null,
  'save_participant_registration rechaza un alumno que no forma parte del roster de este registro'
);

select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001'),
       'student_id', 'f1000000-0000-0000-0000-000000000001',
       'participant_status', 'completed',
       'attendance', jsonb_build_object('status', 'presente'),
       'homework_reviews', '[]'::jsonb
     )) $$,
  'save_participant_registration con el alumno real del roster funciona'
);

-- ---------------------------------------------------------------------------
-- finalize_lesson_registration — otro usuario nunca puede finalizar un registro ajeno
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001')
     )) $$,
  'P0002',
  null,
  'finalize_lesson_registration rechaza un registro de otro usuario'
);

set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001')
     )) $$,
  'finalize_lesson_registration funciona cuando todos los participantes están completed'
);

select lives_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001')
     )) $$,
  'finalize_lesson_registration es idempotente — reintentar sobre un registro ya completed nunca falla ni lo duplica'
);

select * from finish();
rollback;
