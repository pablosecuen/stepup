-- TeacherFlow Web — Fase 10, Remediación C (auditoría de permisos directos).
--
-- RLS (`owner_id = auth.uid()`) sólo valida el propietario de la FILA que
-- se escribe — nunca el propietario de las filas que esa fila REFERENCIA
-- por clave foránea. Confirmado con pruebas reales (rollback, sin
-- residuos): un owner autenticado puede, hoy, insertar/actualizar una fila
-- propia apuntando por FK a una fila real de OTRO owner (otro alumno,
-- otra serie, otra clase, otro cargo/pago) sin ningún rechazo — ni la RPC
-- que normalmente se usa, ni PostgREST directo, lo impiden en la mayoría
-- de los casos (sólo 4 RPC de Calendario, desde 20260921100000, tienen el
-- chequeo escrito a mano adentro).
--
-- Esta migración cierra ese vector de una sola vez, a nivel de tabla, para
-- TODAS las FK confirmadas explotables entre tablas owner-scoped (ver
-- inventario completo del informe: 54 FK entre tablas con owner_id, 49
-- explotables por grants reales, 0 inconsistencias reales hoy en
-- producción). Funciona igual sin importar quién escriba — una RPC
-- `security invoker`, PostgREST directo, o el motor de importación de
-- backup (que nunca la dispara en la práctica, porque siempre inserta con
-- el mismo owner_id en ambos lados).
--
-- Diseño: una única función `security definer` reutilizable, parametrizada
-- por trigger (`TG_ARGV`) con la columna FK y la tabla referenciada —
-- evita 46 funciones casi idénticas. Nunca modifica una fila, sólo valida
-- o rechaza (`raise exception`). `search_path = ''` + referencias
-- completamente calificadas (`public.<tabla>`) en toda sentencia dinámica,
-- nunca confía en nada enviado por el cliente más allá de los valores ya
-- validados por el tipo de columna (`uuid`). El mensaje de error nunca
-- incluye el id, el propietario ni ningún dato de la fila ajena — sólo el
-- nombre de la columna que falló.

create or replace function public._enforce_owner_match_fk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fk_column text := TG_ARGV[0];
  v_parent_table text := TG_ARGV[1];
  v_fk_value uuid;
  v_parent_owner uuid;
begin
  -- Referencia opcional NULL: siempre permitida, nunca se evalúa.
  execute format('select ($1).%I', v_fk_column) using NEW into v_fk_value;
  if v_fk_value is null then
    return NEW;
  end if;

  -- Fila referenciada inexistente: queda bajo control de la FK real
  -- (23503), este trigger no se mete — v_parent_owner queda null y no se
  -- rechaza acá.
  execute format('select owner_id from public.%I where id = $1', v_parent_table)
    using v_fk_value
    into v_parent_owner;

  if v_parent_owner is not null and v_parent_owner is distinct from NEW.owner_id then
    raise exception 'Referencia cruzada no permitida en la columna %: la fila referenciada no pertenece al mismo propietario.', v_fk_column
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

comment on function public._enforce_owner_match_fk() is 'Trigger genérico BEFORE INSERT/UPDATE: rechaza una fila cuyo FK (TG_ARGV[0]) apunte a una fila de TG_ARGV[1] con owner_id distinto. NULL siempre permitido. Nunca modifica filas. Fase 10, 20261001110000.';

revoke execute on function public._enforce_owner_match_fk() from public, anon, authenticated;

-- Coherencia adicional específica de payment_allocations: además de que
-- payment_id/charge_id/student_id pertenezcan al mismo owner (triggers
-- genéricos de abajo), el alumno de la asignación debe ser el mismo
-- alumno real del cargo que se está cobrando — una asignación propia no
-- puede, por ejemplo, acreditar el pago de un alumno a nombre de otro
-- alumno (propio o ajeno) dentro del mismo cargo.
create or replace function public._enforce_payment_allocation_student_coherence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge_student uuid;
begin
  if NEW.charge_id is null then
    return NEW;
  end if;

  select student_id into v_charge_student
    from public.payment_charges where id = NEW.charge_id;

  if v_charge_student is not null and v_charge_student is distinct from NEW.student_id then
    raise exception 'Referencia cruzada no permitida: el alumno de la asignación no coincide con el alumno real del cargo.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

comment on function public._enforce_payment_allocation_student_coherence() is 'Trigger BEFORE INSERT/UPDATE en payment_allocations: exige que student_id coincida con el alumno real del charge_id referenciado. Fase 10, 20261001110000.';

revoke execute on function public._enforce_payment_allocation_student_coherence() from public, anon, authenticated;

