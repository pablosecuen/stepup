import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityPreviewFingerprint,replacementPreviewKey} from '../change-preview.ts';
const preview={source:'class-a',start:'2026-11-01T15:00:00Z',end:'2026-11-01T16:00:00Z',kind:'training',scope:'thisAndFuture',fee:2000,amount:1000,effective:'2026-11-01',criterion:'proportional',rule:'series-a',version:'v1',endIds:['later-b','later-a'],participants:['student-b','student-a'],title:'Grupo'};
test('la confirmación conserva el mismo resultado aunque cambie el orden técnico del grupo',()=>{
 assert.equal(activityPreviewFingerprint(preview),activityPreviewFingerprint({...preview,participants:[...preview.participants].reverse(),endIds:[...preview.endIds].reverse()}));
});
test('cambios de cuota, fecha, participantes o versión exigen una nueva vista previa',()=>{
 const original=activityPreviewFingerprint(preview);
 for(const change of [{fee:3000},{amount:1200},{effective:'2026-11-02'},{participants:['student-a']},{version:'v2'},{endIds:[]}])assert.notEqual(original,activityPreviewFingerprint({...preview,...change}));
});
test('reemplazar exige confirmar las mismas clases, horarios y participantes, sin depender del orden',()=>{
 const a={id:'a',start:preview.start,end:preview.end,participantIds:['uno','dos']};const b={...a,id:'b'};
 assert.equal(replacementPreviewKey([a,b]),replacementPreviewKey([b,{...a,participantIds:['dos','uno']}]));
 for(const changed of [[a],[a,{...b,end:'2026-11-01T17:00:00Z'}],[a,{...b,participantIds:['otro']}]])assert.notEqual(replacementPreviewKey([a,b]),replacementPreviewKey(changed));
});
