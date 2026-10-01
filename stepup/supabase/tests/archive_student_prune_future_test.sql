-- TeacherFlow Web — Fase 10: archivado con poda atómica de agenda futura.
-- Prueba real, pgTAP, contra `20260928110000_archive_student_prune_future.sql`.
--
-- IMPORTANTE: mismo procedimiento transaccional descartable que el resto de
-- pgTAP de este proyecto (ver docs/WEB_PARITY_PLAN.md §"Ejecución real de
-- pgTAP sin Docker") — copia temporal fuera del repo, pgtap instalado
-- dentro de una transacción que siempre termina en ROLLBACK.
--
-- Nota de concurrencia (mismo criterio ya documentado en
-- lesson_registration_rpc_ownership_test.sql): pgTAP corre en una única
-- sesión secuencial, no puede disparar dos requests genuinamente
-- simultáneas. La garantía de concurrencia real la da `for update` sobre
-- `students`/`recurrence_rules`/`calendar_lessons` (mismo patrón que
-- change_student_status/apply_recurrence_participants_from_date, ya
-- verificados) — lo que SÍ se prueba acá es la idempotencia real por
-- `operation_id` (doble clic/reintento nunca duplica ni reaplica).
--
-- DELETE directo, undo de importación y eliminación de cuenta ya se
-- prueban en `students_hard_delete_defense_test.sql` — no se repiten acá.
--
-- CONTRATO REAL de participants (confirmado por auditoría de escritores/
-- consumidores/datos reales, 2026-09-30 — ver comentario original de
-- `recurrence_rule_participants` en 20260916120200_calendar.sql, ya
-- aplicada: "participantes reales de TODA la serie, no sólo el alumno
-- principal"): `recurrence_rule_participants`/`calendar_lesson_participants`
-- son el ROSTER COMPLETO de cada serie/clase — el primario SIEMPRE está
-- incluido ahí también, nunca sólo los secundarios. `primary_student_id`
-- es un ROL ADICIONAL sobre ese roster completo (quién es el titular a
-- efectos de nombre/nivel mostrados y de a quién se le exige elegir
-- conservar/podar al archivar), NUNCA un criterio de exclusión de la tabla
-- de participantes. Por eso, al promover a alguien a primario
-- (series_promote/loose_reassign), ese alumno DEBE permanecer en su propia
-- fila de participante — sacarlo sería el bug, no dejarlo. Una sesión
-- futura NUNCA debe "corregir" esto interpretando participants como
-- "sólo secundarios" (ya pasó una vez en esta sesión, revertido).

begin;
select plan(71);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('29000000-0000-0000-0000-000000000001', 'qa-archive-prune-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('29000000-0000-0000-0000-000000000002', 'qa-archive-prune-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;

-- Alumnos owner1: K (conserva agenda), O (primario ajeno en la serie de P), P (secundario a podar),
-- A2 (primario solo), A3 (primario con grupo) + G1/G2 (grupo), A4 (clases sueltas) + G3 (grupo suelto), O2 (primario ajeno suelto).
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('29100000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', 'K Conserva Agenda', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000001', 'O Primario Ajeno Serie', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000003', '29000000-0000-0000-0000-000000000001', 'P Secundario A Podar', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000004', '29000000-0000-0000-0000-000000000001', 'A2 Primario Solo', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000005', '29000000-0000-0000-0000-000000000001', 'A3 Primario Con Grupo', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000006', '29000000-0000-0000-0000-000000000001', 'G1 Promovido', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000007', '29000000-0000-0000-0000-000000000001', 'G2 Se Queda', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000008', '29000000-0000-0000-0000-000000000001', 'A4 Clases Sueltas', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000009', '29000000-0000-0000-0000-000000000001', 'G3 Promovido Suelto', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000010', '29000000-0000-0000-0000-000000000001', 'O2 Primario Ajeno Suelta', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000011', '29000000-0000-0000-0000-000000000001', 'Reintento Idempotencia', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000012', '29000000-0000-0000-0000-000000000001', 'Fallo Intermedio Rollback', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000013', '29000000-0000-0000-0000-000000000001', 'Cargos E Historial Intactos', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29100000-0000-0000-0000-000000000014', '29000000-0000-0000-0000-000000000001', 'Restaurar Sin Recrear', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- Alumno de OTRO owner, para probar aislamiento (serie ajena referenciada por error/ataque).
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('29100000-0000-0000-0000-000000000099', '29000000-0000-0000-0000-000000000002', 'Alumno De Otro Owner', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- ---------------------------------------------------------------------------
-- Escenario 1: conservar agenda (remove_from_future = false)
-- ---------------------------------------------------------------------------
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('29200000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000001', 'K Conserva Agenda', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false);

-- ---------------------------------------------------------------------------
-- Escenario 2: alumno secundario a podar (series_participant_removal) — la
-- serie sigue igual, primario O intacto, sólo P sale del roster futuro.
-- ---------------------------------------------------------------------------
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('29300000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000002', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active');
-- Contrato real (confirmado por auditoría de escritores/consumidores/datos,
-- 2026-09-30): `participants` es el roster COMPLETO de la serie/clase,
-- primario incluido — `primary_student_id` es sólo un rol adicional sobre
-- ese roster, nunca un criterio de exclusión (ver comentario original de
-- `recurrence_rule_participants` en 20260916120200_calendar.sql: "no sólo
-- el alumno principal" = lo incluye, además de los demás). O (el primario)
-- se lista también como participante a propósito.
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('29000000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000002', '29100000-0000-0000-0000-000000000002'),
  ('29000000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000002', '29100000-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------------
-- Escenario 3: primario SIN otros participantes (series_end) — termina la
-- serie, cancela (nunca borra) su ocurrencia futura ya materializada; una
-- ocurrencia PASADA/completada de la misma serie queda intacta.
-- ---------------------------------------------------------------------------
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('29300000-0000-0000-0000-000000000004', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000004', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active');
-- A2 es el primario y no tiene otros participantes reales — modelo
-- inclusivo: se lista igual a sí mismo como participante (roster completo
-- de 1 solo alumno), "sin otros" se determina por participantes DISTINTOS
-- de A2, no por su ausencia en la tabla.
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('29000000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000004', '29100000-0000-0000-0000-000000000004');
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key) values
  ('29200000-0000-0000-0000-000000000003', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000004', 'A2 Primario Solo', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', true, '29300000-0000-0000-0000-000000000004', 'rule4:w1:c0:d0:t1800:s0'),
  ('29200000-0000-0000-0000-000000000004', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000004', 'A2 Primario Solo', 'B1', 'individual', '2026-08-03T21:00:00Z', '2026-08-03T22:00:00Z', 'presencial', 'completed', '#FCE4D2', true, '29300000-0000-0000-0000-000000000004', 'rule4:w0:c0:d0:t1800:s0');

-- ---------------------------------------------------------------------------
-- Escenario 4: primario CON grupo (series_promote) — se promueve a G1, G2
-- se queda, la clase ya materializada se reasigna, nunca se cancela.
-- ---------------------------------------------------------------------------
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('29300000-0000-0000-0000-000000000005', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000005', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('29000000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000005', '29100000-0000-0000-0000-000000000005'),
  ('29000000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000005', '29100000-0000-0000-0000-000000000006'),
  ('29000000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000005', '29100000-0000-0000-0000-000000000007');
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key) values
  ('29200000-0000-0000-0000-000000000005', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000005', 'A3 Primario Con Grupo', 'B1', 'group', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', true, '29300000-0000-0000-0000-000000000005', 'rule5:w4:c0:d0:t1800:s0');
-- A3 (primario de esta clase) se lista también a sí mismo como participante
-- — roster completo, modelo inclusivo. G1 (futuro promovido) YA es
-- participante real de esta clase materializada desde antes (roster
-- completo de la regla al momento de materializarla) — necesario para
-- probar que, al promoverlo, permanece en su propia fila.
insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level) values
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000005', '29100000-0000-0000-0000-000000000005', 'A3 Primario Con Grupo', 'B1'),
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000005', '29100000-0000-0000-0000-000000000006', 'G1 Promovido', 'B1'),
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000005', '29100000-0000-0000-0000-000000000007', 'G2 Se Queda', 'A2');

-- ---------------------------------------------------------------------------
-- Escenario 5: clases sueltas futuras.
-- ---------------------------------------------------------------------------
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('29200000-0000-0000-0000-000000000006', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000008', 'A4 Clases Sueltas', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false),
  ('29200000-0000-0000-0000-000000000007', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000008', 'A4 Clases Sueltas', 'B1', 'group', '2026-10-06T21:00:00Z', '2026-10-06T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false),
  ('29200000-0000-0000-0000-000000000008', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000010', 'O2 Primario Ajeno Suelta', 'B1', 'group', '2026-10-07T21:00:00Z', '2026-10-07T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false);
-- A4 y O2 son primarios de sus respectivas clases — ambos se listan también
-- a sí mismos como participantes, roster completo (modelo inclusivo).
insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level) values
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000007', '29100000-0000-0000-0000-000000000008', 'A4 Clases Sueltas', 'B1'),
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000007', '29100000-0000-0000-0000-000000000009', 'G3 Promovido Suelto', 'A2'),
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000008', '29100000-0000-0000-0000-000000000010', 'O2 Primario Ajeno Suelta', 'B1'),
  ('29000000-0000-0000-0000-000000000001', '29200000-0000-0000-0000-000000000008', '29100000-0000-0000-0000-000000000008', 'A4 Clases Sueltas', 'B1');

-- ---------------------------------------------------------------------------
-- Escenario 11: cargos e historial intactos.
-- ---------------------------------------------------------------------------
insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period) values
  ('29500000-0000-0000-0000-000000000013', '29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000013', 'mensual', 10000, '2026-09-10', '2026-09');
insert into public.student_status_history (owner_id, student_id, status, occurred_on) values
  ('29000000-0000-0000-0000-000000000001', '29100000-0000-0000-0000-000000000013', 'activo', '2026-01-01');

-- =============================================================================
-- Ejecución real, como el dueño real (authenticated), vía la RPC completa.
-- =============================================================================
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Escenario 1: conservar agenda.
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000001', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000001', 'remove_from_future', false
     )) $$,
  'archivar conservando la agenda funciona'
);

set local role postgres;
select is(
  (select status from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000001'),
  'scheduled',
  'conservar agenda: la clase futura de K sigue scheduled, intacta'
);
select is((select status from public.students where id = '29100000-0000-0000-0000-000000000001'), 'archivado', 'K quedó archivado igual, sólo sin poda');

-- Escenario 2: podar alumno secundario.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000003', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000002', 'remove_from_future', true,
       'series_participant_removal', jsonb_build_array(jsonb_build_object(
         'rule_id', '29300000-0000-0000-0000-000000000002',
         'freeze_occurrences', jsonb_build_array(jsonb_build_object(
           'occurrence_key', 'rule2:w3:c0:d0:t1800:s0', 'recurrence_index', 3,
           'start_at', '2026-09-21T21:00:00Z', 'end_at', '2026-09-21T22:00:00Z',
           'primary_student_id', '29100000-0000-0000-0000-000000000002', 'student_name', 'O Primario Ajeno Serie', 'level', 'B1',
           'lesson_type', 'group', 'modality', 'presencial', 'class_title', null, 'activity_kind', 'class', 'color', '#FCE4D2',
           'participants', jsonb_build_array(
             jsonb_build_object('student_id', '29100000-0000-0000-0000-000000000002', 'student_name', 'O Primario Ajeno Serie', 'level', 'B1'),
             jsonb_build_object('student_id', '29100000-0000-0000-0000-000000000003', 'student_name', 'P Secundario A Podar', 'level', 'B1')
           )
         ))
       ))
     )) $$,
  'podar alumno secundario funciona (congela con roster viejo, saca del roster futuro)'
);

set local role postgres;
select is(
  (select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = '29300000-0000-0000-0000-000000000002' and student_id = '29100000-0000-0000-0000-000000000003'),
  0,
  'P ya no está en el roster futuro de la serie'
);
select is(
  (select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = '29300000-0000-0000-0000-000000000002' and student_id = '29100000-0000-0000-0000-000000000002'),
  1,
  'O sigue en el roster — nunca se cancela la actividad de los demás'
);
select is(
  (select count(*)::int from public.calendar_lessons where recurrence_id = '29300000-0000-0000-0000-000000000002' and recurrence_occurrence_key = 'rule2:w3:c0:d0:t1800:s0' and status = 'scheduled'),
  1,
  'la ocurrencia congelada quedó materializada con el roster VIEJO (incluye a P, historia real preservada)'
);

-- Escenario 3: primario solo -> termina la serie, cancela (nunca borra) la futura, pasado intacto.
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000004', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000003', 'remove_from_future', true,
       'series_end', jsonb_build_array(jsonb_build_object('recurrence_id', '29300000-0000-0000-0000-000000000004'))
     )) $$,
  'archivar a un primario sin otros participantes funciona (termina la serie)'
);

