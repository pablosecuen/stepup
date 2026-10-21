-- Reversión de R11 (cierre del traslado). Quita los disparadores (la app anterior vuelve a poder guardar respaldos y se vuelve a poder importar), las funciones y las dos tablas.
-- ATENCIÓN: borra la copia permanente de los respaldos (legacy_cloud_backup_archive): exportarla (copias cifradas) antes si ya se usó. No toca cloud_backups ni import_source_archives.
drop trigger if exists trg_block_import_previews_when_frozen on public.import_previews;
drop trigger if exists trg_block_import_runs_when_frozen on public.import_runs;
drop trigger if exists trg_block_legacy_backup_when_frozen on public.cloud_backups;
drop function if exists public._block_import_when_frozen();
drop function if exists public._block_legacy_backup_when_frozen();
drop function if exists public.reopen_legacy_source(text);
drop function if exists public.freeze_legacy_source(text, jsonb);
drop function if exists public.get_transfer_state();
drop function if exists public._transfer_is_frozen(uuid);
drop function if exists public.archive_legacy_cloud_backups();
drop table if exists public.account_transfer_state;
drop table if exists public.legacy_cloud_backup_archive;
