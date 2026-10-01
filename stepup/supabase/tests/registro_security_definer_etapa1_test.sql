-- TeacherFlow Web — Fase 10, Registro Etapa 1: pruebas reales contra la
-- migración PENDIENTE `20261001120000_registro_security_definer_etapa1.sql`
-- (start_lesson_registration/save_participant_registration/
-- finalize_lesson_registration convertidas a SECURITY DEFINER). Mismo
-- procedimiento transaccional descartable de siempre — ROLLBACK al final,
-- nunca se aplica solo. No depende de RLS para proteger nada adentro de
-- las 3 funciones: cada prueba cross-owner verifica el rechazo EXPLÍCITO
-- de la función (`P0002`/`42501`), nunca "0 filas visibles por RLS".

begin;
select plan(36);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('de000000-0000-0000-0000-00000000000a', 'qa-registro-etapa1-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('de000000-0000-0000-0000-00000000000b', 'qa-registro-etapa1-b@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;

insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('de100000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-00000000000a', 'DE Individual', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('de100000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-00000000000a', 'DE Primario Grupal', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('de100000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-00000000000a', 'DE Secundario 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('de100000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-00000000000a', 'DE Secundario 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('de100000-0000-0000-0000-000000000005', 'de000000-0000-0000-0000-00000000000a', 'DE AdHoc', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('de100000-0000-0000-0000-000000000006', 'de000000-0000-0000-0000-00000000000a', 'DE YaMaterializada', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('de100000-0000-0000-0000-000000000009', 'de000000-0000-0000-0000-00000000000b', 'DE Alumno De B', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('de300000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-00000000000a', 'de100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('de300000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-00000000000a', 'de100000-0000-0000-0000-000000000002', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('de300000-0000-0000-0000-000000000009', 'de000000-0000-0000-0000-00000000000b', 'de100000-0000-0000-0000-000000000009', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active');

insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('de000000-0000-0000-0000-00000000000a', 'de300000-0000-0000-0000-000000000001', 'de100000-0000-0000-0000-000000000001'),
  ('de000000-0000-0000-0000-00000000000a', 'de300000-0000-0000-0000-000000000002', 'de100000-0000-0000-0000-000000000002'),
  ('de000000-0000-0000-0000-00000000000a', 'de300000-0000-0000-0000-000000000002', 'de100000-0000-0000-0000-000000000003'),
  ('de000000-0000-0000-0000-00000000000a', 'de300000-0000-0000-0000-000000000002', 'de100000-0000-0000-0000-000000000004'),
  ('de000000-0000-0000-0000-00000000000b', 'de300000-0000-0000-0000-000000000009', 'de100000-0000-0000-0000-000000000009');

insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, activity_kind) values
  ('de400000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-00000000000a', 'de100000-0000-0000-0000-000000000006', 'DE YaMaterializada', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', 'class'),
  ('de400000-0000-0000-0000-000000000009', 'de000000-0000-0000-0000-00000000000b', 'de100000-0000-0000-0000-000000000009', 'DE Alumno De B', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', 'class');

-- ===================== OWNER A (authenticated) =====================
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';

-- 1-3) Ocurrencia virtual INDIVIDUAL.
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', 'de300000-0000-0000-0000-000000000001',
       'occurrence_key', 'de300000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0', 'recurrence_index', 0,
       'primary_student_id', 'de100000-0000-0000-0000-000000000001',
       'student_name', 'DE Individual', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000001', 'student_name', 'DE Individual', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'A: start_lesson_registration — ocurrencia virtual individual funciona (DEFINER)'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lessons where recurrence_id = 'de300000-0000-0000-0000-000000000001'), 1, 'se materializó exactamente 1 calendar_lesson (individual)');
select is((select count(*)::int from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001'), 1, 'se creó exactamente 1 lesson_registration (individual)');

-- 4-5) Ocurrencia virtual GRUPAL — roster inclusivo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', 'de300000-0000-0000-0000-000000000002',
       'occurrence_key', 'de300000-0000-0000-0000-000000000002:w0:c0:d0:t1800:s0', 'recurrence_index', 0,
       'primary_student_id', 'de100000-0000-0000-0000-000000000002',
       'student_name', 'DE Primario Grupal', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000002', 'student_name', 'DE Primario Grupal', 'level', 'B1'),
         jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000003', 'student_name', 'DE Secundario 1', 'level', 'B1'),
         jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000004', 'student_name', 'DE Secundario 2', 'level', 'B1')
       ),
       'outcome', 'clase_dictada'
     )) $$,
  'A: start_lesson_registration — ocurrencia virtual GRUPAL funciona (DEFINER)'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lesson_participants clp join public.calendar_lessons cl on cl.id = clp.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002'), 3, 'roster inclusivo completo: 3 participantes (primario incluido)');

-- 6) Clase YA materializada (sin recurrence_id/occurrence_key).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', 'de400000-0000-0000-0000-000000000001',
       'primary_student_id', 'de100000-0000-0000-0000-000000000006',
       'student_name', 'DE YaMaterializada', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'activity_kind', 'class', 'counts_as_class', true,
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000006', 'student_name', 'DE YaMaterializada', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'A: start_lesson_registration — clase ya materializada funciona (DEFINER)'
);

-- 7) Ad-hoc con operation_id.
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'operation_id', 'de500000-0000-0000-0000-000000000001',
       'primary_student_id', 'de100000-0000-0000-0000-000000000005',
       'student_name', 'DE AdHoc', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000005', 'student_name', 'DE AdHoc', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'A: start_lesson_registration — ad-hoc con operation_id funciona (DEFINER)'
);

-- 8) recurrence_id de OTRO owner (B) -> rechazo explícito de la función.
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', 'de300000-0000-0000-0000-000000000009',
       'occurrence_key', 'de300000-0000-0000-0000-000000000009:w0:c0:d0:t1800:s0', 'recurrence_index', 0,
       'primary_student_id', 'de100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'P0002', null,
  'A: recurrence_id de B rechazado explícito por la función (no "0 filas de RLS")'
);

