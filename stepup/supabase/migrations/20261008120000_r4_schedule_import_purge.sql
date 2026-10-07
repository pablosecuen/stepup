-- R4 — Programa la purga de importaciones con pg_cron (extensión incluida en Supabase, sin costo adicional).
--
-- `public.purge_expired_import_data()` (migración 20261008100000) borra lo que ya cumplió su retención. Esta migración la programa una
-- vez por hora (minuto 17) con lotes acotados: una pasada sin vencimientos no hace nada, y si hay atraso se pone al día en pocas horas.
-- Un segundo trabajo diario limpia el historial propio de pg_cron (`cron.job_run_details`) con más de 14 días para que no crezca.
--
-- Es tolerante a entornos sin pg_cron (bases locales, de pruebas): si la extensión no está disponible, avisa y NO falla.
-- Idempotente: `cron.schedule` con un nombre existente actualiza ese trabajo, no crea otro. Los trabajos corren como el rol dueño.
--
-- Para quitarlos: select cron.unschedule('tf-purge-expired-import-data'); select cron.unschedule('tf-cron-history-cleanup');
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'R4: pg_cron no está disponible en esta base; la purga de importaciones queda sin programar (ejecutar public.purge_expired_import_data() a mano o programarla).';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  perform cron.schedule('tf-purge-expired-import-data', '17 * * * *', 'select public.purge_expired_import_data(200)');
  perform cron.schedule('tf-cron-history-cleanup', '43 3 * * *', $job$delete from cron.job_run_details where end_time < now() - interval '14 days'$job$);
end
$$;
