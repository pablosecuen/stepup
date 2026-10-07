-- R3 — Rollback MANUAL de las cuotas (NO es una migración; no se aplica con `db push`). Se ejecuta sólo si hace falta retirar el control.
-- Es seguro y no toca datos de la aplicación: sólo elimina los disparadores, funciones y tablas de configuración que creó R3.
--
-- Paso A (desactiva la aplicación de los límites y deja la configuración): ejecutar sólo el bloque "A".
-- Paso B (retira además funciones y tablas de R3): ejecutar A y después B. Después, `supabase migration repair --status reverted
--         20261007100000 20261007110000` si se quiere que el historial de migraciones refleje el retiro.
--
-- El web desplegado con R3 llama a `consume_action_quota` antes de acciones costosas: si se ejecuta B, hay que volver a desplegar el
-- web anterior (o dejar sólo A).

-- ===== A) disparadores =====
do $$
declare
  r record;
begin
  for r in
    select c.relname, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace
       and t.tgname in ('trg_quota_count', 'trg_quota_row_size')
       and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname);
  end loop;
end $$;

-- ===== B) funciones y tablas de R3 =====
drop function if exists public.consume_action_quota(text);
drop function if exists public.tf_quota_after_insert();
drop function if exists public.tf_quota_row_size();
drop function if exists public.tf_quota_row_applies(text, jsonb);
drop function if exists public.tf_quota_count_filter(text);
drop table if exists public.account_action_events;
drop table if exists public.account_quota_overrides;
drop table if exists public.action_quota_defaults;
drop table if exists public.quota_defaults;
