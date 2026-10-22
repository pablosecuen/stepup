-- TeacherFlow Web — pruebas de `20261022500000_swap_recurrence_patterns.sql` (intercambio de horarios: ambos cambios o ninguno).
-- Mismo procedimiento transaccional descartable que el resto de supabase/tests (pgTAP en la transacción, ROLLBACK al final).
-- Requiere la migración aplicada.

begin;
select plan(11);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f6000000-0000-0000-0000-000000000001', 'qa-swap@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f6100000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 'F6 Alumno A', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f6100000-0000-0000-0000-000000000002', 'f6000000-0000-0000-0000-000000000001', 'F6 Alumno B', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- A: viernes 19:00. B: viernes 20:00 con un cambio ya programado (viernes 21:00 desde el 23/11) que el intercambio reemplaza.
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, end_date, status, supersedes_recurrence_id, effective_from_date) values
  ('f6200000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-09-28', null, 'active', null, null),
  ('f6200000-0000-0000-0000-0000000000b1', 'f6000000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000002', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":20,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-09-28', '2026-11-22', 'active', null, null),
  ('f6200000-0000-0000-0000-0000000000b2', 'f6000000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000002', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":21,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-23', null, 'active', 'f6200000-0000-0000-0000-0000000000b1', '2026-11-23');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values
  ('f6000000-0000-0000-0000-000000000001', 'f6200000-0000-0000-0000-00000000000a', 'f6100000-0000-0000-0000-000000000001'),
  ('f6000000-0000-0000-0000-000000000001', 'f6200000-0000-0000-0000-0000000000b1', 'f6100000-0000-0000-0000-000000000002'),
  ('f6000000-0000-0000-0000-000000000001', 'f6200000-0000-0000-0000-0000000000b2', 'f6100000-0000-0000-0000-000000000002');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f6000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 1) Un fallo en el SEGUNDO lado (serie inexistente) revierte TAMBIÉN el primero: ninguna serie cambia a medias.
select throws_ok(
  $$ select public.swap_recurrence_patterns(jsonb_build_object('operations', jsonb_build_array(
       jsonb_build_object('end_rule_ids', '[]'::jsonb, 'split', jsonb_build_object(
         'original_recurrence_id', 'f6200000-0000-0000-0000-00000000000a', 'effective_date', '2026-10-23',
         'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-10-22'),
         'successor_id', 'f6300000-0000-0000-0000-00000000000a', 'successor_start_date', '2026-10-19', 'successor_end_date', null,
         'rule_type', 'weekly', 'cycle_length_weeks', 1,
         'weeks', '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":20,"minute":0,"durationMinutes":60}]}]'::jsonb,
         'participant_ids', jsonb_build_array('f6100000-0000-0000-0000-000000000001'), 'primary_student_id', 'f6100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb)),
       jsonb_build_object('end_rule_ids', '[]'::jsonb, 'split', jsonb_build_object(
         'original_recurrence_id', 'f6200000-0000-0000-0000-0000000000ff', 'effective_date', '2026-10-23',
         'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-10-22'),
         'successor_id', 'f6300000-0000-0000-0000-0000000000ff', 'successor_start_date', '2026-10-19', 'successor_end_date', null,
         'rule_type', 'weekly', 'cycle_length_weeks', 1,
         'weeks', '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
         'participant_ids', jsonb_build_array('f6100000-0000-0000-0000-000000000002'), 'primary_student_id', 'f6100000-0000-0000-0000-000000000002', 'excluded_occurrence_keys', '[]'::jsonb))
     ))) $$,
  'P0002', null, 'si el segundo lado falla, el intercambio entero se rechaza'
);
set local role postgres;
select is((select end_date from public.recurrence_rules where id = 'f6200000-0000-0000-0000-00000000000a'), null, 'la serie A NO cambió (sin fin)');
select is((select count(*)::int from public.recurrence_rules where supersedes_recurrence_id = 'f6200000-0000-0000-0000-00000000000a'), 0, 'la serie A no tiene sucesora creada');

-- 2) Dos veces la misma serie se rechaza.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f6000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.swap_recurrence_patterns(jsonb_build_object('operations', jsonb_build_array(
       jsonb_build_object('split', jsonb_build_object('original_recurrence_id', 'f6200000-0000-0000-0000-00000000000a', 'effective_date', '2026-10-23')),
       jsonb_build_object('split', jsonb_build_object('original_recurrence_id', 'f6200000-0000-0000-0000-00000000000a', 'effective_date', '2026-10-23'))
     ))) $$,
  '22023', null, 'la misma serie dos veces se rechaza'
);

-- 3) Intercambio sano: A pasa a 20:00 y B (tramo cortado b1) a 19:00; el cambio ya programado b2 se finaliza.
select lives_ok(
  $$ select public.swap_recurrence_patterns(jsonb_build_object('operations', jsonb_build_array(
       jsonb_build_object('end_rule_ids', '[]'::jsonb, 'split', jsonb_build_object(
         'original_recurrence_id', 'f6200000-0000-0000-0000-00000000000a', 'effective_date', '2026-10-23',
         'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-10-22'),
         'successor_id', 'f6300000-0000-0000-0000-00000000000a', 'successor_start_date', '2026-10-19', 'successor_end_date', null,
         'rule_type', 'weekly', 'cycle_length_weeks', 1,
         'weeks', '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":20,"minute":0,"durationMinutes":60}]}]'::jsonb,
         'participant_ids', jsonb_build_array('f6100000-0000-0000-0000-000000000001'), 'primary_student_id', 'f6100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb)),
       jsonb_build_object('end_rule_ids', jsonb_build_array('f6200000-0000-0000-0000-0000000000b2'), 'split', jsonb_build_object(
         'original_recurrence_id', 'f6200000-0000-0000-0000-0000000000b1', 'effective_date', '2026-10-23',
         'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-10-22'),
         'successor_id', 'f6300000-0000-0000-0000-0000000000b1', 'successor_start_date', '2026-10-19', 'successor_end_date', null,
         'rule_type', 'weekly', 'cycle_length_weeks', 1,
         'weeks', '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
         'participant_ids', jsonb_build_array('f6100000-0000-0000-0000-000000000002'), 'primary_student_id', 'f6100000-0000-0000-0000-000000000002', 'excluded_occurrence_keys', '[]'::jsonb))
     ))) $$,
  'el intercambio sano se aplica'
);
set local role postgres;
select is((select weeks->0->'sessions'->0->>'hour' from public.recurrence_rules where id = 'f6300000-0000-0000-0000-00000000000a'), '20', 'A queda a las 20:00');
select is((select weeks->0->'sessions'->0->>'hour' from public.recurrence_rules where id = 'f6300000-0000-0000-0000-0000000000b1'), '19', 'B queda a las 19:00');
select is((select status from public.recurrence_rules where id = 'f6200000-0000-0000-0000-0000000000b2'), 'ended', 'el cambio ya programado de B (reemplazado) se finalizó en la misma transacción');
select is((select end_date from public.recurrence_rules where id = 'f6200000-0000-0000-0000-00000000000a')::text, '2026-10-22', 'A vieja termina el día anterior');
select is((select count(*)::int from public.recurrence_rule_participants where recurrence_rule_id = 'f6300000-0000-0000-0000-0000000000b1'), 1, 'cada serie conserva sus alumnos (no se mueven)');

select * from finish();
rollback;
