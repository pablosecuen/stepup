-- Explicit replacement links. Keep historical rows; do not draw released slots twice.
create table public.calendar_replacement_links (
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_lesson_id uuid not null references public.calendar_lessons(id) on delete cascade,
  replacement_lesson_id uuid not null references public.calendar_lessons(id) on delete cascade,
  kind text not null check (kind in ('moved','replaced')),
  id uuid not null default gen_random_uuid() unique,
  primary key (owner_id, original_lesson_id, replacement_lesson_id),
  check (original_lesson_id <> replacement_lesson_id)
);
create table public.calendar_series_replacement_links (
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_lesson_id uuid not null references public.calendar_lessons(id),
  replacement_rule_id uuid not null references public.recurrence_rules(id) on delete cascade,
  replaced_rule_ids uuid[] not null default '{}',
  effective_date date not null,
  id uuid not null default gen_random_uuid() unique,
  primary key (owner_id, original_lesson_id, replacement_rule_id)
);
alter table public.calendar_replacement_links enable row level security;
alter table public.calendar_series_replacement_links enable row level security;
revoke all on public.calendar_replacement_links, public.calendar_series_replacement_links from anon, authenticated;
grant select on public.calendar_replacement_links, public.calendar_series_replacement_links to authenticated;
create policy own_replacement_links on public.calendar_replacement_links for select to authenticated using (owner_id=auth.uid());
create policy own_series_replacement_links on public.calendar_series_replacement_links for select to authenticated using (owner_id=auth.uid());

-- Backfill only persisted relationships, never a coincident time or student name.
insert into public.calendar_replacement_links
select n.owner_id,o.id,n.id,'replaced' from public.calendar_lessons n
join public.calendar_lessons o on o.id=n.freed_by_lesson_id and o.owner_id=n.owner_id
where n.id<>o.id on conflict do nothing;
insert into public.calendar_replacement_links
select o.owner_id,o.id,n.id,'moved' from public.recurrence_exceptions e
join public.calendar_lessons o on o.owner_id=e.owner_id and o.recurrence_id=e.recurrence_id and o.recurrence_occurrence_key=e.occurrence_key
join public.calendar_lessons n on n.owner_id=e.owner_id and n.id=e.replacement_lesson_id
where e.exception_type='rescheduled' and o.id<>n.id on conflict do nothing;
insert into public.calendar_replacement_links
select p.owner_id,o.id,p.lesson_id,'moved' from public.calendar_reschedule_operations p
join public.calendar_lessons o on o.owner_id=p.owner_id and o.id=nullif(p.payload->>'original_lesson_id','')::uuid
where o.id<>p.lesson_id on conflict do nothing;
-- A cancellation notice and the replacement insertion share the same transaction timestamp.
-- Require a unique recorded reschedule operation at that exact timestamp; ambiguous rows stay untouched.
insert into public.calendar_replacement_links
select n.owner_id,n.cancelled_lesson_id,min(p.lesson_id::text)::uuid,'replaced'
from public.calendar_replacement_notices n
join public.calendar_lessons replacement on replacement.owner_id=n.owner_id and replacement.created_at=n.created_at
join public.calendar_reschedule_operations p on p.owner_id=n.owner_id and p.lesson_id=replacement.id
where n.cancelled_lesson_id<>p.lesson_id
group by n.owner_id,n.cancelled_lesson_id,n.created_at
having count(distinct p.lesson_id)=1
on conflict do nothing;

-- Preserve the tested mutation; add relationships inside the same transaction.
alter function public.reschedule_calendar_replacing(jsonb,uuid[]) rename to reschedule_calendar_replacing_before_links;
revoke all on function public.reschedule_calendar_replacing_before_links(jsonb,uuid[]) from public, anon, authenticated;
create function public.reschedule_calendar_replacing(p_payload jsonb,p_replace_ids uuid[])
returns public.calendar_lessons language plpgsql security definer set search_path='' as $$
declare result public.calendar_lessons; original_id uuid; replaced_id uuid; saved jsonb;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  result:=public.reschedule_calendar_replacing_before_links(p_payload,p_replace_ids);
  select payload into saved from public.calendar_reschedule_operations where owner_id=auth.uid()
    and operation_id=nullif(p_payload->>'operation_id','')::uuid;
  original_id:=nullif(saved->>'original_lesson_id','')::uuid;
  if original_id is not null and original_id<>result.id then
    insert into public.calendar_replacement_links values(auth.uid(),original_id,result.id,'moved') on conflict do nothing;
  end if;
  for replaced_id in select distinct cancelled_lesson_id from public.calendar_replacement_notices
    where owner_id=auth.uid() and created_at=result.created_at and cancelled_lesson_id<>result.id loop
    insert into public.calendar_replacement_links values(auth.uid(),replaced_id,result.id,'replaced') on conflict do nothing;
  end loop;
  return result;
end $$;
revoke all on function public.reschedule_calendar_replacing(jsonb,uuid[]) from public, anon;
grant execute on function public.reschedule_calendar_replacing(jsonb,uuid[]) to authenticated;

