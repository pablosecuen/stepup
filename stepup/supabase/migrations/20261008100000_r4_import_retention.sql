-- R4 — Retención y purga de los datos de las importaciones (hallazgo M-05 de la auditoría).
--
-- Problema: la importación guarda el respaldo completo (hasta 20 MB: nombres, teléfonos y notas de alumnos) en
-- `import_previews.normalized_payload` y en `import_runs.retained_payload`, más una copia fila por fila en
-- `import_run_row_snapshots` (para poder deshacer). `limits.ts` declara una retención de 30 días, pero NADA la aplicaba: los
-- datos personales de terceros quedaban guardados para siempre y el disco sólo crecía.
--
-- Esta migración es ADITIVA: una columna nueva (nula) y una función nueva. No modifica ninguna función existente, ninguna fila,
-- ningún privilegio ni ninguna política. La web desplegada no la usa (compatible hacia atrás y hacia adelante); la ejecuta un
-- trabajo programado (migración siguiente) o, a mano, quien administra la base.
--
-- Qué purga `purge_expired_import_data()` (siempre por lotes acotados y sin tocar cuentas ocupadas):
--   1) previews de deshacer vencidos hace más de 24 h (sólo ids de filas y motivos, pero ya no sirven);
--   2) previews de importación que NUNCA se aplicaron (pendientes/vencidos) con más de 24 h de vencidos: se borran con sus
--      huellas y candidatos a duplicado (cascada). Nunca uno referenciado por un `import_runs` (esa FK es sin cascada a propósito);
--   3) previews APLICADOS con más de 24 h de vencidos: se vacía el contenido personal (`normalized_payload`, `classification`,
--      `excluded_collections`) y se borran sus huellas y candidatos; la fila queda (la referencia el run y la repetición idempotente
--      de "aplicar" sólo necesita que exista) con `payload_purged_at`;
--   4) corridas (`import_runs`) cuyo plazo de deshacer (`undo_expires_at`, 30 días) venció hace más de 1 hora: se borra el respaldo
--      retenido, se borran todos sus snapshots y se escriben `payload_purged_at` / `snapshots_purged_at`. La fila de la corrida queda
--      como historial (resumen y conteos, sin datos personales). Con la hora de gracia, un "deshacer" iniciado dentro del plazo
--      (vista previa de 30 minutos) termina antes de que se pueda purgar; igualmente `apply_undo_backup_import` rechaza una corrida
--      con `snapshots_purged_at` y `preview_undo_backup_import` responde "el plazo venció" apenas pasa `undo_expires_at`.
--
-- Concurrencia: la purga de una corrida toma, sin esperar, el MISMO lock por cuenta que usan aplicar/deshacer
-- (`pg_advisory_xact_lock(hashtext('backup_import:'||owner))`): si la cuenta está aplicando o deshaciendo algo, esa corrida se
-- saltea y se purga en la próxima pasada. Las filas se toman con `FOR UPDATE SKIP LOCKED`: dos purgas simultáneas no se pisan.
-- Es idempotente: una segunda pasada sin vencimientos nuevos devuelve ceros.
--
-- Nunca ejecutable desde la API (anon/authenticated/service_role): sólo el rol dueño (postgres), que es quien corre pg_cron.

alter table public.import_previews add column if not exists payload_purged_at timestamptz;

comment on column public.import_previews.payload_purged_at is 'R4: cuándo se vació el contenido personal de un preview aplicado (retención). Nulo = todavía conserva su contenido o nunca se aplicó.';

create or replace function public.purge_expired_import_data(p_batch_size integer default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch_size, 200), 1), 1000);
  -- Una corrida puede tener decenas de miles de snapshots: pocas corridas por pasada para no hacer una transacción enorme.
  v_run_batch integer := least(greatest(coalesce(p_batch_size, 200) / 10, 1), 25);
  v_undo_previews integer := 0;
  v_previews_deleted integer := 0;
  v_previews_blanked integer := 0;
  v_runs_purged integer := 0;
  v_runs_skipped integer := 0;
  v_snapshots_deleted integer := 0;
  v_run record;
  v_rows integer;
