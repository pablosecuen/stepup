-- R5 — Rollback MANUAL de la higiene de privilegios (NO es una migración; no se aplica con `db push`). Devuelve la base EXACTAMENTE al estado
-- previo a R5 (privilegios de tabla de anon y authenticated, políticas TO public, search_path de las 19 funciones, EXECUTE de set_updated_at,
-- privilegios por defecto y RLS del registro). Es una REGRESIÓN DE SEGURIDAD deliberada: ejecutarlo sólo si R5 rompiera algo que la
-- aplicación necesita, y volver a aplicar R5 después de corregirlo. Cada bloque se puede ejecutar por separado.
--
-- Orden recomendado ante un problema: identificar qué bloque corresponde (A privilegios, B políticas, C funciones), ejecutar sólo ese, y
-- `supabase migration repair --status reverted <versión>` de la migración correspondiente (A=20261009100000, B=20261009110000, C=20261009120000).
-- La lista de GRANT de A se generó desde el estado real de Production antes de R5 (7/oct/2026).

-- ===== A) privilegios de tabla, registro y privilegios por defecto =====
alter table public.import_undo_dependency_registry disable row level security;

-- anon (estado previo exacto)
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.budget_distribution_settings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_lesson_participants to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.calendar_lessons to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.custom_levels to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.first_month_proration_decisions to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.import_undo_dependency_registry to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.initial_paid_surcharge_corrections to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.lesson_registration_attendance to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER on table public.lesson_registration_edit_history to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.lesson_registration_evaluations to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.lesson_registration_homework_reviews to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.lesson_registration_students to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.lesson_registrations to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.monthly_amount_corrections to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.package_credit_movements to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.package_purchases to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.payment_adjustments to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.payment_allocations to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.payment_charges to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.payments to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.pending_training_billing_operations to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.recurrence_exceptions to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.recurrence_rule_participants to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.recurrence_rules to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.report_records to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.student_level_history to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.student_price_history to anon;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.student_status_history to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE on table public.students to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.surcharge_settings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.teacher_availability to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.teacher_profiles to anon;
grant INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on table public.training_billing_agreements to anon;

-- authenticated: sólo lo que R5 le quitó (SELECT/INSERT/UPDATE/DELETE no se tocaron)
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.active_sessions to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.budget_distribution_settings to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.calendar_lesson_participants to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.calendar_lessons to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.cloud_backups to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.custom_levels to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.first_month_proration_decisions to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.import_runs to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.import_undo_dependency_registry to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.initial_paid_surcharge_corrections to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.lesson_registration_attendance to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER on table public.lesson_registration_edit_history to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.lesson_registration_evaluations to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.lesson_registration_homework_reviews to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.lesson_registration_students to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.lesson_registrations to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.monthly_amount_corrections to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.package_credit_movements to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.package_purchases to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.payment_adjustments to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.payment_allocations to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.payment_charges to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.payments to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.pending_training_billing_operations to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.recurrence_exceptions to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.recurrence_rule_participants to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.recurrence_rules to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.report_records to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.student_creation_claims to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.student_level_history to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.student_price_history to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.student_status_history to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.students to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.surcharge_settings to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.teacher_availability to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.teacher_profiles to authenticated;
grant MAINTAIN, REFERENCES, TRIGGER, TRUNCATE on table public.training_billing_agreements to authenticated;

-- el registro de dependencias también perdió SELECT para authenticated (R5 lo cerró entero)
grant select on public.import_undo_dependency_registry to authenticated;
alter table public.import_undo_dependency_registry disable row level security;

alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant execute on functions to anon;
alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to authenticated;

-- ===== B) políticas de dueño otra vez TO public =====
do $$
declare
  r record;
begin
  for r in
    select p.schemaname, p.tablename, p.policyname
      from pg_policies p
     where p.schemaname = 'public' and p.roles = array['authenticated']::name[] and p.policyname ~ '_owner_(all|select)$'
  loop
    execute format('alter policy %I on %I.%I to public', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ===== C) funciones: search_path anterior y EXECUTE de set_updated_at =====
alter function public.fetch_latest_cloud_backup_timestamp() set search_path = 'public';
alter function public.transfer_active_session(text) set search_path = 'public';
alter function public.touch_active_session(text) set search_path = 'public';
alter function public.upload_cloud_backup(text, bigint, integer, text, jsonb) set search_path = 'public';
alter function public.fetch_latest_cloud_backup(text, bigint) set search_path = 'public';
alter function public.fetch_recent_cloud_backups(text, bigint, integer) set search_path = 'public';
alter function public.delete_own_account() set search_path = 'public';
alter function public.end_active_session(text, bigint) set search_path = 'public';

alter function public.cancel_calendar_occurrence(jsonb) reset search_path;
alter function public.create_calendar_lesson(jsonb) reset search_path;
alter function public.reschedule_calendar_occurrence(jsonb) reset search_path;
alter function public.rename_custom_level(uuid, text) reset search_path;
alter function public.apply_recurrence_participants_from_date(jsonb) reset search_path;
alter function public.create_recurrence_series(jsonb) reset search_path;
alter function public.split_recurrence_this_and_future(jsonb) reset search_path;
alter function public.set_updated_at() reset search_path;
alter function public._normalize_email(text) reset search_path;
alter function public._normalize_phone(text) reset search_path;
alter function public._field_override_allowlist(text) reset search_path;

grant execute on function public.set_updated_at() to public, anon, authenticated;
