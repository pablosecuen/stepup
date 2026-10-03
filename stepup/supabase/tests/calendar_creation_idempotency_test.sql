-- TeacherFlow Web — Fase 10: pruebas reales de la idempotencia de creación de
-- clase única y serie (migración `20261001150000_calendar_creation_idempotency.sql`).
-- Mismo procedimiento transaccional descartable — ROLLBACK al final.
--
-- Cubre: doble clic / reintento secuencial, respuesta perdida, recarga y dos
-- pestañas (las tres son, para el servidor, "la misma llamada con el mismo
-- operation_id" — la clave la conserva el cliente en sessionStorage), cero
-- reprocesamiento del roster, operation_id nuevo = operación nueva,
-- aislamiento entre owners, rollback completo ante una falla posterior y
-- rechazo de un payload sin operation_id. La concurrencia real entre dos
-- conexiones se prueba aparte (ver docs/WEB_PARITY_PLAN.md).

begin;
select plan(46);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f4000000-0000-0000-0000-000000000001', 'qa-idem-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f4000000-0000-0000-0000-000000000002', 'qa-idem-b@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f4100000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'F4 Alumno A1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f4100000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', 'F4 Alumno A2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f4100000-0000-0000-0000-000000000009', 'f4000000-0000-0000-0000-000000000002', 'F4 Alumno De B', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- ---------------------------------------------------------------------------
-- CLASE ÚNICA
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 1) Primera llamada (operation_id A): crea la clase y su roster.
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000002',
       'student_name', 'F4 Alumno A2', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-11-03T21:00:00Z', 'end_at', '2026-11-03T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'F4 Alumno A1', 'level', 'B1'),
         jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000002', 'student_name', 'F4 Alumno A2', 'level', 'B1')
       )
     )) $$,
  'clase única: primera llamada con operation_id A crea la clase'
);
select is((select count(*)::int from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000a'), 1, 'clase única: exactamente 1 clase con ese operation_id');
select is((select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = (select id from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000a')), 2, 'clase única: roster inclusivo de 2 participantes');

set local role postgres;
create temp table snap_lesson as
  select id, created_at, updated_at from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000a';
grant select on snap_lesson to authenticated;
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 2) Reintento secuencial / doble clic / respuesta perdida / recarga / segunda pestaña: MISMA llamada.
select is(
  (select (public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000002',
       'student_name', 'F4 Alumno A2', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-11-03T21:00:00Z', 'end_at', '2026-11-03T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'F4 Alumno A1', 'level', 'B1'),
         jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000002', 'student_name', 'F4 Alumno A2', 'level', 'B1')
       )
     ))).id::text),
  (select id::text from snap_lesson),
  'clase única: el reintento devuelve la MISMA fila canónica (éxito, nunca "se superpone")'
);
select is((select count(*)::int from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000a'), 1, 'clase única: tras el reintento sigue habiendo exactamente 1 clase');
select is((select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = (select id from snap_lesson)), 2, 'clase única: tras el reintento el roster sigue con 2 (no se duplicó)');

-- 3) Reintento con un payload DISTINTO (otro horario, otro roster): igual devuelve la canónica y no reprocesa nada.
select is(
  (select (public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'F4 Alumno A1', 'level', 'C1', 'lesson_type', 'individual',
       'start_at', '2026-12-25T10:00:00Z', 'end_at', '2026-12-25T11:00:00Z', 'modality', 'online',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'F4 Alumno A1', 'level', 'C1')
       )
     ))).id::text),
  (select id::text from snap_lesson),
  'clase única: mismo operation_id con payload distinto sigue devolviendo la canónica'
);
select is((select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = (select id from snap_lesson)), 2, 'clase única: el reintento con otro roster NO modificó los participantes');

