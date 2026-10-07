-- Funciones de la app móvil tal como existen en el proyecto REAL (copiadas de pg_get_functiondef de Production el 7/oct/2026). Se crean FUERA de este
-- repositorio (en las migraciones de la app móvil); acá sólo sirven para que las pruebas en Postgres real las tengan. Con `search_path=public`,
-- exactamente como están hoy: R5 las deja en `search_path` vacío. Los textos de error conservan la codificación tal cual está en la base.

CREATE OR REPLACE FUNCTION public.fetch_latest_cloud_backup_timestamp()
 RETURNS TABLE(created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'No hay una sesiÃ³n autenticada.';
  end if;

  return query
    select cb.created_at
      from public.cloud_backups cb
      where cb.user_id = v_user_id
      order by cb.created_at desc
      limit 1;
end;
$function$;

revoke all on function fetch_latest_cloud_backup_timestamp() from public;
revoke all on function fetch_latest_cloud_backup_timestamp() from anon;
grant execute on function fetch_latest_cloud_backup_timestamp() to authenticated;

CREATE OR REPLACE FUNCTION public.transfer_active_session(p_device_id text)
 RETURNS TABLE(generation bigint, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9._-]{8,200}$' then
    raise exception 'device_id inválido.';
  end if;

  return query
    insert into public.active_sessions (user_id, device_id, generation, authorized_at, expires_at, last_seen_at)
    values (v_user_id, p_device_id, 1, now(), now() + interval '24 hours', now())
    on conflict (user_id) do update
      set device_id = excluded.device_id,
          generation = case
            when public.active_sessions.device_id = excluded.device_id
              then public.active_sessions.generation
            else public.active_sessions.generation + 1
          end,
          authorized_at = now(),
          expires_at = now() + interval '24 hours',
          last_seen_at = now()
    returning public.active_sessions.generation, public.active_sessions.expires_at;
end;
$function$;

revoke all on function transfer_active_session(text) from public;
revoke all on function transfer_active_session(text) from anon;
grant execute on function transfer_active_session(text) to authenticated;

CREATE OR REPLACE FUNCTION public.touch_active_session(p_device_id text)
 RETURNS TABLE(generation bigint, expires_at timestamp with time zone, is_current_device boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_current public.active_sessions;
begin
  if v_user_id is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9._-]{8,200}$' then
    raise exception 'device_id inválido.';
  end if;

  select * into v_current from public.active_sessions where user_id = v_user_id;
  if not found then
    return;
  end if;

  if v_current.device_id = p_device_id then
    update public.active_sessions
      set last_seen_at = now(),
          expires_at = now() + interval '24 hours'
      where user_id = v_user_id
      returning * into v_current;
  end if;

  return query select v_current.generation, v_current.expires_at, (v_current.device_id = p_device_id);
end;
$function$;

revoke all on function touch_active_session(text) from public;
revoke all on function touch_active_session(text) from anon;
grant execute on function touch_active_session(text) to authenticated;

CREATE OR REPLACE FUNCTION public.upload_cloud_backup(p_device_id text, p_generation bigint, p_schema_version integer, p_app_version text, p_payload jsonb)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, checksum text, is_duplicate boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_checksum text;
  v_existing_id uuid;
  v_existing_created_at timestamptz;
  v_new_id uuid;
  v_new_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'No hay una sesiÃ³n autenticada.';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9._-]{8,200}$' then
    raise exception 'device_id invÃ¡lido.';
  end if;
  if p_generation is null or p_generation < 1 then
    raise exception 'generation invÃ¡lida.';
  end if;
  if p_schema_version is null or p_schema_version < 1 then
    raise exception 'schema_version invÃ¡lida.';
  end if;
  if p_payload is null then
    raise exception 'payload vacÃ­o.';
  end if;
  if pg_column_size(p_payload) > 20 * 1024 * 1024 then
    raise exception 'El respaldo supera el tamaÃ±o mÃ¡ximo permitido.';
  end if;

  if not exists (
    select 1 from public.active_sessions as asess
      where asess.user_id = v_user_id
        and asess.device_id = p_device_id
        and asess.generation = p_generation
  ) then
    raise exception 'Este dispositivo ya no estÃ¡ autorizado para subir respaldos.';
  end if;

  -- extensions.digest calificado explÃ­citamente (correcciÃ³n anterior,
  -- 20260717120000) â€” nunca ampliar el search_path para "resolverlo".
  v_checksum := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'::text), 'hex');

  select cb.id, cb.created_at into v_existing_id, v_existing_created_at
    from public.cloud_backups as cb
    where cb.user_id = v_user_id and cb.checksum = v_checksum;

  if found then
    return query select v_existing_id, v_existing_created_at, v_checksum, true;
    return;
  end if;

  insert into public.cloud_backups as cb_insert (user_id, device_id, schema_version, app_version, checksum, payload)
    values (v_user_id, p_device_id, p_schema_version, p_app_version, v_checksum, p_payload)
    returning cb_insert.id, cb_insert.created_at into v_new_id, v_new_created_at;

  -- CorrecciÃ³n confirmada: cada columna calificada con su alias â€” nunca
  -- una referencia suelta a id/created_at/user_id que pueda confundirse
  -- con las variables de salida de la funciÃ³n.
  delete from public.cloud_backups as cb_delete
    where cb_delete.user_id = v_user_id
      and cb_delete.id not in (
        select cb_keep.id
        from public.cloud_backups as cb_keep
        where cb_keep.user_id = v_user_id
        order by cb_keep.created_at desc
        limit 10
      );

  return query select v_new_id, v_new_created_at, v_checksum, false;
