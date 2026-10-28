create table public.financial_repair_audit (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
 charge_id uuid references public.payment_charges(id) on delete set null, before_state jsonb not null, after_state jsonb not null,
 reason text not null, created_at timestamptz not null default now()
);
alter table public.financial_repair_audit enable row level security;
revoke all on public.financial_repair_audit from public,anon,authenticated;
grant select on public.financial_repair_audit to authenticated;
create policy own_financial_repair_audit on public.financial_repair_audit for select to authenticated using(owner_id=auth.uid());
create function public.financial_reconciliation_snapshot() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb='{}'; part jsonb; t text;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 foreach t in array array['students','lesson_registrations','payment_charges','payments','payment_allocations','payment_adjustments','first_month_proration_decisions'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by id),''[]''::jsonb) from public.%I x where owner_id=$1',t) into part using auth.uid();
  result=result||jsonb_build_object(t,part);
 end loop;
 return result||jsonb_build_object('token',md5(result::text));
end $$;
revoke all on function public.financial_reconciliation_snapshot() from public,anon;
grant execute on function public.financial_reconciliation_snapshot() to authenticated;
create function public.apply_financial_reconciliation(p_token text,p_patches jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare t text; patch jsonb; c public.payment_charges; s public.students; plan jsonb; paid numeric; amount numeric; due date; total integer=0; reason text; period text=to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM');
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 if jsonb_typeof(p_patches)<>'array' or jsonb_array_length(p_patches)>500 then raise exception 'Reparación inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':financial-reconciliation',0));
 foreach t in array array['students','lesson_registrations','payment_charges','payments','payment_allocations','payment_adjustments','first_month_proration_decisions'] loop
  execute format('select id from public.%I where owner_id=$1 order by id for update',t) using auth.uid();
 end loop;
 if public.financial_reconciliation_snapshot()->>'token' is distinct from p_token then raise exception 'Los cobros cambiaron; volvé a revisar'; end if;
 for patch in select value from jsonb_array_elements(p_patches) loop
  select * into c from public.payment_charges where id=(patch->>'id')::uuid and owner_id=auth.uid();
  if not found or c.voided_at is not null then raise exception 'Cargo no disponible'; end if;
  select coalesce(sum(a.amount),0) into paid from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.charge_id=c.id and a.owner_id=auth.uid() and p.voided_at is null;
  amount=(patch->>'amount')::numeric; due=(patch->>'dueDate')::date; reason=patch->>'reason';
  select * into s from public.students where owner_id=auth.uid() and id=c.student_id;
  plan=coalesce(s.billing_plan,jsonb_build_object('type',case when s.billing_type='mensual' then 'monthly' else 'per_class' end,'amount',s.price));
  if reason not in ('duplicate','monthly_amount','inactive','monthly_coverage','first_due_date') or amount<=0 or amount<paid then raise exception 'Corrección no segura'; end if;
  if patch->>'voidedAt' is not null and (paid>0 or exists(select 1 from public.payment_allocations where charge_id=c.id)) then raise exception 'Un cargo con pagos no se anula automáticamente'; end if;
  if patch->>'voidedAt' is not null then
   if reason='inactive' and not(c.charge_type='mensual' and s.status<>'activo' and s.status_change_date is not null and c.billing_period>to_char(s.status_change_date,'YYYY-MM')) then raise exception 'La baja no demuestra este cargo'; end if;
   if reason='monthly_coverage' and not(c.charge_type='por_clase' and s.status='activo' and plan->>'type'='monthly' and coalesce(plan->>'startPeriod',period)<=period and to_char(c.due_date,'YYYY-MM')>=period and not exists(select 1 from public.lesson_registrations where id=c.saved_lesson_id and activity_kind='training')) then raise exception 'El cargo no está cubierto por el plan individual'; end if;
   if reason='duplicate' and not(c.charge_type='mensual' and exists(select 1 from public.payment_charges other where other.owner_id=auth.uid() and other.student_id=c.student_id and other.billing_period=c.billing_period and other.charge_type=c.charge_type and other.id<>c.id and other.voided_at is null)) then raise exception 'No es un duplicado técnico'; end if;
   if reason not in ('inactive','monthly_coverage','duplicate') then raise exception 'Motivo de anulación inválido'; end if;
  end if;
  if amount<>c.original_amount and (reason<>'monthly_amount' or c.charge_type<>'mensual' or c.billing_period<>to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM') or paid>=c.original_amount or exists(select 1 from public.first_month_proration_decisions where owner_id=auth.uid() and student_id=c.student_id and billing_period=c.billing_period)) then raise exception 'No se puede reescribir este importe'; end if;
  if amount<>c.original_amount and (s.status<>'activo' or plan->>'type'<>'monthly' or coalesce(plan->>'startPeriod',period)>period or amount<>case when plan->>'pendingAmount' is not null and plan->>'pendingAmountEffectiveFrom'<=period then (plan->>'pendingAmount')::numeric else (plan->>'amount')::numeric end) then raise exception 'El importe no coincide con el plan vigente'; end if;
  if due<>c.due_date and (reason<>'first_due_date' or due<c.due_date or paid>0 or not exists(select 1 from public.first_month_proration_decisions where owner_id=auth.uid() and charge_id=c.id)) then raise exception 'No se puede cambiar este vencimiento'; end if;
  update public.payment_charges set original_amount=amount,due_date=due,voided_at=(patch->>'voidedAt')::timestamptz,void_reason=patch->>'voidReason' where id=c.id;
  insert into public.financial_repair_audit(owner_id,charge_id,before_state,after_state,reason) values(auth.uid(),c.id,to_jsonb(c),(select to_jsonb(x) from public.payment_charges x where id=c.id),reason);
  total=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.apply_financial_reconciliation(text,jsonb) from public,anon;
grant execute on function public.apply_financial_reconciliation(text,jsonb) to authenticated;

