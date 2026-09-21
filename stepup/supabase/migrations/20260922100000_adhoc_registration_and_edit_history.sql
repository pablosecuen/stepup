-- TeacherFlow Web — Fase 4 (cierre de brechas): registro ad-hoc real
-- (equivalente a NewClassScreen.tsx del móvil, sin reserva previa de
-- Calendario), notas por habilidad (sin cambios de esquema — ver abajo) y
-- auditoría real de ediciones (equivalente a LessonEditAuditEntry/
-- editHistory del móvil). Migración aditiva — nunca edita las migraciones
-- ya aplicadas de Fase 1-4. NUNCA aplicada todavía — este archivo puede
-- reescribirse libremente hasta que se ejecute `supabase db push`.
--
-- Revisión de esta ronda (a pedido explícito de Joaquín, antes de aplicar):
-- la primera versión de este archivo declaraba "cada llamada ad-hoc crea
-- una fila nueva, nunca se deduplica" confiando en `useTransition`/
-- `disabled` del lado del cliente — eso NUNCA es una garantía real contra
-- doble clic, reintento tras una respuesta perdida, dos pestañas, o dos
-- requests genuinamente simultáneas. También encadenaba dos escrituras
-- separadas (`snapshot_lesson_registration_edit` y después
-- `save_participant_registration`/`finalize_lesson_registration`) para
-- editar un registro finalizado — sin atomicidad real entre ambas. Las dos
-- brechas se corrigen acá con: (1) un `operation_id` UUID generado UNA
-- SOLA VEZ del lado del cliente, persistido, con restricción UNIQUE real
-- por dueño e insertado con `ON CONFLICT ... DO UPDATE ... RETURNING`
-- (nunca un patrón "SELECT y después INSERT", que sí tiene una ventana de
-- carrera real); (2) una única RPC transaccional
-- (`edit_completed_lesson_registration`) que hace snapshot + aplica todos
-- los cambios académicos en la MISMA transacción, con su propio
-- `edit_operation_id` idempotente.
--
-- Las notas por habilidad (SkillGradeChips.tsx) NO requieren ningún cambio
-- de esquema: `lesson_registration_evaluations.skill_grades` ya existe
-- desde Fase 1 (`20260916121000_lesson_registrations.sql`) y
-- `save_participant_registration` ya lo persiste desde Fase 4 — sólo
-- faltaba la interfaz para completarlo, agregada en esta ronda sin tocar
-- la base de datos.
--
-- Columnas nuevas en `lesson_registrations` (todas con default seguro para
-- las filas ya existentes, todas irrelevantes/no usadas por el camino
-- ligado a Calendario, que sigue exactamente igual que antes):
--   - `outcome` — subconjunto real y acotado de `EventType` (móvil,
--     `types/index.ts`): 'clase_dictada' | 'profesora_ausente' | 'feriado'.
--     Deliberadamente NUNCA se portan 'cancelada_con_aviso'/'cancelada_tarde'
--     (exigen `lateCancellationPolicy`/`lateCancellationPercentage`, motor
--     financiero de Fase 5, todavía no implementado — sin esos campos,
--     ofrecer la opción sin forma de completarla sería peor que no
--     ofrecerla) ni 'reprogramada' (enlaza a OTRO registro ad-hoc en el
--     móvil vía `rescheduledFromLessonId` — mecanismo distinto y
--     redundante con el reprogramar real de Calendario ya construido y
--     verificado en Fase 3, que ya cubre "esta clase se movió a otro
--     horario" para el camino ligado a Calendario). Diferencia real
--     documentada, no inventada ni escondida — confirmado leyendo el HEAD
--     actual de `NewClassScreen.tsx`/`PendingClassOutcomeSelector.tsx`.
--   - `holiday_exception` — igual criterio que `NewClassFormState.holidayException`
--     del móvil: sólo tiene efecto cuando `outcome = 'feriado'`.
--   - `modality` — el registro ligado a Calendario ya tiene su propia
--     modalidad en `calendar_lessons.modality`; un registro ad-hoc no tiene
--     ninguna fila de Calendario de la que leerla, así que necesita la suya.
--   - `scheduled_end_at` — mismo criterio: un registro ligado a Calendario
--     ya tiene su hora de fin en `calendar_lessons.end_at`; uno ad-hoc
--     necesita la propia para poder precargar "Duración real" con un valor
--     sensato al finalizar.
--   - `operation_id` — UUID estable generado UNA VEZ del lado del cliente
--     al montar el formulario de `/registro/nuevo` (nunca regenerado en
--     reintentos/errores de validación, sólo en un montaje nuevo genuino).
--     Sólo se usa (y se exige) en el camino ad-hoc — el camino ligado a
--     Calendario ya tiene su propia idempotencia real y probada vía el
--     índice único de `(owner_id, calendar_lesson_id)`.
alter table public.lesson_registrations
  add column if not exists outcome text not null default 'clase_dictada' check (outcome in ('clase_dictada', 'profesora_ausente', 'feriado')),
  add column if not exists holiday_exception boolean not null default false,
  add column if not exists modality text check (modality is null or modality in ('presencial', 'online', 'mixta')),
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists operation_id uuid;

comment on column public.lesson_registrations.outcome is
  'Subconjunto real de EventType (móvil) sin campos financieros ni reprogramación — ver comentario de esta migración para qué se excluye y por qué.';
comment on column public.lesson_registrations.operation_id is
  'Idempotencia real del camino ad-hoc (calendar_lesson_id null): UUID generado una sola vez del lado del cliente, nunca regenerado en un reintento — ver índice único de abajo.';

create unique index if not exists lesson_registrations_owner_operation_unique
  on public.lesson_registrations (owner_id, operation_id)
  where operation_id is not null;

-- ---------------------------------------------------------------------------
-- Auditoría real de ediciones — espeja LessonEditAuditEntry/SavedLesson.editHistory
-- del móvil (append-only: nunca se actualiza ni se borra una fila existente,
-- reforzado con RLS — ver política de abajo, que sólo permite SELECT/INSERT,
-- nunca UPDATE/DELETE, ni siquiera para el propio dueño). Alcance: sólo el
-- estado ACADÉMICO previo (encabezado + participantes + asistencia +
-- evaluación + revisiones de tarea) — nunca campos financieros
-- (`billedAmount`/`appliedPolicy` del móvil), mismo criterio de exclusión
-- de Fase 5 aplicado en el resto de esta fase.
--
-- `edit_operation_id` es la idempotencia real de una edición: UUID generado
-- una sola vez del lado del cliente por cada intento de "Guardar cambios"
-- sobre un registro ya finalizado — la restricción UNIQUE de abajo impide
-- que un reintento (doble clic, respuesta perdida, dos pestañas) duplique
-- la entrada de auditoría o vuelva a aplicar los cambios académicos.
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_registration_edit_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lesson_registration_id uuid not null references public.lesson_registrations(id) on delete cascade,
  edit_operation_id uuid not null,
  edited_at timestamptz not null default now(),
  previous_snapshot jsonb not null,
  constraint lesson_registration_edit_history_operation_unique unique (lesson_registration_id, edit_operation_id)
);

