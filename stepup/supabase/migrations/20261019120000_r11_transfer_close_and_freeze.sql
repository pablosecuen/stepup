-- R11 — Cierre del traslado: CONSERVAR el origen y CONGELARlo sin borrar nada. ADITIVA e idempotente. NO se aplica a Production sin autorización. Depende de R9 y R10.
--
-- Qué resuelve:
--   1. Retención que podía borrar respaldos antiguos. Identificada: (a) `upload_cloud_backup` (de la app anterior) conserva SÓLO las 10 copias más nuevas por cuenta y borra
--      el resto cada vez que sube una distinta; (b) el trabajo por hora de R4 (`purge_expired_import_data`) vacía el respaldo retenido y las instantáneas de cada importación a los
--      30 días (no toca el origen: R9 ya guarda la copia íntegra de lo importado en `import_source_archives`, que ningún trabajo purga). Esta migración agrega
--      `legacy_cloud_backup_archive`: copia PERMANENTE e inmodificable de cada respaldo de la nube de la cuenta (por huella), que ningún trabajo ni la API puede borrar o cambiar.
--   2. Congelar el origen. `account_transfer_state` (abierto / congelado) y dos funciones: `freeze_legacy_source` (sólo con el último respaldo de la app ya archivado, el cotejo
--      COMPLETO atestiguado y la confirmación de la usuaria) y `reopen_legacy_source` (para incorporar algo cargado después de la copia). Con la cuenta congelada:
--        - la app anterior NO puede guardar respaldos nuevos en la nube (ni, por lo tanto, rotar los viejos): los datos antiguos quedan quietos;
--        - NO se puede importar otra copia: ningún respaldo ni sincronización de la app anterior puede pisar lo que la web ya tiene.
--      No toca la sesión, la autenticación, el dispositivo activo ni ninguna otra cuenta; no desactiva ningún servicio compartido; no programa ninguna limpieza.
-- Reversión: supabase/repairs/r11_freeze_rollback.sql (quita los disparadores, las funciones y las dos tablas; la copia permanente se pierde: exportarla antes).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1) Copia permanente de los respaldos de la nube
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.legacy_cloud_backup_archive (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_backup_id uuid,
  schema_version integer not null,
  app_version text,
  checksum text not null,
  source_created_at timestamptz,
  payload jsonb not null,
  archived_at timestamptz not null default now(),
  unique (owner_id, checksum)
);
comment on table public.legacy_cloud_backup_archive is 'Copia PERMANENTE de cada respaldo de la nube de la app anterior (por huella). Sólo se agrega; ninguna función, trabajo ni rol de la API la modifica o borra. Se elimina únicamente con la cuenta.';
create index if not exists legacy_cloud_backup_archive_owner_idx on public.legacy_cloud_backup_archive (owner_id, source_created_at desc);
alter table public.legacy_cloud_backup_archive enable row level security;
revoke all on public.legacy_cloud_backup_archive from anon, authenticated, service_role;
grant select on public.legacy_cloud_backup_archive to authenticated;
drop policy if exists legacy_cloud_backup_archive_owner_select on public.legacy_cloud_backup_archive;
create policy legacy_cloud_backup_archive_owner_select on public.legacy_cloud_backup_archive for select to authenticated using (owner_id = auth.uid());

create or replace function public.archive_legacy_cloud_backups()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_archived int;
  v_total int;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('legacy_archive:' || v_owner::text));
  with ins as (
    insert into public.legacy_cloud_backup_archive (owner_id, source_backup_id, schema_version, app_version, checksum, source_created_at, payload)
      select cb.user_id, cb.id, cb.schema_version, cb.app_version, cb.checksum, cb.created_at, cb.payload
        from public.cloud_backups cb where cb.user_id = v_owner
    on conflict (owner_id, checksum) do nothing
    returning 1
  )
  select count(*) into v_archived from ins;
  select count(*) into v_total from public.legacy_cloud_backup_archive where owner_id = v_owner;
  return jsonb_build_object('archived_now', v_archived, 'archived_total', v_total);
end;
$$;
revoke all on function public.archive_legacy_cloud_backups() from public, anon;
grant execute on function public.archive_legacy_cloud_backups() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2) Estado del traslado por cuenta
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.account_transfer_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'frozen')),
  frozen_at timestamptz,
  final_backup_checksum text,
  audit jsonb not null default '[]'::jsonb check (jsonb_typeof(audit) = 'array'),
  updated_at timestamptz not null default now()
);
comment on table public.account_transfer_state is 'Estado del traslado desde la app anterior: abierto (se puede importar) o congelado (la web es la única fuente). audit: historial de cierres y reaperturas con su cotejo.';
alter table public.account_transfer_state enable row level security;
revoke all on public.account_transfer_state from anon, authenticated, service_role;
grant select on public.account_transfer_state to authenticated;
drop policy if exists account_transfer_state_owner_select on public.account_transfer_state;
create policy account_transfer_state_owner_select on public.account_transfer_state for select to authenticated using (owner_id = auth.uid());

-- ¿La cuenta está congelada? (para los disparadores; `owner` explícito: nunca se lee la sesión dentro de un disparador de otra tabla)
create or replace function public._transfer_is_frozen(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_transfer_state s where s.owner_id = p_owner and s.status = 'frozen')
$$;
revoke all on function public._transfer_is_frozen(uuid) from public, anon, authenticated;

