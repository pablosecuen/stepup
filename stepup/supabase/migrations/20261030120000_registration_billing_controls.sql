-- Extiende el guardado compartido; conserva los valores cuando un cliente anterior no envía los controles.
begin;
do $$ begin
  if to_regprocedure('public.apply_lesson_pedagogical_content_before_billing(uuid,jsonb)') is null then
    alter function public.apply_lesson_pedagogical_content(uuid,jsonb) rename to apply_lesson_pedagogical_content_before_billing;
  end if;
end $$;
create or replace function public.apply_lesson_pedagogical_content(p_registration_id uuid,p_content jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (p_content ? 'is_billable' and jsonb_typeof(p_content->'is_billable') is distinct from 'boolean')
    or (p_content ? 'consumes_monthly_package' and jsonb_typeof(p_content->'consumes_monthly_package') is distinct from 'boolean') then
    raise exception 'Revisá las opciones de cobro y consumo de cuota.' using errcode='22023';
  end if;
  perform public.apply_lesson_pedagogical_content_before_billing(p_registration_id,p_content);
  update public.lesson_registrations set
    is_billable=case when p_content ? 'is_billable' then (p_content->>'is_billable')::boolean else is_billable end,
    consumes_monthly_package=case when p_content ? 'consumes_monthly_package' then (p_content->>'consumes_monthly_package')::boolean else consumes_monthly_package end
    where id=p_registration_id and owner_id=auth.uid();
end;
$$;
revoke all on function public.apply_lesson_pedagogical_content(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.apply_lesson_pedagogical_content_before_billing(uuid,jsonb) from public,anon,authenticated;
commit;
