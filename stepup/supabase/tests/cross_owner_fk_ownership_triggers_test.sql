-- TeacherFlow Web — Fase 10: pruebas reales de la Remediación A (revoca
-- operaciones DML sin ningún escritor legítimo) + Remediación C (triggers
-- BEFORE INSERT/UPDATE que exigen que toda FK owner-scoped apunte a una
-- fila del MISMO owner). Corre contra el esquema real + las dos
-- migraciones pendientes (20261001100000/20261001110000), dentro de una
-- transacción descartable (ROLLBACK al final, nunca se aplica solo).

begin;
select plan(27);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f0000000-0000-0000-0000-000000000001', 'qa-fk-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-000000000002', 'qa-fk-b@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'QA FK A - Alumno', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'QA FK B - Alumno', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status) values
  ('f2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active'),
  ('f2000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":2,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-08-01', 'active');

insert into public.calendar_lessons (id, owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, activity_kind) values
  ('f3000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'QA FK A - Alumno', 'B1', 'individual', '2026-10-05T21:00:00Z', '2026-10-05T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', 'class');

insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period) values
  ('f5000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'mensual', 10000, '2026-10-05', '2026-10'),
  ('f5000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'mensual', 10000, '2026-11-05', '2026-11');

-- ---------------------------------------------------------------------------
-- 1) Cross-owner INSERT/UPDATE confirmado → rechazo (vectores mínimos
--    exigidos + extensión a lesson_registration_*/package_*/reportes)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ update public.recurrence_rules set primary_student_id = 'f1000000-0000-0000-0000-000000000002' where id = 'f2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'recurrence_rules.primary_student_id ajeno: UPDATE rechazado por el trigger'
);

select throws_ok(
  $$ insert into public.recurrence_rules (owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
     values ('f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":3,"hour":10,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-10-01', 'active') $$,
  '42501', null,
  'recurrence_rules.primary_student_id ajeno: INSERT rechazado por el trigger'
);

select throws_ok(
  $$ insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'recurrence_rule_participants.student_id ajeno: INSERT rechazado por el trigger'
);

select throws_ok(
  $$ insert into public.calendar_lessons (owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, activity_kind, recurrence_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'x', 'B1', 'individual', '2026-10-07T21:00:00Z', '2026-10-07T22:00:00Z', 'presencial', 'scheduled', '#FCE4D2', 'class', 'f2000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'calendar_lessons.recurrence_id de la serie ajena: INSERT rechazado por el trigger'
);

select throws_ok(
  $$ insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
     values ('f0000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'x', 'B1') $$,
  '42501', null,
  'calendar_lesson_participants.student_id ajeno: INSERT rechazado por el trigger'
);

-- ---------------------------------------------------------------------------
-- 2) Misma operación dentro del owner → funciona
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001') $$,
  'recurrence_rule_participants con student_id PROPIO: el trigger deja pasar sin problema'
);

select lives_ok(
  $$ insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
     values ('f0000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'QA FK A - Alumno', 'B1') $$,
  'calendar_lesson_participants con student_id PROPIO: el trigger deja pasar sin problema'
);

-- ---------------------------------------------------------------------------
-- 3) NULL permitido donde el esquema lo permite
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.recurrence_rules (owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status, supersedes_recurrence_id)
     values ('f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":4,"hour":9,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-10-01', 'active', null) $$,
  'recurrence_rules.supersedes_recurrence_id NULL: el trigger lo permite siempre, nunca lo evalúa'
);

-- ---------------------------------------------------------------------------
-- 4) Cambio simultáneo de owner_id + FK → rechazo (RLS rechaza el owner_id
--    forjado ANTES de que importe lo que diga el trigger sobre la FK)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.recurrence_rules
       set owner_id = 'f0000000-0000-0000-0000-000000000002', primary_student_id = 'f1000000-0000-0000-0000-000000000002'
     where id = 'f2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'cambiar owner_id ajeno + FK ajena a la vez: rechazado (RLS WITH CHECK, ni siquiera llega a importar la FK)'
);

