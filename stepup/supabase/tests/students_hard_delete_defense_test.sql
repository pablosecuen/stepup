-- TeacherFlow Web — Fase 10: defensa contra DELETE directo sobre alumnos
-- (decisión de producto confirmada: nunca hard delete, sólo archivar/
-- restaurar). Prueba real, pgTAP, contra
-- `20260928100000_students_block_direct_delete.sql`.
--
-- IMPORTANTE: este archivo NUNCA corre con `supabase test db` (requiere
-- Docker, no disponible en este entorno) — se ejecuta con el mismo
-- procedimiento transaccional descartable documentado en
-- docs/WEB_PARITY_PLAN.md §"Ejecución real de pgTAP sin Docker": una copia
-- temporal fuera del repo instala pgtap DENTRO de una transacción que
-- siempre termina en ROLLBACK, nunca de forma permanente.

begin;
select plan(28);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('19000000-0000-0000-0000-000000000001', 'qa-delete-defense-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('19000000-0000-0000-0000-000000000002', 'qa-delete-defense-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values
  ('19100000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Alumno QA Delete-Defense 1', 'presencial', 'otro', 'mensual', '2026-01-01', 10000),
  ('19100000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000002', 'Alumno QA Delete-Defense 2', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.student_status_history (owner_id, student_id, status, occurred_on)
values ('19000000-0000-0000-0000-000000000001', '19100000-0000-0000-0000-000000000001', 'activo', '2026-01-01');

-- ---------------------------------------------------------------------------
-- 1-2) authenticated no puede borrar directamente ni su propio alumno ni uno ajeno.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$ delete from public.students where id = '19100000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'authenticated no puede borrar DIRECTAMENTE su propio alumno — el revoke bloquea antes de que RLS entre en juego'
);

select throws_ok(
  $$ delete from public.students where id = '19100000-0000-0000-0000-000000000002' $$,
  '42501',
  null,
  'authenticated no puede borrar DIRECTAMENTE un alumno ajeno'
);

-- ---------------------------------------------------------------------------
-- 3) anon no puede borrar.
-- ---------------------------------------------------------------------------
set local role anon;
reset "request.jwt.claims";
select throws_ok(
  $$ delete from public.students where id = '19100000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'anon no puede borrar ningún alumno'
);

-- ---------------------------------------------------------------------------
-- 4) ningún historial puede desaparecer por DELETE directo (ni siquiera del propio dueño).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ delete from public.student_status_history where student_id = '19100000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'authenticated no puede borrar directamente su propio historial de estado — nunca se borra ni se edita'
);

set local role postgres;
select is(
  (select count(*)::int from public.student_status_history where student_id = '19100000-0000-0000-0000-000000000001'),
  1,
  'el historial sigue intacto tras los intentos de DELETE directo bloqueados'
);

-- ---------------------------------------------------------------------------
-- 5) import undo autorizado SÍ puede borrar únicamente su fila importada
--    (security definer, corre como el dueño de la función, nunca afectado
--    por el revoke a authenticated/anon).
-- ---------------------------------------------------------------------------
set local role postgres;
insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price)
values ('19100000-0000-0000-0000-000000000003', '19000000-0000-0000-0000-000000000001', 'Alumno QA Importado (undo)', 'presencial', 'otro', 'mensual', '2026-01-01', 10000);

insert into public.import_previews (id, owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status)
values ('19200000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'qa-checksum', 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'applied');

insert into public.import_runs (id, owner_id, preview_id, status, backup_checksum, schema_version, summary, field_overrides, duplicate_decisions)
values ('19300000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', '19200000-0000-0000-0000-000000000001', 'applied', 'qa-checksum', 1, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);

insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
select
  '19300000-0000-0000-0000-000000000001',
  'students',
  '19100000-0000-0000-0000-000000000003',
  'inserted',
  null,
  to_jsonb(s)
from public.students s where s.id = '19100000-0000-0000-0000-000000000003';

insert into public.import_undo_previews (id, import_run_id, owner_id, is_safe, unsafe_rows, status)
values ('19400000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', true, '[]'::jsonb, 'pending');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.apply_undo_backup_import('19400000-0000-0000-0000-000000000001') $$,
  'apply_undo_backup_import (security definer) sigue funcionando tras revocar DELETE directo a authenticated/anon'
);

set local role postgres;
select is(
  (select count(*)::int from public.students where id = '19100000-0000-0000-0000-000000000003'),
  0,
  'el undo autorizado SÍ borró la fila que él mismo importó'
);
select is(
  (select count(*)::int from public.students where id = '19100000-0000-0000-0000-000000000001'),
  1,
  'el undo de la fila importada NUNCA tocó el otro alumno real del mismo dueño'
);

