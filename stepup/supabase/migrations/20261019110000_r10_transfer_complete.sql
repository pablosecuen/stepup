-- R10 — Traslado COMPLETO desde la app móvil: todo dato del origen tiene un destino real en la web (no sólo una copia en el archivo). ADITIVA e idempotente.
-- NO se aplica a Production sin autorización. Depende de R9 (archivo del origen + historiales).
--
-- Principio: guardar un dato únicamente en el archivo del respaldo NO es migrarlo. Cada campo del origen queda en una columna (o tabla) de la cuenta, con las
-- mismas reglas de acceso (RLS por cuenta) que el resto de sus datos, y la comparación origen ↔ destino lo verifica campo por campo.
--
-- Qué agrega:
--   1. Contenido pedagógico de cada clase registrada (temas con su estado, objetivos, actividades, notas de actividades, notas internas, materiales usados),
--      marcas «facturable» / «consume paquete», resultado original («alumno ausente» se guarda como clase dictada + asistencia «ausente», y el original queda en
--      `source_event_type`), duraciones programada y real, y `source_extras` (reserva de calendario, cronómetro, puntualidad, ajuste de horario, importes por
--      alumno, y cualquier campo que una versión futura de la app agregue).
--   2. Estado REAL de los registros grupales: registro «en curso» + estado y orden de cada participante (la web ya tenía el mismo mecanismo que la app; la
--      importación lo reiniciaba). Un registro finalizado deja a todos sus participantes «completados», como lo hace la web al finalizar.
--   3. Fechas originales: creación/edición de la clase registrada, creación de cobros, ajustes, paquetes y acuerdos, `recorded_at` de pagos, creación de
--      reportes y de niveles. Nunca se reemplazan por la fecha de la importación. (La fecha en que se importó queda en `import_runs`.)
--   4. Historial de ediciones de cada clase (`lesson_registration_edit_history`), adjuntos de clase (`lesson_attachments`), reportes generados
--      (`report_records`, con el snapshot en el formato de la web para volver a generar el PDF y el registro original dentro), grupo de superposición de
--      clases, snapshot de series del primer mes proporcional, avance del tutorial, y `student_source_extras` (datos calculados por la app y cualquier otro
--      campo sin equivalente del alumno).
--   5. Notas fuera de 1–10: se conserva el valor ORIGINAL (`source_grades`) junto con las banderas de revisión; la nota válida sólo se completa si está en 1–10.
--   6. Archivos que sólo existen en el teléfono: `material_library_items` (biblioteca de materiales, que nunca viajó en el respaldo), bucket privado
--      `lesson-files`, y las funciones `import_phone_extraction` / `register_transfer_file` que registran cada archivo subido con su huella SHA-256.
--   7. Redefine, con la MISMA firma y resultado: `_import_undo_analyze` (deshacer sigue valiendo para importaciones anteriores aunque las tablas ganen columnas), `apply_backup_import` (una llamada más), `apply_undo_backup_import` y `_import_row_key` (tablas nuevas),
--      `_import_undo_relations` (3 relaciones), `_import_check_payload` (cuenta las filas anidadas nuevas) y `_import_apply_histories` (conserva la entrada original).
-- Reversión: supabase/repairs/r10_transfer_complete_rollback.sql.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Columnas nuevas (todas con valor por defecto: las filas y las RPC existentes siguen funcionando igual)
-- ---------------------------------------------------------------------------------------------------------------------
alter table public.lesson_registrations
  add column if not exists topics jsonb not null default '[]'::jsonb,
  add column if not exists objectives text[] not null default '{}'::text[],
  add column if not exists activities text[] not null default '{}'::text[],
  add column if not exists activity_notes text not null default '',
  add column if not exists internal_notes text not null default '',
  add column if not exists material_ids text[] not null default '{}'::text[],
  add column if not exists is_billable boolean not null default true,
  add column if not exists consumes_monthly_package boolean not null default true,
  add column if not exists source_event_type text,
  add column if not exists scheduled_duration_minutes integer,
  add column if not exists actual_duration_minutes integer,
  add column if not exists source_extras jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.lesson_registrations'::regclass and conname = 'lesson_registrations_topics_is_array') then
    alter table public.lesson_registrations add constraint lesson_registrations_topics_is_array check (jsonb_typeof(topics) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lesson_registrations'::regclass and conname = 'lesson_registrations_source_extras_is_object') then
    alter table public.lesson_registrations add constraint lesson_registrations_source_extras_is_object check (jsonb_typeof(source_extras) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lesson_registrations'::regclass and conname = 'lesson_registrations_source_event_type_check') then
    alter table public.lesson_registrations add constraint lesson_registrations_source_event_type_check
      check (source_event_type is null or source_event_type in ('clase_dictada', 'alumno_ausente', 'profesora_ausente', 'cancelada_con_aviso', 'cancelada_tarde', 'reprogramada', 'feriado'));
  end if;
end $$;

comment on column public.lesson_registrations.topics is 'Temas de la clase [{id, text, status: planificado|visto}] (puerto de TopicEntry del móvil).';
comment on column public.lesson_registrations.source_event_type is 'Resultado ORIGINAL de la clase en la app (incluye alumno_ausente, que la web guarda como clase dictada + asistencia ausente).';
comment on column public.lesson_registrations.source_extras is 'Campos de la clase en la app sin columna propia (reserva de calendario, cronómetro, puntualidad, importes por alumno, etc.), conservados tal cual.';

alter table public.lesson_registration_students add column if not exists participant_position smallint;
comment on column public.lesson_registration_students.participant_position is 'Orden estable del participante en el registro grupal (participantOrder de la app).';

alter table public.lesson_registration_evaluations add column if not exists source_grades jsonb;
comment on column public.lesson_registration_evaluations.source_grades is 'Notas ORIGINALES tal como estaban en el origen {generalGrade, skillGrades, flags}. general_grade / skill_grades sólo llevan lo que está en 1–10; flags marca lo fuera de rango o «sin calificar» para revisarlo.';

alter table public.calendar_lessons add column if not exists legacy_overlap_group_id text;
comment on column public.calendar_lessons.legacy_overlap_group_id is 'Identificador ORIGINAL del grupo de superposición intencional de la app; overlap_group_id es el uuid derivado (mismo grupo ⇒ mismo uuid).';


alter table public.teacher_profiles add column if not exists source_updated_at timestamptz;
comment on column public.teacher_profiles.source_updated_at is 'Fecha de última modificación ORIGINAL del perfil en la app (updated_at lo mantiene la web).';

alter table public.student_price_history add column if not exists source_entry jsonb;
comment on column public.student_price_history.source_entry is 'Entrada original del historial de precios en la app (la fecha original puede ser un instante; effective_on es el día civil).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Tablas nuevas (sólo lectura propia para la API; las escribe la importación y las RPC de abajo)
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.lesson_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text not null,
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  student_id uuid references public.students(id) on delete restrict,
  name text not null,
  kind text not null default 'pdf' check (kind in ('pdf', 'image')),
  mime_type text,
  size_bytes bigint,
  caption text,
  added_at timestamptz,
  source_uri text,
  storage_path text,
  sha256 text,
  stored_size_bytes bigint,
  file_status text not null default 'pendiente' check (file_status in ('pendiente', 'disponible', 'no_disponible')),
  created_at timestamptz not null default now(),
  unique (owner_id, legacy_mobile_id)
);
comment on table public.lesson_attachments is 'Adjuntos (PDF / fotos) de una clase registrada. student_id NULL = común a toda la clase. El archivo vive en el bucket privado lesson-files (storage_path) una vez extraído del teléfono.';
-- Registro auditado de dependencias del deshacer: las dos referencias nuevas (la prueba de auditoría contra pg_constraint falla si falta alguna).
insert into public.import_undo_dependency_registry (parent_table, child_table, fk_column) values
  ('lesson_registrations', 'lesson_attachments', 'lesson_registration_id'),
  ('students', 'lesson_attachments', 'student_id')
on conflict do nothing;
create index if not exists lesson_attachments_registration_idx on public.lesson_attachments (lesson_registration_id);
create index if not exists lesson_attachments_owner_idx on public.lesson_attachments (owner_id);

-- Datos del alumno en la app sin columna propia (totales y etiquetas calculadas, historial de notas por habilidad, entradas de historial inválidas), conservados tal cual.
-- Tabla propia (no una columna de students): el historial por habilidad de un alumno con años de clases puede pasar el tope de 64 KB por fila de la cuota de alumnos.
create table if not exists public.student_source_extras (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null unique references public.students(id) on delete cascade,
  extras jsonb not null default '{}'::jsonb check (jsonb_typeof(extras) = 'object'),
  created_at timestamptz not null default now()
);
comment on table public.student_source_extras is 'Datos del alumno en la app sin columna propia (totales y etiquetas calculadas, historial de notas por habilidad, entradas de historial inválidas), conservados tal cual.';
create index if not exists student_source_extras_owner_idx on public.student_source_extras (owner_id);
insert into public.import_undo_dependency_registry (parent_table, child_table, fk_column) values ('students', 'student_source_extras', 'student_id') on conflict do nothing;

create table if not exists public.material_library_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  legacy_mobile_id text not null,
  name text not null,
  note text,
  created_at timestamptz,
  attachment_name text,
  attachment_kind text check (attachment_kind is null or attachment_kind in ('pdf', 'image')),
  attachment_mime_type text,
  attachment_size_bytes bigint,
  attachment_caption text,
  attachment_added_at timestamptz,
  attachment_source_uri text,
  storage_path text,
  sha256 text,
  stored_size_bytes bigint,
  file_status text not null default 'sin_archivo' check (file_status in ('sin_archivo', 'pendiente', 'disponible', 'no_disponible')),
  imported_at timestamptz not null default now(),
  unique (owner_id, legacy_mobile_id)
);
comment on table public.material_library_items is 'Biblioteca de materiales reutilizables de la app (nunca viajó en el respaldo: sale de la extracción del teléfono). lesson_registrations.material_ids apunta a legacy_mobile_id.';
create index if not exists material_library_items_owner_idx on public.material_library_items (owner_id);

