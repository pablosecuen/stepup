-- TeacherFlow Web — pruebas pgTAP de las RPC de registro de clases (Fase 4)
-- contra referencias cruzadas de propietario, mismo criterio que
-- `calendar_rpc_ownership_test.sql` (Fase 3). Mismo aviso: este entorno no
-- tiene Docker ni el CLI de Supabase — nunca corrió contra una base real
-- todavía. Listo para `supabase test db` una vez aplicada la migración
-- `20260921120000_lesson_registration_rpcs.sql`.

begin;
select plan(51);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('f0000000-0000-0000-0000-000000000001', 'qa-lr-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000002', 'qa-lr-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Alumno QA LR 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'Alumno QA LR 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'Alumno QA LR 3', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

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

-- Revisión de esta ronda (a pedido explícito de Joaquín): finalize_lesson_registration
-- deja de servir para "editar" un registro ya completed — reintentarla
-- sobre uno ya finalizado ahora es un error explícito, nunca una edición
-- silenciosa. La única vía real de edición pasa a ser
-- edit_completed_lesson_registration (ver más abajo), que sí es atómica e
-- idempotente por edit_operation_id.
select throws_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where calendar_lesson_id = 'f2000000-0000-0000-0000-000000000001')
     )) $$,
  '22023',
  null,
  'finalize_lesson_registration rechaza reintentar sobre un registro ya completed — editar pasa por edit_completed_lesson_registration'
);

-- ---------------------------------------------------------------------------
-- start_lesson_registration — registro ad-hoc (calendar_lesson_id null,
-- puerto de NewClassScreen.tsx). Nunca toca calendar_lessons, y cuando el
-- resultado no implica que se dictó la clase inserta a los participantes
-- directamente 'completed'. Idempotencia real por `operation_id` — nunca
-- una protección visual del botón.
--
-- Nota sobre "concurrencia real": pgTAP corre en una única sesión
-- secuencial — no puede disparar dos requests genuinamente simultáneas
-- (mismo límite ya documentado para RLS con dos sesiones reales). Lo que
-- SÍ prueba acá es que dos llamadas con el mismo `operation_id` — sea por
-- doble clic, reintento tras una respuesta perdida, o dos pestañas —
-- convergen siempre en la MISMA fila (idempotencia real). La garantía bajo
-- concurrencia genuina no depende de esta prueba: la da la restricción
-- UNIQUE de la base combinada con `INSERT ... ON CONFLICT ... RETURNING`,
-- que Postgres serializa a nivel de fila sin necesidad de ningún lock
-- explícito adicional — una propiedad del motor, no del orden en que se
-- llame.
-- ---------------------------------------------------------------------------
set local role postgres;
select is(
  (select count(*)::int from public.calendar_lessons where owner_id = 'f0000000-0000-0000-0000-000000000001'),
  1,
  'antes del registro ad-hoc sólo existe la clase de calendario ya creada arriba (filtrado por owner_id propio del fixture, nunca un count(*) global de la base compartida)'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'activity_kind', 'class',
       'outcome', 'clase_dictada',
       'modality', 'presencial',
       'start_at', '2026-09-22T12:00:00Z',
       'end_at', '2026-09-22T13:00:00Z',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  '22023',
  null,
  'start_lesson_registration ad-hoc sin operation_id se rechaza — nunca es opcional para este camino'
);

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'activity_kind', 'class',
       'outcome', 'clase_dictada',
       'holiday_exception', false,
       'modality', 'presencial',
       'operation_id', 'a1000000-0000-0000-0000-000000000001',
       'start_at', '2026-09-22T12:00:00Z',
       'end_at', '2026-09-22T13:00:00Z',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'start_lesson_registration ad-hoc con operation_id funciona (primer intento real)'
);

