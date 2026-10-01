-- TeacherFlow Web — pgTAP real, contra la migración PENDIENTE
-- `20260930100000_fix_start_lesson_registration_virtual_series_gate.sql`.
-- Mismo procedimiento transaccional descartable de siempre — BEGIN con
-- pgtap instalado dentro de la transacción, ROLLBACK siempre al final.
--
-- Bug corregido: `start_lesson_registration` rechazaba con "operation_id
-- es obligatorio para un registro ad-hoc" cualquier primer registro de
-- una ocurrencia de serie (individual o grupal) todavía virtual — el
-- chequeo de operation_id corría antes de reconocer que recurrence_id +
-- occurrence_key ya identifican una ocurrencia real de serie, no un
-- registro ad-hoc. Encontrado durante el E2E real de archivado/poda con
-- la cuenta QA, ajeno a esa función.

begin;
select plan(30);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('59000000-0000-0000-0000-000000000001', 'qa-registration-gate-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('59000000-0000-0000-0000-000000000002', 'qa-registration-gate-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;

insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('59100000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', 'SI Individual Virtual', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('59100000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', 'GP Primario Grupal', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('59100000-0000-0000-0000-000000000003', '59000000-0000-0000-0000-000000000001', 'GS1 Secundario Grupal', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('59100000-0000-0000-0000-000000000004', '59000000-0000-0000-0000-000000000001', 'GS2 Secundario Grupal', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('59100000-0000-0000-0000-000000000005', '59000000-0000-0000-0000-000000000001', 'AH Adhoc', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('59100000-0000-0000-0000-000000000006', '59000000-0000-0000-0000-000000000001', 'YA Materializada', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('59100000-0000-0000-0000-000000000007', '59000000-0000-0000-0000-000000000001', 'MOD Invalida', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('59100000-0000-0000-0000-000000000099', '59000000-0000-0000-0000-000000000002', 'Alumno De Otro Owner', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('59300000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-000000000001', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('59300000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-000000000002', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('59300000-0000-0000-0000-000000000003', '59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-000000000006', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('59300000-0000-0000-0000-000000000004', '59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-000000000007', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('59300000-0000-0000-0000-000000000098', '59000000-0000-0000-0000-000000000002', '59100000-0000-0000-0000-000000000099', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active');

-- Roster inclusivo real: el primario se lista también como participante (contrato confirmado 2026-09-30).
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('59000000-0000-0000-0000-000000000001', '59300000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-000000000001'),
  ('59000000-0000-0000-0000-000000000001', '59300000-0000-0000-0000-000000000002', '59100000-0000-0000-0000-000000000002'),
  ('59000000-0000-0000-0000-000000000001', '59300000-0000-0000-0000-000000000002', '59100000-0000-0000-0000-000000000003'),
  ('59000000-0000-0000-0000-000000000001', '59300000-0000-0000-0000-000000000002', '59100000-0000-0000-0000-000000000004'),
  ('59000000-0000-0000-0000-000000000001', '59300000-0000-0000-0000-000000000003', '59100000-0000-0000-0000-000000000006'),
  ('59000000-0000-0000-0000-000000000001', '59300000-0000-0000-0000-000000000004', '59100000-0000-0000-0000-000000000007'),
  ('59000000-0000-0000-0000-000000000002', '59300000-0000-0000-0000-000000000098', '59100000-0000-0000-0000-000000000099');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "59000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 1) Ocurrencia virtual INDIVIDUAL, sin operation_id -> funciona (antes rechazaba).
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'recurrence_id', '59300000-0000-0000-0000-000000000001',
       'occurrence_key', '59300000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0',
       'recurrence_index', 0,
       'primary_student_id', '59100000-0000-0000-0000-000000000001',
       'student_name', 'SI Individual Virtual', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'SI Individual Virtual', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'ocurrencia virtual individual, sin operation_id, funciona (bug corregido)'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lessons where recurrence_id = '59300000-0000-0000-0000-000000000001'), 1, 'se materializó exactamente 1 calendar_lesson');
select is((select count(*)::int from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000001'), 1, 'se creó exactamente 1 lesson_registration');

-- 2) Ocurrencia virtual GRUPAL, sin operation_id -> funciona con roster inclusivo completo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "59000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'recurrence_id', '59300000-0000-0000-0000-000000000002',
       'occurrence_key', '59300000-0000-0000-0000-000000000002:w0:c0:d0:t1800:s0',
       'recurrence_index', 0,
       'primary_student_id', '59100000-0000-0000-0000-000000000002',
       'student_name', 'GP Primario Grupal', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000002', 'student_name', 'GP Primario Grupal', 'level', 'B1'),
         jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000003', 'student_name', 'GS1 Secundario Grupal', 'level', 'B1'),
         jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000004', 'student_name', 'GS2 Secundario Grupal', 'level', 'B1')
       ),
       'outcome', 'clase_dictada'
     )) $$,
  'ocurrencia virtual GRUPAL, sin operation_id, funciona'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lesson_participants clp join public.calendar_lessons cl on cl.id = clp.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002'), 3, 'roster inclusivo completo: 3 participantes materializados (primario incluido)');
select is((select count(*)::int from public.calendar_lesson_participants clp join public.calendar_lessons cl on cl.id = clp.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002' and clp.student_id = '59100000-0000-0000-0000-000000000002'), 1, 'el primario (GP) aparece correctamente en calendar_lesson_participants');
select is((select count(*)::int from public.lesson_registration_students lrs join public.lesson_registrations lr on lr.id = lrs.lesson_registration_id join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002' and lrs.student_id = '59100000-0000-0000-0000-000000000002'), 1, 'el primario (GP) aparece correctamente en el registro (lesson_registration_students)');

-- 3) Ad-hoc sin operation_id -> sigue rechazado.
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', null, 'occurrence_key', null,
       'primary_student_id', '59100000-0000-0000-0000-000000000005',
       'student_name', 'AH Adhoc', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-06T21:00:00Z', 'end_at', '2026-10-06T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000005', 'student_name', 'AH Adhoc', 'level', 'B1')),
       'outcome', 'clase_dictada', 'operation_id', null
     )) $$,
  '22023', null,
  'ad-hoc SIN operation_id sigue rechazado'
);

-- 4) Ad-hoc con operation_id -> funciona; reintentar con el MISMO operation_id no duplica.
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', null, 'occurrence_key', null,
       'primary_student_id', '59100000-0000-0000-0000-000000000005',
       'student_name', 'AH Adhoc', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-06T21:00:00Z', 'end_at', '2026-10-06T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000005', 'student_name', 'AH Adhoc', 'level', 'B1')),
       'outcome', 'clase_dictada', 'operation_id', '59900000-0000-0000-0000-000000000001'
     )) $$,
  'ad-hoc CON operation_id funciona'
);
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', null, 'occurrence_key', null,
       'primary_student_id', '59100000-0000-0000-0000-000000000005',
       'student_name', 'AH Adhoc', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-06T21:00:00Z', 'end_at', '2026-10-06T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000005', 'student_name', 'AH Adhoc', 'level', 'B1')),
       'outcome', 'clase_dictada', 'operation_id', '59900000-0000-0000-0000-000000000001'
     )) $$,
  'reintentar el mismo ad-hoc con el MISMO operation_id nunca falla'
);
set local role postgres;
select is((select count(*)::int from public.lesson_registrations where owner_id = '59000000-0000-0000-0000-000000000001' and operation_id = '59900000-0000-0000-0000-000000000001'), 1, 'el reintento ad-hoc NUNCA duplica — sigue habiendo un solo registro');

-- 5) Estados inválidos.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "59000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', '59300000-0000-0000-0000-000000000001', 'occurrence_key', null,
       'primary_student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', null,
  'recurrence_id SIN occurrence_key se rechaza'
);
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', null, 'occurrence_key', '59300000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0',
       'primary_student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', null,
  'occurrence_key SIN recurrence_id se rechaza'
);
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', '59300000-0000-0000-0000-000000000001',
       'occurrence_key', '59300000-0000-0000-0000-000000000002:w0:c0:d0:t1800:s0',
       'primary_student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', null,
  'occurrence_key que pertenece a OTRA serie (prefijo no coincide) se rechaza'
);
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', '59300000-0000-0000-0000-000000000098',
       'occurrence_key', '59300000-0000-0000-0000-000000000098:w0:c0:d0:t1800:s0',
       'primary_student_id', '59100000-0000-0000-0000-000000000099', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000099', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'P0002', null,
  'serie de OTRO owner se rechaza'
);
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', '59300000-0000-0000-0000-000000000001',
       'occurrence_key', '59300000-0000-0000-0000-000000000001:w1:c0:d0:t1800:s0',
       'primary_student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-12T21:00:00Z', 'end_at', '2026-10-12T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000099', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'P0002', null,
  'un participante de OTRO owner se rechaza'
);