-- ---------------------------------------------------------------------------
-- 6) delete_own_account conserva su comportamiento aislado: cascada real
--    vía FK (nunca sujeta al DELETE directo revocado), nunca toca al otro owner.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select lives_ok(
  $$ select public.delete_own_account() $$,
  'delete_own_account sigue funcionando tras revocar DELETE directo a authenticated/anon (cascada real vía FK, no sujeta a ese revoke)'
);

set local role postgres;
select is(
  (select count(*)::int from public.students where id = '19100000-0000-0000-0000-000000000002'),
  0,
  'delete_own_account borró en cascada el alumno del dueño que se eliminó a sí mismo'
);
select is(
  (select count(*)::int from public.students where id = '19100000-0000-0000-0000-000000000001'),
  1,
  'delete_own_account de un dueño NUNCA toca los datos del otro dueño'
);

-- =============================================================================
-- Fase 10, ronda 4 — privilegios por columna sobre students (Diseño A).
-- owner2/owner4 ya no existen (delete_own_account los borró arriba) — se
-- usan owners e ids sintéticos nuevos, sin colisión.
-- =============================================================================

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('19500000-0000-0000-0000-000000000001', 'qa-col-grants-1@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('19500000-0000-0000-0000-000000000002', 'qa-col-grants-2@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;
insert into public.students (id, owner_id, name, phone, notes, levels, price, modality, category, billing_type, date_joined, legacy_mobile_id, status) values
  ('19600000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 'S1 Edicion Normal', null, null, '{}', 10000, 'presencial', 'otro', 'mensual', '2026-01-01', null, 'activo'),
  ('19600000-0000-0000-0000-000000000002', '19500000-0000-0000-0000-000000000001', 'S2 No UPDATE Status', null, null, '{}', 10000, 'presencial', 'otro', 'mensual', '2026-01-01', null, 'activo'),
  ('19600000-0000-0000-0000-000000000003', '19500000-0000-0000-0000-000000000001', 'S3 Mezcla Falla Completo', null, null, '{}', 10000, 'presencial', 'otro', 'mensual', '2026-01-01', null, 'activo'),
  ('19600000-0000-0000-0000-000000000004', '19500000-0000-0000-0000-000000000001', 'S4 No Legacy Mobile Id', null, null, '{}', 10000, 'presencial', 'otro', 'mensual', '2026-01-01', 'legacy-original', 'activo'),
  ('19600000-0000-0000-0000-000000000005', '19500000-0000-0000-0000-000000000002', 'S5 De Otro Owner', null, null, '{}', 10000, 'presencial', 'otro', 'mensual', '2026-01-01', null, 'activo'),
  ('19600000-0000-0000-0000-000000000006', '19500000-0000-0000-0000-000000000001', 'S6 Link Undo', null, null, '{}', 10000, 'presencial', 'otro', 'mensual', '2026-01-01', 'AFTER_LINK', 'activo');

-- 1) El dueño SÍ puede editar, en una sola sentencia, columnas de varios grupos permitidos.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ update public.students set name = 'S1 Editado', phone = '1122334455', notes = 'nota real', levels = array['B1'], price = 15000, is_featured = true where id = '19600000-0000-0000-0000-000000000001' $$,
  'el dueño puede editar name/phone/notes/levels/price/is_featured en una sola sentencia — todas columnas permitidas'
);
set local role postgres;
select is((select name from public.students where id = '19600000-0000-0000-0000-000000000001'), 'S1 Editado', 'la edición normal real se aplicó');

-- 2) El dueño NO puede hacer UPDATE directo de status.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ update public.students set status = 'archivado' where id = '19600000-0000-0000-0000-000000000002' $$,
  '42501',
  null,
  'el dueño NO puede hacer UPDATE directo de status — columna excluida de la allowlist'
);
set local role postgres;
select is((select status from public.students where id = '19600000-0000-0000-0000-000000000002'), 'activo', 'status nunca cambió por el intento directo');

-- 3) Mezclar una columna permitida (name) con una prohibida (status) en la MISMA sentencia falla COMPLETO.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ update public.students set name = 'Nunca Debe Quedar', status = 'archivado' where id = '19600000-0000-0000-0000-000000000003' $$,
  '42501',
  null,
  'mezclar name (permitida) + status (prohibida) en una sentencia rechaza TODO — nunca actualiza name parcialmente'
);
set local role postgres;
select is((select name from public.students where id = '19600000-0000-0000-0000-000000000003'), 'S3 Mezcla Falla Completo', 'name NUNCA cambió — el rechazo fue atómico, sin actualización parcial');

