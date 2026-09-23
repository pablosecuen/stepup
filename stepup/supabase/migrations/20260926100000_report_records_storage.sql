-- Fase 7 — Reportes: idempotencia real de creación de report_records
-- (con claim atómico server-side del borrador activo) + bucket privado de
-- Storage para los PDF reales (reemplaza el `permanentPdfUri` local del
-- móvil). Migración aditiva — nunca edita ninguna migración ya aplicada.

-- 1) `operation_id` real en cada reporte + índice único parcial: dos
--    filas nunca pueden compartir el mismo (owner_id, operation_id). El
--    operation_id en sí SIEMPRE nace server-side (ver punto 4 y
--    `lib/repositories/report-drafts.ts`) — nunca lo manda el cliente.
alter table public.report_records
  add column if not exists operation_id uuid;

create unique index if not exists report_records_owner_operation_unique
  on public.report_records (owner_id, operation_id)
  where operation_id is not null;

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

-- 4) Claim atómico REAL (server-side, nunca localStorage) del borrador de
--    generación de reporte activo, por (owner_id, student_id) — la
--    verdadera autoridad de idempotencia entre pestañas/reintentos. Dos
--    requests concurrentes (doble clic, dos pestañas que arrancan en una
--    carrera real, reintento tras respuesta perdida) que intenten
--    reclamar el mismo (owner_id, student_id) convergen siempre al mismo
--    operation_id, gracias a la clave primaria: Postgres serializa
--    cualquier INSERT concurrente sobre la misma clave, así que esto es
--    atomicidad real de la base, no una secuencia simulada. El
--    operation_id nace acá mismo (`default gen_random_uuid()`) — nunca lo
--    manda el cliente. Ver `lib/repositories/report-drafts.ts`.
create table if not exists public.report_draft_claims (
  owner_id uuid not null,
  student_id uuid not null,
  operation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  primary key (owner_id, student_id)
);

alter table public.report_draft_claims enable row level security;

drop policy if exists report_draft_claims_owner_select on public.report_draft_claims;
create policy report_draft_claims_owner_select on public.report_draft_claims
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists report_draft_claims_owner_insert on public.report_draft_claims;
create policy report_draft_claims_owner_insert on public.report_draft_claims
  for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists report_draft_claims_owner_delete on public.report_draft_claims;
create policy report_draft_claims_owner_delete on public.report_draft_claims
  for delete
  to authenticated
  using (owner_id = auth.uid());

comment on column public.report_records.operation_id is 'Idempotencia real de creación — el mismo operation_id (reclamado server-side vía report_draft_claims, nunca provisto por el cliente) nunca duplica la fila. Nunca evita dos generaciones intencionales con operation_id distintos.';
comment on table public.report_draft_claims is 'Claim atómico real (no localStorage) del borrador de generación activo por owner_id+student_id — ver lib/repositories/report-drafts.ts. Se libera sólo mediante una transición explícita posterior a un éxito confirmado (startNewReportDraftAction), nunca automáticamente al terminar de generar, para no romper el reintento ante una respuesta perdida.';
