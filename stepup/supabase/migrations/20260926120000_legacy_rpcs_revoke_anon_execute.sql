-- Fase 7 — corrección puntual real: revoca EXECUTE de `anon` en 8 RPC
-- más antiguas (Fases 3-4) que nacieron con ese privilegio concedido por
-- defecto. Mismo hallazgo real que
-- `20260926110000_report_rpcs_revoke_anon_execute.sql`, extendido acá a
-- `apply_recurrence_participants_from_date`, `cancel_calendar_occurrence`,
-- `change_student_status`, `create_calendar_lesson`,
-- `create_recurrence_series`, `rename_custom_level`,
-- `reschedule_calendar_occurrence`, `split_recurrence_this_and_future`.
--
-- Riesgo real evaluado como bajo: las 8 son `security invoker`, así que
-- la RLS de las tablas subyacentes (`owner_id = auth.uid()`, NULL para
-- `anon`) sigue bloqueando cualquier mutación real — a diferencia de las
-- RPC `security definer` de Reportes (Fase 7), acá no hay bypass de RLS.
-- Aun así, es la misma defensa en profundidad incompleta: `anon` puede
-- invocar la función (y recién ahí la RLS la frena), en vez de que la
-- invocación falle directamente por falta de permiso. Esta migración
-- sólo revoca `EXECUTE` de `anon` — nunca toca `security
-- invoker`/`security definer`, nunca toca la lógica interna, nunca toca
-- los permisos de `authenticated` ni `service_role`.
revoke execute on function public.apply_recurrence_participants_from_date(jsonb) from anon;
revoke execute on function public.cancel_calendar_occurrence(jsonb) from anon;
revoke execute on function public.change_student_status(uuid, text, date, text, text) from anon;
revoke execute on function public.create_calendar_lesson(jsonb) from anon;
revoke execute on function public.create_recurrence_series(jsonb) from anon;
revoke execute on function public.rename_custom_level(uuid, text) from anon;
revoke execute on function public.reschedule_calendar_occurrence(jsonb) from anon;
revoke execute on function public.split_recurrence_this_and_future(jsonb) from anon;

-- ---------------------------------------------------------------------------
-- Causa raíz real — documentada, NO corregida acá: limitación genuina del
-- entorno administrado, no un descuido.
--
-- Confirmado contra `pg_default_acl` en el proyecto real: la única fila
-- para funciones (`defaclobjtype = 'f'`) del schema `public` tiene
-- `defaclrole = supabase_admin` — es ESE rol el que ejecuta el
-- `CREATE FUNCTION` real durante `supabase db push` (el dueño final que
-- se ve después en `pg_proc.proowner`, `postgres`, es posterior a la
-- creación — Postgres resuelve privilegios por defecto contra el rol que
-- ejecutó el `CREATE`, no contra el dueño final tras un
-- `ALTER ... OWNER TO`). El ACL por defecto real de `supabase_admin` para
-- funciones nuevas de `public` concede `EXECUTE` a `postgres`, `anon`,
-- `authenticated` y `service_role` (nunca a `PUBLIC`, confirmado — no hay
-- entrada `=X/...` sin rol).
--
-- El único rol disponible para este proyecto vía el CLI/Management API
-- (`postgres`) NO es miembro de `supabase_admin` y no es superusuario.
-- Se intentó, en una transacción real con rollback (nunca aplicado):
--   alter default privileges for role supabase_admin in schema public
--     revoke execute on functions from anon;
-- y Postgres devolvió `42501: permission denied to change default
-- privileges`. No hay una vía de `postgres` para corregir esto de raíz
-- sin acceso administrativo de Supabase que este proyecto no tiene a
-- través del CLI — y explícitamente NO se intentó ningún mecanismo para
-- eludir esa restricción (cambiar de rol, tocar membresías, alterar
-- propietarios).
--
-- Control preventivo real mientras esta vía no se habilite: TODA
-- migración futura que cree o reemplace una función privada en `public`
-- debe incluir, en la misma migración, `revoke execute on function
-- public.<firma> from public, anon;` explícito (nunca asumir que
-- `revoke ... from public` sola alcanza — confirmado que `PUBLIC` no
-- tiene privilegio propio hoy, pero revocarlo igual es defensivo y
-- gratuito). Además, `supabase/tests/anon_execute_audit.sql` (nuevo, en
-- este mismo commit) audita en cada ronda de seguridad que ninguna
-- función privada nueva del schema `public` quede con `EXECUTE` para
-- `anon` — falla explícitamente si aparece una.
