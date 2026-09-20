-- TeacherFlow Web — Fase 2: dos funciones RPC aditivas, ninguna tabla
-- nueva. Ambas corren `security invoker` (nunca `security definer`): RLS
-- sigue aplicando exactamente igual que en una consulta directa — filtran
-- explícitamente por `owner_id = auth.uid()` como defensa en profundidad,
-- nunca como única barrera.
--
-- IMPORTANTE: esta migración fue escrita en la sesión de Fase 2 pero NUNCA
-- se aplicó contra la base real (nunca se corrió `supabase db push` sin
-- autorización explícita, regla de la tarea). Hasta que se aplique:
--   - `renameCustomLevel` (lib/repositories/custom-levels.ts) fallará con
--     "function not found" si se invoca.
--   - `changeStudentStatus` (lib/repositories/students.ts) sigue usando su
--     implementación anterior de dos escrituras secuenciales (no atómica
--     entre sí, aunque cada escritura individual es válida) hasta que este
--     RPC exista y el repositorio se actualice para usarlo.

-- ---------------------------------------------------------------------------
-- 1) Renombrar un nivel personalizado con cascada atómica a students.levels/
--    initial_level — mismo comportamiento que renameCustomLevel +
--    renameStudentsLevel/renameProfilesLevel del móvil, pero en una sola
--    transacción real de Postgres (el móvil no tiene transacciones reales
--    entre AsyncStorage keys; acá sí, y es estrictamente mejor).
-- ---------------------------------------------------------------------------
create or replace function public.rename_custom_level(p_level_id uuid, p_new_name text)
returns public.custom_levels
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_old_name text;
  v_new_name text := btrim(p_new_name);
  v_result public.custom_levels;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if v_new_name = '' then
    raise exception 'El nombre del nivel no puede quedar vacío.' using errcode = '22023';
  end if;

  select name into v_old_name
  from public.custom_levels
  where id = p_level_id and owner_id = v_owner
  for update;

  if v_old_name is null then
    raise exception 'Nivel no encontrado.' using errcode = 'P0002';
  end if;

  if v_old_name = v_new_name then
    select * into v_result from public.custom_levels where id = p_level_id and owner_id = v_owner;
    return v_result;
  end if;

  update public.custom_levels
  set name = v_new_name
  where id = p_level_id and owner_id = v_owner
  returning * into v_result;

  -- Cascada: cualquier alumno propio que use el nombre viejo (en `levels` o
  -- en `initial_level`) pasa a usar el nombre nuevo — nunca se toca
  -- `student_level_history` (hitos históricos, se conservan tal cual
  -- quedaron registrados en su momento, mismo criterio que el móvil).
  update public.students
  set
    levels = array(
      select case when lvl = v_old_name then v_new_name else lvl end
      from unnest(levels) as lvl
    ),
    initial_level = case when initial_level = v_old_name then v_new_name else initial_level end
  where owner_id = v_owner
    and (v_old_name = any(levels) or initial_level = v_old_name);

  return v_result;
end;
$$;

comment on function public.rename_custom_level(uuid, text) is
  'Renombra un nivel personalizado propio y actualiza en la misma transacción a todos los alumnos propios que lo referencian por nombre (students.levels/initial_level) — nunca reescribe student_level_history.';

grant execute on function public.rename_custom_level(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Cambio de estado de alumno atómico — mismo resultado que
--    changeStudentStatus (lib/repositories/students.ts) pero en una sola
--    transacción: el historial y el alumno quedan juntos o ninguno de los
--    dos, nunca a medias.
-- ---------------------------------------------------------------------------
create or replace function public.change_student_status(
  p_student_id uuid,
  p_status text,
  p_occurred_on date,
  p_reason text default null,
  p_internal_note text default null
)
returns public.students
language plpgsql
security invoker
as $$
declare
  v_owner uuid := auth.uid();
  v_result public.students;
begin
  if v_owner is null then
    raise exception 'No hay una sesión autenticada.' using errcode = '28000';
  end if;
  if p_status not in ('activo', 'pausado', 'inactivo', 'archivado') then
    raise exception 'Estado de alumno inválido: %', p_status using errcode = '22023';
  end if;

  -- Bloquea la fila del alumno antes de escribir — dos cambios de estado
  -- concurrentes sobre el MISMO alumno nunca se pisan ni dejan el
  -- historial desincronizado del estado final.
  perform 1 from public.students where id = p_student_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Alumno no encontrado.' using errcode = 'P0002';
  end if;

  insert into public.student_status_history (owner_id, student_id, status, occurred_on, reason, internal_note)
  values (v_owner, p_student_id, p_status, p_occurred_on, p_reason, p_internal_note);

  update public.students
  set status = p_status, status_change_date = p_occurred_on
  where id = p_student_id and owner_id = v_owner
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.change_student_status(uuid, text, date, text, text) is
  'Cambia el estado de un alumno propio y agrega su entrada de historial en una sola transacción atómica — nunca dos escrituras separadas que puedan quedar a medias.';

grant execute on function public.change_student_status(uuid, text, date, text, text) to authenticated;
