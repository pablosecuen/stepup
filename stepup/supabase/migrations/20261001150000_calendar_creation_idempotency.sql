-- TeacherFlow Web — Fase 10: idempotencia real de la creación de clase única
-- y de serie recurrente.
--
-- Causa raíz (encontrada por el E2E de red, bloque anterior): ni
-- `create_calendar_lesson` ni `create_recurrence_series` tenían ninguna clave
-- de idempotencia. Si la respuesta de la Server Action se perdía DESPUÉS de
-- que el servidor ya había creado la fila, el reintento de la profesora no
-- convergía en la misma fila:
--   - serie: creaba una SEGUNDA regla (duplicado real, comprobado: 2 reglas);
--   - clase única: no duplicaba sólo porque la Server Action rechazaba el
--     reintento con "El horario se superpone" — chocaba con la clase que ella
--     misma había creado, aunque la creación hubiera sido exitosa.
--
-- Diseño (mismo patrón ya probado en `payments`, `lesson_registrations`,
-- `report_records`):
--   1. `operation_id uuid` en `calendar_lessons` y en `recurrence_rules`,
--      generado UNA vez en el cliente por borrador (sessionStorage) y enviado
--      en el payload. Nullable: las filas existentes y las que nacen por otros
--      caminos (cancelar/reprogramar/dividir/importar) no lo usan.
--   2. UNIQUE parcial por (owner_id, operation_id) WHERE operation_id IS NOT
--      NULL — dos owners distintos pueden usar el mismo UUID sin colisionar.
--   3. Ambas RPC exigen `operation_id` (22023 si falta) y hacen
--      `INSERT ... ON CONFLICT (owner_id, operation_id) WHERE operation_id IS
--      NOT NULL DO NOTHING RETURNING`. Nunca un SELECT previo como garantía:
--      la unicidad la decide el índice. Si la operación ya existía devuelven
--      de inmediato la fila canónica SIN volver a procesar roster,
--      participantes ni ningún otro efecto — no se modifica `updated_at` ni la
--      lista de participantes. Dos llamadas simultáneas con el mismo id se
--      serializan en el índice único: la segunda espera el commit de la
--      primera y devuelve su fila ya completa.
--   4. Un `operation_id` nuevo SIEMPRE crea una operación nueva (el solapamiento
--      sigue siendo regla de la Server Action, no se toca acá).
--   5. Todo ocurre en una sola transacción: una falla posterior (p. ej. un
--      participante inválido) deshace también la fila principal, y el mismo
--      `operation_id` queda libre para un reintento corregido.
--
-- Mismo modo de seguridad y mismos permisos que hoy (siguen `security
-- invoker`, `authenticated` con EXECUTE, `anon` sin EXECUTE) — el hardening
-- B+D de Calendario es un bloque aparte, no tocado acá. Las validaciones de
-- 20261001140000 (principal dentro del roster, ownership) quedan idénticas.

alter table public.calendar_lessons add column if not exists operation_id uuid;

comment on column public.calendar_lessons.operation_id is
  'Idempotencia real de la creación de clase única: UUID generado UNA vez del lado del cliente por borrador (sessionStorage). Dos llamadas con el mismo operation_id convergen en la MISMA fila, nunca duplican la clase ni su roster. NULL en filas históricas y en las que nacen por otros caminos.';

create unique index if not exists calendar_lessons_owner_operation_unique
  on public.calendar_lessons (owner_id, operation_id)
  where operation_id is not null;

alter table public.recurrence_rules add column if not exists operation_id uuid;

comment on column public.recurrence_rules.operation_id is
  'Idempotencia real de la creación de serie: UUID generado UNA vez del lado del cliente por borrador (sessionStorage). Dos llamadas con el mismo operation_id convergen en la MISMA regla, nunca crean una segunda serie ni duplican su roster. NULL en filas históricas y en las que nacen por otros caminos (dividir, importar).';

create unique index if not exists recurrence_rules_owner_operation_unique
  on public.recurrence_rules (owner_id, operation_id)
  where operation_id is not null;

