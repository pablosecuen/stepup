-- R3 — Disparadores que aplican las cuotas (ver 20261007100000). Aditiva e idempotente: sólo crea disparadores nuevos; no modifica filas ni
-- funciones existentes. Retirarlos devuelve el comportamiento anterior (script en supabase/repairs/r3_quota_triggers_rollback.sql).
--
-- Cada tabla lleva, como mucho, DOS disparadores:
--   * `trg_quota_count`: AFTER INSERT por sentencia (con transition table): topes total/por hora/pendientes. No se dispara para filas que
--     `ON CONFLICT DO NOTHING` descarta (reintentos idempotentes).
--   * `trg_quota_row_size`: BEFORE INSERT OR UPDATE por fila: tamaño máximo de fila.
-- Sólo para tablas con `owner_id` (todas las de esta lista lo tienen).

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('students', 'students'),
      ('student_creation_claims', 'student_creation_claims:created_at,student_creation_claims_pending'),
      ('calendar_lessons', 'calendar_lessons,calendar_lessons_future'),
      ('calendar_lesson_participants', 'calendar_lesson_participants'),
      ('recurrence_rules', 'recurrence_rules'),
      ('recurrence_rule_participants', 'recurrence_rule_participants'),
      ('recurrence_exceptions', 'recurrence_exceptions'),
      ('lesson_registrations', 'lesson_registrations'),
      ('lesson_registration_students', 'lesson_registration_students'),
      ('lesson_registration_attendance', 'lesson_registration_attendance'),
      ('lesson_registration_evaluations', 'lesson_registration_evaluations'),
      ('lesson_registration_homework_reviews', 'lesson_registration_homework_reviews'),
      ('lesson_registration_edit_history', 'lesson_registration_edit_history'),
      ('payments', 'payments'),
      ('payment_charges', 'payment_charges'),
      ('payment_allocations', 'payment_allocations'),
      ('payment_adjustments', 'payment_adjustments'),
      ('training_billing_agreements', 'training_billing_agreements'),
      ('pending_training_billing_operations', 'pending_training_billing_operations'),
      ('package_purchases', 'package_purchases'),
      ('package_credit_movements', 'package_credit_movements'),
      ('first_month_proration_decisions', 'first_month_proration_decisions'),
      ('monthly_amount_corrections', 'monthly_amount_corrections'),
      ('initial_paid_surcharge_corrections', 'initial_paid_surcharge_corrections'),
      ('student_status_history', 'student_status_history'),
      ('student_level_history', 'student_level_history'),
      ('student_price_history', 'student_price_history'),
      ('custom_levels', 'custom_levels'),
      ('report_records', 'report_records:generated_at'),
      ('report_pdf_cleanup_jobs', 'report_pdf_cleanup_jobs'),
      ('import_previews', 'import_previews:created_at,import_previews_pending'),
      ('import_runs', 'import_runs'),
      ('import_undo_previews', 'import_undo_previews,import_undo_previews_pending')
    ) as t(table_name, keys)
  loop
    -- Los argumentos se pasan separados por coma: "clave" o "clave:columna_de_fecha".
    execute format('drop trigger if exists trg_quota_count on public.%I', r.table_name);
    execute format(
      'create trigger trg_quota_count after insert on public.%I referencing new table as new_rows for each statement execute function public.tf_quota_after_insert(%s)',
      r.table_name,
      (select string_agg(quote_literal(k), ', ') from unnest(string_to_array(r.keys, ',')) as k)
    );
    execute format('drop trigger if exists trg_quota_row_size on public.%I', r.table_name);
    execute format(
      'create trigger trg_quota_row_size before insert or update on public.%I for each row execute function public.tf_quota_row_size()',
      r.table_name
    );
  end loop;
end $$;