set local role postgres;
select is((select status from public.recurrence_rules where id = '29300000-0000-0000-0000-000000000004'), 'ended', 'la serie quedó ended, nunca borrada');
select is(
  (select status from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000003'),
  'cancelled',
  'la ocurrencia futura ya materializada quedó cancelled — nunca se borró el registro'
);
select is(
  (select status from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000004'),
  'completed',
  'la ocurrencia PASADA/completada de la misma serie quedó completamente intacta'
);

-- Escenario 4: primario con grupo -> promoción determinística, reasignación, nunca cancela a los demás.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000005', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000004', 'remove_from_future', true,
       'series_promote', jsonb_build_array(jsonb_build_object(
         'rule_id', '29300000-0000-0000-0000-000000000005',
         'new_primary_student_id', '29100000-0000-0000-0000-000000000006',
         'new_primary_student_name', 'G1 Promovido', 'new_primary_level', 'A2',
         'freeze_occurrences', '[]'::jsonb
       ))
     )) $$,
  'archivar a un primario con grupo funciona (promueve, nunca cancela la actividad de los demás)'
);

set local role postgres;
select is(
  (select primary_student_id from public.recurrence_rules where id = '29300000-0000-0000-0000-000000000005'),
  '29100000-0000-0000-0000-000000000006'::uuid,
  'la serie promovió a G1 como nuevo primario, sigue activa'
);
select is(
  (select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = '29300000-0000-0000-0000-000000000005' and student_id = '29100000-0000-0000-0000-000000000005'),
  0,
  'A3 (el archivado) ya no está en el roster futuro de la serie'
);
select is(
  (select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = '29300000-0000-0000-0000-000000000005' and student_id = '29100000-0000-0000-0000-000000000007'),
  1,
  'G2 se queda en el roster, la serie sigue con sus demás integrantes'
);
select is(
  (select primary_student_id from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000005'),
  '29100000-0000-0000-0000-000000000006'::uuid,
  'la clase futura ya materializada se reasignó al nuevo primario, nunca se canceló'
);
select is(
  (select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = '29200000-0000-0000-0000-000000000005' and student_id = '29100000-0000-0000-0000-000000000005'),
  0,
  'A3 (el archivado) ya no es participante de la clase ya materializada'
);
select is(
  (select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = '29200000-0000-0000-0000-000000000005' and student_id = '29100000-0000-0000-0000-000000000007'),
  1,
  'G2 sigue siendo participante de esa misma clase — su actividad nunca se tocó'
);
-- Contrato inclusivo (explícito): G1, el RECIÉN PROMOVIDO, permanece en su
-- propia fila de participante — tanto de la serie como de la clase futura
-- ya reasignada. NUNCA se lo retira al promoverlo — eso sería el bug real
-- (ya se intentó "corregir" así en esta sesión y se revirtió).
select is(
  (select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = '29300000-0000-0000-0000-000000000005' and student_id = '29100000-0000-0000-0000-000000000006'),
  1,
  'G1 (recién promovido a primario) permanece en recurrence_rule_participants de su propia serie — modelo inclusivo, nunca se lo retira'
);
select is(
  (select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = '29200000-0000-0000-0000-000000000005' and student_id = '29100000-0000-0000-0000-000000000006'),
  1,
  'G1 también permanece como participante de la clase futura que él mismo pasó a presidir — mismo criterio: el cálculo real de fecha de incorporación/cobro (resolveEarliestParticipantOccurrenceDateInRange) depende de encontrarlo acá'
);

-- Escenario 5: clases sueltas.
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000008', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000005', 'remove_from_future', true,
       'loose_cancel', jsonb_build_array('29200000-0000-0000-0000-000000000006'),
       'loose_reassign', jsonb_build_array(jsonb_build_object(
         'lesson_id', '29200000-0000-0000-0000-000000000007',
         'new_primary_student_id', '29100000-0000-0000-0000-000000000009',
         'new_primary_student_name', 'G3 Promovido Suelto', 'new_primary_level', 'A2'
       )),
       'loose_remove_participant', jsonb_build_array('29200000-0000-0000-0000-000000000008')
     )) $$,
  'poda de clases sueltas funciona (cancela sola, reasigna con grupo, quita secundario)'
);

