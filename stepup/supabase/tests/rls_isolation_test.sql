-- TeacherFlow Web — Fase 1: pruebas de aislamiento RLS entre dos usuarios.
--
-- IMPORTANTE (léase antes de asumir que esto ya se ejecutó): este entorno
-- de desarrollo NO tiene Docker ni el CLI de Supabase instalados, así que
-- estas pruebas NUNCA corrieron contra una base real todavía — ni local ni
-- contra el proyecto de producción (<project-ref>), al que
-- deliberadamente no me conecté con ninguna credencial (nunca uso ni pido
-- la contraseña de Postgres ni la service_role key). Este archivo es
-- pgTAP real, listo para ejecutarse con:
--
--   supabase test db
--
-- (requiere `supabase` CLI + Docker Desktop instalados por el usuario).
-- Hasta que alguien lo corra una vez, tratarlo como "escrito, no
-- verificado" — exactamente el mismo criterio que este proyecto ya aplica
-- a la validación física en dispositivo real.
--
-- Qué prueba: dos usuarios reales (auth.users + auth.identities, creados
-- acá mismo) nunca pueden verse los datos entre sí, en NINGUNA dirección
-- (ni SELECT, ni UPDATE, ni DELETE cruzado) sobre una muestra representativa
-- de tablas (una por cada patrón real del esquema: fila con owner_id
-- directo, fila relacionada por FK sin owner_id propio no existe en este
-- esquema — todas tienen owner_id denormalizado a propósito, ver
-- comentario de 20260916120200_calendar.sql). Extender este archivo con el
-- resto de las tablas es trabajo de continuación (ver
-- docs/WEB_PARITY_PLAN.md, Fase 1).

begin;
select plan(17);

-- Dos usuarios reales de prueba, directo en auth.users (igual que hace
-- Supabase internamente al confirmar un signup) — nunca se usa la API de
-- Auth acá porque pgTAP corre dentro de la misma transacción SQL.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('a0000000-0000-0000-0000-000000000001', 'qa-user-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', 'qa-user-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Alumno de Usuario 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Alumno de Usuario 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.students),
  1,
  'usuario 1 ve exactamente su propio alumno, nunca el de usuario 2'
);
select is(
  (select name from public.students limit 1),
  'Alumno de Usuario 1',
  'usuario 1 ve el NOMBRE de su propio alumno, nunca el ajeno'
);
select is(
  (select count(*)::int from public.students where id = 'b0000000-0000-0000-0000-000000000002'),
  0,
  'usuario 1 no puede leer el alumno de usuario 2 aunque conozca su id exacto'
);

-- Intento de escritura cruzada: actualizar el alumno de usuario 2 desde la
-- sesión de usuario 1 nunca debe afectar ninguna fila (RLS lo filtra en el
-- UPDATE, no lanza error — actualiza cero filas).
update public.students set name = 'Hackeado' where id = 'b0000000-0000-0000-0000-000000000002';
set local role postgres;
select is(
  (select name from public.students where id = 'b0000000-0000-0000-0000-000000000002'),
  'Alumno de Usuario 2',
  'un UPDATE cruzado desde la sesión de usuario 1 nunca modifica el alumno de usuario 2'
);

-- Intento de INSERT falsificando el owner_id de otro usuario: WITH CHECK
-- debe rechazarlo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.students (owner_id, name, modality, category, billing_type, date_joined, price)
     values ('a0000000-0000-0000-0000-000000000002', 'Alumno Falsificado', 'online', 'otro', 'mensual', '2026-01-01', 5000) $$,
  null,
  null,
  'usuario 1 nunca puede insertar un alumno declarando owner_id de usuario 2 (WITH CHECK lo rechaza)'
);

-- Simetría: usuario 2 ve exactamente lo suyo.
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select is(
  (select count(*)::int from public.students),
  1,
  'usuario 2 ve exactamente su propio alumno, nunca el de usuario 1'
);

-- ---------------------------------------------------------------------------
-- recurrence_rules + calendar_lessons (aislamiento sobre datos con FKs)
-- ---------------------------------------------------------------------------

