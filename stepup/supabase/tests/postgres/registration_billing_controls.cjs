const assert=require('node:assert/strict');const {start}=require('./load.cjs');
const A='fd000000-0000-0000-0000-000000000001', B='fd000000-0000-0000-0000-000000000002',R='fd100000-0000-0000-0000-000000000001';
const content={topics:[],objectives:[],activities:[],activity_notes:'Nota conservada',internal_notes:'Interna'};
async function main(){const pg=await start({port:5783});let count=0;const clients=[];try{
 assert.deepEqual(pg.failures,[]);
 await pg.admin.query("insert into auth.users(id,email) values($1,'a@example.com'),($2,'b@example.com')",[A,B]);
 await pg.admin.query("insert into public.lesson_registrations(id,owner_id,status) values($1,$2,'in_progress')",[R,A]);
 const a=await pg.session(A),b=await pg.session(B);
 clients.push(a,b);
 const save=(session,c)=>session.query('select public.save_lesson_content_draft($1)',[JSON.stringify({lesson_registration_id:R,pedagogical_content:c})]);
 await assert.rejects(save(b,content));count++;
 await save(a,{...content,is_billable:false,consumes_monthly_package:false});
 const row=async()=>(await pg.admin.query('select * from public.lesson_registrations where id=$1',[R])).rows[0];
 assert.equal((await row()).is_billable,false);count++;assert.equal((await row()).consumes_monthly_package,false);count++;
 await save(a,content);assert.equal((await row()).is_billable,false);assert.equal((await row()).consumes_monthly_package,false);count++;
 await assert.rejects(save(a,{...content,activity_notes:'No debe guardarse',is_billable:'false'}));assert.equal((await row()).activity_notes,'Nota conservada');count++;
 await a.query('select public.finalize_lesson_registration($1)',[JSON.stringify({lesson_registration_id:R,pedagogical_content:{...content,is_billable:false,consumes_monthly_package:true}})]);
 assert.equal((await row()).status,'completed');assert.equal((await row()).is_billable,false);assert.equal((await row()).consumes_monthly_package,true);count++;
 const acl=(await pg.admin.query("select has_function_privilege('authenticated','public.apply_lesson_pedagogical_content(uuid,jsonb)','execute') as direct")).rows[0];assert.equal(acl.direct,false);count++;
 await pg.admin.query(require('fs').readFileSync(require('path').join(__dirname,'../../migrations/20261030120000_registration_billing_controls.sql'),'utf8'));
 assert.equal((await row()).is_billable,false);count++;
 console.log(`${count} comprobaciones de controles de cobro correctas`);
}finally{await Promise.all(clients.map(client=>client.end()));await pg.stop();}}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
