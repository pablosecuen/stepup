-- Fase 7 — Reportes: idempotencia real de creación de report_records
-- (con claim atómico server-side del borrador activo, vía RPC — nunca
-- mutación directa de las tablas de soporte) + bucket privado de Storage
-- para los PDF reales (reemplaza el `permanentPdfUri` local del móvil) +
-- limpieza reintentable de objetos huérfanos tras una eliminación.
-- Migración aditiva — nunca edita ninguna migración ya aplicada.

-- 1) `operation_id` real en cada reporte + índice único parcial: dos
--    filas nunca pueden compartir el mismo (owner_id, operation_id). El
--    operation_id en sí SIEMPRE nace server-side, dentro de las RPC de
--    más abajo — nunca lo manda el cliente.
alter table public.report_records
  add column if not exists operation_id uuid;

create unique index if not exists report_records_owner_operation_unique
  on public.report_records (owner_id, operation_id)
  where operation_id is not null;

-- Toda eliminación de un reporte debe pasar por `delete_report_record`
-- (más abajo), que además encola el PDF asociado para limpieza — un
-- DELETE directo lo dejaría huérfano sin ningún trabajo que lo rastree.
-- La política `report_records_owner_all` (Fase 1) sigue permitiendo
-- select/insert/update directos, que nunca se restringieron acá.
revoke delete on public.report_records from authenticated;

-- 2) Bucket privado para los PDF reales. Nunca público — el acceso real
--    siempre pasa por una URL firmada y temporal (createSignedUrl),
--    generada on-demand desde el servidor, nunca guardada en la fila
--    (`report_records.pdf_url` guarda únicamente el PATH privado del
--    objeto, nunca una URL). `on conflict ... do update` (en vez de `do
--    nothing`) garantiza que, aunque el bucket ya existiera de una corrida
--    previa, quede siempre con los atributos de seguridad esperados —
--    especialmente `public = false`, nunca heredado de un estado previo
--    distinto. Límite de 10 MB y sólo PDF — columnas reales confirmadas
--    contra `information_schema.columns` de `storage.buckets` antes de
--    escribir esto (`public`, `file_size_limit`, `allowed_mime_types`
--    existen de verdad en el esquema real del proyecto).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-pdfs', 'report-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

-- 3) RLS sobre storage.objects para este bucket — cada owner sólo puede
--    leer/escribir/eliminar objetos bajo su propio prefijo real
--    (`<owner_id>/...`), verificado contra el primer segmento del path
--    (`storage.foldername`), nunca confiando en el nombre de archivo que
--    envía el cliente sin validarlo contra `auth.uid()` real. `to
--    authenticated` explícito en las 4 — defensa en profundidad: aunque
--    `auth.uid()` ya sea NULL para `anon` (lo que de por sí hace que
--    `(storage.foldername(name))[1] = auth.uid()::text` nunca sea true),
--    la política ni siquiera se evalúa formalmente para roles fuera de
--    `authenticated`. Verificado además con consultas reales simulando
--    `anon` (ver ronda de verificación tras aplicar).
drop policy if exists report_pdfs_owner_select on storage.objects;
create policy report_pdfs_owner_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'report-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists report_pdfs_owner_insert on storage.objects;
create policy report_pdfs_owner_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'report-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists report_pdfs_owner_update on storage.objects;
create policy report_pdfs_owner_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'report-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'report-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists report_pdfs_owner_delete on storage.objects;
create policy report_pdfs_owner_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'report-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4) Claim atómico REAL (server-side, nunca localStorage NI mutación
--    directa desde el cliente) del borrador de generación de reporte
--    activo, por (owner_id, student_id). RLS habilitado SIN ninguna
--    policy para `authenticated` + `revoke all` explícito: la única forma
--    de tocar esta tabla es a través de las funciones `security definer`
--    de más abajo (que corren con los privilegios de su dueño, exento de
--    RLS). El `operation_id` nace acá (`default gen_random_uuid()`) —
--    nunca lo manda el cliente.
create table if not exists public.report_draft_claims (
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  operation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (owner_id, student_id)
);

create index if not exists report_draft_claims_owner_idx on public.report_draft_claims (owner_id);

alter table public.report_draft_claims enable row level security;
revoke all on public.report_draft_claims from authenticated, anon;

-- 5) Cola mínima y persistente de limpieza de PDFs huérfanos —
--    `delete_report_record` encola acá el path cuando borra una fila con
--    PDF, de forma atómica (misma transacción). El servidor intenta
--    borrar el objeto y sólo resuelve (borra) el trabajo después de
--    confirmar el borrado real en Storage — si Storage falla, el trabajo
--    queda pendiente y se reintenta en la próxima eliminación del mismo
--    owner (ver `lib/repositories/reports.ts`, `sweepPendingReportPdfCleanupJobs`).
--    Mismo bloqueo que `report_draft_claims`: sin mutación directa para
--    `authenticated`, sólo vía las RPC de más abajo.
create table if not exists public.report_pdf_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  pdf_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists report_pdf_cleanup_jobs_owner_idx on public.report_pdf_cleanup_jobs (owner_id);

