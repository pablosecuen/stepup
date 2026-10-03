-- TeacherFlow Web — pruebas pgTAP de las RPC de Calendario/Alumnos contra
-- referencias cruzadas de propietario (brecha real encontrada al auditar
-- las RPC para el cierre de Fase 2/3, corregida en
-- `20260921100000_rpc_hardening_and_participants_from_date.sql`).
--
-- IMPORTANTE (mismo criterio que `rls_isolation_test.sql`): este entorno no
-- tiene Docker ni el CLI de Supabase instalados — este archivo NUNCA corrió
-- contra una base real todavía. Es pgTAP real, listo para ejecutarse con
-- `supabase test db` una vez que la migración de arriba esté aplicada.
-- Hasta entonces, tratarlo como "escrito, no verificado".
--
-- Qué prueba, que `rls_isolation_test.sql` NO cubre: RLS protege lecturas y
-- escrituras DIRECTAS sobre una tabla, pero un chequeo de FOREIGN KEY en
-- Postgres se evalúa SIN aplicar RLS sobre la tabla referenciada — así que,
-- sin una verificación explícita DENTRO de la función, un usuario
-- autenticado podía llamar a una RPC pasando el `student_id`/`recurrence_id`
-- de OTRO usuario (si lo conocía o lo adivinaba) y la fila hija se
-- insertaba igual, referenciando una fila ajena. Estas pruebas confirman
-- que las 6 RPC de escritura rechazan esa referencia cruzada explícitamente
-- (`P0002`, mismo código que "no encontrado" — nunca se distingue
-- "no existe" de "es de otro dueño", mismo criterio anti-enumeración que el
-- resto de la app), y que las llamadas con datos propios siguen funcionando.

begin;
select plan(11);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('e0000000-0000-0000-0000-000000000001', 'qa-rpc-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('e0000000-0000-0000-0000-000000000002', 'qa-rpc-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Alumno QA 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'Alumno QA 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
values (
  'e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001', 'weekly', 1,
  '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
  'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active'
);

-- ---------------------------------------------------------------------------
-- create_calendar_lesson
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "e0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', gen_random_uuid(),
       'primary_student_id', 'e1000000-0000-0000-0000-000000000002',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-09-21T21:00:00Z', 'end_at', '2026-09-21T22:00:00Z',
       'modality', 'presencial', 'participants', '[]'::jsonb
     )) $$,
  'P0002',
  null,
  'create_calendar_lesson rechaza un primary_student_id ajeno'
);

-- NOTA (Fase 10, 20261001140000): `participants` ya no puede ir vacío acá
-- — esa migración exige que `primary_student_id` esté DENTRO del roster
-- recibido (contrato inclusivo real, nunca sólo una excepción de prueba).
-- El payload real que manda la app SIEMPRE incluye al principal en
-- `participants` (ver `createSingleLessonAction`); esta prueba ya lo
-- hacía así para el camino grupal más abajo, sólo este caso mínimo
-- quedaba con el atajo de un array vacío.
select lives_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', gen_random_uuid(),
       'primary_student_id', 'e1000000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-09-21T21:00:00Z', 'end_at', '2026-09-21T22:00:00Z',
       'modality', 'presencial',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'e1000000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1'))
     )) $$,
  'create_calendar_lesson con un alumno propio sigue funcionando (el chequeo nuevo nunca bloquea el caso real, roster inclusivo)'
);

-- ---------------------------------------------------------------------------
-- create_recurrence_series
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_recurrence_series(jsonb_build_object(
       'operation_id', gen_random_uuid(),
       'primary_student_id', 'e1000000-0000-0000-0000-000000000001',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'modality', 'presencial', 'timezone', 'America/Argentina/Buenos_Aires',
       'start_date', '2026-09-07',
       'participant_ids', jsonb_build_array('e1000000-0000-0000-0000-000000000002')
     )) $$,
  'P0002',
  null,
  'create_recurrence_series rechaza un participante ajeno en participant_ids'
);

