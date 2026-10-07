-- R8 — Rollback MANUAL del retiro de piezas en desuso (NO es una migración; no se aplica con `db push`). Recrea `claim_student_creation()` y
-- `create_student_via_web(uuid, jsonb, boolean)` y vuelve a definir `split_recurrence_this_and_future(jsonb)` con el cuerpo EXACTO que tenían en Production
-- antes de R8 (sacado de `pg_get_functiondef` el 2026-10-07, incluida la compatibilidad `endDate` y el `search_path` vacío de R5), y restaura sus privilegios
-- (`authenticated` y `service_role`; nunca `public` ni `anon`). La tabla `student_creation_claims` no se tocó, así que los claims anteriores siguen válidos.
--
-- ES UNA REGRESIÓN deliberada: vuelven las dos funciones del alta por borrador (que dejaban un claim al sólo reclamar) y el respaldo `endDate`. Ejecutar sólo si
-- R8 rompiera algo que una pestaña web anterior necesita, y volver a aplicar R8 después (`supabase migration repair --status reverted 20261012100000`).

CREATE OR REPLACE FUNCTION public.claim_student_creation()
 RETURNS TABLE(claim_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.';
  end if;

  -- Limpieza perezosa: SÓLO borradores propios, PENDIENTES (nunca uno
  -- 'created' — su alumno real puede necesitarse para un reintento en
  -- cualquier momento) y vencidos hace más de 24hs.
  delete from public.student_creation_claims scc
    where scc.owner_id = v_owner and scc.status = 'pending' and scc.expires_at < now() - interval '24 hours';

  insert into public.student_creation_claims (owner_id, status, expires_at)
    values (v_owner, 'pending', v_expires)
    returning id into v_id;

  return query select v_id, v_expires;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_student_via_web(p_claim_id uuid, p_payload jsonb, p_confirm_duplicate boolean DEFAULT false)
 RETURNS TABLE(status text, student_id uuid, replayed boolean, candidates jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := auth.uid();
  v_claim record;
  v_candidates jsonb;
  v_fingerprint text;
  v_candidate_ids uuid[];
  v_new_id uuid;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_claim_id is null then
    raise exception 'Falta el borrador de alta.';
  end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  select * into v_claim from public.student_creation_claims where id = p_claim_id for update;
  if not found or v_claim.owner_id <> v_owner then
    raise exception 'El borrador no existe o no te pertenece.';
  end if;

  if v_claim.status = 'created' then
    return query select 'created'::text, v_claim.student_id, true, null::jsonb;
    return;
  end if;

  if v_claim.expires_at < now() then
    raise exception 'El borrador venció — iniciá un alta nueva.';
  end if;

  perform public._validate_new_student_payload(p_payload);

  v_candidates := public._find_student_duplicate_candidates(v_owner, p_payload);
  v_fingerprint := public._student_candidates_fingerprint(v_candidates);
  select coalesce(array_agg((c->>'id')::uuid), array[]::uuid[]) into v_candidate_ids from jsonb_array_elements(v_candidates) c;

  if p_confirm_duplicate then
    if v_claim.candidates_fingerprint is null then
      raise exception 'No hay una revisión de posibles duplicados previa para confirmar en este borrador.';
    end if;

    if v_claim.candidates_fingerprint <> v_fingerprint then
      update public.student_creation_claims
        set candidate_ids = v_candidate_ids, candidates_snapshot = v_candidates, candidates_fingerprint = v_fingerprint, updated_at = now()
        where id = p_claim_id;
      return query select 'possible_duplicate'::text, null::uuid, false, v_candidates;
      return;
    end if;
    -- Huella idéntica a la revisada: se permite insertar.
  else
    if jsonb_array_length(v_candidates) > 0 then
      update public.student_creation_claims
        set candidate_ids = v_candidate_ids, candidates_snapshot = v_candidates, candidates_fingerprint = v_fingerprint, updated_at = now()
        where id = p_claim_id;
      return query select 'possible_duplicate'::text, null::uuid, false, v_candidates;
      return;
    end if;
    -- Sin candidatos: alta limpia directa, no hace falta confirmar nada.
  end if;

  insert into public.students (
    owner_id, name, phone, whatsapp, email, notes,
    levels, initial_level, modality, category, billing_type, date_joined,
    usual_duration_minutes, weekly_frequency, price
  ) values (
    v_owner,
    btrim(coalesce(p_payload->>'name', '')),
    p_payload->>'phone', p_payload->>'whatsapp', p_payload->>'email', p_payload->>'notes',
    array(select jsonb_array_elements_text(coalesce(p_payload->'levels', '[]'::jsonb))),
    coalesce(p_payload->>'initialLevel', ''),
    p_payload->>'modality', p_payload->>'category', p_payload->>'billingType',
    (p_payload->>'dateJoined')::date,
    coalesce((p_payload->>'usualDurationMinutes')::int, 60),
    coalesce((p_payload->>'weeklyFrequency')::int, 1),
    coalesce((p_payload->>'price')::numeric, 0)
  ) returning id into v_new_id;

  update public.student_creation_claims
    set status = 'created', student_id = v_new_id, completed_at = now(), updated_at = now()
    where id = p_claim_id;

  return query select 'created'::text, v_new_id, false, null::jsonb;
end;
$function$;

CREATE OR REPLACE FUNCTION public.split_recurrence_this_and_future(p_payload jsonb)
 RETURNS recurrence_rules
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

revoke all on function public.claim_student_creation() from public, anon;
grant execute on function public.claim_student_creation() to authenticated, service_role;
revoke all on function public.create_student_via_web(uuid, jsonb, boolean) from public, anon;
grant execute on function public.create_student_via_web(uuid, jsonb, boolean) to authenticated, service_role;
revoke all on function public.split_recurrence_this_and_future(jsonb) from public, anon;
grant execute on function public.split_recurrence_this_and_future(jsonb) to authenticated, service_role;
