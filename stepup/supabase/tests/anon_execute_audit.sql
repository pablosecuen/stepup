-- TeacherFlow Web — auditoría REAL de funciones del schema `public`
-- ejecutables por `anon`. A diferencia de `calendar_rpc_ownership_test.sql`/
-- `lesson_registration_rpc_ownership_test.sql` (pgTAP, "escrito, nunca
-- corrido" por falta de Docker/CLI de pgTAP en este entorno), este
-- archivo es SQL simple, pensado para correr DE VERDAD contra el
-- proyecto real (`supabase db query --linked --file
-- supabase/tests/anon_execute_audit.sql`) después de cualquier migración
-- que cree o reemplace funciones — nunca sólo un archivo de referencia.
--
-- Por qué existe: `supabase_admin` (el rol real que ejecuta `CREATE
-- FUNCTION` durante `supabase db push`, confirmado contra
-- `pg_default_acl` — ver `20260926120000_legacy_rpcs_revoke_anon_execute.sql`)
-- concede `EXECUTE` a `anon` por defecto en TODA función nueva de
-- `public`. El rol disponible para este proyecto (`postgres`) no puede
-- corregir ese default (no es miembro de `supabase_admin`, `42501
-- permission denied` al intentarlo) — así que cada función privada
-- nueva nace insegura por defecto hasta que su propia migración la
-- revoca explícitamente. Esta auditoría es el control real que detecta
-- si alguna se quedó sin revocar.
--
-- Falla (RAISE EXCEPTION, no sólo un warning) si aparece una función NO
-- listada en la allowlist de abajo con EXECUTE para anon. Las funciones
-- de trigger se listan aparte, nunca se confunden con RPC reales — nadie
-- las invoca vía PostgREST con argumentos reales (ejecutarlas fuera de
-- un contexto de trigger falla de inmediato), pero igual se documenta
-- cualquier EXECUTE que retengan, por prolijidad.

do $$
declare
  -- Allowlist REAL y mínima de funciones que SÍ deben ser ejecutables
  -- por `anon` a propósito — vacía hoy: toda RPC real de este proyecto
  -- exige una sesión autenticada real, nunca hay una pensada para
  -- llamarse sin login. Agregar acá únicamente con una razón de negocio
  -- real documentada en el mismo commit que la agregue.
  v_allowlist text[] := array[]::text[];
  v_unexpected record;
  v_unexpected_count int := 0;
begin
  for v_unexpected in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'execute')
      and p.oid::regprocedure::text <> all (v_allowlist)
    order by p.oid::regprocedure::text
  loop
    v_unexpected_count := v_unexpected_count + 1;
    raise warning 'RPC privada con EXECUTE para anon (inesperado, fuera de la allowlist): %', v_unexpected.signature;
  end loop;

  if v_unexpected_count > 0 then
    raise exception 'Auditoría anon-EXECUTE FALLÓ: % función(es) privada(s) del schema public ejecutable(s) por anon, fuera de la allowlist — ver warnings arriba. Corregí con "revoke execute on function <firma> from public, anon;" en una migración nueva.', v_unexpected_count;
  end if;

  raise notice 'Auditoría anon-EXECUTE OK: ninguna función privada del schema public tiene EXECUTE para anon fuera de la allowlist.';
end $$;

-- Documentación (no falla la auditoría): funciones de TRIGGER del schema
-- public y si conservan EXECUTE innecesario para anon — inofensivo en la
-- práctica (invocarlas directamente sin contexto de trigger falla), pero
-- documentado para no confundirlas nunca con una RPC pública real.
select
  p.oid::regprocedure::text as trigger_function,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute_pointlessly
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.prorettype = 'trigger'::regtype
order by p.oid::regprocedure::text;