create trigger trg_payment_allocations_student_coherence
  before insert or update of charge_id, student_id on public.payment_allocations
  for each row execute function public._enforce_payment_allocation_student_coherence();

-- ---------------------------------------------------------------------------
-- 46 triggers genéricos — uno por cada FK confirmada explotable entre
-- tablas owner-scoped (ver matriz completa del informe). Nombre acotado a
-- `trg_owner_fk_<columna>` (único por tabla, Postgres sólo exige unicidad
-- por relación, nunca global — cabe cómodo bajo el límite de 63 bytes).
-- ---------------------------------------------------------------------------

-- recurrence_rules
create trigger trg_owner_fk_primary_student_id
  before insert or update of primary_student_id on public.recurrence_rules
  for each row execute function public._enforce_owner_match_fk('primary_student_id', 'students');

create trigger trg_owner_fk_supersedes_recurrence_id
  before insert or update of supersedes_recurrence_id on public.recurrence_rules
  for each row execute function public._enforce_owner_match_fk('supersedes_recurrence_id', 'recurrence_rules');

create trigger trg_owner_fk_superseded_by_recurrence_id
  before insert or update of superseded_by_recurrence_id on public.recurrence_rules
  for each row execute function public._enforce_owner_match_fk('superseded_by_recurrence_id', 'recurrence_rules');

create trigger trg_owner_fk_training_billing_agreement_id
  before insert or update of training_billing_agreement_id on public.recurrence_rules
  for each row execute function public._enforce_owner_match_fk('training_billing_agreement_id', 'training_billing_agreements');

-- recurrence_rule_participants
create trigger trg_owner_fk_recurrence_rule_id
  before insert or update of recurrence_rule_id on public.recurrence_rule_participants
  for each row execute function public._enforce_owner_match_fk('recurrence_rule_id', 'recurrence_rules');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.recurrence_rule_participants
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- calendar_lessons
create trigger trg_owner_fk_recurrence_id
  before insert or update of recurrence_id on public.calendar_lessons
  for each row execute function public._enforce_owner_match_fk('recurrence_id', 'recurrence_rules');

create trigger trg_owner_fk_primary_student_id
  before insert or update of primary_student_id on public.calendar_lessons
  for each row execute function public._enforce_owner_match_fk('primary_student_id', 'students');

create trigger trg_owner_fk_freed_by_lesson_id
  before insert or update of freed_by_lesson_id on public.calendar_lessons
  for each row execute function public._enforce_owner_match_fk('freed_by_lesson_id', 'calendar_lessons');

-- calendar_lesson_participants
create trigger trg_owner_fk_calendar_lesson_id
  before insert or update of calendar_lesson_id on public.calendar_lesson_participants
  for each row execute function public._enforce_owner_match_fk('calendar_lesson_id', 'calendar_lessons');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.calendar_lesson_participants
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- recurrence_exceptions
create trigger trg_owner_fk_recurrence_id
  before insert or update of recurrence_id on public.recurrence_exceptions
  for each row execute function public._enforce_owner_match_fk('recurrence_id', 'recurrence_rules');

create trigger trg_owner_fk_replacement_lesson_id
  before insert or update of replacement_lesson_id on public.recurrence_exceptions
  for each row execute function public._enforce_owner_match_fk('replacement_lesson_id', 'calendar_lessons');

-- lesson_registrations
create trigger trg_owner_fk_calendar_lesson_id
  before insert or update of calendar_lesson_id on public.lesson_registrations
  for each row execute function public._enforce_owner_match_fk('calendar_lesson_id', 'calendar_lessons');

create trigger trg_owner_fk_rescheduled_from_registration_id
  before insert or update of rescheduled_from_registration_id on public.lesson_registrations
  for each row execute function public._enforce_owner_match_fk('rescheduled_from_registration_id', 'lesson_registrations');

-- lesson_registration_students
create trigger trg_owner_fk_lesson_registration_id
  before insert or update of lesson_registration_id on public.lesson_registration_students
  for each row execute function public._enforce_owner_match_fk('lesson_registration_id', 'lesson_registrations');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.lesson_registration_students
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- lesson_registration_attendance
create trigger trg_owner_fk_lesson_registration_id
  before insert or update of lesson_registration_id on public.lesson_registration_attendance
  for each row execute function public._enforce_owner_match_fk('lesson_registration_id', 'lesson_registrations');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.lesson_registration_attendance
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- lesson_registration_evaluations
create trigger trg_owner_fk_lesson_registration_id
  before insert or update of lesson_registration_id on public.lesson_registration_evaluations
  for each row execute function public._enforce_owner_match_fk('lesson_registration_id', 'lesson_registrations');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.lesson_registration_evaluations
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- lesson_registration_homework_reviews
create trigger trg_owner_fk_lesson_registration_id
  before insert or update of lesson_registration_id on public.lesson_registration_homework_reviews
  for each row execute function public._enforce_owner_match_fk('lesson_registration_id', 'lesson_registrations');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.lesson_registration_homework_reviews
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- payment_charges
create trigger trg_owner_fk_calendar_lesson_id
  before insert or update of calendar_lesson_id on public.payment_charges
  for each row execute function public._enforce_owner_match_fk('calendar_lesson_id', 'calendar_lessons');

