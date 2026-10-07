-- R4 — Rollback MANUAL de la retención de importaciones (NO es una migración; no se aplica con `db push`). Se ejecuta sólo si hace falta
-- retirar el control. No toca datos de la aplicación: sólo deja de programar la purga y retira la función, la fila de configuración y
-- la columna que creó R4.
--
-- Paso A (frena la purga, deja todo lo demás): ejecutar sólo el bloque "A". Es lo que hay que hacer ante cualquier duda: la purga deja de
--         correr y nada más cambia.
-- Paso B (retira además la función, la acción de cuota y la columna): ejecutar A y después B. Después,
--         `supabase migration repair --status reverted 20261008100000 20261008110000 20261008120000` si se quiere que el historial de
--         migraciones lo refleje.
--
-- Importante: lo ya purgado NO se puede recuperar (era el objetivo: el respaldo retenido y los snapshots de importaciones vencidas).
-- Si se ejecuta B, hay que volver a desplegar el web anterior a R4 (la pantalla de eliminar cuenta nueva llama a
-- `consume_action_quota('account_reauth')`, que B retira) — o dejar sólo A y la acción de cuota.
-- La extensión pg_cron (si se activó) se deja instalada: otros trabajos pueden usarla.

-- ===== A) dejar de programar la purga =====
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('tf-purge-expired-import-data', 'tf-cron-history-cleanup');
  end if;
end $$;

-- ===== B) función, acción de cuota y columna de R4 =====
drop function if exists public.purge_expired_import_data(integer);
delete from public.action_quota_defaults where action_key = 'account_reauth';
alter table public.import_previews drop column if exists payload_purged_at;
