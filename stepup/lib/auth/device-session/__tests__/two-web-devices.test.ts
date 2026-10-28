import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWebDeviceAccess, serializeDeviceCookie, type WebDeviceRow } from "../decision.ts";
const now = new Date("2026-10-28T12:00:00Z");
const row = (id:string, changes: Partial<WebDeviceRow> = {}):WebDeviceRow => ({ device_id:id,generation:1,label:"Navegador",last_seen_at:now.toISOString(),expires_at:"2026-11-28T12:00:00Z",revoked_at:null,...changes });
const a=row("web-device-aaaaaaaa"),b=row("web-device-bbbbbbbb");
const cookie=(r:WebDeviceRow)=>serializeDeviceCookie({deviceId:r.device_id,generation:r.generation});
test("dos dispositivos autorizados se mantienen abiertos; tercero requiere elegir reemplazo",()=>{
  assert.equal(resolveWebDeviceAccess(cookie(a),[a,b],now).kind,"authorized");
  assert.equal(resolveWebDeviceAccess(cookie(b),[a,b],now).kind,"authorized");
  assert.equal(resolveWebDeviceAccess(undefined,[a,b],now).kind,"confirm-transfer");
  assert.equal(resolveWebDeviceAccess(undefined,[a],now).kind,"claim");
});
test("reemplazado no se recupera solo aunque quede un lugar; vencido sí permite reautorizar",()=>{
  assert.equal(resolveWebDeviceAccess(cookie(a),[{...a,revoked_at:now.toISOString()},b],now).kind,"taken-elsewhere");
  assert.equal(resolveWebDeviceAccess(cookie(a),[{...a,generation:2},b],now).kind,"taken-elsewhere");
  assert.equal(resolveWebDeviceAccess(cookie(a),[{...a,expires_at:"2026-10-27T12:00:00Z"},b],now).kind,"claim");
});
test("cookies malformadas y generaciones falsas nunca autorizan",()=>{
  for(const value of ["","basura",`${a.device_id}.0`,`${a.device_id}.2`]) assert.notEqual(resolveWebDeviceAccess(value,[a,b],now).kind,"authorized");
});
