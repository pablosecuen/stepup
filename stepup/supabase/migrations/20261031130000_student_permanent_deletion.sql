-- Eliminación definitiva explícita de UN alumno. Previsualización versionada,
-- cascada transaccional, grupos conservados y limpieza de archivos durable.
create table public.student_deletion_receipts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null, student_id uuid not null, deleted_at timestamptz not null default now(),
 primary key(owner_id,operation_id)
);
alter table public.student_deletion_receipts enable row level security;
revoke all on public.student_deletion_receipts from public,anon,authenticated;
create table public.deleted_student_creation_operations (
 owner_id uuid not null references auth.users(id) on delete cascade, operation_id uuid not null,
 primary key(owner_id,operation_id)
);
alter table public.deleted_student_creation_operations enable row level security;
revoke all on public.deleted_student_creation_operations from public,anon,authenticated;
create function public.reject_deleted_student_operation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.deleted_student_creation_operations where owner_id=new.owner_id and operation_id=new.operation_id) then raise exception 'Este alumno fue eliminado. Para darlo de alta de nuevo, iniciá un formulario nuevo'; end if;
 return new;
end $$;
revoke all on function public.reject_deleted_student_operation() from public,anon,authenticated;
create trigger reject_deleted_student_operation before insert on public.student_creation_claims for each row execute function public.reject_deleted_student_operation();
create table public.student_file_cleanup_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 bucket text not null check(bucket in ('report-pdfs','lesson-files')), path text not null,
 created_at timestamptz not null default now(), unique(owner_id,bucket,path),
 check(path like owner_id::text || '/%')
);
alter table public.student_file_cleanup_jobs enable row level security;
revoke all on public.student_file_cleanup_jobs from public,anon;
grant select,delete on public.student_file_cleanup_jobs to authenticated;
create policy own_student_cleanup on public.student_file_cleanup_jobs for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());

