-- Calendar/live registration parity. No existing charge or payment is rewritten.
create table public.teacher_interaction_preferences (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 live_tracking boolean not null default true
);
alter table public.teacher_interaction_preferences enable row level security;
revoke all on public.teacher_interaction_preferences from anon;
grant select,insert,update on public.teacher_interaction_preferences to authenticated;
create policy own_interaction_preferences on public.teacher_interaction_preferences for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());

create table public.calendar_replacement_notices (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid not null references public.students(id), cancelled_lesson_id uuid not null references public.calendar_lessons(id),
 cancelled_start_at timestamptz not null, dismissed_at timestamptz, created_at timestamptz not null default now(),
 unique(owner_id,student_id,cancelled_lesson_id)
);
alter table public.calendar_replacement_notices enable row level security;
revoke all on public.calendar_replacement_notices from anon,authenticated;
grant select on public.calendar_replacement_notices to authenticated;
create policy own_replacement_notices on public.calendar_replacement_notices for select to authenticated using(owner_id=auth.uid());
create function public.dismiss_calendar_replacement_notice(p_id uuid) returns void language sql security definer set search_path='' as $$
 update public.calendar_replacement_notices set dismissed_at=now() where owner_id=auth.uid() and id=p_id;
$$;

alter table public.lesson_registrations add column if not exists end_source text;
create function public.correct_registered_session(p_id uuid,p_start timestamptz,p_end timestamptz,p_arrival jsonb,p_expected timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare r public.lesson_registrations; anchor date;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 select * into r from public.lesson_registrations where id=p_id and owner_id=auth.uid() for update;
 if not found or r.status<>'completed' or not r.counts_as_class then raise exception 'Sólo se puede corregir una clase dictada y registrada'; end if;
 if r.actual_started_at=p_start and r.actual_ended_at=p_end and r.student_arrival=p_arrival||'{"manuallyCorrected":true}'::jsonb then return; end if;
 if r.updated_at is distinct from p_expected then raise exception 'El registro cambió en otro dispositivo. Recargá antes de corregirlo'; end if;
 if p_start is null or p_end is null or p_end<=p_start or p_end>now()+interval '1 minute' then raise exception 'El fin debe ser posterior al inicio y no puede ser futuro'; end if;
 anchor:=(coalesce(r.scheduled_start_at,r.actual_started_at,r.created_at) at time zone 'America/Argentina/Buenos_Aires')::date;
 if (p_start at time zone 'America/Argentina/Buenos_Aires')::date<>anchor or (p_end at time zone 'America/Argentina/Buenos_Aires')::date<>anchor then raise exception 'Los horarios deben corresponder al día de esta clase'; end if;
 if not public.live_class_arrival_is_valid(p_arrival) then raise exception 'Puntualidad inválida'; end if;
 if p_arrival ? 'arrivedAt' and ((p_arrival->>'arrivedAt')::timestamptz at time zone 'America/Argentina/Buenos_Aires')::date<>anchor then raise exception 'La llegada debe corresponder al día de la clase'; end if;
 update public.lesson_registrations set actual_started_at=p_start,actual_ended_at=p_end,
 actual_duration_minutes=greatest(1,round(extract(epoch from(p_end-p_start))/60)), student_arrival=p_arrival||'{"manuallyCorrected":true}'::jsonb,
 start_source='manual_correction',end_source='manual_correction',session_updated_at=now(),updated_at=now() where id=p_id and owner_id=auth.uid();
end $$;

alter table public.calendar_lessons add column if not exists schedule_adjustment jsonb;
create function public.adjust_calendar_schedule(p_edit jsonb,p_expected timestamptz,p_start timestamptz,p_adjustment jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare l public.calendar_lessons; duration interval;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,31100000));
 l:=public.edit_calendar_lesson(p_edit);
 if l.start_at is distinct from p_expected then raise exception 'El horario cambió. Recargá la agenda'; end if;
 if exists(select 1 from public.lesson_registrations where calendar_lesson_id=l.id and owner_id=auth.uid() and status='completed') then raise exception 'La clase ya fue registrada'; end if;
 if p_start is null or (p_start at time zone 'America/Argentina/Buenos_Aires')::date<>(l.start_at at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'El ajuste debe ser dentro del mismo día'; end if;
 if p_adjustment->>'direction' not in ('advanced','delayed') or (p_adjustment->>'minutes')::int not in(15,20,30,40,50,60) or p_adjustment->>'reason' not in ('teacher','mutual_agreement') then raise exception 'Ajuste inválido'; end if;
 if abs(extract(epoch from(p_start-(l.start_at+make_interval(mins=>(p_adjustment->>'minutes')::int*case when p_adjustment->>'direction'='delayed' then 1 else -1 end)))))>0.001 then raise exception 'El horario no coincide con el ajuste'; end if;
 duration:=l.end_at-l.start_at;
 if exists(select 1 from public.calendar_lessons c where c.owner_id=auth.uid() and c.id<>l.id and (c.status in ('scheduled','completed') or c.status='rescheduled' and c.recurrence_original_start is not null) and c.start_at<p_start+duration and c.end_at>p_start) then raise exception 'El nuevo horario está ocupado'; end if;
 update public.calendar_lessons set start_at=p_start,end_at=p_start+duration,schedule_adjustment=p_adjustment||jsonb_build_object('originalStartAt',coalesce(l.schedule_adjustment->>'originalStartAt',l.start_at::text)) where id=l.id;
 update public.live_class_sessions set effective_start_at=p_start,schedule_adjustment=p_adjustment,updated_at=now() where owner_id=auth.uid() and calendar_lesson_id=l.id;
 return l.id;
end $$;

alter function public.start_live_class(uuid,jsonb) rename to start_live_class_before_schedule_adjustment;
revoke all on function public.start_live_class_before_schedule_adjustment(uuid,jsonb) from public,anon,authenticated;
create function public.start_live_class(p_calendar_lesson_id uuid,p_arrival jsonb) returns public.live_class_sessions
language plpgsql security definer set search_path='' as $$
declare s public.live_class_sessions; a jsonb;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if exists(select 1 from public.teacher_interaction_preferences where owner_id=auth.uid() and not live_tracking) then raise exception 'El seguimiento de clases está desactivado en Configuración'; end if;
 s:=public.start_live_class_before_schedule_adjustment(p_calendar_lesson_id,p_arrival);
 select schedule_adjustment into a from public.calendar_lessons where id=p_calendar_lesson_id and owner_id=auth.uid();
 if a is not null then update public.live_class_sessions set scheduled_start_at=coalesce((a->>'originalStartAt')::timestamptz,s.scheduled_start_at),schedule_adjustment=a-'originalStartAt' where owner_id=auth.uid() returning * into s; end if;
 return s;
end $$;

create table public.calendar_reschedule_operations(owner_id uuid not null references auth.users(id) on delete cascade,operation_id uuid not null,payload jsonb not null,lesson_id uuid not null references public.calendar_lessons(id),primary key(owner_id,operation_id));
alter table public.calendar_reschedule_operations enable row level security;
revoke all on public.calendar_reschedule_operations from anon,authenticated;
grant select on public.calendar_reschedule_operations to authenticated;
create policy own_reschedule_operations on public.calendar_reschedule_operations for select to authenticated using(owner_id=auth.uid());
-- Replacement, notices and the move are atomic and replayed by operation ID.
create function public.reschedule_calendar_replacing(p_payload jsonb,p_replace_ids uuid[]) returns public.calendar_lessons
language plpgsql security definer set search_path='' as $$
declare l public.calendar_lessons; c public.calendar_lessons; sid uuid; e jsonb; replace_ids uuid[]:=coalesce(p_replace_ids,'{}'); op uuid:=nullif(p_payload->>'operation_id','')::uuid; prev public.calendar_reschedule_operations;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,31100000));
 if op is null then raise exception 'Falta identificar la operación'; end if;
 select * into prev from public.calendar_reschedule_operations where owner_id=auth.uid() and operation_id=op;
 if found then
  if prev.payload->>'original_lesson_id' is distinct from p_payload->>'original_lesson_id' or prev.payload->>'occurrence_key' is distinct from p_payload->>'occurrence_key' or prev.payload->>'new_start_at' is distinct from p_payload->>'new_start_at' then raise exception 'La operación corresponde a otra reprogramación'; end if;
  select * into l from public.calendar_lessons where id=prev.lesson_id and owner_id=auth.uid();return l;
 end if;
 if nullif(p_payload->>'original_lesson_id','') is not null then
  select * into c from public.calendar_lessons where id=(p_payload->>'original_lesson_id')::uuid and owner_id=auth.uid() for update;
  if not found or c.status in ('completed','cancelled') or exists(select 1 from public.lesson_registrations where calendar_lesson_id=c.id and status='completed') then raise exception 'La clase ya fue registrada o cancelada'; end if;
 end if;
 for e in select * from jsonb_array_elements(coalesce(p_payload->'replacement_edits','[]'::jsonb)) loop
  l:=public.edit_calendar_lesson(e); replace_ids:=array_append(replace_ids,l.id);
 end loop;
 if exists(select 1 from unnest(replace_ids) x where not exists(select 1 from public.calendar_lessons where id=x and owner_id=auth.uid())) then raise exception 'Una clase a reemplazar no pertenece a esta cuenta'; end if;
 for c in select * from public.calendar_lessons where id=any(replace_ids) and owner_id=auth.uid() for update loop
  if c.id=nullif(p_payload->>'original_lesson_id','')::uuid or c.status not in ('scheduled','rescheduled') or exists(select 1 from public.lesson_registrations where calendar_lesson_id=c.id) or exists(select 1 from public.payment_charges where calendar_lesson_id=c.id and voided_at is null) then raise exception 'No se puede reemplazar una clase con registro o cobro'; end if;
  update public.calendar_lessons set status='cancelled' where id=c.id;
  if c.recurrence_id is not null then insert into public.recurrence_exceptions(owner_id,recurrence_id,occurrence_key,exception_type) values(auth.uid(),c.recurrence_id,c.recurrence_occurrence_key,'cancelled') on conflict(recurrence_id,occurrence_key) do update set exception_type='cancelled'; end if;
  for sid in select student_id from public.calendar_lesson_participants where calendar_lesson_id=c.id union select c.primary_student_id loop
   insert into public.calendar_replacement_notices(owner_id,student_id,cancelled_lesson_id,cancelled_start_at) values(auth.uid(),sid,c.id,c.start_at) on conflict do nothing;
  end loop;
 end loop;
 l:=public.reschedule_calendar_occurrence(p_payload);
 update public.calendar_lessons n set training_billing_agreement_id=o.training_billing_agreement_id from public.calendar_lessons o
 where n.id=l.id and n.owner_id=auth.uid() and o.owner_id=auth.uid() and o.id=nullif(p_payload->>'original_lesson_id','')::uuid;
 insert into public.calendar_reschedule_operations values(auth.uid(),op,p_payload,l.id);
 return l;
end $$;

revoke all on function public.correct_registered_session(uuid,timestamptz,timestamptz,jsonb,timestamptz),public.adjust_calendar_schedule(jsonb,timestamptz,timestamptz,jsonb),public.start_live_class(uuid,jsonb),public.reschedule_calendar_replacing(jsonb,uuid[]),public.dismiss_calendar_replacement_notice(uuid) from public,anon;
grant execute on function public.correct_registered_session(uuid,timestamptz,timestamptz,jsonb,timestamptz),public.adjust_calendar_schedule(jsonb,timestamptz,timestamptz,jsonb),public.start_live_class(uuid,jsonb),public.reschedule_calendar_replacing(jsonb,uuid[]),public.dismiss_calendar_replacement_notice(uuid) to authenticated;
