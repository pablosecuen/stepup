-- R2 — Índices ADITIVOS e idempotentes (sólo `create index if not exists`; no se elimina ni cambia ningún índice ni constraint).
--
-- Criterio: sólo índices justificados por (a) las columnas FK que la auditoría detectó sin índice que las cubra y (b) las
-- consultas finales de R2. Cada candidato se midió con datos sintéticos grandes (PGlite = Postgres real; 24 propietarios, ~41 mil
-- filas por tabla grande) y los que NO mostraron mejora medible se descartaron (pagos/cargos/alumnos/asignaciones/clases:
-- los índices por propietario ya existentes alcanzan; ver docs/WEB_PARITY_PLAN.md).
--
-- (a) FK sin índice. Sin índice sobre la columna hija, cada borrado de la fila padre (alumno, clase, pago, serie…) y la
--     comprobación `on delete restrict/cascade` recorren la tabla hija ENTERA, de todos los propietarios. Medido (chequeo de FK
--     sin RLS, como el de Postgres): payment_charges.calendar_lesson_id 3,75 ms → 0,02 ms (Seq Scan → Index Scan),
--     lesson_registration_attendance.student_id 3,33 → 0,04 ms, lesson_registration_homework_reviews.student_id 1,65 → 0,06 ms,
--     payments.student_id 0,14 → 0,05 ms. El resto de las columnas de esta lista (tablas chicas hoy) se indexa por el mismo
--     motivo estructural, sin medición propia: no se afirma una mejora medida para ellas.
--
-- (b) Ventana de registros por fecha (`listLessonRegistrationsInRange`): `owner_id` + rango de `scheduled_start_at`. Medido:
--     0,59 → 0,37 ms y 41 → 19 buffers leídos (Bitmap Index Scan lesson_registrations_owner_idx → el índice nuevo).
--
-- Bloqueo: `create index` toma un lock que bloquea ESCRITURAS de la tabla mientras se construye; con el volumen actual de la
-- base es de milisegundos. (No se usa `concurrently`: las migraciones corren dentro de una transacción.)

-- (a) FK sin índice (columna líder)
create index if not exists calendar_lessons_freed_by_lesson_idx on public.calendar_lessons (freed_by_lesson_id);
create index if not exists first_month_proration_decisions_charge_idx on public.first_month_proration_decisions (charge_id);
create index if not exists import_preview_duplicate_candidates_candidate_student_idx on public.import_preview_duplicate_candidates (candidate_student_id);
create index if not exists import_runs_preview_idx on public.import_runs (preview_id);
create index if not exists import_undo_previews_import_run_idx on public.import_undo_previews (import_run_id);
create index if not exists import_undo_previews_owner_idx on public.import_undo_previews (owner_id);
create index if not exists initial_paid_surcharge_corrections_new_payment_idx on public.initial_paid_surcharge_corrections (new_payment_id);
create index if not exists initial_paid_surcharge_corrections_voided_payment_idx on public.initial_paid_surcharge_corrections (voided_payment_id);
create index if not exists lesson_registration_attendance_student_idx on public.lesson_registration_attendance (student_id);
create index if not exists lesson_registration_homework_reviews_student_idx on public.lesson_registration_homework_reviews (student_id);
create index if not exists package_credit_movements_saved_lesson_idx on public.package_credit_movements (saved_lesson_id);
create index if not exists package_credit_movements_student_idx on public.package_credit_movements (student_id);
create index if not exists payment_adjustments_student_idx on public.payment_adjustments (student_id);
create index if not exists payment_charges_calendar_lesson_idx on public.payment_charges (calendar_lesson_id);
create index if not exists payment_charges_saved_lesson_idx on public.payment_charges (saved_lesson_id);
create index if not exists payments_replaces_payment_idx on public.payments (replaces_payment_id);
create index if not exists payments_student_idx on public.payments (student_id);
create index if not exists recurrence_exceptions_replacement_lesson_idx on public.recurrence_exceptions (replacement_lesson_id);
create index if not exists recurrence_rules_superseded_by_idx on public.recurrence_rules (superseded_by_recurrence_id);
create index if not exists student_creation_claims_student_idx on public.student_creation_claims (student_id);

-- (b) Consulta final de R2: registros por ventana de fecha
create index if not exists lesson_registrations_owner_scheduled_start_idx on public.lesson_registrations (owner_id, scheduled_start_at);
