-- Fase 9 v1 — Backup e importación. Diseño negociado en varias rondas con
-- Joaquín (ver docs/WEB_PARITY_PLAN.md, sección Fase 9, para el historial
-- completo de decisiones). Resumen de las garantías de producto que este
-- archivo implementa — NINGUNA es negociable dentro de esta migración:
--
--   1. La web gana por defecto. "La nube siempre gana" es una regla
--      exclusiva del flujo móvil (dispositivo local vs. su propia copia
--      remota) — NUNCA se traduce acá como "el backup pisa la web".
--   2. Aditiva y de recuperación, nunca sincronización destructiva: ningún
--      camino de este archivo contiene un DELETE que borre una fila web
--      por el solo hecho de no aparecer en el backup. El único DELETE de
--      todo el archivo vive en `apply_undo_backup_import`, acotado por
--      `import_run_id` + comprobación de huella fila por fila.
--   3. Manual y opcional: nada se dispara solo. La app funciona igual si
--      esto nunca se usa.
--   4. Transacción única real por confirmación — la atomicidad la da
--      Postgres (una función = una transacción), nunca un "rollback
--      manual" escrito a mano.
--
-- Todas las RPC nuevas: `security definer`, `set search_path = ''`,
-- referencias 100% calificadas, `revoke execute ... from public, anon`
-- explícito, sólo `grant ... to authenticated` — mismo patrón endurecido
-- desde Fase 7. Correr `supabase/tests/anon_execute_audit.sql` después de
-- aplicar.

-- =============================================================================
-- SECCIÓN 1 — Tablas técnicas (7). RLS habilitado, CERO policies para
-- authenticated/anon en las que sólo se tocan vía RPC — mismo patrón que
-- `report_draft_claims`/`report_pdf_cleanup_jobs` (Fase 7).
-- =============================================================================

create table public.import_previews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  backup_checksum text not null,
  schema_version integer not null,
  app_version text,
  normalized_payload jsonb not null,
  classification jsonb not null,
  excluded_collections jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
alter table public.import_previews enable row level security;
revoke all on public.import_previews from authenticated, anon;
create index import_previews_owner_status_idx on public.import_previews (owner_id, status, expires_at);

create table public.import_preview_row_fingerprints (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references public.import_previews(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  fingerprint text not null,
  unique (preview_id, table_name, row_id)
);
alter table public.import_preview_row_fingerprints enable row level security;
revoke all on public.import_preview_row_fingerprints from authenticated, anon;

-- Candidatos de "posible duplicado" (alumno del backup sin legacy_mobile_id
-- coincidente que igual matchea heurísticamente contra un alumno web sin
-- legacy_mobile_id, por nombre/email/teléfono normalizados). El diff de
-- campos se precalcula acá mismo, para que si la profesora elige "vincular"
-- en la confirmación no haga falta un preview nuevo.
create table public.import_preview_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  preview_id uuid not null references public.import_previews(id) on delete cascade,
  backup_legacy_mobile_id text not null,
  candidate_student_id uuid not null references public.students(id) on delete cascade,
  match_signals text[] not null,
  candidate_fingerprint text not null,
  field_diff jsonb not null,
  unique (preview_id, backup_legacy_mobile_id)
);
alter table public.import_preview_duplicate_candidates enable row level security;
revoke all on public.import_preview_duplicate_candidates from authenticated, anon;

-- Autoridad real de idempotencia: `unique (owner_id, preview_id)`, nunca un
-- operation_id generado por el cliente. A lo sumo un import_run por
-- preview, para siempre.
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  preview_id uuid not null references public.import_previews(id),
  status text not null default 'applied' check (status in ('applied', 'undone')),
  -- Copia denormalizada de identidad del backup importado (checksum/versión)
  -- — nunca el payload. Se copia de `import_previews` al confirmar, para
  -- que el historial real (`authenticated` SÍ tiene SELECT propio sobre
  -- `import_runs`, nunca sobre `import_previews`) pueda mostrarla sin
  -- exponer una vía de lectura nueva hacia la tabla técnica de preview.
  backup_checksum text not null,
  schema_version int not null,
  app_version text,
  summary jsonb not null,
  field_overrides jsonb not null,
  duplicate_decisions jsonb not null,
  retained_payload jsonb,
  payload_purged_at timestamptz,
  snapshots_purged_at timestamptz,
  created_at timestamptz not null default now(),
  undo_expires_at timestamptz not null default (now() + interval '30 days'),
  undone_at timestamptz,
  unique (owner_id, preview_id)
);
alter table public.import_runs enable row level security;
revoke all on public.import_runs from anon;
revoke insert, update, delete on public.import_runs from authenticated;
create policy import_runs_owner_select on public.import_runs
  for select using (owner_id = auth.uid());

create table public.import_run_row_snapshots (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('inserted', 'field_overwritten', 'identity_linked')),
  previous_row jsonb,
  new_row jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.import_run_row_snapshots enable row level security;
revoke all on public.import_run_row_snapshots from authenticated, anon;
create index import_run_row_snapshots_run_idx on public.import_run_row_snapshots (import_run_id);
create index import_run_row_snapshots_lookup_idx on public.import_run_row_snapshots (table_name, row_id);

create table public.import_undo_previews (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id),
  owner_id uuid not null references auth.users(id) on delete cascade,
  is_safe boolean not null,
  unsafe_rows jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
alter table public.import_undo_previews enable row level security;
revoke all on public.import_undo_previews from authenticated, anon;

-- Registro TIPADO de dependencias entrantes reales (FKs hacia tablas que
-- esta importación puede insertar) — es la autoridad que usa el cierre de
-- undo (sección 5) para decidir si borrar una fila insertada es seguro.
-- Nunca se recorre dinámicamente por nombre en tiempo de ejecución del
-- undo (eso sigue siendo ramas `case` tipadas) — esta tabla es sólo el
-- INVENTARIO real, y existe principalmente para que
-- `supabase/tests/backup_import_dependency_registry_audit.sql` pueda
-- comparar esta lista contra `pg_constraint` real y fallar si una
-- migración futura agrega una FK entrante que el undo todavía no cubre.
create table public.import_undo_dependency_registry (
  parent_table text not null,
  child_table text not null,
  fk_column text not null,
  primary key (parent_table, child_table, fk_column)
);
-- Sin RLS: es un catálogo estático de metadatos de esquema, no datos de
-- ninguna cuenta — se puede leer libremente, nunca se escribe desde el
-- cliente (sin grants de insert/update/delete para authenticated/anon).
revoke insert, update, delete on public.import_undo_dependency_registry from authenticated, anon;
grant select on public.import_undo_dependency_registry to authenticated;

insert into public.import_undo_dependency_registry (parent_table, child_table, fk_column) values
  -- Dependencias entrantes reales hacia `students` (21, confirmadas contra
  -- las 22 migraciones anteriores + esta misma — students.id es la tabla
  -- con más FKs entrantes). Incluye `recurrence_rules.primary_student_id`
  -- (nullable/ON DELETE SET NULL) y `report_draft_claims.student_id`
  -- (Fase 7): aunque un `SET NULL` no "rompe" la fila igual que un
  -- `RESTRICT`/`CASCADE`, sigue siendo una mutación real sobre una fila que
  -- la profesora pudo haber creado/editado después de la importación —
  -- deshacer nunca debe tocarla en silencio, mismo criterio que el resto.
  ('students', 'student_status_history', 'student_id'),
  ('students', 'student_level_history', 'student_id'),
  ('students', 'student_price_history', 'student_id'),
  ('students', 'recurrence_rule_participants', 'student_id'),
  ('students', 'recurrence_rules', 'primary_student_id'),
  ('students', 'calendar_lessons', 'primary_student_id'),
  ('students', 'calendar_lesson_participants', 'student_id'),
  ('students', 'lesson_registration_students', 'student_id'),
  ('students', 'lesson_registration_attendance', 'student_id'),
  ('students', 'lesson_registration_evaluations', 'student_id'),
  ('students', 'lesson_registration_homework_reviews', 'student_id'),
  ('students', 'payment_charges', 'student_id'),
  ('students', 'payments', 'student_id'),
  ('students', 'payment_allocations', 'student_id'),
  ('students', 'payment_adjustments', 'student_id'),
  ('students', 'package_purchases', 'student_id'),
  ('students', 'package_credit_movements', 'student_id'),
  ('students', 'monthly_amount_corrections', 'student_id'),
  ('students', 'initial_paid_surcharge_corrections', 'student_id'),
  ('students', 'first_month_proration_decisions', 'student_id'),
  ('students', 'report_records', 'student_id'),
  ('students', 'report_draft_claims', 'student_id'),
  -- Fase 2 (corrección de carrera de alta manual,
  -- 20260927100000_student_creation_race_fix.sql): un borrador de alta
  -- manual nunca debería apuntar a un alumno IMPORTADO (sólo liga alumnos
  -- creados por `create_student_via_web` mismo) — pero la fila entrante es
  -- real igual, y `_blocks_undo_via_child` la bloquea siempre (nunca
  -- pertenece al import_run), nunca confiando en ese supuesto por sí solo.
  ('students', 'student_creation_claims', 'student_id'),
  -- custom_levels: sin FK real entrante (students.levels referencia por
  -- nombre, no por FK) — sin filas en el registro, a propósito.
  -- training_billing_agreements
  ('training_billing_agreements', 'recurrence_rules', 'training_billing_agreement_id'),
  ('training_billing_agreements', 'payment_charges', 'training_billing_agreement_id'),
  -- recurrence_rules
  ('recurrence_rules', 'recurrence_rule_participants', 'recurrence_rule_id'),
  ('recurrence_rules', 'recurrence_exceptions', 'recurrence_id'),
  ('recurrence_rules', 'calendar_lessons', 'recurrence_id'),
  ('recurrence_rules', 'recurrence_rules', 'supersedes_recurrence_id'),
  ('recurrence_rules', 'recurrence_rules', 'superseded_by_recurrence_id'),
  -- calendar_lessons
  ('calendar_lessons', 'calendar_lesson_participants', 'calendar_lesson_id'),
  ('calendar_lessons', 'recurrence_exceptions', 'replacement_lesson_id'),
  ('calendar_lessons', 'lesson_registrations', 'calendar_lesson_id'),
  ('calendar_lessons', 'payment_charges', 'calendar_lesson_id'),
  ('calendar_lessons', 'calendar_lessons', 'freed_by_lesson_id'),
  -- lesson_registrations
  ('lesson_registrations', 'lesson_registration_students', 'lesson_registration_id'),
  ('lesson_registrations', 'lesson_registration_attendance', 'lesson_registration_id'),
  ('lesson_registrations', 'lesson_registration_evaluations', 'lesson_registration_id'),
  ('lesson_registrations', 'lesson_registration_homework_reviews', 'lesson_registration_id'),
  ('lesson_registrations', 'lesson_registration_edit_history', 'lesson_registration_id'),
  ('lesson_registrations', 'payment_charges', 'saved_lesson_id'),
  ('lesson_registrations', 'package_credit_movements', 'saved_lesson_id'),
  ('lesson_registrations', 'lesson_registrations', 'rescheduled_from_registration_id'),
  -- package_purchases
  ('package_purchases', 'package_credit_movements', 'package_id'),
  ('package_purchases', 'payment_charges', 'package_id'),
  -- payment_charges
  ('payment_charges', 'payment_allocations', 'charge_id'),
  ('payment_charges', 'payment_adjustments', 'charge_id'),
  ('payment_charges', 'first_month_proration_decisions', 'charge_id'),
  -- payments
  ('payments', 'payment_allocations', 'payment_id'),
  ('payments', 'payments', 'replaces_payment_id'),
  ('payments', 'initial_paid_surcharge_corrections', 'voided_payment_id'),
  ('payments', 'initial_paid_surcharge_corrections', 'new_payment_id');

comment on table public.import_undo_dependency_registry is
  'Inventario TIPADO de FKs entrantes reales hacia tablas importables por Fase 9. Auditado contra pg_constraint real por supabase/tests/backup_import_dependency_registry_audit.sql — si una migración futura agrega una FK entrante nueva hacia cualquiera de estas tablas y no se agrega acá, esa prueba debe fallar. Nunca usado para SQL dinámico en el camino de escritura real (eso son ramas case tipadas) — sólo como catálogo auditable.';

-- =============================================================================
-- SECCIÓN 2 — Canonicalización y huella, UNA sola implementación usada por
-- preview, fingerprint inicial, re-chequeo en apply y re-chequeo en undo.
-- Estrategia POR CAMPO (nunca genérica por tipo) — timestamps de negocio
-- (paid_at, due_date, etc.) son columnas `date` reales en Postgres, sin
-- componente horario: no hay nada que truncar, la precisión ya es civil
-- exacta. Los pocos `timestamptz` técnicos comparados (recorded_at,
-- generated_at) se comparan EXACTOS (sin truncar a segundo) salvo que se
-- demuestre que el formato móvil realmente pierde precisión — no se asume.
-- =============================================================================