create function public.create_recurrence_series_replacing(p_payload jsonb)
returns public.recurrence_rules language plpgsql security definer set search_path='' as $$
declare source public.calendar_lessons; result public.recurrence_rules; effective date;
  root_id uuid; parent_id uuid; family_ids uuid[]:='{}'; visited uuid[]:='{}'; cuts jsonb; ends jsonb;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,31100000));
  select * into source from public.calendar_lessons where owner_id=auth.uid()
    and id=nullif(p_payload->>'replacement_source_lesson_id','')::uuid for update;
  if not found then raise exception 'La clase a reemplazar no existe o no te pertenece'; end if;
  -- Replays must return the same series without cutting it again.
  select r.* into result from public.recurrence_rules r join public.calendar_series_replacement_links l
    on l.replacement_rule_id=r.id and l.owner_id=r.owner_id
    where r.owner_id=auth.uid() and r.operation_id=nullif(p_payload->>'operation_id','')::uuid
      and l.original_lesson_id=source.id;
  if found then return result; end if;
  if exists(select 1 from public.recurrence_rules where owner_id=auth.uid() and operation_id=nullif(p_payload->>'operation_id','')::uuid) then
    raise exception 'La operación corresponde a otra serie';
  end if;
  if source.status<>'cancelled' then raise exception 'Primero cancelá la clase que querés reemplazar'; end if;
  effective:=nullif(p_payload->>'replacement_effective_date','')::date;
  if effective is null or effective<(now() at time zone coalesce(p_payload->>'timezone','America/Argentina/Buenos_Aires'))::date then
    raise exception 'La fecha de reemplazo no puede estar en el pasado';
  end if;
  if exists(select 1 from public.calendar_lessons where owner_id=auth.uid() and freed_by_lesson_id=source.id and status<>'cancelled')
    or exists(select 1 from public.calendar_series_replacement_links where owner_id=auth.uid() and original_lesson_id=source.id) then
    raise exception 'Esta clase ya tiene un reemplazo';
  end if;
  if source.recurrence_id is not null then
    root_id:=source.recurrence_id;
    loop
      exit when root_id=any(visited);
      visited:=array_append(visited,root_id);
      select supersedes_recurrence_id into parent_id from public.recurrence_rules where owner_id=auth.uid() and id=root_id;
      exit when parent_id is null;
      root_id:=parent_id;
    end loop;
    with recursive family as (
      select id from public.recurrence_rules where id=root_id and owner_id=auth.uid()
      union select r.id from public.recurrence_rules r join family f on r.supersedes_recurrence_id=f.id where r.owner_id=auth.uid()
    ) select coalesce(array_agg(id),'{}') into family_ids from family;
    if exists(select 1 from public.calendar_lessons c where c.owner_id=auth.uid() and c.recurrence_id=any(family_ids)
      and c.status<>'cancelled' and (coalesce(c.recurrence_original_start,c.start_at) at time zone coalesce(p_payload->>'timezone','America/Argentina/Buenos_Aires'))::date>=effective
      and (exists(select 1 from public.lesson_registrations r where r.owner_id=auth.uid() and r.calendar_lesson_id=c.id)
        or exists(select 1 from public.payment_charges p where p.owner_id=auth.uid() and p.calendar_lesson_id=c.id and p.voided_at is null))) then
      raise exception 'La serie tiene clases futuras con registro o cobro. Resolvé esas clases antes de reemplazar toda la serie';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'end_date',effective-1)) filter(where start_date<effective),'[]'),
      coalesce(jsonb_agg(id) filter(where start_date>=effective),'[]') into cuts,ends
      from public.recurrence_rules where owner_id=auth.uid() and id=any(family_ids) and status<>'ended';
    if jsonb_array_length(cuts)+jsonb_array_length(ends)>0 then
      perform public.end_recurrence_series_from_date(jsonb_build_object('truncate',cuts,'end',ends,'effective_date',effective,'timezone',p_payload->>'timezone'));
    end if;
  end if;
  result:=public.create_recurrence_series(p_payload);
  insert into public.calendar_series_replacement_links values(auth.uid(),source.id,result.id,family_ids,effective);
  return result;
end $$;
revoke all on function public.create_recurrence_series_replacing(jsonb) from public,anon;
grant execute on function public.create_recurrence_series_replacing(jsonb) to authenticated;

-- A single replacement and a whole-series replacement serialize on the same source row.
alter function public.create_calendar_lesson(jsonb) rename to create_calendar_lesson_before_replacement_guard;
revoke all on function public.create_calendar_lesson_before_replacement_guard(jsonb) from public,anon,authenticated;
create function public.create_calendar_lesson(p_payload jsonb)
returns public.calendar_lessons language plpgsql security definer set search_path='' as $$
declare source public.calendar_lessons; result public.calendar_lessons; source_id uuid:=nullif(p_payload->>'freed_by_lesson_id','')::uuid;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if source_id is not null then
    select * into source from public.calendar_lessons where id=source_id and owner_id=auth.uid() for update;
    if not found then raise exception 'La clase a reemplazar no existe o no te pertenece'; end if;
    select * into result from public.calendar_lessons where owner_id=auth.uid() and operation_id=nullif(p_payload->>'operation_id','')::uuid;
    if found then
      if result.freed_by_lesson_id is distinct from source_id then raise exception 'La operación corresponde a otra clase'; end if;
      return result;
    end if;
    if source.status<>'cancelled' then raise exception 'La clase a reemplazar ya no está cancelada'; end if;
    if exists(select 1 from public.calendar_lessons where owner_id=auth.uid() and freed_by_lesson_id=source_id and status<>'cancelled')
      or exists(select 1 from public.calendar_series_replacement_links where owner_id=auth.uid() and original_lesson_id=source_id) then
      raise exception 'Esta clase ya tiene un reemplazo';
    end if;
  end if;
  result:=public.create_calendar_lesson_before_replacement_guard(p_payload);
  if source_id is not null then
    insert into public.calendar_replacement_links values(auth.uid(),source_id,result.id,'replaced') on conflict do nothing;
  end if;
  return result;
end $$;
revoke all on function public.create_calendar_lesson(jsonb) from public,anon;
grant execute on function public.create_calendar_lesson(jsonb) to authenticated;