-- 4) El dueño NO puede editar legacy_mobile_id directo.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ update public.students set legacy_mobile_id = 'hackeado' where id = '19600000-0000-0000-0000-000000000004' $$,
  '42501',
  null,
  'el dueño NO puede editar legacy_mobile_id directo'
);
select throws_ok(
  $$ update public.students set updated_at = now() where id = '19600000-0000-0000-0000-000000000004' $$,
  '42501',
  null,
  'una columna técnica excluida (updated_at) tampoco puede modificarse directo'
);
set local role postgres;
select is((select legacy_mobile_id from public.students where id = '19600000-0000-0000-0000-000000000004'), 'legacy-original', 'legacy_mobile_id nunca cambió');

-- 5) Otro owner (columna permitida, pero fila ajena) y anon (ninguna columna) rechazados.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
update public.students set name = 'Intento Cruzado' where id = '19600000-0000-0000-0000-000000000005';
set local role postgres;
select is((select name from public.students where id = '19600000-0000-0000-0000-000000000005'), 'S5 De Otro Owner', 'UPDATE de una columna permitida sobre la fila de OTRO owner nunca afecta nada — RLS, no error, 0 filas');

set local role anon;
reset "request.jwt.claims";
select throws_ok(
  $$ update public.students set name = 'Anon Nunca' where id = '19600000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'anon sigue sin ningún privilegio UPDATE sobre students, ni siquiera en columnas permitidas para authenticated'
);

-- 6) Ambas RPC de estado rechazan un alumno ajeno.
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok(
  $$ select public.change_student_status('19600000-0000-0000-0000-000000000005', 'pausado', '2026-09-29', null, null) $$,
  'P0002',
  null,
  'change_student_status rechaza un alumno ajeno'
);
select throws_ok(
  $$ select public.archive_student_and_prune_future(jsonb_build_object(
       'student_id', '19600000-0000-0000-0000-000000000005', 'status', 'archivado', 'occurred_on', '2026-09-29',
       'operation_id', '19900000-0000-0000-0000-000000000001', 'remove_from_future', false
     )) $$,
  'P0002',
  null,
  'archive_student_and_prune_future rechaza un alumno ajeno'
);

-- 7) Import/link/undo real: restaura legacy_mobile_id vía apply_undo_backup_import
--    (SECURITY DEFINER — sigue funcionando aunque authenticated ya no tenga
--    UPDATE directo sobre esa columna).
set local role postgres;
insert into public.import_previews (id, owner_id, backup_checksum, schema_version, normalized_payload, classification, excluded_collections, status)
values ('19700000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 'qa-checksum-link', 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'applied');
insert into public.import_runs (id, owner_id, preview_id, status, backup_checksum, schema_version, summary, field_overrides, duplicate_decisions)
values ('19800000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000001', 'applied', 'qa-checksum-link', 1, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
select
  '19800000-0000-0000-0000-000000000001', 'students', '19600000-0000-0000-0000-000000000006', 'identity_linked',
  jsonb_build_object('name', s.name, 'phone', null, 'whatsapp', null, 'email', null, 'notes', null, 'birth_date', null,
    'current_goals', '[]'::jsonb, 'strengths', '[]'::jsonb, 'areas_to_improve', '[]'::jsonb, 'alerts', '[]'::jsonb,
    'usual_days', '[]'::jsonb, 'usual_time', null, 'legacy_mobile_id', 'BEFORE_LINK'),
  to_jsonb(s)
from public.students s where s.id = '19600000-0000-0000-0000-000000000006';
insert into public.import_undo_previews (id, import_run_id, owner_id, is_safe, unsafe_rows, status)
values ('19900000-0000-0000-0000-000000000002', '19800000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', true, '[]'::jsonb, 'pending');

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "19500000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok(
  $$ select public.apply_undo_backup_import('19900000-0000-0000-0000-000000000002') $$,
  'apply_undo_backup_import restaura legacy_mobile_id de un "link" (identity_linked) — SECURITY DEFINER, no afectado por el revoke de columna'
);
set local role postgres;
select is((select legacy_mobile_id from public.students where id = '19600000-0000-0000-0000-000000000006'), 'BEFORE_LINK', 'legacy_mobile_id se restauró de verdad al deshacer el link');

-- 8) Matriz real de grants por columna — coincide EXACTO con la allowlist declarada.
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'students'
     and has_column_privilege('authenticated', 'public.students', column_name, 'UPDATE')),
  array['alerts','areas_to_improve','billing_type','category','current_goals','email','initial_level','is_featured','levels','modality','name','notes','pending_homework','phone','price','strengths','usual_duration_minutes','weekly_frequency','whatsapp']::text[],
  'los grants reales de UPDATE por columna sobre students coinciden EXACTO con la allowlist declarada — ni una de más, ni una de menos'
);
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'students'
     and has_column_privilege('anon', 'public.students', column_name, 'UPDATE')),
  0,
  'anon sigue sin UPDATE en absolutamente ninguna columna de students'
);

select * from finish();
rollback;