set local role postgres;
select is((select status from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000006'), 'cancelled', 'clase suelta con A4 solo -> cancelled, nunca borrada');
select is(
  (select primary_student_id from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000007'),
  '29100000-0000-0000-0000-000000000009'::uuid,
  'clase suelta con grupo -> reasignada a G3, nunca cancelada'
);
select is((select status from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000007'), 'scheduled', 'la clase reasignada sigue scheduled');
-- Contrato inclusivo (explícito): G3, el recién promovido en loose_reassign,
-- también permanece en calendar_lesson_participants de esa misma clase.
select is(
  (select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = '29200000-0000-0000-0000-000000000007' and student_id = '29100000-0000-0000-0000-000000000009'),
  1,
  'G3 (recién promovido en loose_reassign) permanece como participante de la clase suelta que pasó a presidir — modelo inclusivo, nunca se lo retira'
);
select is(
  (select count(*)::int from public.calendar_lesson_participants where calendar_lesson_id = '29200000-0000-0000-0000-000000000008' and student_id = '29100000-0000-0000-0000-000000000008'),
  0,
  'A4 como secundario en la clase de O2 -> se lo quita'
);
select is(
  (select primary_student_id from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000008'),
  '29100000-0000-0000-0000-000000000010'::uuid,
  'O2 sigue siendo el primario de su propia clase — nunca se tocó por archivar a A4'
);
select is((select status from public.calendar_lessons where id = '29200000-0000-0000-0000-000000000008'), 'scheduled', 'la clase de O2 sigue scheduled, nunca cancelada por archivar a un secundario');

-- Escenario 7: doble clic / reintento — mismo operation_id, dos llamadas.
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000011', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000011', 'remove_from_future', false
     )) $$,
  'primer intento real de archivar (idempotencia, primera llamada)'
);
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000011', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000011', 'remove_from_future', false
     )) $$,
  'reintentar CON EL MISMO operation_id (doble clic/respuesta perdida) nunca falla'
);
set local role postgres;
select is(
  (select count(*)::int from public.student_status_history where student_id = '29100000-0000-0000-0000-000000000011' and operation_id = '29900000-0000-0000-0000-000000000011'),
  1,
  'reintentar con el mismo operation_id NUNCA duplica el historial'
);

