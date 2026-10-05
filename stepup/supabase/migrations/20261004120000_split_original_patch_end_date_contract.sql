-- ============================================================================
-- split_recurrence_this_and_future: contrato `original_patch.end_date` (aditiva, compatible)
-- ============================================================================
-- Hallazgo (2026-10-04, auditoría "Series vs. Calendario"): el cliente web enviaba
--   original_patch: { status, endDate }          (camelCase — el plan de dominio de `planRecurrenceSplit`)
-- mientras que la función (todas sus versiones, desde 20260920130000) lee
--   original_patch->>'end_date'                  (snake_case)
-- así que la fecha de fin de la serie ORIGINAL llegaba siempre como NULL: la original quedaba `active` y sin fin, y seguía
-- generando ocurrencias en paralelo a la sucesora después de `effective_from_date` (la semana del 12/10/2026 mostraba el
-- lunes viejo Y el martes nuevo). Ver docs/CALENDAR_RPC_PAYLOAD_CONTRACT.md.
--
-- Esta migración NO edita ninguna migración ya aplicada: reemplaza la función con `create or replace` (mismo nombre, misma
-- firma, mismo tipo de retorno, `security invoker`) y cambia SÓLO el manejo de `original_patch`:
--   1. `end_date` es la clave canónica.
--   2. `endDate` se acepta TEMPORALMENTE (clientes web anteriores al arreglo que todavía estén abiertos o en caché). Si
--      llegan las dos, gana `end_date`. Retirar este respaldo en una migración futura, cuando ya no haya clientes viejos.
--   3. Un split de una regla que queda `active` EXIGE poder determinar su fecha de fin: si no llega (ni `end_date` ni
--      `endDate`) se rechaza con 22023 y NO se escribe nada — antes se guardaba NULL en silencio.
--   4. El fin debe ser ANTERIOR a `effective_from` (`effective_date`) y no anterior al inicio de la serie original.
--   5. `status` debe ser 'active' o 'ended' (para 'ended' la fecha de fin es opcional: es el caso "el cambio rige desde el
--      propio inicio de la serie", la original queda cerrada).
-- Todo lo demás (idempotencia por sucesora existente, validación de alumnos, exclusiones, limpieza de materializadas
-- futuras, alumno principal explícito) es idéntico a 20261001140000.
--
-- Regla de proyecto (anon): la función nueva/reemplazada vuelve a revocar EXECUTE a `public` y `anon` en la MISMA migración.
-- ============================================================================

create or replace function public.split_recurrence_this_and_future(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_original_id uuid := (p_payload->>'original_recurrence_id')::uuid;
  v_effective_date date := (p_payload->>'effective_date')::date;
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_existing_successor public.recurrence_rules;
  v_original public.recurrence_rules;
  v_successor public.recurrence_rules;
  v_original_patch jsonb := p_payload->'original_patch';
  v_patch_status text;
  v_patch_end_date date;
  v_participant_id text;
  v_excluded_key text;
  v_effective_instant timestamptz;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_existing_successor
  from public.recurrence_rules
  where owner_id = v_owner and supersedes_recurrence_id = v_original_id and effective_from_date = v_effective_date
  limit 1;
  if found then
    return v_existing_successor;
  end if;

  select * into v_original from public.recurrence_rules where id = v_original_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Serie original no encontrada.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  if v_primary_student_id is null then
    raise exception 'Elegí quién es el alumno principal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid where sid::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  -- Contrato de `original_patch` (ver el encabezado). Se valida ANTES de escribir cualquier cosa.
  v_patch_status := v_original_patch->>'status';
  if v_patch_status is null or v_patch_status not in ('active', 'ended') then
    raise exception 'original_patch.status debe ser active o ended.' using errcode = '22023';
  end if;
  -- `end_date` canónica; `endDate` sólo como compatibilidad temporal con clientes anteriores.
  v_patch_end_date := coalesce(
    nullif(v_original_patch->>'end_date', ''),
    nullif(v_original_patch->>'endDate', '')
  )::date;
  if v_patch_status = 'active' then
    if v_patch_end_date is null then
      raise exception 'No se puede determinar la fecha de fin de la serie original (original_patch.end_date): se rechaza el cambio para no dejarla activa y sin fin.' using errcode = '22023';
    end if;
    if v_patch_end_date >= v_effective_date then
      raise exception 'La fecha de fin de la serie original debe ser anterior a la fecha efectiva del cambio.' using errcode = '22023';
    end if;
    if v_patch_end_date < v_original.start_date then
      raise exception 'La fecha de fin de la serie original no puede ser anterior a su inicio.' using errcode = '22023';
    end if;
  end if;

  v_effective_instant := (v_effective_date::text || ' 00:00:00')::timestamp at time zone v_original.timezone;

  update public.recurrence_rules
  set status = v_patch_status,
      end_date = v_patch_end_date
  where id = v_original_id and owner_id = v_owner;

  insert into public.recurrence_rules (
    id, owner_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality, timezone,
    start_date, end_date, status, supersedes_recurrence_id, effective_from_date,
    class_title, activity_kind, training_billing_agreement_id
  ) values (
    (p_payload->>'successor_id')::uuid,
    v_owner,
    v_primary_student_id,
    p_payload->>'rule_type',
    (p_payload->>'cycle_length_weeks')::smallint,
    p_payload->'weeks',
    coalesce(p_payload->>'modality', v_original.modality),
    v_original.timezone,
    (p_payload->>'successor_start_date')::date,
    nullif(p_payload->>'successor_end_date', '')::date,
    'active',
    v_original_id,
    v_effective_date,
    coalesce(p_payload->>'class_title', v_original.class_title),
    coalesce(p_payload->>'activity_kind', v_original.activity_kind),
    v_original.training_billing_agreement_id
  )
  returning * into v_successor;

  update public.recurrence_rules set superseded_by_recurrence_id = v_successor.id where id = v_original_id and owner_id = v_owner;

  for v_participant_id in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_successor.id, v_participant_id::uuid)
    on conflict (recurrence_rule_id, student_id) do nothing;
  end loop;

  for v_excluded_key in select * from jsonb_array_elements_text(p_payload->'excluded_occurrence_keys')
  loop
    insert into public.recurrence_exceptions (owner_id, recurrence_id, occurrence_key, exception_type)
    values (v_owner, v_successor.id, v_excluded_key, 'excluded')
    on conflict (recurrence_id, occurrence_key) do nothing;
  end loop;

  delete from public.calendar_lessons
  where owner_id = v_owner
    and recurrence_id = v_original_id
    and status not in ('completed', 'cancelled')
    and coalesce(recurrence_original_start, start_at) >= v_effective_instant;

  return v_successor;
end;
$$;

revoke all on function public.split_recurrence_this_and_future(jsonb) from public;
grant execute on function public.split_recurrence_this_and_future(jsonb) to authenticated;
revoke execute on function public.split_recurrence_this_and_future(jsonb) from anon;

comment on function public.split_recurrence_this_and_future(jsonb) is
  'Cambio de patrón "esta y las siguientes". original_patch = { status: active|ended, end_date: YYYY-MM-DD } (snake_case; endDate se acepta temporalmente por compatibilidad). Una original que queda active exige end_date, anterior a effective_date y no anterior a su inicio; nunca se deja activa y sin fin.';
