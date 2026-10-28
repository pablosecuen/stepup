-- Una clase suelta u ocurrencia: participantes y principal cambian juntos.
create or replace function public.change_calendar_lesson_participants(p_payload jsonb,p_student_ids uuid[],p_expected_ids uuid[])
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid:=auth.uid(); v_lesson public.calendar_lessons%rowtype;
  v_current uuid[]; v_target uuid[]; v_expected uuid[]; v_primary public.students%rowtype;
begin
  if v_owner is null then raise exception 'Iniciá sesión para modificar los alumnos.' using errcode='42501'; end if;
  select array_agg(distinct x order by x) into v_target from unnest(p_student_ids) as t(x) where x is not null;
  if coalesce(cardinality(v_target),0)=0 then raise exception 'Elegí al menos un alumno.'; end if;
  if cardinality(v_target)>100 then raise exception 'La clase no puede superar los 100 alumnos.'; end if;
  if (select count(*) from public.students where id=any(v_target) and owner_id=v_owner)<>cardinality(v_target) then raise exception 'Alguno de los alumnos no está disponible.' using errcode='42501'; end if;
  if nullif(p_payload->>'lesson_id','') is not null then
    select * into v_lesson from public.calendar_lessons where id=(p_payload->>'lesson_id')::uuid and owner_id=v_owner for update;
    if not found then raise exception 'Clase no encontrada.'; end if;
  else
    -- La materialización y el cambio se revierten juntos si falla cualquier validación.
    select * into v_lesson from public.edit_calendar_lesson(p_payload);
  end if;
  if v_lesson.status not in ('scheduled','rescheduled') then raise exception 'No se puede cambiar una clase cancelada o completada.'; end if;
  if exists(select 1 from public.lesson_registrations where owner_id=v_owner and calendar_lesson_id=v_lesson.id)
     or exists(select 1 from public.payment_charges where owner_id=v_owner and calendar_lesson_id=v_lesson.id) then
    raise exception 'Esta clase ya tiene registro o cobro. Conservá su historial y editá desde el registro.';
  end if;
  select array_agg(distinct x order by x) into v_current from (
    select student_id as x from public.calendar_lesson_participants where calendar_lesson_id=v_lesson.id and owner_id=v_owner
    union select v_lesson.primary_student_id
  ) as ids;
  if v_current=v_target then return v_lesson.id; end if;
  select array_agg(distinct x order by x) into v_expected from unnest(p_expected_ids) as t(x);
  if v_current is distinct from v_expected then raise exception 'Los participantes cambiaron en otra ventana. Recargá antes de guardar.'; end if;
  if exists(select 1 from public.students where id=any(v_target) and not(id=any(v_current)) and status<>'activo') then raise exception 'Sólo se pueden agregar alumnos activos.'; end if;
  -- Conserva el principal si sigue; si se quita, promueve a un integrante real.
  select * into v_primary from public.students where owner_id=v_owner and id=case when v_lesson.primary_student_id=any(v_target) then v_lesson.primary_student_id else p_student_ids[1] end;
  delete from public.calendar_lesson_participants where owner_id=v_owner and calendar_lesson_id=v_lesson.id and not(student_id=any(v_target));
  insert into public.calendar_lesson_participants(owner_id,calendar_lesson_id,student_id,student_name,level)
    select v_owner,v_lesson.id,id,name,coalesce(levels[1],'') from public.students where owner_id=v_owner and id=any(v_target)
    on conflict(calendar_lesson_id,student_id) do nothing;
  update public.calendar_lessons set primary_student_id=v_primary.id,student_name=v_primary.name,level=coalesce(v_primary.levels[1],''),lesson_type=case when cardinality(v_target)>1 then 'group' else 'individual' end
    where id=v_lesson.id and owner_id=v_owner;
  return v_lesson.id;
end;
$$;
revoke all on function public.change_calendar_lesson_participants(jsonb,uuid[],uuid[]) from public,anon;
grant execute on function public.change_calendar_lesson_participants(jsonb,uuid[],uuid[]) to authenticated;
