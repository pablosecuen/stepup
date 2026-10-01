-- TeacherFlow Web — Fase 10, cierre de B/D por dominio, Etapa 2 (Registro).
--
-- Revoca INSERT/UPDATE directo a `authenticated`/`anon` sobre
-- `lesson_registrations` y sus 4 tablas hijas — ahora seguro porque las 3
-- RPC reales que las escriben (`start_lesson_registration`,
-- `save_participant_registration`, `finalize_lesson_registration`) son
-- `SECURITY DEFINER` desde la Etapa 1 (`20261001120000`, aplicada y
-- verificada E2E real con la cuenta QA: registro individual, grupal con
-- roster inclusivo, ad-hoc, asistencia/evaluación/tarea, finalizar, edición
-- posterior auditada, doble clic, concurrencia genuina con dos conexiones —
-- todo funcionando sin depender de ningún grant de tabla).
--
-- `edit_completed_lesson_registration` ya era `SECURITY DEFINER` desde
-- antes (`20260924100000`) — no depende de estos grants, no se toca.
-- `apply_backup_import`/`apply_undo_backup_import` (importación/undo)
-- también son `SECURITY DEFINER` desde su creación (`20260927090000`) —
-- tampoco dependen de estos grants.
--
-- `DELETE` ya estaba revocado en estas 5 tablas desde la Remediación A
-- (`20261001100000`). Esta migración cierra `INSERT`/`UPDATE`, dejando las
-- 5 tablas con CERO privilegios DML directos para `authenticated`/`anon` —
-- sólo alcanzables a través de las RPC `security definer`.
--
-- NO se tocan todavía `calendar_lessons`/`calendar_lesson_participants`
-- (dominio Calendario, Etapa siguiente, RPC todavía `security invoker`) ni
-- `recurrence_rules`/`recurrence_rule_participants` — revocarlas ahora
-- rompería `create_calendar_lesson`/`create_recurrence_series`/etc., que
-- siguen corriendo con los privilegios de `authenticated`.

revoke insert, update on public.lesson_registrations from authenticated, anon;
revoke insert, update on public.lesson_registration_students from authenticated, anon;
revoke insert, update on public.lesson_registration_attendance from authenticated, anon;
revoke insert, update on public.lesson_registration_evaluations from authenticated, anon;
revoke insert, update on public.lesson_registration_homework_reviews from authenticated, anon;

comment on table public.lesson_registrations is 'Registro de clase dictada — el historial nunca se borra (decisión de producto). INSERT/UPDATE/DELETE directos revocados a authenticated/anon desde 20261001130000: única vía real son start_lesson_registration/save_participant_registration/finalize_lesson_registration/edit_completed_lesson_registration, todas SECURITY DEFINER, más apply_undo_backup_import para el undo de importación.';
comment on table public.lesson_registration_students is 'Roster de un registro de clase (inclusivo: primario + secundarios) — INSERT/UPDATE/DELETE directos revocados a authenticated/anon desde 20261001130000, única vía real son las RPC SECURITY DEFINER de Registro.';
comment on table public.lesson_registration_attendance is 'Asistencia por participante — INSERT/UPDATE/DELETE directos revocados a authenticated/anon desde 20261001130000, única vía real son las RPC SECURITY DEFINER de Registro.';
comment on table public.lesson_registration_evaluations is 'Evaluación/notas por participante — INSERT/UPDATE/DELETE directos revocados a authenticated/anon desde 20261001130000, única vía real son las RPC SECURITY DEFINER de Registro.';
comment on table public.lesson_registration_homework_reviews is 'Revisión de tareas por participante — INSERT/UPDATE/DELETE directos revocados a authenticated/anon desde 20261001130000, única vía real son las RPC SECURITY DEFINER de Registro.';