begin
  -- 1) Previews de deshacer vencidos (sólo metadatos de filas, ya inútiles).
  with doomed as (
    select u.id from public.import_undo_previews u
     where u.expires_at < now() - interval '24 hours'
     order by u.expires_at
     limit v_batch
       for update skip locked
  )
  delete from public.import_undo_previews u using doomed d where u.id = d.id;
  get diagnostics v_undo_previews = row_count;

  -- 2) Previews que nunca se aplicaron (pendientes o vencidos) con más de 24 h de vencidos. La FK de `import_runs.preview_id` es
  --    sin cascada: un preview con corrida nunca se borra (se vacía en el paso 3).
  with doomed as (
    select p.id from public.import_previews p
     where p.status in ('pending', 'expired')
       and p.expires_at < now() - interval '24 hours'
       and not exists (select 1 from public.import_runs r where r.preview_id = p.id)
     order by p.expires_at
     limit v_batch
       for update skip locked
  )
  delete from public.import_previews p using doomed d where p.id = d.id;
  get diagnostics v_previews_deleted = row_count;

  -- 3) Previews aplicados: se vacía el contenido personal y se borran huellas y candidatos; la fila (y su estado) queda.
  with todo as (
    select p.id from public.import_previews p
     where p.status = 'applied'
       and p.payload_purged_at is null
       and p.expires_at < now() - interval '24 hours'
     order by p.expires_at
     limit v_batch
       for update skip locked
  ),
  gone_candidates as (
    delete from public.import_preview_duplicate_candidates c using todo t where c.preview_id = t.id returning 1
  ),
  gone_fingerprints as (
    delete from public.import_preview_row_fingerprints f using todo t where f.preview_id = t.id returning 1
  )
  update public.import_previews p
     set normalized_payload = '{}'::jsonb,
         classification = '{}'::jsonb,
         excluded_collections = '[]'::jsonb,
         payload_purged_at = now()
    from todo t
   where p.id = t.id;
  get diagnostics v_previews_blanked = row_count;

  -- 4) Corridas con el plazo de deshacer vencido (más 1 hora de gracia): respaldo retenido y snapshots.
  for v_run in
    select r.id, r.owner_id
      from public.import_runs r
     where r.undo_expires_at < now() - interval '1 hour'
       and (r.retained_payload is not null or r.payload_purged_at is null or r.snapshots_purged_at is null)
     order by r.undo_expires_at
     limit v_run_batch
  loop
    -- Sin esperar: si la cuenta está aplicando o deshaciendo una importación, se purga en la próxima pasada.
    if not pg_try_advisory_xact_lock(hashtext('backup_import:' || v_run.owner_id::text)) then
      v_runs_skipped := v_runs_skipped + 1;
      continue;
    end if;

    perform 1
       from public.import_runs r
      where r.id = v_run.id
        and r.undo_expires_at < now() - interval '1 hour'
        for update skip locked;
    if not found then
      v_runs_skipped := v_runs_skipped + 1;
      continue;
    end if;

    delete from public.import_run_row_snapshots s where s.import_run_id = v_run.id;
    get diagnostics v_rows = row_count;
    v_snapshots_deleted := v_snapshots_deleted + v_rows;

    update public.import_runs r
       set retained_payload = null,
           payload_purged_at = coalesce(r.payload_purged_at, now()),
           snapshots_purged_at = coalesce(r.snapshots_purged_at, now())
     where r.id = v_run.id;
    v_runs_purged := v_runs_purged + 1;
  end loop;

  -- Sólo cantidades: nunca ids, nombres ni contenido.
  return jsonb_build_object(
    'undo_previews_deleted', v_undo_previews,
    'previews_deleted', v_previews_deleted,
    'previews_blanked', v_previews_blanked,
    'runs_purged', v_runs_purged,
    'runs_skipped', v_runs_skipped,
    'snapshots_deleted', v_snapshots_deleted
  );
end;
$$;

comment on function public.purge_expired_import_data(integer) is 'R4: retención de importaciones (respaldo retenido y snapshots tras el plazo de deshacer, previews vencidos). Sólo el rol dueño (pg_cron); nunca la API.';

-- Los privilegios por defecto del proyecto conceden EXECUTE a anon/authenticated/service_role en toda función nueva de public.
revoke all on function public.purge_expired_import_data(integer) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
