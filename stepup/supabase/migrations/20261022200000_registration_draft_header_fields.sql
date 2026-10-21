-- «Guardar progreso» de un registro todavía en curso guarda TODO lo que la profesora cargó, no sólo el contenido pedagógico: también la
-- tarea para la próxima clase (descripción y fecha de entrega) y la duración real. Antes esos tres datos sólo se guardaban al finalizar, así
-- que salir y volver a abrir un progreso guardado los perdía en silencio.
--
-- Aditiva e idempotente (create or replace): el pedido de siempre (sólo `lesson_registration_id` + `pedagogical_content`) se comporta igual;
-- cada campo nuevo sólo se toca cuando viene en el pedido (mismo criterio que `finalize_lesson_registration`). Sigue rechazando un registro
-- ya finalizado y nunca cambia el estado, la asistencia ni los participantes.
create or replace function public.save_lesson_content_draft(p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_row public.lesson_registrations;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  select * into v_row from public.lesson_registrations
    where id = (p_payload->>'lesson_registration_id')::uuid and owner_id = v_owner for update;
  if not found then raise exception 'Registro no encontrado.' using errcode = 'P0002'; end if;
  if v_row.status = 'completed' then raise exception 'Usá Guardar cambios para editar un registro finalizado.' using errcode = '22023'; end if;
  perform public.apply_lesson_pedagogical_content(v_row.id, p_payload->'pedagogical_content');

  if p_payload ? 'homework_description' or p_payload ? 'homework_due_date' or p_payload ? 'actual_started_at' or p_payload ? 'actual_ended_at' then
    update public.lesson_registrations
    set
      homework_description = case when p_payload ? 'homework_description' then nullif(p_payload->>'homework_description', '') else homework_description end,
      homework_due_date = case when p_payload ? 'homework_due_date' then nullif(p_payload->>'homework_due_date', '')::date else homework_due_date end,
      actual_started_at = case when p_payload ? 'actual_started_at' then nullif(p_payload->>'actual_started_at', '')::timestamptz else actual_started_at end,
      actual_ended_at = case when p_payload ? 'actual_ended_at' then nullif(p_payload->>'actual_ended_at', '')::timestamptz else actual_ended_at end,
      updated_at = now()
    where id = v_row.id and owner_id = v_owner
    returning * into v_row;
    if v_row.actual_started_at is not null and v_row.actual_ended_at is not null and v_row.actual_ended_at <= v_row.actual_started_at then
      raise exception 'La hora de fin real debe ser posterior a la de inicio.' using errcode = '22023';
    end if;
  end if;
end;
$$;
revoke all on function public.save_lesson_content_draft(jsonb) from public, anon, authenticated;
grant execute on function public.save_lesson_content_draft(jsonb) to authenticated;
