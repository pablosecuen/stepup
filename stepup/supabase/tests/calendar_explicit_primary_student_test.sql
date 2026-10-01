-- TeacherFlow Web — Fase 10, bloque corto: pruebas reales contra la
-- migración PENDIENTE `20261001140000_calendar_explicit_primary_student.sql`
-- (selección explícita del alumno principal en las 4 RPC de Calendario).
-- Mismo procedimiento transaccional descartable — ROLLBACK al final.

begin;
select plan(26);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f3000000-0000-0000-0000-000000000001', 'qa-primary-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f3000000-0000-0000-0000-000000000002', 'qa-primary-b@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f3100000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'F3 Alumno A1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f3100000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'F3 Alumno A2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f3100000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000001', 'F3 Alumno A3', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f3100000-0000-0000-0000-000000000009', 'f3000000-0000-0000-0000-000000000002', 'F3 Alumno De B', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 1) Clase individual — un solo participante, principal automático.
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'primary_student_id', 'f3100000-0000-0000-0000-000000000001',
       'student_name', 'F3 Alumno A1', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f3100000-0000-0000-0000-000000000001', 'student_name', 'F3 Alumno A1', 'level', 'B1'))
     )) $$,
  'clase individual: principal automático funciona'
);

-- 2) Clase grupal con principal explícito (A2, no el primero del array).
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'primary_student_id', 'f3100000-0000-0000-0000-000000000002',
       'student_name', 'F3 Alumno A2', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-10-06T21:00:00Z', 'end_at', '2026-10-06T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'f3100000-0000-0000-0000-000000000001', 'student_name', 'F3 Alumno A1', 'level', 'B1'),
         jsonb_build_object('student_id', 'f3100000-0000-0000-0000-000000000002', 'student_name', 'F3 Alumno A2', 'level', 'B1')
       )
     )) $$,
  'clase grupal: principal explícito (no el primero del array) funciona'
);
set local role postgres;
select is((select primary_student_id from public.calendar_lessons where owner_id='f3000000-0000-0000-0000-000000000001' and student_name='F3 Alumno A2')::text, 'f3100000-0000-0000-0000-000000000002', 'persistencia exacta: el principal guardado es el elegido, nunca el primero del array');

-- 3) create_calendar_lesson: principal fuera del roster -> rechazo (payload contradictorio).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'primary_student_id', 'f3100000-0000-0000-0000-000000000003',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-10-07T21:00:00Z', 'end_at', '2026-10-07T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f3100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', null,
  'create_calendar_lesson: principal fuera del roster enviado se rechaza'
);

-- 4) Serie grupal — principal explícito.
select lives_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'primary_student_id', 'f3100000-0000-0000-0000-000000000002',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-08-03',
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000002', 'f3100000-0000-0000-0000-000000000003')
     )) $$,
  'serie grupal: principal explícito funciona'
);
set local role postgres;
select is((select primary_student_id from public.recurrence_rules where owner_id='f3000000-0000-0000-0000-000000000001' and start_date='2026-08-03')::text, 'f3100000-0000-0000-0000-000000000002', 'persistencia exacta de la serie: el principal guardado es el elegido');

-- 5) create_recurrence_series: sin principal -> rechazo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":2,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-08-04',
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000001')
     )) $$,
  '22023', null,
  'create_recurrence_series: sin primary_student_id se rechaza (nunca se infiere)'
);

-- 6) create_recurrence_series: principal fuera del roster -> rechazo.
select throws_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'primary_student_id', 'f3100000-0000-0000-0000-000000000003',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":3,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-08-05',
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000002')
     )) $$,
  '22023', null,
  'create_recurrence_series: principal fuera del roster enviado se rechaza'
);

-- 7) create_recurrence_series: principal de OTRO owner -> rechazo (aislamiento).
select throws_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'primary_student_id', 'f3100000-0000-0000-0000-000000000009',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-08-06',
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000001')
     )) $$,
  'P0002', null,
  'create_recurrence_series: alumno principal de OTRO owner rechazado (aislamiento)'
);

-- ---------------------------------------------------------------------------
-- "Esta y las siguientes" (split_recurrence_this_and_future)
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('f3300000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000001', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-03', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('f3000000-0000-0000-0000-000000000001', 'f3300000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000001', 'f3300000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000002');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 8) split con el mismo principal real (roster sin cambios) -> funciona.
select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f3300000-0000-0000-0000-000000000001',
       'effective_date', '2026-10-05',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', '2026-09-28'),
       'successor_id', 'f3300000-0000-0000-0000-000000000002',
       'successor_start_date', '2026-10-05',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000002'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000001',
       'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '"esta y las siguientes": principal real (sin desmarcar) funciona'
);
set local role postgres;
select is((select primary_student_id from public.recurrence_rules where id='f3300000-0000-0000-0000-000000000002')::text, 'f3100000-0000-0000-0000-000000000001', 'persistencia exacta en la sucesora: mismo principal real');

-- 9) split desmarcando al principal (nuevo roster sin A1, pidiendo A1 igual como principal) -> rechazo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f3300000-0000-0000-0000-000000000001',
       'effective_date', '2026-10-12',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', '2026-10-04'),
       'successor_id', gen_random_uuid(),
       'successor_start_date', '2026-10-12',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000002'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000001',
       'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  '"esta y las siguientes": desmarcar al principal del roster nuevo se rechaza (nunca queda huérfano)'
);

-- 10) split con un nuevo principal explícito, real y dentro del roster nuevo -> funciona (promoción explícita).
select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f3300000-0000-0000-0000-000000000001',
       'effective_date', '2026-10-19',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', '2026-10-11'),
       'successor_id', gen_random_uuid(),
       'successor_start_date', '2026-10-19',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000002'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000002',
       'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '"esta y las siguientes": nuevo principal explícito (A2, dentro del roster nuevo) funciona'
);