create table if not exists public.device_local_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  taken_at timestamptz not null default now(),
  payload jsonb not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, sha256)
);
comment on table public.device_local_snapshots is 'Datos que la app guarda SÓLO en el teléfono y no entran al respaldo (cola de operaciones pendientes, avisos, sesión de clase en curso, preferencias), tomados en la extracción.';

-- Resultado de cada extracción del teléfono (sólo identificadores y cantidades: qué archivos ya no existían en el origen, cuántos se subieron). Lo lee el comparador.
create table if not exists public.phone_extraction_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  finished_at timestamptz not null default now(),
  summary jsonb not null
);
comment on table public.phone_extraction_results is 'Resultado de cada extracción de archivos del teléfono: cantidades e identificadores (nunca nombres ni rutas). missingAtOrigin lista los archivos que el teléfono ya no tenía.';
create index if not exists phone_extraction_results_owner_idx on public.phone_extraction_results (owner_id);

alter table public.lesson_attachments enable row level security;
alter table public.student_source_extras enable row level security;
alter table public.phone_extraction_results enable row level security;
alter table public.material_library_items enable row level security;
alter table public.device_local_snapshots enable row level security;
revoke all on public.lesson_attachments, public.student_source_extras, public.material_library_items, public.device_local_snapshots, public.phone_extraction_results from anon, authenticated;
grant select on public.lesson_attachments, public.student_source_extras, public.material_library_items, public.device_local_snapshots, public.phone_extraction_results to authenticated;
drop policy if exists student_source_extras_owner_select on public.student_source_extras;
create policy student_source_extras_owner_select on public.student_source_extras for select to authenticated using (owner_id = auth.uid());
drop policy if exists phone_extraction_results_owner_select on public.phone_extraction_results;
create policy phone_extraction_results_owner_select on public.phone_extraction_results for select to authenticated using (owner_id = auth.uid());
drop policy if exists lesson_attachments_owner_select on public.lesson_attachments;
create policy lesson_attachments_owner_select on public.lesson_attachments for select to authenticated using (owner_id = auth.uid());
drop policy if exists material_library_items_owner_select on public.material_library_items;
create policy material_library_items_owner_select on public.material_library_items for select to authenticated using (owner_id = auth.uid());
drop policy if exists device_local_snapshots_owner_select on public.device_local_snapshots;
create policy device_local_snapshots_owner_select on public.device_local_snapshots for select to authenticated using (owner_id = auth.uid());

-- Bucket privado para adjuntos y materiales: agregar, leer y (sólo la dueña, sobre su propia carpeta) borrar. Nunca actualizar: cada archivo es una copia inmutable con su huella.
-- Borrar es necesario para que la eliminación de la cuenta pueda vaciar la carpeta antes de borrarla (igual que el bucket de PDF de reportes).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-files', 'lesson-files', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

drop policy if exists lesson_files_owner_select on storage.objects;
create policy lesson_files_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists lesson_files_owner_insert on storage.objects;
create policy lesson_files_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists lesson_files_owner_delete on storage.objects;
create policy lesson_files_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lesson-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Utilidades
-- ---------------------------------------------------------------------------------------------------------------------
-- Instante de un texto, o NULL si no es una fecha válida (una fecha corrupta del origen nunca debe romper toda la importación; el comparador la señala).
create or replace function public._import_ts(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;
revoke all on function public._import_ts(text) from public, anon, authenticated;

-- Arreglo de textos de un jsonb (vacío si falta o no es un arreglo).
create or replace function public._import_text_array(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end)), '{}'::text[])
$$;
revoke all on function public._import_text_array(jsonb) from public, anon, authenticated;

-- La fila viva reducida a las claves de una plantilla (la instantánea de la importación): sirve para que deshacer una importación hecha ANTES de R10 no vea como «editada»
-- una fila sólo porque su tabla ganó columnas nuevas.
create or replace function public._import_project_row(p_row jsonb, p_template jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(r.key, r.value), '{}'::jsonb) from jsonb_each(p_row) r where p_template ? r.key
$$;
revoke all on function public._import_project_row(jsonb, jsonb) from public, anon, authenticated;

-- Filas insertadas por esta importación en una tabla (las únicas que se completan: nunca se toca lo que ya existía en la web).
create or replace function public._import_inserted_ids(p_run_id uuid, p_table text)
returns table(row_id uuid)
language sql
stable
set search_path = ''
as $$
  select s.row_id from public.import_run_row_snapshots s where s.import_run_id = p_run_id and s.table_name = p_table and s.action = 'inserted'