-- 9) calendar_lesson_id de OTRO owner (B) -> rechazo explícito.
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', 'de400000-0000-0000-0000-000000000009',
       'primary_student_id', 'de100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000001', 'student_name', 'x', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'P0002', null,
  'A: calendar_lesson_id de B rechazado explícito por la función'
);

-- 10) primary_student_id de OTRO owner (B) -> rechazo explícito.
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'operation_id', 'de500000-0000-0000-0000-000000000002',
       'primary_student_id', 'de100000-0000-0000-0000-000000000009', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000009', 'student_name', 'x', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'P0002', null,
  'A: primary_student_id de B rechazado explícito por la función'
);

-- 11-12) Mezcla de alumno propio + ajeno en participants -> rollback total, cero huérfanos.
select throws_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', 'de300000-0000-0000-0000-000000000002',
       'occurrence_key', 'de300000-0000-0000-0000-000000000002:w0:c0:d0:t1800:s1', 'recurrence_index', 1,
       'primary_student_id', 'de100000-0000-0000-0000-000000000002', 'student_name', 'x', 'level', 'B1', 'lesson_type', 'group',
       'start_at', '2026-10-12T21:00:00Z', 'end_at', '2026-10-12T22:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(
         jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000002', 'student_name', 'x', 'level', 'B1'),
         jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000009', 'student_name', 'x', 'level', 'B1')
       ),
       'outcome', 'clase_dictada'
     )) $$,
  'P0002', null,
  'A: mezcla de participante propio + de B rechazada — rollback total'
);
set local role postgres;
select is(
  (select count(*)::int from public.calendar_lessons where recurrence_id = 'de300000-0000-0000-0000-000000000002' and recurrence_occurrence_key = 'de300000-0000-0000-0000-000000000002:w0:c0:d0:t1800:s1'),
  0,
  'A: cero calendar_lessons huérfanas tras el fallo intermedio (ninguna materialización parcial)'
);