set local role postgres;
select is(
  (select count(*)::int from public.calendar_lessons where owner_id = 'f0000000-0000-0000-0000-000000000001'),
  1,
  'un registro ad-hoc nunca crea ninguna fila nueva en calendar_lessons (filtrado por owner_id propio del fixture)'
);
select is(
  (select counts_as_class from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001'),
  true,
  'outcome clase_dictada cuenta como clase (counts_as_class = true)'
);
select is(
  (select participant_status from public.lesson_registration_students where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001')),
  'pending',
  'clase_dictada deja al participante pending — falta completar asistencia/evaluación'
);

-- Doble clic / respuesta perdida y reintento / dos pestañas: MISMO
-- operation_id, mismo payload — simulado acá como dos llamadas
-- secuenciales (ver nota de concurrencia arriba).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'activity_kind', 'class',
       'outcome', 'clase_dictada',
       'holiday_exception', false,
       'modality', 'presencial',
       'operation_id', 'a1000000-0000-0000-0000-000000000001',
       'start_at', '2026-09-22T12:00:00Z',
       'end_at', '2026-09-22T13:00:00Z',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'reintentar CON EL MISMO operation_id (doble clic/respuesta perdida/dos pestañas) nunca falla'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'reintentar con el mismo operation_id NUNCA duplica la fila — converge siempre en el mismo registro'
);

-- Reintentar CON EL MISMO operation_id pero un payload de PARTICIPANTES
-- DISTINTO (agrega un segundo alumno legítimo) nunca debe modificar el
-- registro original — ni agregar, quitar ni cambiar participantes. La
-- brecha real que esto corrige: antes, `ON CONFLICT ... DO UPDATE` seguía
-- de largo al bucle de participantes SIEMPRE, así que un reenvío con un
-- payload alterado terminaba agregando participantes a una operación que
-- la base ya había resuelto.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'activity_kind', 'class',
       'outcome', 'clase_dictada',
       'holiday_exception', false,
       'modality', 'presencial',
       'operation_id', 'a1000000-0000-0000-0000-000000000001',
       'start_at', '2026-09-22T12:00:00Z',
       'end_at', '2026-09-22T13:00:00Z',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'),
         jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000003', 'student_name', 'y', 'level', 'B1')
       )
     )) $$,
  'reintentar con el mismo operation_id y un payload de participantes DISTINTO nunca falla (idempotente, no reprocesa)'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registration_students where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001')),
  1,
  'reintentar con operation_id ya consumido NUNCA agrega participantes nuevos, aunque el payload traiga uno de más'
);
select is(
  (select count(*)::int from public.lesson_registration_students where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001') and student_id = 'f1000000-0000-0000-0000-000000000003'),
  0,
  'el alumno "agregado" en el reenvío nunca llega a existir en el roster real'
);
select is(
  (select count(*)::int from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'sigue siendo una sola fila — el reenvío con payload alterado tampoco crea una fila nueva'
);

-- Un operation_id NUEVO (acción legítima distinta) sí crea otra fila, aunque coincidan alumno/fecha/horario.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'activity_kind', 'class',
       'outcome', 'clase_dictada',
       'holiday_exception', false,
       'modality', 'presencial',
       'operation_id', 'a1000000-0000-0000-0000-000000000002',
       'start_at', '2026-09-22T12:00:00Z',
       'end_at', '2026-09-22T13:00:00Z',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'un operation_id NUEVO permite crear otro registro legítimo, aunque alumno/fecha/hora coincidan'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registrations where calendar_lesson_id is null and owner_id = 'f0000000-0000-0000-0000-000000000001'),
  2,
  'dos operation_id distintos SIEMPRE son dos filas — nunca se confunden entre sí (filtrado por owner_id propio del fixture, nunca un count(*) global de la base compartida)'
);

-- outcome que no implica que se dictó la clase: participante auto-completed.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null,
       'activity_kind', 'class',
       'outcome', 'profesora_ausente',
       'holiday_exception', false,
       'modality', 'presencial',
       'operation_id', 'a1000000-0000-0000-0000-000000000003',
       'start_at', '2026-09-22T14:00:00Z',
       'end_at', '2026-09-22T15:00:00Z',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'start_lesson_registration ad-hoc con outcome profesora_ausente funciona'
);