$$;
revoke all on function public._import_inserted_ids(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4) Completar lo importado: contenido, estado, fechas originales, historial de ediciones, adjuntos, reportes y extras
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._import_apply_extras(p_run_id uuid, p_owner uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regs jsonb := public._import_arr(p_payload, 'pedagogicalLessons');
  v_spec record;
begin
  -- 4.1) Clases registradas: contenido pedagógico, marcas, duraciones, estado del registro, fechas originales y extras.
  with src as (
    select r.id as reg_id, e as j
      from jsonb_array_elements(v_regs) e
      join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
     where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations'))
  ), upd as (
    update public.lesson_registrations r set
        topics = case when jsonb_typeof(s.j -> 'topics') = 'array' then s.j -> 'topics' else '[]'::jsonb end,
        objectives = public._import_text_array(s.j -> 'objectives'),
        activities = public._import_text_array(s.j -> 'activities'),
        activity_notes = coalesce(s.j ->> 'activityNotes', ''),
        internal_notes = coalesce(s.j ->> 'internalNotes', ''),
        material_ids = public._import_text_array(s.j -> 'materialIds'),
        is_billable = coalesce((s.j ->> 'isBillable')::boolean, true),
        consumes_monthly_package = coalesce((s.j ->> 'consumesMonthlyPackage')::boolean, true),
        source_event_type = s.j ->> 'sourceEventType',
        scheduled_duration_minutes = case when jsonb_typeof(s.j -> 'scheduledDurationMinutes') = 'number' then round((s.j ->> 'scheduledDurationMinutes')::numeric)::int end,
        actual_duration_minutes = case when jsonb_typeof(s.j -> 'actualDurationMinutes') = 'number' then round((s.j ->> 'actualDurationMinutes')::numeric)::int end,
        source_extras = case when jsonb_typeof(s.j -> 'sourceExtras') = 'object' then s.j -> 'sourceExtras' else '{}'::jsonb end,
        status = case when s.j ->> 'registrationStatus' = 'in_progress' then 'in_progress' else r.status end,
        created_at = coalesce(public._import_ts(s.j ->> 'createdAt'), r.created_at),
        updated_at = coalesce(public._import_ts(s.j ->> 'updatedAt'), r.updated_at)
      from src s where r.id = s.reg_id
    returning r.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'lesson_registrations' and rs.row_id = u.id;

  -- 4.2) Participantes: estado y orden de cada uno. Un registro finalizado deja a TODOS «completados» (así lo deja la web al finalizar);
  --      uno «en curso» conserva el estado que traía cada participante.
  with prog as (
    select r.id as reg_id, st.id as student_id, pp ->> 'status' as status, (pp ->> 'position')::int as position
      from jsonb_array_elements(v_regs) e
      join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'participantProgress') = 'array' then e -> 'participantProgress' else '[]'::jsonb end) pp
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = pp ->> 'studentId'
     where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations'))
       and pp ->> 'status' in ('pending', 'completed', 'omitted')
  ), upd as (
    update public.lesson_registration_students lrs set
        participant_status = coalesce(
          (select p.status from prog p where p.reg_id = lrs.lesson_registration_id and p.student_id = lrs.student_id),
          case when r.status = 'completed' then 'completed' else lrs.participant_status end),
        participant_position = (select p.position::smallint from prog p where p.reg_id = lrs.lesson_registration_id and p.student_id = lrs.student_id)
      from public.lesson_registrations r
     where r.id = lrs.lesson_registration_id and lrs.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registration_students'))
    returning lrs.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'lesson_registration_students' and rs.row_id = u.id;

  -- 4.2b) Series: «reemplazada por» (la importación por conjuntos sólo cargaba «reemplaza a»; el origen trae las dos puntas).
  with upd as (
    update public.recurrence_rules r set superseded_by_recurrence_id = t.id
      from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceRules')) e
      join public.recurrence_rules t on t.owner_id = p_owner and t.legacy_mobile_id = e ->> 'supersededByRecurrenceId'
     where r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id' and nullif(e ->> 'supersededByRecurrenceId', '') is not null
       and r.id in (select row_id from public._import_inserted_ids(p_run_id, 'recurrence_rules'))
    returning r.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'recurrence_rules' and rs.row_id = u.id;

  -- 4.3) Evaluaciones: notas ORIGINALES (la nota válida ya se cargó sólo si estaba en 1–10).
  with src as (
    select r.id as reg_id, st.id as student_id, ev -> 'sourceGrades' as source_grades
      from jsonb_array_elements(v_regs) e
      join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'evaluations') = 'array' then e -> 'evaluations' else '[]'::jsonb end) ev
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = ev ->> 'studentId'
     where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations')) and jsonb_typeof(ev -> 'sourceGrades') = 'object'
  ), upd as (
    update public.lesson_registration_evaluations le set source_grades = s.source_grades
      from src s where le.lesson_registration_id = s.reg_id and le.student_id = s.student_id
       and le.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registration_evaluations'))
    returning le.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'lesson_registration_evaluations' and rs.row_id = u.id;

  -- 4.4) Historial de ediciones de la clase (auditoría append-only de la app).
  with ins as (
    insert into public.lesson_registration_edit_history (owner_id, lesson_registration_id, edit_operation_id, edited_at, previous_snapshot)
      select p_owner, r.id, md5(p_owner::text || '|edit|' || (e ->> 'id') || '|' || (h ->> 'index'))::uuid, public._import_ts(h ->> 'editedAt'),
             jsonb_build_object('_format', 'mobile_v1') || coalesce(h -> 'snapshot', '{}'::jsonb)
        from jsonb_array_elements(v_regs) e
        join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'editHistory') = 'array' then e -> 'editHistory' else '[]'::jsonb end) h
       where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations')) and public._import_ts(h ->> 'editedAt') is not null
       order by r.id, (h ->> 'index')::int
    on conflict (lesson_registration_id, edit_operation_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_registration_edit_history', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- 4.5) Adjuntos de la clase: la fila existe desde ya (nombre, tipo, tamaño, a qué alumno pertenece); el archivo se completa al extraerlo del teléfono.
  with ins as (
    insert into public.lesson_attachments (owner_id, legacy_mobile_id, lesson_registration_id, student_id, name, kind, mime_type, size_bytes, caption, added_at, source_uri)
      select p_owner, a ->> 'id', r.id, st.id, coalesce(a ->> 'name', ''), case when a ->> 'kind' = 'image' then 'image' else 'pdf' end, a ->> 'mimeType',
             case when jsonb_typeof(a -> 'sizeBytes') = 'number' then (a ->> 'sizeBytes')::numeric::bigint end, a ->> 'caption', public._import_ts(a ->> 'addedAt'), a ->> 'sourceUri'
        from jsonb_array_elements(v_regs) e
        join public.lesson_registrations r on r.owner_id = p_owner and r.legacy_mobile_id = e ->> 'id'
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e -> 'attachments') = 'array' then e -> 'attachments' else '[]'::jsonb end) a
        left join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = a ->> 'studentId'
       where r.id in (select row_id from public._import_inserted_ids(p_run_id, 'lesson_registrations')) and a ->> 'id' is not null
         and (nullif(a ->> 'studentId', '') is null or st.id is not null)
    on conflict (owner_id, legacy_mobile_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'lesson_attachments', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- 4.6) Clases de calendario: grupo de superposición (el original como texto + el uuid derivado: mismo grupo ⇒ mismo uuid).
  with upd as (
    update public.calendar_lessons c set
        legacy_overlap_group_id = e ->> 'overlapGroupId',
        overlap_group_id = md5(p_owner::text || '|overlap|' || (e ->> 'overlapGroupId'))::uuid
      from jsonb_array_elements(public._import_arr(p_payload, 'calendarLessons')) e
     where c.owner_id = p_owner and c.legacy_mobile_id = e ->> 'id' and nullif(e ->> 'overlapGroupId', '') is not null
       and c.id in (select row_id from public._import_inserted_ids(p_run_id, 'calendar_lessons'))
    returning c.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'calendar_lessons' and rs.row_id = u.id;

  -- 4.7) Alumnos: extras del origen (datos calculados por la app y entradas de historial inválidas) en su propia tabla.
  with ins as (
    insert into public.student_source_extras (owner_id, student_id, extras)
      select p_owner, s.id, e -> 'sourceExtras'
        from jsonb_array_elements(public._import_arr(p_payload, 'students')) e
        join public.students s on s.owner_id = p_owner and s.legacy_mobile_id = e ->> 'id'
       where jsonb_typeof(e -> 'sourceExtras') = 'object' and e -> 'sourceExtras' <> '{}'::jsonb
         and s.id in (select row_id from public._import_inserted_ids(p_run_id, 'students'))
       order by s.id
    on conflict (student_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_source_extras', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- 4.8) Fechas originales de creación / registro (una sola sentencia por tabla; sólo filas de esta corrida y sólo si el origen trae una fecha válida).
  for v_spec in
    select * from (values
      ('payment_charges', 'paymentCharges', 'created_at', 'createdAt'),
      ('payments', 'payments', 'recorded_at', 'recordedAt'),
      ('payment_adjustments', 'paymentAdjustments', 'created_at', 'createdAt'),
      ('payment_allocations', 'paymentAllocations', 'created_at', 'createdAt'),
      ('package_purchases', 'packagePurchases', 'created_at', 'createdAt'),
      ('package_credit_movements', 'packageCreditMovements', 'created_at', 'createdAt'),
      ('training_billing_agreements', 'trainingBillingAgreements', 'created_at', 'createdAt'),
      ('custom_levels', 'customLevels', 'created_at', 'createdAt'),
      ('first_month_proration_decisions', 'firstMonthProrationDecisions', 'created_at', 'createdAt')
    ) as t(table_name, payload_key, column_name, field_name)
  loop
    execute format($q$
      with src as (
        select e ->> 'id' as lid, public._import_ts(e ->> %2$L) as ts from jsonb_array_elements($1) e where e ->> 'id' is not null
      ), upd as (
        update public.%1$I t set %3$I = s.ts from src s
         where t.owner_id = $2 and t.legacy_mobile_id = s.lid and s.ts is not null
           and t.id in (select row_id from public._import_inserted_ids($3, %1$L))
        returning t.*
      )
      update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
        from upd u where rs.import_run_id = $3 and rs.table_name = %1$L and rs.row_id = u.id
    $q$, v_spec.table_name, v_spec.field_name, v_spec.column_name)
    using public._import_arr(p_payload, v_spec.payload_key), p_owner, p_run_id;
  end loop;

  -- Excepciones de series: se identifican por serie + ocurrencia.
  with upd as (
    update public.recurrence_exceptions x set created_at = s.ts
      from (
        select rr.id as rid, e ->> 'occurrenceKey' as k, public._import_ts(e ->> 'createdAt') as ts
          from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceExceptions')) e
          join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = e ->> 'recurrenceId'
      ) s
     where x.owner_id = p_owner and x.recurrence_id = s.rid and x.occurrence_key = s.k and s.ts is not null
       and x.id in (select row_id from public._import_inserted_ids(p_run_id, 'recurrence_exceptions'))
    returning x.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'recurrence_exceptions' and rs.row_id = u.id;

  -- 4.9) Primer mes proporcional: series y versión de regla con las que se decidió.
  with upd as (
    update public.first_month_proration_decisions d set
        recurrence_ids = case when jsonb_typeof(e -> 'recurrenceIds') = 'array' then public._import_text_array(e -> 'recurrenceIds') end,
        series_pattern_snapshot = case when jsonb_typeof(e -> 'seriesPatternSnapshot') in ('object', 'array') then e -> 'seriesPatternSnapshot' end,
        rule_version = case when jsonb_typeof(e -> 'ruleVersion') = 'number' then round((e ->> 'ruleVersion')::numeric)::int end
      from jsonb_array_elements(public._import_arr(p_payload, 'firstMonthProrationDecisions')) e
     where d.owner_id = p_owner and d.legacy_mobile_id = e ->> 'id'
       and d.id in (select row_id from public._import_inserted_ids(p_run_id, 'first_month_proration_decisions'))
    returning d.*
  )
  update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
    from upd u where rs.import_run_id = p_run_id and rs.table_name = 'first_month_proration_decisions' and rs.row_id = u.id;

  -- 4.10) Perfil de la profesora: avance del tutorial y fecha de creación (sólo si el perfil lo creó esta importación).
  if jsonb_typeof(p_payload -> 'teacherProfile') = 'object' then
    with upd as (
      update public.teacher_profiles tp set
          completed_tutorial_version = case when jsonb_typeof(p_payload -> 'teacherProfile' -> 'completedTutorialVersion') = 'number' then round((p_payload -> 'teacherProfile' ->> 'completedTutorialVersion')::numeric)::int end,
          tutorial_completed_at = public._import_ts(p_payload -> 'teacherProfile' ->> 'tutorialCompletedAt'),
          created_at = coalesce(public._import_ts(p_payload -> 'teacherProfile' ->> 'createdAt'), tp.created_at),
          source_updated_at = public._import_ts(p_payload -> 'teacherProfile' ->> 'updatedAt')
       where tp.owner_id = p_owner and p_owner in (select row_id from public._import_inserted_ids(p_run_id, 'teacher_profiles'))
      returning tp.*
    )
    update public.import_run_row_snapshots rs set new_row = to_jsonb(u)
      from upd u where rs.import_run_id = p_run_id and rs.table_name = 'teacher_profiles' and rs.row_id = u.owner_id;
  end if;

  -- 4.11) Reportes generados: el snapshot ya viene en el formato de la web (con el registro original adentro). El PDF se vincula al extraerlo del teléfono.
  with ins as (
    insert into public.report_records (owner_id, legacy_mobile_id, student_id, title, selected_months, period_start, period_end, generated_at, snapshot, schema_version)
      select p_owner, e ->> 'id', st.id, coalesce(e ->> 'title', ''), public._import_text_array(e -> 'selectedMonths'), (e ->> 'periodStart')::date, (e ->> 'periodEnd')::date,
             public._import_ts(e ->> 'generatedAt'), e -> 'snapshot', coalesce(round((e ->> 'schemaVersion')::numeric)::int, 1)
        from jsonb_array_elements(public._import_arr(p_payload, 'reportRecords')) e
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = e ->> 'studentId'
       where e ->> 'id' is not null and public._import_ts(e ->> 'generatedAt') is not null and jsonb_typeof(e -> 'snapshot') = 'object'
       order by e ->> 'id'
    on conflict (owner_id, legacy_mobile_id) do nothing
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'report_records', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;
revoke all on function public._import_apply_extras(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5) Archivos que sólo existen en el teléfono: biblioteca de materiales + datos locales + registro de cada archivo subido
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.import_phone_extraction(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_materials jsonb := public._import_arr(p_payload, 'materials');
  v_inserted int := 0;
  v_total int := 0;
  v_device_id uuid;
  v_sha text;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'La extracción no tiene el formato esperado.' using errcode = '22023'; end if;
  if pg_column_size(p_payload) > 5242880 then raise exception 'La extracción es demasiado grande.' using errcode = '22023'; end if;
  v_total := jsonb_array_length(v_materials);
  if v_total > 5000 then raise exception 'La extracción tiene demasiados materiales.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(v_materials) m where jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m -> 'id') is distinct from 'string' or btrim(m ->> 'id') = '') then
    raise exception 'La extracción no tiene el formato esperado.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('phone_extraction:' || v_owner::text));

  with ins as (
    insert into public.material_library_items (owner_id, legacy_mobile_id, name, note, created_at, attachment_name, attachment_kind, attachment_mime_type, attachment_size_bytes,
                                               attachment_caption, attachment_added_at, attachment_source_uri, file_status)
      select v_owner, m ->> 'id', coalesce(m ->> 'name', ''), m ->> 'note', public._import_ts(m ->> 'createdAt'),
             a ->> 'name', case when a is null then null when a ->> 'kind' = 'image' then 'image' else 'pdf' end, a ->> 'mimeType',
             case when jsonb_typeof(a -> 'sizeBytes') = 'number' then (a ->> 'sizeBytes')::numeric::bigint end, a ->> 'caption', public._import_ts(a ->> 'addedAt'), a ->> 'uri',
             case when a is null then 'sin_archivo' else 'pendiente' end
        from jsonb_array_elements(v_materials) m
        cross join lateral (select case when jsonb_typeof(m -> 'attachment') = 'object' then m -> 'attachment' end as a) x
    on conflict (owner_id, legacy_mobile_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  if jsonb_typeof(p_payload -> 'deviceLocal') = 'object' then
    v_sha := encode(sha256(convert_to((p_payload -> 'deviceLocal')::text, 'UTF8')), 'hex');
    insert into public.device_local_snapshots (owner_id, payload, sha256) values (v_owner, p_payload -> 'deviceLocal', v_sha)
      on conflict (owner_id, sha256) do nothing returning id into v_device_id;
  end if;

  return jsonb_build_object('materials_received', v_total, 'materials_inserted', v_inserted, 'materials_already_present', v_total - v_inserted, 'device_snapshot_saved', v_device_id is not null);
end;
$$;
revoke all on function public.import_phone_extraction(jsonb) from public, anon;
grant execute on function public.import_phone_extraction(jsonb) to authenticated;

-- El teléfono ya no tiene el archivo (se borró o se movió): se deja constancia para que no figure como «pendiente» para siempre.
create or replace function public.mark_transfer_file_unavailable(p_kind text, p_legacy_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_rows int := 0;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if p_kind = 'lesson_attachment' then
    update public.lesson_attachments set file_status = 'no_disponible' where owner_id = v_owner and legacy_mobile_id = p_legacy_id and file_status = 'pendiente';
    get diagnostics v_rows = row_count;
  elsif p_kind = 'material' then
    update public.material_library_items set file_status = 'no_disponible' where owner_id = v_owner and legacy_mobile_id = p_legacy_id and file_status = 'pendiente';
    get diagnostics v_rows = row_count;
  else
    raise exception 'Tipo de archivo desconocido.' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', p_kind, 'marked', v_rows);
end;
$$;
revoke all on function public.mark_transfer_file_unavailable(text, text) from public, anon;
grant execute on function public.mark_transfer_file_unavailable(text, text) to authenticated;

create or replace function public.record_phone_extraction_result(p_summary jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if jsonb_typeof(p_summary) is distinct from 'object' or pg_column_size(p_summary) > 1048576 then raise exception 'El resultado de la extracción no tiene el formato esperado.' using errcode = '22023'; end if;
  insert into public.phone_extraction_results (owner_id, summary) values (v_owner, p_summary) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_phone_extraction_result(jsonb) from public, anon;
grant execute on function public.record_phone_extraction_result(jsonb) to authenticated;

create or replace function public.register_transfer_file(p_kind text, p_legacy_id text, p_path text, p_sha256 text, p_size bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_bucket text;
  v_expected text;
  v_stored bigint;
  v_rows int;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if p_kind not in ('lesson_attachment', 'material', 'report_pdf') then raise exception 'Tipo de archivo desconocido.' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'La huella del archivo no es válida.' using errcode = '22023'; end if;
  if p_size is null or p_size < 0 or p_size > 20971520 then raise exception 'El tamaño del archivo no es válido.' using errcode = '22023'; end if;
  if p_path is null or p_path like '%..%' or split_part(p_path, '/', 1) <> v_owner::text then raise exception 'La ruta del archivo no es válida.' using errcode = '22023'; end if;

  if p_kind = 'report_pdf' then
    v_bucket := 'report-pdfs';
    select format('%s/%s/%s.pdf', v_owner, r.student_id, r.id) into v_expected from public.report_records r where r.owner_id = v_owner and r.legacy_mobile_id = p_legacy_id;
    if v_expected is null then raise exception 'No se encontró el reporte.' using errcode = 'P0002'; end if;
    if p_path <> v_expected then raise exception 'La ruta del archivo no corresponde al reporte.' using errcode = '22023'; end if;
  else
    v_bucket := 'lesson-files';
  end if;

  -- El archivo tiene que existir DE VERDAD en el almacenamiento (nunca se registra algo que no se subió) y, si el almacenamiento informa el tamaño, coincidir.
  select (o.metadata ->> 'size')::bigint into v_stored from storage.objects o where o.bucket_id = v_bucket and o.name = p_path;
  if not found then raise exception 'El archivo todavía no está en el almacenamiento.' using errcode = 'P0002'; end if;
  if v_stored is not null and v_stored <> p_size then raise exception 'El tamaño del archivo subido no coincide.' using errcode = '22023'; end if;

  if p_kind = 'report_pdf' then
    update public.report_records set pdf_url = p_path where owner_id = v_owner and legacy_mobile_id = p_legacy_id;
    get diagnostics v_rows = row_count;
    -- Registrar el archivo es parte del traslado: la instantánea de la importación se actualiza, así deshacer sigue siendo seguro (el objeto del almacenamiento no se borra).
    update public.import_run_row_snapshots rs set new_row = to_jsonb(t)
      from public.report_records t, public.import_runs ir
     where t.owner_id = v_owner and t.legacy_mobile_id = p_legacy_id and rs.table_name = 'report_records' and rs.row_id = t.id and rs.action = 'inserted'
       and ir.id = rs.import_run_id and ir.owner_id = v_owner and ir.status = 'applied';
  elsif p_kind = 'lesson_attachment' then
    update public.lesson_attachments set storage_path = p_path, sha256 = p_sha256, stored_size_bytes = p_size, file_status = 'disponible' where owner_id = v_owner and legacy_mobile_id = p_legacy_id;
    get diagnostics v_rows = row_count;
    update public.import_run_row_snapshots rs set new_row = to_jsonb(t)
      from public.lesson_attachments t, public.import_runs ir
     where t.owner_id = v_owner and t.legacy_mobile_id = p_legacy_id and rs.table_name = 'lesson_attachments' and rs.row_id = t.id and rs.action = 'inserted'
       and ir.id = rs.import_run_id and ir.owner_id = v_owner and ir.status = 'applied';
  else
    update public.material_library_items set storage_path = p_path, sha256 = p_sha256, stored_size_bytes = p_size, file_status = 'disponible'
      where owner_id = v_owner and legacy_mobile_id = p_legacy_id and file_status <> 'sin_archivo';
  end if;
  if p_kind = 'material' then get diagnostics v_rows = row_count; end if;
  if v_rows = 0 then raise exception 'No se encontró el elemento al que pertenece el archivo.' using errcode = 'P0002'; end if;
  return jsonb_build_object('kind', p_kind, 'registered', true);
end;
$$;
revoke all on function public.register_transfer_file(text, text, text, text, bigint) from public, anon;
grant execute on function public.register_transfer_file(text, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6) Funciones redefinidas (misma firma y resultado; sólo cambia lo marcado como R10)
-- ---------------------------------------------------------------------------------------------------------------------
-- _import_check_payload: las filas anidadas nuevas (adjuntos, historial de ediciones, participantes) cuentan para el límite de trabajo.
create or replace function public._import_check_payload(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lim jsonb := public._import_limits();
  v_collections text[] := array['students','pedagogicalLessons','calendarLessons','recurrenceRules','recurrenceExceptions','paymentCharges','payments','paymentAllocations','paymentAdjustments','reportRecords','packagePurchases','packageCreditMovements','monthlyAmountCorrections','initialPaidSurchargeCorrections','firstMonthProrationDecisions','trainingBillingAgreements','customLevels'];
  v_key text;
  v_val jsonb;
  v_len integer;
  v_total integer := 0;
  v_nested integer := 0;
  v_bad integer;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
  end if;

  foreach v_key in array v_collections loop
    v_val := p_payload -> v_key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) <> 'array' then
      raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
    end if;
    v_len := jsonb_array_length(v_val);
    if v_len > (v_lim ->> 'max_rows_per_collection')::int then
      raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
    end if;
    v_total := v_total + v_len;
    if v_total > (v_lim ->> 'max_rows_total')::int then
      raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
    end if;
    -- Cada elemento debe ser un objeto con `id` de texto (menos las excepciones de series, que se identifican por serie + ocurrencia).
    if v_key = 'recurrenceExceptions' then
      select count(*) into v_bad from jsonb_array_elements(v_val) e where jsonb_typeof(e) is distinct from 'object';
    else
      select count(*) into v_bad from jsonb_array_elements(v_val) e
        where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'id') is distinct from 'string' or btrim(e ->> 'id') = '';
    end if;
    if v_bad > 0 then
      raise exception 'El backup no tiene el formato esperado.' using errcode = '22023';
    end if;
  end loop;

  -- Referencias obligatorias entre filas financieras: una asignación sin pago o sin cobro, un ajuste sin cobro o un movimiento sin paquete
  -- no se pueden relacionar con nada (antes terminaban en un error interno al analizar).
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'paymentAllocations')) e
    where jsonb_typeof(e -> 'paymentId') is distinct from 'string' or jsonb_typeof(e -> 'chargeId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'paymentAdjustments')) e where jsonb_typeof(e -> 'chargeId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'packageCreditMovements')) e where jsonb_typeof(e -> 'packageId') is distinct from 'string';
  if v_bad > 0 then raise exception 'El backup no tiene el formato esperado.' using errcode = '22023'; end if;

  -- Filas anidadas que la cuenta de arriba no ve (lo que realmente se escribe además de las filas principales).
  select coalesce(sum(public._import_len(e -> 'participants')), 0) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'calendarLessons')) e;
  v_nested := v_nested + v_bad;
  select coalesce(sum(public._import_len(e -> 'participantStudentIds')), 0) into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'recurrenceRules')) e;
  v_nested := v_nested + v_bad;
  select coalesce(sum(public._import_len(e -> 'roster') + public._import_len(e -> 'attendance') + public._import_len(e -> 'evaluations') + public._import_len(e -> 'homeworkReviews')
                              + public._import_len(e -> 'attachments') + public._import_len(e -> 'editHistory') + public._import_len(e -> 'participantProgress')), 0)
    into v_bad from jsonb_array_elements(public._import_arr(p_payload, 'pedagogicalLessons')) e;
  v_nested := v_nested + v_bad;
  if jsonb_typeof(p_payload -> 'profiles') = 'object' then
    select coalesce(sum(public._import_len(p.value -> 'levelHistory')), 0) into v_bad from jsonb_each(p_payload -> 'profiles') p where jsonb_typeof(p.value) = 'object';
    v_nested := v_nested + v_bad;
  end if;

  if v_nested > (v_lim ->> 'max_nested_rows')::int or v_total + v_nested > (v_lim ->> 'max_work_units')::int then
    raise exception 'El backup tiene demasiados datos para importar de una vez.' using errcode = '22023';
  end if;

  return jsonb_build_object('counted_rows', v_total, 'nested_rows', v_nested, 'work_units', v_total + v_nested);
