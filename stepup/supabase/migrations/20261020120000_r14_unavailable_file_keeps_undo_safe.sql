-- R14 — Declarar que el teléfono ya no tiene un archivo NO impide deshacer la importación. ADITIVA e idempotente. NO se aplica a Production sin autorización. Depende de R10.
--
-- Qué resuelve: `register_transfer_file` actualiza la instantánea de la importación cuando registra un archivo copiado (así «deshacer» sigue siendo seguro), pero
-- `mark_transfer_file_unavailable` (el teléfono ya no tenía el archivo) cambiaba la fila del adjunto SIN actualizar la instantánea. `preview_undo_backup_import` veía entonces la fila
-- «editada después de la importación» y bloqueaba deshacer toda la importación (el alumno y la clase del adjunto figuraban con «datos creados después»), de modo que después de declarar
-- UN solo archivo ausente ya no se podía rehacer la importación con una copia más reciente. Esta migración hace lo mismo que el registro: refresca la instantánea de esa fila.
-- No cambia ninguna otra función, tabla ni dato. Reversión: supabase/repairs/r14_unavailable_file_rollback.sql (vuelve a la definición de R10).

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
    -- Igual que al registrar un archivo: el cambio es parte del traslado, así que la instantánea de la importación se actualiza y deshacer sigue siendo seguro.
    update public.import_run_row_snapshots rs set new_row = to_jsonb(t)
      from public.lesson_attachments t, public.import_runs ir
     where t.owner_id = v_owner and t.legacy_mobile_id = p_legacy_id and t.file_status = 'no_disponible'
       and rs.table_name = 'lesson_attachments' and rs.row_id = t.id and rs.action = 'inserted'
       and ir.id = rs.import_run_id and ir.owner_id = v_owner and ir.status = 'applied';
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