create function public.preview_student_deletion(p_student uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.students; result jsonb; fingerprint text=''; t text; part text;
begin
 if auth.uid() is null then raise exception 'Sesión requerida'; end if;
 select * into s from public.students where id=p_student and owner_id=auth.uid();
 if not found then raise exception 'Alumno no encontrado'; end if;
 -- Incluye los hechos financieros y las relaciones: una modificación entre
 -- previsualizar y confirmar obliga a revisar un impacto actualizado.
 foreach t in array array['students','calendar_lessons','calendar_lesson_participants','recurrence_rules','recurrence_rule_participants','lesson_registrations','lesson_registration_students','lesson_registration_evaluations','lesson_attachments','payment_charges','payments','payment_allocations','payment_adjustments','report_records','package_purchases','package_credit_movements'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'''') from public.%I x where owner_id=$1',t) into part using auth.uid();
  fingerprint=fingerprint||t||part;
 end loop;
 result=jsonb_build_object('id',s.id,'name',s.name,'token',md5(fingerprint),
  'classes',(select count(distinct c.id) from public.calendar_lessons c left join public.calendar_lesson_participants p on p.calendar_lesson_id=c.id where c.owner_id=auth.uid() and (c.primary_student_id=p_student or p.student_id=p_student)),
  'series',(select count(distinct r.id) from public.recurrence_rules r left join public.recurrence_rule_participants p on p.recurrence_rule_id=r.id where r.owner_id=auth.uid() and (r.primary_student_id=p_student or p.student_id=p_student)),
  'registrations',(select count(*) from public.lesson_registration_students where owner_id=auth.uid() and student_id=p_student),
  'charges',(select count(*) from public.payment_charges where owner_id=auth.uid() and student_id=p_student),
  'payments',(select count(*) from public.payments where owner_id=auth.uid() and student_id=p_student),
  'reports',(select count(*) from public.report_records where owner_id=auth.uid() and student_id=p_student));
 return result;
end $$;
revoke all on function public.preview_student_deletion(uuid) from public,anon;
grant execute on function public.preview_student_deletion(uuid) to authenticated;

create function public.delete_student_permanently(p_student uuid,p_token text,p_operation uuid,p_confirmation text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.students; preview jsonb; selected_row record; replacement uuid; gone_lessons uuid[]; gone_rules uuid[]; gone_regs uuid[]; t text; report_id uuid;
begin
 if auth.uid() is null or p_operation is null then raise exception 'Sesión y operación requeridas'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':delete-student',0));
 perform pg_advisory_xact_lock(hashtext('backup_import:'||auth.uid()::text));
 if exists(select 1 from public.student_deletion_receipts where owner_id=auth.uid() and operation_id=p_operation and student_id=p_student) then return jsonb_build_object('deleted',true); end if;
 select * into s from public.students where owner_id=auth.uid() and id=p_student for update;
 if not found then raise exception 'Alumno no encontrado'; end if;
 if p_confirmation is distinct from s.name then raise exception 'Escribí el nombre completo del alumno para confirmar'; end if;
 -- Los locks impiden que se agreguen registros/pagos al alumno durante la cascada.
 foreach t in array array['students','calendar_lessons','calendar_lesson_participants','recurrence_rules','recurrence_rule_participants','lesson_registrations','lesson_registration_students','lesson_registration_evaluations','lesson_attachments','payment_charges','payments','payment_allocations','payment_adjustments','report_records','package_purchases','package_credit_movements'] loop
  execute format('select id from public.%I where owner_id=$1 order by id for update',t) using auth.uid();
 end loop;
 preview=public.preview_student_deletion(p_student);
 if preview->>'token' is distinct from p_token then raise exception 'Los datos cambiaron. Volvé a revisar el impacto antes de eliminar'; end if;
 select coalesce(array_agg(c.id),'{}') into gone_lessons from public.calendar_lessons c where c.owner_id=auth.uid() and c.primary_student_id=p_student and not exists(select 1 from public.calendar_lesson_participants p where p.calendar_lesson_id=c.id and p.student_id<>p_student);
 select coalesce(array_agg(r.id),'{}') into gone_rules from public.recurrence_rules r where r.owner_id=auth.uid() and r.primary_student_id=p_student and not exists(select 1 from public.recurrence_rule_participants p where p.recurrence_rule_id=r.id and p.student_id<>p_student);
 select coalesce(array_agg(r.id),'{}') into gone_regs from public.lesson_registrations r where r.owner_id=auth.uid() and exists(select 1 from public.lesson_registration_students p where p.lesson_registration_id=r.id and p.student_id=p_student) and not exists(select 1 from public.lesson_registration_students p where p.lesson_registration_id=r.id and p.student_id<>p_student);
 -- Un cobro de otro alumno nunca puede quedar sin su registro: falla y revierte
 -- en vez de borrar historia ajena frente a un dato inconsistente.
 if exists(select 1 from public.payment_charges where owner_id=auth.uid() and student_id<>p_student and saved_lesson_id=any(gone_regs)) then raise exception 'Hay registros compartidos inconsistentes. No se eliminó nada'; end if;
 insert into public.student_file_cleanup_jobs(owner_id,bucket,path)
 select auth.uid(),'report-pdfs',pdf_url from public.report_records where owner_id=auth.uid() and student_id=p_student and pdf_url like auth.uid()::text||'/%'
 union select auth.uid(),'lesson-files',storage_path from public.lesson_attachments where owner_id=auth.uid() and (student_id=p_student or lesson_registration_id=any(gone_regs)) and storage_path like auth.uid()::text||'/%'
 on conflict do nothing;
 delete from public.lesson_attachments where owner_id=auth.uid() and student_id=p_student;
 delete from public.payment_allocations where owner_id=auth.uid() and student_id=p_student;
 delete from public.payment_adjustments where owner_id=auth.uid() and student_id=p_student;
 delete from public.payment_charges where owner_id=auth.uid() and student_id=p_student;
 delete from public.payments where owner_id=auth.uid() and student_id=p_student;
 delete from public.package_credit_movements where owner_id=auth.uid() and student_id=p_student;
 delete from public.package_purchases where owner_id=auth.uid() and student_id=p_student;
 foreach t in array array['lesson_registration_attendance','lesson_registration_evaluations','lesson_registration_homework_reviews','lesson_registration_students'] loop
  execute format('delete from public.%I where owner_id=$1 and student_id=$2',t) using auth.uid(),p_student;
 end loop;
 delete from public.lesson_registrations where owner_id=auth.uid() and id=any(gone_regs);
 -- En los grupos se cambia la persona principal antes de retirar su pertenencia.
 for selected_row in select id from public.calendar_lessons where owner_id=auth.uid() and primary_student_id=p_student and not(id=any(gone_lessons)) loop
  select student_id into replacement from public.calendar_lesson_participants where calendar_lesson_id=selected_row.id and student_id<>p_student order by created_at,id limit 1;
  update public.calendar_lessons set primary_student_id=replacement,student_name=(select name from public.students where id=replacement),level=(select coalesce(levels[1],'') from public.students where id=replacement) where id=selected_row.id;
 end loop;
 for selected_row in select id from public.recurrence_rules where owner_id=auth.uid() and primary_student_id=p_student and not(id=any(gone_rules)) loop
  select student_id into replacement from public.recurrence_rule_participants where recurrence_rule_id=selected_row.id and student_id<>p_student order by created_at,id limit 1;
  update public.recurrence_rules set primary_student_id=replacement where id=selected_row.id;
 end loop;
 delete from public.calendar_lesson_participants where owner_id=auth.uid() and student_id=p_student;
 delete from public.recurrence_rule_participants where owner_id=auth.uid() and student_id=p_student;
 delete from public.calendar_replacement_notices where owner_id=auth.uid() and (student_id=p_student or cancelled_lesson_id=any(gone_lessons));
 delete from public.calendar_reschedule_operations where owner_id=auth.uid() and lesson_id=any(gone_lessons);
 delete from public.calendar_lessons where owner_id=auth.uid() and id=any(gone_lessons);
 delete from public.recurrence_rules where owner_id=auth.uid() and id=any(gone_rules);
 insert into public.deleted_student_creation_operations(owner_id,operation_id)
 select owner_id,operation_id from public.student_creation_claims where owner_id=auth.uid() and student_id=p_student and operation_id is not null on conflict do nothing;
 delete from public.students where owner_id=auth.uid() and id=p_student;
 insert into public.student_deletion_receipts(owner_id,operation_id,student_id) values(auth.uid(),p_operation,p_student);
 return jsonb_build_object('deleted',true);
end $$;
revoke all on function public.delete_student_permanently(uuid,text,uuid,text) from public,anon;
grant execute on function public.delete_student_permanently(uuid,text,uuid,text) to authenticated;