set local role postgres;
select is(
  (select (c.created_at = s.created_at and c.updated_at = s.updated_at and c.start_at = '2026-11-03T21:00:00Z' and c.modality = 'presencial')
     from public.calendar_lessons c join snap_lesson s on s.id = c.id),
  true,
  'clase única: el reintento no modificó created_at, updated_at, horario ni modalidad'
);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 4) Un operation_id NUEVO crea una operación nueva, aun con el mismo horario (el solapamiento es regla de la acción, no de la RPC).
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000b',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'F4 Alumno A1', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-03T21:00:00Z', 'end_at', '2026-11-03T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'F4 Alumno A1', 'level', 'B1'))
     )) $$,
  'clase única: un operation_id nuevo crea una operación nueva'
);
select is((select count(*)::int from public.calendar_lessons where owner_id = 'f4000000-0000-0000-0000-000000000001'), 2, 'clase única: hay exactamente 2 clases (una por operation_id)');

-- 5) Sin operation_id (ausente o null) el camino web se rechaza.
select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-04T21:00:00Z', 'end_at', '2026-11-04T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', 'Falta operation_id.',
  'clase única: payload sin operation_id rechazado'
);
select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', null,
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-04T21:00:00Z', 'end_at', '2026-11-04T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023', 'Falta operation_id.',
  'clase única: operation_id null rechazado'
);
select is((select count(*)::int from public.calendar_lessons where owner_id = 'f4000000-0000-0000-0000-000000000001'), 2, 'clase única: los rechazos no dejaron ninguna fila');

-- 6) Rollback completo ante una falla posterior (participante sin student_name -> not_null en la tabla hija).
select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000c',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'F4 Alumno A1', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-05T21:00:00Z', 'end_at', '2026-11-05T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'level', 'B1'))
     )) $$,
  '23502', null,
  'clase única: una falla al insertar el participante aborta la operación'
);
select is((select count(*)::int from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000c'), 0, 'clase única: la falla posterior deshizo también la fila principal (sin huérfanos)');
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000c',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'F4 Alumno A1', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-05T21:00:00Z', 'end_at', '2026-11-05T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'F4 Alumno A1', 'level', 'B1'))
     )) $$,
  'clase única: tras el rollback el mismo operation_id queda libre para un reintento corregido'
);
select is((select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = (select id from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000c')), 1, 'clase única: el reintento corregido creó su roster completo');

-- 7) Aislamiento entre owners: el mismo UUID en otro owner crea SU propia clase y nunca devuelve la ajena.
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000009',
       'student_name', 'F4 Alumno De B', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-03T21:00:00Z', 'end_at', '2026-11-03T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000009', 'student_name', 'F4 Alumno De B', 'level', 'B1'))
     )) $$,
  'clase única: el mismo operation_id en OTRO owner crea su propia clase (UNIQUE por owner)'
);
select is((select primary_student_id::text from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000a'), 'f4100000-0000-0000-0000-000000000009', 'clase única: el owner B sólo ve su clase, nunca la del owner A');
select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', 'f4a00000-0000-0000-0000-0000000000dd',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-11-06T21:00:00Z', 'end_at', '2026-11-06T22:00:00Z', 'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f4100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'P0002', null,
  'clase única: el owner B no puede usar un alumno del owner A (aislamiento)'
);

set local role postgres;
select is((select count(*)::int from public.calendar_lessons where operation_id = 'f4a00000-0000-0000-0000-00000000000a'), 2, 'clase única: el mismo UUID existe una vez por owner (2 filas, una de cada uno)');
select is((select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = (select id from snap_lesson)), 2, 'clase única: el roster del owner A quedó intacto tras la actividad del owner B');

-- ---------------------------------------------------------------------------
-- SERIE RECURRENTE
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000002',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-02',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000002')
     )) $$,
  'serie: primera llamada con operation_id A crea la regla'
);
select is((select count(*)::int from public.recurrence_rules where operation_id = 'f4b00000-0000-0000-0000-00000000000a'), 1, 'serie: exactamente 1 regla con ese operation_id');
select is((select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = (select id from public.recurrence_rules where operation_id = 'f4b00000-0000-0000-0000-00000000000a')), 2, 'serie: roster inclusivo de 2 participantes');

set local role postgres;
create temp table snap_rule as
  select id, created_at, updated_at from public.recurrence_rules where operation_id = 'f4b00000-0000-0000-0000-00000000000a';