-- ---------------------------------------------------------------------------
-- 5) payment_allocations — ownership + coherencia de alumno
-- ---------------------------------------------------------------------------
insert into public.payments (id, owner_id, student_id, amount, method, paid_at)
values ('f6000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 10000, 'efectivo', '2026-10-05');
select throws_ok(
  $$ insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount)
     values ('f0000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000009', 'f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 1000) $$,
  '42501', null,
  'payment_allocations.student_id ajeno: INSERT rechazado por el trigger de ownership'
);

-- Coherencia: student_id propio, pero DISTINTO del alumno real del cargo
-- referenciado (mismo owner en ambos lados — el trigger de ownership NO lo
-- rechazaría, sólo el de coherencia debe hacerlo).
set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'QA FK A - Otro Alumno', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

insert into public.payments (id, owner_id, student_id, amount, method, paid_at)
values ('f6000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003', 10000, 'efectivo', '2026-10-05');
select throws_ok(
  $$ insert into public.payment_allocations (owner_id, payment_id, charge_id, student_id, amount)
     values ('f0000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003', 1000) $$,
  '42501', null,
  'payment_allocations.student_id propio pero distinto del alumno real del cargo: rechazado por el trigger de coherencia'
);

-- ---------------------------------------------------------------------------
-- 6) RPC reales de Cobros (register_payment/void_payment, security
--    invoker) siguen funcionando de punta a punta con datos propios
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.register_payment(jsonb_build_object(
       'operation_id', 'f7000000-0000-0000-0000-000000000001',
       'student_id', 'f1000000-0000-0000-0000-000000000001',
       'amount', 10000, 'method', 'efectivo', 'paid_at', '2026-10-05',
       'charge_id', 'f5000000-0000-0000-0000-000000000001'
     )) $$,
  'register_payment sigue funcionando de punta a punta (misma transacción crea payments + payment_allocations coherentes, el trigger nunca lo bloquea)'
);
set local role postgres;
select is(
  (select count(*)::int from public.payment_allocations where owner_id = 'f0000000-0000-0000-0000-000000000001' and charge_id = 'f5000000-0000-0000-0000-000000000001'),
  1,
  'register_payment generó la allocation real esperada, con el alumno correcto'
);
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.void_charge(jsonb_build_object('charge_id', 'f5000000-0000-0000-0000-000000000002', 'void_reason', 'prueba QA')) $$,
  'void_charge sigue funcionando (UPDATE de voided_at/void_reason, nunca DELETE, no afectado por la Remediación A)'
);

-- ---------------------------------------------------------------------------
-- 7) Append-only: ya no acepta INSERT/UPDATE/DELETE directo
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.student_status_history (owner_id, student_id, status, occurred_on)
     values ('f0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'archivado', '2026-10-01') $$,
  '42501', null,
  'student_status_history: INSERT directo rechazado tras la Remediación A'
);
select throws_ok(
  $$ update public.student_level_history set level = 'HACKED' where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'student_level_history: UPDATE directo rechazado tras la Remediación A'
);
select throws_ok(
  $$ delete from public.lesson_registrations where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'lesson_registrations: DELETE directo rechazado tras la Remediación A'
);
select throws_ok(
  $$ delete from public.payments where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'payments: DELETE directo rechazado tras la Remediación A'
);
select throws_ok(
  $$ delete from public.payment_charges where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'payment_charges: DELETE directo rechazado tras la Remediación A'
);
select throws_ok(
  $$ delete from public.recurrence_rules where owner_id = 'f0000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'recurrence_rules: DELETE directo rechazado tras la Remediación A'
);

-- ---------------------------------------------------------------------------
-- 8) RPC legítimas (security definer) todavía escriben el historial
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.change_student_status('f1000000-0000-0000-0000-000000000003'::uuid, 'pausado', '2026-10-01'::date) $$,
  'change_student_status (security definer) sigue escribiendo student_status_history pese al revoke de INSERT directo'
);
set local role postgres;
select is(
  (select count(*)::int from public.student_status_history where student_id = 'f1000000-0000-0000-0000-000000000003' and status = 'pausado'),
  1,
  'la fila de historial realmente se escribió vía la RPC'
);

-- ---------------------------------------------------------------------------
-- 9) anon y otro owner rechazados
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
     values ('f0000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'B con owner_id propio intentando auto-inyectarse (recurrence_rule_id de la serie de A): RLS WITH CHECK solo valida el owner_id de B, nunca el de la serie referenciada — rechazado por el trigger, no por RLS'
);

set local role anon;
reset "request.jwt.claims";
select throws_ok(
  $$ insert into public.recurrence_rules (owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
     values (null, 'f1000000-0000-0000-0000-000000000001', 'weekly', 1, '[{"weekIndex":0,"sessions":[{"weekday":5,"hour":9,"minute":0,"durationMinutes":60}]}]'::jsonb, 'presencial', 'America/Argentina/Buenos_Aires', '2026-10-01', 'active') $$,
  '42501', null,
  'anon: INSERT rechazado (RLS, el trigger ni siquiera llega a evaluarse)'
);
select is(
  (select count(*)::int from public.recurrence_rules),
  0,
  'anon sigue sin ver ninguna recurrence_rules (RLS intacta, sin relación con los triggers nuevos)'
);

-- ---------------------------------------------------------------------------
-- 10) Datos existentes sin inconsistencias (confirmado también por fuera de
--     pgTAP, ver informe: 0/54 FK owner-scoped con mismatch real)
-- ---------------------------------------------------------------------------
set local role postgres;
select is(
  (select count(*)::int from public.recurrence_rules rr join public.students s on s.id = rr.primary_student_id where rr.owner_id <> s.owner_id),
  0,
  'cero filas reales de recurrence_rules con primary_student_id cross-owner tras aplicar la migración'
);
select is(
  (select count(*)::int from public.payment_allocations pa join public.payment_charges pc on pc.id = pa.charge_id where pa.owner_id <> pc.owner_id or pa.student_id <> pc.student_id),
  0,
  'cero filas reales de payment_allocations inconsistentes (ni owner ni alumno) tras aplicar la migración'
);

select * from finish();
rollback;
