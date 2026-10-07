-- R5 — Políticas RLS «TO public» → «TO authenticated» (hallazgo L-08). Las políticas de dueño de `public` (`*_owner_all` y `*_owner_select`)
-- estaban abiertas al rol PUBLIC (cualquier rol, incluido `anon`) y sólo `auth.uid() = owner_id` las acotaba. Se limitan al rol de las personas con
-- sesión. ALTER POLICY conserva exactamente USING / WITH CHECK y el tipo de comando: no cambia a quién se le permite qué fila, sólo quita
-- a los roles que nunca pasan por ahí (`anon`).
--
-- Idempotente (una política que ya es `TO authenticated` no se vuelve a tocar). Sólo esquema `public`: las de Storage ya son `authenticated`.
do $$
declare
  r record;
begin
  for r in
    select p.schemaname, p.tablename, p.policyname
      from pg_policies p
     where p.schemaname = 'public'
       and p.roles = array['public']::name[]
     order by p.tablename, p.policyname
  loop
    execute format('alter policy %I on %I.%I to authenticated', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$$;