-- 11) split: principal de OTRO owner -> rechazo (aislamiento).
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f3300000-0000-0000-0000-000000000001',
       'effective_date', '2026-11-02',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', '2026-10-25'),
       'successor_id', gen_random_uuid(),
       'successor_start_date', '2026-11-02',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000009',
       'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'P0002', null,
  '"esta y las siguientes": alumno principal de OTRO owner rechazado (aislamiento)'
);

-- ---------------------------------------------------------------------------
-- "Modificar participantes" (apply_recurrence_participants_from_date)
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('f3300000-0000-0000-0000-000000000009', 'f3000000-0000-0000-0000-000000000001', 'f3100000-0000-0000-0000-000000000001', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":2,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-04', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('f3000000-0000-0000-0000-000000000001', 'f3300000-0000-0000-0000-000000000009', 'f3100000-0000-0000-0000-000000000001'),
  ('f3000000-0000-0000-0000-000000000001', 'f3300000-0000-0000-0000-000000000009', 'f3100000-0000-0000-0000-000000000002');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 12) Modificar participantes: desmarcar al principal (A1), pidiendo A1 igual -> rechazo.
select throws_ok(
  $$ select public.apply_recurrence_participants_from_date(jsonb_build_object(
       'rule_id', 'f3300000-0000-0000-0000-000000000009',
       'new_participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000002', 'f3100000-0000-0000-0000-000000000003'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000001',
       'freeze_occurrences', '[]'::jsonb
     )) $$,
  '22023', null,
  'Modificar participantes: desmarcar al principal se rechaza si se sigue pidiendo a él mismo'
);

-- 13) Modificar participantes: nuevo principal explícito dentro del roster nuevo -> funciona.
select lives_ok(
  $$ select public.apply_recurrence_participants_from_date(jsonb_build_object(
       'rule_id', 'f3300000-0000-0000-0000-000000000009',
       'new_participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000002', 'f3100000-0000-0000-0000-000000000003'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000003',
       'freeze_occurrences', '[]'::jsonb
     )) $$,
  'Modificar participantes: nuevo principal explícito (A3) funciona'
);
set local role postgres;
select is((select primary_student_id from public.recurrence_rules where id='f3300000-0000-0000-0000-000000000009')::text, 'f3100000-0000-0000-0000-000000000003', 'persistencia exacta tras Modificar participantes: el principal guardado es el elegido');
select is((select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id='f3300000-0000-0000-0000-000000000009' and student_id='f3100000-0000-0000-0000-000000000003'), 1, 'el nuevo principal (A3) quedó también en el roster real (contrato inclusivo intacto)');

-- 14) Modificar participantes: sin primary_student_id -> rechazo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.apply_recurrence_participants_from_date(jsonb_build_object(
       'rule_id', 'f3300000-0000-0000-0000-000000000009',
       'new_participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000002'),
       'freeze_occurrences', '[]'::jsonb
     )) $$,
  '22023', null,
  'Modificar participantes: sin primary_student_id se rechaza (nunca se infiere)'
);

-- 15) Modificar participantes: principal de OTRO owner -> rechazo (aislamiento).
select throws_ok(
  $$ select public.apply_recurrence_participants_from_date(jsonb_build_object(
       'rule_id', 'f3300000-0000-0000-0000-000000000009',
       'new_participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000002'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000009',
       'freeze_occurrences', '[]'::jsonb
     )) $$,
  'P0002', null,
  'Modificar participantes: alumno principal de OTRO owner rechazado (aislamiento)'
);

-- 16) B intentando tocar la serie de A con un primary propio de B -> rechazo (serie ajena).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f3000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select throws_ok(
  $$ select public.apply_recurrence_participants_from_date(jsonb_build_object(
       'rule_id', 'f3300000-0000-0000-0000-000000000009',
       'new_participant_ids', jsonb_build_array('f3100000-0000-0000-0000-000000000009'),
       'primary_student_id', 'f3100000-0000-0000-0000-000000000009',
       'freeze_occurrences', '[]'::jsonb
     )) $$,
  'P0002', null,
  'B no puede modificar participantes de una serie de A, aunque el primary sea propio'
);

-- 17) Roster inclusivo intacto tras TODO lo anterior: el principal final
-- sigue apareciendo en recurrence_rule_participants de su propia regla.
set local role postgres;
select is(
  (select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id='f3300000-0000-0000-0000-000000000001' and student_id='f3100000-0000-0000-0000-000000000001'),
  1,
  'el contrato inclusivo sigue intacto: el principal de la serie original nunca se quitó de su propio roster'
);

-- 18) anon no puede ejecutar ninguna de las 4 RPC.
set local role anon;
reset "request.jwt.claims";
select throws_ok(
  $$ select public.create_calendar_lesson('{}'::jsonb) $$,
  '42501', null,
  'anon: create_calendar_lesson sin EXECUTE'
);
select throws_ok(
  $$ select public.create_recurrence_series('{}'::jsonb) $$,
  '42501', null,
  'anon: create_recurrence_series sin EXECUTE'
);
select throws_ok(
  $$ select public.split_recurrence_this_and_future('{}'::jsonb) $$,
  '42501', null,
  'anon: split_recurrence_this_and_future sin EXECUTE'
);
select throws_ok(
  $$ select public.apply_recurrence_participants_from_date('{}'::jsonb) $$,
  '42501', null,
  'anon: apply_recurrence_participants_from_date sin EXECUTE'
);

select * from finish();
rollback;