set local role postgres;
select is(
  (select counts_as_class from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
  false,
  'profesora_ausente nunca cuenta como clase (counts_as_class = false)'
);
select is(
  (select participant_status from public.lesson_registration_students where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  'completed',
  'profesora_ausente inserta al participante directamente completed — no hay asistencia/evaluación que completar'
);

-- anon (sin sesión, sin grant) nunca puede ejecutar esta RPC.
set local role anon;
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object('calendar_lesson_id', null, 'operation_id', 'a1000000-0000-0000-0000-000000000099', 'participants', '[]'::jsonb)) $$,
  '42501',
  null,
  'anon no puede ejecutar start_lesson_registration — revoke real, nunca sólo RLS'
);

-- ---------------------------------------------------------------------------
-- edit_completed_lesson_registration — única vía real de edición. Snapshot
-- de auditoría + todos los cambios académicos en UNA transacción,
-- idempotente por edit_operation_id.
-- ---------------------------------------------------------------------------

-- Primero hay que finalizar el registro 'profesora_ausente' (start_lesson_registration
-- sólo deja el PARTICIPANTE completed — el ENCABEZADO sigue in_progress
-- hasta que se llama a finalize_lesson_registration, igual que siempre).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')
     )) $$,
  'finalize_lesson_registration sobre el registro ad-hoc profesora_ausente funciona (primer finalizado real)'
);

-- Sólo edita registros YA finalizados — nunca uno todavía in_progress.
select throws_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000001'),
       'edit_operation_id', 'b1000000-0000-0000-0000-000000000001',
       'participants', '[]'::jsonb
     )) $$,
  '22023',
  null,
  'edit_completed_lesson_registration rechaza un registro todavía in_progress — sólo edita ya completed'
);

-- edit_operation_id es obligatorio.
select throws_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'participants', '[]'::jsonb
     )) $$,
  '22023',
  null,
  'edit_completed_lesson_registration sin edit_operation_id se rechaza'
);

-- Un participante que no pertenece a ESTE registro se rechaza, y no deja ni snapshot ni cambio parcial (atomicidad real).
select throws_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'edit_operation_id', 'b1000000-0000-0000-0000-000000000002',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000002', 'attendance', jsonb_build_object('status', 'presente')))
     )) $$,
  'P0002',
  null,
  'edit_completed_lesson_registration rechaza un alumno ajeno a este registro'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registration_edit_history where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  0,
  'un fallo de edición no deja ningún snapshot huérfano — la transacción completa se revierte'
);

-- Edición real: primer edit_operation_id — aplica de verdad.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'edit_operation_id', 'b1000000-0000-0000-0000-000000000003',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'attendance', jsonb_build_object('status', 'presente')))
     )) $$,
  'edit_completed_lesson_registration con edit_operation_id real funciona'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registration_edit_history where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  1,
  'una edición real agrega exactamente una entrada de auditoría'
);
select is(
  (select status from public.lesson_registration_attendance where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  'presente',
  'la edición real aplicó el cambio académico (asistencia = presente)'
);

-- Reintentar CON EL MISMO edit_operation_id, con datos DISTINTOS: nunca
-- duplica el historial, y NUNCA reaplica — los datos académicos quedan
-- exactamente como los dejó la primera aplicación real.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'edit_operation_id', 'b1000000-0000-0000-0000-000000000003',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'attendance', jsonb_build_object('status', 'ausente')))
     )) $$,
  'reintentar con el MISMO edit_operation_id (datos distintos) nunca falla'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registration_edit_history where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  1,
  'reintentar con el mismo edit_operation_id NUNCA duplica el historial'
);
select is(
  (select status from public.lesson_registration_attendance where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  'presente',
  'reintentar con el mismo edit_operation_id NUNCA reaplica — el dato académico queda como la primera aplicación real, ignora el reenvío'
);

-- Un edit_operation_id NUEVO sí es una edición legítima distinta: aplica de verdad y agrega una segunda entrada, ordenada después de la primera.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'edit_operation_id', 'b1000000-0000-0000-0000-000000000004',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'f1000000-0000-0000-0000-000000000001', 'attendance', jsonb_build_object('status', 'ausente')))
     )) $$,
  'un edit_operation_id NUEVO permite una segunda edición legítima'
);