comment on table public.lesson_registration_edit_history is
  'Append-only real — puerto de SavedLesson.editHistory (móvil). Cada fila conserva el estado académico EXACTO de justo antes de una edición sobre un registro ya finalizado. RLS abajo prohíbe UPDATE/DELETE incluso para el dueño.';

create index if not exists lesson_registration_edit_history_owner_idx on public.lesson_registration_edit_history (owner_id);
create index if not exists lesson_registration_edit_history_lesson_idx on public.lesson_registration_edit_history (lesson_registration_id, edited_at desc);
alter table public.lesson_registration_edit_history enable row level security;

-- Revisión de esta ronda (a pedido explícito de Joaquín): una política de
-- INSERT para el propio dueño, aunque sólo se usara desde la RPC en la
-- práctica, seguía dejando la puerta abierta a que `authenticated` insertara
-- un snapshot arbitrario DIRECTO por REST (PostgREST expone la tabla igual
-- que cualquier otra; RLS por sí sola no distingue "vino de la RPC" de "vino
-- de un POST directo a /rest/v1/lesson_registration_edit_history"). Ahora
-- SÓLO existe una política de SELECT — nadie, ni siquiera el propio dueño,
-- puede insertar/actualizar/borrar una fila de auditoría por su cuenta.
-- La única escritura real posible es la que hace `edit_completed_lesson_registration`
-- (abajo) como `security definer`, que sí tiene privilegio de tabla real
-- (el dueño de la función) para escribir — ver esa función para el resto
-- del endurecimiento (search_path fijo, nombres calificados, auth.uid()
-- obligatorio, owner_id validado en cada acceso).
drop policy if exists lesson_registration_edit_history_owner_all on public.lesson_registration_edit_history;
drop policy if exists lesson_registration_edit_history_owner_select on public.lesson_registration_edit_history;
drop policy if exists lesson_registration_edit_history_owner_insert on public.lesson_registration_edit_history;
create policy lesson_registration_edit_history_owner_select on public.lesson_registration_edit_history
  for select using (owner_id = auth.uid());

-- Defensa en profundidad explícita — nunca depender SÓLO de "no hay
-- política de INSERT/UPDATE/DELETE" (RLS deniega por ausencia de política,
-- pero un REVOKE a nivel de tabla es una segunda barrera real e
-- independiente, que sigue protegiendo aunque alguien agregue una política
-- nueva sin darse cuenta de esta regla).
revoke insert, update, delete, truncate on public.lesson_registration_edit_history from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1) start_lesson_registration — se reemplaza para sumar outcome/
--    holiday_exception/modality/end_at/operation_id.
--
--    Idempotencia real del camino ad-hoc: `operation_id` es OBLIGATORIO
--    cuando `calendar_lesson_id` es null, y la fila se escribe con
--    `INSERT ... ON CONFLICT (owner_id, operation_id) DO UPDATE ...
--    RETURNING` — nunca un `SELECT` previo para decidir si insertar (esa
--    ventana entre el SELECT y el INSERT es exactamente donde dos
--    requests simultáneas con el mismo operation_id podrían crear dos
--    filas). Dos llamadas con el MISMO operation_id — doble clic,
--    reintento tras una respuesta perdida, dos pestañas, dos requests
--    genuinamente concurrentes — convergen siempre en la MISMA fila,
--    garantizado por la restricción UNIQUE real de la base, no por
--    ninguna protección visual del botón. Un operation_id distinto
--    (una acción nueva y legítima) sí crea una fila nueva, aunque
--    alumno/fecha/horario coincidan con un registro anterior.
--
--    Regla real del móvil (sin cambios respecto de la ronda anterior):
--    cuando el resultado NO implica que la actividad se dictó
--    (`isClassHeld` = false), no hay asistencia/evaluación/tarea que
--    completar por participante — se insertan directamente como
--    `participant_status = 'completed'`.
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
  v_outcome text := coalesce(p_payload->>'outcome', 'clase_dictada');
  v_holiday_exception boolean := coalesce((p_payload->>'holiday_exception')::boolean, false);
  v_operation_id uuid := nullif(p_payload->>'operation_id', '')::uuid;
  v_class_held boolean := (coalesce(p_payload->>'outcome', 'clase_dictada') = 'clase_dictada')
    or (p_payload->>'outcome' = 'feriado' and coalesce((p_payload->>'holiday_exception')::boolean, false));
  v_registration public.lesson_registrations;
  v_participant jsonb;
  v_participant_status text;
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
  if jsonb_array_length(coalesce(p_payload->'participants', '[]'::jsonb)) = 0 then
    raise exception 'Elegí al menos un alumno.' using errcode = '22023';
  end if;
  if v_calendar_lesson_id is null and v_operation_id is null then
    raise exception 'operation_id es obligatorio para un registro ad-hoc.' using errcode = '22023';
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

  -- Revisión de esta ronda (a pedido explícito de Joaquín — "un reintento
  -- no puede modificar participantes"): `ON CONFLICT ... DO UPDATE` seguido
  -- SIEMPRE del bucle de participantes de abajo era la brecha real —
  -- reenviar el MISMO operation_id/calendar_lesson_id con un payload de
  -- participantes DISTINTO (por accidente o mala fe) terminaba agregando
  -- participantes a una operación que la base ya había marcado como
  -- resuelta. Ahora `ON CONFLICT ... DO NOTHING RETURNING *` + `FOUND`
  -- distinguen sin ambigüedad "fila genuinamente nueva" (sigue de largo al
  -- bucle) de "esta operación ya se había consumido" (devuelve la fila
  -- real tal cual está, `return` inmediato — nunca reprocesa
  -- participantes, nunca toca `updated_at` ni ningún otro campo). Sigue
  -- sin haber ningún `SELECT` antes del `INSERT` para decidir si crear: el
  -- `INSERT ... ON CONFLICT` es la única fuente de verdad atómica, y el
  -- `SELECT` de abajo sólo se ejecuta DESPUÉS de que la base ya resolvió
  -- el conflicto, para leer el resultado real — nunca para decidirlo.
  if v_calendar_lesson_id is not null then
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, status
    ) values (
      v_owner, v_calendar_lesson_id, v_activity_kind, coalesce((p_payload->>'counts_as_class')::boolean, true),
      (p_payload->>'start_at')::timestamptz, 'in_progress'
    )
    on conflict (owner_id, calendar_lesson_id) where calendar_lesson_id is not null
    do nothing
    returning * into v_registration;

    if not found then
      select * into v_registration from public.lesson_registrations where owner_id = v_owner and calendar_lesson_id = v_calendar_lesson_id;
      return v_registration;
    end if;
  else
    -- Ad-hoc (sin reserva de calendario, como NewClassScreen.tsx en el
    -- móvil) — idempotente por `operation_id`: dos llamadas con el mismo
    -- id SIEMPRE convergen en la misma fila. Un operation_id nuevo SIEMPRE
    -- inserta una fila nueva, sin importar si alumno/fecha/hora coinciden
    -- con un registro anterior.
    insert into public.lesson_registrations (
      owner_id, calendar_lesson_id, activity_kind, counts_as_class, scheduled_start_at, scheduled_end_at,
      outcome, holiday_exception, modality, operation_id, status
    ) values (
      v_owner, null, v_activity_kind, v_class_held,
      nullif(p_payload->>'start_at', '')::timestamptz, nullif(p_payload->>'end_at', '')::timestamptz,
      v_outcome, v_holiday_exception, nullif(p_payload->>'modality', ''), v_operation_id, 'in_progress'
    )
    on conflict (owner_id, operation_id) where operation_id is not null
    do nothing
    returning * into v_registration;

    if not found then
      select * into v_registration from public.lesson_registrations where owner_id = v_owner and operation_id = v_operation_id;
      return v_registration;
    end if;
  end if;

  -- Cuando la actividad no se dictó (profesora ausente, o feriado sin
  -- excepción), no hay asistencia/evaluación/tarea que completar por
  -- participante — se insertan directamente 'completed' para habilitar
  -- "Finalizar registro" de inmediato, mismo criterio que `classHeld` del
  -- móvil (esas secciones ni se muestran en ese caso).
  v_participant_status := case when v_class_held then 'pending' else 'completed' end;
  for v_participant in select * from jsonb_array_elements(p_payload->'participants')
  loop
    insert into public.lesson_registration_students (owner_id, lesson_registration_id, student_id, participant_status)
    values (v_owner, v_registration.id, (v_participant->>'student_id')::uuid, v_participant_status)
    on conflict (lesson_registration_id, student_id) do nothing;
  end loop;

  return v_registration;