end;
$function$;

revoke all on function upload_cloud_backup(text,bigint,integer,text,jsonb) from public;
revoke all on function upload_cloud_backup(text,bigint,integer,text,jsonb) from anon;
grant execute on function upload_cloud_backup(text,bigint,integer,text,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.fetch_latest_cloud_backup(p_device_id text, p_generation bigint)
 RETURNS TABLE(id uuid, device_id text, schema_version integer, app_version text, checksum text, payload jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9._-]{8,200}$' then
    raise exception 'device_id inválido.';
  end if;
  if p_generation is null or p_generation < 1 then
    raise exception 'generation inválida.';
  end if;

  if not exists (
    select 1 from public.active_sessions as asess
      where asess.user_id = v_user_id
        and asess.device_id = p_device_id
        and asess.generation = p_generation
  ) then
    raise exception 'Este dispositivo ya no está autorizado para leer respaldos.';
  end if;

  return query
    select cb.id, cb.device_id, cb.schema_version, cb.app_version, cb.checksum, cb.payload, cb.created_at
      from public.cloud_backups as cb
      where cb.user_id = v_user_id
      order by cb.created_at desc
      limit 1;
end;
$function$;

revoke all on function fetch_latest_cloud_backup(text,bigint) from public;
revoke all on function fetch_latest_cloud_backup(text,bigint) from anon;
grant execute on function fetch_latest_cloud_backup(text,bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.fetch_recent_cloud_backups(p_device_id text, p_generation bigint, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, device_id text, schema_version integer, app_version text, checksum text, payload jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_limit integer;
begin
  if v_user_id is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9._-]{8,200}$' then
    raise exception 'device_id inválido.';
  end if;
  if p_generation is null or p_generation < 1 then
    raise exception 'generation inválida.';
  end if;

  if not exists (
    select 1 from public.active_sessions as asess
      where asess.user_id = v_user_id
        and asess.device_id = p_device_id
        and asess.generation = p_generation
  ) then
    raise exception 'Este dispositivo ya no está autorizado para leer respaldos.';
  end if;

  -- Nunca más de 10 (coincide con la retención real de `upload_cloud_backup`,
  -- que nunca conserva más de 10 copias por cuenta) ni menos de 1.
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 10);

  return query
    select cb.id, cb.device_id, cb.schema_version, cb.app_version, cb.checksum, cb.payload, cb.created_at
      from public.cloud_backups as cb
      where cb.user_id = v_user_id
      order by cb.created_at desc
      limit v_limit;
end;
$function$;

revoke all on function fetch_recent_cloud_backups(text,bigint,integer) from public;
revoke all on function fetch_recent_cloud_backups(text,bigint,integer) from anon;
grant execute on function fetch_recent_cloud_backups(text,bigint,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_own_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'No hay una sesión autenticada.';
  end if;

  -- Cascada automática vía las FK ya existentes: esto también borra
  -- active_sessions y cloud_backups de esta cuenta, sin necesidad de
  -- borrarlos acá explícitamente.
  delete from auth.users where id = v_user_id;
end;
$function$;

revoke all on function delete_own_account() from public;
revoke all on function delete_own_account() from anon;
grant execute on function delete_own_account() to authenticated;

CREATE OR REPLACE FUNCTION public.end_active_session(p_device_id text, p_generation bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9._-]{8,200}$' then
    raise exception 'device_id inválido.';
  end if;
  if p_generation is null or p_generation < 1 then
    raise exception 'generation inválida.';
  end if;

  delete from public.active_sessions
    where user_id = v_user_id
      and device_id = p_device_id
      and generation = p_generation;
end;
$function$;

revoke all on function end_active_session(text,bigint) from public;
revoke all on function end_active_session(text,bigint) from anon;
grant execute on function end_active_session(text,bigint) to authenticated;