-- 6) Llamada repetida a la MISMA ocurrencia de serie (ya materializada por el paso 1) -> sigue siendo 1 clase y 1 registro.
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'recurrence_id', '59300000-0000-0000-0000-000000000001',
       'occurrence_key', '59300000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0',
       'recurrence_index', 0,
       'primary_student_id', '59100000-0000-0000-0000-000000000001',
       'student_name', 'SI Individual Virtual', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000001', 'student_name', 'SI Individual Virtual', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'reintentar la MISMA ocurrencia de serie nunca falla'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lessons where recurrence_id = '59300000-0000-0000-0000-000000000001'), 1, 'sigue habiendo una sola calendar_lesson tras el reintento');
select is((select count(*)::int from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000001'), 1, 'sigue habiendo un solo lesson_registration tras el reintento');

-- 7) Falla al materializar (modality inválida viola el check constraint real de calendar_lessons) -> cero filas huérfanas en las 3 tablas.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "59000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'recurrence_id', '59300000-0000-0000-0000-000000000004',
       'occurrence_key', '59300000-0000-0000-0000-000000000004:w0:c0:d0:t1800:s0',
       'recurrence_index', 0,
       'primary_student_id', '59100000-0000-0000-0000-000000000007',
       'student_name', 'MOD Invalida', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'modalidad_invalida',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000007', 'student_name', 'MOD Invalida', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  '23514', null,
  'una modality inválida revienta el check constraint real al materializar'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lessons where recurrence_id = '59300000-0000-0000-0000-000000000004'), 0, 'fallo al materializar: CERO calendar_lessons huérfanas');
