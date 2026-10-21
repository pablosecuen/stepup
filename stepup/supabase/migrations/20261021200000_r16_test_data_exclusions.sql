-- R16 — Exclusión REVERSIBLE de datos de prueba (QA) de la agenda, los pendientes y las estadísticas.
--
-- NO borra ni modifica ningún dato ni respaldo: sólo agrega una tabla con la lista de alumnos de prueba confirmados. La aplicación, cuando una clase, serie o registro tiene como únicos
-- participantes a alumnos de esa lista, no lo muestra en la agenda, en «clases por registrar» ni en las estadísticas del Resumen financiero. Deshacerlo = marcar la fila como revocada
-- (ver `supabase/repairs/r16_unmark_qa_exclusions.sql`); los datos siguen intactos en todo momento. Sin filas activas, la aplicación se comporta exactamente como antes.
--
-- Idempotente. Se aplica SIN cargar nada en la tabla: la lista se carga aparte, sólo después de que la usuaria confirme (`supabase/repairs/r16_mark_qa_exclusions.sql`).

create table if not exists public.test_data_exclusions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.test_data_exclusions is
  'Alumnos de PRUEBA confirmados por la usuaria. Sus clases, series y registros (cuando TODOS los participantes están en esta lista) se ocultan de agenda, pendientes y estadísticas. Nunca se borra nada; revocar = revoked_at.';

create unique index if not exists test_data_exclusions_active_unique on public.test_data_exclusions (owner_id, student_id) where revoked_at is null;
create index if not exists test_data_exclusions_owner_idx on public.test_data_exclusions (owner_id);

alter table public.test_data_exclusions enable row level security;
drop policy if exists test_data_exclusions_owner_all on public.test_data_exclusions;
create policy test_data_exclusions_owner_all on public.test_data_exclusions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
