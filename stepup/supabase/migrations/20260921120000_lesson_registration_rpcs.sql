-- TeacherFlow Web — Fase 4: registro pedagógico real (clases y
-- entrenamientos dictados). Migración aditiva — nunca edita las 4
-- migraciones ya aplicadas de Fase 2/3. Todas las funciones son
-- `security invoker`, revocadas de `public`, concedidas sólo a
-- `authenticated`, y verifican explícitamente la propiedad de cada
-- referencia (nunca confían en un FK como control de propietario — un
-- chequeo de FOREIGN KEY en Postgres se evalúa sin aplicar RLS sobre la
-- tabla referenciada).
--
-- Dos columnas nuevas, ninguna tabla nueva (las 5 tablas de
-- `lesson_registrations` ya existían desde `20260916121000_lesson_registrations.sql`,
-- Fase 1 — nunca antes conectadas a una RPC real):
--
-- 1) `lesson_registrations.status` — 'in_progress' | 'completed'. Un
--    registro grupal puede guardar progreso parcial ("Guardar progreso" en
--    el móvil) antes de finalizar — la EXISTENCIA de la fila con
--    status='in_progress' es justamente ese borrador; individual/ad-hoc
--    nunca pasan por 'in_progress' en la práctica (se finalizan en la misma
--    sesión), pero el mecanismo es el mismo para los dos casos, sin
--    necesidad de un camino de código separado.
-- 2) `lesson_registrations.updated_at` — se actualiza en cada escritura
--    real (guardar un participante, finalizar, editar después).
--
-- Una columna nueva en `lesson_registration_students`:
-- 3) `participant_status` — 'pending' | 'completed' | 'omitted', puerto
--    exacto de `ParticipantRegistrationStatus` (móvil,
--    `groupRegistrationDomain.ts`). 'omitted' ("Omitir por ahora") es
--    reversible y NUNCA cuenta como completo para poder finalizar — mismo
--    criterio que `isGroupRegistrationComplete`.
--
-- Un índice único parcial nuevo en `lesson_registrations` (owner_id,
-- calendar_lesson_id) — evita que recargar la página o un doble toque al
-- "empezar a registrar" la misma ocurrencia cree dos encabezados de
-- registro para la misma clase (ad-hoc, sin calendar_lesson_id, queda
-- fuera del índice a propósito — cada clase ad-hoc es una fila nueva por
-- diseño, igual que `NewClassScreen.tsx` en el móvil).

alter table public.lesson_registrations
  add column if not exists status text not null default 'completed' check (status in ('in_progress', 'completed')),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.lesson_registrations.status is
  'in_progress = borrador con progreso parcial (grupal); completed = finalizado. Puerto de SavedLesson.registrationStatus del móvil.';

create unique index if not exists lesson_registrations_owner_calendar_lesson_unique
  on public.lesson_registrations (owner_id, calendar_lesson_id)
  where calendar_lesson_id is not null;

alter table public.lesson_registration_students
  add column if not exists participant_status text not null default 'pending' check (participant_status in ('pending', 'completed', 'omitted'));

comment on column public.lesson_registration_students.participant_status is
  'Puerto exacto de ParticipantRegistrationStatus (móvil, groupRegistrationDomain.ts) — omitted nunca cuenta como completo.';

