const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {start}=require('./load.cjs');
(async()=>{
 const pg=await start({port:5459}); let a,b,c;
 try{
  assert.deepEqual(pg.failures,[]);
  const owner=randomUUID(),foreign=randomUUID(),student=randomUUID(),otherStudent=randomUUID();
  await pg.admin.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,'links-a@example.com',foreign,'links-b@example.com']);
  await pg.admin.query("insert into public.students(id,owner_id,name,modality,category,billing_type,date_joined,price) values($1,$2,'QA A','presencial','otro','por_clase','2026-01-01',1000),($3,$2,'QA B','presencial','otro','por_clase','2026-01-01',1000)",[student,owner,otherStudent]);
  a=await pg.session(owner);b=await pg.session(foreign);
  const date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  const payload={operation_id:randomUUID(),primary_student_id:student,rule_type:'weekly',cycle_length_weeks:1,weeks:[{weekIndex:0,sessions:[{weekday:5,hour:8,minute:0,durationMinutes:60}]}],modality:'presencial',timezone:'America/Argentina/Buenos_Aires',start_date:date,participant_ids:[student],activity_kind:'class'};
  const rule=(await a.query('select (public.create_recurrence_series($1)).*',[payload])).rows[0];
  const source=randomUUID(),future=randomUUID(),unrelated=randomUUID();
  await pg.admin.query("insert into public.calendar_lessons(id,owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,color,is_recurring,recurrence_id,recurrence_occurrence_key,activity_kind) values($1,$2,$3,'QA','A1','individual',$4::date+interval '11 hours',$4::date+interval '12 hours','presencial','cancelled','#fff',true,$5,$6,'class'),($7,$2,$3,'QA','A1','individual',$4::date+interval '7 days 11 hours',$4::date+interval '7 days 12 hours','presencial','scheduled','#fff',true,$5,$8,'class'),($9,$2,$3,'Other','A1','individual',$4::date+interval '9 days 11 hours',$4::date+interval '9 days 12 hours','presencial','scheduled','#fff',false,null,null,'class')",[source,owner,student,date,rule.id,rule.id+':source',future,rule.id+':future',unrelated]);
  const replacement={...payload,operation_id:randomUUID(),primary_student_id:otherStudent,participant_ids:[otherStudent],replacement_source_lesson_id:source,replacement_effective_date:date};
  await assert.rejects(b.query('select public.create_recurrence_series_replacing($1)',[replacement]));
  const result=(await a.query('select (public.create_recurrence_series_replacing($1)).*',[replacement])).rows[0];
  const replay=(await a.query('select (public.create_recurrence_series_replacing($1)).id',[replacement])).rows[0];
  assert.equal(replay.id,result.id);
  assert.equal((await pg.admin.query('select status from calendar_lessons where id=$1',[future])).rows[0].status,'cancelled');
  assert.equal((await pg.admin.query('select status from calendar_lessons where id=$1',[unrelated])).rows[0].status,'scheduled');
  assert.equal((await a.query('select count(*)::int n from calendar_series_replacement_links')).rows[0].n,1);
  const rollbackSource=randomUUID(),rollbackFuture=randomUUID();
  await pg.admin.query("insert into calendar_lessons(id,owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,color,is_recurring,recurrence_id,activity_kind) values($1,$2,$3,'Rollback series','A1','individual',$4::date+interval '11 hours',$4::date+interval '12 hours','presencial','cancelled','#fff',true,$5,'class'),($6,$2,$3,'Future rollback','A1','individual',$4::date+interval '8 days 11 hours',$4::date+interval '8 days 12 hours','presencial','scheduled','#fff',true,$5,'class')",[rollbackSource,owner,otherStudent,date,result.id,rollbackFuture]);
  await assert.rejects(a.query('select public.create_recurrence_series_replacing($1)',[{...replacement,operation_id:randomUUID(),replacement_source_lesson_id:rollbackSource,primary_student_id:randomUUID()}]));
  assert.equal((await pg.admin.query('select status from calendar_lessons where id=$1',[rollbackFuture])).rows[0].status,'scheduled','failure after cutting rolls the cut and future cancellation back');
  assert.equal((await pg.admin.query('select status from recurrence_rules where id=$1',[result.id])).rows[0].status,'active');
  await pg.admin.query("insert into lesson_registrations(owner_id,calendar_lesson_id,activity_kind,counts_as_class,status,scheduled_start_at) values($1,$2,'class',true,'in_progress',$3::date+interval '8 days 11 hours')",[owner,rollbackFuture,date]);
  await assert.rejects(a.query('select public.create_recurrence_series_replacing($1)',[{...replacement,operation_id:randomUUID(),replacement_source_lesson_id:rollbackSource}]),/futuras con registro o cobro/);
  assert.equal((await pg.admin.query('select status from calendar_lessons where id=$1',[rollbackFuture])).rows[0].status,'scheduled');
  assert.equal((await b.query('select count(*)::int n from calendar_series_replacement_links')).rows[0].n,0);
  const source2=randomUUID();
  await pg.admin.query("insert into calendar_lessons(id,owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,color,is_recurring,activity_kind) values($1,$2,$3,'Rollback','A1','individual',$4::date+interval '11 hours',$4::date+interval '12 hours','presencial','cancelled','#fff',false,'class')",[source2,owner,student,date]);
  await assert.rejects(a.query('select public.create_recurrence_series_replacing($1)',[{...replacement,operation_id:randomUUID(),replacement_source_lesson_id:source2,primary_student_id:randomUUID()}]));
  assert.equal((await a.query('select count(*)::int n from calendar_series_replacement_links')).rows[0].n,1);
  // A moved class and a displaced third class get separate exact links atomically.
  const single={operation_id:randomUUID(),freed_by_lesson_id:source2,primary_student_id:otherStudent,student_name:'QA B',level:'A1',lesson_type:'individual',start_at:date+'T11:00:00Z',end_at:date+'T12:00:00Z',modality:'presencial',activity_kind:'class',participants:[{student_id:otherStudent,student_name:'QA B',level:'A1'}]};
  const one=(await a.query('select (public.create_calendar_lesson($1)).*',[single])).rows[0];
  assert.equal((await a.query('select (public.create_calendar_lesson($1)).id',[single])).rows[0].id,one.id);
  await assert.rejects(a.query('select public.create_calendar_lesson($1)',[{...single,operation_id:randomUUID()}]));
  await assert.rejects(a.query('select public.create_recurrence_series_replacing($1)',[{...replacement,operation_id:randomUUID(),replacement_source_lesson_id:source2}]));
  const move={operation_id:randomUUID(),original_lesson_id:unrelated,source_id:unrelated,original_start_at:date+'T11:00:00Z',primary_student_id:student,student_name:'QA',level:'A1',lesson_type:'individual',new_start_at:date+'T15:00:00Z',new_end_at:date+'T16:00:00Z',modality:'presencial',activity_kind:'class',participants:[{student_id:student,student_name:'QA',level:'A1'}]};
  const moved=(await a.query('select (public.reschedule_calendar_replacing($1,$2)).*',[move,[]])).rows[0];
  assert.equal((await a.query('select count(*)::int n from calendar_replacement_links where original_lesson_id=$1 and replacement_lesson_id=$2',[unrelated,moved.id])).rows[0].n,1);
  assert.equal((await b.query('select count(*)::int n from calendar_replacement_links')).rows[0].n,0);
  const victim=randomUUID();
  await pg.admin.query("insert into calendar_lessons(id,owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,color,is_recurring,activity_kind) values($1,$2,$3,'Displaced','A1','individual',$4::date+interval '17 hours',$4::date+interval '18 hours','presencial','scheduled','#fff',false,'class')",[victim,owner,otherStudent,date]);
  const moveAgain={...move,operation_id:randomUUID(),original_lesson_id:moved.id,source_id:moved.id,original_start_at:move.new_start_at,new_start_at:date+'T17:00:00Z',new_end_at:date+'T18:00:00Z'};
  const final=(await a.query('select (public.reschedule_calendar_replacing($1,$2)).*',[moveAgain,[victim]])).rows[0];
  const links=(await a.query('select original_lesson_id,kind from calendar_replacement_links where replacement_lesson_id=$1',[final.id])).rows;
  assert.ok(links.some(l=>l.original_lesson_id===victim&&l.kind==='replaced'));
  assert.ok(links.some(l=>l.original_lesson_id===moved.id&&l.kind==='moved'));
  await a.query('select public.reschedule_calendar_replacing($1,$2)',[moveAgain,[randomUUID()]]);
  assert.equal((await a.query('select count(*)::int n from calendar_replacement_links where replacement_lesson_id=$1',[final.id])).rows[0].n,2,'replay cannot inject unrelated links');
  await assert.rejects(a.query('select public.reschedule_calendar_replacing_before_links($1,$2)',[move,[]]));
  c=await pg.session(owner);
  const raceSource=randomUUID();
  await pg.admin.query("insert into calendar_lessons(id,owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,color,is_recurring,activity_kind) values($1,$2,$3,'Two tabs','A1','individual',$4::date+interval '11 hours',$4::date+interval '12 hours','presencial','cancelled','#fff',false,'class')",[raceSource,owner,student,date]);
  const race=await Promise.allSettled([
    a.query('select public.create_calendar_lesson($1)',[{...single,operation_id:randomUUID(),freed_by_lesson_id:raceSource}]),
    c.query('select public.create_recurrence_series_replacing($1)',[{...replacement,operation_id:randomUUID(),replacement_source_lesson_id:raceSource}]),
  ]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1,'two sessions cannot create a single and a series replacement for the same source');
  console.log('PASS: migrations, series replacement, replay, isolation, unchanged unrelated class, failed replacement rollback, and moved-class links.');
 }finally{if(a)await a.end();if(b)await b.end();if(c)await c.end();await pg.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
