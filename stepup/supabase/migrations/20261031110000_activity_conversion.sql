alter table public.calendar_lessons add column if not exists training_billing_agreement_id uuid references public.training_billing_agreements(id);
create table public.calendar_activity_operations(owner_id uuid not null references auth.users(id) on delete cascade,operation_id uuid not null,result jsonb not null,payload jsonb not null,primary key(owner_id,operation_id));
alter table public.calendar_activity_operations enable row level security;
revoke all on public.calendar_activity_operations from anon,authenticated;
grant select on public.calendar_activity_operations to authenticated;
create policy own_activity_operations on public.calendar_activity_operations for select to authenticated using(owner_id=auth.uid());
create function public.convert_calendar_activity(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); op uuid:=(p_payload->>'operation_id')::uuid; kind text:=p_payload->>'activity_kind'; prev public.calendar_activity_operations;
 l public.calendar_lessons; r public.recurrence_rules; agreement uuid; fee numeric; sid uuid; result jsonb; charge jsonb; period text:=p_payload->>'start_period';
begin
 if uid is null then raise exception 'Sesión requerida'; end if;
 if op is null or kind not in('class','training') then raise exception 'Conversión inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,31100000));
 select * into prev from public.calendar_activity_operations where owner_id=uid and operation_id=op;
 if found then
  if prev.payload->>'activity_kind'<>kind or prev.payload->>'source_id' is distinct from p_payload->>'source_id' then raise exception 'La operación pertenece a otro cambio'; end if;
  return prev.result;
 end if;
 if p_payload ? 'split' then
  select * into r from public.recurrence_rules where id=(p_payload->'split'->>'original_recurrence_id')::uuid and owner_id=uid for update;
  if not found or r.activity_kind is distinct from p_payload->>'expected_kind' then raise exception 'La serie cambió. Recargá antes de convertir'; end if;
  if r.updated_at is distinct from (p_payload->>'expected_rule_updated_at')::timestamptz then raise exception 'La serie cambió en otro dispositivo. Recargá antes de convertir'; end if;
  r:=public.split_recurrence_ending_segments(jsonb_build_object('split',p_payload->'split','end_rule_ids',p_payload->'end_rule_ids'));
  agreement:=r.training_billing_agreement_id;
 else
  l:=public.edit_calendar_lesson(p_payload->'edit');
  if l.start_at<now() or l.activity_kind is distinct from p_payload->>'expected_kind' or exists(select 1 from public.lesson_registrations where calendar_lesson_id=l.id) or exists(select 1 from public.payment_charges where calendar_lesson_id=l.id and voided_at is null) then raise exception 'Sólo se convierte una clase futura sin registro ni cobro'; end if;
  agreement:=l.training_billing_agreement_id;
 end if;
 if kind='training' then
  fee:=(p_payload->>'monthly_fee')::numeric;
  if fee is null or fee<=0 or fee<>round(fee,2) or period!~'^\d{4}-\d{2}$' then raise exception 'Indicá la cuota mensual y el período'; end if;
  if agreement is null then insert into public.training_billing_agreements(owner_id,monthly_fee,start_period) values(uid,fee,period) returning id into agreement;
  elsif not exists(select 1 from public.training_billing_agreements where id=agreement and owner_id=uid and monthly_fee=fee) then raise exception 'El acuerdo existente tiene otra cuota. Modificá la cuota de entrenamiento desde su configuración'; end if;
  if r.id is not null then update public.recurrence_rules set training_billing_agreement_id=agreement,activity_kind=kind where owner_id=uid and id=r.id;
  else update public.calendar_lessons set training_billing_agreement_id=agreement,activity_kind=kind where owner_id=uid and id=l.id; end if;
  for charge in select * from jsonb_array_elements(coalesce(p_payload->'charges','[]'::jsonb)) loop
   sid:=(charge->>'student_id')::uuid;
   if not exists(select 1 from public.students where id=sid and owner_id=uid and status='activo') then raise exception 'Un participante dejó de estar activo'; end if;
   if r.id is not null then
    if not exists(select 1 from public.recurrence_rule_participants where recurrence_rule_id=r.id and student_id=sid and owner_id=uid) then raise exception 'El alumno no pertenece a la serie'; end if;
   elsif not exists(select 1 from public.calendar_lesson_participants where calendar_lesson_id=l.id and student_id=sid and owner_id=uid) and sid<>l.primary_student_id then raise exception 'El alumno no pertenece a esta clase'; end if;
   if (charge->>'amount')::numeric<0 or (charge->>'amount')::numeric>fee then raise exception 'Importe de primer mes inválido'; end if;
   insert into public.payment_charges(owner_id,student_id,charge_type,original_amount,due_date,billing_period,training_billing_agreement_id,training_series_name)
   values(uid,sid,'entrenamiento',(charge->>'amount')::numeric,(charge->>'due_date')::date,period,agreement,p_payload->>'title')
   on conflict(training_billing_agreement_id,student_id,billing_period) where charge_type='entrenamiento' do nothing;
  end loop;
 else
  if r.id is not null then update public.recurrence_rules set activity_kind=kind where owner_id=uid and id=r.id;
  else update public.calendar_lessons set activity_kind=kind where owner_id=uid and id=l.id; end if;
 end if;
 result:=jsonb_build_object('rule_id',r.id,'lesson_id',l.id,'agreement_id',agreement);
 insert into public.calendar_activity_operations values(uid,op,result,p_payload);
 return result;
end $$;
revoke all on function public.convert_calendar_activity(jsonb) from public,anon;
grant execute on function public.convert_calendar_activity(jsonb) to authenticated;