create or replace function public._canonicalize_row(p_table_name text, p_row jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := p_row;
begin
  case p_table_name
    when 'students' then
      -- Conjuntos (el orden no tiene significado real para estos campos):
      v_out := v_out
        || jsonb_build_object('levels', public._sorted_text_array(p_row->'levels'))
        || jsonb_build_object('alerts', public._sorted_text_array(p_row->'alerts'))
        || jsonb_build_object('current_goals', public._sorted_text_array(p_row->'current_goals'))
        || jsonb_build_object('strengths', public._sorted_text_array(p_row->'strengths'))
        || jsonb_build_object('areas_to_improve', public._sorted_text_array(p_row->'areas_to_improve'))
        -- usual_days: representa días de la semana, sin orden semántico real
        -- para esta comparación (a diferencia de una AGENDA, acá sólo importa
        -- el CONJUNTO de días habituales).
        || jsonb_build_object('usual_days', public._sorted_text_array(p_row->'usual_days'))
        -- Identificadores personales normalizados:
        || jsonb_build_object('phone', public._normalize_phone(p_row->>'phone'))
        || jsonb_build_object('whatsapp', public._normalize_phone(p_row->>'whatsapp'))
        || jsonb_build_object('email', public._normalize_email(p_row->>'email'))
        -- Texto libre: null y ausente ya se tratan igual por construcción
        -- (ambos ausentes de v_out si no vinieron) — '' explícito se
        -- conserva tal cual, es un valor real distinto de null.
        || jsonb_build_object('name', btrim(coalesce(p_row->>'name', '')));
    when 'custom_levels' then
      v_out := v_out || jsonb_build_object('name', btrim(coalesce(p_row->>'name', '')));
    when 'teacher_profiles' then
      v_out := v_out || jsonb_build_object('display_name', btrim(coalesce(p_row->>'display_name', '')));
    when 'budget_distribution_settings' then
      -- Porcentajes: numeric, ya comparan por VALOR (no por texto) al
      -- castear; jsonb estructurado (savings_goal) ya normaliza orden de
      -- claves al almacenarse — se compara tal cual.
      null;
    when 'teacher_availability' then
      -- weekly_blocks/exceptions: jsonb estructurado, orden de columnas
      -- normalizado por Postgres al almacenar; el ORDEN de los elementos
      -- dentro del array SÍ tiene alguna relevancia visual pero no cambia
      -- el significado (son bloqueos independientes) -> se ordenan por su
      -- propio `id` para una comparación estable.
      v_out := v_out
        || jsonb_build_object('weekly_blocks', public._sorted_jsonb_array_by_key(p_row->'weekly_blocks', 'id'))
        || jsonb_build_object('exceptions', public._sorted_jsonb_array_by_key(p_row->'exceptions', 'id'));
    else
      null;
  end case;
  return v_out;
end;
$$;

create or replace function public._sorted_text_array(p_value jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(
    (select jsonb_agg(v order by v) from (select distinct jsonb_array_elements_text(coalesce(p_value, '[]'::jsonb)) as v) s),
    '[]'::jsonb
  );
$$;

create or replace function public._sorted_jsonb_array_by_key(p_value jsonb, p_key text)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(
    (select jsonb_agg(elem order by elem->>p_key) from jsonb_array_elements(coalesce(p_value, '[]'::jsonb)) elem),
    '[]'::jsonb
  );
$$;

/** Conserva sólo dígitos y un '+' inicial opcional — nunca compara formato visual (espacios/guiones), sólo el número real. */
create or replace function public._normalize_phone(p_value text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(btrim(p_value), ''), '[^0-9+]', '', 'g');
$$;

create or replace function public._normalize_email(p_value text)
returns text language sql immutable as $$
  select lower(btrim(coalesce(p_value, '')));
$$;

/**
 * Señales de coincidencia real entre un alumno candidato y un alumno
 * objetivo (nombre/email/teléfono) — ÚNICA definición real de "qué cuenta
 * como posible duplicado" en todo el proyecto. Usada tanto por
 * `_classify_students` (heurística de Fase 9, backup vs. alumno existente)
 * como por `create_student_via_web`/`_find_student_duplicate_candidates`
 * (Fase 2, alta manual vs. cualquier alumno existente) — corrección
 * obligatoria de Joaquín: nunca dos definiciones independientes de
 * normalización que puedan divergir. Nunca decide "son la misma persona"
 * por sí sola — sólo devuelve las señales, quien la llama decide qué hacer.
 */
create or replace function public._student_match_signals(
  p_candidate_name text, p_candidate_email text, p_candidate_phone text,
  p_target_name text, p_target_email text, p_target_phone text
)
returns text[] language sql immutable set search_path = '' as $$
  select
    (case when btrim(coalesce(p_candidate_name, '')) <> '' and lower(btrim(p_candidate_name)) = lower(btrim(coalesce(p_target_name, ''))) then array['name']::text[] else array[]::text[] end)
    || (case when p_candidate_email is not null and p_target_email is not null and public._normalize_email(p_candidate_email) = public._normalize_email(p_target_email) and public._normalize_email(p_candidate_email) <> '' then array['email']::text[] else array[]::text[] end)
    || (case when p_candidate_phone is not null and p_target_phone is not null and public._normalize_phone(p_candidate_phone) = public._normalize_phone(p_target_phone) and public._normalize_phone(p_candidate_phone) <> '' then array['phone']::text[] else array[]::text[] end);
$$;

create or replace function public._fingerprint_canonical(p_table_name text, p_row jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(public._canonicalize_row(p_table_name, p_row)::text, 'UTF8'), 'sha256'), 'hex');
$$;

/**
 * Huella de una fila VIVA (no del backup) por tabla+id+owner — usada para
 * re-verificar en `apply_backup_import` (filas matched) y en el cierre de
 * undo. Ramas tipadas para las 20 tablas importables — nunca `EXECUTE`
 * dinámico. Devuelve `null` si la fila ya no existe (el llamador decide qué
 * significa eso en su contexto: para el re-chequeo de un match, "ya no
 * existe" es en sí mismo un cambio real desde el preview).
 */
create or replace function public._fingerprint_row(p_table_name text, p_row_id uuid, p_owner uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
begin
  case p_table_name
    when 'students' then select to_jsonb(t) into v_row from public.students t where t.id = p_row_id and t.owner_id = p_owner;
    when 'custom_levels' then select to_jsonb(t) into v_row from public.custom_levels t where t.id = p_row_id and t.owner_id = p_owner;
    when 'teacher_profiles' then select to_jsonb(t) into v_row from public.teacher_profiles t where t.owner_id = p_row_id and t.owner_id = p_owner;
    when 'budget_distribution_settings' then select to_jsonb(t) into v_row from public.budget_distribution_settings t where t.owner_id = p_row_id and t.owner_id = p_owner;
    when 'teacher_availability' then select to_jsonb(t) into v_row from public.teacher_availability t where t.owner_id = p_row_id and t.owner_id = p_owner;
    when 'training_billing_agreements' then select to_jsonb(t) into v_row from public.training_billing_agreements t where t.id = p_row_id and t.owner_id = p_owner;
    when 'student_level_history' then select to_jsonb(t) into v_row from public.student_level_history t where t.id = p_row_id and t.owner_id = p_owner;
    when 'surcharge_settings' then select to_jsonb(t) into v_row from public.surcharge_settings t where t.owner_id = p_row_id and t.owner_id = p_owner;
    when 'recurrence_rules' then select to_jsonb(t) into v_row from public.recurrence_rules t where t.id = p_row_id and t.owner_id = p_owner;
    when 'recurrence_rule_participants' then select to_jsonb(t) into v_row from public.recurrence_rule_participants t where t.id = p_row_id and t.owner_id = p_owner;
    when 'recurrence_exceptions' then select to_jsonb(t) into v_row from public.recurrence_exceptions t where t.id = p_row_id and t.owner_id = p_owner;
    when 'calendar_lessons' then select to_jsonb(t) into v_row from public.calendar_lessons t where t.id = p_row_id and t.owner_id = p_owner;
    when 'calendar_lesson_participants' then select to_jsonb(t) into v_row from public.calendar_lesson_participants t where t.id = p_row_id and t.owner_id = p_owner;
    when 'lesson_registrations' then select to_jsonb(t) into v_row from public.lesson_registrations t where t.id = p_row_id and t.owner_id = p_owner;
    when 'lesson_registration_students' then select to_jsonb(t) into v_row from public.lesson_registration_students t where t.id = p_row_id and t.owner_id = p_owner;
    when 'lesson_registration_attendance' then select to_jsonb(t) into v_row from public.lesson_registration_attendance t where t.id = p_row_id and t.owner_id = p_owner;
    when 'lesson_registration_evaluations' then select to_jsonb(t) into v_row from public.lesson_registration_evaluations t where t.id = p_row_id and t.owner_id = p_owner;
    when 'lesson_registration_homework_reviews' then select to_jsonb(t) into v_row from public.lesson_registration_homework_reviews t where t.id = p_row_id and t.owner_id = p_owner;
    when 'package_purchases' then select to_jsonb(t) into v_row from public.package_purchases t where t.id = p_row_id and t.owner_id = p_owner;
    when 'package_credit_movements' then select to_jsonb(t) into v_row from public.package_credit_movements t where t.id = p_row_id and t.owner_id = p_owner;
    when 'payment_charges' then select to_jsonb(t) into v_row from public.payment_charges t where t.id = p_row_id and t.owner_id = p_owner;
    when 'payments' then select to_jsonb(t) into v_row from public.payments t where t.id = p_row_id and t.owner_id = p_owner;
    when 'payment_allocations' then select to_jsonb(t) into v_row from public.payment_allocations t where t.id = p_row_id and t.owner_id = p_owner;
    when 'payment_adjustments' then select to_jsonb(t) into v_row from public.payment_adjustments t where t.id = p_row_id and t.owner_id = p_owner;
    when 'monthly_amount_corrections' then select to_jsonb(t) into v_row from public.monthly_amount_corrections t where t.id = p_row_id and t.owner_id = p_owner;
    when 'initial_paid_surcharge_corrections' then select to_jsonb(t) into v_row from public.initial_paid_surcharge_corrections t where t.id = p_row_id and t.owner_id = p_owner;
    when 'first_month_proration_decisions' then select to_jsonb(t) into v_row from public.first_month_proration_decisions t where t.id = p_row_id and t.owner_id = p_owner;
    when 'report_records' then select to_jsonb(t) into v_row from public.report_records t where t.id = p_row_id and t.owner_id = p_owner;
    else raise exception 'Tabla no reconocida en _fingerprint_row: %', p_table_name;
  end case;

  if v_row is null then return null; end if;
  return public._fingerprint_canonical(p_table_name, v_row);
end;
$$;

-- =============================================================================
-- SECCIÓN 3 — Lectura de sólo lectura del backup más reciente de la propia
-- cuenta. Angosta a propósito (autorizada explícitamente por Joaquín):
-- únicamente `auth.uid()`, sin exigir device_id/generation de
-- active_sessions (ese chequeo protege un escenario específico del modelo
-- de "un solo dispositivo móvil autorizado", que no aplica a una sesión web
-- ya autenticada leyendo su propia cuenta). Nunca modifica `cloud_backups`.
-- =============================================================================

create or replace function public.fetch_own_latest_cloud_backup()
returns table (id uuid, schema_version integer, app_version text, checksum text, payload jsonb, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  return query
    select cb.id, cb.schema_version, cb.app_version, cb.checksum, cb.payload, cb.created_at
      from public.cloud_backups as cb
      where cb.user_id = v_owner
      order by cb.created_at desc
      limit 1;
end;
$$;

revoke all on function public.fetch_own_latest_cloud_backup() from public;
revoke all on function public.fetch_own_latest_cloud_backup() from anon;
grant execute on function public.fetch_own_latest_cloud_backup() to authenticated;

-- =============================================================================
-- SECCIÓN 4 — Clasificación (preview_backup_import). SÓLO LECTURA — nunca
-- escribe una tabla de negocio, sólo las 3 tablas técnicas de preview.
-- =============================================================================

/** Alumnos: alta / igual / conflicto (con diff de campo) + heurística de posible duplicado. */
create or replace function public._classify_students(p_owner uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_inserts jsonb := '[]'::jsonb;
  v_equal jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_row jsonb;
  v_existing record;
  v_candidate jsonb;
  v_fields jsonb;
  v_dup record;
  v_signals text[];
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'students', '[]'::jsonb))
  loop
    select s.* into v_existing from public.students s
      where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'id';

    if not found then
      -- Sin legacy_mobile_id coincidente: heurística de duplicado ANTES de
      -- tratarlo como alta limpia — nunca auto-inserta ante una señal.
      -- Mismo helper compartido que usa el alta manual de Fase 2 — ver
      -- `_student_match_signals` (SECCIÓN 2).
      select st.* into v_dup from public.students st
        where st.owner_id = p_owner and st.legacy_mobile_id is null
          and array_length(public._student_match_signals(st.name, st.email, st.phone, v_row->>'name', v_row->>'email', v_row->>'phone'), 1) > 0
        limit 1;

      if found then
        v_signals := public._student_match_signals(v_dup.name, v_dup.email, v_dup.phone, v_row->>'name', v_row->>'email', v_row->>'phone');
        v_fields := public._diff_student_fields(to_jsonb(v_dup), v_row);
        v_duplicates := v_duplicates || jsonb_build_object(
          'backup_legacy_mobile_id', v_row->>'id',
          'candidate_student_id', v_dup.id,
          'match_signals', to_jsonb(v_signals),
          'candidate_fingerprint', public._fingerprint_canonical('students', to_jsonb(v_dup)),
          'field_diff', v_fields
        );
      else
        v_inserts := v_inserts || jsonb_build_object('legacy_mobile_id', v_row->>'id');
      end if;
    else
      v_fields := public._diff_student_fields(to_jsonb(v_existing), v_row);
      if v_fields = '{}'::jsonb then
        v_equal := v_equal || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'row_id', v_existing.id);
      else
        v_conflicts := v_conflicts || jsonb_build_object(
          'legacy_mobile_id', v_row->>'id', 'row_id', v_existing.id, 'fields', v_fields
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object('inserts', v_inserts, 'equal', v_equal, 'conflicts', v_conflicts, 'duplicates', v_duplicates);
end;
$$;

/**
 * Diff campo por campo entre la fila web real (`p_web_row`, forma de
 * columna: snake_case) y la fila cruda del backup (`p_backup_row`, forma
 * camelCase del móvil) — SÓLO para los 12 campos overridable de v1
 * (perfil no financiero, nunca estado/precio/plan/fechas de negocio). El
 * resto de las columnas de `students` NUNCA se compara ni se ofrece como
 * conflicto en v1 — el valor web se conserva siempre, sin excepción.
 */
create or replace function public._diff_student_fields(p_web_row jsonb, p_backup_row jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_diff jsonb := '{}'::jsonb;
  v_web_c jsonb := public._canonicalize_row('students', p_web_row);
  v_backup_candidate jsonb := jsonb_build_object(
    'name', btrim(coalesce(p_backup_row->>'name', '')),
    'phone', public._normalize_phone(p_backup_row->>'phone'),
    'whatsapp', public._normalize_phone(p_backup_row->>'whatsapp'),
    'email', public._normalize_email(p_backup_row->>'email'),
    'notes', p_backup_row->>'notes',
    'birth_date', p_backup_row->>'birthDate',
    'current_goals', public._sorted_text_array(p_backup_row->'currentGoals'),
    'strengths', public._sorted_text_array(p_backup_row->'strengths'),
    'areas_to_improve', public._sorted_text_array(p_backup_row->'areasToImprove'),
    'alerts', public._sorted_text_array(p_backup_row->'alerts'),
    'usual_days', public._sorted_text_array(p_backup_row->'usualDays'),
    'usual_time', p_backup_row->>'usualTime'
  );
  v_field text;
begin
  foreach v_field in array array['name','phone','whatsapp','email','notes','birth_date','current_goals','strengths','areas_to_improve','alerts','usual_days','usual_time']
  loop
    if coalesce(v_web_c->v_field, 'null'::jsonb) is distinct from coalesce(v_backup_candidate->v_field, 'null'::jsonb) then
      v_diff := v_diff || jsonb_build_object(v_field, jsonb_build_object('web', p_web_row->v_field, 'backup', v_backup_candidate->v_field));
    end if;
  end loop;
  return v_diff;
end;
$$;

/** custom_levels: alta / igual / conflicto (campo único: name). Field-overridable en v1. */
create or replace function public._classify_custom_levels(p_owner uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_inserts jsonb := '[]'::jsonb;
  v_equal jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_row jsonb;
  v_existing record;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'customLevels', '[]'::jsonb))
  loop
    select cl.* into v_existing from public.custom_levels cl
      where cl.owner_id = p_owner and cl.legacy_mobile_id = v_row->>'id';
    if not found then
      v_inserts := v_inserts || jsonb_build_object('legacy_mobile_id', v_row->>'id');
    elsif btrim(v_existing.name) = btrim(coalesce(v_row->>'name', '')) then
      v_equal := v_equal || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'row_id', v_existing.id);
    else
      v_conflicts := v_conflicts || jsonb_build_object(
        'legacy_mobile_id', v_row->>'id', 'row_id', v_existing.id,
        'fields', jsonb_build_object('name', jsonb_build_object('web', v_existing.name, 'backup', v_row->>'name'))
      );
    end if;
  end loop;
  return jsonb_build_object('inserts', v_inserts, 'equal', v_equal, 'conflicts', v_conflicts);
end;
$$;

/**
 * Singleton (teacher_profiles/budget_distribution_settings/teacher_availability):
 * a lo sumo 1 fila, PK=owner_id.
 *
 * Corrección real de bug (encontrada al diseñar el DTO de la UI de
 * preview — nunca antes probada con un caso realmente "igual"): `v_web_c`
 * debe construirse como el mismo subconjunto MINIMO y comparable que
 * `v_backup_c`, nunca como la fila web completa (`to_jsonb(t)` trae
 * columnas técnicas irrelevantes para la comparación —
 * `created_at`/`updated_at`/campos no comparados — que nunca podrían
 * coincidir con el objeto armado a mano del backup, así que la igualdad
 * `v_web_c = v_backup_c` jamás daba `true` aunque los valores reales
 * fueran idénticos: todo singleton se reportaba SIEMPRE como conflicto).
 * Selecciona directamente sólo los campos comparables — ya no reutiliza
 * `_canonicalize_row` para el lado web (ese uso genérico de fila completa
 * sigue vigente para `_fingerprint_row`, sin cambios, sin efecto acá).
 */
create or replace function public._classify_singleton(p_table_name text, p_owner uuid, p_backup_doc jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_web_c jsonb;
  v_backup_c jsonb;
begin
  if p_backup_doc is null then
    return jsonb_build_object('present_in_backup', false);
  end if;

  -- surcharge_settings: corrección real de bug — esta función se llamaba
  -- para esta tabla (SECCIÓN 4) sin que el `case` de abajo tuviera una
  -- rama para ella, así que CUALQUIER backup real con
  -- `surchargeSettings.current` no nulo hacía fallar `preview_backup_import`
  -- entero con "Tabla singleton no reconocida". Insert-only puro (decisión
  -- de Joaquín, Fase 8 — recargos automáticos desactivados
  -- estructuralmente): nunca ofrece override ni "conflicto" resoluble,
  -- así que no participa de la comparación genérica de igualdad de abajo.
  if p_table_name = 'surcharge_settings' then
    if exists(select 1 from public.surcharge_settings s where s.owner_id = p_owner) then
      return jsonb_build_object('present_in_backup', true, 'status', 'preserved');
    end if;
    return jsonb_build_object('present_in_backup', true, 'status', 'insert');
  end if;

  case p_table_name
    when 'teacher_profiles' then
      select jsonb_build_object('display_name', btrim(coalesce(t.display_name, ''))) into v_web_c
        from public.teacher_profiles t where t.owner_id = p_owner;
      v_backup_c := jsonb_build_object('display_name', btrim(coalesce(p_backup_doc->>'displayName', '')));
    when 'budget_distribution_settings' then
      select jsonb_build_object('needs_percent', t.needs_percent, 'wants_percent', t.wants_percent, 'savings_percent', t.savings_percent) into v_web_c
        from public.budget_distribution_settings t where t.owner_id = p_owner;
      v_backup_c := jsonb_build_object(
        'needs_percent', (p_backup_doc->'distribution'->>'needs')::smallint,
        'wants_percent', (p_backup_doc->'distribution'->>'wants')::smallint,
        'savings_percent', (p_backup_doc->'distribution'->>'savings')::smallint
      );
    when 'teacher_availability' then
      select jsonb_build_object(
        'timezone', t.timezone,
        'weekly_blocks', public._sorted_jsonb_array_by_key(t.weekly_blocks, 'id'),
        'exceptions', public._sorted_jsonb_array_by_key(t.exceptions, 'id')
      ) into v_web_c
        from public.teacher_availability t where t.owner_id = p_owner;
      v_backup_c := jsonb_build_object(
        'timezone', p_backup_doc->>'timezone',
        'weekly_blocks', public._sorted_jsonb_array_by_key(p_backup_doc->'weeklyBlocks', 'id'),
        'exceptions', public._sorted_jsonb_array_by_key(p_backup_doc->'exceptions', 'id')
      );
    else raise exception 'Tabla singleton no reconocida: %', p_table_name;
  end case;

  if v_web_c is null then
    return jsonb_build_object('present_in_backup', true, 'status', 'insert');
  end if;

  if v_web_c = v_backup_c then
    return jsonb_build_object('present_in_backup', true, 'status', 'equal', 'row_id', p_owner);
  end if;
  return jsonb_build_object('present_in_backup', true, 'status', 'conflict', 'row_id', p_owner, 'web', v_web_c, 'backup', v_backup_c);
end;
$$;

/**
 * Insert-only puro (sin override de campo jamás, movido acá a pedido
 * explícito de Joaquín): `training_billing_agreements`, `student_level_history`.
 * Alta si no existe `legacy_mobile_id`; si existe, se PRESERVA la web
 * completa siempre — se informa si además difiere, sólo a título
 * informativo (nunca ofrece resolverlo).
 */
create or replace function public._classify_insert_only(p_table_name text, p_owner uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_inserts jsonb := '[]'::jsonb;
  v_preserved jsonb := '[]'::jsonb;
  v_row jsonb;
  v_exists boolean;
  v_differs boolean;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    case p_table_name
      when 'training_billing_agreements' then
        select exists(select 1 from public.training_billing_agreements t where t.owner_id = p_owner and t.legacy_mobile_id = v_row->>'id') into v_exists;
        if v_exists then
          select (t.monthly_fee is distinct from (v_row->>'monthlyFee')::numeric) into v_differs
            from public.training_billing_agreements t where t.owner_id = p_owner and t.legacy_mobile_id = v_row->>'id';
        end if;
      when 'student_level_history' then
        select exists(select 1 from public.student_level_history t where t.owner_id = p_owner and t.legacy_mobile_id = v_row->>'id') into v_exists;
        v_differs := false; -- entradas históricas: mismo id -> mismo hecho por definición, nunca se re-evalúa contenido
      else raise exception 'Tabla insert-only no reconocida: %', p_table_name;
    end case;

    if not v_exists then
      v_inserts := v_inserts || jsonb_build_object('legacy_mobile_id', v_row->>'id');
    else
      v_preserved := v_preserved || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'differs', coalesce(v_differs, false));
    end if;
  end loop;

  return jsonb_build_object('inserts', v_inserts, 'preserved', v_preserved);
end;
$$;

/**
 * Agregados simples (padre + hijos declarados por ÉL MISMO, sin hijos
 * compartidos entre padres — a diferencia del dominio financiero, ver
 * `_classify_financial_components`). Regla: el agregado completo se
 * inserta SÓLO si el padre es alta limpia; si el padre ya existe de
 * cualquier forma (igual o distinto), el agregado completo queda
 * preservado/omitido, nunca se insertan hijos sueltos sobre un padre ya
 * existente. Una referencia externa rota (a un maestro que no resuelve)
 * omite el agregado completo.
 */
create or replace function public._classify_recurrence_rules(p_owner uuid, p_payload jsonb, p_students_classified jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
  v_exists boolean;
  v_student_ok boolean := true;
  v_agreement_ok boolean := true;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'recurrenceRules', '[]'::jsonb))
  loop
    select exists(select 1 from public.recurrence_rules r where r.owner_id = p_owner and r.legacy_mobile_id = v_row->>'id') into v_exists;
    if v_exists then
      v_result := v_result || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'status', 'preserved', 'reason', 'la regla ya existe en la web');
      continue;
    end if;

    -- El alumno puede ya existir en la web O ser una alta limpia de ESTA
    -- MISMA corrida (students se inserta antes en el orden topológico) —
    -- nunca sólo "ya existe hoy", si no el caso más común (alumno nuevo +
    -- su agenda) se omitiría siempre por error.
    v_student_ok := v_row->>'primaryStudentId' is null
      or public._external_ref_available('students', p_owner, v_row->>'primaryStudentId', p_students_classified);

    v_agreement_ok := true;
    if v_row->>'trainingBillingAgreementId' is not null then
      select exists(
        select 1 from public.training_billing_agreements a where a.owner_id = p_owner and a.legacy_mobile_id = v_row->>'trainingBillingAgreementId'
      ) into v_agreement_ok;
    end if;

    if not v_student_ok or not v_agreement_ok then
      v_result := v_result || jsonb_build_object(
        'legacy_mobile_id', v_row->>'id', 'status', 'omitted_broken_reference',
        'reason', case when not v_student_ok then 'referencia a alumno inexistente' else 'referencia a acuerdo de entrenamiento inexistente' end
      );
    else
      v_result := v_result || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'status', 'insertable');
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public._classify_calendar_lessons(p_owner uuid, p_payload jsonb, p_students_classified jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
  v_exists boolean;
  v_student_ok boolean;
  v_recurrence_ok boolean;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'calendarLessons', '[]'::jsonb))
  loop
    select exists(select 1 from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'id') into v_exists;
    if v_exists then
      v_result := v_result || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'status', 'preserved', 'reason', 'la clase ya existe en la web');
      continue;
    end if;

    v_student_ok := public._external_ref_available('students', p_owner, v_row->>'primaryStudentId', p_students_classified);
    v_recurrence_ok := true;
    if v_row->>'recurrenceId' is not null then
      select exists(select 1 from public.recurrence_rules r where r.owner_id = p_owner and r.legacy_mobile_id = v_row->>'recurrenceId') into v_recurrence_ok;
    end if;

    if not v_student_ok or not v_recurrence_ok then
      v_result := v_result || jsonb_build_object(
        'legacy_mobile_id', v_row->>'id', 'status', 'omitted_broken_reference',
        'reason', case when not v_student_ok then 'referencia a alumno inexistente' else 'referencia a una serie que no se importó' end
      );
    else
      v_result := v_result || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'status', 'insertable');
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public._classify_lesson_registrations(p_owner uuid, p_payload jsonb, p_students_classified jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_row jsonb;
  v_exists boolean;
  v_lesson_ok boolean;
  v_roster jsonb;
  v_student jsonb;
  v_roster_ok boolean;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'pedagogicalLessons', '[]'::jsonb))
  loop
    select exists(select 1 from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id = v_row->>'id') into v_exists;
    if v_exists then
      v_result := v_result || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'status', 'preserved', 'reason', 'el registro ya existe en la web');
      continue;
    end if;

    v_lesson_ok := true;
    if v_row->>'calendarLessonId' is not null then
      select exists(select 1 from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'calendarLessonId') into v_lesson_ok;
    end if;

    v_roster_ok := true;
    v_roster := coalesce(v_row->'roster', '[]'::jsonb);
    for v_student in select * from jsonb_array_elements(v_roster)
    loop
      if not public._external_ref_available('students', p_owner, v_student->>'studentId', p_students_classified) then
        v_roster_ok := false;
      end if;
    end loop;

    if not v_lesson_ok or not v_roster_ok then
      v_result := v_result || jsonb_build_object(
        'legacy_mobile_id', v_row->>'id', 'status', 'omitted_broken_reference',
        'reason', case when not v_lesson_ok then 'referencia a una clase de calendario que no se importó' else 'roster con un alumno inexistente' end
      );
    else
      v_result := v_result || jsonb_build_object('legacy_mobile_id', v_row->>'id', 'status', 'insertable');
    end if;
  end loop;
  return v_result;
