-- TeacherFlow Web — pruebas reales de la migración PENDIENTE
-- `20261004120000_split_original_patch_end_date_contract.sql` (contrato `original_patch.end_date` del split
-- "esta y las siguientes"). Mismo procedimiento transaccional descartable que el resto de supabase/tests — ROLLBACK al final.
-- (R8, 2026-10-12: los casos 6-7 pasaron de «endDate se acepta» a «endDate se rechaza»; ejecutados con el mismo contenido por `supabase/tests/postgres/r8_retire.cjs`.)
-- Corrida 22/22 el 2026-10-05 dentro de un ensayo transaccional con ROLLBACK (pgTAP instalado sólo en la transacción, migración
-- aplicada sólo en la transacción): supabase/repairs/20261004_p1_rehearsal_rollback.sql. Requiere la migración aplicada.

begin;
select plan(22);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f4000000-0000-0000-0000-000000000001', 'qa-split-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f4100000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'F4 Alumno 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f4100000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', 'F4 Alumno 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

-- Series originales (lunes 18:00, start_date SIEMPRE lunes): R1 canónica, R2 legado, R3 ambas claves, R4 rechazos, R5 cierre.
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('f4200000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000004', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-02', 'active'),
  ('f4200000-0000-0000-0000-000000000005', 'f4000000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-11-30', 'active');
insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
select 'f4000000-0000-0000-0000-000000000001', r.id, 'f4100000-0000-0000-0000-000000000001'
from public.recurrence_rules r where r.owner_id = 'f4000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 1-5) Clave canónica `end_date`: la original queda activa y con fin = día anterior a la fecha efectiva.
select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000001', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-15'),
       'successor_id', 'f4300000-0000-0000-0000-000000000001', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000002'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'split con original_patch.end_date (canónica) funciona'
);
set local role postgres;
select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000001')::text, '2026-11-15', 'la original queda con end_date = día anterior a effective_date');
select is((select status from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000001'), 'active', 'la original sigue active (hasta su fin)');
select is((select effective_from_date from public.recurrence_rules where id = 'f4300000-0000-0000-0000-000000000001')::text, '2026-11-16', 'la sucesora rige desde effective_date');
select is((select superseded_by_recurrence_id from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000001')::text, 'f4300000-0000-0000-0000-000000000001', 'la original apunta a su sucesora');

-- 6-7) R8 retiró la compatibilidad `endDate`: un cliente que manda SÓLO `endDate` (camelCase) se rechaza (22023) y no se escribe nada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000002', 'effective_date', '2026-11-23',
       'original_patch', jsonb_build_object('status', 'active', 'endDate', '2026-11-22'),
       'successor_id', 'f4300000-0000-0000-0000-000000000002', 'successor_start_date', '2026-11-23', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'split con SÓLO original_patch.endDate (clave retirada en R8): se rechaza (22023)'
);
set local role postgres;
select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000002'), null, 'endDate retirado: la original queda intacta, sin fin');

-- 8-9) Si llegan las dos claves, gana (y es la única que se lee) la canónica `end_date`.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000003', 'effective_date', '2026-11-23',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-22', 'endDate', '2026-11-10'),
       'successor_id', 'f4300000-0000-0000-0000-000000000003', 'successor_start_date', '2026-11-23', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'split con las dos claves funciona'
);
set local role postgres;
select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000003')::text, '2026-11-22', 'con las dos claves gana end_date');

-- 10-12) Original que quedaría activa sin fecha de fin determinable: se rechaza y NO se escribe nada.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1,
       'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'original active sin end_date/endDate: se rechaza (22023)'
);
set local role postgres;
select is((select end_date from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000004'), null, 'rechazo: la original queda intacta (end_date sigue vacía)');
select is((select count(*)::int from public.recurrence_rules where id = 'f4300000-0000-0000-0000-000000000004'), 0, 'rechazo: no se creó ninguna sucesora');

-- 13-15) Validaciones de fechas y estado.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-16'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'el fin igual a la fecha efectiva se rechaza (debe ser anterior)'
);
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-10-31'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'el fin anterior al inicio de la serie original se rechaza'
);
select throws_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000004', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'paused', 'end_date', '2026-11-15'),
       'successor_id', 'f4300000-0000-0000-0000-000000000004', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  '22023', null,
  'un status distinto de active/ended se rechaza'
);

-- 16-17) status ended (el cambio rige desde el propio inicio de la serie): la fecha de fin es opcional.
select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000005', 'effective_date', '2026-11-30',
       'original_patch', jsonb_build_object('status', 'ended', 'end_date', null),
       'successor_id', 'f4300000-0000-0000-0000-000000000005', 'successor_start_date', '2026-11-30', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'status ended sin end_date: se acepta'
);
set local role postgres;
select is((select status from public.recurrence_rules where id = 'f4200000-0000-0000-0000-000000000005'), 'ended', 'la original queda finalizada');

-- 18-19) Idempotencia: repetir el mismo split devuelve la sucesora existente, nunca crea otra.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f4000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.split_recurrence_this_and_future(jsonb_build_object(
       'original_recurrence_id', 'f4200000-0000-0000-0000-000000000001', 'effective_date', '2026-11-16',
       'original_patch', jsonb_build_object('status', 'active', 'end_date', '2026-11-15'),
       'successor_id', 'f4300000-0000-0000-0000-0000000000ff', 'successor_start_date', '2026-11-16', 'successor_end_date', null,
       'rule_type', 'weekly', 'cycle_length_weeks', 1, 'weeks', '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
       'participant_ids', jsonb_build_array('f4100000-0000-0000-0000-000000000001'),
       'primary_student_id', 'f4100000-0000-0000-0000-000000000001', 'excluded_occurrence_keys', '[]'::jsonb
     )) $$,
  'repetir el mismo split no falla'
);
set local role postgres;
select is((select count(*)::int from public.recurrence_rules where supersedes_recurrence_id = 'f4200000-0000-0000-0000-000000000001'), 1, 'repetir el split no crea una segunda sucesora');

-- 20) Invariante anti-duplicación: ninguna original activa queda sin fin o con fin no anterior a la fecha efectiva de su sucesora.
select is(
  (select count(*)::int
     from public.recurrence_rules p
     join public.recurrence_rules s on s.supersedes_recurrence_id = p.id and p.superseded_by_recurrence_id = s.id
    where p.owner_id = 'f4000000-0000-0000-0000-000000000001'
      and s.effective_from_date is not null and p.status = 'active'
      and (p.end_date is null or p.end_date >= s.effective_from_date)),
  0,
  'invariante: ninguna serie original activa sigue generando ocurrencias después de la fecha efectiva de su sucesora'
);

-- 21-22) Permisos (regla del proyecto): anon sin EXECUTE, authenticated con EXECUTE.
select ok(not has_function_privilege('anon', 'public.split_recurrence_this_and_future(jsonb)', 'execute'), 'anon no puede ejecutar la RPC');
select ok(has_function_privilege('authenticated', 'public.split_recurrence_this_and_future(jsonb)', 'execute'), 'authenticated sí puede ejecutarla');

select * from finish();
rollback;
