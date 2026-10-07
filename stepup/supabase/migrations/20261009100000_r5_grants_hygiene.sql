-- R5 — Higiene de privilegios (hallazgos L-01 y L-08 de la auditoría). ADITIVA y sin cambio de comportamiento de la aplicación: sólo quita
-- privilegios que ninguna parte de la web ni de la app móvil usa, y que hoy sólo contiene RLS.
--
-- 1) `import_undo_dependency_registry` (catálogo estático de metadatos del esquema, 52 filas) era la única tabla de `public` SIN RLS y con
--    SELECT para `anon` y `authenticated`. Sólo la leen funciones SECURITY DEFINER (dueño: postgres, que no depende de RLS ni de grants) y
--    la auditoría de esquema (rol dueño). Se habilita RLS (sin ninguna política: la API ya no ve nada) y se revoca todo a los roles de la API.
-- 2) `anon` (sin sesión) conservaba privilegios de tabla en 33 tablas (SELECT en las 33; INSERT en 23 y DELETE en 9). Ninguna ruta de la aplicación consulta tablas sin sesión: se
--    revoca todo. (Antes una consulta anónima devolvía 0 filas por RLS; ahora devuelve «permission denied».)
-- 3) `authenticated` conservaba TRUNCATE, REFERENCES, TRIGGER y MAINTAIN. Ninguno es alcanzable por PostgREST ni lo usa ninguna función de
--    invocador (las claves foráneas las comprueba el dueño de la tabla). SELECT/INSERT/UPDATE/DELETE —incluidos los de nivel de columna de
--    `students`— NO se tocan: las RPC de invocador (calendario, cobros, pagos) y las escrituras directas de la web las necesitan.
-- 4) Privilegios por defecto del rol que corre las migraciones: las tablas, secuencias y funciones NUEVAS ya no nacen con privilegios para
--    `anon` ni con TRUNCATE/REFERENCES/TRIGGER/MAINTAIN para `authenticated` (las migraciones siguen concediendo explícitamente lo que haga falta).
--
-- Idempotente (revocar lo ya revocado no falla). Los privilegios por defecto de `supabase_admin` (objetos creados desde el panel) se ajustan
-- sólo si el rol que migra tiene permiso; si no, avisa y sigue.

alter table public.import_undo_dependency_registry enable row level security;
revoke all on public.import_undo_dependency_registry from public, anon, authenticated;

do $$
declare
  r record;
  v_maintain boolean := current_setting('server_version_num')::int >= 170000;
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', r.relname);
    if v_maintain then
      execute format('revoke maintain on table public.%I from authenticated', r.relname);
    end if;
  end loop;
end
$$;

do $$
declare
  v_maintain boolean := current_setting('server_version_num')::int >= 170000;
begin
  alter default privileges for role postgres in schema public revoke all on tables from anon;
  alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
  alter default privileges for role postgres in schema public revoke all on sequences from anon;
  alter default privileges for role postgres in schema public revoke execute on functions from anon;
  if v_maintain then
    alter default privileges for role postgres in schema public revoke maintain on tables from authenticated;
  end if;

  begin
    alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
    alter default privileges for role supabase_admin in schema public revoke truncate, references, trigger on tables from authenticated;
    alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
    alter default privileges for role supabase_admin in schema public revoke execute on functions from anon;
    if v_maintain then
      alter default privileges for role supabase_admin in schema public revoke maintain on tables from authenticated;
    end if;
  exception when insufficient_privilege or undefined_object then
    raise notice 'R5: no se pudieron ajustar los privilegios por defecto de supabase_admin (sin permiso o rol inexistente); se deja como está.';
  end;
end
$$;