create or replace function public.create_calendar_lesson(p_payload jsonb)
returns public.calendar_lessons
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_primary_student_id uuid := (p_payload->>'primary_student_id')::uuid;
  v_lesson public.calendar_lessons;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_operation_id is null then
    raise exception 'Falta operation_id.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where not exists (select 1 from public.students where id = (p->>'student_id')::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where (p->>'student_id')::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  -- Idempotencia real: la unicidad la decide el índice, nunca un SELECT previo.
  insert into public.calendar_lessons (
    owner_id, operation_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
    modality, status, color, is_recurring, class_title, activity_kind, notes, freed_by_lesson_id
  ) values (
    v_owner,
    v_operation_id,
    v_primary_student_id,
    p_payload->>'student_name',
    p_payload->>'level',
    p_payload->>'lesson_type',
    (p_payload->>'start_at')::timestamptz,
    (p_payload->>'end_at')::timestamptz,
    p_payload->>'modality',
    'scheduled',
    coalesce(p_payload->>'color', '#FCE4D2'),
    false,
    nullif(p_payload->>'class_title', ''),
    coalesce(p_payload->>'activity_kind', 'class'),
    nullif(p_payload->>'notes', ''),
    nullif(p_payload->>'freed_by_lesson_id', '')::uuid
  )
  on conflict (owner_id, operation_id) where operation_id is not null do nothing
  returning * into v_lesson;

  -- Ya existía (reintento, doble clic, respuesta perdida): devuelve la fila
  -- canónica de inmediato, sin tocar roster ni participantes.
  if not found then
    select * into v_lesson from public.calendar_lessons where owner_id = v_owner and operation_id = v_operation_id;
    return v_lesson;
  end if;

  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
    values (v_owner, v_lesson.id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level');
  end loop;

  return v_lesson;
end;
$$;

revoke all on function public.create_calendar_lesson(jsonb) from public;
grant execute on function public.create_calendar_lesson(jsonb) to authenticated;
revoke execute on function public.create_calendar_lesson(jsonb) from anon;

create or replace function public.create_recurrence_series(p_payload jsonb)
returns public.recurrence_rules
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_rule public.recurrence_rules;
  v_participant_id text;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_operation_id is null then
    raise exception 'Falta operation_id.' using errcode = '22023';
  end if;
  if v_primary_student_id is null then
    raise exception 'Elegí quién es el alumno principal.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid
    where not exists (select 1 from public.students where id = sid::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(p_payload->'participant_ids') as sid where sid::uuid = v_primary_student_id
  ) then
    raise exception 'El alumno principal debe estar entre los participantes seleccionados.' using errcode = '22023';
  end if;

  insert into public.recurrence_rules (
    owner_id, operation_id, primary_student_id, rule_type, cycle_length_weeks, weeks, modality,
    timezone, start_date, end_date, status, class_title, activity_kind
  ) values (
    v_owner,
    v_operation_id,
    v_primary_student_id,
    p_payload->>'rule_type',
    (p_payload->>'cycle_length_weeks')::smallint,
    p_payload->'weeks',
    p_payload->>'modality',
    p_payload->>'timezone',
    (p_payload->>'start_date')::date,
    nullif(p_payload->>'end_date', '')::date,
    'active',
    nullif(p_payload->>'class_title', ''),
    coalesce(p_payload->>'activity_kind', 'class')
  )
  on conflict (owner_id, operation_id) where operation_id is not null do nothing
  returning * into v_rule;

  if not found then
    select * into v_rule from public.recurrence_rules where owner_id = v_owner and operation_id = v_operation_id;
    return v_rule;
  end if;

  for v_participant_id in select * from jsonb_array_elements_text(p_payload->'participant_ids')
  loop
    insert into public.recurrence_rule_participants (owner_id, recurrence_rule_id, student_id)
    values (v_owner, v_rule.id, v_participant_id::uuid);
  end loop;

  return v_rule;
end;
$$;

revoke all on function public.create_recurrence_series(jsonb) from public;
grant execute on function public.create_recurrence_series(jsonb) to authenticated;
revoke execute on function public.create_recurrence_series(jsonb) from anon;
