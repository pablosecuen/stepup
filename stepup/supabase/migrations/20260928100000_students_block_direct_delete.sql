-- TeacherFlow Web — Fase 10: defensa contra DELETE directo sobre alumnos.
--
-- Decisión de producto confirmada (2026-09-28, ver docs/WEB_PARITY_PLAN.md):
-- NO se implementa hard delete de alumnos en la web. Archivar/restaurar es
-- el flujo definitivo. Esta migración cierra un hallazgo real de la
-- auditoría de Fase 10: `authenticated`/`anon` tienen hoy DELETE (y otros
-- privilegios de tabla) sobre `students` y su historial de auditoría, por
-- el mismo default de Postgres/Supabase que ya se documentó para las RPC
-- (el rol que crea la tabla concede EXECUTE/DML a PUBLIC por defecto salvo
-- revoke explícito). RLS (`owner_id = auth.uid()`) ya impide que `anon`
-- toque cualquier fila real, y que `authenticated` toque una fila ajena —
-- pero una sesión autenticada legítima podía, hasta esta migración, borrar
-- DIRECTAMENTE su propio alumno (bypaseando archivar, sin confirmación, sin
-- entrada de historial) siempre que ese alumno todavía no tuviera ninguna
-- fila dependiente protegida por `on delete restrict` (payment_charges,
-- payments, calendar_lessons, lesson_registration_*, etc.) — un alumno
-- recién creado, por ejemplo. Nunca se usó así en el código real (ninguna
-- función de este repo hace `delete from students`), pero el privilegio
-- existía a nivel de base, sin ninguna barrera adicional a RLS.
--
-- Confirmado real vía information_schema.role_table_grants antes de armar
-- esta migración: `authenticated` y `anon` tenían DELETE en `students`,
-- `student_status_history`, `student_level_history`, `student_price_history`;
-- `anon` (no `authenticated`, ya revocado en 20260926110000) seguía
-- teniendo DELETE en `report_records`.
--
-- Sigue funcionando sin cambios, verificado por auditoría de código real:
--  - `apply_undo_backup_import` (security definer) — corre con los
--    privilegios de su propio dueño (quien la creó, nunca `authenticated`
--    ni `anon`), nunca afectada por un revoke sobre esos dos roles.
--  - `delete_own_account` (security definer) — hace `delete from
--    auth.users`, nunca `delete from public.students` directamente; el
--    borrado en cascada de `students`/su historial lo ejecuta el propio
--    motor de integridad referencial de Postgres al resolver
--    `students.owner_id references auth.users(id) on delete cascade`, que
--    no depende del privilegio DELETE de la sesión invocante sobre la
--    tabla hija — sólo de poder borrar la fila padre.
--  - Cualquier operación administrativa corrida como `postgres` (dueño de
--    las funciones) sigue intacta por el mismo motivo.

revoke delete on public.students from authenticated, anon;
revoke delete on public.student_status_history from authenticated, anon;
revoke delete on public.student_level_history from authenticated, anon;
revoke delete on public.student_price_history from authenticated, anon;
revoke delete on public.report_records from anon;

comment on table public.students is
  'Alumno — unifica StudentListItem + StudentProfile del móvil en una sola fila. Nunca hard delete (decisión de producto, Fase 10): DELETE directo revocado a authenticated/anon, sólo archivar/restaurar (status) está permitido desde la web.';

