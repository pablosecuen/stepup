-- TeacherFlow Web — Fase 4 (corrección real, hallazgo de la verificación
-- de esta ronda): revoca EXECUTE de `anon` en las 4 RPC de registro de
-- clases. Migración aditiva — NUNCA edita las migraciones ya aplicadas
-- (`20260921120000_lesson_registration_rpcs.sql`,
-- `20260922100000_adhoc_registration_and_edit_history.sql`).
--
-- Hallazgo real (confirmado consultando `pg_proc.proacl` contra el
-- proyecto real, no supuesto): `revoke all on function ... from public`
-- (ya aplicado en las dos migraciones de arriba) NUNCA quita un grant
-- DIRECTO a `anon` — Supabase otorga `EXECUTE` a `anon`/`authenticated`
-- automáticamente al crear cada función nueva (vía `ALTER DEFAULT
-- PRIVILEGES`), como una entrada de ACL propia de cada rol, separada de
-- `PUBLIC`. Revocar de `PUBLIC` nunca toca esa entrada — sólo
-- `revoke execute ... from anon` explícito la quita. Confirmado real:
-- `proacl` de las 4 funciones tenía `anon=X` pese al revoke ya aplicado.
--
-- Esto NUNCA fue una vulnerabilidad real de datos — las 4 funciones exigen
-- `auth.uid()` no nulo como primera línea (`'No hay una sesión
-- autenticada.'`, errcode 28000), así que una llamada de `anon` siempre
-- fallaba funcionalmente antes de tocar cualquier fila — pero rompía la
-- defensa en profundidad real que se pretendía (bloquear la ejecución
-- misma, no sólo sus efectos), y contradecía lo que las pruebas pgTAP de
-- esta fase asumían (`42501`, nunca verificado contra una base real hasta
-- esta ronda).
--
-- Mismo patrón ya usado correctamente en este proyecto para las funciones
-- de sesiones activas/respaldo en la nube (`end_active_session`,
-- `upload_cloud_backup`, `fetch_latest_cloud_backup`, etc. — confirmado
-- real: `anon_can_execute = false` para esas), que ya tenían este revoke
-- explícito por rol. Se replica acá el mismo criterio.
--
-- Idempotente: `REVOKE` de un privilegio ya revocado nunca falla ni
-- lanza error — se puede reaplicar sin riesgo.
revoke execute on function public.start_lesson_registration(jsonb) from anon;
revoke execute on function public.save_participant_registration(jsonb) from anon;
revoke execute on function public.finalize_lesson_registration(jsonb) from anon;
revoke execute on function public.edit_completed_lesson_registration(jsonb) from anon;