-- 13-16) save_participant_registration: asistencia/evaluación/tarea.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001'),
       'student_id', 'de100000-0000-0000-0000-000000000001',
       'participant_status', 'completed',
       'attendance', jsonb_build_object('status', 'presente', 'late_minutes', null),
       'evaluation', jsonb_build_object('general_grade', 9, 'skill_grades', '{}'::jsonb, 'strengths', '[]'::jsonb, 'areas_to_improve', '[]'::jsonb),
       'homework_reviews', jsonb_build_array(jsonb_build_object('task_id', 'common:de300000-0000-0000-0000-000000000001', 'outcome', 'realizada'))
     )) $$,
  'A: save_participant_registration — asistencia/evaluación/tarea funciona (DEFINER)'
);
set local role postgres;
select is((select a.status from public.lesson_registration_attendance a join public.lesson_registrations lr on lr.id = a.lesson_registration_id join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001'), 'presente', 'asistencia escrita correctamente');
select is((select general_grade from public.lesson_registration_evaluations e join public.lesson_registrations lr on lr.id = e.lesson_registration_id join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001')::int, 9, 'evaluación escrita correctamente');
select is((select count(*)::int from public.lesson_registration_homework_reviews h join public.lesson_registrations lr on lr.id = h.lesson_registration_id join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001'), 1, 'tarea escrita correctamente');

-- 17) lesson_registration_id de OTRO owner -> rechazo explícito.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', '00000000-0000-0000-0000-000000000000',
       'student_id', 'de100000-0000-0000-0000-000000000001', 'participant_status', 'completed'
     )) $$,
  'P0002', null,
  'A: lesson_registration_id inexistente/ajeno rechazado explícito'
);

-- 18) student_id que no pertenece a ESE registro -> rechazo explícito.
select throws_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001'),
       'student_id', 'de100000-0000-0000-0000-000000000002', 'participant_status', 'completed'
     )) $$,
  'P0002', null,
  'A: student_id ajeno a ese registro rechazado explícito'
);

-- 19) finalize_lesson_registration con participantes incompletos -> rechazo (grupal: sólo el primario completo).
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002'),
       'student_id', 'de100000-0000-0000-0000-000000000002', 'participant_status', 'completed'
     )) $$,
  'A: completar el primario del grupal (setup para la prueba de finalize incompleto)'
);
select throws_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002')
     )) $$,
  '22023', null,
  'A: finalize con participantes incompletos rechazado (grupal con 2 de 3 pendientes)'
);

-- 20) Completar el resto + finalize exitoso.
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002'),
       'student_id', 'de100000-0000-0000-0000-000000000003', 'participant_status', 'completed'
     )) $$,
  'A: completar secundario 1 del grupal'
);
select lives_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002'),
       'student_id', 'de100000-0000-0000-0000-000000000004', 'participant_status', 'completed'
     )) $$,
  'A: completar secundario 2 del grupal'
);
select lives_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002')
     )) $$,
  'A: finalize_lesson_registration — todos completos, funciona (DEFINER)'
);
set local role postgres;
select is((select status from public.calendar_lessons where recurrence_id = 'de300000-0000-0000-0000-000000000002'), 'completed', 'calendar_lessons.status pasó a completed tras finalize');
select is((select count(*)::int from public.payment_charges where owner_id = 'de000000-0000-0000-0000-00000000000a'), 0, 'finalize NUNCA genera payment_charges (fuera de su alcance, eso es sync_per_class_charge en Cobros)');

-- 21) finalize en registro de OTRO owner -> rechazo explícito.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select throws_ok(
  $$ select public.finalize_lesson_registration(jsonb_build_object('lesson_registration_id', '00000000-0000-0000-0000-000000000000')) $$,
  'P0002', null,
  'A: finalize sobre lesson_registration_id inexistente/ajeno rechazado explícito'
);

