-- Fase 7 — corrección aditiva sobre 20260926100000 (ya aplicada e
-- inmutable): revoca EXECUTE de `anon` en las 5 RPC de reportes.
--
-- Hallazgo real post-aplicación: este proyecto Supabase tiene privilegios
-- por defecto a nivel de base (`alter default privileges ... grant
-- execute on functions to anon, authenticated, service_role`) — TODA
-- función nueva nace con EXECUTE concedido directamente a `anon` y
-- `authenticated` (nunca vía `public`). El patrón `revoke all on function
-- ... from public;` usado en 20260926100000 (y ya antes, desde Fase 3, en
-- las RPC de calendario) nunca tocaba esos grants directos — sólo
-- revocaba el pseudo-rol `public`, que no tenía ninguna entrada propia en
-- el ACL. Confirmado con `pg_proc.proacl` real después de aplicar:
-- `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
-- en las 5 funciones — `anon` SÍ podía ejecutar la RPC (aunque el chequeo
-- interno `auth.uid() is null` seguía rechazando cualquier intento real,
-- así que ningún dato quedó expuesto; esto es un endurecimiento de
-- defensa en profundidad, no una brecha de datos).
--
-- Migración nueva porque 20260926100000 ya está aplicada e inmutable —
-- nunca se edita una migración ya aplicada.
revoke execute on function public.claim_report_draft(uuid) from anon;
revoke execute on function public.start_new_report_draft(uuid) from anon;
revoke execute on function public.delete_report_record(uuid) from anon;
revoke execute on function public.list_pending_report_pdf_cleanup_jobs() from anon;
revoke execute on function public.resolve_report_pdf_cleanup_job(uuid) from anon;