-- ---------------------------------------------------------------------------
-- 1) Empezar (o retomar) un registro — materializa la ocurrencia si es
--    virtual, crea/recupera el encabezado y el roster. Idempotente: doble
--    toque o recarga con el mismo calendar_lesson_id nunca duplica el
--    encabezado (índice único de arriba); si la ocurrencia de serie ya
--    estaba materializada, reutiliza la misma fila de calendar_lessons
--    (nunca crea una segunda clase para la misma ocurrencia).
-- ---------------------------------------------------------------------------
create or replace function public.start_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_calendar_lesson_id uuid := nullif(p_payload->>'calendar_lesson_id', '')::uuid;
  v_recurrence_id uuid := nullif(p_payload->>'recurrence_id', '')::uuid;
  v_occurrence_key text := nullif(p_payload->>'occurrence_key', '');
  v_primary_student_id uuid := nullif(p_payload->>'primary_student_id', '')::uuid;
  v_activity_kind text := coalesce(p_payload->>'activity_kind', 'class');
  v_registration public.lesson_registrations;
  v_participant jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  if v_recurrence_id is not null and not exists (select 1 from public.recurrence_rules where id = v_recurrence_id and owner_id = v_owner) then
    raise exception 'Serie no encontrada.' using errcode = 'P0002';
  end if;
  if v_calendar_lesson_id is not null and not exists (select 1 from public.calendar_lessons where id = v_calendar_lesson_id and owner_id = v_owner) then
    raise exception 'Clase no encontrada.' using errcode = 'P0002';
  end if;
  if v_primary_student_id is not null and not exists (select 1 from public.students where id = v_primary_student_id and owner_id = v_owner) then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'participants') as p
    where not exists (select 1 from public.students where id = (p->>'student_id')::uuid and owner_id = v_owner)
  ) then
    raise exception 'Alguno de los alumnos no existe o no te pertenece.' using errcode = 'P0002';
  end if;

  -- Materializa la ocurrencia de serie si todavía es virtual — nunca crea
  -- una segunda fila si (recurrence_id, occurrence_key) ya estaba
  -- materializada (mismo índice único que usan cancel/reschedule).
  if v_calendar_lesson_id is null and v_recurrence_id is not null and v_occurrence_key is not null then
    insert into public.calendar_lessons (
      owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at,
      modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key,
      recurrence_index, recurrence_original_start, class_title, activity_kind
    ) values (
      v_owner,
      v_primary_student_id,
      p_payload->>'student_name',
      p_payload->>'level',
      p_payload->>'lesson_type',
      (p_payload->>'start_at')::timestamptz,
      (p_payload->>'end_at')::timestamptz,
      p_payload->>'modality',
      'scheduled',
      coalesce(p_payload->>'color', '#FCE4D2'),
      true,
      v_recurrence_id,
      v_occurrence_key,
      (p_payload->>'recurrence_index')::int,
      (p_payload->>'start_at')::timestamptz,
      nullif(p_payload->>'class_title', ''),
      v_activity_kind
    )
    on conflict (recurrence_id, recurrence_occurrence_key) where recurrence_id is not null and recurrence_occurrence_key is not null
    do update set updated_at = now()
    returning id into v_calendar_lesson_id;

    for v_participant in select * from jsonb_array_elements(p_payload->'participants')
    loop
      insert into public.calendar_lesson_participants (owner_id, calendar_lesson_id, student_id, student_name, level)
      values (v_owner, v_calendar_lesson_id, (v_participant->>'student_id')::uuid, v_participant->>'student_name', v_participant->>'level')
      on conflict (calendar_lesson_id, student_id) do nothing;
    end loop;
  end if;

  if v_calendar_lesson_id is not null then
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status
    ) values (
      v_owner, v_calendar_lesson_id, v_activity_kind, coalesce((p_payload->>'counts_as_class')::boolean, true),
      (p_payload->>'start_at')::timestamptz, 'in_progress'
    )
    on conflict (owner_id, calendar_lesson_id) where calendar_lesson_id is not null
    do update set updated_at = now()
    returning * into v_registration;
  else
    -- Ad-hoc (sin reserva de calendario, como NewClassScreen.tsx en el
    -- móvil) — siempre una fila nueva, nunca se deduplica por diseño.
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status
    ) values (
      v_owner, null, v_activity_kind, coalesce((p_payload->>'counts_as_class')::boolean, true),
      nullif(p_payload->>'start_at', '')::timestamptz, 'in_progress'
    )
    returning * into v_registration;
  end if;

  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id, participant_status)
    values (v_owner, v_registration.id, (v_participant->>'student_id')::uuid, 'pending')
    on conflict (lesson_registration_id, student_id) do nothing;
  end loop;

  return v_registration;
end;
$$;