end;
$$;

revoke all on function public.start_lesson_registration(jsonb) from public;
grant execute on function public.start_lesson_registration(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) save_participant_registration — sin cambios de lógica, salvo un
--    guardia nuevo: una vez que el registro está `completed`, esta RPC
--    deja de aceptar escrituras — toda edición posterior de un registro ya
--    finalizado pasa OBLIGATORIAMENTE por `edit_completed_lesson_registration`
--    (abajo), la única vía atómica real. Esto cierra la puerta a que un
--    cliente viejo/caché reintroduzca el flujo de dos escrituras separadas
--    que esta misma migración corrige.
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
  v_registration_status text;
  v_participant_status text := p_payload->>'participant_status';
  v_attendance jsonb := p_payload->'attendance';
  v_evaluation jsonb := p_payload->'evaluation';
  v_homework_review jsonb;
  v_result public.lesson_registration_students;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;

  select status into v_registration_status from public.lesson_registrations where id = v_registration_id and owner_id = v_owner;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if v_registration_status = 'completed' then
    raise exception 'Este registro ya está finalizado — usá edit_completed_lesson_registration para editarlo.' using errcode = '22023';
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
-- 3) finalize_lesson_registration — vuelve a ser EXCLUSIVAMENTE la
--    transición real in_progress -> completed (primer finalizado). Ya NO
--    sirve para editar un registro ya `completed` — esa responsabilidad
--    pasa por completo a `edit_completed_lesson_registration` (abajo), la
--    única vía atómica real. Llamarla sobre un registro ya completed
--    ahora es un error explícito, nunca un "editar en silencio".
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
  if v_registration.status = 'completed' then
    raise exception 'Este registro ya está finalizado — usá edit_completed_lesson_registration para editarlo.' using errcode = '22023';
  end if;

  select count(*) into v_incomplete_count
  from public.lesson_registration_students
  where lesson_registration_id = v_registration_id and participant_status <> 'completed';
  if v_incomplete_count > 0 then
    raise exception 'Faltan participantes por completar.' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- 4) edit_completed_lesson_registration — NUEVA. Única vía real para editar
