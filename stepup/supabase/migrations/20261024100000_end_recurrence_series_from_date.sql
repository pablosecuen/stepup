-- TeacherFlow Web — «Esta y todas las series»: quitar UNA serie desde una fecha, en UNA sola transacción.
--
-- Problema (24/10/2026): la acción hacía dos escrituras separadas desde el servidor (cortar o cerrar las reglas, y después cancelar las clases futuras ya creadas).
-- Si fallaba la segunda quedaba la serie cortada y las clases futuras sin tratar, y había que reintentar a mano.
--
-- `end_recurrence_series_from_date` hace las dos cosas en la transacción de esta función: o se cortan/cierran las reglas Y se cancelan las clases futuras, o no cambia nada.
-- Sólo toca LAS reglas que se le pasan (la serie elegida, su tramo vigente y los anteriores que siguen corriendo): ninguna otra serie. Nunca borra una fila: las clases
-- dictadas, los registros, los cobros, los pagos y los adjuntos no se tocan; una clase futura con registro (aunque sea un borrador) tampoco se cancela.
-- Idempotente: repetir la misma operación no cambia nada ni falla (los cortes sólo se aplican si la regla todavía termina después de la fecha o no termina; lo ya cerrado o
-- cancelado se deja como está). Security invoker: corre con los permisos y la RLS de quien llama; una regla que no es suya no existe a sus ojos (P0002 y se revierte todo).
--
-- p_payload = {
--   "truncate": [{ "id": uuid, "end_date": "YYYY-MM-DD" }, ...],   -- reglas que ya tenían clases antes de la fecha: se les pone fecha de fin
--   "end": [uuid, ...],                                              -- reglas que empezaban en o después de la fecha: se cierran por estado
--   "effective_date": "YYYY-MM-DD",                                  -- desde esta fecha (inclusive, hora civil de la cuenta) se cancelan las clases futuras programadas sin registro
--   "timezone": "America/Argentina/Buenos_Aires"
-- }
-- Devuelve { truncated, ended, cancelled } (cuántas reglas se cortaron, cuántas se cerraron y cuántas clases se cancelaron en ESTA llamada).

create or replace function public.end_recurrence_series_from_date(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_effective date;
  v_timezone text := coalesce(nullif(p_payload->>'timezone', ''), 'America/Argentina/Buenos_Aires');
  v_cut jsonb;
  v_rule_id uuid;
  v_end_date date;
  v_count int;
  v_truncated int := 0;
  v_ended int := 0;
  v_cancelled int := 0;
  v_all_ids uuid[] := '{}';
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  v_effective := nullif(p_payload->>'effective_date', '')::date;
  if v_effective is null then
    raise exception 'Falta la fecha desde la que se quita la serie.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_payload->'truncate'), 'array') <> 'array' or coalesce(jsonb_typeof(p_payload->'end'), 'array') <> 'array' then
    raise exception 'El plan para quitar la serie no es válido.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payload->'truncate', '[]'::jsonb)) + jsonb_array_length(coalesce(p_payload->'end', '[]'::jsonb)) = 0 then
    raise exception 'No hay ninguna serie para quitar.' using errcode = '22023';
  end if;

  -- 1) Cortes: la regla termina el día anterior a la fecha. Sólo se aplica si todavía no termina antes (repetir no cambia nada).
  for v_cut in select * from jsonb_array_elements(coalesce(p_payload->'truncate', '[]'::jsonb))
  loop
    v_rule_id := nullif(v_cut->>'id', '')::uuid;
    v_end_date := nullif(v_cut->>'end_date', '')::date;
    if v_rule_id is null or v_end_date is null or v_end_date >= v_effective then
      raise exception 'Un corte de serie no es válido.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.recurrence_rules where id = v_rule_id and owner_id = v_owner) then
      raise exception 'La serie % no existe o no te pertenece.', v_rule_id using errcode = 'P0002';
    end if;
    update public.recurrence_rules
      set end_date = v_end_date
      where id = v_rule_id and owner_id = v_owner and status <> 'ended' and (end_date is null or end_date > v_end_date) and start_date <= v_end_date;
    get diagnostics v_count = row_count;
    v_truncated := v_truncated + v_count;
    v_all_ids := v_all_ids || v_rule_id;
  end loop;

  -- 2) Cierres: las reglas que todavía no habían empezado se cierran por estado (nunca se fabrica una fecha de fin anterior al inicio).
  for v_rule_id in select (value)::uuid from jsonb_array_elements_text(coalesce(p_payload->'end', '[]'::jsonb))
  loop
    if not exists (select 1 from public.recurrence_rules where id = v_rule_id and owner_id = v_owner) then
      raise exception 'La serie % no existe o no te pertenece.', v_rule_id using errcode = 'P0002';
    end if;
    update public.recurrence_rules set status = 'ended' where id = v_rule_id and owner_id = v_owner and status <> 'ended';
    get diagnostics v_count = row_count;
    v_ended := v_ended + v_count;
    v_all_ids := v_all_ids || v_rule_id;
  end loop;

  -- 3) Las clases ya creadas de esas series, desde la fecha, todavía «programadas» y sin ningún registro: pasan a canceladas (no se borran).
  update public.calendar_lessons cl
    set status = 'cancelled'
    where cl.owner_id = v_owner
      and cl.recurrence_id = any (v_all_ids)
      and cl.status = 'scheduled'
      and (timezone(v_timezone, coalesce(cl.recurrence_original_start, cl.start_at)))::date >= v_effective
      and not exists (select 1 from public.lesson_registrations r where r.calendar_lesson_id = cl.id and r.owner_id = v_owner);
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('truncated', v_truncated, 'ended', v_ended, 'cancelled', v_cancelled);
end;
$$;

revoke all on function public.end_recurrence_series_from_date(jsonb) from public, anon;
grant execute on function public.end_recurrence_series_from_date(jsonb) to authenticated;
