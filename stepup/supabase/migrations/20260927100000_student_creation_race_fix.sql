-- TeacherFlow Web — Corrección puntual de Fase 2 (a pedido explícito de
-- Joaquín, autorizada ANTES de aplicar Fase 9): cierra la carrera real de
-- alumnos duplicados encontrada al probar Fase 9 con dos conexiones reales
-- ("Escenario B" — ver informe: `apply_backup_import` inserta primero y el
-- alta web normal, sin ningún lock compartido, inserta igual 3s después,
-- creando un alumno duplicado real).
--
-- REDISEÑO (segunda corrección obligatoria de Joaquín — la primera versión
-- de esta migración confiaba en una clave de idempotencia y en la lista de
-- candidatos revisados generadas/enviadas por el NAVEGADOR; eso nunca es
-- una autoridad real). Ahora:
--   - la identidad de la operación de alta ("claim"/borrador) nace y vive
--     enteramente server-side (`claim_student_creation()`, sin aceptar
--     ningún id del cliente);
--   - los candidatos de posible duplicado se calculan y se ALMACENAN en el
--     claim del lado del servidor — el navegador puede mostrarlos, nunca
--     fabricarlos ni reenviarlos como autoridad;
--   - una vez que el claim queda ligado a un alumno (`status = 'created'`),
--     esa relación es inmutable — cualquier reintento (recarga, doble
--     confirmación simultánea, respuesta perdida) devuelve el alumno
--     canónico sin volver a validar ni insertar nada.
--
-- Migración SEPARADA de `20260927090000_backup_import.sql` a propósito
-- ("auditable por separado"), pero esta vez con una dependencia EXPLÍCITA
-- y documentada (a pedido de Joaquín, dado que ninguna de las dos está
-- aplicada todavía y se aplicarán juntas, ésta inmediatamente después):
-- reutiliza `_normalize_phone`/`_normalize_email`/`_student_match_signals`
-- definidas en `20260927090000_backup_import.sql` — NO las redefine, para
-- que nunca puedan divergir entre el flujo de importación y el de alta
-- manual. Esta migración exige que la de Fase 9 se haya aplicado antes.
--
-- Reemplaza el único INSERT directo real a `students` que existía en toda
-- la web (auditado con grep sobre todo `lib/`/`app/` — confirmado un solo
-- camino: `lib/repositories/students.ts` → `createStudent()` →
-- `.from("students").insert(...)`, llamado únicamente desde
-- `createStudentAction` en `lib/actions/students.ts`) por la RPC
-- `create_student_via_web`, que comparte el MISMO namespace de advisory
-- lock por owner que usa `apply_backup_import` — así ninguna alta manual
-- puede entrelazarse con una importación en curso para el mismo profesor,
-- sin importar el orden real de llegada.
--
-- Evidencia real (grep sobre TODO `src/` del repo móvil, sólo lectura,
-- nunca modificado): el único `.from(...)` real contra una tabla de
-- Supabase en el móvil es `active_sessions`
-- (`src/features/account/services/activeSessionService.ts`) — CERO
-- ocurrencias de `.from('students')` ni de ningún `.insert()` directo a
-- una tabla de negocio. La subida de respaldo pasa exclusivamente por la
-- RPC `upload_cloud_backup` (`src/shared/backup/cloud/supabaseCloudBackupAdapter.ts`).
-- El móvil NUNCA escribe `students` directamente en Supabase bajo ninguna
-- circunstancia — no existe un tercer escritor concurrente además de esta
-- RPC y `apply_backup_import`.

-- =============================================================================
-- SECCIÓN 1 — Tabla técnica: el "borrador" (claim) de una alta manual.
-- =============================================================================

