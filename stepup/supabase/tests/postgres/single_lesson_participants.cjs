const assert=require('node:assert/strict');
const {start}=require('./load.cjs');
const A='fc000000-0000-0000-0000-000000000001',B='fc000000-0000-0000-0000-000000000002';
const S=n=>`fc100000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const L='fc200000-0000-0000-0000-000000000001';
async function main(){
 const pg=await start({port:5782});let count=0;const clients=[];
 try{
  assert.deepEqual(pg.failures,[]);
  await pg.admin.query("insert into auth.users(id,email) values($1,'a@example.com'),($2,'b@example.com')",[A,B]);
  for(const n of [1,2,3,4])await pg.admin.query("insert into public.students(id,owner_id,name,modality,category,billing_type,date_joined,price,levels,status) values($1,$2,$3,'online','otro','por_clase','2025-01-01',1000,array['A1'],$4)",[S(n),n===4?B:A,`QA ${n}`,n===3?'inactivo':'activo']);
  await pg.admin.query("insert into public.calendar_lessons(id,owner_id,primary_student_id,student_name,level,lesson_type,start_at,end_at,modality,status,color) values($1,$2,$3,'QA 1','A1','individual',now()+interval '1 day',now()+interval '25 hours','online','scheduled','#DDEEFF')",[L,A,S(1)]);
  const a=await pg.session(A),a2=await pg.session(A),b=await pg.session(B);
  clients.push(a,a2,b);
  const call=(s,target,expected=[S(1)])=>s.query('select public.change_calendar_lesson_participants($1,$2,$3) as result',[JSON.stringify({lesson_id:L}),target,expected]);
  await assert.rejects(call(b,[S(1),S(4)]));count++;
  await assert.rejects(call(a,[]));count++;
  await assert.rejects(call(a,[S(1),S(4)]));count++;
  await assert.rejects(call(a,[S(1),S(3)]));count++;
  await Promise.all([call(a,[S(1),S(2)]),call(a2,[S(1),S(2)])]);count++;
  let row=(await pg.admin.query('select * from public.calendar_lessons where id=$1',[L])).rows[0];assert.equal(row.lesson_type,'group');count++;
  assert.equal((await pg.admin.query('select count(*)::int n from public.calendar_lesson_participants where calendar_lesson_id=$1',[L])).rows[0].n,2);count++;
  await assert.rejects(call(a,[S(2)]));count++;
  await call(a,[S(2)],[S(1),S(2)]);count++;
  row=(await pg.admin.query('select * from public.calendar_lessons where id=$1',[L])).rows[0];assert.equal(row.primary_student_id,S(2));assert.equal(row.student_name,'QA 2');assert.equal(row.lesson_type,'individual');count++;
  await pg.admin.query("insert into public.lesson_registrations(owner_id,calendar_lesson_id,status) values($1,$2,'in_progress')",[A,L]);
  await assert.rejects(call(a,[S(1),S(2)],[S(2)]));count++;
  assert.equal((await pg.admin.query('select count(*)::int n from public.calendar_lesson_participants where calendar_lesson_id=$1',[L])).rows[0].n,1);count++;
  console.log(`${count} comprobaciones de participantes correctas`);
 }finally{await Promise.all(clients.map(client=>client.end()));await pg.stop();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