revoke all on function public.start_lesson_registration(jsonb) from public;
grant execute on function public.start_lesson_registration(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Guardar el registro de UN participante — atómico, nunca afecta a los
--    demás. Se llama tanto durante el registro inicial (grupal, uno por
--    uno) como para editar un registro ya finalizado (mismo mecanismo,
--    misma fila). Idempotente: repetir la misma llamada dos veces deja el
--    mismo resultado (upsert real por las unique constraints ya existentes
--    en cada tabla hija).
-- ---------------------------------------------------------------------------
create or replace function public.save_participant_registration(p_payload jsonb)
returns public.lesson_registration_students
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_student_id uuid := (p_payload->>'student_id')::uuid;
  v_participant_status text := p_payload->>'participant_status';
  v_attendance jsonb := p_payload->'attendance';
  v_evaluation jsonb := p_payload->'evaluation';
  v_homework_review jsonb;
  v_result public.lesson_registration_students;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.lesson_registrations where id = v_registration_id and owner_id = v_owner) then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.lesson_registration_students where lesson_registration_id = v_registration_id and student_id = v_student_id and owner_id = v_owner) then
    raise exception 'Ese alumno no forma parte de este registro.' using errcode = 'P0002';
  end if;

  if v_attendance is not null then
    insert into public.lesson_registration_attendance (owner_id, lesson_registration_id, student_id, status, late_minutes)
    values (v_owner, v_registration_id, v_student_id, v_attendance->>'status', nullif(v_attendance->>'late_minutes', '')::int)
    on conflict (lesson_registration_id, student_id)
    do update set status = excluded.status, late_minutes = excluded.late_minutes;
  end if;

  if v_evaluation is not null then
    insert into public.lesson_registration_evaluations (
      owner_id, lesson_registration_id, student_id, general_grade, skill_grades, strengths, areas_to_improve,
      individual_observation, individual_homework_description, individual_homework_due_date, billed_amount
    ) values (
      v_owner, v_registration_id, v_student_id,
      nullif(v_evaluation->>'general_grade', '')::numeric,
      coalesce(v_evaluation->'skill_grades', '{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(v_evaluation->'strengths')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_evaluation->'areas_to_improve')), '{}'),
      nullif(v_evaluation->>'individual_observation', ''),
      nullif(v_evaluation->>'individual_homework_description', ''),
      nullif(v_evaluation->>'individual_homework_due_date', '')::date,
      nullif(v_evaluation->>'billed_amount', '')::numeric
    )
    on conflict (lesson_registration_id, student_id)
    do update set
      general_grade = excluded.general_grade,
      skill_grades = excluded.skill_grades,
      strengths = excluded.strengths,
      areas_to_improve = excluded.areas_to_improve,
      individual_observation = excluded.individual_observation,
      individual_homework_description = excluded.individual_homework_description,
      individual_homework_due_date = excluded.individual_homework_due_date,
      billed_amount = excluded.billed_amount;
  end if;

  for v_homework_review in select * from jsonb_array_elements(p_payload->'homework_reviews')
  loop
    insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
    values (v_owner, v_registration_id, v_student_id, v_homework_review->>'task_id', v_homework_review->>'outcome', now())
    on conflict (lesson_registration_id, student_id, task_id)
    do update set outcome = excluded.outcome, reviewed_at = now();
  end loop;

  update public.lesson_registration_students
  set participant_status = coalesce(v_participant_status, participant_status)
  where lesson_registration_id = v_registration_id and student_id = v_student_id and owner_id = v_owner
  returning * into v_result;

  update public.lesson_registrations set updated_at = now() where id = v_registration_id and owner_id = v_owner;

  return v_result;
end;
$$;

revoke all on function public.save_participant_registration(jsonb) from public;
grant execute on function public.save_participant_registration(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Finalizar un registro — también sirve para editar el encabezado de
--    uno ya finalizado (duración real, tarea común, monto facturado):
--    idempotente y sin re-exigir la validación de participantes completos
--    si ya estaba `completed` (eso ya se cumplió una vez; una edición
--    posterior nunca debería quedar bloqueada por la misma regla). Sólo
--    actualiza los campos del encabezado REALMENTE presentes en el
--    payload — un campo ausente nunca sobreescribe lo ya guardado (mismo
--    criterio que `updateInputToRowPatch` de Alumnos).
-- ---------------------------------------------------------------------------
create or replace function public.finalize_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_registration public.lesson_registrations;
  v_incomplete_count int;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select * into v_registration from public.lesson_registrations where id = v_registration_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;

  if v_registration.status <> 'completed' then
    select count(*) into v_incomplete_count
    from public.lesson_registration_students
    where lesson_registration_id = v_registration_id and participant_status <> 'completed';
    if v_incomplete_count > 0 then
      raise exception 'Faltan participantes por completar.' using errcode = '22023';
    end if;
  end if;

  update public.lesson_registrations
  set
    status = 'completed',
    homework_description = case when p_payload ? 'homework_description' then nullif(p_payload->>'homework_description', '') else homework_description end,
    homework_due_date = case when p_payload ? 'homework_due_date' then nullif(p_payload->>'homework_due_date', '')::date else homework_due_date end,
    billed_amount = case when p_payload ? 'billed_amount' then nullif(p_payload->>'billed_amount', '')::numeric else billed_amount end,
    counts_as_class = case when p_payload ? 'counts_as_class' then (p_payload->>'counts_as_class')::boolean else counts_as_class end,
    actual_started_at = case when p_payload ? 'actual_started_at' then nullif(p_payload->>'actual_started_at', '')::timestamptz else actual_started_at end,
    actual_ended_at = case when p_payload ? 'actual_ended_at' then nullif(p_payload->>'actual_ended_at', '')::timestamptz else actual_ended_at end,
    updated_at = now()
  where id = v_registration_id and owner_id = v_owner
  returning * into v_registration;

  if v_registration.actual_started_at is not null and v_registration.actual_ended_at is not null
     and v_registration.actual_ended_at <= v_registration.actual_started_at then
    raise exception 'La hora de fin real debe ser posterior a la de inicio.' using errcode = '22023';
  end if;

  if v_registration.calendar_lesson_id is not null then
    update public.calendar_lessons set status = 'completed' where id = v_registration.calendar_lesson_id and owner_id = v_owner;
  end if;

  return v_registration;
end;
$$;

revoke all on function public.finalize_lesson_registration(jsonb) from public;
grant execute on function public.finalize_lesson_registration(jsonb) to authenticated;
