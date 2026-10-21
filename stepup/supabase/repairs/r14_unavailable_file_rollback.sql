-- Rollback de R14: vuelve a la definición de R10 de `mark_transfer_file_unavailable` (no refresca la instantánea de la importación).
-- Con esta versión, declarar un archivo ausente vuelve a bloquear «deshacer» la importación de ese adjunto.

create or replace function public.mark_transfer_file_unavailable(p_kind text, p_legacy_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_rows int := 0;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if p_kind = 'lesson_attachment' then
    update public.lesson_attachments set file_status = 'no_disponible' where owner_id = v_owner and legacy_mobile_id = p_legacy_id and file_status = 'pendiente';
    get diagnostics v_rows = row_count;
  elsif p_kind = 'material' then
    update public.material_library_items set file_status = 'no_disponible' where owner_id = v_owner and legacy_mobile_id = p_legacy_id and file_status = 'pendiente';
    get diagnostics v_rows = row_count;
  else
    raise exception 'Tipo de archivo desconocido.' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', p_kind, 'marked', v_rows);
end;
$$;
revoke all on function public.mark_transfer_file_unavailable(text, text) from public, anon;
grant execute on function public.mark_transfer_file_unavailable(text, text) to authenticated;