alter table public.report_pdf_cleanup_jobs enable row level security;
revoke all on public.report_pdf_cleanup_jobs from authenticated, anon;

-- Las 5 RPC de acá abajo son `security definer` con `set search_path = ''`
-- (nunca `public`): corren con los privilegios de su dueño pero SIN ningún
-- schema implícito, así que toda referencia debe estar calificada
-- explícitamente (`public.report_records`, `auth.uid()`,
-- `pg_catalog.gen_random_uuid()`/`pg_catalog.now()`) — cierra por completo
-- cualquier posibilidad de que un schema con permiso de escritura para
-- `authenticated` (aunque hoy no exista ninguno así) pudiera sombrear un
-- nombre no calificado y alterar el comportamiento de una función que
-- corre con privilegios elevados.

-- 6) RPC: reclama (o reutiliza) el borrador activo para este alumno.
--    Atómico vía `insert ... on conflict ... do update ... returning`:
--    dos llamadas concurrentes sobre el MISMO (owner_id, student_id)
--    serializan en el motor real de Postgres (la segunda espera a que la
--    primera termine su statement) y ambas terminan devolviendo el MISMO
--    operation_id — nunca una secuencia simulada en TypeScript. Usada
--    SIEMPRE por `generateStudentReportAction`: una respuesta perdida y
--    un reintento posterior reclaman el mismo borrador y por lo tanto
--    terminan en el mismo report_records (idempotencia real de
--    `createReportRecord` por operation_id).
create or replace function public.claim_report_draft(p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_operation_id uuid;
begin
  if v_owner_id is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  if not exists (select 1 from public.students s where s.id = p_student_id and s.owner_id = v_owner_id) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;

  insert into public.report_draft_claims (owner_id, student_id)
  values (v_owner_id, p_student_id)
  on conflict (owner_id, student_id) do update set owner_id = report_draft_claims.owner_id
  returning operation_id into v_operation_id;

  return v_operation_id;
end;
$$;

revoke all on function public.claim_report_draft(uuid) from public;
grant execute on function public.claim_report_draft(uuid) to authenticated;

-- 7) RPC: transición EXPLÍCITA para empezar una generación nueva —
--    idealmente disparada cuando la usuaria elige armar otro reporte,
--    nunca automáticamente apenas llega una respuesta exitosa. Rota el
--    operation_id SÓLO si el claim actual ya tiene un report_records
--    completo (con PDF real); si sigue en curso, devuelve el mismo — un
--    claim en curso nunca se rota. El `insert ... on conflict ... do
--    update` inicial ya adquiere el lock de fila real (cualquier otra
--    llamada concurrente sobre el mismo owner_id+student_id queda
--    bloqueada hasta que ESTA función termine su transacción), así que
--    dos llamadas simultáneas sobre un claim completo SIEMPRE convergen
--    en el mismo UUID nuevo: la segunda, tras destrabarse, relee la fila
--    YA rotada por la primera, ve que ese nuevo operation_id todavía no
--    tiene reporte, y lo devuelve tal cual — nunca vuelve a rotar.
--
--    Devuelve también `transition` — el llamador (la UI) SÓLO puede
--    limpiar el formulario cuando la transición permitió realmente
--    empezar otro reporte:
--      'created'     -> no existía ningún claim, se creó uno nuevo.
--      'rotated'     -> el claim tenía un reporte completo, se rotó a un
--                        operation_id nuevo — ESTE llamado inició la
--                        transición.
--      'in_progress' -> el claim actual sigue en curso (sin reporte
--                        completo), nunca se rotó — puede ser un claim
--                        recién creado por OTRA llamada concurrente que
--                        ganó la carrera (ver más abajo) o una
--                        generación real todavía corriendo.
--    Bajo dos llamadas concurrentes sobre un claim completo: la primera
--    en tomar el lock rota y devuelve 'rotated'; la segunda, al
--    destrabarse, ve el operation_id YA rotado sin reporte todavía y
--    devuelve 'in_progress' — ambas devuelven el MISMO operation_id
--    nuevo, sólo difiere quién "causó" la transición.
create or replace function public.start_new_report_draft(p_student_id uuid)
returns table(operation_id uuid, transition text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_operation_id uuid;
  v_claim_existed boolean;
  v_has_completed_report boolean;
begin
  if v_owner_id is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  if not exists (select 1 from public.students s where s.id = p_student_id and s.owner_id = v_owner_id) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;

  select exists(
    select 1 from public.report_draft_claims rdc where rdc.owner_id = v_owner_id and rdc.student_id = p_student_id
  ) into v_claim_existed;

  insert into public.report_draft_claims (owner_id, student_id)
  values (v_owner_id, p_student_id)
  on conflict (owner_id, student_id) do update set owner_id = report_draft_claims.owner_id;

  select rdc.operation_id into v_operation_id
  from public.report_draft_claims rdc
  where rdc.owner_id = v_owner_id and rdc.student_id = p_student_id
  for update;

  if not v_claim_existed then
    return query select v_operation_id, 'created'::text;
    return;
  end if;

  select exists(
    select 1 from public.report_records r
    where r.owner_id = v_owner_id and r.operation_id = v_operation_id and r.pdf_url is not null
  ) into v_has_completed_report;

  if not v_has_completed_report then
    return query select v_operation_id, 'in_progress'::text;
    return;
  end if;

  -- La tabla se alias como `rdc` y el RETURNING se calif­ica explícitamente
  -- (`rdc.operation_id`) porque esta función tiene `returns table(operation_id
  -- uuid, ...)`: eso declara `operation_id` también como variable OUT en
  -- todo el cuerpo, y un `RETURNING operation_id` sin calificar quedaría
  -- ambiguo entre la columna de la tabla y esa variable.
  update public.report_draft_claims as rdc
  set operation_id = pg_catalog.gen_random_uuid(), created_at = pg_catalog.now()
  where rdc.owner_id = v_owner_id and rdc.student_id = p_student_id
  returning rdc.operation_id into v_operation_id;

  return query select v_operation_id, 'rotated'::text;
end;
$$;

revoke all on function public.start_new_report_draft(uuid) from public;
grant execute on function public.start_new_report_draft(uuid) to authenticated;

-- 8) RPC: elimina un reporte y, si tenía PDF, encola su limpieza —
--    ambas cosas en la MISMA transacción implícita de la función: nunca
--    puede quedar la fila borrada sin su trabajo de limpieza encolado, ni
--    viceversa. Reemplaza el DELETE directo (revocado en el punto 1).
create or replace function public.delete_report_record(p_report_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_pdf_path text;
begin
  if v_owner_id is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  delete from public.report_records
  where id = p_report_id and owner_id = v_owner_id
  returning pdf_url into v_pdf_path;

  if not found then
    raise exception 'Reporte no encontrado.' using errcode = 'P0002';
  end if;

  if v_pdf_path is not null then
    insert into public.report_pdf_cleanup_jobs (owner_id, pdf_path) values (v_owner_id, v_pdf_path);
  end if;

  return v_pdf_path;
end;
$$;

revoke all on function public.delete_report_record(uuid) from public;
grant execute on function public.delete_report_record(uuid) to authenticated;

-- 9) RPC: lista los trabajos de limpieza pendientes del owner real —
--    usada para reintentar de forma oportunista (sin cron: en cada
--    eliminación posterior) cualquier limpieza que haya fallado antes.
create or replace function public.list_pending_report_pdf_cleanup_jobs()
returns setof public.report_pdf_cleanup_jobs
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  return query select * from public.report_pdf_cleanup_jobs where owner_id = auth.uid() order by created_at asc;
end;
$$;

