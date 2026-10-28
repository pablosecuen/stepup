const assert=require('node:assert/strict');
const {start}=require('./load.cjs');
const A='fb000000-0000-0000-0000-000000000001',B='fb000000-0000-0000-0000-000000000002';
async function main(){
 const pg=await start({port:5784});const clients=[];let n=0;
 const check=v=>{assert.ok(v);n++;};
 try{
  assert.deepEqual(pg.failures,[]);
  await pg.admin.query("insert into auth.users(id,email) values($1,'a@example.com'),($2,'b@example.com')",[A,B]);
  const a=await pg.session(A),a2=await pg.session(A),a3=await pg.session(A),b=await pg.session(B),anon=await pg.session(null,'anon');clients.push(a,a2,a3,b,anon);
  const claim=(c,id,g=null,replace=null,rg=null)=>c.query('select public.claim_web_device($1,$2,$3,$4,$5) as r',[id,g,replace,rg,'QA']);
  const ids=['web-device-aaaaaaaa','web-device-bbbbbbbb','web-device-cccccccc'];
  const count=async()=>Number((await pg.admin.query('select count(*) as n from public.web_device_sessions where user_id=$1 and revoked_at is null and expires_at>now()',[A])).rows[0].n);
  await assert.rejects(claim(anon,ids[0]));n++;
  await assert.rejects(a.query("insert into public.web_device_sessions(user_id,device_id) values($1,$2)",[A,ids[0]]));n++;
  await assert.rejects(claim(a,'bad'));n++;
  const racing=await Promise.all(ids.map((id,i)=>claim([a,a2,a3][i],id)));
  check(racing.filter(r=>r.rows[0].r.status==='authorized').length===2);check(await count()===2);
  const rejected=ids[racing.findIndex(r=>r.rows[0].r.status==='full')];const accepted=ids.filter(id=>id!==rejected);
  check((await claim(a,accepted[0],1)).rows[0].r.generation===1);check(await count()===2);
  await assert.rejects(claim(a,accepted[0],99));n++;
  check((await b.query('select * from public.web_device_sessions')).rows.length===0);
  await b.query('select public.end_web_device($1,1)',[accepted[0]]);check(await count()===2);
  check((await claim(a,rejected,null,accepted[0],99)).rows[0].r.status==='changed');check(await count()===2);
  check((await claim(a,rejected,null,accepted[0],1)).rows[0].r.status==='authorized');check(await count()===2);
  const revoked=(await pg.admin.query('select revoked_at from public.web_device_sessions where user_id=$1 and device_id=$2',[A,accepted[0]])).rows[0];check(!!revoked.revoked_at);
  await a.query('select public.touch_web_device($1,1)',[accepted[0]]);check(!!(await a.query('select revoked_at from public.web_device_sessions where device_id=$1',[accepted[0]])).rows[0].revoked_at);
  await a.query('select public.end_web_device($1,1)',[rejected]);check(await count()===1);
  const again=(await claim(a,accepted[0],1)).rows[0].r;check(again.status==='authorized'&&again.generation===2);
  await a.query('select public.end_web_device($1,1)',[accepted[0]]);check(await count()===2);
  await pg.admin.query("update public.web_device_sessions set expires_at=now()-interval '1 second' where user_id=$1 and device_id=$2",[A,accepted[1]]);
  await a.query('select public.touch_web_device($1,1)',[accepted[1]]);check(await count()===1);
  check((await claim(a,accepted[1],1)).rows[0].r.generation===2);check(await count()===2);
  check(Number((await pg.admin.query('select count(*) as n from public.active_sessions')).rows[0].n)===0);
  console.log(`${n} comprobaciones de dos dispositivos correctas`);
 }finally{await Promise.all(clients.map(c=>c.end()));await pg.stop();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