select is((select count(*)::int from public.lesson_registrations lr where lr.calendar_lesson_id in (select id from public.calendar_lessons where recurrence_id = '59300000-0000-0000-0000-000000000004')), 0, 'fallo al materializar: CERO lesson_registrations huérfanos');

-- 8) anon rechazado.
set local role anon;
reset "request.jwt.claims";
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', null, 'occurrence_key', null,
       'primary_student_id', '59100000-0000-0000-0000-000000000005', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-06T21:00:00Z', 'end_at', '2026-10-06T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000005', 'student_name', 'x', 'level', 'B1')),
       'operation_id', '59900000-0000-0000-0000-000000000099'
     )) $$,
  '42501', null,
  'anon no tiene EXECUTE sobre start_lesson_registration'
);

-- 9) Clase YA materializada (fuera de serie, camino clásico) sigue funcionando sin regresión.
set local role postgres;
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('59200000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '59100000-0000-0000-0000-000000000006', 'YA Materializada', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "59000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', '59200000-0000-0000-0000-000000000001',
       'recurrence_id', null, 'occurrence_key', null,
       'primary_student_id', '59100000-0000-0000-0000-000000000006',
       'student_name', 'YA Materializada', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000006', 'student_name', 'YA Materializada', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'una clase YA materializada (sin recurrence_id/occurrence_key) sigue registrándose sin regresión'
);

-- 10) ids contradictorios: calendar_lesson_id real, pero recurrence_id/occurrence_key de OTRA serie.
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', '59200000-0000-0000-0000-000000000001',
       'recurrence_id', '59300000-0000-0000-0000-000000000001',
       'occurrence_key', '59300000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0',
       'primary_student_id', '59100000-0000-0000-0000-000000000006', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', '59100000-0000-0000-0000-000000000006', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', null,
  'calendar_lesson_id y recurrence_id/occurrence_key contradictorios (no corresponden a la misma clase) se rechazan'
);

-- 11) finalize/save_participant_registration sin regresión (sobre el registro grupal del paso 2).
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002'),
       'student_id', '59100000-0000-0000-0000-000000000002',
       'participant_status', 'completed',
       'attendance', jsonb_build_object('status', 'presente', 'late_minutes', null)
     )) $$,
  'save_participant_registration sigue funcionando sin regresión (primario del registro grupal)'
);
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002'),
       'student_id', '59100000-0000-0000-0000-000000000003',
       'participant_status', 'completed',
       'attendance', jsonb_build_object('status', 'presente', 'late_minutes', null)
     )) $$,
  'save_participant_registration sobre un secundario, sin regresión'
);
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002'),
       'student_id', '59100000-0000-0000-0000-000000000004',
       'participant_status', 'completed',
       'attendance', jsonb_build_object('status', 'presente', 'late_minutes', null)
     )) $$,
  'save_participant_registration sobre el segundo secundario, sin regresión'
);
select lives_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = '59300000-0000-0000-0000-000000000002')
     )) $$,
  'finalize_lesson_registration sigue funcionando sin regresión'
);
set local role postgres;
select is((select status from public.calendar_lessons where recurrence_id = '59300000-0000-0000-0000-000000000002'), 'completed', 'la clase quedó completed tras finalizar — cadena completa sin regresión');

select * from finish();
rollback;