-- Escenario 9/10: fallo intermedio (referencia a una serie de OTRO owner) -> rollback total, incluido el status/historial ya escritos en la MISMA llamada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000012', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000012', 'remove_from_future', true,
       'series_end', jsonb_build_array(jsonb_build_object('recurrence_id', '29300000-0000-0000-0000-000000000099'))
     )) $$,
  '22023',
  null,
  'referenciar una serie inexistente/ajena rechaza TODA la operación — la capturó la verificación de autoridad (plan sobrante), antes incluso de llegar al chequeo de propiedad por entrada'
);

set local role postgres;
select is(
  (select status from public.students where id = '29100000-0000-0000-0000-000000000012'),
  'activo',
  'fallo intermedio: el status NUNCA cambió — rollback total, ni siquiera el UPDATE previo al fallo quedó aplicado'
);
select is(
  (select count(*)::int from public.student_status_history where student_id = '29100000-0000-0000-0000-000000000012'),
  0,
  'fallo intermedio: tampoco quedó ninguna entrada de historial huérfana'
);

-- Escenario 11: cargos e historial intactos tras archivar con poda.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29100000-0000-0000-0000-000000000013', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000013', 'remove_from_future', true
     )) $$,
  'archivar con poda (sin series/clases involucradas) funciona igual'
);
set local role postgres;
select is(
  (select count(*)::int from public.payment_charges where student_id = '29100000-0000-0000-0000-000000000013'),
  1,
  'el cargo existente sigue intacto — archivar nunca toca payment_charges'
);
select is(
  (select count(*)::int from public.student_status_history where student_id = '29100000-0000-0000-0000-000000000013'),
  2,
  'el historial previo (alta) + la nueva entrada (archivado) — nunca se borra ni se reemplaza'
);

