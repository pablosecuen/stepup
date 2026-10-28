-- Logro de nivel: historial append-only y nivel actual en la misma transacción.
create or replace function public.record_student_level_achievement(
  p_student_id uuid, p_operation_id uuid, p_level text, p_achieved_on date,
  p_note text default null, p_confirm_warning boolean default false,
  p_expected_level text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_student public.students%rowtype;
  v_existing public.student_level_history%rowtype;
  v_previous date;
  v_current text;
  v_order text[] := array['A1','A2','B1','B2','C1','C2'];
  v_step integer;
  v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if v_owner is null then raise exception 'Iniciá sesión para registrar el logro.' using errcode = '42501'; end if;
  if p_operation_id is null then raise exception 'Falta la clave de operación.'; end if;
  select * into v_student from public.students where id=p_student_id and owner_id=v_owner for update;
  if not found then raise exception 'Alumno no encontrado.' using errcode='P0002'; end if;
  -- Una respuesta perdida se puede reintentar aun cuando ya cambió el nivel.
  select * into v_existing from public.student_level_history where id=p_operation_id;
  if found then
    if v_existing.owner_id <> v_owner or v_existing.student_id <> p_student_id or v_existing.level <> p_level or v_existing.achieved_on <> p_achieved_on or coalesce(v_existing.note,'') <> coalesce(nullif(btrim(p_note),''),'') then
      raise exception 'La operación ya fue usada con otros datos.';
    end if;
    return to_jsonb(v_existing);
  end if;
  if p_level is null or not p_level = any(v_order) then raise exception 'Elegí un nivel de A1 a C2.'; end if;
  if p_achieved_on is null or p_achieved_on > v_today then raise exception 'La fecha del logro no puede ser futura.'; end if;
  select x into v_current from unnest(v_student.levels) with ordinality as t(x,n) where x=any(v_order) order by n limit 1;
  if coalesce(v_current,'') is distinct from coalesce(p_expected_level,'') then raise exception 'El nivel cambió en otra ventana. Recargá antes de continuar.'; end if;
  if v_current=p_level then raise exception 'El alumno ya está en ese nivel.'; end if;
  select max(achieved_on) into v_previous from public.student_level_history where owner_id=v_owner and student_id=p_student_id;
  if v_previous is not null and p_achieved_on < v_previous then raise exception 'La fecha no puede ser anterior al último logro registrado.'; end if;
  v_previous := coalesce(v_previous,v_student.date_joined);
  if p_achieved_on < v_previous then raise exception 'La fecha no puede ser anterior al inicio del alumno.'; end if;
  v_step := array_position(v_order,p_level)-array_position(v_order,v_current);
  if (v_step < 0 or v_step > 1) and not coalesce(p_confirm_warning,false) then raise exception 'Confirmá el salto o la corrección de nivel.'; end if;
  if length(coalesce(p_note,'')) > 4000 then raise exception 'La nota no puede superar 4000 caracteres.'; end if;
  insert into public.student_level_history(id,owner_id,student_id,level,from_level,achieved_on,recorded_at,previous_milestone_at,duration_days,note,origin)
    values(p_operation_id,v_owner,p_student_id,p_level,v_current,p_achieved_on,now(),v_previous::timestamp at time zone 'America/Argentina/Buenos_Aires',p_achieved_on-v_previous,nullif(btrim(p_note),''),'manual') returning * into v_existing;
  update public.students set levels=array[p_level] || array(select x from unnest(v_student.levels) as t(x) where not x=any(v_order)),updated_at=now() where id=p_student_id and owner_id=v_owner;
  return to_jsonb(v_existing);
end;
$$;
revoke all on function public.record_student_level_achievement(uuid,uuid,text,date,text,boolean,text) from public,anon;
grant execute on function public.record_student_level_achievement(uuid,uuid,text,date,text,boolean,text) to authenticated;
