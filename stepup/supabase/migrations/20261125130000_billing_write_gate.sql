-- COMPUERTA DE ESCRITURA EN LA BASE para el modo limitado (preparada el 25/11/2026; NO aplicada a Production; APAGADA por defecto).
--
-- Problema: hoy el modo limitado sólo lo aplica el servidor web. Quien use SU PROPIA sesión contra la API de datos de Supabase (la clave pública viaja en la
-- web) puede escribir en sus propias filas aunque su cuenta esté limitada, porque la base sólo aplica «cada cuenta ve y escribe lo suyo» (RLS) y no consulta la
-- suscripción. Esta migración cierra ese camino con el MÍNIMO de piezas:
--
--   1. UNA función de estado (`tf_write_access`) que reproduce en SQL la misma regla que `projectStatus` de `lib/billing/ledger.ts` (una prueba compara las
--      dos sobre una grilla de casos: si algún día se separan, la prueba falla).
--   2. UNA función disparadora (`tf_write_gate`), de nivel SENTENCIA (se evalúa una vez por escritura, no por fila), conectada a las tablas donde una
--      cuenta puede escribir datos operativos (lista explícita más abajo; una prueba de catálogo obliga a clasificar toda tabla nueva).
--   3. UNA política restrictiva sobre los archivos subidos (buckets `lesson-files` y `report-pdfs`).
--   4. UN interruptor (`billing_settings.write_gate_enabled`, apagado): con la migración aplicada y el interruptor apagado NADA cambia.
--
-- Por qué un disparador y no una política de filas (RLS): las funciones `SECURITY DEFINER` (la mayoría de las operaciones de la web) se saltean RLS pero NO los
-- disparadores; con RLS quedarían sin proteger todas las escrituras hechas por función.
--
-- Qué NO bloquea (a propósito):
--   · cualquier rol que no sea `authenticated` (cliente de servicio de facturación, tareas programadas, migraciones, administración);
--   · escrituras derivadas dentro de otro disparador o de una cascada (`pg_trigger_depth() > 1`): por ejemplo eliminar la propia cuenta, que borra en cascada;
--   · las tablas de operaciones permitidas en modo limitado (preferencias de uso, sesión del dispositivo, cuota de acciones) y `cloud_backups` (tabla de la app
--     antigua que esta web no escribe): no llevan disparador.
-- Código de error propio: `TF006` (la interfaz lo traduce al mismo mensaje breve del modo limitado).

alter table public.billing_settings add column if not exists write_gate_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1. Estado de escritura de una cuenta (espejo SQL de `projectStatus`). Estable; sólo lee.
--    Devuelve true cuando la cuenta puede crear/modificar datos: grandfathered, active, past_due, grace_period y cancel_at_period_end.
-- ---------------------------------------------------------------------------
create or replace function public.tf_write_access(p_owner uuid, p_now timestamptz default now())
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.billing_subscriptions;
  v_end timestamptz;
  v_grace timestamptz;
  v_cancel_end timestamptz;
  v_cutoff timestamptz;
  v_created timestamptz;
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_allowed boolean;
begin
  if p_owner is null then return false; end if;
  select * into s from public.billing_subscriptions b where b.owner_id = p_owner;
  if not found then
    -- Sin fila todavía: misma regla que `billing_ensure_account` (anterior al corte = cuenta existente).
    select u.created_at into v_created from auth.users u where u.id = p_owner;
    select b.grandfather_cutoff into v_cutoff from public.billing_settings b where b.id;
    return v_created is not null and v_cutoff is not null and v_created <= v_cutoff;
  end if;

  -- Un período que terminó antes de que la cuenta volviera a empezar ya no cuenta.
  v_end := case when s.current_period_end is not null and (s.restarted_at is null or s.current_period_end > s.restarted_at) then s.current_period_end end;

  if v_end is null then
    if s.cancel_requested_at is not null then return false; end if;   -- canceled
    if s.provider_ended_at is not null then return false; end if;     -- expired
    return s.grandfathered;                                           -- grandfathered | pending
  end if;

  -- Fin (exclusivo) de la gracia: 00:00 (Argentina) del día D+6 del vencimiento D (`graceEndsAtFor`).
  v_grace := coalesce(s.grace_ends_at, ((((v_end at time zone v_tz)::date + 6)::timestamp) at time zone v_tz));

  if s.cancel_requested_at is not null then
    v_cancel_end := case when s.cancel_requested_at < v_end then v_end else v_grace end;     -- `cancelAccessEnd`
    v_allowed := p_now < v_cancel_end;                                                      -- cancel_at_period_end | canceled
  elsif p_now < v_end then
    v_allowed := true;                                                                       -- active
  elsif s.provider_ended_at is not null then
    v_allowed := false;                                                                      -- expired
  else
    v_allowed := p_now < v_grace;                                                            -- past_due | grace_period | limited
  end if;

  -- Contracargo vigente: modo limitado inmediato aunque quede período pagado por delante.
  if v_allowed and s.chargeback_at is not null and p_now >= s.chargeback_at then return false; end if;
  return v_allowed;