-- 22-23) edit_completed_lesson_registration (vía auditada, sin tocar) sigue funcionando después.
select lives_ok(
  $$ select public.edit_completed_lesson_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002'),
       'edit_operation_id', 'de600000-0000-0000-0000-000000000001',
       'participants', '[]'::jsonb
     )) $$,
  'A: edit_completed_lesson_registration (vía auditada) sigue funcionando sin cambios tras la conversión'
);
set local role postgres;
select is(
  (select count(*)::int from public.lesson_registration_edit_history h join public.lesson_registrations lr on lr.id = h.lesson_registration_id join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000002'),
  1,
  'la edición quedó auditada en lesson_registration_edit_history'
);

-- 24-25) Reintento idempotente — ad-hoc (mismo operation_id dos veces).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'operation_id', 'de500000-0000-0000-0000-000000000001',
       'primary_student_id', 'de100000-0000-0000-0000-000000000005',
       'student_name', 'DE AdHoc', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'activity_kind', 'class',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000005', 'student_name', 'DE AdHoc', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'A: reintento ad-hoc con el MISMO operation_id nunca falla (idempotente)'
);
set local role postgres;
select is((select count(*)::int from public.lesson_registrations where owner_id = 'de000000-0000-0000-0000-00000000000a' and operation_id = 'de500000-0000-0000-0000-000000000001'), 1, 'el reintento ad-hoc NUNCA duplica — sigue habiendo un solo registro');

-- 26-27) Reintento/concurrencia estructural — misma ocurrencia de serie dos veces.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000a", "role": "authenticated"}';
select lives_ok(
  $$ select public.start_lesson_registration(jsonb_build_object(
       'calendar_lesson_id', null, 'recurrence_id', 'de300000-0000-0000-0000-000000000001',
       'occurrence_key', 'de300000-0000-0000-0000-000000000001:w0:c0:d0:t1800:s0', 'recurrence_index', 0,
       'primary_student_id', 'de100000-0000-0000-0000-000000000001',
       'student_name', 'DE Individual', 'level', 'B1', 'lesson_type', 'individual',
       'start_at', '2026-10-05T21:00:00Z', 'end_at', '2026-10-05T22:00:00Z', 'modality', 'presencial',
       'activity_kind', 'class', 'counts_as_class', true, 'color', '#FCE4D2',
       'participants', jsonb_build_array(jsonb_build_object('student_id', 'de100000-0000-0000-0000-000000000001', 'student_name', 'DE Individual', 'level', 'B1')),
       'outcome', 'clase_dictada'
     )) $$,
  'A: reintentar la MISMA ocurrencia de serie nunca falla (idempotencia estructural, mismo índice único que protege la concurrencia real)'
);
set local role postgres;
select is((select count(*)::int from public.calendar_lessons where recurrence_id = 'de300000-0000-0000-0000-000000000001'), 1, 'sigue habiendo una sola calendar_lesson tras el reintento — sin duplicados');

-- ===================== ANON =====================
set local role anon;
reset "request.jwt.claims";

select throws_ok(
  $$ select public.start_lesson_registration('{}'::jsonb) $$,
  '42501', null,
  'anon: start_lesson_registration sin EXECUTE'
);
select throws_ok(
  $$ select public.save_participant_registration('{}'::jsonb) $$,
  '42501', null,
  'anon: save_participant_registration sin EXECUTE'
);
select throws_ok(
  $$ select public.finalize_lesson_registration('{}'::jsonb) $$,
  '42501', null,
  'anon: finalize_lesson_registration sin EXECUTE'
);

-- ===================== OWNER B =====================
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "de000000-0000-0000-0000-00000000000b", "role": "authenticated"}';
select throws_ok(
  $$ select public.save_participant_registration(jsonb_build_object(
       'lesson_registration_id', (select lr.id from public.lesson_registrations lr join public.calendar_lessons cl on cl.id = lr.calendar_lesson_id where cl.recurrence_id = 'de300000-0000-0000-0000-000000000001'),
       'student_id', 'de100000-0000-0000-0000-000000000001', 'participant_status', 'completed'
     )) $$,
  'P0002', null,
  'B: intentando guardar sobre un registro y alumno de A — rechazado explícito (ambos ajenos a B)'
);

select * from finish();
rollback;