-- Identidad REAL de una operación de alta, generada y controlada
-- enteramente por el servidor — nunca por el navegador. `status='pending'`
-- mientras no se insertó nada (puede tener candidatos de posible
-- duplicado almacenados); `status='created'` es un estado TERMINAL e
-- INMUTABLE una vez alcanzado (`student_id` queda fijo para siempre — la
-- única fila que lo escribe es `create_student_via_web`, una sola vez, bajo
-- el advisory lock + el propio `for update` de esta fila).
create table if not exists public.student_creation_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'created')),
  student_id uuid references public.students(id) on delete cascade,
  -- Candidatos de posible duplicado de la ÚLTIMA vez que se calcularon
  -- para este claim — autoridad real para validar una confirmación "es
  -- otra persona", nunca lo que mande el cliente.
  candidate_ids uuid[],
  candidates_snapshot jsonb,
  candidates_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  constraint student_creation_claims_student_requires_created check (
    (status = 'created' and student_id is not null) or (status = 'pending' and student_id is null)
  )
);
create index if not exists student_creation_claims_owner_idx on public.student_creation_claims (owner_id);

alter table public.student_creation_claims enable row level security;
revoke all on public.student_creation_claims from anon;
revoke insert, update, delete on public.student_creation_claims from authenticated;
create policy student_creation_claims_owner_select on public.student_creation_claims
  for select using (owner_id = auth.uid());

-- =============================================================================
-- SECCIÓN 2 — Reclamar un borrador nuevo. Único punto de entrada real: la
-- página `/alumnos/nuevo` reclama uno server-side al no traer `?draft=`
-- en la URL y redirige a `/alumnos/nuevo?draft=<id>` — una recarga de esa
-- URL conserva el MISMO claim; dos pestañas nuevas (sin `?draft=`) reciben
-- cada una el suyo.
-- =============================================================================

create or replace function public.claim_student_creation()
returns table (claim_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
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
$$;

-- =============================================================================
-- SECCIÓN 3 — Validación y posibles duplicados. Sólo lectura, nunca
-- escribe `students`. Reutiliza `_normalize_phone`/`_normalize_email`/
-- `_student_match_signals` de `20260927090000_backup_import.sql` — NUNCA
-- una copia propia (ver nota de cabecera).
-- =============================================================================

/** Mismas validaciones mínimas que `validateNewStudentInput` (TS) — nunca confía sólo en la validación del navegador. */
create or replace function public._validate_new_student_payload(p_payload jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if btrim(coalesce(p_payload->>'name', '')) = '' then
    raise exception 'El nombre es obligatorio.';
  end if;
  if p_payload->>'price' is null or (p_payload->>'price')::numeric < 0 then
    raise exception 'El precio debe ser un número mayor o igual a cero.';
  end if;
  if p_payload ? 'usualDurationMinutes' and p_payload->>'usualDurationMinutes' is not null
     and (p_payload->>'usualDurationMinutes')::numeric <= 0 then
    raise exception 'La duración habitual debe ser mayor a cero.';
  end if;
  if p_payload ? 'weeklyFrequency' and p_payload->>'weeklyFrequency' is not null
     and (p_payload->>'weeklyFrequency')::numeric < 0 then
    raise exception 'La frecuencia semanal no puede ser negativa.';
  end if;
  if btrim(coalesce(p_payload->>'dateJoined', '')) = '' then
    raise exception 'La fecha de alta es obligatoria.';
  end if;
end;
$$;

/**
 * Posibles duplicados reales del alumno a crear, contra TODOS los alumnos
 * propios existentes — a propósito SIN restringir a
 * `legacy_mobile_id is null` (a diferencia de `_classify_students` de Fase
 * 9, que sólo necesitaba cubrir el caso "backup vs. alumno creado a mano");
 * acá el caso real a cubrir es el inverso y más amplio: un alta manual
 * nueva puede coincidir tanto con un alumno creado a mano como con uno ya
 * importado — ambos deben bloquear el alta automática igual. Orden
 * SIEMPRE por `id` (nunca por nombre) — necesario para que la serialización
 * jsonb sea determinística y el fingerprint de abajo sea estable. Nunca
 * auto-fusiona: sólo devuelve candidatos para que el profesor decida.
 */
create or replace function public._find_student_duplicate_candidates(p_owner uuid, p_payload jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'phone', s.phone,
    'email', s.email,
    'match_signals', to_jsonb(public._student_match_signals(s.name, s.email, s.phone, p_payload->>'name', p_payload->>'email', p_payload->>'phone'))
  ) order by s.id), '[]'::jsonb)
  from public.students s
  where s.owner_id = p_owner
    and array_length(public._student_match_signals(s.name, s.email, s.phone, p_payload->>'name', p_payload->>'email', p_payload->>'phone'), 1) > 0;
