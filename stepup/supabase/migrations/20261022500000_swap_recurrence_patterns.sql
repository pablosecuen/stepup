-- TeacherFlow Web — intercambio de horarios entre dos series: ambos cambios o ninguno.
--
-- Problema (22/10/2026, cuenta real): para que dos series intercambien horario hacía falta cambiar una y después la otra; mientras tanto
-- las dos quedaban superpuestas y, si el segundo cambio no se completaba, la primera ya había cambiado sola.
--
-- `swap_recurrence_patterns` aplica DOS cortes «esta y las siguientes» (`split_recurrence_this_and_future`, sin cambios) en UNA sola
-- transacción —la de esta función— y, para cada lado, finaliza los tramos posteriores al que cubre la fecha efectiva (la serie nueva los
-- reemplaza). Cualquier error en cualquiera de los dos lados revierte TODO: nunca queda una serie cambiada y la otra no.
--
-- La función sólo orquesta: la validación contra terceras clases y la disponibilidad la hace el servidor ANTES de llamarla (el choque entre
-- ambas series en ese momento es justamente lo que el intercambio resuelve, así que no se «ignora» ningún conflicto: se calcula el
-- resultado final de las dos y ése es el que se valida). Security invoker: cada corte corre con los permisos y la RLS de quien llama.
-- Idempotente: reintentar el mismo intercambio devuelve las sucesoras ya creadas (el corte reconoce `(supersedes, effective_from_date)`).

create or replace function public.swap_recurrence_patterns(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_operations jsonb := p_payload->'operations';
  v_operation jsonb;
  v_successor public.recurrence_rules;
  v_end_id text;
  v_ended int;
  v_successor_ids jsonb := '[]'::jsonb;
  v_first_original text;
  v_second_original text;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_operations is null or jsonb_typeof(v_operations) <> 'array' or jsonb_array_length(v_operations) <> 2 then
    raise exception 'Un intercambio necesita exactamente dos series.' using errcode = '22023';
  end if;

  v_first_original := v_operations->0->'split'->>'original_recurrence_id';
  v_second_original := v_operations->1->'split'->>'original_recurrence_id';
  if v_first_original is null or v_second_original is null or v_first_original = v_second_original then
    raise exception 'El intercambio necesita dos series distintas.' using errcode = '22023';
  end if;
  if (v_operations->0->'split'->>'effective_date') is distinct from (v_operations->1->'split'->>'effective_date') then
    raise exception 'Las dos series deben intercambiarse desde la misma fecha.' using errcode = '22023';
  end if;

  for v_operation in select * from jsonb_array_elements(v_operations)
  loop
    v_successor := public.split_recurrence_this_and_future(v_operation->'split');
    v_successor_ids := v_successor_ids || to_jsonb(v_successor.id);

    for v_end_id in select * from jsonb_array_elements_text(coalesce(v_operation->'end_rule_ids', '[]'::jsonb))
    loop
      update public.recurrence_rules
      set status = 'ended'
      where id = v_end_id::uuid and owner_id = v_owner and status <> 'ended';
      get diagnostics v_ended = row_count;
      -- Un tramo a finalizar que ya no existe significa que la lectura quedó vieja: se revierte todo. Uno que ya estaba finalizado
      -- (reintento del mismo intercambio) no es un error.
      if v_ended = 0 and not exists (select 1 from public.recurrence_rules where id = v_end_id::uuid and owner_id = v_owner) then
        raise exception 'Un tramo que el intercambio iba a reemplazar ya no existe — recargá y reintentá.' using errcode = 'P0002';
      end if;
    end loop;
  end loop;

  return v_successor_ids;
end;
$$;

comment on function public.swap_recurrence_patterns(jsonb) is
  'Intercambio de horarios entre dos series desde una fecha efectiva: dos cortes «esta y las siguientes» más la finalización de los tramos que reemplazan, TODO en una transacción (ambos cambios o ninguno).';

revoke all on function public.swap_recurrence_patterns(jsonb) from public;
grant execute on function public.swap_recurrence_patterns(jsonb) to authenticated;
revoke execute on function public.swap_recurrence_patterns(jsonb) from anon;

-- «Editar futuras» desde una fecha anterior al inicio de la serie vigente: el corte y la finalización de los tramos posteriores también
-- van en UNA transacción (antes eran dos llamadas: si la segunda fallaba quedaban dos patrones vigentes a la vez).
create or replace function public.split_recurrence_ending_segments(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_successor public.recurrence_rules;
  v_end_id text;
  v_ended int;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_payload->'split' is null then
    raise exception 'Falta el corte de la serie.' using errcode = '22023';
  end if;

  v_successor := public.split_recurrence_this_and_future(p_payload->'split');

  for v_end_id in select * from jsonb_array_elements_text(coalesce(p_payload->'end_rule_ids', '[]'::jsonb))
  loop
    update public.recurrence_rules
    set status = 'ended'
    where id = v_end_id::uuid and owner_id = v_owner and status <> 'ended';
    get diagnostics v_ended = row_count;
    if v_ended = 0 and not exists (select 1 from public.recurrence_rules where id = v_end_id::uuid and owner_id = v_owner) then
      raise exception 'Un tramo que el cambio iba a reemplazar ya no existe — recargá y reintentá.' using errcode = 'P0002';
    end if;
  end loop;

  return v_successor;
end;
$$;

comment on function public.split_recurrence_ending_segments(jsonb) is
  'Corte «esta y las siguientes» más la finalización de los tramos posteriores que reemplaza, en una sola transacción.';

revoke all on function public.split_recurrence_ending_segments(jsonb) from public;
grant execute on function public.split_recurrence_ending_segments(jsonb) to authenticated;
revoke execute on function public.split_recurrence_ending_segments(jsonb) from anon;