set local role postgres;
select is(
  (select count(*)::int from public.lesson_registration_edit_history where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  2,
  'dos edit_operation_id distintos son dos entradas de auditoría reales, nunca una sola fusionada'
);
select is(
  (select status from public.lesson_registration_attendance where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  'ausente',
  'la segunda edición real SÍ aplicó su cambio (asistencia = ausente)'
);
select is(
  (
    select count(*)::int from (
      select edited_at from public.lesson_registration_edit_history
      where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')
      order by edited_at asc
    ) ordered
  ),
  2,
  'las dos entradas de auditoría quedan ordenables por edited_at — nunca se pierde el orden real de las ediciones'
);

-- Usuario ajeno: ni editar, ni finalizar, ni leer la auditoría de otro dueño.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'edit_operation_id', 'b1000000-0000-0000-0000-000000000099',
       'participants', '[]'::jsonb
     )) $$,
  'P0002',
  null,
  'edit_completed_lesson_registration rechaza un registro de otro usuario'
);

select is(
  (select count(*)::int from public.lesson_registration_edit_history where lesson_registration_id = (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003')),
  0,
  'usuario B no puede leer (RLS) la auditoría de un registro del usuario A, aunque exista de verdad'
);

-- La auditoría nunca acepta escritura directa por REST — ni siquiera del
-- propio dueño. La única vía real de escritura es edit_completed_lesson_registration
-- (security definer). Esto es justamente lo que hace inútil un INSERT
-- directo aunque alguien conociera la forma exacta del snapshot: la tabla
-- ya no tiene ninguna política de INSERT, y además el REVOKE a nivel de
-- tabla corta antes incluso de evaluar RLS.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.lesson_registration_edit_history (owner_id, lesson_registration_id, edit_operation_id, previous_snapshot)
     values ('f0000000-0000-0000-0000-000000000001', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'), gen_random_uuid(), '{}'::jsonb) $$,
  '42501',
  null,
  'authenticated no puede insertar directo en la auditoría — sólo edit_completed_lesson_registration (security definer) puede escribir ahí'
);

select throws_ok(
  $$ update public.lesson_registration_edit_history set previous_snapshot = '{}'::jsonb where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'authenticated no puede hacer UPDATE directo sobre la auditoría — ni siquiera el propio dueño'
);

select throws_ok(
  $$ delete from public.lesson_registration_edit_history where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'authenticated no puede hacer DELETE directo sobre la auditoría — ni siquiera el propio dueño'
);

set local role anon;
select throws_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object('lesson_registration_id', gen_random_uuid(), 'edit_operation_id', gen_random_uuid(), 'participants', '[]'::jsonb)) $$,
  '42501',
  null,
  'anon no puede ejecutar edit_completed_lesson_registration'
);
select throws_ok(
  $$ select public.save_participant_registration(jsonb_build_object('lesson_registration_id', gen_random_uuid(), 'student_id', gen_random_uuid(), 'homework_reviews', '[]'::jsonb)) $$,
  '42501',
  null,
  'anon no puede ejecutar save_participant_registration'
);

-- save_participant_registration deja de aceptar escrituras sobre un registro ya completed — la única vía de edición real es edit_completed_lesson_registration.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select id from public.lesson_registrations where operation_id = 'a1000000-0000-0000-0000-000000000003'),
       'student_id', 'f1000000-0000-0000-0000-000000000001',
       'homework_reviews', '[]'::jsonb
     )) $$,
  '22023',
  null,
  'save_participant_registration rechaza escribir sobre un registro ya completed — usá edit_completed_lesson_registration'
);

select * from finish();
rollback;