end;
$$;

-- `package_purchases`/`package_credit_movements` NO tienen un clasificador
-- de agregado simple propio: participan siempre del grafo de componentes
-- conexas financiero (`_classify_financial_components`, abajo) porque
-- `package_credit_movements.packageId` es una arista real hacia
-- `package_purchases` — y cuando un `payment_charges` de tipo 'paquete'
-- referencia esa misma compra ("cuando estén conectados", corrección
-- obligatoria de Joaquín), la compra pasa a formar parte de la MISMA
-- componente que el cargo. Tratarlas aparte hubiera sido inconsistente con
-- esa misma regla.

/** true si `p_legacy_id` ya existe en la web (por legacy_mobile_id) O aparece como 'insertable'/en 'inserts' dentro de `p_classified`. */
create or replace function public._external_ref_available(p_table_name text, p_owner uuid, p_legacy_id text, p_classified jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_exists boolean;
begin
  if p_legacy_id is null then return true; end if;

  case p_table_name
    when 'training_billing_agreements' then
      select exists(select 1 from public.training_billing_agreements a where a.owner_id = p_owner and a.legacy_mobile_id = p_legacy_id) into v_exists;
    when 'calendar_lessons' then
      select exists(select 1 from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = p_legacy_id) into v_exists;
    when 'lesson_registrations' then
      select exists(select 1 from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id = p_legacy_id) into v_exists;
    when 'students' then
      select exists(select 1 from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = p_legacy_id) into v_exists;
    else raise exception 'Tabla externa no reconocida: %', p_table_name;
  end case;
  if v_exists then return true; end if;
  if p_classified is null then return false; end if;

  return exists(
    select 1 from jsonb_array_elements(coalesce(p_classified->'inserts', p_classified, '[]'::jsonb)) e
      where (e->>'legacy_mobile_id') = p_legacy_id
        and (e->>'status' is null or e->>'status' = 'insertable')
  );
end;
$$;

/**
 * Dominio financiero como COMPONENTES CONEXAS reales (corrección obligatoria
 * de Joaquín — `payment_allocations` pertenece a la vez a un pago y a un
 * cargo, nunca se modela como dos agregados independientes). Nodos: las 8
 * colecciones con relaciones internas cruzadas. Aristas: SÓLO referencias
 * INTERNAS entre estas 8 colecciones (nunca hacia un maestro externo como
 * `students` — esas se verifican aparte, sin traer al maestro a la
 * componente). Una componente se importa completa únicamente si TODAS sus
 * filas son alta limpia, TODAS sus referencias internas resuelven dentro de
 * la misma componente, y TODAS sus referencias externas a maestros ya
 * resueltos son válidas — si UNA sola falla, la componente ENTERA queda
 * preservada/omitida, nunca una inserción parcial. Cada `payment_allocations`
 * pertenece a exactamente UNA componente (nunca se evalúa ni se inserta dos
 * veces, aunque conecte un pago y un cargo).
 */
create or replace function public._classify_financial_components(
  p_owner uuid, p_payload jsonb,
  p_students_classified jsonb, p_training_agreements_classified jsonb, p_calendar_lessons_classified jsonb, p_lesson_registrations_classified jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_key text;
  v_edge record;
  v_root_a text; v_root_b text; v_min text;
  v_changed boolean;
  v_components jsonb := '[]'::jsonb;
  v_roots text[];
  v_root text;
  v_member record;
  v_member_row jsonb;
  v_component_rows jsonb;
  v_all_clean boolean;
  v_reason text;
  v_exists boolean;
begin
  -- `on commit drop` sólo limpia al COMMIT real de la transacción, no al
  -- retornar de esta función — si algún día se llama más de una vez dentro
  -- de la misma transacción (ej. una prueba, o un futuro refactor), un
  -- `drop ... if exists` previo la hace segura de todas formas.
  drop table if exists _fin_nodes;
  drop table if exists _fin_edges;
  create temporary table _fin_nodes (node_key text primary key, table_name text, legacy_id text, root text) on commit drop;
  create temporary table _fin_edges (a text, b text, exists_target boolean) on commit drop;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb)) loop
    v_key := 'payments:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'payments', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'paymentCharges', '[]'::jsonb)) loop
    v_key := 'payment_charges:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'payment_charges', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'paymentAllocations', '[]'::jsonb)) loop
    v_key := 'payment_allocations:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'payment_allocations', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'paymentAdjustments', '[]'::jsonb)) loop
    v_key := 'payment_adjustments:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'payment_adjustments', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'initialPaidSurchargeCorrections', '[]'::jsonb)) loop
    v_key := 'initial_paid_surcharge_corrections:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'initial_paid_surcharge_corrections', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'firstMonthProrationDecisions', '[]'::jsonb)) loop
    v_key := 'first_month_proration_decisions:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'first_month_proration_decisions', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'packagePurchases', '[]'::jsonb)) loop
    v_key := 'package_purchases:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'package_purchases', v_row->>'id', v_key) on conflict do nothing;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'packageCreditMovements', '[]'::jsonb)) loop
    v_key := 'package_credit_movements:' || (v_row->>'id');
    insert into _fin_nodes values (v_key, 'package_credit_movements', v_row->>'id', v_key) on conflict do nothing;
  end loop;

  -- Corrección real (encontrada probando el caso "referencia rota"): si el
  -- destino de una arista NO existe entre los nodos reales, se lo agrega
  -- como nodo FANTASMA (`table_name='MISSING'`) — nunca se filtra la unión
  -- por `exists_target`. Si se filtrara, una referencia rota partiría el
  -- grafo en dos componentes en vez de una sola, y el lado "sano" (ej. un
  -- cargo sin su pago, por una asignación con `chargeId` roto) se
  -- insertaría solo — mostrándose como "pendiente de pago" cuando en
  -- realidad tenía un pago real que se perdió por el dato roto. La unión
  -- SIEMPRE ocurre (real o fantasma); recién al evaluar cada componente se
  -- chequea si contiene un fantasma, y ahí se omite completa.
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'paymentAllocations', '[]'::jsonb)) loop
    v_key := 'payment_allocations:' || (v_row->>'id');
    insert into _fin_nodes values ('payments:' || (v_row->>'paymentId'), 'MISSING', v_row->>'paymentId', 'payments:' || (v_row->>'paymentId')) on conflict do nothing;
    insert into _fin_nodes values ('payment_charges:' || (v_row->>'chargeId'), 'MISSING', v_row->>'chargeId', 'payment_charges:' || (v_row->>'chargeId')) on conflict do nothing;
    insert into _fin_edges values (v_key, 'payments:' || (v_row->>'paymentId'), true);
    insert into _fin_edges values (v_key, 'payment_charges:' || (v_row->>'chargeId'), true);
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'paymentAdjustments', '[]'::jsonb)) loop
    v_key := 'payment_adjustments:' || (v_row->>'id');
    insert into _fin_nodes values ('payment_charges:' || (v_row->>'chargeId'), 'MISSING', v_row->>'chargeId', 'payment_charges:' || (v_row->>'chargeId')) on conflict do nothing;
    insert into _fin_edges values (v_key, 'payment_charges:' || (v_row->>'chargeId'), true);
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb)) loop
    if v_row->>'replacesPaymentId' is not null then
      v_key := 'payments:' || (v_row->>'id');
      insert into _fin_nodes values ('payments:' || (v_row->>'replacesPaymentId'), 'MISSING', v_row->>'replacesPaymentId', 'payments:' || (v_row->>'replacesPaymentId')) on conflict do nothing;
      insert into _fin_edges values (v_key, 'payments:' || (v_row->>'replacesPaymentId'), true);
    end if;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'initialPaidSurchargeCorrections', '[]'::jsonb)) loop
    v_key := 'initial_paid_surcharge_corrections:' || (v_row->>'id');
    if v_row->>'voidedPaymentId' is not null then
      insert into _fin_nodes values ('payments:' || (v_row->>'voidedPaymentId'), 'MISSING', v_row->>'voidedPaymentId', 'payments:' || (v_row->>'voidedPaymentId')) on conflict do nothing;
      insert into _fin_edges values (v_key, 'payments:' || (v_row->>'voidedPaymentId'), true);
    end if;
    if v_row->>'newPaymentId' is not null then
      insert into _fin_nodes values ('payments:' || (v_row->>'newPaymentId'), 'MISSING', v_row->>'newPaymentId', 'payments:' || (v_row->>'newPaymentId')) on conflict do nothing;
      insert into _fin_edges values (v_key, 'payments:' || (v_row->>'newPaymentId'), true);
    end if;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'firstMonthProrationDecisions', '[]'::jsonb)) loop
    if v_row->>'chargeId' is not null then
      v_key := 'first_month_proration_decisions:' || (v_row->>'id');
      insert into _fin_nodes values ('payment_charges:' || (v_row->>'chargeId'), 'MISSING', v_row->>'chargeId', 'payment_charges:' || (v_row->>'chargeId')) on conflict do nothing;
      insert into _fin_edges values (v_key, 'payment_charges:' || (v_row->>'chargeId'), true);
    end if;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'paymentCharges', '[]'::jsonb)) loop
    if v_row->>'packageId' is not null then
      v_key := 'payment_charges:' || (v_row->>'id');
      insert into _fin_nodes values ('package_purchases:' || (v_row->>'packageId'), 'MISSING', v_row->>'packageId', 'package_purchases:' || (v_row->>'packageId')) on conflict do nothing;
      insert into _fin_edges values (v_key, 'package_purchases:' || (v_row->>'packageId'), true);
    end if;
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'packageCreditMovements', '[]'::jsonb)) loop
    v_key := 'package_credit_movements:' || (v_row->>'id');
    insert into _fin_nodes values ('package_purchases:' || (v_row->>'packageId'), 'MISSING', v_row->>'packageId', 'package_purchases:' || (v_row->>'packageId')) on conflict do nothing;
    insert into _fin_edges values (v_key, 'package_purchases:' || (v_row->>'packageId'), true);
  end loop;

  loop
    v_changed := false;
    for v_edge in select a, b from _fin_edges loop
      select root into v_root_a from _fin_nodes where node_key = v_edge.a;
      select root into v_root_b from _fin_nodes where node_key = v_edge.b;
      if v_root_a is distinct from v_root_b then
        v_min := least(v_root_a, v_root_b);
        update _fin_nodes set root = v_min where root in (v_root_a, v_root_b);
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  select array_agg(distinct root) into v_roots from _fin_nodes;

  foreach v_root in array coalesce(v_roots, array[]::text[])
  loop
    v_all_clean := true;
    v_reason := null;
    v_component_rows := '[]'::jsonb;

    for v_member in select * from _fin_nodes where root = v_root
    loop
      -- Nodo fantasma (referencia declarada que no existe ni en el backup
      -- ni en la web): la componente entera queda omitida — nunca se deja
      -- que el resto de la componente (ej. un cargo sin su pago) se
      -- inserte solo, mostrando un estado financiero incompleto/engañoso.
      if v_member.table_name = 'MISSING' then
        v_all_clean := false;
        v_reason := coalesce(v_reason, format('referencia a %s no existe ni en el backup ni en la web', v_member.legacy_id));
        continue;
      end if;

      v_component_rows := v_component_rows || jsonb_build_object('table_name', v_member.table_name, 'legacy_mobile_id', v_member.legacy_id);

      v_exists := false;
      case v_member.table_name
        when 'payments' then select exists(select 1 from public.payments t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'payment_charges' then select exists(select 1 from public.payment_charges t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'payment_allocations' then select exists(select 1 from public.payment_allocations t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'payment_adjustments' then select exists(select 1 from public.payment_adjustments t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'initial_paid_surcharge_corrections' then select exists(select 1 from public.initial_paid_surcharge_corrections t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'first_month_proration_decisions' then select exists(select 1 from public.first_month_proration_decisions t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'package_purchases' then select exists(select 1 from public.package_purchases t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        when 'package_credit_movements' then select exists(select 1 from public.package_credit_movements t where t.owner_id = p_owner and t.legacy_mobile_id = v_member.legacy_id) into v_exists;
        else v_exists := false;
      end case;
      if v_exists then
        v_all_clean := false;
        v_reason := coalesce(v_reason, format('%s con legacy_mobile_id %s ya existe en la web', v_member.table_name, v_member.legacy_id));
      end if;
    end loop;

    if v_all_clean then
      for v_member in select * from _fin_nodes where root = v_root
      loop
        v_member_row := null;
        case v_member.table_name
          when 'payment_charges' then select r.v into v_member_row from jsonb_array_elements(p_payload->'paymentCharges') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'payments' then select r.v into v_member_row from jsonb_array_elements(p_payload->'payments') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'payment_allocations' then select r.v into v_member_row from jsonb_array_elements(p_payload->'paymentAllocations') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'payment_adjustments' then select r.v into v_member_row from jsonb_array_elements(p_payload->'paymentAdjustments') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'package_purchases' then select r.v into v_member_row from jsonb_array_elements(p_payload->'packagePurchases') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'package_credit_movements' then select r.v into v_member_row from jsonb_array_elements(p_payload->'packageCreditMovements') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'initial_paid_surcharge_corrections' then select r.v into v_member_row from jsonb_array_elements(p_payload->'initialPaidSurchargeCorrections') r(v) where r.v->>'id' = v_member.legacy_id;
          when 'first_month_proration_decisions' then select r.v into v_member_row from jsonb_array_elements(p_payload->'firstMonthProrationDecisions') r(v) where r.v->>'id' = v_member.legacy_id;
        end case;

        if v_member_row is null then continue; end if;

        if v_member_row ? 'studentId' and not public._external_ref_available('students', p_owner, v_member_row->>'studentId', p_students_classified) then
          v_all_clean := false; v_reason := coalesce(v_reason, 'referencia a alumno inexistente');
        end if;
        if v_member.table_name = 'payment_charges' then
          if v_member_row->>'trainingBillingAgreementId' is not null and not public._external_ref_available('training_billing_agreements', p_owner, v_member_row->>'trainingBillingAgreementId', p_training_agreements_classified) then
            v_all_clean := false; v_reason := coalesce(v_reason, 'referencia a acuerdo de entrenamiento inexistente');
          end if;
          if v_member_row->>'savedLessonId' is not null and not public._external_ref_available('lesson_registrations', p_owner, v_member_row->>'savedLessonId', p_lesson_registrations_classified) then
            v_all_clean := false; v_reason := coalesce(v_reason, 'referencia a registro de clase inexistente');
          end if;
          if v_member_row->>'calendarLessonId' is not null and not public._external_ref_available('calendar_lessons', p_owner, v_member_row->>'calendarLessonId', p_calendar_lessons_classified) then
            v_all_clean := false; v_reason := coalesce(v_reason, 'referencia a clase de calendario inexistente');
          end if;
        end if;
      end loop;
    end if;

    v_components := v_components || jsonb_build_object(
      'component_id', v_root, 'members', v_component_rows,
      'status', case when v_all_clean then 'insertable' else 'omitted' end,
      'reason', v_reason
    );
  end loop;

  return v_components;
end;
$$;

-- =============================================================================
-- SECCIÓN 5 — Cierre de dependencias para undo. NUNCA se confía en
-- ON DELETE CASCADE/RESTRICT para "limpiar" — cada dependencia entrante
-- real (registradas en `import_undo_dependency_registry`, sección 1) se
-- verifica explícitamente: una fila insertada por ESTE import sólo puede
-- borrarse si NINGUNA fila la referencia hoy, salvo que esa fila
-- referenciante también pertenezca a este mismo `import_run` y no haya
-- cambiado desde que la importación la escribió.
-- =============================================================================

/** true = esta fila hija BLOQUEA el undo (no pertenece al run, o pertenece pero cambió después). */
create or replace function public._blocks_undo_via_child(p_child_table text, p_child_row_id uuid, p_import_run_id uuid, p_owner uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_snap record;
  v_current text;
begin
  select * into v_snap from public.import_run_row_snapshots s
    where s.import_run_id = p_import_run_id and s.table_name = p_child_table and s.row_id = p_child_row_id and s.action = 'inserted';
  if not found then return true; end if; -- fila ajena a este import -> bloquea siempre

  v_current := public._fingerprint_row(p_child_table, p_child_row_id, p_owner);
  if v_current is null then return true; end if; -- ya no existe (raro, defensivo) -> bloquea
  return v_current is distinct from public._fingerprint_canonical(p_child_table, v_snap.new_row);
end;
$$;

create or replace function public._collect_blockers(p_child_table text, p_row_ids uuid[], p_import_run_id uuid, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  foreach v_id in array coalesce(p_row_ids, array[]::uuid[])
  loop
    if public._blocks_undo_via_child(p_child_table, v_id, p_import_run_id, p_owner) then
      v_out := v_out || jsonb_build_object('table_name', p_child_table, 'row_id', v_id);
    end if;
  end loop;
  return v_out;
end;
$$;

/**
 * Bloqueadores reales para deshacer la inserción de `p_parent_id` en
 * `p_parent_table` — recorre EXACTAMENTE las dependencias registradas en
 * `import_undo_dependency_registry` para esa tabla (ver sección 1; la
 * prueba `backup_import_dependency_registry_audit.sql` audita que esta
 * lista siga completa contra `pg_constraint` real).
 */
create or replace function public._external_dependency_blockers(p_parent_table text, p_parent_id uuid, p_import_run_id uuid, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_blockers jsonb := '[]'::jsonb;
begin
  case p_parent_table
    when 'students' then
      v_blockers := v_blockers || public._collect_blockers('student_status_history', array(select id from public.student_status_history where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('student_level_history', array(select id from public.student_level_history where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('student_price_history', array(select id from public.student_price_history where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('recurrence_rule_participants', array(select id from public.recurrence_rule_participants where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('calendar_lessons', array(select id from public.calendar_lessons where primary_student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('calendar_lesson_participants', array(select id from public.calendar_lesson_participants where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_students', array(select id from public.lesson_registration_students where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_attendance', array(select id from public.lesson_registration_attendance where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_evaluations', array(select id from public.lesson_registration_evaluations where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_homework_reviews', array(select id from public.lesson_registration_homework_reviews where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_charges', array(select id from public.payment_charges where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payments', array(select id from public.payments where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_allocations', array(select id from public.payment_allocations where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_adjustments', array(select id from public.payment_adjustments where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('package_purchases', array(select id from public.package_purchases where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('package_credit_movements', array(select id from public.package_credit_movements where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('monthly_amount_corrections', array(select id from public.monthly_amount_corrections where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('initial_paid_surcharge_corrections', array(select id from public.initial_paid_surcharge_corrections where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('first_month_proration_decisions', array(select id from public.first_month_proration_decisions where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('report_records', array(select id from public.report_records where student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('recurrence_rules', array(select id from public.recurrence_rules where primary_student_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('student_creation_claims', array(select id from public.student_creation_claims where student_id = p_parent_id), p_import_run_id, p_owner);
      -- report_draft_claims: sin `id` propio (PK compuesta owner_id+student_id,
      -- Fase 7) — no encaja en `_collect_blockers`. Su sola EXISTENCIA ya
      -- significa "hay un reporte en curso para este alumno ahora mismo" —
      -- bloquea directo, sin necesitar comparar huellas (no tiene un
      -- "contenido" editable que comparar, es un claim binario).
      if exists(select 1 from public.report_draft_claims where student_id = p_parent_id) then
        v_blockers := v_blockers || jsonb_build_object('table_name', 'report_draft_claims', 'row_id', null, 'reason', 'hay un reporte en curso para este alumno');
      end if;

    when 'training_billing_agreements' then
      v_blockers := v_blockers || public._collect_blockers('recurrence_rules', array(select id from public.recurrence_rules where training_billing_agreement_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_charges', array(select id from public.payment_charges where training_billing_agreement_id = p_parent_id), p_import_run_id, p_owner);

    when 'recurrence_rules' then
      v_blockers := v_blockers || public._collect_blockers('recurrence_rule_participants', array(select id from public.recurrence_rule_participants where recurrence_rule_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('recurrence_exceptions', array(select id from public.recurrence_exceptions where recurrence_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('calendar_lessons', array(select id from public.calendar_lessons where recurrence_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('recurrence_rules', array(select id from public.recurrence_rules where supersedes_recurrence_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('recurrence_rules', array(select id from public.recurrence_rules where superseded_by_recurrence_id = p_parent_id), p_import_run_id, p_owner);

    when 'calendar_lessons' then
      v_blockers := v_blockers || public._collect_blockers('calendar_lesson_participants', array(select id from public.calendar_lesson_participants where calendar_lesson_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('recurrence_exceptions', array(select id from public.recurrence_exceptions where replacement_lesson_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registrations', array(select id from public.lesson_registrations where calendar_lesson_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_charges', array(select id from public.payment_charges where calendar_lesson_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('calendar_lessons', array(select id from public.calendar_lessons where freed_by_lesson_id = p_parent_id), p_import_run_id, p_owner);

    when 'lesson_registrations' then
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_students', array(select id from public.lesson_registration_students where lesson_registration_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_attendance', array(select id from public.lesson_registration_attendance where lesson_registration_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_evaluations', array(select id from public.lesson_registration_evaluations where lesson_registration_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registration_homework_reviews', array(select id from public.lesson_registration_homework_reviews where lesson_registration_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_charges', array(select id from public.payment_charges where saved_lesson_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('package_credit_movements', array(select id from public.package_credit_movements where saved_lesson_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('lesson_registrations', array(select id from public.lesson_registrations where rescheduled_from_registration_id = p_parent_id), p_import_run_id, p_owner);
      -- lesson_registration_edit_history: fuera de v1, nunca la crea esta
      -- importación, así que nunca puede bloquear un undo real de Fase 9 —
      -- pero SÍ debe seguir en el registro (sección 1) para que la
      -- auditoría contra pg_constraint no quede desactualizada si algún día
      -- se habilita.

    when 'package_purchases' then
      v_blockers := v_blockers || public._collect_blockers('package_credit_movements', array(select id from public.package_credit_movements where package_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_charges', array(select id from public.payment_charges where package_id = p_parent_id), p_import_run_id, p_owner);

    when 'payment_charges' then
      v_blockers := v_blockers || public._collect_blockers('payment_allocations', array(select id from public.payment_allocations where charge_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payment_adjustments', array(select id from public.payment_adjustments where charge_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('first_month_proration_decisions', array(select id from public.first_month_proration_decisions where charge_id = p_parent_id), p_import_run_id, p_owner);

    when 'payments' then
      v_blockers := v_blockers || public._collect_blockers('payment_allocations', array(select id from public.payment_allocations where payment_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('payments', array(select id from public.payments where replaces_payment_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('initial_paid_surcharge_corrections', array(select id from public.initial_paid_surcharge_corrections where voided_payment_id = p_parent_id), p_import_run_id, p_owner);
      v_blockers := v_blockers || public._collect_blockers('initial_paid_surcharge_corrections', array(select id from public.initial_paid_surcharge_corrections where new_payment_id = p_parent_id), p_import_run_id, p_owner);

    -- Tablas sin hijos reales registrados (payment_allocations,
    -- payment_adjustments, monthly_amount_corrections,
    -- initial_paid_surcharge_corrections, first_month_proration_decisions,
    -- report_records, custom_levels, recurrence_rule_participants,
    -- calendar_lesson_participants, lesson_registration_*,
    -- package_credit_movements, recurrence_exceptions): sin filas en el
    -- registro -> sin bloqueadores posibles, `else` devuelve vacío.
    else
      null;
  end case;

  return v_blockers;
end;
$$;

-- =============================================================================
-- SECCIÓN 6 — preview_backup_import: SÓLO LECTURA sobre datos de negocio,
-- persiste únicamente en las tablas técnicas de preview.
-- =============================================================================

create or replace function public.preview_backup_import(p_payload jsonb, p_excluded_collections jsonb)
returns table (preview_id uuid, expires_at timestamptz, summary jsonb, classification jsonb, excluded_collections jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_size_bytes int;
  v_students jsonb; v_custom_levels jsonb;
  v_teacher_profile jsonb; v_budget jsonb; v_availability jsonb;
  v_training_agreements jsonb; v_level_history jsonb; v_surcharge jsonb;
  v_recurrence jsonb; v_calendar jsonb; v_lesson_registrations jsonb;
  v_financial jsonb;
  v_classification jsonb;
  v_preview_id uuid;
  v_checksum text;
  v_row jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  v_size_bytes := pg_column_size(p_payload);
  if v_size_bytes > 20 * 1024 * 1024 then
    raise exception 'El backup supera el tamaño máximo permitido.';
  end if;

  -- Limpieza perezosa de previews propios PENDIENTES vencidos (>24h) —
  -- nunca de otra cuenta. Nunca de un preview 'applied': `import_runs.preview_id`
  -- lo referencia sin cascada a propósito (retención real del run, ver
  -- sección 7 del diseño) — intentar borrarlo violaría esa FK.
  delete from public.import_previews as ip
    where ip.owner_id = v_owner and ip.status = 'pending' and ip.expires_at < now() - interval '24 hours';

  v_students := public._classify_students(v_owner, p_payload);
  v_custom_levels := public._classify_custom_levels(v_owner, p_payload);
  v_teacher_profile := public._classify_singleton('teacher_profiles', v_owner, p_payload->'teacherProfile');
  v_budget := public._classify_singleton('budget_distribution_settings', v_owner, p_payload->'budgetDistribution');
  v_availability := public._classify_singleton('teacher_availability', v_owner, p_payload->'teacherAvailability');
  v_training_agreements := public._classify_insert_only('training_billing_agreements', v_owner, p_payload->'trainingBillingAgreements');
  v_level_history := public._classify_insert_only('student_level_history', v_owner, (
    select coalesce(jsonb_agg(jsonb_build_object('id', entry->>'id', 'studentId', key)), '[]'::jsonb)
      from jsonb_each(coalesce(p_payload->'profiles', '{}'::jsonb)) as p(key, profile)
      cross join lateral jsonb_array_elements(coalesce(profile->'levelHistory', '[]'::jsonb)) as entry
      where entry->>'id' is not null
  ));
  v_surcharge := public._classify_singleton('surcharge_settings', v_owner, p_payload->'surchargeSettings'->'current');

  v_recurrence := public._classify_recurrence_rules(v_owner, p_payload, v_students);
  v_calendar := public._classify_calendar_lessons(v_owner, p_payload, v_students);
  v_lesson_registrations := public._classify_lesson_registrations(v_owner, p_payload, v_students);

  -- package_purchases/package_credit_movements no tienen clasificador
  -- propio: siempre viajan dentro del grafo financiero (ver comentario en
  -- la sección 4, justo antes de `_external_ref_available`).
  v_financial := public._classify_financial_components(v_owner, p_payload, v_students, v_training_agreements, v_calendar, v_lesson_registrations);

  v_classification := jsonb_build_object(
    'maestros', jsonb_build_object(
      'students', v_students,
      'custom_levels', v_custom_levels,
      'teacher_profiles', v_teacher_profile,
      'budget_distribution_settings', v_budget,
      'teacher_availability', v_availability
    ),
    'insert_only', jsonb_build_object(
      'training_billing_agreements', v_training_agreements,
      'student_level_history', v_level_history,
      'surcharge_settings', v_surcharge
    ),
    'aggregates', jsonb_build_object(
      'recurrence_rules', v_recurrence,
      'calendar_lessons', v_calendar,
      'lesson_registrations', v_lesson_registrations,
      'financial_components', v_financial
    )
  );

  v_checksum := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.import_previews (owner_id, backup_checksum, schema_version, app_version, normalized_payload, classification, excluded_collections)
    values (v_owner, v_checksum, coalesce((p_payload->>'schemaVersion')::int, 2), p_payload->>'appVersion', p_payload, v_classification, coalesce(p_excluded_collections, '{}'::jsonb))
    returning id into v_preview_id;

  -- Huellas de todas las filas YA EXISTENTES matched (maestros con
  -- override real: students/custom_levels/singletons) — nunca de las
  -- filas "alta" (nada que proteger todavía) ni de las insert-only (sin
  -- override posible, no hace falta protegerlas fila por fila).
  for v_row in select * from jsonb_array_elements(coalesce(v_students->'equal', '[]'::jsonb) || coalesce(v_students->'conflicts', '[]'::jsonb))
  loop
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'students', (v_row->>'row_id')::uuid, public._fingerprint_row('students', (v_row->>'row_id')::uuid, v_owner));
  end loop;
  for v_row in select * from jsonb_array_elements(coalesce(v_custom_levels->'equal', '[]'::jsonb) || coalesce(v_custom_levels->'conflicts', '[]'::jsonb))
  loop
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'custom_levels', (v_row->>'row_id')::uuid, public._fingerprint_row('custom_levels', (v_row->>'row_id')::uuid, v_owner));
  end loop;
  if v_teacher_profile ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_profiles', v_owner, public._fingerprint_row('teacher_profiles', v_owner, v_owner));
  end if;
  if v_budget ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'budget_distribution_settings', v_owner, public._fingerprint_row('budget_distribution_settings', v_owner, v_owner));
  end if;
  if v_availability ? 'row_id' then
    insert into public.import_preview_row_fingerprints (preview_id, table_name, row_id, fingerprint)
      values (v_preview_id, 'teacher_availability', v_owner, public._fingerprint_row('teacher_availability', v_owner, v_owner));
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(v_students->'duplicates', '[]'::jsonb))
  loop
    insert into public.import_preview_duplicate_candidates (preview_id, backup_legacy_mobile_id, candidate_student_id, match_signals, candidate_fingerprint, field_diff)
      values (
        v_preview_id, v_row->>'backup_legacy_mobile_id', (v_row->>'candidate_student_id')::uuid,
        array(select jsonb_array_elements_text(v_row->'match_signals')),
        v_row->>'candidate_fingerprint', v_row->'field_diff'
      );
  end loop;

  return query
    select v_preview_id, ip.expires_at,
      jsonb_build_object(
        'students', jsonb_build_object(
          'inserts', jsonb_array_length(v_students->'inserts'), 'equal', jsonb_array_length(v_students->'equal'),
          'conflicts', jsonb_array_length(v_students->'conflicts'), 'possible_duplicates', jsonb_array_length(v_students->'duplicates')
        )
      ),
      v_classification, coalesce(p_excluded_collections, '{}'::jsonb)
    from public.import_previews ip where ip.id = v_preview_id;
end;
$$;

revoke all on function public.preview_backup_import(jsonb, jsonb) from public;
revoke all on function public.preview_backup_import(jsonb, jsonb) from anon;
grant execute on function public.preview_backup_import(jsonb, jsonb) to authenticated;

-- =============================================================================
-- SECCIÓN 7 — apply_backup_import. Única función que escribe datos de
-- negocio en todo Fase 9. Una llamada = una transacción real.
-- =============================================================================

/** Allowlist ESTÁTICA de columnas overridable — nunca `id`/`owner_id`/`legacy_mobile_id`/timestamps/FKs/operation_id. */
create or replace function public._field_override_allowlist(p_table_name text)
returns text[] language sql immutable as $$
  select case p_table_name
    when 'students' then array['name','phone','whatsapp','email','notes','birth_date','current_goals','strengths','areas_to_improve','alerts','usual_days','usual_time']
    when 'custom_levels' then array['name']
    when 'teacher_profiles' then array['display_name']
    when 'budget_distribution_settings' then array['needs_percent','wants_percent','savings_percent','savings_goal_enabled','savings_goal_target_amount','savings_goal_target_date']
    when 'teacher_availability' then array['timezone','weekly_blocks','exceptions']
    else array[]::text[]
  end;
$$;

/**
 * Valida CADA entrada de `p_field_overrides` contra el preview persistido:
 * tabla en la allowlist de tablas field-overridable, fila realmente
 * clasificada como conflicto (o duplicado ya vinculado) EN ESTE preview,
 * campo realmente listado como distinto para esa fila, y campo dentro de
 * la allowlist estática de esa tabla. Cualquier entrada inválida aborta
 * TODO — nunca aplica parcialmente los overrides válidos descartando los
 * inválidos.
 */
create or replace function public._validate_field_overrides(p_preview_id uuid, p_classification jsonb, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entry record;
  v_field text;
  v_row_fields jsonb;
  v_allowed text[];
  v_is_linked_duplicate boolean;
begin
  for v_entry in select * from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as x(table_name text, row_id uuid, fields text[])
  loop
    if v_entry.table_name not in ('students','custom_levels','teacher_profiles','budget_distribution_settings','teacher_availability') then
      raise exception 'Tabla % no admite overrides de campo.', v_entry.table_name;
    end if;

    v_allowed := public._field_override_allowlist(v_entry.table_name);
    v_row_fields := null;

    if v_entry.table_name = 'students' then
      select c->'fields' into v_row_fields from jsonb_array_elements(p_classification->'maestros'->'students'->'conflicts') c where (c->>'row_id')::uuid = v_entry.row_id;

      if v_row_fields is null then
        -- ¿Es un duplicado que ESTA MISMA llamada decide vincular? El diff
        -- ya lo precalculó el preview (`import_preview_duplicate_candidates`).
        select exists(
          select 1 from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as d(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
          where d.decision = 'link' and d.candidate_student_id = v_entry.row_id
        ) into v_is_linked_duplicate;

        if v_is_linked_duplicate then
          select dc.field_diff into v_row_fields from public.import_preview_duplicate_candidates dc
            where dc.preview_id = p_preview_id and dc.candidate_student_id = v_entry.row_id;
        end if;
      end if;
    elsif v_entry.table_name = 'custom_levels' then
      select c->'fields' into v_row_fields from jsonb_array_elements(p_classification->'maestros'->'custom_levels'->'conflicts') c where (c->>'row_id')::uuid = v_entry.row_id;
    else
      -- Singletons: si el preview marcó 'conflict', cualquier campo de su
      -- propia allowlist es elegible (no se guarda un diff estructurado
      -- separado para estas 3 tablas, son pocos campos).
      if (p_classification->'maestros'->v_entry.table_name->>'status') = 'conflict' then
        select jsonb_object_agg(k, true) into v_row_fields from unnest(v_allowed) as k;
      end if;
    end if;

    if v_row_fields is null then
      raise exception 'La fila % de % no está clasificada como conflicto en este preview.', v_entry.row_id, v_entry.table_name;
    end if;

    foreach v_field in array coalesce(v_entry.fields, array[]::text[])
    loop
      if not (v_field = any(v_allowed)) then
        raise exception 'Campo % no es overridable en %.', v_field, v_entry.table_name;
      end if;
      if not (v_row_fields ? v_field) then
        raise exception 'Campo % no fue detectado como distinto para la fila % en el preview.', v_field, v_entry.row_id;
      end if;
    end loop;
  end loop;
end;
$$;

/** Valida `p_duplicate_decisions` contra los candidatos REALES persistidos por este preview — nunca acepta un `candidate_student_id` distinto del que el preview ya analizó. */
create or replace function public._validate_duplicate_decisions(p_preview_id uuid, p_duplicate_decisions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entry record;
  v_real uuid;
begin
  for v_entry in select * from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
  loop
    if v_entry.decision not in ('link', 'create_separate', 'skip') then
      raise exception 'Decisión de duplicado inválida: %.', v_entry.decision;
    end if;

    select dc.candidate_student_id into v_real from public.import_preview_duplicate_candidates dc
      where dc.preview_id = p_preview_id and dc.backup_legacy_mobile_id = v_entry.backup_legacy_mobile_id;
    if v_real is null then
      raise exception 'No hay ningún candidato de duplicado % en este preview.', v_entry.backup_legacy_mobile_id;
    end if;
    if v_entry.decision = 'link' and v_entry.candidate_student_id is distinct from v_real then
      raise exception 'candidate_student_id no coincide con el candidato real analizado por el preview.';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Escritores por dominio. Cada uno: re-verifica que el candidato siga sin
-- existir (defensa final antes de escribir), inserta, snapshotea. Ninguno
-- contiene un DELETE.
-- ---------------------------------------------------------------------------

create or replace function public._apply_students(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ins record;
  v_row jsonb;
  v_new_id uuid;
  v_ov record;
  v_before jsonb;
  v_after jsonb;
  v_field text;
  v_dec record;
begin
  -- Altas (re-verificadas: ni por legacy_mobile_id ni por la heurística de duplicado)
  for v_ins in select * from jsonb_to_recordset(p_classification->'maestros'->'students'->'inserts') as x(legacy_mobile_id text)
  loop
    select r into v_row from jsonb_array_elements(p_payload->'students') t(r) where r->>'id' = v_ins.legacy_mobile_id;
    if exists(select 1 from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El alumno % ya existe — el preview quedó desactualizado.', v_ins.legacy_mobile_id;
    end if;
    if exists(
      select 1 from public.students s where s.owner_id = p_owner and s.legacy_mobile_id is null
        and (
          (btrim(s.name) <> '' and lower(btrim(s.name)) = lower(btrim(v_row->>'name')))
          or (s.email is not null and v_row->>'email' is not null and public._normalize_email(s.email) = public._normalize_email(v_row->>'email') and public._normalize_email(s.email) <> '')
          or (s.phone is not null and v_row->>'phone' is not null and public._normalize_phone(s.phone) = public._normalize_phone(v_row->>'phone') and public._normalize_phone(s.phone) <> '')
        )
    ) then
      raise exception 'Apareció una coincidencia heurística nueva para % desde que se generó el preview — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;

    insert into public.students (
      owner_id, legacy_mobile_id, name, phone, whatsapp, email, usual_days, usual_time, notes, birth_date,
      levels, initial_level, modality, status, category, billing_type, billing_plan, date_joined,
      last_reactivated_at, status_change_date, usual_duration_minutes, weekly_frequency, price,
      pending_homework, alerts, current_goals, strengths, areas_to_improve, is_featured, is_new
    ) values (
      p_owner, v_row->>'id', v_row->>'name', v_row->>'phone', v_row->>'whatsapp', v_row->>'email',
      array(select jsonb_array_elements_text(coalesce(v_row->'usualDays', '[]'::jsonb))), v_row->>'usualTime', v_row->>'notes', (v_row->>'birthDate')::date,
      array(select jsonb_array_elements_text(coalesce(v_row->'levels', '[]'::jsonb))), coalesce(v_row->>'initialLevel', ''), v_row->>'modality', v_row->>'status', v_row->>'category', v_row->>'billingType',
      v_row->'billingPlan', (v_row->>'dateJoined')::date,
      (v_row->>'lastReactivatedAt')::date, (v_row->>'statusChangeDate')::date, coalesce((v_row->>'usualDurationMinutes')::int, 60), coalesce((v_row->>'weeklyFrequency')::int, 1), coalesce((v_row->>'price')::numeric, 0),
      v_row->>'pendingHomework', array(select jsonb_array_elements_text(coalesce(v_row->'alerts', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_row->'currentGoals', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(v_row->'strengths', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_row->'areasToImprove', '[]'::jsonb))), coalesce((v_row->>'isFeatured')::boolean, false), coalesce((v_row->>'isNew')::boolean, true)
    ) returning id into v_new_id;

    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_new_id, 'inserted', null, (select to_jsonb(s) from public.students s where s.id = v_new_id));
  end loop;

  -- Vínculos de identidad (duplicados "link"): asigna legacy_mobile_id,
  -- NUNCA otro campo salvo que además venga en p_field_overrides.
  for v_dec in select * from jsonb_to_recordset(coalesce(p_duplicate_decisions, '[]'::jsonb)) as x(backup_legacy_mobile_id text, decision text, candidate_student_id uuid)
    where decision = 'link'
  loop
    select to_jsonb(s) into v_before from public.students s where s.id = v_dec.candidate_student_id and s.owner_id = p_owner;
    update public.students set legacy_mobile_id = v_dec.backup_legacy_mobile_id where id = v_dec.candidate_student_id and owner_id = p_owner;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_dec.candidate_student_id, 'identity_linked', v_before, (select to_jsonb(s) from public.students s where s.id = v_dec.candidate_student_id));
  end loop;

  -- Overrides de campo (ya validados por `_validate_field_overrides`).
  for v_ov in select * from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as x(table_name text, row_id uuid, fields text[])
    where table_name = 'students'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'students') t(r)
      where r->>'id' = coalesce(
        (select dc.backup_legacy_mobile_id from public.import_preview_duplicate_candidates dc where dc.candidate_student_id = v_ov.row_id limit 1),
        (select s.legacy_mobile_id from public.students s where s.id = v_ov.row_id)
      );
    select to_jsonb(s) into v_before from public.students s where s.id = v_ov.row_id and s.owner_id = p_owner;

    foreach v_field in array v_ov.fields
    loop
      case v_field
        when 'name' then update public.students set name = btrim(coalesce(v_row->>'name','')) where id = v_ov.row_id;
        when 'phone' then update public.students set phone = v_row->>'phone' where id = v_ov.row_id;
        when 'whatsapp' then update public.students set whatsapp = v_row->>'whatsapp' where id = v_ov.row_id;
        when 'email' then update public.students set email = v_row->>'email' where id = v_ov.row_id;
        when 'notes' then update public.students set notes = v_row->>'notes' where id = v_ov.row_id;
        when 'birth_date' then update public.students set birth_date = (v_row->>'birthDate')::date where id = v_ov.row_id;
        when 'current_goals' then update public.students set current_goals = array(select jsonb_array_elements_text(coalesce(v_row->'currentGoals','[]'::jsonb))) where id = v_ov.row_id;
        when 'strengths' then update public.students set strengths = array(select jsonb_array_elements_text(coalesce(v_row->'strengths','[]'::jsonb))) where id = v_ov.row_id;
        when 'areas_to_improve' then update public.students set areas_to_improve = array(select jsonb_array_elements_text(coalesce(v_row->'areasToImprove','[]'::jsonb))) where id = v_ov.row_id;
        when 'alerts' then update public.students set alerts = array(select jsonb_array_elements_text(coalesce(v_row->'alerts','[]'::jsonb))) where id = v_ov.row_id;
        when 'usual_days' then update public.students set usual_days = array(select jsonb_array_elements_text(coalesce(v_row->'usualDays','[]'::jsonb))) where id = v_ov.row_id;
        when 'usual_time' then update public.students set usual_time = v_row->>'usualTime' where id = v_ov.row_id;
        else raise exception 'Campo % inesperado en override de students.', v_field;
      end case;
    end loop;

    select to_jsonb(s) into v_after from public.students s where s.id = v_ov.row_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'students', v_ov.row_id, 'field_overwritten', v_before, v_after);
  end loop;
end;
$$;

create or replace function public._apply_custom_levels(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb, p_field_overrides jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ins record;
  v_row jsonb;
  v_new_id uuid;
  v_ov record;
  v_before jsonb;
begin
  for v_ins in select * from jsonb_to_recordset(p_classification->'maestros'->'custom_levels'->'inserts') as x(legacy_mobile_id text)
  loop
    select r into v_row from jsonb_array_elements(p_payload->'customLevels') t(r) where r->>'id' = v_ins.legacy_mobile_id;
    if exists(select 1 from public.custom_levels c where c.owner_id = p_owner and c.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El nivel % ya existe — el preview quedó desactualizado.', v_ins.legacy_mobile_id;
    end if;
    insert into public.custom_levels (owner_id, legacy_mobile_id, name, created_at)
      values (p_owner, v_row->>'id', btrim(coalesce(v_row->>'name','')), coalesce((v_row->>'createdAt')::timestamptz, now()))
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'custom_levels', v_new_id, 'inserted', null, (select to_jsonb(c) from public.custom_levels c where c.id = v_new_id));
  end loop;

  for v_ov in select * from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as x(table_name text, row_id uuid, fields text[])
    where table_name = 'custom_levels'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'customLevels') t(r) where r->>'id' = (select cl.legacy_mobile_id from public.custom_levels cl where cl.id = v_ov.row_id);
    select to_jsonb(c) into v_before from public.custom_levels c where c.id = v_ov.row_id and c.owner_id = p_owner;
    update public.custom_levels set name = btrim(coalesce(v_row->>'name','')) where id = v_ov.row_id and 'name' = any(v_ov.fields);
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'custom_levels', v_ov.row_id, 'field_overwritten', v_before, (select to_jsonb(c) from public.custom_levels c where c.id = v_ov.row_id));
  end loop;
end;
$$;

/** Los 3 singletons field-overridable: insert si no existe; si existe y hay overrides autorizados, aplica sólo esos campos; si no hay overrides, preserva la web (comportamiento por defecto de un conflicto). */
create or replace function public._apply_singleton(p_run_id uuid, p_owner uuid, p_table_name text, p_backup_doc jsonb, p_classification_entry jsonb, p_field_overrides jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_fields text[];
  v_field text;
  v_exists boolean;
begin
  if not (p_classification_entry ? 'present_in_backup') or not (p_classification_entry->>'present_in_backup')::boolean then
    return; -- el backup no traía esta colección, nada que hacer
  end if;

  case p_table_name
    when 'teacher_profiles' then select exists(select 1 from public.teacher_profiles t where t.owner_id = p_owner) into v_exists;
    when 'budget_distribution_settings' then select exists(select 1 from public.budget_distribution_settings t where t.owner_id = p_owner) into v_exists;
    when 'teacher_availability' then select exists(select 1 from public.teacher_availability t where t.owner_id = p_owner) into v_exists;
  end case;

  if not v_exists then
    case p_table_name
      when 'teacher_profiles' then
        insert into public.teacher_profiles (owner_id, display_name) values (p_owner, btrim(coalesce(p_backup_doc->>'displayName','')));
      when 'budget_distribution_settings' then
        insert into public.budget_distribution_settings (owner_id, needs_percent, wants_percent, savings_percent, savings_goal_enabled, savings_goal_target_amount, savings_goal_target_date)
          values (p_owner, (p_backup_doc->'distribution'->>'needs')::smallint, (p_backup_doc->'distribution'->>'wants')::smallint, (p_backup_doc->'distribution'->>'savings')::smallint,
                  coalesce((p_backup_doc->'savingsGoal'->>'enabled')::boolean, false), (p_backup_doc->'savingsGoal'->>'targetAmount')::numeric, (p_backup_doc->'savingsGoal'->>'targetDate')::date);
      when 'teacher_availability' then
        insert into public.teacher_availability (owner_id, timezone, weekly_blocks, exceptions)
          values (p_owner, coalesce(p_backup_doc->>'timezone', 'America/Argentina/Buenos_Aires'), coalesce(p_backup_doc->'weeklyBlocks', '[]'::jsonb), coalesce(p_backup_doc->'exceptions', '[]'::jsonb));
    end case;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, p_table_name, p_owner, 'inserted', null, public._singleton_row_json(p_table_name, p_owner));
    return;
  end if;

  -- Ya existe: sólo se toca si hay overrides autorizados para esta tabla.
  select array_agg(distinct x.field) into v_fields
    from jsonb_to_recordset(coalesce(p_field_overrides, '[]'::jsonb)) as e(table_name text, row_id uuid, fields text[])
    cross join lateral unnest(e.fields) as x(field)
    where e.table_name = p_table_name and e.row_id = p_owner;

  if v_fields is null then return; end if; -- sin override -> se conserva la web, sin tocar nada

  v_before := public._singleton_row_json(p_table_name, p_owner);
  foreach v_field in array v_fields
  loop
    case p_table_name || ':' || v_field
      when 'teacher_profiles:display_name' then update public.teacher_profiles set display_name = btrim(coalesce(p_backup_doc->>'displayName','')) where owner_id = p_owner;
      when 'budget_distribution_settings:needs_percent' then update public.budget_distribution_settings set needs_percent = (p_backup_doc->'distribution'->>'needs')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:wants_percent' then update public.budget_distribution_settings set wants_percent = (p_backup_doc->'distribution'->>'wants')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:savings_percent' then update public.budget_distribution_settings set savings_percent = (p_backup_doc->'distribution'->>'savings')::smallint where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_enabled' then update public.budget_distribution_settings set savings_goal_enabled = coalesce((p_backup_doc->'savingsGoal'->>'enabled')::boolean, false) where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_target_amount' then update public.budget_distribution_settings set savings_goal_target_amount = (p_backup_doc->'savingsGoal'->>'targetAmount')::numeric where owner_id = p_owner;
      when 'budget_distribution_settings:savings_goal_target_date' then update public.budget_distribution_settings set savings_goal_target_date = (p_backup_doc->'savingsGoal'->>'targetDate')::date where owner_id = p_owner;
      when 'teacher_availability:timezone' then update public.teacher_availability set timezone = p_backup_doc->>'timezone' where owner_id = p_owner;
      when 'teacher_availability:weekly_blocks' then update public.teacher_availability set weekly_blocks = coalesce(p_backup_doc->'weeklyBlocks', '[]'::jsonb) where owner_id = p_owner;
      when 'teacher_availability:exceptions' then update public.teacher_availability set exceptions = coalesce(p_backup_doc->'exceptions', '[]'::jsonb) where owner_id = p_owner;
      else raise exception 'Override singleton inesperado: %.%', p_table_name, v_field;
    end case;
  end loop;

  -- Constraint real de la base (budget_distribution_settings_sum_100) es
  -- el respaldo final si un override parcial dejara una suma inválida —
  -- la transacción completa fallaría y todo se revertiría, nunca queda un
  -- estado a medias.
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    values (p_run_id, p_table_name, p_owner, 'field_overwritten', v_before, public._singleton_row_json(p_table_name, p_owner));
end;
$$;

create or replace function public._singleton_row_json(p_table_name text, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  case p_table_name
    when 'teacher_profiles' then select to_jsonb(t) into v_out from public.teacher_profiles t where t.owner_id = p_owner;
    when 'budget_distribution_settings' then select to_jsonb(t) into v_out from public.budget_distribution_settings t where t.owner_id = p_owner;
    when 'teacher_availability' then select to_jsonb(t) into v_out from public.teacher_availability t where t.owner_id = p_owner;
    when 'surcharge_settings' then select to_jsonb(t) into v_out from public.surcharge_settings t where t.owner_id = p_owner;
  end case;
  return v_out;
end;
$$;

/** training_billing_agreements / student_level_history: insert-only puro, re-verificado, sin override jamás. */
create or replace function public._apply_training_billing_agreements(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ins record; v_row jsonb; v_new_id uuid;
begin
  for v_ins in select * from jsonb_to_recordset(p_classification->'insert_only'->'training_billing_agreements'->'inserts') as x(legacy_mobile_id text)
  loop
    select r into v_row from jsonb_array_elements(p_payload->'trainingBillingAgreements') t(r) where r->>'id' = v_ins.legacy_mobile_id;
    if exists(select 1 from public.training_billing_agreements a where a.owner_id = p_owner and a.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El acuerdo % ya existe — preview desactualizado.', v_ins.legacy_mobile_id;
    end if;
    insert into public.training_billing_agreements (owner_id, legacy_mobile_id, monthly_fee, pending_monthly_fee, pending_monthly_fee_effective_from, start_period)
      values (p_owner, v_row->>'id', (v_row->>'monthlyFee')::numeric, (v_row->>'pendingMonthlyFee')::numeric, v_row->>'pendingMonthlyFeeEffectiveFrom', v_row->>'startPeriod')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'training_billing_agreements', v_new_id, 'inserted', null, (select to_jsonb(a) from public.training_billing_agreements a where a.id = v_new_id));
  end loop;
end;
$$;

create or replace function public._apply_student_level_history(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ins record; v_entry jsonb; v_student_key text; v_new_id uuid; v_student_row_id uuid;
begin
  for v_ins in select * from jsonb_to_recordset(p_classification->'insert_only'->'student_level_history'->'inserts') as x(legacy_mobile_id text)
  loop
    select entry, key into v_entry, v_student_key
      from jsonb_each(coalesce(p_payload->'profiles', '{}'::jsonb)) as p(key, profile)
      cross join lateral jsonb_array_elements(coalesce(profile->'levelHistory', '[]'::jsonb)) as entry
      where entry->>'id' = v_ins.legacy_mobile_id
      limit 1;
    if entry is null then continue; end if;

    if exists(select 1 from public.student_level_history h where h.owner_id = p_owner and h.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'La entrada de nivel % ya existe — preview desactualizado.', v_ins.legacy_mobile_id;
    end if;

    select s.id into v_student_row_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_student_key;
    if v_student_row_id is null then continue; end if; -- alumno no resuelto -> se omite esta entrada, defensivo (no debería pasar: profiles siempre referencia students del mismo backup)

    insert into public.student_level_history (owner_id, student_id, legacy_mobile_id, level, from_level, achieved_on, recorded_at, previous_milestone_at, duration_days, note, origin)
      values (p_owner, v_student_row_id, v_entry->>'id', v_entry->>'level', v_entry->>'fromLevel', (v_entry->>'date')::date, (v_entry->>'recordedAt')::timestamptz, (v_entry->>'previousMilestoneAt')::timestamptz, (v_entry->>'durationDays')::int, v_entry->>'note', v_entry->>'origin')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'student_level_history', v_new_id, 'inserted', null, (select to_jsonb(h) from public.student_level_history h where h.id = v_new_id));
  end loop;
end;
$$;

/** surcharge_settings: insert-only puro (movido a esta categoría a pedido explícito de Joaquín) — nunca override. */
create or replace function public._apply_surcharge_settings(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_current jsonb; v_new_id uuid;
begin
  if coalesce((p_classification->'insert_only'->'surcharge_settings'->>'status'), '') <> 'insert' then return; end if;
  if exists(select 1 from public.surcharge_settings s where s.owner_id = p_owner) then return; end if;

  v_current := p_payload->'surchargeSettings'->'current';
  insert into public.surcharge_settings (owner_id, enabled, grace_day, first_late_day, first_late_percentage, second_late_day, second_late_percentage, last_late_day, last_late_percentage, pending, pending_effective_from)
    values (
      p_owner, false, -- Fase 8: `enabled` siempre false, recargos automáticos desactivados estructuralmente, nunca se reactiva desde un backup
      coalesce((v_current->>'graceDay')::smallint, 10), coalesce((v_current->>'firstLateDay')::smallint, 11), coalesce((v_current->>'firstLatePercentage')::smallint, 10),
      coalesce((v_current->>'secondLateDay')::smallint, 19), coalesce((v_current->>'secondLatePercentage')::smallint, 15),
      coalesce((v_current->>'lastLateDay')::smallint, 27), coalesce((v_current->>'lastLatePercentage')::smallint, 20),
      p_payload->'surchargeSettings'->'pending', p_payload->'surchargeSettings'->>'pendingEffectiveFrom'
    );
  select owner_id into v_new_id from public.surcharge_settings where owner_id = p_owner; -- PK=owner_id, no hay id propio
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    values (p_run_id, 'surcharge_settings', p_owner, 'inserted', null, public._singleton_row_json('surcharge_settings', p_owner));
end;
$$;

/** Agregado recurrence_rules (+ participants + exceptions): inserta completo SÓLO si la regla es alta limpia. */
create or replace function public._apply_recurrence_rules(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_row jsonb; v_new_id uuid; v_student_id uuid; v_agreement_id uuid; v_participant jsonb;
begin
  for v_item in select * from jsonb_to_recordset(p_classification->'aggregates'->'recurrence_rules') as x(legacy_mobile_id text, status text)
    where status = 'insertable'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'recurrenceRules') t(r) where r->>'id' = v_item.legacy_mobile_id;
    if exists(select 1 from public.recurrence_rules rr where rr.owner_id = p_owner and rr.legacy_mobile_id = v_item.legacy_mobile_id) then
      raise exception 'La regla % ya existe — preview desactualizado.', v_item.legacy_mobile_id;
    end if;

    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'primaryStudentId';
    select a.id into v_agreement_id from public.training_billing_agreements a where a.owner_id = p_owner and a.legacy_mobile_id = v_row->>'trainingBillingAgreementId';

    insert into public.recurrence_rules (owner_id, legacy_mobile_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone, start_date, end_date, status, effective_from_date, class_title, activity_kind, training_billing_agreement_id)
      values (p_owner, v_row->>'id', v_student_id, v_row->>'ruleType', (v_row->>'cycleLengthWeeks')::smallint, coalesce(v_row->'weeks', '[]'::jsonb), v_row->>'modality', v_row->>'timezone', (v_row->>'startDate')::date, (v_row->>'endDate')::date, v_row->>'status', (v_row->>'effectiveFromDate')::date, v_row->>'classTitle', coalesce(v_row->>'activityKind', 'class'), v_agreement_id)
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'recurrence_rules', v_new_id, 'inserted', null, (select to_jsonb(rr) from public.recurrence_rules rr where rr.id = v_new_id));

    for v_participant in select * from jsonb_array_elements(coalesce(v_row->'participantStudentIds', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_participant #>> '{}';
      if v_student_id is not null then
        declare v_part_id uuid;
        begin
          insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id) values (p_owner, v_new_id, v_student_id)
            on conflict (recurrence_rule_id, student_id) do nothing returning id into v_part_id;
          if v_part_id is not null then
            insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
              values (p_run_id, 'recurrence_rule_participants', v_part_id, 'inserted', null, (select to_jsonb(p) from public.recurrence_rule_participants p where p.id = v_part_id));
          end if;
        end;
      end if;
    end loop;
  end loop;

  -- 2ª pasada: enlaza supersedes/superseded_by (auto-FK nullable) entre reglas insertadas en esta misma corrida.
  update public.recurrence_rules rr set supersedes_recurrence_id = prev.id
    from public.recurrence_rules prev, jsonb_array_elements(p_payload->'recurrenceRules') t(r)
    where rr.owner_id = p_owner and rr.legacy_mobile_id = t.r->>'id' and t.r->>'supersedesRecurrenceId' is not null
      and prev.owner_id = p_owner and prev.legacy_mobile_id = t.r->>'supersedesRecurrenceId'
      and exists(select 1 from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = 'recurrence_rules' and s.row_id = rr.id);
end;
$$;

/** Agregado calendar_lessons (+ participants): inserta completo SÓLO si la clase es alta limpia. */
create or replace function public._apply_calendar_lessons(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_row jsonb; v_new_id uuid; v_student_id uuid; v_recurrence_id uuid; v_participant jsonb; v_part_id uuid;
begin
  for v_item in select * from jsonb_to_recordset(p_classification->'aggregates'->'calendar_lessons') as x(legacy_mobile_id text, status text)
    where status = 'insertable'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'calendarLessons') t(r) where r->>'id' = v_item.legacy_mobile_id;
    if exists(select 1 from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = v_item.legacy_mobile_id) then
      raise exception 'La clase % ya existe — preview desactualizado.', v_item.legacy_mobile_id;
    end if;

    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'primaryStudentId';
    if v_student_id is null then continue; end if; -- re-verificación defensiva, ya filtrado en preview
    select r.id into v_recurrence_id from public.recurrence_rules r where r.owner_id = p_owner and r.legacy_mobile_id = v_row->>'recurrenceId';

    insert into public.calendar_lessons (
      owner_id, legacy_mobile_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color,
      overlap_allowed, notes, is_recurring, recurrence_id, recurrence_occurrence_key, recurrence_index, recurrence_original_start,
      schedule_adjustment, class_title, activity_kind
    ) values (
      p_owner, v_row->>'id', v_student_id, v_row->>'studentName', v_row->>'level', v_row->>'lessonType', (v_row->>'startAt')::timestamptz, (v_row->>'endAt')::timestamptz, v_row->>'modality', v_row->>'status', v_row->>'color',
      coalesce((v_row->>'overlapAllowed')::boolean, false), v_row->>'notes', coalesce((v_row->>'isRecurring')::boolean, false), v_recurrence_id, v_row->>'recurrenceOccurrenceKey', (v_row->>'recurrenceIndex')::int, (v_row->>'recurrenceOriginalStart')::timestamptz,
      v_row->'scheduleAdjustment', v_row->>'classTitle', coalesce(v_row->>'activityKind', 'class')
    ) returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'calendar_lessons', v_new_id, 'inserted', null, (select to_jsonb(c) from public.calendar_lessons c where c.id = v_new_id));

    for v_participant in select * from jsonb_array_elements(coalesce(v_row->'participants', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_participant->>'studentId';
      if v_student_id is not null then
        insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
          values (p_owner, v_new_id, v_student_id, v_participant->>'studentName', v_participant->>'level')
          on conflict (calendar_lesson_id, student_id) do nothing returning id into v_part_id;
        if v_part_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'calendar_lesson_participants', v_part_id, 'inserted', null, (select to_jsonb(p) from public.calendar_lesson_participants p where p.id = v_part_id));
        end if;
      end if;
    end loop;
  end loop;

  -- 2ª pasada: enlaza freed_by_lesson_id (auto-FK nullable) entre clases insertadas en esta corrida.
  update public.calendar_lessons cl set freed_by_lesson_id = freed.id
    from public.calendar_lessons freed, jsonb_array_elements(p_payload->'calendarLessons') t(r)
    where cl.owner_id = p_owner and cl.legacy_mobile_id = t.r->>'id' and t.r->>'freedByLessonId' is not null
      and freed.owner_id = p_owner and freed.legacy_mobile_id = t.r->>'freedByLessonId'
      and exists(select 1 from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = 'calendar_lessons' and s.row_id = cl.id);
end;
$$;

/**
 * recurrence_exceptions — se resuelven DESPUÉS de calendar_lessons (una
 * excepción puede referenciar `replacement_lesson_id`). Idempotencia real
 * por `unique(recurrence_id, occurrence_key)`, sin necesitar
 * `legacy_mobile_id` propio (confirmado en la auditoría de esquema). Sólo
 * se insertan las excepciones de una regla que ESTA MISMA corrida insertó.
 */
create or replace function public._apply_recurrence_exceptions(p_run_id uuid, p_owner uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb; v_recurrence_id uuid; v_replacement_id uuid; v_new_id uuid;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'recurrenceExceptions', '[]'::jsonb))
  loop
    select r.id into v_recurrence_id from public.recurrence_rules r where r.owner_id = p_owner and r.legacy_mobile_id = v_row->>'recurrenceId';
    if v_recurrence_id is null then continue; end if;
    if not exists(select 1 from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = 'recurrence_rules' and s.row_id = v_recurrence_id) then
      continue; -- la regla ya existía en la web antes de esta corrida -> el agregado quedó preservado, sus excepciones tampoco se tocan
    end if;
    if exists(select 1 from public.recurrence_exceptions e where e.owner_id = p_owner and e.recurrence_id = v_recurrence_id and e.occurrence_key = v_row->>'occurrenceKey') then
      continue; -- ya existe (idempotente por su propia unique)
    end if;

    v_replacement_id := null;
    if v_row->>'replacementLessonId' is not null then
      select c.id into v_replacement_id from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'replacementLessonId';
    end if;

    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type, replacement_lesson_id)
      values (p_owner, v_recurrence_id, v_row->>'occurrenceKey', v_row->>'exceptionType', v_replacement_id)
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'recurrence_exceptions', v_new_id, 'inserted', null, (select to_jsonb(e) from public.recurrence_exceptions e where e.id = v_new_id));
  end loop;
end;
$$;

/** Agregado lesson_registrations (+ students/attendance/evaluations/homework_reviews): inserta completo SÓLO si el registro es alta limpia. */
create or replace function public._apply_lesson_registrations(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_row jsonb; v_new_id uuid; v_calendar_lesson_id uuid; v_roster jsonb; v_att jsonb; v_ev jsonb; v_hr jsonb;
  v_student_id uuid; v_child_id uuid;
begin
  for v_item in select * from jsonb_to_recordset(p_classification->'aggregates'->'lesson_registrations') as x(legacy_mobile_id text, status text)
    where status = 'insertable'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'pedagogicalLessons') t(r) where r->>'id' = v_item.legacy_mobile_id;
    if exists(select 1 from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id = v_item.legacy_mobile_id) then
      raise exception 'El registro % ya existe — preview desactualizado.', v_item.legacy_mobile_id;
    end if;

    v_calendar_lesson_id := null;
    if v_row->>'calendarLessonId' is not null then
      select c.id into v_calendar_lesson_id from public.calendar_lessons c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'calendarLessonId';
    end if;

    insert into public.lesson_registrations (
      owner_id, legacy_mobile_id, calendar_lesson_id, activity_kind, counts_as_class, homework_description, homework_due_date,
      billed_amount, scheduled_start_at, actual_started_at, actual_ended_at, outcome, holiday_exception, modality, scheduled_end_at,
      late_cancellation_policy, late_cancellation_percentage
    ) values (
      p_owner, v_row->>'id', v_calendar_lesson_id, coalesce(v_row->>'activityKind', 'class'), coalesce((v_row->>'countsAsClass')::boolean, true), v_row->>'homeworkDescription', v_row->>'homeworkDueDate',
      (v_row->>'billedAmount')::numeric, (v_row->>'scheduledStartAt')::timestamptz, (v_row->>'actualStartedAt')::timestamptz, (v_row->>'actualEndedAt')::timestamptz,
      coalesce(v_row->>'outcome', 'clase_dictada'), coalesce((v_row->>'holidayException')::boolean, false), v_row->>'modality', (v_row->>'scheduledEndAt')::timestamptz,
      v_row->>'lateCancellationPolicy', (v_row->>'lateCancellationPercentage')::smallint
    ) returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'lesson_registrations', v_new_id, 'inserted', null, (select to_jsonb(l) from public.lesson_registrations l where l.id = v_new_id));

    for v_roster in select * from jsonb_array_elements(coalesce(v_row->'roster', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_roster->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id) values (p_owner, v_new_id, v_student_id)
          on conflict (lesson_registration_id, student_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_students', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_students x where x.id = v_child_id));
        end if;
      end if;
    end loop;

    for v_att in select * from jsonb_array_elements(coalesce(v_row->'attendance', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_att->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status, late_minutes) values (p_owner, v_new_id, v_student_id, v_att->>'status', (v_att->>'lateMinutes')::int)
          on conflict (lesson_registration_id, student_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_attendance', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_attendance x where x.id = v_child_id));
        end if;
      end if;
    end loop;

    for v_ev in select * from jsonb_array_elements(coalesce(v_row->'evaluations', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_ev->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_evaluations (owner_id, lesson_registration_id, student_id, general_grade, skill_grades, strengths, areas_to_improve, individual_observation, individual_homework_description, individual_homework_due_date, billed_amount)
          values (p_owner, v_new_id, v_student_id, (v_ev->>'generalGrade')::numeric, coalesce(v_ev->'skillGrades', '{}'::jsonb),
                  array(select jsonb_array_elements_text(coalesce(v_ev->'strengths', '[]'::jsonb))), array(select jsonb_array_elements_text(coalesce(v_ev->'areasToImprove', '[]'::jsonb))),
                  v_ev->>'individualObservation', v_ev->>'individualHomeworkDescription', (v_ev->>'individualHomeworkDueDate')::date, (v_ev->>'billedAmount')::numeric)
          on conflict (lesson_registration_id, student_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_evaluations', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_evaluations x where x.id = v_child_id));
        end if;
      end if;
    end loop;

    for v_hr in select * from jsonb_array_elements(coalesce(v_row->'homeworkReviews', '[]'::jsonb))
    loop
      select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_hr->>'studentId';
      if v_student_id is not null then
        insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
          values (p_owner, v_new_id, v_student_id, v_hr->>'taskId', v_hr->>'outcome', coalesce((v_hr->>'reviewedAt')::timestamptz, now()))
          on conflict (lesson_registration_id, student_id, task_id) do nothing returning id into v_child_id;
        if v_child_id is not null then
          insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
            values (p_run_id, 'lesson_registration_homework_reviews', v_child_id, 'inserted', null, (select to_jsonb(x) from public.lesson_registration_homework_reviews x where x.id = v_child_id));
        end if;
      end if;
    end loop;
  end loop;

  -- 2ª pasada: rescheduled_from_registration_id (auto-FK nullable) entre registros insertados en esta corrida.
  update public.lesson_registrations lr set rescheduled_from_registration_id = prev.id
    from public.lesson_registrations prev, jsonb_array_elements(p_payload->'pedagogicalLessons') t(r)
    where lr.owner_id = p_owner and lr.legacy_mobile_id = t.r->>'id' and t.r->>'rescheduledFromRegistrationId' is not null
      and prev.owner_id = p_owner and prev.legacy_mobile_id = t.r->>'rescheduledFromRegistrationId'
      and exists(select 1 from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = 'lesson_registrations' and s.row_id = lr.id);
end;
$$;

/**
 * Componentes financieras (todo-o-nada, ver sección 4). Sólo se procesan
 * las filas cuya componente quedó `insertable` — el resto (componente
 * `omitted`) NUNCA se toca, ni siquiera parcialmente. Orden interno fijo
 * (payments/package_purchases primero, lo que depende de ellos después)
 * aplicado de forma UNIFORME a través de todas las componentes
 * insertables a la vez — `payment_allocations` se inserta UNA sola vez
 * aunque su componente contenga tanto el pago como el cargo.
 */
create or replace function public._apply_financial_components(p_run_id uuid, p_owner uuid, p_payload jsonb, p_classification jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_insertable_keys jsonb := '[]'::jsonb;
  v_comp jsonb;
  v_member jsonb;
  v_row jsonb;
  v_new_id uuid;
  v_student_id uuid;
  v_agreement_id uuid;
  v_lesson_id uuid;
  v_calendar_id uuid;
  v_package_id uuid;
  v_payment_id uuid;
  v_charge_id uuid;
begin
  for v_comp in select value from jsonb_array_elements(coalesce(p_classification->'aggregates'->'financial_components', '[]'::jsonb))
    where value->>'status' = 'insertable'
  loop
    v_insertable_keys := v_insertable_keys || (v_comp->'members');
  end loop;

  -- payments (1ª pasada, sin replaces_payment_id)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'payments'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'payments') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.payments p where p.owner_id = p_owner and p.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'El pago % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_student_id is null then continue; end if;
    insert into public.payments (owner_id, legacy_mobile_id, student_id, amount, currency, method, paid_at, notes, voided_at, void_reason, source)
      values (p_owner, v_row->>'id', v_student_id, (v_row->>'amount')::numeric, coalesce(v_row->>'currency', 'ARS'), v_row->>'method', (v_row->>'paidAt')::date, v_row->>'notes', (v_row->>'voidedAt')::timestamptz, v_row->>'voidReason', v_row->>'source')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'payments', v_new_id, 'inserted', null, (select to_jsonb(p) from public.payments p where p.id = v_new_id));
  end loop;

  -- package_purchases
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'package_purchases'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'packagePurchases') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.package_purchases pp where pp.owner_id = p_owner and pp.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'La compra % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_student_id is null then continue; end if;
    insert into public.package_purchases (owner_id, legacy_mobile_id, student_id, included_classes, amount, valid_from, valid_until, voided_at, void_reason)
      values (p_owner, v_row->>'id', v_student_id, (v_row->>'includedClasses')::int, (v_row->>'amount')::numeric, (v_row->>'validFrom')::date, (v_row->>'validUntil')::date, (v_row->>'voidedAt')::timestamptz, v_row->>'voidReason')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'package_purchases', v_new_id, 'inserted', null, (select to_jsonb(pp) from public.package_purchases pp where pp.id = v_new_id));
  end loop;

  -- payment_charges (requiere students, opcionalmente training_billing_agreements/lesson_registrations/calendar_lessons ya globales, y package_purchases recién insertado arriba)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'payment_charges'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'paymentCharges') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.payment_charges c where c.owner_id = p_owner and c.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'El cargo % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_student_id is null then continue; end if;
    select a.id into v_agreement_id from public.training_billing_agreements a where a.owner_id = p_owner and a.legacy_mobile_id = v_row->>'trainingBillingAgreementId';
    select l.id into v_lesson_id from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id = v_row->>'savedLessonId';
    select cl.id into v_calendar_id from public.calendar_lessons cl where cl.owner_id = p_owner and cl.legacy_mobile_id = v_row->>'calendarLessonId';
    select pp.id into v_package_id from public.package_purchases pp where pp.owner_id = p_owner and pp.legacy_mobile_id = v_row->>'packageId';

    insert into public.payment_charges (owner_id, legacy_mobile_id, student_id, charge_type, original_amount, currency, due_date, billing_period, saved_lesson_id, package_id, training_billing_agreement_id, training_series_name, calendar_lesson_id, voided_at, void_reason)
      values (p_owner, v_row->>'id', v_student_id, v_row->>'chargeType', (v_row->>'originalAmount')::numeric, coalesce(v_row->>'currency', 'ARS'), (v_row->>'dueDate')::date, v_row->>'billingPeriod', v_lesson_id, v_package_id, v_agreement_id, v_row->>'trainingSeriesName', v_calendar_id, (v_row->>'voidedAt')::timestamptz, v_row->>'voidReason')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'payment_charges', v_new_id, 'inserted', null, (select to_jsonb(c) from public.payment_charges c where c.id = v_new_id));
  end loop;

  -- payment_allocations (requiere payments + payment_charges + students, todos ya insertados arriba)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'payment_allocations'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'paymentAllocations') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.payment_allocations pa where pa.owner_id = p_owner and pa.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'La asignación % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select p.id into v_payment_id from public.payments p where p.owner_id = p_owner and p.legacy_mobile_id = v_row->>'paymentId';
    select c.id into v_charge_id from public.payment_charges c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'chargeId';
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_payment_id is null or v_charge_id is null or v_student_id is null then continue; end if;
    insert into public.payment_allocations (owner_id, legacy_mobile_id, payment_id, charge_id, student_id, amount)
      values (p_owner, v_row->>'id', v_payment_id, v_charge_id, v_student_id, (v_row->>'amount')::numeric)
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'payment_allocations', v_new_id, 'inserted', null, (select to_jsonb(pa) from public.payment_allocations pa where pa.id = v_new_id));
  end loop;

  -- payment_adjustments (requiere payment_charges)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'payment_adjustments'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'paymentAdjustments') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.payment_adjustments adj where adj.owner_id = p_owner and adj.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'El ajuste % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select c.id into v_charge_id from public.payment_charges c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'chargeId';
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_charge_id is null or v_student_id is null then continue; end if;
    insert into public.payment_adjustments (owner_id, legacy_mobile_id, charge_id, student_id, reason, voided_at, void_reason)
      values (p_owner, v_row->>'id', v_charge_id, v_student_id, v_row->>'reason', (v_row->>'voidedAt')::timestamptz, v_row->>'voidReason')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'payment_adjustments', v_new_id, 'inserted', null, (select to_jsonb(adj) from public.payment_adjustments adj where adj.id = v_new_id));
  end loop;

  -- initial_paid_surcharge_corrections (requiere students; voided/new_payment_id opcionales, ya insertados arriba)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'initial_paid_surcharge_corrections'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'initialPaidSurchargeCorrections') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.initial_paid_surcharge_corrections x where x.owner_id = p_owner and x.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'La corrección % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_student_id is null then continue; end if;
    select p.id into v_payment_id from public.payments p where p.owner_id = p_owner and p.legacy_mobile_id = v_row->>'voidedPaymentId';
    insert into public.initial_paid_surcharge_corrections (owner_id, legacy_mobile_id, student_id, billing_period, previous_surcharge_amount, voided_payment_id, new_payment_id, corrected_at, reason)
      values (p_owner, v_row->>'id', v_student_id, v_row->>'billingPeriod', (v_row->>'previousSurchargeAmount')::numeric, v_payment_id,
              (select p2.id from public.payments p2 where p2.owner_id = p_owner and p2.legacy_mobile_id = v_row->>'newPaymentId'),
              coalesce((v_row->>'correctedAt')::timestamptz, now()), v_row->>'reason')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'initial_paid_surcharge_corrections', v_new_id, 'inserted', null, (select to_jsonb(x) from public.initial_paid_surcharge_corrections x where x.id = v_new_id));
  end loop;

  -- first_month_proration_decisions (requiere students; charge_id opcional, ya insertado arriba)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'first_month_proration_decisions'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'firstMonthProrationDecisions') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.first_month_proration_decisions x where x.owner_id = p_owner and x.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'La decisión % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_student_id is null then continue; end if;
    select c.id into v_charge_id from public.payment_charges c where c.owner_id = p_owner and c.legacy_mobile_id = v_row->>'chargeId';
    insert into public.first_month_proration_decisions (owner_id, legacy_mobile_id, student_id, billing_period, effective_join_date, criterion, classes_remaining, classes_per_full_period, permanent_monthly_amount, charged_amount, charge_id, confirmed_at, source)
      values (p_owner, v_row->>'id', v_student_id, v_row->>'billingPeriod', (v_row->>'effectiveJoinDate')::date, v_row->>'criterion', (v_row->>'classesRemaining')::int, (v_row->>'classesPerFullPeriod')::int, (v_row->>'permanentMonthlyAmount')::numeric, (v_row->>'chargedAmount')::numeric, v_charge_id, coalesce((v_row->>'confirmedAt')::timestamptz, now()), v_row->>'source')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'first_month_proration_decisions', v_new_id, 'inserted', null, (select to_jsonb(x) from public.first_month_proration_decisions x where x.id = v_new_id));
  end loop;

  -- package_credit_movements (requiere package_purchases + students; saved_lesson_id opcional)
  for v_member in select value from jsonb_array_elements(v_insertable_keys) where value->>'table_name' = 'package_credit_movements'
  loop
    select r into v_row from jsonb_array_elements(p_payload->'packageCreditMovements') t(r) where r->>'id' = v_member->>'legacy_mobile_id';
    if exists(select 1 from public.package_credit_movements m where m.owner_id = p_owner and m.legacy_mobile_id = v_member->>'legacy_mobile_id') then
      raise exception 'El movimiento % ya existe — preview desactualizado.', v_member->>'legacy_mobile_id';
    end if;
    select pp.id into v_package_id from public.package_purchases pp where pp.owner_id = p_owner and pp.legacy_mobile_id = v_row->>'packageId';
    select s.id into v_student_id from public.students s where s.owner_id = p_owner and s.legacy_mobile_id = v_row->>'studentId';
    if v_package_id is null or v_student_id is null then continue; end if;
    select l.id into v_lesson_id from public.lesson_registrations l where l.owner_id = p_owner and l.legacy_mobile_id = v_row->>'savedLessonId';
    insert into public.package_credit_movements (owner_id, legacy_mobile_id, package_id, student_id, movement_type, amount, saved_lesson_id, reason, voided_at, void_reason)
      values (p_owner, v_row->>'id', v_package_id, v_student_id, v_row->>'movementType', (v_row->>'amount')::int, v_lesson_id, v_row->>'reason', (v_row->>'voidedAt')::timestamptz, v_row->>'voidReason')
      returning id into v_new_id;
    insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
      values (p_run_id, 'package_credit_movements', v_new_id, 'inserted', null, (select to_jsonb(m) from public.package_credit_movements m where m.id = v_new_id));
  end loop;

  -- 2ª pasada: payments.replaces_payment_id (auto-FK nullable) entre pagos insertados en esta corrida.
  update public.payments p set replaces_payment_id = prev.id
    from public.payments prev, jsonb_array_elements(p_payload->'payments') t(r)
    where p.owner_id = p_owner and p.legacy_mobile_id = t.r->>'id' and t.r->>'replacesPaymentId' is not null
      and prev.owner_id = p_owner and prev.legacy_mobile_id = t.r->>'replacesPaymentId'
      and exists(select 1 from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = 'payments' and s.row_id = p.id);
end;
$$;

-- =============================================================================
-- SECCIÓN 8 — Invariantes financieros, verificados antes del commit. Una
-- sola violación aborta TODA la transacción (rollback nativo).
-- =============================================================================

create or replace function public._validate_import_invariants(p_run_id uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_bad record;
begin
  if exists(
    select 1 from public.import_run_row_snapshots s
      where s.import_run_id = p_run_id
        and s.new_row ? 'amount' and (s.new_row->>'amount')::numeric < 0
  ) then
    raise exception 'Invariante violada: una fila importada tiene un importe negativo.';
  end if;

  for v_bad in
    select p.id, p.amount, coalesce(sum(pa.amount), 0) as allocated
      from public.payments p
      join public.import_run_row_snapshots s on s.import_run_id = p_run_id and s.table_name = 'payments' and s.row_id = p.id
      left join public.payment_allocations pa on pa.payment_id = p.id
      where p.owner_id = p_owner
      group by p.id, p.amount
      having coalesce(sum(pa.amount), 0) > p.amount
  loop
    raise exception 'Invariante violada: las asignaciones del pago % (%) superan su importe (%).', v_bad.id, v_bad.allocated, v_bad.amount;
  end loop;

  for v_bad in
    select c.id, c.original_amount, coalesce(sum(pa.amount), 0) as allocated
      from public.payment_charges c
      join public.import_run_row_snapshots s on s.import_run_id = p_run_id and s.table_name = 'payment_charges' and s.row_id = c.id
      left join public.payment_allocations pa on pa.charge_id = c.id
      where c.owner_id = p_owner
      group by c.id, c.original_amount
      having coalesce(sum(pa.amount), 0) > c.original_amount
  loop
    raise exception 'Invariante violada: las asignaciones del cargo % (%) superan su importe original (%).', v_bad.id, v_bad.allocated, v_bad.original_amount;
  end loop;

  -- Asume `movement_type='consumo'` cuenta clases consumidas como cantidad
  -- positiva en `amount` — mismo criterio que ya usa el motor de paquetes existente.
  for v_bad in
    select pp.id, pp.included_classes, coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) as consumed
      from public.package_purchases pp
      join public.import_run_row_snapshots s on s.import_run_id = p_run_id and s.table_name = 'package_purchases' and s.row_id = pp.id
      left join public.package_credit_movements m on m.package_id = pp.id
      where pp.owner_id = p_owner
      group by pp.id, pp.included_classes
      having coalesce(sum(m.amount) filter (where m.movement_type = 'consumo'), 0) > pp.included_classes
  loop
    raise exception 'Invariante violada: el paquete % tiene más clases consumidas (%) que incluidas (%).', v_bad.id, v_bad.consumed, v_bad.included_classes;
  end loop;

  if exists(
    select 1 from public.import_run_row_snapshots s
      where s.import_run_id = p_run_id and s.table_name in ('recurrence_rule_participants','calendar_lesson_participants','lesson_registration_students','lesson_registration_attendance','lesson_registration_evaluations','lesson_registration_homework_reviews')
        and s.new_row ? 'student_id'
        and not exists(select 1 from public.students st where st.id = (s.new_row->>'student_id')::uuid and st.owner_id = p_owner)
  ) then
    raise exception 'Invariante violada: un participante referencia un alumno de otro owner.';
  end if;

  if exists(
    select 1 from public.import_run_row_snapshots parent
      where parent.import_run_id = p_run_id and parent.table_name = 'payment_charges' and parent.action = 'inserted'
        and (parent.new_row->>'charge_type') = 'paquete'
        and (parent.new_row->>'package_id') is null
  ) then
    raise exception 'Invariante violada: un cargo de tipo paquete quedó sin compra asociada.';
  end if;
end;
$$;

-- =============================================================================
-- SECCIÓN 9 — apply_backup_import (orquestador). Orden de locks CORREGIDO:
-- 1) advisory lock por owner (nunca global), 2) preview FOR UPDATE, 3)
-- relectura de import_runs por (owner_id, preview_id), 4) claim por INSERT
-- ... ON CONFLICT DO NOTHING ... RETURNING, 5) si otra conexión ganó,
-- releer y devolver SU resultado — nunca un 23505 sin respuesta canónica.
-- =============================================================================

create or replace function public.apply_backup_import(p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns table (import_run_id uuid, summary jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_preview public.import_previews%rowtype;
  v_run_id uuid;
  v_summary jsonb;
  v_fp record;
  v_current_fp text;
  v_dup record;
  v_current_dup_fp text;
  v_ins record;
  v_item record;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_preview from public.import_previews where id = p_preview_id and owner_id = v_owner for update;
  if not found then raise exception 'El preview no existe o no te pertenece.'; end if;

  select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
  if found then
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  if v_preview.status <> 'pending' or v_preview.expires_at < now() then
    raise exception 'El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.';
  end if;

  insert into public.import_runs (owner_id, preview_id, backup_checksum, schema_version, app_version, summary, field_overrides, duplicate_decisions, retained_payload)
    values (v_owner, p_preview_id, v_preview.backup_checksum, v_preview.schema_version, v_preview.app_version, '{}'::jsonb, coalesce(p_field_overrides, '[]'::jsonb), coalesce(p_duplicate_decisions, '[]'::jsonb), v_preview.normalized_payload)
    on conflict (owner_id, preview_id) do nothing
    returning id into v_run_id;

  if v_run_id is null then
    select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  for v_fp in select * from public.import_preview_row_fingerprints where preview_id = p_preview_id
  loop
    v_current_fp := public._fingerprint_row(v_fp.table_name, v_fp.row_id, v_owner);
    if v_current_fp is distinct from v_fp.fingerprint then
      raise exception 'La fila % de % cambió desde que se generó el preview. Generá un preview nuevo.', v_fp.row_id, v_fp.table_name;
    end if;
  end loop;

  for v_dup in select * from public.import_preview_duplicate_candidates where preview_id = p_preview_id
  loop
    v_current_dup_fp := public._fingerprint_row('students', v_dup.candidate_student_id, v_owner);
    if v_current_dup_fp is distinct from v_dup.candidate_fingerprint then
      raise exception 'El alumno candidato a duplicado % cambió desde el preview. Generá uno nuevo.', v_dup.candidate_student_id;
    end if;
  end loop;

  for v_ins in select * from jsonb_to_recordset(v_preview.classification->'maestros'->'students'->'inserts') as x(legacy_mobile_id text)
  loop
    if exists(select 1 from public.students s where s.owner_id = v_owner and s.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El alumno % ya existe — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;
  end loop;
  for v_ins in select * from jsonb_to_recordset(v_preview.classification->'maestros'->'custom_levels'->'inserts') as x(legacy_mobile_id text)
  loop
    if exists(select 1 from public.custom_levels c where c.owner_id = v_owner and c.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El nivel % ya existe — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;
  end loop;
  for v_ins in select * from jsonb_to_recordset(v_preview.classification->'insert_only'->'training_billing_agreements'->'inserts') as x(legacy_mobile_id text)
  loop
    if exists(select 1 from public.training_billing_agreements a where a.owner_id = v_owner and a.legacy_mobile_id = v_ins.legacy_mobile_id) then
      raise exception 'El acuerdo % ya existe — generá un preview nuevo.', v_ins.legacy_mobile_id;
    end if;
  end loop;
  for v_item in select value as v from jsonb_array_elements(v_preview.classification->'aggregates'->'recurrence_rules') where value->>'status' = 'insertable'
  loop
    if exists(select 1 from public.recurrence_rules r where r.owner_id = v_owner and r.legacy_mobile_id = v_item.v->>'legacy_mobile_id') then
      raise exception 'La regla % ya existe — generá un preview nuevo.', v_item.v->>'legacy_mobile_id';
    end if;
  end loop;
  for v_item in select value as v from jsonb_array_elements(v_preview.classification->'aggregates'->'calendar_lessons') where value->>'status' = 'insertable'
  loop
    if exists(select 1 from public.calendar_lessons c where c.owner_id = v_owner and c.legacy_mobile_id = v_item.v->>'legacy_mobile_id') then
      raise exception 'La clase % ya existe — generá un preview nuevo.', v_item.v->>'legacy_mobile_id';
    end if;
  end loop;
  for v_item in select value as v from jsonb_array_elements(v_preview.classification->'aggregates'->'lesson_registrations') where value->>'status' = 'insertable'
  loop
    if exists(select 1 from public.lesson_registrations l where l.owner_id = v_owner and l.legacy_mobile_id = v_item.v->>'legacy_mobile_id') then
      raise exception 'El registro % ya existe — generá un preview nuevo.', v_item.v->>'legacy_mobile_id';
    end if;
  end loop;
  -- Las filas de componentes financieros se re-verifican individualmente
  -- dentro de cada `_apply_*` financiero (misma defensa exacta, evita
  -- duplicar 8 ramas de existencia acá).

  perform public._validate_field_overrides(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  perform public._validate_duplicate_decisions(p_preview_id, p_duplicate_decisions);

  perform public._apply_students(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  perform public._apply_custom_levels(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification, p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_profiles', v_preview.normalized_payload->'teacherProfile', v_preview.classification->'maestros'->'teacher_profiles', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'budget_distribution_settings', v_preview.normalized_payload->'budgetDistribution', v_preview.classification->'maestros'->'budget_distribution_settings', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_availability', v_preview.normalized_payload->'teacherAvailability', v_preview.classification->'maestros'->'teacher_availability', p_field_overrides);
  perform public._apply_training_billing_agreements(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_student_level_history(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_surcharge_settings(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_recurrence_rules(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_calendar_lessons(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_recurrence_exceptions(v_run_id, v_owner, v_preview.normalized_payload);
  perform public._apply_lesson_registrations(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);
  perform public._apply_financial_components(v_run_id, v_owner, v_preview.normalized_payload, v_preview.classification);

  perform public._validate_import_invariants(v_run_id, v_owner);

  select jsonb_build_object(
    'replayed', false,
    'counts_by_table', (
      select jsonb_object_agg(s.table_name, s.cnt) from (
        select rs.table_name, count(*) as cnt from public.import_run_row_snapshots as rs where rs.import_run_id = v_run_id group by rs.table_name
      ) s
    ),
    'total_rows_written', (select count(*) from public.import_run_row_snapshots as rs2 where rs2.import_run_id = v_run_id)
  ) into v_summary;

  update public.import_runs set summary = v_summary where id = v_run_id;
  update public.import_previews set status = 'applied' where id = p_preview_id;

  return query select v_run_id, v_summary;
end;
$$;

revoke all on function public.apply_backup_import(uuid, jsonb, jsonb) from public;
revoke all on function public.apply_backup_import(uuid, jsonb, jsonb) from anon;
grant execute on function public.apply_backup_import(uuid, jsonb, jsonb) to authenticated;

-- =============================================================================
-- SECCIÓN 10 — Undo en dos fases. Fase 1 SÓLO LECTURA; Fase 2 escribe
-- únicamente si TODO sigue exactamente como lo dejó la importación — nunca
-- un undo parcial automático (corrección explícita de Joaquín).
-- =============================================================================

create or replace function public.preview_undo_backup_import(p_import_run_id uuid)
returns table (undo_preview_id uuid, is_safe boolean, unsafe_rows jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_run public.import_runs%rowtype;
  v_unsafe jsonb := '[]'::jsonb;
  v_snap record;
  v_current text;
  v_deps jsonb;
  v_id uuid;
  v_parent_tables text[] := array['students','training_billing_agreements','recurrence_rules','calendar_lessons','lesson_registrations','package_purchases','payment_charges','payments'];
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  delete from public.import_undo_previews where owner_id = v_owner and (status <> 'pending' or expires_at < now() - interval '24 hours');

  select * into v_run from public.import_runs where id = p_import_run_id and owner_id = v_owner;
  if not found then raise exception 'Importación no encontrada.'; end if;
  if v_run.status <> 'applied' then raise exception 'Esta importación ya fue deshecha.'; end if;
  if v_run.undo_expires_at < now() then raise exception 'El plazo para deshacer esta importación ya venció (%).', v_run.undo_expires_at; end if;

  for v_snap in select * from public.import_run_row_snapshots where import_run_id = p_import_run_id
  loop
    -- 1) ¿La fila misma cambió desde que la importación la escribió?
    v_current := public._fingerprint_row(v_snap.table_name, v_snap.row_id, v_owner);
    if v_current is distinct from public._fingerprint_canonical(v_snap.table_name, v_snap.new_row) then
      v_unsafe := v_unsafe || jsonb_build_object('table_name', v_snap.table_name, 'row_id', v_snap.row_id, 'reason', 'editada después de la importación');
      continue;
    end if;

    -- 2) Si es una tabla "padre" real, ¿alguna dependencia externa (ajena a este run) la referencia ahora?
    if v_snap.action = 'inserted' and v_snap.table_name = any(v_parent_tables) then
      v_deps := public._external_dependency_blockers(v_snap.table_name, v_snap.row_id, p_import_run_id, v_owner);
      if jsonb_array_length(v_deps) > 0 then
        v_unsafe := v_unsafe || jsonb_build_object('table_name', v_snap.table_name, 'row_id', v_snap.row_id, 'reason', 'tiene datos creados después de la importación que dependen de ella', 'blocking_children', v_deps);
      end if;
    end if;
  end loop;

  insert into public.import_undo_previews (import_run_id, owner_id, is_safe, unsafe_rows)
    values (p_import_run_id, v_owner, jsonb_array_length(v_unsafe) = 0, v_unsafe)
    returning id into v_id;

  return query select v_id, (jsonb_array_length(v_unsafe) = 0), v_unsafe;
end;
$$;

revoke all on function public.preview_undo_backup_import(uuid) from public;
revoke all on function public.preview_undo_backup_import(uuid) from anon;
grant execute on function public.preview_undo_backup_import(uuid) to authenticated;

/**
 * Fase 2. Re-verifica TODO desde cero dentro de la MISMA transacción (nunca
 * confía en el booleano `is_safe` leído en la fase 1) — si algo cambió
 * entretanto, aborta completo, cero escrituras. Borra/restaura en orden
 * INVERSO de dependencias (financiero primero, students al final) — nunca
 * usa `ON DELETE CASCADE` como mecanismo, cada fila se borra/restaura por
 * su propio id explícito.
 */
create or replace function public.apply_undo_backup_import(p_undo_preview_id uuid)
returns table (summary jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_undo_preview public.import_undo_previews%rowtype;
  v_run public.import_runs%rowtype;
  v_snap record;
  v_current text;
  v_deps jsonb;
  v_parent_tables text[] := array['students','training_billing_agreements','recurrence_rules','calendar_lessons','lesson_registrations','package_purchases','payment_charges','payments'];
  v_reverse_order text[] := array[
    'package_credit_movements','first_month_proration_decisions','initial_paid_surcharge_corrections','payment_adjustments','payment_allocations',
    'payment_charges','payments','package_purchases',
    'lesson_registration_homework_reviews','lesson_registration_evaluations','lesson_registration_attendance','lesson_registration_students','lesson_registrations',
    'recurrence_exceptions','calendar_lesson_participants','calendar_lessons','recurrence_rule_participants','recurrence_rules',
    'surcharge_settings','student_level_history','training_billing_agreements',
    'teacher_availability','budget_distribution_settings','teacher_profiles','custom_levels','students'
  ];
  v_table text;
  v_restored_count int := 0;
  v_deleted_count int := 0;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_undo_preview from public.import_undo_previews where id = p_undo_preview_id and owner_id = v_owner for update;
  if not found then raise exception 'El preview de undo no existe o no te pertenece.'; end if;
  if v_undo_preview.status <> 'pending' or v_undo_preview.expires_at < now() then
    raise exception 'El preview de undo ya no es válido. Generá uno nuevo con preview_undo_backup_import.';
  end if;

  select * into v_run from public.import_runs where id = v_undo_preview.import_run_id and owner_id = v_owner for update;
  if not found or v_run.status <> 'applied' then raise exception 'Esta importación ya no puede deshacerse.'; end if;

  -- Re-verificación COMPLETA, nunca confía en `is_safe` de la fase 1.
  for v_snap in select * from public.import_run_row_snapshots where import_run_id = v_run.id
  loop
    v_current := public._fingerprint_row(v_snap.table_name, v_snap.row_id, v_owner);
    if v_current is distinct from public._fingerprint_canonical(v_snap.table_name, v_snap.new_row) then
      raise exception 'La fila % de % cambió desde el preview de undo — deshacer bloqueado por completo, no se tocó nada. Generá un preview de undo nuevo.', v_snap.row_id, v_snap.table_name;
    end if;
    if v_snap.action = 'inserted' and v_snap.table_name = any(v_parent_tables) then
      v_deps := public._external_dependency_blockers(v_snap.table_name, v_snap.row_id, v_run.id, v_owner);
      if jsonb_array_length(v_deps) > 0 then
        raise exception 'La fila % de % tiene dependencias creadas después de la importación — deshacer bloqueado por completo, no se tocó nada.', v_snap.row_id, v_snap.table_name;
      end if;
    end if;
  end loop;

  -- Todo verificado limpio: borra/restaura en orden inverso real, tabla por tabla, ramas tipadas.
  foreach v_table in array v_reverse_order
  loop
    for v_snap in select * from public.import_run_row_snapshots where import_run_id = v_run.id and table_name = v_table
    loop
      if v_snap.action = 'inserted' then
        case v_table
          when 'students' then delete from public.students where id = v_snap.row_id and owner_id = v_owner;
          when 'custom_levels' then delete from public.custom_levels where id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_profiles' then delete from public.teacher_profiles where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'budget_distribution_settings' then delete from public.budget_distribution_settings where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_availability' then delete from public.teacher_availability where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'training_billing_agreements' then delete from public.training_billing_agreements where id = v_snap.row_id and owner_id = v_owner;
          when 'student_level_history' then delete from public.student_level_history where id = v_snap.row_id and owner_id = v_owner;
          when 'surcharge_settings' then delete from public.surcharge_settings where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'recurrence_rules' then delete from public.recurrence_rules where id = v_snap.row_id and owner_id = v_owner;
          when 'recurrence_rule_participants' then delete from public.recurrence_rule_participants where id = v_snap.row_id and owner_id = v_owner;
          when 'calendar_lessons' then delete from public.calendar_lessons where id = v_snap.row_id and owner_id = v_owner;
          when 'calendar_lesson_participants' then delete from public.calendar_lesson_participants where id = v_snap.row_id and owner_id = v_owner;
          when 'recurrence_exceptions' then delete from public.recurrence_exceptions where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registrations' then delete from public.lesson_registrations where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_students' then delete from public.lesson_registration_students where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_attendance' then delete from public.lesson_registration_attendance where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_evaluations' then delete from public.lesson_registration_evaluations where id = v_snap.row_id and owner_id = v_owner;
          when 'lesson_registration_homework_reviews' then delete from public.lesson_registration_homework_reviews where id = v_snap.row_id and owner_id = v_owner;
          when 'package_purchases' then delete from public.package_purchases where id = v_snap.row_id and owner_id = v_owner;
          when 'package_credit_movements' then delete from public.package_credit_movements where id = v_snap.row_id and owner_id = v_owner;
          when 'payment_charges' then delete from public.payment_charges where id = v_snap.row_id and owner_id = v_owner;
          when 'payments' then delete from public.payments where id = v_snap.row_id and owner_id = v_owner;
          when 'payment_allocations' then delete from public.payment_allocations where id = v_snap.row_id and owner_id = v_owner;
          when 'payment_adjustments' then delete from public.payment_adjustments where id = v_snap.row_id and owner_id = v_owner;
          when 'initial_paid_surcharge_corrections' then delete from public.initial_paid_surcharge_corrections where id = v_snap.row_id and owner_id = v_owner;
          when 'first_month_proration_decisions' then delete from public.first_month_proration_decisions where id = v_snap.row_id and owner_id = v_owner;
          else raise exception 'Tabla no reconocida al deshacer: %', v_table;
        end case;
        v_deleted_count := v_deleted_count + 1;
      elsif v_snap.action in ('field_overwritten', 'identity_linked') then
        case v_table
          when 'students' then
            update public.students set
              name = coalesce(v_snap.previous_row->>'name', name), phone = v_snap.previous_row->>'phone', whatsapp = v_snap.previous_row->>'whatsapp',
              email = v_snap.previous_row->>'email', notes = v_snap.previous_row->>'notes', birth_date = (v_snap.previous_row->>'birth_date')::date,
              current_goals = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'current_goals','[]'::jsonb))),
              strengths = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'strengths','[]'::jsonb))),
              areas_to_improve = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'areas_to_improve','[]'::jsonb))),
              alerts = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'alerts','[]'::jsonb))),
              usual_days = array(select jsonb_array_elements_text(coalesce(v_snap.previous_row->'usual_days','[]'::jsonb))),
              usual_time = v_snap.previous_row->>'usual_time',
              legacy_mobile_id = v_snap.previous_row->>'legacy_mobile_id'
              where id = v_snap.row_id and owner_id = v_owner;
          when 'custom_levels' then
            update public.custom_levels set name = v_snap.previous_row->>'name' where id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_profiles' then
            update public.teacher_profiles set display_name = coalesce(v_snap.previous_row->>'display_name', '') where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'budget_distribution_settings' then
            update public.budget_distribution_settings set
              needs_percent = (v_snap.previous_row->>'needs_percent')::smallint, wants_percent = (v_snap.previous_row->>'wants_percent')::smallint, savings_percent = (v_snap.previous_row->>'savings_percent')::smallint,
              savings_goal_enabled = coalesce((v_snap.previous_row->>'savings_goal_enabled')::boolean, false), savings_goal_target_amount = (v_snap.previous_row->>'savings_goal_target_amount')::numeric, savings_goal_target_date = (v_snap.previous_row->>'savings_goal_target_date')::date
              where owner_id = v_snap.row_id and owner_id = v_owner;
          when 'teacher_availability' then
            update public.teacher_availability set timezone = v_snap.previous_row->>'timezone', weekly_blocks = coalesce(v_snap.previous_row->'weekly_blocks','[]'::jsonb), exceptions = coalesce(v_snap.previous_row->'exceptions','[]'::jsonb)
              where owner_id = v_snap.row_id and owner_id = v_owner;
          else raise exception 'Tabla no reconocida al restaurar override: %', v_table;
        end case;
        v_restored_count := v_restored_count + 1;
      end if;
    end loop;
  end loop;

  update public.import_runs set status = 'undone', undone_at = now() where id = v_run.id;
  update public.import_undo_previews set status = 'applied' where id = p_undo_preview_id;

  return query select jsonb_build_object('deleted_rows', v_deleted_count, 'restored_rows', v_restored_count);
end;
$$;

revoke all on function public.apply_undo_backup_import(uuid) from public;
revoke all on function public.apply_undo_backup_import(uuid) from anon;
grant execute on function public.apply_undo_backup_import(uuid) to authenticated;

-- =============================================================================
-- SECCIÓN 11 — discard_import_undo: renuncia anticipada, purga los
-- snapshots antes de los 30 días si la profesora ya no necesita poder
-- deshacer.
-- =============================================================================

create or replace function public.discard_import_undo(p_import_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;
  if not exists(select 1 from public.import_runs where id = p_import_run_id and owner_id = v_owner) then
    raise exception 'Importación no encontrada.';
  end if;

  delete from public.import_run_row_snapshots where import_run_id = p_import_run_id;
  update public.import_runs set snapshots_purged_at = now() where id = p_import_run_id and owner_id = v_owner;
end;
$$;

revoke all on function public.discard_import_undo(uuid) from public;
revoke all on function public.discard_import_undo(uuid) from anon;
grant execute on function public.discard_import_undo(uuid) to authenticated;

-- =============================================================================
-- SECCIÓN 12 — Revoke masivo de las ~36 funciones internas (prefijo `_`).
-- Nacen con EXECUTE para `anon` por el mismo privilegio por defecto real
-- del proyecto documentado desde Fase 7 (`supabase_admin` concede EXECUTE
-- a `anon` en toda función nueva de `public`) — nunca deben ser invocables
-- directamente, sólo desde las 6 RPC públicas (que al ser `security
-- definer` ya se ejecutan con los privilegios del owner de la función, así
-- que revocarles EXECUTE a `authenticated`/`anon` no rompe nada del camino
-- real). Este bloque usa `EXECUTE format(...)` sobre datos leídos de
-- `pg_proc` (catálogo real del servidor) — NUNCA sobre datos provistos por
-- un cliente — es administración de esquema en tiempo de migración, la
-- misma categoría que ya usa `supabase/tests/anon_execute_audit.sql` para
-- auditar, no el patrón de SQL dinámico prohibido en el camino de
-- escritura de datos de negocio.
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