set local role postgres;
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
values (
  'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001', 'weekly', 1,
  '[{"weekIndex":0,"sessions":[{"weekday":0,"hour":18,"minute":0,"durationMinutes":60}]}]'::jsonb,
  'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active'
);
insert into public.recurrence_rules (id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, status)
values (
  'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
  'b0000000-0000-0000-0000-000000000002', 'weekly', 1,
  '[{"weekIndex":0,"sessions":[{"weekday":1,"hour":19,"minute":0,"durationMinutes":60}]}]'::jsonb,
  'presencial', 'America/Argentina/Buenos_Aires', '2026-09-07', 'active'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select is(
  (select count(*)::int from public.recurrence_rules),
  1,
  'usuario 1 ve exactamente su propia serie de recurrencia'
);
select is(
  (select count(*)::int from public.recurrence_rules where id = 'c0000000-0000-0000-0000-000000000002'),
  0,
  'usuario 1 no puede leer la serie de usuario 2 aunque conozca su id exacto'
);
-- NOTA (Fase 10, 20261001100000): el DELETE cruzado cross-owner ya NO se
-- prueba acá sobre recurrence_rules — desde esa migración, `authenticated`
-- no tiene NINGÚN privilegio DELETE sobre esta tabla (ni propio ni ajeno;
-- cero RPC `security invoker` lo necesita, ver esa migración), así que un
-- DELETE directo ahora siempre falla con `42501 permission denied` antes
-- de que RLS llegue a evaluarse — ya no hay forma de distinguir "RLS lo
-- filtró" de "no tenía permiso" sobre esta tabla en particular, porque las
-- dos cosas bloquean por igual. El mismo patrón de prueba (RLS filtra el
-- USING de un DELETE cruzado, sin lanzar excepción, sobre una tabla que SÍ
-- conserva DELETE) se cubre más abajo con `teacher_availability`.
set local role postgres;

-- ---------------------------------------------------------------------------
-- payment_charges / payments / payment_allocations
-- ---------------------------------------------------------------------------

insert into public.payments (id, owner_id, student_id, amount, method, paid_at)
values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 10000, 'efectivo', '2026-09-10'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 10000, 'efectivo', '2026-09-10');

insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period)
values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'mensual', 10000, '2026-09-10', '2026-09'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'mensual', 10000, '2026-09-10', '2026-09');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select is(
  (select count(*)::int from public.payments),
  1,
  'usuario 1 ve exactamente su propio pago, nunca el de usuario 2'
);
select is(
  (select count(*)::int from public.payment_charges),
  1,
  'usuario 1 ve exactamente su propio cargo, nunca el de usuario 2'
);
select is(
  (select sum(amount)::int from public.payments),
  10000,
  'la suma de montos visible para usuario 1 nunca incluye el pago de usuario 2 (aislamiento financiero real, no sólo de filas)'
);

-- ---------------------------------------------------------------------------
-- teacher_availability / surcharge_settings / budget_distribution_settings
-- (documento único por owner_id — PK compuesta por owner_id)
-- ---------------------------------------------------------------------------

set local role postgres;
insert into public.teacher_availability (owner_id, timezone) values
  ('a0000000-0000-0000-0000-000000000001', 'America/Argentina/Buenos_Aires'),
  ('a0000000-0000-0000-0000-000000000002', 'America/Argentina/Buenos_Aires');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select is(
  (select count(*)::int from public.teacher_availability),
  1,
  'usuario 1 ve exactamente su propio documento de disponibilidad, nunca el de usuario 2'
);

set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select is(
  (select count(*)::int from public.teacher_availability),
  1,
  'usuario 2 ve exactamente su propio documento de disponibilidad, nunca el de usuario 1'
);

-- Un DELETE cruzado nunca lanza error (RLS filtra el USING antes de tocar
-- la fila — no es un permiso denegado explícito, simplemente no encuentra
-- ninguna fila que le pertenezca para borrar); se valida por conteo de
-- filas después, no por excepción. `teacher_availability` conserva DELETE
-- para `authenticated` (no tocada por 20261001100000), por eso sirve para
-- seguir probando este patrón real.
set local "request.jwt.claims" to '{"sub": "a0000000-0000-0000-0000-000000000001", "role": "authenticated"}';
delete from public.teacher_availability where owner_id = 'a0000000-0000-0000-0000-000000000002';
set local role postgres;
select is(
  (select count(*)::int from public.teacher_availability where owner_id = 'a0000000-0000-0000-0000-000000000002'),
  1,
  'un DELETE cruzado desde la sesión de usuario 1 nunca borra el documento de disponibilidad de usuario 2 (RLS filtra el USING antes del DELETE)'
);

-- ---------------------------------------------------------------------------
-- Anónimo (sin sesión): cero acceso a cualquier tabla privada.
-- ---------------------------------------------------------------------------

set local role anon;
reset "request.jwt.claims";
select is(
  (select count(*)::int from public.students),
  0,
  'un cliente anónimo (sin sesión) nunca ve ningún alumno de ningún profesor'
);
select is(
  (select count(*)::int from public.payment_charges),
  0,
  'un cliente anónimo (sin sesión) nunca ve ningún cargo de ningún profesor'
);
select is(
  (select count(*)::int from public.pending_training_billing_operations),
  0,
  'un cliente anónimo (sin sesión) nunca ve el diario durable de operaciones financieras de ningún profesor'
);

select * from finish();
rollback;