end;
$$;

-- ¿La sesión actual puede escribir? (interruptor + estado). Ejecutable por `authenticated`: sólo informa SU PROPIO estado, que ya puede leer en `billing_subscriptions`.
create or replace function public.tf_can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select b.write_gate_enabled from public.billing_settings b where b.id) then public.tf_write_access(auth.uid()) else true end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Disparador de sentencia: bloquea la escritura de una cuenta limitada cuando el interruptor está encendido.
-- ---------------------------------------------------------------------------
create or replace function public.tf_write_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;                                         -- derivada de otro disparador o cascada
  if coalesce(current_setting('role', true), 'none') <> 'authenticated' then return null; end if;   -- servicio, tareas, migraciones, administración
  if not coalesce((select b.write_gate_enabled from public.billing_settings b where b.id), false) then return null; end if;
  if public.tf_write_access(auth.uid()) then return null; end if;
  raise exception 'Tu cuenta está en modo limitado: no podés crear ni modificar datos hasta regularizar tu suscripción.' using errcode = 'TF006';
end;
$$;

revoke all on function public.tf_write_access(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.tf_write_gate() from public, anon, authenticated;
revoke all on function public.tf_can_write() from public, anon;
grant execute on function public.tf_can_write() to authenticated;

-- Tablas con compuerta: toda tabla donde una cuenta autenticada puede escribir datos operativos, directamente (permiso de escritura) o a través de una
-- función de la lista WRITE_RPC de `lib/billing/write-guard.ts`. Lista explícita (no «todas las tablas»): una prueba de catálogo compara esta lista con la base.
do $$
declare
  t text;
  v_tables constant text[] := array[
    'budget_distribution_settings', 'calendar_activity_operations', 'calendar_lesson_participants', 'calendar_lessons', 'calendar_replacement_links',
    'calendar_replacement_notices', 'calendar_reschedule_operations', 'calendar_series_replacement_links', 'custom_levels', 'deleted_student_creation_operations',
    'device_local_snapshots', 'financial_repair_audit', 'first_month_proration_decisions', 'import_previews', 'import_run_row_snapshots', 'import_runs',
    'import_undo_previews', 'initial_paid_surcharge_corrections', 'legacy_cloud_backup_archive', 'lesson_attachments', 'lesson_registration_attendance',
    'lesson_registration_billing_resolutions', 'lesson_registration_edit_history', 'lesson_registration_evaluations', 'lesson_registration_homework_reviews',
    'lesson_registration_students', 'lesson_registrations', 'live_class_sessions', 'material_library_items', 'monthly_amount_corrections', 'origin_incidents',
    'package_credit_movements', 'package_purchases', 'payment_adjustments', 'payment_allocations', 'payment_charges', 'payments',
    'pending_training_billing_operations', 'phone_extraction_results', 'recurrence_exceptions', 'recurrence_rule_participants', 'recurrence_rules',
    'report_draft_claims', 'report_pdf_cleanup_jobs', 'report_records', 'student_billing_audit', 'student_creation_claims', 'student_deletion_receipts',
    'student_file_cleanup_jobs', 'student_level_history', 'student_price_history', 'student_source_extras', 'student_status_history', 'students',
    'surcharge_settings', 'teacher_availability', 'teacher_profiles', 'test_data_exclusions', 'training_billing_agreements'
  ];
begin
  foreach t in array v_tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception 'tf_write_gate: la tabla public.% no existe; revisar la lista antes de aplicar', t;
    end if;
    execute format('drop trigger if exists tf_write_gate on public.%I', t);
    execute format('create trigger tf_write_gate before insert or update or delete on public.%I for each statement execute function public.tf_write_gate()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Archivos: subir o reemplazar en los buckets de la aplicación exige poder escribir. Borrar y leer no cambian (eliminar la cuenta limpia sus archivos).
--    Política RESTRICTIVA: se suma (AND) a las políticas existentes, no las reemplaza.
-- ---------------------------------------------------------------------------
drop policy if exists tf_write_gate_insert on storage.objects;
create policy tf_write_gate_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('lesson-files', 'report-pdfs') or public.tf_can_write());
drop policy if exists tf_write_gate_update on storage.objects;
create policy tf_write_gate_update on storage.objects as restrictive for update to authenticated
  using (bucket_id not in ('lesson-files', 'report-pdfs') or public.tf_can_write())
  with check (bucket_id not in ('lesson-files', 'report-pdfs') or public.tf_can_write());