-- Escenario 12: restaurar nunca reconstruye la agenda retirada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.change_student_status('29100000-0000-0000-0000-000000000004', 'activo', '2026-10-01', null, null) $$,
  'restaurar (RPC existente, sin poda) funciona sobre un alumno archivado con poda previa'
);
set local role postgres;
select is((select status from public.students where id = '29100000-0000-0000-0000-000000000004'), 'activo', 'el estado volvió a activo');
select is(
  (select status from public.recurrence_rules where id = '29300000-0000-0000-0000-000000000004'),
  'ended',
  'restaurar NUNCA revive la serie que se terminó al archivar — sigue ended, agenda no se reconstruye sola'
);

-- =============================================================================
-- AUTORIDAD REAL — auditoría de concurrencia (Fase 10, ronda 2): la RPC
-- recalcula el conjunto vivo DESPUÉS del lock y rechaza cualquier plan que
-- no coincida exacto — nunca confía en lo que calculó TypeScript.
-- =============================================================================

insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('29600000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', 'Race Clase Nueva Stale', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000001', 'Race Roster Cambia', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000003', '29000000-0000-0000-0000-000000000001', 'Race Roster Cambia Otro', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000004', '29000000-0000-0000-0000-000000000001', 'Race Array Vacio', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000005', '29000000-0000-0000-0000-000000000001', 'Race Id Sobrante', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000006', '29000000-0000-0000-0000-000000000001', 'Race Promocion Incorrecta', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000007', '29000000-0000-0000-0000-000000000001', 'G Temprano Correcto', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000008', '29000000-0000-0000-0000-000000000001', 'G Tarde Incorrecto', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000009', '29000000-0000-0000-0000-000000000001', 'Race Operation Id Distinto', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- Escenario 13: plan calculado -> aparece una clase futura NUEVA antes de llamar a la RPC -> rechazo (stale).
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('29700000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000001', 'Race Clase Nueva Stale', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false),
  ('29700000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000001', 'Race Clase Nueva Stale', 'B1', 'individual', '2026-10-06T21:00:00Z', '2026-10-06T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000001', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000901', 'remove_from_future', true,
       'loose_cancel', jsonb_build_array('29700000-0000-0000-0000-000000000001')
     )) $$,
  '22023',
  null,
  'plan que no incluye la clase futura NUEVA (creada después de planificar) se rechaza — nunca archiva con un plan stale'
);
set local role postgres;
select is((select status from public.students where id = '29600000-0000-0000-0000-000000000001'), 'activo', 'stale: el status NUNCA cambió');
select is((select status from public.calendar_lessons where id = '29700000-0000-0000-0000-000000000001'), 'scheduled', 'stale: la clase original sigue intacta, nunca se canceló a medias');
select is((select status from public.calendar_lessons where id = '29700000-0000-0000-0000-000000000002'), 'scheduled', 'stale: la clase nueva tampoco se tocó');

