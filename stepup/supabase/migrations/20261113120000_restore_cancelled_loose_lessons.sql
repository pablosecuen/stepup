-- Restaurar una clase CANCELADA desde el historial de canceladas del Calendario.
--
-- La función vigente (20261027100000) sólo restauraba ocurrencias de una serie con clave de ocurrencia. Una clase suelta cancelada, o una clase que ya había sido movida y después se canceló
-- (fila real sin clave de ocurrencia), no tenía forma de volver a la agenda. Se redefine con `create or replace` (nada histórico se edita) conservando TODAS las protecciones anteriores y sumando:
--   · clase suelta o movida (sin clave de ocurrencia), SÓLO si está cancelada: vuelve a `scheduled` en SU PROPIO horario (no hay otra fecha original);
--   · una clase que ya tiene un reemplazo vigente (otra clase la sustituye por `freed_by_lesson_id` o la serie fue reemplazada) no se restaura: se superpondría con la sustituta.
-- Sin cambios: ocurrencia de serie cancelada o reprogramada vuelve a su fecha original y deja de ser excepción (no queda duplicada); nunca con registro o cobro asociado; repetir es idempotente.
create or replace function public.restore_calendar_occurrence(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_lesson public.calendar_lessons;
  v_original timestamptz;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  select * into v_lesson from public.calendar_lessons where id = nullif(p_payload->>'lesson_id', '')::uuid and owner_id = v_owner for update;
  if not found then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;
  if v_lesson.status = 'scheduled' then
    return v_lesson; -- ya estaba restaurada (reintento)
  end if;
  if v_lesson.status not in ('cancelled', 'rescheduled') then
    raise exception 'Sólo se restaura una clase cancelada o reprogramada.' using errcode = '22023';
  end if;
  if v_lesson.recurrence_id is null or v_lesson.recurrence_occurrence_key is null then
    -- Clase suelta o clase movida: sólo la CANCELADA vuelve (en su propio horario). Un origen reprogramado sin clave no se restaura: su destino sigue vigente.
    if v_lesson.status <> 'cancelled' then
      raise exception 'La clase cancelada no pertenece a una repetición: no hay una fecha original para restaurar.' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.lesson_registrations r where r.calendar_lesson_id = v_lesson.id and r.owner_id = v_owner)
     or exists (select 1 from public.payment_charges c where c.calendar_lesson_id = v_lesson.id and c.owner_id = v_owner) then
    raise exception 'Esta clase tiene un registro o un cobro asociado: no se restaura para conservar el historial.' using errcode = '22023';
  end if;
  if exists (select 1 from public.calendar_lessons n where n.owner_id = v_owner and n.freed_by_lesson_id = v_lesson.id and n.status <> 'cancelled')
     or exists (select 1 from public.calendar_series_replacement_links l where l.owner_id = v_owner and l.original_lesson_id = v_lesson.id) then
    raise exception 'Esta clase ya fue reemplazada por otra: no se restaura.' using errcode = '22023';
  end if;

  if v_lesson.recurrence_id is not null and v_lesson.recurrence_occurrence_key is not null then
    v_original := coalesce(v_lesson.recurrence_original_start, v_lesson.start_at);
    update public.calendar_lessons
      set status = 'scheduled', start_at = v_original, end_at = v_original + (v_lesson.end_at - v_lesson.start_at), recurrence_original_start = v_original
      where id = v_lesson.id and owner_id = v_owner
      returning * into v_lesson;

    delete from public.recurrence_exceptions
      where owner_id = v_owner and recurrence_id = v_lesson.recurrence_id and occurrence_key = v_lesson.recurrence_occurrence_key and exception_type in ('cancelled', 'rescheduled');
  else
    update public.calendar_lessons
      set status = 'scheduled'
      where id = v_lesson.id and owner_id = v_owner
      returning * into v_lesson;
  end if;

  return v_lesson;
end;
$$;

revoke all on function public.restore_calendar_occurrence(jsonb) from public, anon;
grant execute on function public.restore_calendar_occurrence(jsonb) to authenticated;