end;
$$;

-- _import_apply_histories: conserva la entrada ORIGINAL de cada historial (estado: payload_snapshot; precio: source_entry).
create or replace function public._import_apply_histories(p_run_id uuid, p_owner uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profiles jsonb := case when jsonb_typeof(p_payload -> 'profiles') = 'object' then p_payload -> 'profiles' else '{}'::jsonb end;
  v_corr jsonb := public._import_arr(p_payload, 'monthlyAmountCorrections');
begin
  -- Historial de estados: sólo de los alumnos agregados en ESTA corrida (los que ya existían en la web conservan el suyo; nunca se duplica).
  with src as (
    select st.id as student_id, e.entry ->> 'status' as status, (e.entry ->> 'date')::date as occurred_on, e.entry ->> 'reason' as reason, e.entry ->> 'internalNote' as internal_note, e.entry -> 'sourceEntry' as payload_snapshot, e.ord
      from _ia_stu s
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.lid
      cross join lateral jsonb_array_elements(case when jsonb_typeof(v_profiles -> s.lid -> 'statusHistory') = 'array' then v_profiles -> s.lid -> 'statusHistory' else '[]'::jsonb end) with ordinality as e(entry, ord)
     where e.entry ->> 'status' is not null and e.entry ->> 'date' is not null
  ), ins as (
    insert into public.student_status_history (owner_id, student_id, status, occurred_on, reason, internal_note, payload_snapshot)
      select p_owner, student_id, status, occurred_on, reason, internal_note, payload_snapshot from src order by student_id, ord
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_status_history', i.id, 'inserted', null, to_jsonb(i) from ins i;

  with src as (
    select st.id as student_id, (e.entry ->> 'price')::numeric as price, (e.entry ->> 'date')::date as effective_on, e.entry -> 'sourceEntry' as source_entry, e.ord
      from _ia_stu s
      join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.lid
      cross join lateral jsonb_array_elements(case when jsonb_typeof(v_profiles -> s.lid -> 'priceHistory') = 'array' then v_profiles -> s.lid -> 'priceHistory' else '[]'::jsonb end) with ordinality as e(entry, ord)
     where e.entry ->> 'price' is not null and e.entry ->> 'date' is not null
  ), ins as (
    insert into public.student_price_history (owner_id, student_id, price, effective_on, source_entry)
      select p_owner, student_id, price, effective_on, source_entry from src order by student_id, ord
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'student_price_history', i.id, 'inserted', null, to_jsonb(i) from ins i;

  -- Correcciones de importe mensual (auditoría): por identificador de origen, una sola vez; sólo si el alumno ya existe en la web.
  with src as (
    select distinct on (x.r ->> 'id') x.r ->> 'id' as lid, x.r as r
      from jsonb_array_elements(v_corr) with ordinality as x(r, ord) where x.r ->> 'id' is not null order by x.r ->> 'id', x.ord
  ), ins as (
    insert into public.monthly_amount_corrections (owner_id, legacy_mobile_id, student_id, billing_period, previous_amount, new_amount, changed_at, reason, effective_from)
      select p_owner, s.lid, st.id, s.r ->> 'billingPeriod', (s.r ->> 'previousAmount')::numeric, (s.r ->> 'newAmount')::numeric,
             coalesce((s.r ->> 'changedAt')::timestamptz, now()), coalesce(s.r ->> 'reason', ''), s.r ->> 'effectiveFrom'
        from src s
        join public.students st on st.owner_id = p_owner and st.legacy_mobile_id = s.r ->> 'studentId'
       where s.r ->> 'billingPeriod' is not null and not exists (select 1 from public.monthly_amount_corrections w where w.owner_id = p_owner and w.legacy_mobile_id = s.lid)
    returning *
  )
  insert into public.import_run_row_snapshots (import_run_id, table_name, row_id, action, previous_row, new_row)
    select p_run_id, 'monthly_amount_corrections', i.id, 'inserted', null, to_jsonb(i) from ins i;
end;
$$;

-- _import_undo_analyze: compara la fila viva SÓLO con las columnas que tenía cuando se importó (una importación hecha antes de R10 sigue pudiéndose deshacer
-- aunque la tabla haya ganado columnas).
create or replace function public._import_undo_analyze(p_run_id uuid, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tbl text;
  v_key text;
  v_rel record;
  v_unsafe jsonb;
begin
  drop table if exists _iu_state;
  drop table if exists _iu_blockers;
  create temporary table _iu_state (table_name text not null, row_id uuid not null, action text not null, ok boolean not null) on commit drop;
  create temporary table _iu_blockers (parent_table text not null, parent_id uuid not null, child_table text not null, child_id uuid) on commit drop;

  -- 1) ¿La fila misma cambió desde que la importación la escribió? (una consulta por tabla; huella canónica de la fila viva vs. la de la instantánea)
  for v_tbl in select distinct s.table_name from public.import_run_row_snapshots s where s.import_run_id = p_run_id loop
    v_key := public._import_row_key(v_tbl);
    if v_key is null then raise exception 'Tabla no reconocida al deshacer.'; end if;
    -- Se une SÓLO por la clave de la fila (el dueño se comprueba después, en el CASE): con el dueño dentro del JOIN y sin estadísticas de las filas
    -- recién importadas el planificador elegía un lazo anidado de cientos de miles de comparaciones.
    execute format(
      'insert into _iu_state (table_name, row_id, action, ok)
         select s.table_name, s.row_id, s.action,
                case when t.owner_id is distinct from $2 then false else public._fingerprint_canonical(%L, public._import_project_row(to_jsonb(t), s.new_row)) = public._fingerprint_canonical(%L, s.new_row) end
           from public.import_run_row_snapshots s
           left join public.%I t on t.%I = s.row_id
          where s.import_run_id = $1 and s.table_name = %L',
      v_tbl, v_tbl, v_tbl, v_key, v_tbl) using p_run_id, p_owner;
  end loop;
  create index on _iu_state (table_name, row_id);

  -- 2) Dependencias ajenas a la importación sobre las filas «padre» agregadas y sin cambios (una consulta por relación).
  for v_rel in select * from public._import_undo_relations() loop
    execute format(
      'insert into _iu_blockers (parent_table, parent_id, child_table, child_id)
         select %L, p.row_id, %L, c.id
           from _iu_state p
           join public.%I c on c.%I = p.row_id
           left join _iu_state cs on cs.table_name = %L and cs.row_id = c.id and cs.action = ''inserted''
          where p.table_name = %L and p.action = ''inserted'' and p.ok and (cs.row_id is null or not cs.ok)',
      v_rel.parent_table, v_rel.child_table, v_rel.child_table, v_rel.fk_column, v_rel.child_table, v_rel.parent_table);
  end loop;
  -- `report_draft_claims` no tiene `id`: su sola existencia ya significa «hay un reporte en curso para este alumno».
  insert into _iu_blockers (parent_table, parent_id, child_table, child_id)
    select 'students', p.row_id, 'report_draft_claims', null
      from _iu_state p
     where p.table_name = 'students' and p.action = 'inserted' and p.ok
       and exists (select 1 from public.report_draft_claims d where d.student_id = p.row_id);

  select coalesce(jsonb_agg(u.entry), '[]'::jsonb) into v_unsafe from (
    select jsonb_build_object('table_name', s.table_name, 'row_id', s.row_id, 'reason', 'editada después de la importación') as entry
      from _iu_state s where not s.ok
    union all
    select jsonb_build_object(
             'table_name', b.parent_table, 'row_id', b.parent_id,
             'reason', 'tiene datos creados después de la importación que dependen de ella',
             'blocking_children', jsonb_agg(case when b.child_table = 'report_draft_claims'
                then jsonb_build_object('table_name', b.child_table, 'row_id', null, 'reason', 'hay un reporte en curso para este alumno')
                else jsonb_build_object('table_name', b.child_table, 'row_id', b.child_id) end))
      from _iu_blockers b group by b.parent_table, b.parent_id
  ) u;
  return v_unsafe;
end;
$$;

-- _import_row_key / _import_undo_relations: las tablas nuevas que escribe la importación (el historial de ediciones sigue tratándose aparte, como en el registro auditado).
create or replace function public._import_row_key(p_table_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_table_name
    when 'teacher_profiles' then 'owner_id' when 'budget_distribution_settings' then 'owner_id' when 'teacher_availability' then 'owner_id' when 'surcharge_settings' then 'owner_id'
    when 'students' then 'id' when 'custom_levels' then 'id' when 'training_billing_agreements' then 'id' when 'student_level_history' then 'id'
    when 'recurrence_rules' then 'id' when 'recurrence_rule_participants' then 'id' when 'recurrence_exceptions' then 'id'
    when 'calendar_lessons' then 'id' when 'calendar_lesson_participants' then 'id'
    when 'lesson_registrations' then 'id' when 'lesson_registration_students' then 'id' when 'lesson_registration_attendance' then 'id'
    when 'lesson_registration_evaluations' then 'id' when 'lesson_registration_homework_reviews' then 'id'
    when 'package_purchases' then 'id' when 'package_credit_movements' then 'id'
    when 'payment_charges' then 'id' when 'payments' then 'id' when 'payment_allocations' then 'id' when 'payment_adjustments' then 'id'
    when 'initial_paid_surcharge_corrections' then 'id' when 'first_month_proration_decisions' then 'id'
    when 'student_status_history' then 'id' when 'student_price_history' then 'id' when 'monthly_amount_corrections' then 'id'
    when 'report_records' then 'id' when 'lesson_attachments' then 'id' when 'lesson_registration_edit_history' then 'id' when 'student_source_extras' then 'id'
  end
$$;

create or replace function public._import_undo_relations()
returns table(parent_table text, child_table text, fk_column text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('students', 'student_status_history', 'student_id'), ('students', 'student_level_history', 'student_id'), ('students', 'student_price_history', 'student_id'),
    ('students', 'recurrence_rule_participants', 'student_id'), ('students', 'calendar_lessons', 'primary_student_id'), ('students', 'calendar_lesson_participants', 'student_id'),
    ('students', 'lesson_registration_students', 'student_id'), ('students', 'lesson_registration_attendance', 'student_id'), ('students', 'lesson_registration_evaluations', 'student_id'),
    ('students', 'lesson_registration_homework_reviews', 'student_id'), ('students', 'payment_charges', 'student_id'), ('students', 'payments', 'student_id'),
    ('students', 'payment_allocations', 'student_id'), ('students', 'payment_adjustments', 'student_id'), ('students', 'package_purchases', 'student_id'),
    ('students', 'package_credit_movements', 'student_id'), ('students', 'monthly_amount_corrections', 'student_id'), ('students', 'initial_paid_surcharge_corrections', 'student_id'),
    ('students', 'first_month_proration_decisions', 'student_id'), ('students', 'report_records', 'student_id'), ('students', 'recurrence_rules', 'primary_student_id'),
    ('students', 'student_creation_claims', 'student_id'),
    ('training_billing_agreements', 'recurrence_rules', 'training_billing_agreement_id'), ('training_billing_agreements', 'payment_charges', 'training_billing_agreement_id'),
    ('recurrence_rules', 'recurrence_rule_participants', 'recurrence_rule_id'), ('recurrence_rules', 'recurrence_exceptions', 'recurrence_id'),
    ('recurrence_rules', 'calendar_lessons', 'recurrence_id'), ('recurrence_rules', 'recurrence_rules', 'supersedes_recurrence_id'), ('recurrence_rules', 'recurrence_rules', 'superseded_by_recurrence_id'),
    ('calendar_lessons', 'calendar_lesson_participants', 'calendar_lesson_id'), ('calendar_lessons', 'recurrence_exceptions', 'replacement_lesson_id'),
    ('calendar_lessons', 'lesson_registrations', 'calendar_lesson_id'), ('calendar_lessons', 'payment_charges', 'calendar_lesson_id'), ('calendar_lessons', 'calendar_lessons', 'freed_by_lesson_id'),
    ('lesson_registrations', 'lesson_registration_students', 'lesson_registration_id'), ('lesson_registrations', 'lesson_registration_attendance', 'lesson_registration_id'),
    ('lesson_registrations', 'lesson_registration_evaluations', 'lesson_registration_id'), ('lesson_registrations', 'lesson_registration_homework_reviews', 'lesson_registration_id'),
    ('lesson_registrations', 'payment_charges', 'saved_lesson_id'), ('lesson_registrations', 'package_credit_movements', 'saved_lesson_id'),
    ('lesson_registrations', 'lesson_registrations', 'rescheduled_from_registration_id'),
    ('lesson_registrations', 'lesson_attachments', 'lesson_registration_id'), ('students', 'lesson_attachments', 'student_id'), ('students', 'student_source_extras', 'student_id'),
    ('package_purchases', 'package_credit_movements', 'package_id'), ('package_purchases', 'payment_charges', 'package_id'),
    ('payment_charges', 'payment_allocations', 'charge_id'), ('payment_charges', 'payment_adjustments', 'charge_id'), ('payment_charges', 'first_month_proration_decisions', 'charge_id'),
    ('payments', 'payment_allocations', 'payment_id'), ('payments', 'payments', 'replaces_payment_id'),
    ('payments', 'initial_paid_surcharge_corrections', 'voided_payment_id'), ('payments', 'initial_paid_surcharge_corrections', 'new_payment_id')
  ) as t(parent_table, child_table, fk_column)
$$;

-- apply_backup_import: una llamada más (_import_apply_extras).
create or replace function public.apply_backup_import(p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb)
returns table(import_run_id uuid, summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_preview record;
  v_payload jsonb;
  v_run_id uuid;
  v_summary jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  -- ---- Fase 1: SIN lock de cuenta. Sólo lee la vista previa (inmutable) y prepara todo lo que se puede preparar antes. ----
  select ip.id, ip.status, ip.expires_at, ip.classification into v_preview from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner;
  if not found then raise exception 'El preview no existe o no te pertenece.'; end if;

  -- Reintento (respuesta perdida / doble clic): la importación ya se aplicó para esta vista previa → resultado canónico, cero escrituras.
  select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
  if found then
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  if v_preview.status <> 'pending' or v_preview.expires_at < now() then
    raise exception 'El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.';
  end if;

  perform public._import_validate_selection(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);
  select ip.normalized_payload into v_payload from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner;
  perform public._import_stage(v_owner, v_payload, v_preview.classification, p_field_overrides, p_duplicate_decisions);

  -- ---- Fase 2: lock de la cuenta (serializa importaciones y deshacer de la misma cuenta). Sólo cubre re-verificación + escritura. ----
  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select ip.id, ip.status, ip.expires_at, ip.backup_checksum, ip.schema_version, ip.app_version, ip.classification
    into v_preview from public.import_previews ip where ip.id = p_preview_id and ip.owner_id = v_owner for update;
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
    values (v_owner, p_preview_id, v_preview.backup_checksum, v_preview.schema_version, v_preview.app_version, '{}'::jsonb,
            coalesce(p_field_overrides, '[]'::jsonb), coalesce(p_duplicate_decisions, '[]'::jsonb), v_payload)
    on conflict (owner_id, preview_id) do nothing
    returning id into v_run_id;
  if v_run_id is null then
    select ir.id, ir.summary into v_run_id, v_summary from public.import_runs as ir where ir.owner_id = v_owner and ir.preview_id = p_preview_id;
    return query select v_run_id, v_summary || jsonb_build_object('replayed', true);
    return;
  end if;

  perform public._import_verify_fingerprints(p_preview_id, v_owner);

  -- Orden topológico (igual que antes): alumnos → niveles → perfil/presupuesto/disponibilidad → acuerdos → historial de niveles → recargos →
  -- series → clases → excepciones → registros → cobros.
  perform public._import_apply_students(v_run_id, v_owner, p_preview_id);
  perform public._import_apply_custom_levels(v_run_id, v_owner);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_profiles', v_payload -> 'teacherProfile', v_preview.classification -> 'maestros' -> 'teacher_profiles', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'budget_distribution_settings', v_payload -> 'budgetDistribution', v_preview.classification -> 'maestros' -> 'budget_distribution_settings', p_field_overrides);
  perform public._apply_singleton(v_run_id, v_owner, 'teacher_availability', v_payload -> 'teacherAvailability', v_preview.classification -> 'maestros' -> 'teacher_availability', p_field_overrides);
  perform public._import_apply_agreements(v_run_id, v_owner);
  perform public._import_apply_level_history(v_run_id, v_owner);
  perform public._apply_surcharge_settings(v_run_id, v_owner, v_payload, v_preview.classification);
  perform public._import_apply_recurrence_rules(v_run_id, v_owner);
  perform public._import_apply_calendar_lessons(v_run_id, v_owner);
  perform public._import_apply_recurrence_exceptions(v_run_id, v_owner);
  perform public._import_apply_lesson_registrations(v_run_id, v_owner);
  perform public._import_apply_financial(v_run_id, v_owner);
  -- R9: historiales de estado y de precio de los alumnos agregados + correcciones de importe mensual (antes se descartaban).
  perform public._import_apply_histories(v_run_id, v_owner, v_payload);
  -- R10: contenido pedagógico, estado de registros grupales, fechas originales, historial de ediciones, adjuntos, reportes y extras (antes sólo quedaban en el archivo).
  perform public._import_apply_extras(v_run_id, v_owner, v_payload);

  perform public._import_validate_invariants(v_run_id, v_owner);

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

-- apply_undo_backup_import: las tablas nuevas entran al orden de borrado.
create or replace function public.apply_undo_backup_import(p_undo_preview_id uuid)
returns table(summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_undo_preview public.import_undo_previews%rowtype;
  v_run public.import_runs%rowtype;
  v_unsafe jsonb;
  v_reverse_order text[] := array[
    'package_credit_movements','first_month_proration_decisions','initial_paid_surcharge_corrections','payment_adjustments','payment_allocations',
    'payment_charges','payments','package_purchases',
    'report_records','lesson_attachments','lesson_registration_edit_history','student_source_extras',
    'lesson_registration_homework_reviews','lesson_registration_evaluations','lesson_registration_attendance','lesson_registration_students','lesson_registrations',
    'recurrence_exceptions','calendar_lesson_participants','calendar_lessons','recurrence_rule_participants','recurrence_rules',
    'surcharge_settings','student_level_history','training_billing_agreements',
    'teacher_availability','budget_distribution_settings','teacher_profiles','custom_levels',
    'student_status_history','student_price_history','monthly_amount_corrections','students'
  ];
  v_table text;
  v_restored_count int;
  v_deleted_count int;
  v_summary jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.'; end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_undo_preview from public.import_undo_previews where id = p_undo_preview_id and owner_id = v_owner for update;
  if not found then raise exception 'El preview de undo no existe o no te pertenece.'; end if;

  -- Reintento (respuesta perdida / doble clic / segunda llamada simultánea): el undo ya se aplicó para este preview — resultado canónico, cero escrituras.
  if v_undo_preview.status = 'applied' then
    select * into v_run from public.import_runs where id = v_undo_preview.import_run_id and owner_id = v_owner;
    if found and v_run.status = 'undone' then
      return query select coalesce(v_run.undo_summary, '{}'::jsonb) || jsonb_build_object('replayed', true);
      return;
    end if;
  end if;

  if v_undo_preview.status <> 'pending' or v_undo_preview.expires_at < now() then
    raise exception 'El preview de undo ya no es válido. Generá uno nuevo con preview_undo_backup_import.';
  end if;

  select * into v_run from public.import_runs where id = v_undo_preview.import_run_id and owner_id = v_owner for update;
  if not found or v_run.status <> 'applied' then raise exception 'Esta importación ya no puede deshacerse.'; end if;
  if v_run.snapshots_purged_at is not null then
    raise exception 'Ya renunciaste a poder deshacer esta importación.';
  end if;

  -- Re-verificación COMPLETA bajo el lock, nunca confía en `is_safe` de la fase 1.
  v_unsafe := public._import_undo_analyze(v_run.id, v_owner);
  if exists (select 1 from _iu_state where not ok) then
    raise exception 'Una fila cambió desde el preview de undo — deshacer bloqueado por completo, no se tocó nada. Generá un preview de undo nuevo.';
  end if;
  if exists (select 1 from _iu_blockers) then
    raise exception 'Una fila tiene dependencias creadas después de la importación — deshacer bloqueado por completo, no se tocó nada.';
  end if;

  select count(*) filter (where action = 'inserted'), count(*) filter (where action in ('field_overwritten', 'identity_linked'))
    into v_deleted_count, v_restored_count from public.import_run_row_snapshots where import_run_id = v_run.id;

  -- Todo verificado limpio: borra en orden inverso real, tabla por tabla (una sentencia por tabla; las referencias entre filas de la MISMA tabla se
  -- comprueban al final de la sentencia, así que el orden dentro de la tabla no importa).
  foreach v_table in array v_reverse_order loop
    execute format(
      'delete from public.%I t using public.import_run_row_snapshots s
        where s.import_run_id = $1 and s.table_name = %L and s.action = ''inserted'' and t.%I = s.row_id and t.owner_id = $2',
      v_table, v_table, public._import_row_key(v_table)) using v_run.id, v_owner;
  end loop;

  -- Restauración de lo que la importación sólo MODIFICÓ (reemplazos de campos y vínculos de identidad). Si una fila tiene dos instantáneas
  -- (vínculo + reemplazo) se restaura al estado ANTERIOR a la importación: el vínculo es siempre el primero.
  update public.students st set
      name = coalesce(sp.prev ->> 'name', st.name), phone = sp.prev ->> 'phone', whatsapp = sp.prev ->> 'whatsapp',
      email = sp.prev ->> 'email', notes = sp.prev ->> 'notes', birth_date = (sp.prev ->> 'birth_date')::date,
      current_goals = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'current_goals', '[]'::jsonb))),
      strengths = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'strengths', '[]'::jsonb))),
      areas_to_improve = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'areas_to_improve', '[]'::jsonb))),
      alerts = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'alerts', '[]'::jsonb))),
      usual_days = array(select jsonb_array_elements_text(coalesce(sp.prev -> 'usual_days', '[]'::jsonb))),
      usual_time = sp.prev ->> 'usual_time', legacy_mobile_id = sp.prev ->> 'legacy_mobile_id'
    from (
      select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
       where s.import_run_id = v_run.id and s.table_name = 'students' and s.action in ('field_overwritten', 'identity_linked')
       order by s.row_id, (s.action = 'identity_linked') desc
    ) sp
   where st.id = sp.row_id and st.owner_id = v_owner;

  update public.custom_levels cl set name = sp.prev ->> 'name'
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'custom_levels' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where cl.id = sp.row_id and cl.owner_id = v_owner;

  update public.teacher_profiles tp set display_name = coalesce(sp.prev ->> 'display_name', '')
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'teacher_profiles' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where tp.owner_id = sp.row_id and tp.owner_id = v_owner;

  update public.budget_distribution_settings b set
      needs_percent = (sp.prev ->> 'needs_percent')::smallint, wants_percent = (sp.prev ->> 'wants_percent')::smallint, savings_percent = (sp.prev ->> 'savings_percent')::smallint,
      savings_goal_enabled = coalesce((sp.prev ->> 'savings_goal_enabled')::boolean, false), savings_goal_target_amount = (sp.prev ->> 'savings_goal_target_amount')::numeric,
      savings_goal_target_date = (sp.prev ->> 'savings_goal_target_date')::date
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'budget_distribution_settings' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where b.owner_id = sp.row_id and b.owner_id = v_owner;

  update public.teacher_availability ta set
      timezone = sp.prev ->> 'timezone', weekly_blocks = coalesce(sp.prev -> 'weekly_blocks', '[]'::jsonb), exceptions = coalesce(sp.prev -> 'exceptions', '[]'::jsonb)
    from (select distinct on (s.row_id) s.row_id, s.previous_row as prev from public.import_run_row_snapshots s
           where s.import_run_id = v_run.id and s.table_name = 'teacher_availability' and s.action in ('field_overwritten', 'identity_linked') order by s.row_id) sp
   where ta.owner_id = sp.row_id and ta.owner_id = v_owner;

  v_summary := jsonb_build_object('deleted_rows', v_deleted_count, 'restored_rows', v_restored_count);

  update public.import_runs set status = 'undone', undone_at = now(), undo_summary = v_summary where id = v_run.id;
  update public.import_undo_previews set status = 'applied' where id = p_undo_preview_id;

  return query select v_summary || jsonb_build_object('replayed', false);
end;
$$;

