-- Resultados de una clase PROGRAMADA (no sólo «Realizada»), como en la app anterior: alumno ausente (con o sin aviso, sólo clase individual), profesora
-- ausente, feriado (con o sin excepción), cancelada con aviso, cancelada tarde (con política de cobro) y reprogramada.
--
-- 1) Nuevo resultado `alumno_ausente`: la clase no se dictó (no cuenta como clase, ni suma horas, ni cobra). La asistencia del alumno («ausente» o
--    «ausente con aviso») se guarda aparte, igual que antes.
-- 2) `change_lesson_registration_outcome`: cambia el resultado de un registro TODAVÍA EN CURSO. Si el resultado no implica que la clase se dictó, deja a todos
--    los participantes completados (no hay nada que cargar); si vuelve a ser una clase dictada, los pone de nuevo pendientes. Nunca toca un registro ya
--    finalizado (se edita con `edit_completed_lesson_registration`).
--
-- Aditiva e idempotente: ningún dato existente cambia (los registros importados siguen igual, con su resultado original aparte).
alter table public.lesson_registrations drop constraint if exists lesson_registrations_outcome_check;
alter table public.lesson_registrations
  add constraint lesson_registrations_outcome_check
  check (outcome in ('clase_dictada', 'profesora_ausente', 'feriado', 'cancelada_con_aviso', 'cancelada_tarde', 'reprogramada', 'alumno_ausente'));

create or replace function public.change_lesson_registration_outcome(p_payload jsonb)
returns public.lesson_registrations
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid := nullif(p_payload->>'lesson_registration_id', '')::uuid;
  v_outcome text := p_payload->>'outcome';
  v_holiday_exception boolean := coalesce((p_payload->>'holiday_exception')::boolean, false);
  v_policy text := nullif(p_payload->>'late_cancellation_policy', '');
  v_percentage smallint := nullif(p_payload->>'late_cancellation_percentage', '')::smallint;
  v_row public.lesson_registrations;
  v_held boolean;
begin
  if v_owner is null then raise exception 'No hay una sesión autenticada.' using errcode = '28000'; end if;
  if v_outcome is null or v_outcome not in ('clase_dictada', 'profesora_ausente', 'feriado', 'cancelada_con_aviso', 'cancelada_tarde', 'reprogramada', 'alumno_ausente') then
    raise exception 'El resultado de la clase no es válido.' using errcode = '22023';
  end if;

  select * into v_row from public.lesson_registrations where id = v_id and owner_id = v_owner for update;
  if not found then raise exception 'Registro no encontrado.' using errcode = 'P0002'; end if;
  if v_row.status = 'completed' then
    raise exception 'Este registro ya está finalizado — usá Guardar cambios para editarlo.' using errcode = '22023';
  end if;
  if v_outcome = 'alumno_ausente' and (select count(*) from public.lesson_registration_students where lesson_registration_id = v_id and owner_id = v_owner) <> 1 then
    raise exception 'Alumno ausente sólo se puede elegir en una clase individual.' using errcode = '22023';
  end if;
  if v_outcome = 'cancelada_tarde' then
    if v_policy is null or v_policy not in ('cobrar_100', 'cobrar_porcentaje', 'descontar_del_paquete', 'no_cobrar') then
      raise exception 'Elegí la política de cancelación tardía.' using errcode = '22023';
    end if;
    if v_policy = 'cobrar_porcentaje' and (v_percentage is null or v_percentage < 0 or v_percentage > 100) then
      raise exception 'Indicá el porcentaje a cobrar (de 0 a 100).' using errcode = '22023';
    end if;
  else
    v_policy := null;
    v_percentage := null;
  end if;
  if v_outcome <> 'feriado' then v_holiday_exception := false; end if;
  if v_policy <> 'cobrar_porcentaje' then v_percentage := null; end if;

  v_held := v_outcome = 'clase_dictada' or (v_outcome = 'feriado' and v_holiday_exception);

  update public.lesson_registrations
  set outcome = v_outcome,
      holiday_exception = v_holiday_exception,
      late_cancellation_policy = v_policy,
      late_cancellation_percentage = v_percentage,
      counts_as_class = v_held,
      updated_at = now()
  where id = v_id and owner_id = v_owner
  returning * into v_row;

  if not v_held then
    update public.lesson_registration_students set participant_status = 'completed' where lesson_registration_id = v_id and owner_id = v_owner;
  else
    -- Vuelve a ser una clase dictada: sólo se reabren los participantes que se habían cerrado automáticamente (sin asistencia cargada).
    update public.lesson_registration_students s set participant_status = 'pending'
    where s.lesson_registration_id = v_id and s.owner_id = v_owner and s.participant_status = 'completed'
      and not exists (select 1 from public.lesson_registration_attendance a where a.lesson_registration_id = v_id and a.student_id = s.student_id and a.owner_id = v_owner);
  end if;

  return v_row;
end;
$$;
revoke all on function public.change_lesson_registration_outcome(jsonb) from public, anon, authenticated;
grant execute on function public.change_lesson_registration_outcome(jsonb) to authenticated;
