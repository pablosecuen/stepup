-- TeacherFlow Web — Fase 10, Remediación A (auditoría de permisos directos).
--
-- Revoca EXCLUSIVAMENTE las operaciones DML directas que, verificado por
-- inventario real de código (grep exhaustivo de `lib/`, que nunca escribe
-- estas tablas fuera de una RPC) y por inventario real de `pg_proc.prosecdef`
-- (ninguna RPC `security invoker` depende de estos grants), no tienen HOY
-- ningún escritor legítimo salvo, cuando se indica, una RPC `security
-- definer` (corre con los privilegios de su propio dueño, nunca con los de
-- quien la invoca — revocarle el grant a `authenticated`/`anon` no la
-- afecta en absoluto).
--
-- Nunca se edita una migración ya aplicada: esta es puramente aditiva y
-- restrictiva, no toca ninguna fila existente (confirmado: 0 inconsistencias
-- cross-owner reales en las 54 FK owner-scoped del proyecto, ver informe).

-- ---------------------------------------------------------------------------
-- student_status_history / student_level_history / student_price_history
-- ---------------------------------------------------------------------------
-- Único escritor real de student_status_history: `change_student_status`
-- (20260920120000, security definer) y `archive_student_and_prune_future`
-- (20260928110000, security definer). DELETE ya estaba revocado
-- (20260928100000); esta migración cierra también INSERT/UPDATE directos.
--
-- student_level_history/student_price_history: CERO escritores en la app
-- hoy (confirmado: `lib/repositories/student-history.ts` sólo expone
-- lectura — "Repositorio de historial de alumno... append-only, nunca
-- expone update/delete"). El único INSERT que existe en todo el código es
-- `_apply_student_level_history` (20260927090000, security definer,
-- exclusivo del importador de backup). Revocar INSERT/UPDATE/DELETE acá no
-- afecta ninguna funcionalidad real de la web hoy.
revoke insert, update on public.student_status_history from authenticated, anon;
revoke insert, update on public.student_level_history from authenticated, anon;
revoke insert, update on public.student_price_history from authenticated, anon;

-- ---------------------------------------------------------------------------
-- lesson_registrations y sus 4 tablas hijas — "el historial nunca se borra"
-- ---------------------------------------------------------------------------
-- Único DELETE real en todo `supabase/migrations/` sobre estas 5 tablas:
-- `apply_undo_backup_import` (20260927090000, security definer, líneas
-- 2590-2594). Ninguna RPC `security invoker` de Registro de clases
-- (`start_lesson_registration`, `save_participant_registration`,
-- `finalize_lesson_registration`) ni `edit_completed_lesson_registration`
-- (security definer) borra nunca una fila — sólo insertan/actualizan.
-- Esta es la corrección del hallazgo más grave de la auditoría: un
-- registro de clase ya dictada se podía DELETE directo vía PostgREST, sin
-- pasar por ninguna RPC, contradiciendo la decisión de producto vigente.
revoke delete on public.lesson_registrations from authenticated, anon;
revoke delete on public.lesson_registration_students from authenticated, anon;
revoke delete on public.lesson_registration_attendance from authenticated, anon;
revoke delete on public.lesson_registration_evaluations from authenticated, anon;
revoke delete on public.lesson_registration_homework_reviews from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Motor de cobros — integridad financiera (nunca hard delete, "anular" es
-- siempre un UPDATE de voided_at/void_reason)
-- ---------------------------------------------------------------------------
-- Confirmado por búsqueda exhaustiva: CERO sentencias `delete from` en todo
-- `20260925100000_payments_engine.sql`. `register_payment`/`void_payment`/
-- `void_charge`/`sync_per_class_charge`/`ensure_monthly_charges`/
-- `ensure_training_charges`/`configure_training_billing`/
-- `edit_training_billing_fee` (todas security invoker) nunca hacen DELETE.
-- Único DELETE real de estas 4 tablas: `apply_undo_backup_import` (security
-- definer).
revoke delete on public.payments from authenticated, anon;
revoke delete on public.payment_charges from authenticated, anon;
revoke delete on public.payment_allocations from authenticated, anon;
revoke delete on public.payment_adjustments from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Resto de tablas de historial/corrección financiera — mismo patrón
-- ---------------------------------------------------------------------------
-- training_billing_agreements/package_purchases/package_credit_movements/
-- first_month_proration_decisions/initial_paid_surcharge_corrections: único
-- DELETE real = apply_undo_backup_import (security definer).
-- monthly_amount_corrections/pending_training_billing_operations: CERO
-- DELETE en absoluto en todo el código, ni siquiera en el motor de undo.
revoke delete on public.training_billing_agreements from authenticated, anon;
revoke delete on public.package_purchases from authenticated, anon;
revoke delete on public.package_credit_movements from authenticated, anon;
revoke delete on public.first_month_proration_decisions from authenticated, anon;
revoke delete on public.initial_paid_surcharge_corrections from authenticated, anon;
revoke delete on public.monthly_amount_corrections from authenticated, anon;
revoke delete on public.pending_training_billing_operations from authenticated, anon;

-- ---------------------------------------------------------------------------
-- recurrence_rules — DELETE directo (el UPDATE de status/end_date se
-- preserva intacto: lo usa `setRecurrenceRuleStatus`, invoker, y las RPC de
-- creación/split de series; eso es Remediación B, fuera de esta migración)
-- ---------------------------------------------------------------------------
-- Único DELETE real: apply_undo_backup_import (security definer). Pausar/
-- reanudar/finalizar sólo hacen UPDATE — "Finalizar" deja status='ended',
-- la fila nunca desaparece (confirmado en WEB_PARITY_PLAN.md Fase 3).
revoke delete on public.recurrence_rules from authenticated, anon;

-- ---------------------------------------------------------------------------
-- active_sessions — infraestructura ya existente de la app móvil
-- ---------------------------------------------------------------------------
-- Los 3 únicos escritores (`transfer_active_session`/`touch_active_session`/
-- `end_active_session`) son security definer; cero código TypeScript de
-- este repo escribe esta tabla directo. La única policy RLS real cubre
-- sólo SELECT (`cmd='r'`) — INSERT/UPDATE/DELETE ya estaban denegados por
-- RLS por ausencia de policy para esos comandos; este revoke es cinturón
-- además de los tiradores, nunca cambia comportamiento observable.
revoke insert, update, delete on public.active_sessions from authenticated, anon;

comment on table public.student_status_history is 'Historial append-only de cambios de estado de un alumno — nunca editable/insertable directo, sólo vía change_student_status/archive_student_and_prune_future (security definer). DELETE revocado desde 20260928100000; INSERT/UPDATE desde 20261001100000.';
comment on table public.student_level_history is 'Historial append-only de hitos de nivel — hoy sin ningún escritor en la app (preparado para el importador de backup, security definer). Nunca editable/insertable directo desde authenticated/anon. Ver 20261001100000.';
comment on table public.student_price_history is 'Historial append-only de cambios de precio — hoy sin ningún escritor en la app (preparado para el importador de backup, security definer). Nunca editable/insertable directo desde authenticated/anon. Ver 20261001100000.';
comment on table public.lesson_registrations is 'Registro de clase dictada — el historial nunca se borra (decisión de producto). DELETE directo revocado a authenticated/anon desde 20261001100000, sólo accesible desde apply_undo_backup_import (security definer).';
