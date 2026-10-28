const assert=require('node:assert/strict');const {start}=require('./load.cjs');
(async()=>{const p=await start({port:5782});let a,b;try{assert.deepEqual(p.failures,[]);const db=p.admin;const A='fd000000-0000-0000-0000-000000000001',B='fd000000-0000-0000-0000-000000000002';await db.query(`insert into auth.users(id) values($1),($2)`,[A,B]);const add=async(owner,name)=> (await db.query(`insert into students(owner_id,name,modality,category,billing_type,date_joined,price) values($1,$2,'presencial','otro','por_clase',current_date,1000) returning id`,[owner,name])).rows[0].id;const S=await add(A,'Eliminar QA'),T=await add(A,'Conservar QA'),U=await add(B,'Ajeno');a=await p.session(A);b=await p.session(B);
const group=(await db.query(`insert into calendar_lessons(owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,activity_kind,color) values($1,$2,'Eliminar QA','','group',now(),now()+interval '1 hour','presencial','scheduled','class','blue') returning id`,[A,S])).rows[0].id;
await db.query(`insert into calendar_lesson_participants(owner_id,calendar_lesson_id,student_id,student_name,level) values($1,$2,$3,'Eliminar QA',''),($1,$2,$4,'Conservar QA','')`,[A,group,S,T]);
const reg=(await db.query(`insert into lesson_registrations(owner_id,calendar_lesson_id) values($1,$2) returning id`,[A,group])).rows[0].id;await db.query(`insert into lesson_registration_students(owner_id,lesson_registration_id,student_id) values($1,$2,$3),($1,$2,$4)`,[A,reg,S,T]);
const charge=(await db.query(`insert into payment_charges(owner_id,student_id,charge_type,original_amount,due_date,saved_lesson_id) values($1,$2,'por_clase',1000,current_date,$3) returning id`,[A,S,reg])).rows[0].id;
const pay=(await db.query(`insert into payments(owner_id,student_id,amount,method,paid_at,recorded_at) values($1,$2,1000,'efectivo',current_date,now()) returning id`,[A,S])).rows[0].id;await db.query(`insert into payment_allocations(owner_id,student_id,payment_id,charge_id,amount) values($1,$2,$3,$4,1000)`,[A,S,pay,charge]);
await assert.rejects(()=>b.query('select preview_student_deletion($1)',[S]));const preview=(await a.query('select preview_student_deletion($1) as r',[S])).rows[0].r;assert.equal(preview.payments,1);assert.equal(preview.classes,1);
const op='fd200000-0000-0000-0000-000000000001';await assert.rejects(()=>a.query('select delete_student_permanently($1,$2,$3,$4)',[S,preview.token,op,'incorrecto']));
await db.query(`update students set notes='Cambio' where id=$1`,[S]);await assert.rejects(()=>a.query('select delete_student_permanently($1,$2,$3,$4)',[S,preview.token,op,'Eliminar QA']));
const fresh=(await a.query('select preview_student_deletion($1) as r',[S])).rows[0].r;
await db.query(`create function fail_delete_qa() returns trigger language plpgsql as $$ begin raise exception 'rollback QA'; end $$; create trigger fail_delete_qa before delete on students for each row execute function fail_delete_qa()`);
await assert.rejects(()=>a.query('select delete_student_permanently($1,$2,$3,$4)',[S,fresh.token,op,'Eliminar QA']));
assert.equal((await db.query('select count(*)::int n from payments where id=$1',[pay])).rows[0].n,1);
assert.equal((await db.query('select count(*)::int n from payment_allocations where charge_id=$1',[charge])).rows[0].n,1);
assert.equal((await db.query('select primary_student_id from calendar_lessons where id=$1',[group])).rows[0].primary_student_id,S);
await db.query('drop trigger fail_delete_qa on students');
await a.query('select delete_student_permanently($1,$2,$3,$4)',[S,fresh.token,op,'Eliminar QA']);await a.query('select delete_student_permanently($1,$2,$3,$4)',[S,fresh.token,op,'Eliminar QA']);assert.equal((await db.query('select count(*)::int as n from students where id=$1',[S])).rows[0].n,0);assert.equal((await db.query('select primary_student_id from calendar_lessons where id=$1',[group])).rows[0].primary_student_id,T);assert.equal((await db.query('select count(*)::int as n from lesson_registration_students where lesson_registration_id=$1',[reg])).rows[0].n,1);assert.equal((await db.query('select count(*)::int as n from students where id in ($1,$2)',[T,U])).rows[0].n,2);console.log('PASS eliminación, grupos, pagos, aislamiento, reintento, versión y confirmación');
}finally{await a?.end();await b?.end();await p.stop();}})().catch(e=>{console.error(e);process.exitCode=1});



