-- TeacherFlow Web — Fase 10: pruebas reales de la migración
-- `20261001160000_backup_import_null_singletons_and_undo_idempotency.sql`.
--   A) los 4 singletons opcionales (teacherProfile, budgetDistribution,
--      teacherAvailability, surchargeSettings.current) con JSON null, clave
--      ausente, objeto válido y objeto incompleto/inválido — en preview Y apply;
--   B) deshacer idempotente.
-- Todo con datos sintéticos "F5" y ROLLBACK al final. NUNCA lee un
-- `cloud_backups` real: los payloads se arman acá.

begin;
select plan(68);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f5000000-0000-0000-0000-000000000001', 'qa-bk-a@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f5000000-0000-0000-0000-000000000002', 'qa-bk-b@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('f5000000-0000-0000-0000-000000000003', 'qa-bk-c@example.com', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated');

set local role postgres;

-- Payloads sintéticos (forma normalizada que guarda `validateBackupPayload`).
create temp table pl (tag text primary key, doc jsonb);
create temp table prev_ids (tag text primary key, id uuid);
create temp table run_ids (tag text primary key, id uuid);
create temp table uprev_ids (tag text primary key, id uuid);
create temp table undo_res (tag text primary key, doc jsonb);
create temp table snap_after (tag text primary key, undone_at timestamptz, snaps int);
grant all on pl, prev_ids, run_ids, uprev_ids, undo_res, snap_after to authenticated;

insert into pl values ('nulls', $j$
{"schemaVersion":2,"exportedAt":"2026-10-01T00:00:00.000Z","appVersion":"1.0.0","students":[],"profiles":{},
 "recurrenceRules":[],"recurrenceExceptions":[],"calendarLessons":[],"teacherAvailability":null,"pedagogicalLessons":[],
 "paymentCharges":[],"payments":[],"paymentAllocations":[],"paymentAdjustments":[],"reportRecords":[],"packagePurchases":[],
 "packageCreditMovements":[],"teacherProfile":null,"monthlyAmountCorrections":[],"initialPaidSurchargeCorrections":[],
 "surchargeSettings":null,"budgetDistribution":null,"firstMonthProrationDecisions":[],"trainingBillingAgreements":[],"customLevels":[]}
$j$::jsonb);

insert into pl select 'absent', doc - 'teacherProfile' - 'budgetDistribution' - 'teacherAvailability' - 'surchargeSettings' from pl where tag = 'nulls';
insert into pl select 'surch_current_null', doc || '{"surchargeSettings":{"current":null,"pending":null,"pendingEffectiveFrom":null}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'valid', doc || $j$
{"teacherProfile":{"displayName":"F5 Profe"},
 "budgetDistribution":{"distribution":{"needs":50,"wants":30,"savings":20},"savingsGoal":{"enabled":false,"targetAmount":null,"targetDate":null}},
 "teacherAvailability":{"schemaVersion":1,"timezone":"America/Argentina/Buenos_Aires","weeklyBlocks":[],"exceptions":[]},
 "surchargeSettings":{"current":{"graceDay":10,"firstLateDay":11,"firstLatePercentage":10,"secondLateDay":19,"secondLatePercentage":15,"lastLateDay":27,"lastLatePercentage":20},"pending":null,"pendingEffectiveFrom":null}}
$j$::jsonb from pl where tag = 'nulls';

insert into pl select 'bad_budget_missing', doc || '{"budgetDistribution":{"distribution":{"needs":50,"savings":50},"savingsGoal":{"enabled":false,"targetAmount":null,"targetDate":null}}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'bad_budget_sum', doc || '{"budgetDistribution":{"distribution":{"needs":50,"wants":30,"savings":10},"savingsGoal":{"enabled":false,"targetAmount":null,"targetDate":null}}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'bad_budget_goal', doc || '{"budgetDistribution":{"distribution":{"needs":50,"wants":30,"savings":20},"savingsGoal":{"enabled":false}}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'bad_profile', doc || '{"teacherProfile":{"completedTutorialVersion":1}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'bad_availability', doc || '{"teacherAvailability":{"timezone":"America/Argentina/Buenos_Aires","exceptions":[]}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'bad_surcharge_missing', doc || '{"surchargeSettings":{"current":{"graceDay":10,"firstLateDay":11},"pending":null,"pendingEffectiveFrom":null}}'::jsonb from pl where tag = 'nulls';
insert into pl select 'bad_surcharge_order', doc || '{"surchargeSettings":{"current":{"graceDay":20,"firstLateDay":11,"firstLatePercentage":10,"secondLateDay":19,"secondLatePercentage":15,"lastLateDay":27,"lastLatePercentage":20},"pending":null,"pendingEffectiveFrom":null}}'::jsonb from pl where tag = 'nulls';

insert into pl select 'with_student', doc || $j$
{"students":[{"id":"f5-student-1","name":"F5 Alumno Import","levels":[],"initialLevel":"","modality":"presencial","status":"activo","category":"otro","billingType":"por_clase","dateJoined":"2026-01-01","usualDurationMinutes":60,"weeklyFrequency":1,"price":0}]}
$j$::jsonb from pl where tag = 'valid';

-- Ayudantes security definer (corren como postgres): leen tablas técnicas sin abrirlas a `authenticated`.
create function pg_temp.cls(p_tag text, p_path text[]) returns jsonb language sql security definer as
  $$ select classification #> p_path from public.import_previews where id = (select id from pg_temp.prev_ids where tag = p_tag) $$;
create function pg_temp.cnt(p_tbl text, p_owner uuid) returns int language plpgsql security definer as
  $$ declare n int; begin execute format('select count(*)::int from public.%I where owner_id = %L', p_tbl, p_owner) into n; return n; end $$;
create function pg_temp.snaps(p_run uuid) returns int language sql security definer as
  $$ select count(*)::int from public.import_run_row_snapshots where import_run_id = p_run $$;
create function pg_temp.singletons(p_owner uuid) returns int language sql security definer as
  $$ select (select count(*) from public.teacher_profiles where owner_id = p_owner)::int
          + (select count(*) from public.budget_distribution_settings where owner_id = p_owner)::int
          + (select count(*) from public.teacher_availability where owner_id = p_owner)::int
          + (select count(*) from public.surcharge_settings where owner_id = p_owner)::int $$;
create function pg_temp.run_status(p_run uuid) returns text language sql security definer as
  $$ select status from public.import_runs where id = p_run $$;
create function pg_temp.run_undone_at(p_run uuid) returns timestamptz language sql security definer as
  $$ select undone_at from public.import_runs where id = p_run $$;
grant execute on function pg_temp.cls(text, text[]), pg_temp.cnt(text, uuid), pg_temp.snaps(uuid), pg_temp.singletons(uuid), pg_temp.run_status(uuid), pg_temp.run_undone_at(uuid) to authenticated;

-- ===========================================================================
-- A) PREVIEW — owner A
-- ===========================================================================
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok($$ insert into prev_ids select 'nulls', preview_id from public.preview_backup_import((select doc from pl where tag = 'nulls'), '{}'::jsonb) $$, 'preview: los 4 singletons en JSON null no rompen la vista previa');
select is(
  (select array_to_string(array[
     pg_temp.cls('nulls', '{maestros,teacher_profiles,present_in_backup}')::text,
     pg_temp.cls('nulls', '{maestros,budget_distribution_settings,present_in_backup}')::text,
     pg_temp.cls('nulls', '{maestros,teacher_availability,present_in_backup}')::text,
     pg_temp.cls('nulls', '{insert_only,surcharge_settings,present_in_backup}')::text], ',')),
  'false,false,false,false',
  'preview con JSON null: ninguno de los 4 se anuncia (present_in_backup=false) — nunca "se creará"'
);
select is(
  (select count(*)::int from jsonb_object_keys(pg_temp.cls('nulls', '{maestros,budget_distribution_settings}')) k where k <> 'present_in_backup'),
  0,
  'preview con JSON null: la entrada no trae status/row_id/web/backup (no crear, vincular ni sobrescribir)'
);

select lives_ok($$ insert into prev_ids select 'absent', preview_id from public.preview_backup_import((select doc from pl where tag = 'absent'), '{}'::jsonb) $$, 'preview: las 4 claves ausentes funcionan');
select is(
  (select array_to_string(array[
     pg_temp.cls('absent', '{maestros,teacher_profiles,present_in_backup}')::text,
     pg_temp.cls('absent', '{maestros,budget_distribution_settings,present_in_backup}')::text,
     pg_temp.cls('absent', '{maestros,teacher_availability,present_in_backup}')::text,
     pg_temp.cls('absent', '{insert_only,surcharge_settings,present_in_backup}')::text], ',')),
  'false,false,false,false',
  'preview con claves ausentes: ninguno de los 4 se anuncia'
);

select lives_ok($$ insert into prev_ids select 'surch_current_null', preview_id from public.preview_backup_import((select doc from pl where tag = 'surch_current_null'), '{}'::jsonb) $$, 'preview: surchargeSettings.current = null funciona');
select is(
  pg_temp.cls('surch_current_null', '{insert_only,surcharge_settings,present_in_backup}')::text,
  'false',
  'preview con surchargeSettings.current null: recargos no se anuncian'
);

select lives_ok($$ insert into prev_ids select 'valid', preview_id from public.preview_backup_import((select doc from pl where tag = 'valid'), '{}'::jsonb) $$, 'preview: objetos válidos funcionan');
select is(
  (select array_to_string(array[
     pg_temp.cls('valid', '{maestros,teacher_profiles,status}') #>> '{}',
     pg_temp.cls('valid', '{maestros,budget_distribution_settings,status}') #>> '{}',
     pg_temp.cls('valid', '{maestros,teacher_availability,status}') #>> '{}',
     pg_temp.cls('valid', '{insert_only,surcharge_settings,status}') #>> '{}'], ',')),
  'insert,insert,insert,insert',
  'preview con objetos válidos: comportamiento actual intacto (los 4 se anuncian como alta)'
);

select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_budget_missing'), '{}'::jsonb) $$, '22023', null, 'preview: distribución incompleta (falta wants) se rechaza con 22023');
select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_budget_sum'), '{}'::jsonb) $$, '22023', null, 'preview: distribución que no suma 100 se rechaza con 22023');
select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_budget_goal'), '{}'::jsonb) $$, '22023', null, 'preview: objetivo de ahorro incompleto se rechaza con 22023');
select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_profile'), '{}'::jsonb) $$, '22023', null, 'preview: perfil sin displayName se rechaza con 22023');
select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_availability'), '{}'::jsonb) $$, '22023', null, 'preview: disponibilidad sin weeklyBlocks se rechaza con 22023');
select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_surcharge_missing'), '{}'::jsonb) $$, '22023', null, 'preview: recargos incompletos se rechazan con 22023');
select throws_ok($$ select * from public.preview_backup_import((select doc from pl where tag = 'bad_surcharge_order'), '{}'::jsonb) $$, '22023', null, 'preview: recargos con días en desorden se rechazan con 22023');
select is(pg_temp.cnt('import_previews', 'f5000000-0000-0000-0000-000000000001'), 4, 'preview: los rechazos no escribieron ningún preview (sólo los 4 válidos existen)');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000001'), 0, 'preview: no escribió ninguna fila de negocio');

-- ===========================================================================
-- A) APPLY — valores ausentes: cero filas creadas
-- ===========================================================================
select lives_ok($$ insert into run_ids select 'A_nulls', import_run_id from public.apply_backup_import((select id from prev_ids where tag = 'nulls'), '[]'::jsonb, '[]'::jsonb) $$, 'apply: JSON null en los 4 singletons aplica sin error (antes: 23502)');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000001'), 0, 'apply con JSON null: CERO filas creadas en teacher_profiles/budget/availability/surcharge');
select is(pg_temp.snaps((select id from run_ids where tag = 'A_nulls')), 0, 'apply con JSON null: sin snapshots (nada se escribió)');
select lives_ok($$ insert into run_ids select 'A_absent', import_run_id from public.apply_backup_import((select id from prev_ids where tag = 'absent'), '[]'::jsonb, '[]'::jsonb) $$, 'apply: claves ausentes aplican sin error');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000001'), 0, 'apply con claves ausentes: cero filas creadas');
select lives_ok($$ insert into run_ids select 'A_surch_null', import_run_id from public.apply_backup_import((select id from prev_ids where tag = 'surch_current_null'), '[]'::jsonb, '[]'::jsonb) $$, 'apply: surchargeSettings.current null aplica sin error');
select is(pg_temp.cnt('surcharge_settings', 'f5000000-0000-0000-0000-000000000001'), 0, 'apply con recargos null: no se inventó una fila de recargos con valores predeterminados');

-- ===========================================================================
-- A) APPLY — objetos válidos: comportamiento actual intacto
-- ===========================================================================
select lives_ok($$ insert into run_ids select 'A_valid', import_run_id from public.apply_backup_import((select id from prev_ids where tag = 'valid'), '[]'::jsonb, '[]'::jsonb) $$, 'apply: objetos válidos aplican');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000001'), 4, 'apply válido: se crearon las 4 filas');
set local role postgres;
select is(
  (select needs_percent || '/' || wants_percent || '/' || savings_percent || '/' || savings_goal_enabled from public.budget_distribution_settings where owner_id = 'f5000000-0000-0000-0000-000000000001'),
  '50/30/20/false',
  'apply válido: la distribución guardada es exactamente la del respaldo'
);
select is((select display_name from public.teacher_profiles where owner_id = 'f5000000-0000-0000-0000-000000000001'), 'F5 Profe', 'apply válido: el perfil guardado es el del respaldo');
select is((select timezone from public.teacher_availability where owner_id = 'f5000000-0000-0000-0000-000000000001'), 'America/Argentina/Buenos_Aires', 'apply válido: la disponibilidad guardada es la del respaldo');
select is(
  (select grace_day || '/' || last_late_day || '/' || last_late_percentage || '/' || enabled from public.surcharge_settings where owner_id = 'f5000000-0000-0000-0000-000000000001'),
  '10/27/20/false',
  'apply válido: recargos con los valores del respaldo y enabled=false (decisión de negocio vigente)'
);
select is(pg_temp.snaps((select id from run_ids where tag = 'A_valid')), 4, 'apply válido: 4 snapshots (uno por singleton insertado)');

-- ===========================================================================
-- A) APPLY — vista previa vieja (clasificada "alta" con JSON null) y rollback completo
-- ===========================================================================
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select lives_ok($$ insert into prev_ids select 'B_stale', preview_id from public.preview_backup_import((select doc from pl where tag = 'valid'), '{}'::jsonb) $$, 'owner B: preview válido (clasificado como alta)');
set local role postgres;
update public.import_previews set normalized_payload = (select doc from pl where tag = 'nulls') where id = (select id from prev_ids where tag = 'B_stale');
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select lives_ok($$ insert into run_ids select 'B_stale', import_run_id from public.apply_backup_import((select id from prev_ids where tag = 'B_stale'), '[]'::jsonb, '[]'::jsonb) $$, 'apply: una vista previa vieja (clasificada alta, payload con JSON null) ya no rompe');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000002'), 0, 'apply con vista previa vieja: cero filas inventadas');

set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000003", "role": "authenticated"}';
select lives_ok($$ insert into prev_ids select 'C_rollback', preview_id from public.preview_backup_import((select doc from pl where tag = 'with_student'), '{}'::jsonb) $$, 'owner C: preview con un alumno y singletons válidos');
set local role postgres;
update public.import_previews
  set normalized_payload = normalized_payload || '{"budgetDistribution":{"distribution":{"needs":50}}}'::jsonb
  where id = (select id from prev_ids where tag = 'C_rollback');
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000003", "role": "authenticated"}';
select throws_ok($$ select * from public.apply_backup_import((select id from prev_ids where tag = 'C_rollback'), '[]'::jsonb, '[]'::jsonb) $$, '22023', null, 'apply: un objeto incompleto se rechaza con 22023');
select is(pg_temp.cnt('students', 'f5000000-0000-0000-0000-000000000003'), 0, 'rollback completo: el alumno que se habría insertado antes NO quedó');
select is(pg_temp.cnt('import_runs', 'f5000000-0000-0000-0000-000000000003'), 0, 'rollback completo: no quedó ningún run');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000003'), 0, 'rollback completo: no quedó ninguna fila de singleton');

-- ===========================================================================
-- B) UNDO IDEMPOTENTE — owner A (run A_valid: 4 singletons)
-- ===========================================================================
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select lives_ok($$ insert into uprev_ids select 'A', undo_preview_id from public.preview_undo_backup_import((select id from run_ids where tag = 'A_valid')) $$, 'undo: preview del deshacer');
select lives_ok($$ insert into undo_res select 'first', summary from public.apply_undo_backup_import((select id from uprev_ids where tag = 'A')) $$, 'undo: el primer llamado seguro aplica');
select is((select doc->>'deleted_rows' from undo_res where tag = 'first'), '4', 'undo: el primer llamado borró las 4 filas insertadas');
select is((select doc->>'replayed' from undo_res where tag = 'first'), 'false', 'undo: el primer llamado no es un replay');
select is(pg_temp.singletons('f5000000-0000-0000-0000-000000000001'), 0, 'undo: los singletons importados ya no existen');
select is(pg_temp.run_status((select id from run_ids where tag = 'A_valid')), 'undone', 'undo: el run quedó undone');
select is(pg_temp.snaps((select id from run_ids where tag = 'A_valid')), 4, 'undo: los snapshots se conservan (historial intacto)');

set local role postgres;
insert into snap_after values ('after_first', (select undone_at from public.import_runs where id = (select id from run_ids where tag = 'A_valid')), (select count(*)::int from public.import_run_row_snapshots where import_run_id = (select id from run_ids where tag = 'A_valid')));
-- Una fila nueva, creada DESPUÉS del deshacer: el reintento no debe tocarla.
insert into public.teacher_profiles (owner_id, display_name) values ('f5000000-0000-0000-0000-000000000001', 'F5 posterior');
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok($$ insert into undo_res select 'retry', summary from public.apply_undo_backup_import((select id from uprev_ids where tag = 'A')) $$, 'undo: el reintento tras una respuesta perdida devuelve éxito (antes: "ya no es válido")');
select is((select doc->>'deleted_rows' from undo_res where tag = 'retry'), '4', 'undo: el reintento devuelve el resultado canónico (mismas 4 filas borradas)');
select is((select doc->>'replayed' from undo_res where tag = 'retry'), 'true', 'undo: el reintento está marcado como replay');
select is(pg_temp.cnt('teacher_profiles', 'f5000000-0000-0000-0000-000000000001'), 1, 'undo: el reintento NO borró la fila creada después del deshacer');
select lives_ok($$ select * from public.apply_undo_backup_import((select id from uprev_ids where tag = 'A')) $$, 'undo: un tercer reintento también converge');
select is(pg_temp.run_undone_at((select id from run_ids where tag = 'A_valid')), (select undone_at from snap_after where tag = 'after_first'), 'undo: los reintentos no modificaron undone_at');
select is(pg_temp.snaps((select id from run_ids where tag = 'A_valid')), (select snaps from snap_after where tag = 'after_first'), 'undo: los reintentos no tocaron los snapshots');

-- Rechazos que deben seguir siéndolo.
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000002", "role": "authenticated"}';
select throws_ok($$ select * from public.apply_undo_backup_import((select id from uprev_ids where tag = 'A')) $$, 'P0001', 'El preview de undo no existe o no te pertenece.', 'undo: un preview de undo AJENO se rechaza (aislamiento)');
select throws_ok($$ select * from public.preview_undo_backup_import((select id from run_ids where tag = 'A_valid')) $$, 'P0001', 'Importación no encontrada.', 'undo: un run AJENO no se puede previsualizar');

set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok($$ select * from public.preview_undo_backup_import((select id from run_ids where tag = 'A_valid')) $$, 'P0001', 'Esta importación ya fue deshecha.', 'undo: un run ya deshecho no admite un preview de undo nuevo');

-- Run descartado: renunció a poder deshacer.
select lives_ok($$ insert into prev_ids select 'valid2', preview_id from public.preview_backup_import((select doc from pl where tag = 'valid'), '{}'::jsonb) $$, 'undo: owner A genera un preview nuevo');
select lives_ok($$ insert into run_ids select 'A_second', import_run_id from public.apply_backup_import((select id from prev_ids where tag = 'valid2'), '[]'::jsonb, '[]'::jsonb) $$, 'undo: owner A importa de nuevo (otro run con singletons)');
select lives_ok($$ insert into uprev_ids select 'A2', undo_preview_id from public.preview_undo_backup_import((select id from run_ids where tag = 'A_second')) $$, 'undo: preview del segundo run');
select lives_ok($$ select public.discard_import_undo((select id from run_ids where tag = 'A_second')) $$, 'undo: renuncia a deshacer el segundo run (descarta snapshots)');
select throws_ok($$ select * from public.apply_undo_backup_import((select id from uprev_ids where tag = 'A2')) $$, 'P0001', 'Ya renunciaste a poder deshacer esta importación.', 'undo: un run descartado se rechaza (nunca "deshace" en vacío)');
select is(pg_temp.run_status((select id from run_ids where tag = 'A_second')), 'applied', 'undo: el run descartado sigue applied y sus filas intactas');

-- Preview de undo vencido/inválido.
set local role postgres;
select is(pg_temp.cnt('import_previews', 'f5000000-0000-0000-0000-000000000001') >= 4, true, 'undo: (control) hay previews de A');
insert into public.import_undo_previews (id, import_run_id, owner_id, is_safe, status)
  values ('f5a00000-0000-0000-0000-0000000000e1', (select id from run_ids where tag = 'A_second'), 'f5000000-0000-0000-0000-000000000001', true, 'expired');
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "f5000000-0000-0000-0000-000000000001", "role": "authenticated"}';
select throws_ok($$ select * from public.apply_undo_backup_import('f5a00000-0000-0000-0000-0000000000e1') $$, 'P0001', null, 'undo: un preview de undo vencido/inválido se rechaza');

-- ===========================================================================
-- Estructura: permisos
-- ===========================================================================
set local role anon;
select throws_ok($$ select public.apply_undo_backup_import('f5a00000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon: apply_undo_backup_import sin EXECUTE');
select throws_ok($$ select public._validate_singleton_doc('teacher_profiles', '{}'::jsonb) $$, '42501', null, 'anon: _validate_singleton_doc (interna) sin EXECUTE');
set local role authenticated;
select throws_ok($$ select public._jsonb_is_absent('null'::jsonb) $$, '42501', null, 'authenticated: _jsonb_is_absent (interna) sin EXECUTE');

select * from finish();
rollback;
