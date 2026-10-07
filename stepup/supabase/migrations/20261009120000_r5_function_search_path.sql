-- R5 — `search_path` vacío en las funciones pendientes (hallazgo L-07). 19 funciones de `public` conservaban el `search_path` por defecto (las 7 RPC
-- de calendario, `rename_custom_level` y 3 utilitarios de invocador, el disparador `set_updated_at`) o `search_path=public` (las 8 RPC
-- SECURITY DEFINER de la app móvil: sesión activa y respaldos en la nube). Con un `search_path` mutable, un objeto homónimo en otro esquema
-- puede ocultar al verdadero; en una función SECURITY DEFINER sería una escalada de privilegios.
--
-- Se verificó contra el código real de Production (pg_get_functiondef) que TODAS ya usan nombres calificados (`public.`, `auth.`, `extensions.`) y
-- sólo funciones, operadores y tipos de `pg_catalog` (que siempre se resuelven), así que fijar el `search_path` no cambia ningún cuerpo: es sólo
-- `ALTER FUNCTION … SET search_path = ''`. (El tipo de retorno `calendar_lessons`/`recurrence_rules`/`custom_levels` se resolvió al crear la
-- función y no se vuelve a buscar.) Cuerpos, firmas, retornos y privilegios de EXECUTE no se modifican, salvo el último punto.
--
-- Las 8 funciones de la app móvil se crean fuera de este repositorio (en el proyecto real ya existen); en una base armada sólo con estas migraciones
-- no existen, por eso cada una se ajusta sólo si existe (`to_regprocedure`).
--
-- Además, `set_updated_at()` es una función de DISPARADOR: se ejecuta cuando se dispara el disparador (sin comprobar EXECUTE a quien actualiza la
-- fila), y no tiene sentido invocarla por la API. Tenía EXECUTE para anon/authenticated/public: se revoca.
--
-- Idempotente.
do $$
declare
  v_signature text;
  v_signatures text[] := array[
    -- App móvil (SECURITY DEFINER, search_path=public → vacío)
    'public.fetch_latest_cloud_backup_timestamp()',
    'public.transfer_active_session(text)',
    'public.touch_active_session(text)',
    'public.upload_cloud_backup(text, bigint, integer, text, jsonb)',
    'public.fetch_latest_cloud_backup(text, bigint)',
    'public.fetch_recent_cloud_backups(text, bigint, integer)',
    'public.delete_own_account()',
    'public.end_active_session(text, bigint)',
    -- Calendario y niveles (invocador)
    'public.cancel_calendar_occurrence(jsonb)',
    'public.create_calendar_lesson(jsonb)',
    'public.reschedule_calendar_occurrence(jsonb)',
    'public.rename_custom_level(uuid, text)',
    'public.apply_recurrence_participants_from_date(jsonb)',
    'public.create_recurrence_series(jsonb)',
    'public.split_recurrence_this_and_future(jsonb)',
    -- Utilitarios y disparador
    'public.set_updated_at()',
    'public._normalize_email(text)',
    'public._normalize_phone(text)',
    'public._field_override_allowlist(text)'
  ];
begin
  foreach v_signature in array v_signatures
  loop
    if to_regprocedure(v_signature) is not null then
      execute format('alter function %s set search_path = %L', v_signature, '');
    else
      raise notice 'R5: % no existe en esta base; se omite.', v_signature;
    end if;
  end loop;
end
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