-- ---------------------------------------------------------------------------
-- Privilegios por columna sobre `students` (Fase 10, ronda 4 — Diseño A,
-- decisión de producto confirmada, sin trigger ni GUC de contexto interno).
--
-- Hallazgo real que motiva esto (demostrado en vivo, transaccional, con
-- ROLLBACK): `authenticated` tenía UPDATE sobre TODA la tabla (sin
-- restricción por columna) — un dueño legítimo podía hacer
-- `update students set status='archivado'` directo por PostgREST,
-- saltándose TANTO `change_student_status` COMO
-- `archive_student_and_prune_future` (y su elección obligatoria de agenda
-- futura) por completo. `anon` ya estaba protegido por RLS para esto
-- (verificado: 0 filas afectadas, nunca un error).
--
-- Inventario REAL de escrituras sobre `public.students` (Fase 10, relevado
-- de código, no una lista copiada a mano):
--   - `lib/repositories/students-mapping.ts` (`updateInputToRowPatch`,
--     invocada desde `updateStudent`, SECURITY INVOKER real vía
--     `.from("students").update(...)`) — el ÚNICO camino de edición directa
--     desde la web. Columnas reales que puede tocar: name, modality,
--     category, billing_type, price, levels, initial_level,
--     usual_duration_minutes, weekly_frequency, phone, whatsapp, email,
--     notes, pending_homework, alerts, current_goals, strengths,
--     areas_to_improve, is_featured. NUNCA toca status/status_change_date/
--     legacy_mobile_id/id/owner_id/created_at/updated_at/date_joined/
--     last_reactivated_at/is_new/birth_date/usual_days/usual_time — ninguno
--     de esos campos existe en `UpdateStudentInput`.
--   - `rename_custom_level` (`20260920120000`, SECURITY INVOKER, sin
--     cambios) — cascada de `levels`/`initial_level` al renombrar un nivel
--     personalizado; corre con los privilegios de `authenticated`, por eso
--     esas dos columnas deben seguir en la allowlist.
--   - `change_student_status`/`archive_student_and_prune_future`
--     (`20260928110000`) — únicos que tocan `status`/`status_change_date`;
--     convertidas a SECURITY DEFINER en esa misma migración pendiente
--     precisamente para poder seguir escribiendo esas dos columnas aunque
--     `authenticated` ya no tenga UPDATE directo sobre ellas.
--   - `create_student_via_web` (`20260927100000`) — sólo INSERT, nunca
--     UPDATE de una fila existente; SECURITY DEFINER, no depende de estos
--     grants.
--   - Pipeline de backup/import/undo (`20260927090000`/`20260927110000`,
--     TODO el archivo SECURITY DEFINER por diseño desde su creación) —
--     único lugar que además toca `legacy_mobile_id` (decisión "link") y
--     `birth_date`/`usual_days`/`usual_time` (decisión "field_overwritten"
--     desde un backup real) — nunca depende de los privilegios de
--     `authenticated`, corre como dueño de la función.
--   - `delete_own_account` (RPC preexistente, SECURITY DEFINER) — nunca
--     hace UPDATE de `students`, sólo `delete from auth.users`; el
--     cascade de `owner_id` tampoco depende de estos grants.
--
-- Columnas EXCLUIDAS a propósito de la allowlist (nunca editables por
-- `authenticated` de forma directa): `id`, `owner_id`, `status`,
-- `status_change_date`, `legacy_mobile_id`, `created_at`, `updated_at`,
-- `date_joined`, `last_reactivated_at`, `is_new`, `birth_date`,
-- `usual_days`, `usual_time` — las últimas 3 existen en el esquema y las
-- escribe el pipeline de backup (SECURITY DEFINER), pero la web nunca las
-- edita directamente hoy; quedan bloqueadas por defecto a propósito.
-- Cualquier columna NUEVA que se agregue en el futuro queda bloqueada por
-- defecto hasta que se la agregue explícitamente acá — comportamiento
-- intencional (allowlist, nunca una lista de exclusión).
-- ---------------------------------------------------------------------------

revoke update on public.students from authenticated, anon;

grant update (
  name, phone, whatsapp, email, notes,
  levels, initial_level,
  modality, category, billing_type, price,
  usual_duration_minutes, weekly_frequency,
  pending_homework, alerts, current_goals, strengths, areas_to_improve, is_featured
) on public.students to authenticated;
