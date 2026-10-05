-- ============================================================================
-- Alta de alumno: el claim se crea AL ENVIAR (nunca al cargar la página) — clave de operación del lado del borrador
-- ============================================================================
-- Hallazgo (2026-10-05, verificación de B2 en Production): `GET /alumnos/nuevo` reclamaba un borrador
-- (`claim_student_creation()`, un INSERT en `student_creation_claims`) y redirigía a `?draft=<id>`. Cualquier carga de la
-- página, un prefetch, una pestaña abierta y abandonada o una simple lectura del HTML escribía una fila huérfana. Una carga
-- (GET) nunca debe escribir.
--
-- Esta migración es ADITIVA y no edita ninguna migración ya aplicada:
--   1. `student_creation_claims.operation_id` (nullable): la clave de operación que genera el NAVEGADOR por borrador
--      (`useDraftOperationId`, sessionStorage), única por profesora (índice parcial). Los claims viejos (operation_id NULL)
--      siguen válidos para `create_student_via_web`.
--   2. `create_student_with_operation(p_operation_id, p_payload, p_confirm_duplicate)`: el ÚNICO punto donde nace el claim,
--      dentro del mismo flujo atómico del alta (mismo advisory lock por profesora que `apply_backup_import`):
--        - la clave sólo identifica la operación DENTRO de la profesora (`owner_id` + `operation_id`); nunca decide
--          autorización ni cruza profesoras;
--        - un reintento con la misma clave (recarga, doble envío simultáneo, respuesta perdida, pestaña duplicada)
--          converge: si el alumno ya se creó devuelve el MISMO alumno (`replayed = true`) sin insertar nada;
--        - si el payload es inválido o la confirmación no corresponde, la función lanza y la transacción entera se revierte,
--          incluida la creación del claim: no queda ningún claim huérfano. El único claim que sobrevive sin alumno es el
--          `pending` con candidatos de posible duplicado, que es estado necesario para la confirmación "es otra persona";
--          vence a los 30 minutos y se limpia de forma perezosa a las 24 h;
--        - un claim `pending` vencido de la MISMA clave se reabre (expiración renovada, candidatos descartados: se exige
--          revisar de nuevo) en vez de obligar a recargar la página.
--   3. `claim_student_creation()` y `create_student_via_web()` NO se tocan (el web anterior, que todavía puede estar abierto
--      en alguna pestaña, sigue funcionando); quedan en desuso y se retirarán en una migración futura.
-- ============================================================================

alter table public.student_creation_claims add column if not exists operation_id uuid;

create unique index if not exists student_creation_claims_owner_operation_uidx
  on public.student_creation_claims (owner_id, operation_id)
  where operation_id is not null;

create or replace function public.create_student_with_operation(
  p_operation_id uuid,
  p_payload jsonb,
  p_confirm_duplicate boolean default false
)
returns table (status text, student_id uuid, replayed boolean, candidates jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_claim public.student_creation_claims;
  v_existing boolean;
  v_candidates jsonb;
  v_fingerprint text;
  v_candidate_ids uuid[];
  v_new_id uuid;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.';
  end if;
  if p_operation_id is null then
    raise exception 'Falta la clave de la operación de alta.';
  end if;

  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));

  -- Limpieza perezosa: SÓLO claims propios, PENDIENTES y vencidos hace más de 24 h (nunca uno 'created').
  delete from public.student_creation_claims scc
    where scc.owner_id = v_owner and scc.status = 'pending' and scc.expires_at < now() - interval '24 hours';

  select * into v_claim
    from public.student_creation_claims scc
    where scc.owner_id = v_owner and scc.operation_id = p_operation_id
    for update;
  v_existing := found;

  -- Reintento sobre una operación ya completada: converge al alumno canónico, sin validar ni insertar.
  if v_existing and v_claim.status = 'created' then
    return query select 'created'::text, v_claim.student_id, true, null::jsonb;
    return;
  end if;

  perform public._validate_new_student_payload(p_payload);

  if not v_existing then
    insert into public.student_creation_claims (owner_id, operation_id, status, expires_at)
      values (v_owner, p_operation_id, 'pending', now() + interval '30 minutes')
      returning * into v_claim;
  elsif v_claim.expires_at < now() then
    update public.student_creation_claims scc
      set expires_at = now() + interval '30 minutes',
          candidate_ids = null, candidates_snapshot = null, candidates_fingerprint = null,
          updated_at = now()
      where scc.id = v_claim.id
      returning * into v_claim;
  end if;

  v_candidates := public._find_student_duplicate_candidates(v_owner, p_payload);
  v_fingerprint := public._student_candidates_fingerprint(v_candidates);
  select coalesce(array_agg((c->>'id')::uuid), array[]::uuid[]) into v_candidate_ids from jsonb_array_elements(v_candidates) c;

  if p_confirm_duplicate then
    if v_claim.candidates_fingerprint is null then
      raise exception 'No hay una revisión de posibles duplicados previa para confirmar en este borrador.';
    end if;

    if v_claim.candidates_fingerprint <> v_fingerprint then
      update public.student_creation_claims scc
        set candidate_ids = v_candidate_ids, candidates_snapshot = v_candidates, candidates_fingerprint = v_fingerprint, updated_at = now()
        where scc.id = v_claim.id;
      return query select 'possible_duplicate'::text, null::uuid, false, v_candidates;
      return;
    end if;
    -- Huella idéntica a la revisada: se permite insertar.
  else
    if jsonb_array_length(v_candidates) > 0 then
      update public.student_creation_claims scc
        set candidate_ids = v_candidate_ids, candidates_snapshot = v_candidates, candidates_fingerprint = v_fingerprint, updated_at = now()
        where scc.id = v_claim.id;
      return query select 'possible_duplicate'::text, null::uuid, false, v_candidates;
      return;
    end if;
    -- Sin candidatos: alta limpia directa.
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

  update public.student_creation_claims scc
    set status = 'created', student_id = v_new_id, completed_at = now(), updated_at = now()
    where scc.id = v_claim.id;

  return query select 'created'::text, v_new_id, false, null::jsonb;
end;
$$;

-- Permisos (regla del proyecto): sólo `authenticated`; nunca `anon`.
revoke all on function public.create_student_with_operation(uuid, jsonb, boolean) from public;
revoke all on function public.create_student_with_operation(uuid, jsonb, boolean) from anon;
grant execute on function public.create_student_with_operation(uuid, jsonb, boolean) to authenticated;

comment on function public.create_student_with_operation(uuid, jsonb, boolean) is
  'Alta de alumno idempotente por (owner, operation_id). El claim nace AQUÍ (al enviar), nunca al cargar la página; si la operación falla se revierte todo, sin claims huérfanos. Reemplaza a claim_student_creation + create_student_via_web (en desuso).';

notify pgrst, 'reload schema';