--    un registro YA finalizado: snapshot de auditoría + todos los cambios
--    académicos (encabezado + N participantes) en UNA SOLA transacción.
--    Nunca dos operaciones separadas del lado del cliente.
--
--    Idempotencia real por `edit_operation_id` (UUID generado una sola vez
--    del lado del cliente por cada intento de "Guardar cambios"): el
--    snapshot se inserta con `ON CONFLICT (lesson_registration_id,
--    edit_operation_id) DO NOTHING RETURNING id` — si la fila YA existía
--    (mismo edit_operation_id ya aplicado antes), la función NUNCA vuelve
--    a aplicar ningún cambio académico y devuelve el estado actual tal
--    cual — ni duplica el historial, ni reaplica efectos.
--
--    Atomicidad real: `select ... for update` bloquea la fila del
--    registro para toda la duración de la función — dos llamadas
--    concurrentes con el mismo edit_operation_id se serializan por ese
--    lock (la segunda espera a que la primera termine su transacción
--    completa, ve el snapshot ya insertado por la primera, y su propio
--    intento de insertarlo de nuevo choca contra la restricción UNIQUE:
--    vuelve null, no reaplica nada). Cualquier error dentro de la función
--    (alumno ajeno, orden temporal inválido, etc.) revierte TODO —
--    Postgres nunca deja una función `plpgsql` a mitad de camino: sin
--    manejo explícito de excepción, cualquier `raise exception` aborta la
--    transacción completa, snapshot incluido.
--
--    `security definer` (a pedido explícito de Joaquín, revisión de esta
--    ronda) — necesario porque `lesson_registration_edit_history` ya NO
--    tiene ninguna política de INSERT para `authenticated` (ver arriba):
--    sólo esta función, corriendo con el privilegio real de su dueño,
--    puede escribir ahí. Endurecida en consecuencia:
--      - `set search_path = ''` — nunca confía en el search_path de quien
--        llama; cada referencia de acá abajo ya estaba (y sigue estando)
--        completamente calificada (`public.xxx`), así que esto no cambia
--        ningún comportamiento, sólo blinda contra que un `search_path`
--        manipulado redirija una referencia sin calificar hacia un objeto
--        de otro esquema (`pg_catalog` sigue implícito siempre, nunca hace
--        falta calificar `now()`/`jsonb_build_object()`/etc.).
--      - `auth.uid()` obligatorio (`v_owner is null` → excepción) — sin
--        esto, `security definer` correría con el UID real pero SIN
--        verificar que haya sesión real.
--      - Cada acceso a cada tabla sigue validando `owner_id = v_owner`
--        explícitamente (nunca se apoya en RLS, que acá está bypaseada por
--        ser `security definer` — la única fuente real de aislamiento por
--        dueño adentro de esta función es este chequeo manual, repetido en
--        cada SELECT/INSERT/UPDATE).
--      - `grant execute` sigue siendo sólo para `authenticated`, revocado
--        de `public` — anon nunca puede invocarla.
-- ---------------------------------------------------------------------------
create or replace function public.edit_completed_lesson_registration(p_payload jsonb)
returns public.lesson_registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_registration_id uuid := (p_payload->>'lesson_registration_id')::uuid;
  v_edit_operation_id uuid := nullif(p_payload->>'edit_operation_id', '')::uuid;
  v_registration public.lesson_registrations;
  v_history_id uuid;
  v_participant jsonb;
  v_student_id uuid;
  v_attendance jsonb;
  v_evaluation jsonb;
  v_homework_review jsonb;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_edit_operation_id is null then
    raise exception 'edit_operation_id es obligatorio.' using errcode = '22023';
  end if;

  select * into v_registration from public.lesson_registrations where id = v_registration_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Registro no encontrado.' using errcode = 'P0002';
  end if;
  if v_registration.status <> 'completed' then
    raise exception 'Esta RPC sólo edita registros ya finalizados — usá start_lesson_registration/save_participant_registration/finalize_lesson_registration para el registro inicial.' using errcode = '22023';
  end if;

  -- Verifica que cada participante del payload realmente pertenezca a
  -- este registro ANTES de tocar nada — nunca a mitad de la escritura.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'participants', '[]'::jsonb)) as p
    where not exists (
      select 1 from public.lesson_registration_students s
      where s.lesson_registration_id = v_registration_id and s.student_id = (p->>'student_id')::uuid and s.owner_id = v_owner
    )
  ) then
    raise exception 'Ese alumno no forma parte de este registro.' using errcode = 'P0002';
  end if;

  -- Snapshot append-only ANTES de aplicar cualquier cambio — atómico con
  -- el resto de la función (misma transacción). `ON CONFLICT DO NOTHING`
  -- es la idempotencia real: si `v_history_id` vuelve null, este
  -- `edit_operation_id` ya se aplicó antes (por esta misma llamada
  -- reintentada, o por una concurrente que ganó la carrera) — se corta acá
  -- sin tocar ningún dato académico de nuevo.
  insert into public.lesson_registration_edit_history (owner_id, lesson_registration_id, edit_operation_id, edited_at, previous_snapshot)
  values (
    v_owner, v_registration_id, v_edit_operation_id, now(),
    jsonb_build_object(
      'registration', to_jsonb(v_registration),
      'participants', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.lesson_registration_students s where s.lesson_registration_id = v_registration_id and s.owner_id = v_owner),
      'attendance', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.lesson_registration_attendance a where a.lesson_registration_id = v_registration_id and a.owner_id = v_owner),
      'evaluations', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.lesson_registration_evaluations e where e.lesson_registration_id = v_registration_id and e.owner_id = v_owner),
      'homework_reviews', (select coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) from public.lesson_registration_homework_reviews h where h.lesson_registration_id = v_registration_id and h.owner_id = v_owner)
    )
  )
  on conflict (lesson_registration_id, edit_operation_id) do nothing
  returning id into v_history_id;

  if v_history_id is null then
    -- Este edit_operation_id ya se aplicó — nunca reaplicar, nunca duplicar el historial.
    return v_registration;
  end if;

  -- Aplica los cambios académicos de cada participante — mismo criterio
  -- exacto que `save_participant_registration`, nunca una segunda regla
  -- paralela.
  for v_participant in select * from jsonb_array_elements(coalesce(p_payload->'participants', '[]'::jsonb))
  loop
    v_student_id := (v_participant->>'student_id')::uuid;
    v_attendance := v_participant->'attendance';
    v_evaluation := v_participant->'evaluation';

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

    for v_homework_review in select * from jsonb_array_elements(coalesce(v_participant->'homework_reviews', '[]'::jsonb))
    loop
      insert into public.lesson_registration_homework_reviews (owner_id, lesson_registration_id, student_id, task_id, outcome, reviewed_at)
      values (v_owner, v_registration_id, v_student_id, v_homework_review->>'task_id', v_homework_review->>'outcome', now())
      on conflict (lesson_registration_id, student_id, task_id)
      do update set outcome = excluded.outcome, reviewed_at = now();
    end loop;
  end loop;

  -- Aplica los cambios del encabezado — mismo criterio de "campo ausente
  -- nunca sobreescribe lo ya guardado" que ya usaba finalize_lesson_registration.
  update public.lesson_registrations
  set
    homework_description = case when p_payload ? 'homework_description' then nullif(p_payload->>'homework_description', '') else homework_description end,
    homework_due_date = case when p_payload ? 'homework_due_date' then nullif(p_payload->>'homework_due_date', '')::date else homework_due_date end,
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

  return v_registration;
end;
$$;

revoke all on function public.edit_completed_lesson_registration(jsonb) from public;
grant execute on function public.edit_completed_lesson_registration(jsonb) to authenticated;
