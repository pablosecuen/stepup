import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { computePerClassBilledAmount } from "../adhoc-billing.ts";
import { resolveStudentBillingPlan } from "../billing-plan.ts";
import { isAdhocClassHeld, type AdhocOutcome, type LateCancellationPolicy } from "../../lessons/adhoc.ts";

function declaration(source: string,name: string): string {
  const tree=ts.createSourceFile("fixture.ts",source,ts.ScriptTarget.Latest,true);
  const fn=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  assert.ok(fn,`Missing function ${name}`);
  return fn.getText(tree);
}
function javascript(source:string){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}

test("the actual registration billing action excludes monthly, weekly, package and complimentary plans",async()=>{
  const source=readFileSync(new URL("../../actions/lesson-registrations.ts",import.meta.url),"utf8");
  const body=javascript(declaration(source,"syncPerClassChargesForRegistration"));
  const plans=[{type:"monthly",amount:80000,dueDay:10},{type:"weekly",amount:10000,anchorDate:"2026-10-01"},{type:"class_package",amount:80000,includedClasses:8,validFrom:"2026-10-01"},{type:"complimentary"},{type:"per_class",amount:7000}];
  const students=plans.map((billingPlan,i)=>({id:`qa_${i}`,billingPlan,billingType:"mensual",price:999}));
  const charges=[] as unknown[];
  const create=new Function("getLessonRegistrationDetail","listStudents","resolveStudentBillingPlan","computePerClassBilledAmount","syncPerClassCharge","getCalendarLesson","listStudentsCoveredByTrainingPlan",`${body}; return syncPerClassChargesForRegistration;`);
  for(const outcome of ["clase_dictada","alumno_ausente","profesora_ausente","feriado","cancelada_con_aviso","reprogramada","cancelada_tarde"] as const){
    const run=create(async()=>({registration:{status:"completed",outcome,countsAsClass:isAdhocClassHeld(outcome,false),lateCancellationPolicy:outcome==="cancelada_tarde"?"cobrar_100":null,lateCancellationPercentage:null},participants:students.map(s=>({studentId:s.id}))}),async()=>students,resolveStudentBillingPlan,computePerClassBilledAmount,async(_ctx:unknown,_id:string,participants:unknown)=>charges.push(participants),async()=>null,async()=>new Set<string>());
    await run({},"qa_registration");
    assert.deepEqual(charges.at(-1),[{studentId:"qa_4",amount:outcome==="clase_dictada"||outcome==="cancelada_tarde"?7000:null}]);
  }
  assert.equal(charges.length,7);
});

test("per-class results and cancellation policy match the original app for varied amounts",()=>{
  const fixture=JSON.parse(readFileSync(new URL("../__fixtures__/mobile-registration-billing.json",import.meta.url),"utf8"));
  const compiled=javascript(fixture.declarations);
  const original=new Function("exports",compiled+"; return computeLessonBilledAmount;")({});
  const outcomes:AdhocOutcome[]=["clase_dictada","alumno_ausente","profesora_ausente","feriado","cancelada_con_aviso","cancelada_tarde","reprogramada"];
  const policies:LateCancellationPolicy[]=["cobrar_100","cobrar_porcentaje","descontar_del_paquete","no_cobrar"];
  for(const amount of [0,1,7,99,7000,99999])for(const outcome of outcomes)for(const holidayException of [false,true])for(const policy of policies)for(const percentage of [0,33,50,100]){
    const expected=original({isBillable:true,studentIds:["qa"],eventType:outcome,holidayException,lateCancellationPolicy:policy,lateCancellationPercentage:percentage},{qa:amount});
    assert.equal(computePerClassBilledAmount({perClassAmount:amount,outcome,isClassHeld:isAdhocClassHeld(outcome,holidayException),lateCancellationPolicy:policy,lateCancellationPercentage:percentage}),expected);
  }
});