revoke all on function public.list_pending_report_pdf_cleanup_jobs() from public;
grant execute on function public.list_pending_report_pdf_cleanup_jobs() to authenticated;

-- 10) RPC: marca un trabajo de limpieza como resuelto (el servidor la
--     llama SÓLO después de confirmar que el objeto ya no existe en
--     Storage — "objeto inexistente" cuenta como éxito).
create or replace function public.resolve_report_pdf_cleanup_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  delete from public.report_pdf_cleanup_jobs where id = p_job_id and owner_id = v_owner_id;
end;
$$;

revoke all on function public.resolve_report_pdf_cleanup_job(uuid) from public;
grant execute on function public.resolve_report_pdf_cleanup_job(uuid) to authenticated;

comment on column public.report_records.operation_id is 'Idempotencia real de creación — el mismo operation_id (reclamado server-side vía claim_report_draft/start_new_report_draft, nunca provisto por el cliente) nunca duplica la fila.';
comment on table public.report_draft_claims is 'Claim atómico real (no localStorage, no mutación directa del cliente) del borrador de generación activo por owner_id+student_id. Sólo se toca vía claim_report_draft/start_new_report_draft (security definer).';
comment on table public.report_pdf_cleanup_jobs is 'Cola mínima de limpieza reintentable de PDFs huérfanos tras una eliminación — ver delete_report_record/list_pending_report_pdf_cleanup_jobs/resolve_report_pdf_cleanup_job.';
