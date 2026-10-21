-- Adjuntos (PDF / fotos) y biblioteca de materiales: escritura desde la web, con la misma capacidad que la app anterior.
--
-- Aditiva e idempotente: no reescribe ninguna fila histórica ni borra nada.
--   • `lesson_attachments.removed_at`: «quitar» un adjunto lo oculta (nunca borra la fila ni el archivo; el archivo queda en el almacenamiento).
--   • `add_lesson_attachment` / `set_lesson_attachment_caption` / `remove_lesson_attachment`: adjuntos de una clase registrada (individual o grupal).
--   • `add_material_library_item`: material nuevo de la biblioteca (nombre, nota y PDF opcional), reutilizable en cualquier clase.
--   • `apply_lesson_pedagogical_content` acepta además `material_ids` (materiales usados en la clase); sin esa clave no cambia nada (llamadores anteriores).
-- Los archivos se suben al bucket privado `lesson-files` (carpeta de la propia cuenta, políticas ya existentes) con una URL de subida firmada y recién después se registran acá: la base
-- verifica que el objeto exista de verdad, que pertenezca a la cuenta y que el tamaño coincida.
begin;

alter table public.lesson_attachments add column if not exists removed_at timestamptz;
comment on column public.lesson_attachments.removed_at is 'Instante en que la profesora quitó el adjunto de la clase. NULL = vigente. Nunca se borra la fila ni el archivo.';

-- Tipos aceptados y topes (los mismos de la app anterior: PDF hasta 20 MB, fotos hasta 10 MB). El bucket aplica además su propio tope de 20 MiB.
create or replace function public._lesson_file_check(p_kind text, p_mime text, p_size bigint)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_kind not in ('pdf', 'image') then raise exception 'Tipo de archivo no válido.' using errcode = '22023'; end if;
  if p_size is null or p_size <= 0 then raise exception 'El tamaño del archivo no es válido.' using errcode = '22023'; end if;
  if p_kind = 'pdf' then
    if p_mime is distinct from 'application/pdf' then raise exception 'El archivo no es un PDF.' using errcode = '22023'; end if;
    if p_size > 20971520 then raise exception 'El PDF supera los 20 MB.' using errcode = '22023'; end if;
  else
    if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then raise exception 'La foto debe ser JPG, PNG, WebP o HEIC.' using errcode = '22023'; end if;
    if p_size > 10485760 then raise exception 'La foto supera los 10 MB.' using errcode = '22023'; end if;
  end if;
end;
$$;
revoke all on function public._lesson_file_check(text, text, bigint) from public, anon, authenticated;

-- El archivo tiene que existir DE VERDAD en el almacenamiento, bajo la carpeta de la cuenta y con el tamaño declarado.
create or replace function public._lesson_file_stored(p_owner uuid, p_path text, p_expected_prefix text, p_size bigint)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_stored bigint;
begin
  if p_path is null or p_path like '%..%' or left(p_path, length(p_expected_prefix)) <> p_expected_prefix or split_part(p_path, '/', 1) <> p_owner::text then
    raise exception 'La ruta del archivo no es válida.' using errcode = '22023';
  end if;
  select (o.metadata ->> 'size')::bigint into v_stored from storage.objects o where o.bucket_id = 'lesson-files' and o.name = p_path;
  if not found then raise exception 'El archivo todavía no se subió.' using errcode = 'P0002'; end if;
  if v_stored is not null and v_stored <> p_size then raise exception 'El tamaño del archivo subido no coincide.' using errcode = '22023'; end if;
end;
$$;
revoke all on function public._lesson_file_stored(uuid, text, text, bigint) from public, anon, authenticated;