$$;

/** Huella estable de un array de candidatos ya ordenado por id — comparar huellas equivale a comparar el conjunto completo (ids + contenido), nunca sólo la lista de ids. */
create or replace function public._student_candidates_fingerprint(p_candidates jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(p_candidates, '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

-- =============================================================================
-- SECCIÓN 4 — `create_student_via_web`: única puerta de alta manual real.
-- =============================================================================

/**
 * Alta de un alumno nuevo sobre un borrador (`claim`) ya reclamado
 * server-side, coordinada con `apply_backup_import`.
 *
 * Orden real dentro de la transacción:
 *   1) advisory lock por owner (MISMO namespace `backup_import:<owner>`
 *      que usa `apply_backup_import`).
 *   2) `for update` sobre el claim — verifica que exista y sea del owner
 *      real (mensaje genérico, nunca distingue "no existe" de "no te
 *      pertenece").
 *   3) si el claim YA tiene `student_id` (terminal, inmutable): devuelve
 *      el alumno canónico — recarga, doble confirmación simultánea o
 *      respuesta perdida SIEMPRE convergen acá, sin volver a validar
 *      payload ni candidatos.
 *   4) si venció (`pending` y `expires_at < now()`): rechaza — la UI debe
 *      reclamar un borrador nuevo.
 *   5) valida el payload real.
 *   6) recalcula candidatos SIEMPRE contra el estado actual (nunca contra
 *      lo que mande el cliente).
 *   7) sin confirmar: si hay candidatos, los ALMACENA en el claim y los
 *      devuelve — cero escritura en `students`. Sin candidatos: alta
 *      directa (no hace falta confirmar nada).
 *   8) confirmando "es otra persona": exige que ya exista una revisión
 *      almacenada (huella no nula) y que la huella recalculada AHORA
 *      coincida EXACTO con la almacenada — si no coincide (apareció un
 *      candidato nuevo, desapareció uno, o cambió su contenido), actualiza
 *      el claim con la revisión nueva y rechaza la creación, nunca inserta
 *      con información vieja.
 *   9) inserta y liga el claim de forma inmutable.
 *
 * Nunca modifica un alumno existente — es estrictamente aditiva.
 */
create or replace function public.create_student_via_web(
  p_claim_id uuid,
  p_payload jsonb,
  p_confirm_duplicate boolean default false
)
returns table (status text, student_id uuid, replayed boolean, candidates jsonb)
language plpgsql security definer set search_path = '' as $$
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
$$;

-- =============================================================================
-- SECCIÓN 5 — Permisos. Ninguna función nueva de esta migración es
-- alcanzable por `anon`; sólo las 2 RPC públicas son alcanzables por
-- `authenticated` (las internas sólo se llaman desde adentro, con los
-- privilegios de su dueño por ser SECURITY DEFINER).
-- =============================================================================

revoke all on function public._validate_new_student_payload(jsonb) from public, anon, authenticated;
revoke all on function public._find_student_duplicate_candidates(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._student_candidates_fingerprint(jsonb) from public, anon, authenticated;

revoke all on function public.claim_student_creation() from public;
revoke all on function public.claim_student_creation() from anon;
grant execute on function public.claim_student_creation() to authenticated;

revoke all on function public.create_student_via_web(uuid, jsonb, boolean) from public;
revoke all on function public.create_student_via_web(uuid, jsonb, boolean) from anon;
grant execute on function public.create_student_via_web(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