grant select on snap_rule to authenticated;
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select (public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000002',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-02',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000002')
     ))).id::text),
  (select id::text from snap_rule),
  'serie: el reintento devuelve EXACTAMENTE la misma regla'
);
select is((select count(*)::int from public.recurrence_rules where operation_id = 'f4b00000-0000-0000-0000-00000000000a'), 1, 'serie: tras el reintento sigue habiendo exactamente 1 regla (nunca una segunda)');
select is((select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = (select id from snap_rule)), 2, 'serie: tras el reintento el roster sigue con 2');

select is(
  (select (public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":9,"minute":0,"durationMinutes":30}]}]'::jsonb,
       'modality', 'online', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-12-07',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001')
     ))).id::text),
  (select id::text from snap_rule),
  'serie: mismo operation_id con payload distinto sigue devolviendo la canónica'
);
select is((select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = (select id from snap_rule)), 2, 'serie: el reintento con otro roster NO modificó los participantes');

set local role postgres;
select is(
  (select (r.created_at = s.created_at and r.updated_at = s.updated_at and r.start_date = '2026-11-02' and r.modality = 'presencial')
     from public.recurrence_rules r join snap_rule s on s.id = r.id),
  true,
  'serie: el reintento no modificó created_at, updated_at, fecha de inicio ni modalidad'
);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000b',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-02',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001')
     )) $$,
  'serie: un operation_id nuevo crea una serie nueva'
);
select is((select count(*)::int from public.recurrence_rules where owner_id = 'f4000000-0000-0000-0000-000000000001'), 2, 'serie: hay exactamente 2 reglas (una por operation_id)');

select throws_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":2,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-03',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001')
     )) $$,
  '22023', 'Falta operation_id.',
  'serie: payload sin operation_id rechazado'
);

-- Rollback completo: un participante repetido viola UNIQUE (regla, alumno) DESPUÉS de insertar la regla.
select throws_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000c',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":3,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-04',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001')
     )) $$,
  '23505', null,
  'serie: una falla al insertar el roster aborta la operación'
);
select is((select count(*)::int from public.recurrence_rules where operation_id = 'f4b00000-0000-0000-0000-00000000000c'), 0, 'serie: la falla posterior deshizo también la regla (sin huérfanos)');
select lives_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000c',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":3,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-04',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001')
     )) $$,
  'serie: tras el rollback el mismo operation_id queda libre para un reintento corregido'
);

set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select lives_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'operation_id', 'f4b00000-0000-0000-0000-00000000000a',
       'primary_student_id', 'f4100000-0000-0000-0000-000000000009',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires', 'start_date', '2026-11-02',
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000009')
     )) $$,
  'serie: el mismo operation_id en OTRO owner crea su propia regla (UNIQUE por owner)'
);
set local role postgres;
select is((select count(*)::int from public.recurrence_rules where operation_id = 'f4b00000-0000-0000-0000-00000000000a'), 2, 'serie: el mismo UUID existe una vez por owner (2 filas)');
select is((select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = (select id from snap_rule)), 2, 'serie: el roster del owner A quedó intacto tras la actividad del owner B');

-- ---------------------------------------------------------------------------
-- Estructura: índices UNIQUE parciales, filas históricas sin clave, anon sin EXECUTE.
-- ---------------------------------------------------------------------------
select is(
  (select indexdef ilike '%UNIQUE%(owner_id, operation_id)%WHERE (operation_id IS NOT NULL)%' from pg_indexes where schemaname = 'public' and indexname = 'calendar_lessons_owner_operation_unique'),
  true,
  'índice UNIQUE parcial (owner_id, operation_id) en calendar_lessons'
);
select is(
  (select indexdef ilike '%UNIQUE%(owner_id, operation_id)%WHERE (operation_id IS NOT NULL)%' from pg_indexes where schemaname = 'public' and indexname = 'recurrence_rules_owner_operation_unique'),
  true,
  'índice UNIQUE parcial (owner_id, operation_id) en recurrence_rules'
);
select lives_ok(
  $$ insert into public.calendar_lessons (owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring)
     values
       ('f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'hist 1', 'B1', 'individual', '2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false),
       ('f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'hist 2', 'B1', 'individual', '2026-09-02T10:00:00Z', '2026-09-02T11:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false) $$,
  'filas históricas sin operation_id (NULL) siguen permitidas — el UNIQUE sólo aplica a valores no nulos'
);

set local role anon;
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

select * from finish();
rollback;