-- ---------------------------------------------------------------------------
-- cancel_calendar_occurrence / reschedule_calendar_occurrence — recurrence_id ajeno
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" to '{"sub": "e0000000-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.cancel_calendar_occurrence(jsonb_build_object(
       'recurrence_id', 'e2000000-0000-0000-0000-000000000001',
       'occurrence_key', 'e2000000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0',
       'primary_student_id', 'e1000000-0000-0000-0000-000000000002',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-09-21T21:00:00Z', 'end_at', '2026-09-21T22:00:00Z',
       'modality', 'presencial'
     )) $$,
  'P0002',
  null,
  'cancel_calendar_occurrence rechaza un recurrence_id de otro usuario'
);

select throws_ok(
  $$ select public.reschedule_calendar_occurrence(jsonb_build_object(
       'recurrence_id', 'e2000000-0000-0000-0000-000000000001',
       'occurrence_key', 'e2000000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0',
       'primary_student_id', 'e1000000-0000-0000-0000-000000000002',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'new_start_at', '2026-09-28T21:00:00Z', 'new_end_at', '2026-09-28T22:00:00Z',
       'modality', 'presencial', 'participants', '[]'::jsonb
     )) $$,
  'P0002',
  null,
  'reschedule_calendar_occurrence rechaza un recurrence_id de otro usuario'
);

-- ---------------------------------------------------------------------------
-- split_recurrence_this_and_future / apply_recurrence_participants_from_date
-- — sobre una serie PROPIA, pero con un participante ajeno.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" to '{"sub": "e0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'e2000000-0000-0000-0000-000000000001',
       'effective_date', '2026-09-28',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', '2026-09-21'),
       'successor_id', gen_random_uuid(),
       'successor_start_date', '2026-09-28',
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('e1000000-0000-0000-0000-000000000002'),
       'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'P0002',
  null,
  'split_recurrence_this_and_future rechaza un participante ajeno para la sucesora, aunque la serie original sea propia'
);

select throws_ok(
  $$ select public.apply_recurrence_participants_from_date(jsonb_build_object(
       'rule_id', 'e2000000-0000-0000-0000-000000000001',
       'new_participant_ids', jsonb_build_array('e1000000-0000-0000-0000-000000000002'),
       'freeze_occurrences', '[]'::jsonb
     )) $$,
  'P0002',
  null,
  'apply_recurrence_participants_from_date rechaza un alumno ajeno en new_participant_ids'
);

-- ---------------------------------------------------------------------------
-- Doble toque / idempotencia real: cancelar dos veces la MISMA clase suelta
-- nunca duplica ni falla la segunda vez — mismo resultado ambas veces.
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring)
values (
  'e3000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001', 'Alumno QA 1', 'B1', 'individual',
  '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "e0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.cancel_calendar_occurrence(jsonb_build_object('lesson_id', 'e3000000-0000-0000-0000-000000000001')) $$,
  'cancel_calendar_occurrence: primer toque cancela la clase suelta'
);
select lives_ok(
  $$ select public.cancel_calendar_occurrence(jsonb_build_object('lesson_id', 'e3000000-0000-0000-0000-000000000001')) $$,
  'cancel_calendar_occurrence: segundo toque (doble tap) sobre la misma clase no falla'
);

set local role postgres;
select is(
  (select count(*)::int from public.calendar_lessons where id = 'e3000000-0000-0000-0000-000000000001' and status = 'cancelled'),
  1,
  'el doble toque nunca duplica la fila — sigue habiendo exactamente una clase cancelada'
);

-- ---------------------------------------------------------------------------
-- Sesión anónima — ninguna RPC de escritura es ejecutable sin auth.uid().
-- ---------------------------------------------------------------------------
set local role anon;
reset "request.jwt.claims";

select throws_ok(
  $$ select public.create_calendar_lesson(jsonb_build_object(
       'operation_id', gen_random_uuid(),
       'primary_student_id', 'e1000000-0000-0000-0000-000000000001',
       'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-09-21T21:00:00Z', 'end_at', '2026-09-21T22:00:00Z',
       'modality', 'presencial', 'participants', '[]'::jsonb
     )) $$,
  '42501',
  null,
  'create_calendar_lesson rechaza una sesión anónima — 42501 por REVOKE explícito (20260926120000_legacy_rpcs_revoke_anon_execute.sql), bloquea antes de llegar a evaluar auth.uid() dentro del cuerpo (que daría 28000, expectativa vieja de este test, escrito antes de esa migración)'
);

select * from finish();
rollback;