create or replace function public.get_transfer_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('status', s.status, 'frozen_at', s.frozen_at, 'final_backup_checksum', s.final_backup_checksum) from public.account_transfer_state s where s.owner_id = auth.uid()),
                  jsonb_build_object('status', 'open', 'frozen_at', null, 'final_backup_checksum', null))
$$;
revoke all on function public.get_transfer_state() from public, anon;
grant execute on function public.get_transfer_state() to authenticated;

-- Cierre: la web pasa a ser la única fuente. Exige (todo junto):
--   · el ÚLTIMO respaldo de la app anterior es el de la huella indicada (nada cargado después de esa copia) y está en la copia permanente;
--   · el cotejo origen ↔ destino atestiguado en `p_audit` dice COMPLETO y la usuaria confirmó (`p_audit->>'user_confirmed' = 'true'`).
create or replace function public.freeze_legacy_source(p_final_checksum text, p_audit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_latest text;
  v_archive jsonb;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if jsonb_typeof(p_audit) is distinct from 'object' or p_audit ->> 'verdict' is distinct from 'COMPLETO' or p_audit ->> 'user_confirmed' is distinct from 'true' then
    raise exception 'Para cerrar el traslado hace falta el cotejo COMPLETO y la confirmación de la usuaria.' using errcode = '22023';
  end if;
  if pg_column_size(p_audit) > 65536 then raise exception 'El resultado del cotejo es demasiado grande.' using errcode = '22023'; end if;
  if p_final_checksum is null or p_final_checksum !~ '^[0-9a-f]{64}$' then raise exception 'La huella del último respaldo no es válida.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select cb.checksum into v_latest from public.cloud_backups cb where cb.user_id = v_owner order by cb.created_at desc limit 1;
  if v_latest is distinct from p_final_checksum then
    raise exception 'Hay un respaldo más nuevo de la app anterior que el que se usó para el cotejo: incorporalo antes de cerrar el traslado.' using errcode = '22023';
  end if;
  v_archive := public.archive_legacy_cloud_backups();
  if not exists (select 1 from public.legacy_cloud_backup_archive a where a.owner_id = v_owner and a.checksum = p_final_checksum) then
    raise exception 'El último respaldo no quedó en la copia permanente.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.import_runs r where r.owner_id = v_owner and r.status = 'applied') then
    raise exception 'No hay ninguna importación aplicada: no hay nada que cerrar.' using errcode = '22023';
  end if;

  insert into public.account_transfer_state (owner_id, status, frozen_at, final_backup_checksum, audit)
    values (v_owner, 'frozen', now(), p_final_checksum, jsonb_build_array(jsonb_build_object('action', 'freeze', 'at', now(), 'audit', p_audit)))
    on conflict (owner_id) do update set status = 'frozen', frozen_at = now(), final_backup_checksum = excluded.final_backup_checksum,
      audit = public.account_transfer_state.audit || jsonb_build_array(jsonb_build_object('action', 'freeze', 'at', now(), 'audit', p_audit)), updated_at = now();
  return jsonb_build_object('status', 'frozen', 'archive', v_archive);
end;
$$;
revoke all on function public.freeze_legacy_source(text, jsonb) from public, anon;
grant execute on function public.freeze_legacy_source(text, jsonb) to authenticated;

-- Reapertura (para incorporar algo cargado después de la copia): queda registrada. No borra nada.
create or replace function public.reopen_legacy_source(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if p_reason is null or btrim(p_reason) = '' or length(p_reason) > 500 then raise exception 'Indicá el motivo de la reapertura.' using errcode = '22023'; end if;
  update public.account_transfer_state set status = 'open', updated_at = now(),
         audit = audit || jsonb_build_array(jsonb_build_object('action', 'reopen', 'at', now(), 'reason', p_reason))
   where owner_id = v_owner and status = 'frozen';
  return jsonb_build_object('status', 'open');
end;
$$;
revoke all on function public.reopen_legacy_source(text) from public, anon;
grant execute on function public.reopen_legacy_source(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3) Con la cuenta congelada: ni importar otra copia ni que la app anterior guarde (y rote) respaldos
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._block_import_when_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public._transfer_is_frozen(new.owner_id) then
    raise exception 'El traslado desde la app anterior ya se cerró: la web es la única fuente de datos. Para importar otra copia hay que reabrirlo explícitamente.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public._block_import_when_frozen() from public, anon, authenticated;

create or replace function public._block_legacy_backup_when_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public._transfer_is_frozen(new.user_id) then
    raise exception 'Esta cuenta ya se trasladó a la web: la app anterior no guarda respaldos nuevos para no pisar los datos de la web ni borrar los respaldos antiguos.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public._block_legacy_backup_when_frozen() from public, anon, authenticated;

drop trigger if exists trg_block_import_previews_when_frozen on public.import_previews;
create trigger trg_block_import_previews_when_frozen before insert on public.import_previews for each row execute function public._block_import_when_frozen();
drop trigger if exists trg_block_import_runs_when_frozen on public.import_runs;
create trigger trg_block_import_runs_when_frozen before insert on public.import_runs for each row execute function public._block_import_when_frozen();
drop trigger if exists trg_block_legacy_backup_when_frozen on public.cloud_backups;
create trigger trg_block_legacy_backup_when_frozen before insert on public.cloud_backups for each row execute function public._block_legacy_backup_when_frozen();
