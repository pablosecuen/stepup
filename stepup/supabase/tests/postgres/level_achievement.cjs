const assert = require('node:assert/strict');
const { start } = require('./load.cjs');
const A='fb000000-0000-0000-0000-000000000001', B='fb000000-0000-0000-0000-000000000002';
const S='fb100000-0000-0000-0000-000000000001';
const operation=n=>`fb200000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function main(){
  const pg=await start({port:5781});
  let count=0;
  const clients=[];
  const check=(value)=>{assert.ok(value);count++;};
  try{
    assert.deepEqual(pg.failures,[]);
    await pg.admin.query("insert into auth.users(id,email) values($1,'a@example.com'),($2,'b@example.com')",[A,B]);
    await pg.admin.query("insert into public.students(id,owner_id,name,modality,category,billing_type,date_joined,price,levels) values($1,$2,'QA','online','otro','por_clase','2025-01-01',1000,array['Apoyo','A1'])",[S,A]);
    const a=await pg.session(A), a2=await pg.session(A), b=await pg.session(B);
    clients.push(a,a2,b);
    const call=(session,n,level='A2',date='2025-03-01',confirmed=false,expected='A1')=>session.query('select public.record_student_level_achievement($1,$2,$3,$4,$5,$6,$7) as result',[S,operation(n),level,date,'Nota de prueba',confirmed,expected]);
    const denied=await pg.admin.query("select has_function_privilege('anon','public.record_student_level_achievement(uuid,uuid,text,date,text,boolean,text)','execute') as allowed");check(!denied.rows[0].allowed);
    await assert.rejects(call(b,1));count++;
    await assert.rejects(call(a,1,'A1'));count++;
    await assert.rejects(call(a,1,'A2','2024-01-01'));count++;
    await assert.rejects(call(a,1,'A2','2099-01-01'));count++;
    await assert.rejects(call(a,1,'C1'));count++;
    const [r1,r2]=await Promise.all([call(a,1),call(a2,1)]);check(r1.rows[0].result.id===r2.rows[0].result.id);
    const student=(await pg.admin.query('select levels from public.students where id=$1',[S])).rows[0];assert.deepEqual(student.levels,['A2','Apoyo']);count++;
    const h=(await pg.admin.query('select * from public.student_level_history where student_id=$1',[S])).rows;check(h.length===1&&h[0].duration_days===59&&h[0].from_level==='A1'&&h[0].note==='Nota de prueba');
    await assert.rejects(call(a,1,'B1','2025-03-01',false,'A2'));count++;
    await assert.rejects(call(a,2,'B1','2025-02-01',false,'A2'));count++;
    await assert.rejects(call(a,2,'B1','2025-04-01',false,'A1'));count++;
    await call(a,2,'C1','2025-04-01',true,'A2');count++;
    await call(a,3,'B2','2025-05-01',true,'C1');count++;
    const snapshot=(await pg.admin.query('select count(*)::int as n from public.student_level_history where student_id=$1',[S])).rows[0];check(snapshot.n===3);
    check((await pg.admin.query('select count(*)::int as n from public.payment_charges')).rows[0].n===0);
    console.log(`${count} comprobaciones de logros de nivel correctas`);
  }finally{await Promise.all(clients.map(client=>client.end()));await pg.stop();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