-- Escenario 14: el roster de una serie cambia DESPUÉS de calcular el plan -> rechazo total.
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('29800000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000002', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('29000000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000002');
-- El plan se calculó ANTES de esta línea, cuando todavía había un compañero
-- (29600000-...-003) — la carrera real: alguien lo saca de la serie justo
-- antes de que la RPC corra. Acá simplemente nunca se agrega, así que el
-- servidor ve "primario SOLO" pero el plan (viejo) todavía dice "promover".
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000002', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000902', 'remove_from_future', true,
       'series_promote', jsonb_build_array(jsonb_build_object(
         'rule_id', '29800000-0000-0000-0000-000000000001',
         'new_primary_student_id', '29600000-0000-0000-0000-000000000003',
         'new_primary_student_name', 'Race Roster Cambia Otro', 'new_primary_level', 'B1',
         'freeze_occurrences', '[]'::jsonb
       ))
     )) $$,
  '22023',
  null,
  'el roster real (sin el compañero que el plan viejo asumía) rechaza la promoción — el servidor nunca confía en el roster que TypeScript vio antes'
);
set local role postgres;
select is((select status from public.recurrence_rules where id = '29800000-0000-0000-0000-000000000001'), 'active', 'roster cambiado: la serie sigue activa, nunca terminó ni promovió a nadie');
select is((select primary_student_id from public.recurrence_rules where id = '29800000-0000-0000-0000-000000000001'), '29600000-0000-0000-0000-000000000002'::uuid, 'roster cambiado: el primario original nunca se reemplazó');