create trigger trg_owner_fk_package_id
  before insert or update of package_id on public.payment_charges
  for each row execute function public._enforce_owner_match_fk('package_id', 'package_purchases');

create trigger trg_owner_fk_saved_lesson_id
  before insert or update of saved_lesson_id on public.payment_charges
  for each row execute function public._enforce_owner_match_fk('saved_lesson_id', 'lesson_registrations');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.payment_charges
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

create trigger trg_owner_fk_training_billing_agreement_id
  before insert or update of training_billing_agreement_id on public.payment_charges
  for each row execute function public._enforce_owner_match_fk('training_billing_agreement_id', 'training_billing_agreements');

-- payments
create trigger trg_owner_fk_replaces_payment_id
  before insert or update of replaces_payment_id on public.payments
  for each row execute function public._enforce_owner_match_fk('replaces_payment_id', 'payments');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.payments
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- payment_allocations
create trigger trg_owner_fk_payment_id
  before insert or update of payment_id on public.payment_allocations
  for each row execute function public._enforce_owner_match_fk('payment_id', 'payments');

create trigger trg_owner_fk_charge_id
  before insert or update of charge_id on public.payment_allocations
  for each row execute function public._enforce_owner_match_fk('charge_id', 'payment_charges');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.payment_allocations
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- payment_adjustments
create trigger trg_owner_fk_charge_id
  before insert or update of charge_id on public.payment_adjustments
  for each row execute function public._enforce_owner_match_fk('charge_id', 'payment_charges');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.payment_adjustments
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- package_purchases
create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.package_purchases
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- package_credit_movements
create trigger trg_owner_fk_package_id
  before insert or update of package_id on public.package_credit_movements
  for each row execute function public._enforce_owner_match_fk('package_id', 'package_purchases');

create trigger trg_owner_fk_saved_lesson_id
  before insert or update of saved_lesson_id on public.package_credit_movements
  for each row execute function public._enforce_owner_match_fk('saved_lesson_id', 'lesson_registrations');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.package_credit_movements
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- first_month_proration_decisions
create trigger trg_owner_fk_charge_id
  before insert or update of charge_id on public.first_month_proration_decisions
  for each row execute function public._enforce_owner_match_fk('charge_id', 'payment_charges');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.first_month_proration_decisions
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- initial_paid_surcharge_corrections
create trigger trg_owner_fk_new_payment_id
  before insert or update of new_payment_id on public.initial_paid_surcharge_corrections
  for each row execute function public._enforce_owner_match_fk('new_payment_id', 'payments');

create trigger trg_owner_fk_voided_payment_id
  before insert or update of voided_payment_id on public.initial_paid_surcharge_corrections
  for each row execute function public._enforce_owner_match_fk('voided_payment_id', 'payments');

create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.initial_paid_surcharge_corrections
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- monthly_amount_corrections
create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.monthly_amount_corrections
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- report_records
create trigger trg_owner_fk_student_id
  before insert or update of student_id on public.report_records
  for each row execute function public._enforce_owner_match_fk('student_id', 'students');

-- ---------------------------------------------------------------------------
-- FK owner-scoped NO cubiertas acá, con su justificación real (confirmado
-- por catálogo real de grants, no supuesto):
--  - import_runs.preview_id, import_undo_previews.import_run_id,
--    lesson_registration_edit_history.lesson_registration_id,
--    student_creation_claims.student_id, report_draft_claims.student_id:
--    sus tablas hijas NO tienen ningún grant de INSERT/UPDATE para
--    authenticated/anon (confirmado por catálogo real) — ya son
--    inexplotables por ausencia total de privilegio, un trigger acá sería
--    redundante.
--  - student_status_history/student_level_history/student_price_history:
--    sus únicos FK (student_id) ya quedan sin ninguna vía de escritura
--    directa tras la Remediación A (20261001100000, INSERT/UPDATE
--    revocados por completo) — el vector cross-owner queda cerrado por
--    ausencia de privilegio, no hace falta trigger adicional.
-- ---------------------------------------------------------------------------