create or replace function public.add_lesson_attachment(p_registration_id uuid, p_attachment jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_kind text;
  v_mime text;
  v_size bigint;
  v_caption text;
  v_student uuid;
  v_path text;
  v_sha text;
  v_existing public.lesson_attachments;
  v_row public.lesson_attachments;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if jsonb_typeof(p_attachment) is distinct from 'object' then raise exception 'Adjunto inválido.' using errcode = '22023'; end if;
  perform 1 from public.lesson_registrations where id = p_registration_id and owner_id = v_owner for update;
  if not found then raise exception 'Registro no encontrado.' using errcode = 'P0002'; end if;

  v_id := (p_attachment ->> 'id')::uuid;
  v_name := btrim(coalesce(p_attachment ->> 'name', ''));
  v_kind := p_attachment ->> 'kind';
  v_mime := p_attachment ->> 'mime_type';
  v_size := (p_attachment ->> 'size_bytes')::bigint;
  v_caption := nullif(btrim(coalesce(p_attachment ->> 'caption', '')), '');
  v_student := nullif(p_attachment ->> 'student_id', '')::uuid;
  v_path := p_attachment ->> 'storage_path';
  v_sha := nullif(p_attachment ->> 'sha256', '');
  if v_id is null then raise exception 'Adjunto inválido.' using errcode = '22023'; end if;
  if v_name = '' or length(v_name) > 200 then raise exception 'El nombre del archivo no es válido.' using errcode = '22023'; end if;
  if v_caption is not null and length(v_caption) > 500 then raise exception 'La descripción es demasiado larga.' using errcode = '22023'; end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then raise exception 'La huella del archivo no es válida.' using errcode = '22023'; end if;
  perform public._lesson_file_check(v_kind, v_mime, v_size);
  if v_student is not null and not exists (select 1 from public.lesson_registration_students s where s.lesson_registration_id = p_registration_id and s.student_id = v_student and s.owner_id = v_owner) then
    raise exception 'Ese alumno no forma parte de este registro.' using errcode = 'P0002';
  end if;

  -- Idempotente: el mismo identificador (generado una vez por el navegador) nunca duplica el adjunto.
  select * into v_existing from public.lesson_attachments where owner_id = v_owner and legacy_mobile_id = 'web_' || v_id::text;
  if found then
    if v_existing.lesson_registration_id <> p_registration_id then raise exception 'Adjunto inválido.' using errcode = '22023'; end if;
    return jsonb_build_object('id', v_existing.id, 'deduplicated', true);
  end if;

  perform public._lesson_file_stored(v_owner, v_path, v_owner::text || '/web/' || p_registration_id::text || '/' || v_id::text || '.', v_size);

  insert into public.lesson_attachments (owner_id, legacy_mobile_id, lesson_registration_id, student_id, name, kind, mime_type, size_bytes, caption, added_at, storage_path, sha256, stored_size_bytes, file_status)
  values (v_owner, 'web_' || v_id::text, p_registration_id, v_student, v_name, v_kind, v_mime, v_size, v_caption, now(), v_path, v_sha, v_size, 'disponible')
  returning * into v_row;
  update public.lesson_registrations set updated_at = now() where id = p_registration_id and owner_id = v_owner;
  return jsonb_build_object('id', v_row.id, 'deduplicated', false);
end;
$$;
revoke all on function public.add_lesson_attachment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_lesson_attachment(uuid, jsonb) to authenticated;

create or replace function public.set_lesson_attachment_caption(p_attachment_id uuid, p_caption text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if v_caption is not null and length(v_caption) > 500 then raise exception 'La descripción es demasiado larga.' using errcode = '22023'; end if;
  update public.lesson_attachments set caption = v_caption where id = p_attachment_id and owner_id = v_owner and removed_at is null;
  if not found then raise exception 'Adjunto no encontrado.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.set_lesson_attachment_caption(uuid, text) from public, anon, authenticated;
grant execute on function public.set_lesson_attachment_caption(uuid, text) to authenticated;

create or replace function public.remove_lesson_attachment(p_attachment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  update public.lesson_attachments set removed_at = coalesce(removed_at, now()) where id = p_attachment_id and owner_id = v_owner;
  if not found then raise exception 'Adjunto no encontrado.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.remove_lesson_attachment(uuid) from public, anon, authenticated;
grant execute on function public.remove_lesson_attachment(uuid) to authenticated;

create or replace function public.add_material_library_item(p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_note text;
  v_att jsonb;
  v_existing public.material_library_items;
  v_row public.material_library_items;
  v_att_name text; v_att_mime text; v_att_size bigint; v_att_path text; v_att_sha text;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if jsonb_typeof(p_item) is distinct from 'object' then raise exception 'Material inválido.' using errcode = '22023'; end if;
  v_id := (p_item ->> 'id')::uuid;
  v_name := btrim(coalesce(p_item ->> 'name', ''));
  v_note := nullif(btrim(coalesce(p_item ->> 'note', '')), '');
  v_att := nullif(p_item -> 'attachment', 'null'::jsonb);
  if v_id is null then raise exception 'Material inválido.' using errcode = '22023'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'Ponele un nombre al material (hasta 120 letras).' using errcode = '22023'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'La nota es demasiado larga.' using errcode = '22023'; end if;

  select * into v_existing from public.material_library_items where owner_id = v_owner and legacy_mobile_id = 'web_' || v_id::text;
  if found then return jsonb_build_object('id', v_existing.id, 'legacy_id', v_existing.legacy_mobile_id, 'deduplicated', true); end if;

  if v_att is not null then
    if jsonb_typeof(v_att) is distinct from 'object' then raise exception 'Material inválido.' using errcode = '22023'; end if;
    v_att_name := btrim(coalesce(v_att ->> 'name', ''));
    v_att_mime := v_att ->> 'mime_type';
    v_att_size := (v_att ->> 'size_bytes')::bigint;
    v_att_path := v_att ->> 'storage_path';
    v_att_sha := nullif(v_att ->> 'sha256', '');
    if v_att_name = '' or length(v_att_name) > 200 then raise exception 'El nombre del archivo no es válido.' using errcode = '22023'; end if;
    if v_att_sha is not null and v_att_sha !~ '^[0-9a-f]{64}$' then raise exception 'La huella del archivo no es válida.' using errcode = '22023'; end if;
    perform public._lesson_file_check('pdf', v_att_mime, v_att_size);
    perform public._lesson_file_stored(v_owner, v_att_path, v_owner::text || '/web-materials/' || v_id::text || '.', v_att_size);
  end if;

  insert into public.material_library_items (owner_id, legacy_mobile_id, name, note, created_at, attachment_name, attachment_kind, attachment_mime_type, attachment_size_bytes, attachment_added_at, storage_path, sha256, stored_size_bytes, file_status)
  values (v_owner, 'web_' || v_id::text, v_name, v_note, now(),
          v_att_name, case when v_att is null then null else 'pdf' end, v_att_mime, v_att_size, case when v_att is null then null else now() end,
          v_att_path, v_att_sha, v_att_size, case when v_att is null then 'sin_archivo' else 'disponible' end)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'legacy_id', v_row.legacy_mobile_id, 'deduplicated', false);
end;
$$;
revoke all on function public.add_material_library_item(jsonb) from public, anon, authenticated;
grant execute on function public.add_material_library_item(jsonb) to authenticated;

-- Contenido pedagógico + materiales usados. Redefine el ayudante común (lo llaman guardar borrador, guardar participante, finalizar y editar): sin `material_ids` hace exactamente lo de antes.
create or replace function public.apply_lesson_pedagogical_content(p_registration_id uuid, p_content jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_current text[]; v_new text[];
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if jsonb_typeof(p_content) is distinct from 'object'
     or jsonb_typeof(p_content->'topics') is distinct from 'array'
     or jsonb_typeof(p_content->'objectives') is distinct from 'array'
     or jsonb_typeof(p_content->'activities') is distinct from 'array'
     or jsonb_typeof(p_content->'activity_notes') is distinct from 'string'
     or jsonb_typeof(p_content->'internal_notes') is distinct from 'string' then
    raise exception 'Contenido pedagógico inválido.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_content->'topics') t
     where jsonb_typeof(t) is distinct from 'object' or jsonb_typeof(t->'text') is distinct from 'string'
       or btrim(t->>'text') = '' or coalesce(t->>'status', '') not in ('planificado','visto')
       or jsonb_typeof(t->'id') not in ('string','null') or not (t ? 'id'))
     or exists (select 1 from jsonb_array_elements((p_content->'objectives') || (p_content->'activities')) t
       where jsonb_typeof(t) is distinct from 'string' or btrim(t #>> '{}') = '') then
    raise exception 'Revisá los temas, objetivos y actividades.' using errcode = '22023';
  end if;

  select material_ids into v_current from public.lesson_registrations where id = p_registration_id and owner_id = v_owner;
  if not found then raise exception 'Registro no encontrado.' using errcode = 'P0002'; end if;
  v_new := v_current;
  if p_content ? 'material_ids' then
    if jsonb_typeof(p_content->'material_ids') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(p_content->'material_ids') m where jsonb_typeof(m) is distinct from 'string' or btrim(m #>> '{}') = '' or length(m #>> '{}') > 80) then
      raise exception 'Revisá los materiales de la clase.' using errcode = '22023';
    end if;
    v_new := array(select distinct m from jsonb_array_elements_text(p_content->'material_ids') m);
    -- Sólo materiales de la biblioteca de la cuenta, o los que la clase YA tenía (un material importado que todavía no está en la biblioteca no se pierde).
    if exists (select 1 from unnest(v_new) m
               where m <> all (coalesce(v_current, '{}'::text[]))
                 and not exists (select 1 from public.material_library_items l where l.owner_id = v_owner and l.legacy_mobile_id = m)) then
      raise exception 'Ese material no está en tu biblioteca.' using errcode = '22023';
    end if;
  end if;

  update public.lesson_registrations set
    topics = p_content->'topics',
    objectives = array(select jsonb_array_elements_text(p_content->'objectives')),
    activities = array(select jsonb_array_elements_text(p_content->'activities')),
    activity_notes = p_content->>'activity_notes', internal_notes = p_content->>'internal_notes',
    material_ids = v_new, updated_at = now()
    where id = p_registration_id and owner_id = v_owner;
end;
$$;
revoke all on function public.apply_lesson_pedagogical_content(uuid, jsonb) from public, anon, authenticated;

commit;