-- Escenario 15: arrays vacíos con remove_from_future=true habiendo filas futuras reales -> rechazo.
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('29700000-0000-0000-0000-000000000004', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000004', 'Race Array Vacio', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000004', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000903', 'remove_from_future', true
     )) $$,
  '22023',
  null,
  'arrays vacíos con remove_from_future=true habiendo una clase futura real se rechaza — nunca archiva "conservando" en silencio lo que debía podar'
);
set local role postgres;
select is((select count(*)::int from public.student_status_history where student_id = '29600000-0000-0000-0000-000000000004'), 0, 'fallo de validación: CERO entradas de historial — ni siquiera el status alcanzó a escribirse');
select is((select status from public.calendar_lessons where id = '29700000-0000-0000-0000-000000000004'), 'scheduled', 'fallo de validación: CERO poda — la clase sigue intacta');

-- Escenario 16: id adicional/sobrante (no corresponde a ninguna clase futura real del alumno) -> rechazo.
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('29700000-0000-0000-0000-000000000005', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000005', 'Race Id Sobrante', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false),
  ('29700000-0000-0000-0000-000000000006', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000005', 'Race Id Sobrante Pasada', 'B1', 'individual', '2026-08-01T21:00:00Z', '2026-08-01T22:00:00Z', 'presencial', 'completed', '#FCE4D2', false);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000005', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000904', 'remove_from_future', true,
       'loose_cancel', jsonb_build_array('29700000-0000-0000-0000-000000000005', '29700000-0000-0000-0000-000000000006')
     )) $$,
  '22023',
  null,
  'incluir una clase PASADA/completada de más (nunca elegible para podar) se rechaza — plan con ids sobrantes'
);
set local role postgres;
select is((select status from public.calendar_lessons where id = '29700000-0000-0000-0000-000000000006'), 'completed', 'la clase pasada nunca se tocó, ni siquiera al rechazar el plan');

-- Escenario 17: promoción incorrecta (no es el determinístico real) -> rechazo.
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('29800000-0000-0000-0000-000000000002', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000006', 'weekly', 1,
   '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id, created_at) values
  ('29000000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000002', '29600000-0000-0000-0000-000000000006', '2026-08-01T00:00:00Z'),
  ('29000000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000002', '29600000-0000-0000-0000-000000000007', '2026-08-02T00:00:00Z'),
  ('29000000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000002', '29600000-0000-0000-0000-000000000008', '2026-08-03T00:00:00Z');
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000006', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000905', 'remove_from_future', true,
       'series_promote', jsonb_build_array(jsonb_build_object(
         'rule_id', '29800000-0000-0000-0000-000000000002',
         'new_primary_student_id', '29600000-0000-0000-0000-000000000008',
         'new_primary_student_name', 'G Tarde Incorrecto', 'new_primary_level', 'B1',
         'freeze_occurrences', '[]'::jsonb
       ))
     )) $$,
  '22023',
  null,
  'promover al que entró DESPUÉS (G Tarde) en vez del determinístico real (G Temprano, created_at más antiguo) se rechaza'
);
set local role postgres;
select is((select primary_student_id from public.recurrence_rules where id = '29800000-0000-0000-0000-000000000002'), '29600000-0000-0000-0000-000000000006'::uuid, 'promoción incorrecta: el primario original nunca cambió');

-- Escenario 18: mismo operation_id + payload DISTINTO -> rechazo (nunca reaplica silenciosamente).
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000009', 'status', 'pausado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000906', 'remove_from_future', false
     )) $$,
  'primera llamada real con operation_id 906 (status pausado)'
);
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000009', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000906', 'remove_from_future', false
     )) $$,
  '22023',
  null,
  'reutilizar el MISMO operation_id con un payload DISTINTO (otro status) se rechaza — nunca aplica la nueva decisión en silencio'
);
set local role postgres;
select is((select status from public.students where id = '29600000-0000-0000-0000-000000000009'), 'pausado', 'el status quedó en el de la PRIMERA llamada real — la segunda (payload distinto) nunca se aplicó');
select is((select count(*)::int from public.student_status_history where student_id = '29600000-0000-0000-0000-000000000009'), 1, 'sigue habiendo una sola entrada de historial, nunca dos');

-- =============================================================================
-- Vías alternativas para archivar (Fase 10, ronda 3) — la RPC vieja
-- (change_student_status) debe rechazar específicamente 'archivado' y
-- conservar sin cambios sus otras 3 transiciones reales.
-- =============================================================================

insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('29600000-0000-0000-0000-000000000010', '29000000-0000-0000-0000-000000000001', 'Via Vieja Rechaza Archivado', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('29600000-0000-0000-0000-000000000011', '29000000-0000-0000-0000-000000000001', 'Via Vieja Otras Transiciones', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Escenario 19: change_student_status(..., 'archivado', ...) ahora se rechaza.
select throws_ok(
  $$ select public.change_student_status('29600000-0000-0000-0000-000000000010', 'archivado', '2026-09-29', null, null) $$,
  '22023',
  null,
  'la RPC vieja (change_student_status) rechaza explícitamente la transición a archivado — indica usar archive_student_and_prune_future'
);
set local role postgres;
select is((select status from public.students where id = '29600000-0000-0000-0000-000000000010'), 'activo', 'la vía vieja rechazada NUNCA cambió el status');
select is((select count(*)::int from public.student_status_history where student_id = '29600000-0000-0000-0000-000000000010'), 0, 'la vía vieja rechazada NUNCA dejó una entrada de historial huérfana');

-- Escenario 20: change_student_status conserva sin regresión pausar/dar de baja/restaurar.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.change_student_status('29600000-0000-0000-0000-000000000011', 'pausado', '2026-09-29', 'motivo real', null) $$,
  'change_student_status sigue funcionando para pausar, sin ningún cambio de comportamiento'
);
select lives_ok(
  $$ select public.change_student_status('29600000-0000-0000-0000-000000000011', 'inactivo', '2026-09-29', null, null) $$,
  'change_student_status sigue funcionando para dar de baja'
);
select lives_ok(
  $$ select public.change_student_status('29600000-0000-0000-0000-000000000011', 'activo', '2026-09-29', null, null) $$,
  'change_student_status sigue funcionando para restaurar (volver a activo)'
);
set local role postgres;
select is((select status from public.students where id = '29600000-0000-0000-0000-000000000011'), 'activo', 'las 3 transiciones reales (pausar/dar de baja/restaurar) se aplicaron en secuencia, sin regresión');
select is((select count(*)::int from public.student_status_history where student_id = '29600000-0000-0000-0000-000000000011'), 3, 'las 3 transiciones dejaron sus 3 entradas de historial reales');

-- =============================================================================
-- Escenario 21: idempotencia con canonicalización — mismo operation_id,
-- mismo plan, arrays en ORDEN DISTINTO -> replay canónico, nunca rechazo.
-- =============================================================================

insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('29600000-0000-0000-0000-000000000012', '29000000-0000-0000-0000-000000000001', 'Canonicalizacion Orden Distinto', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);
insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring) values
  ('29700000-0000-0000-0000-000000000012', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000012', 'Canonicalizacion Orden Distinto', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false),
  ('29700000-0000-0000-0000-000000000013', '29000000-0000-0000-0000-000000000001', '29600000-0000-0000-0000-000000000012', 'Canonicalizacion Orden Distinto', 'B1', 'individual', '2026-10-06T21:00:00Z', '2026-10-06T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', false);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "29000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000012', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000907', 'remove_from_future', true,
       'loose_cancel', jsonb_build_array('29700000-0000-0000-0000-000000000012', '29700000-0000-0000-0000-000000000013')
     )) $$,
  'primera llamada real (loose_cancel en orden A, B)'
);
select lives_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '29600000-0000-0000-0000-000000000012', 'status', 'archivado', 'occurred_on', '2026-09-28',
       'operation_id', '29900000-0000-0000-0000-000000000907', 'remove_from_future', true,
       'loose_cancel', jsonb_build_array('29700000-0000-0000-0000-000000000013', '29700000-0000-0000-0000-000000000012')
     )) $$,
  'reintentar con el MISMO operation_id y el MISMO plan, pero loose_cancel en orden B, A -> replay canónico, NUNCA se rechaza por el orden'
);
set local role postgres;
select is((select count(*)::int from public.student_status_history where student_id = '29600000-0000-0000-0000-000000000012'), 1, 'canonicalización real: sigue habiendo una sola entrada de historial pese al reorden');
select is((select status from public.calendar_lessons where id = '29700000-0000-0000-0000-000000000012'), 'cancelled', 'ambas clases quedaron canceladas de verdad (no un no-op silencioso)');
select is((select status from public.calendar_lessons where id = '29700000-0000-0000-0000-000000000013'), 'cancelled', 'ambas clases quedaron canceladas de verdad (no un no-op silencioso)');

select * from finish();
rollback;
