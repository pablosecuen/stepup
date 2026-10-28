import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialRepairPlan } from '../reconciliation.ts';
import type { StudentRecord } from '../../repositories/students-mapping.ts';
import type { PaymentChargeRecord } from '../../repositories/payments-mapping.ts';
const student = (overrides = {}) => ({ id:'s',status:'activo',billingType:'mensual',price:36000,billingPlan:{type:'monthly',amount:36000},statusChangeDate:null,...overrides } as unknown as StudentRecord);
const charge = (overrides = {}) => ({ id:'c',studentId:'s',chargeType:'mensual',originalAmount:36,dueDate:'2026-10-12',billingPeriod:'2026-10',savedLessonId:null,calendarLessonId:null,trainingBillingAgreementId:null,trainingSeriesName:null,packageId:null,createdAt:'2026-10-01T12:00:00Z',voidedAt:null,voidReason:null,...overrides } as PaymentChargeRecord);
const input = () => ({students:[student()],charges:[charge()],payments:[],allocations:[],decisions:[],todayDateKey:'2026-10-28',nowIso:'2026-10-28T15:00:00Z',trainingRegistrationIds:new Set<string>()});
test('reconciliación: cuota actual usa el plan; una repetición no propone cambios',()=>{
 const i=input();const p=buildFinancialRepairPlan(i);assert.equal(p.patches.length,1);assert.equal(p.patches[0].amount,36000);
 i.charges=[charge({originalAmount:36000})];assert.equal(buildFinancialRepairPlan(i).patches.length,0);
});
test('no reescribe un período anterior ni un cargo saldado',()=>{
 const i=input();i.charges=[charge({billingPeriod:'2026-09',dueDate:'2026-09-10'})];assert.equal(buildFinancialRepairPlan(i).patches.length,0);
 const j={...input(),payments:[{id:'p',studentId:'s',amount:36,method:'efectivo' as const,paidAt:'2026-10-12',recordedAt:'2026-10-12T12:00:00Z',voidedAt:null,voidReason:null,replacesPaymentId:null,notes:null,operationId:null}],allocations:[{id:'a',studentId:'s',chargeId:'c',paymentId:'p',amount:36,excessAmount:0,excessStatus:null}]};assert.equal(buildFinancialRepairPlan(j).patches.length,0);
});
test('el entrenamiento no lo cubre el plan individual mensual',()=>{
 const i=input();i.charges=[charge({chargeType:'por_clase',billingPeriod:null,savedLessonId:'training'})];i.trainingRegistrationIds.add('training');assert.equal(buildFinancialRepairPlan(i).patches.length,0);
});
test('la mensualidad posterior a la baja se anula sin tocar el mes de la baja',()=>{
 const i=input();i.students=[student({status:'archivado',statusChangeDate:'2026-09-20'})];assert.equal(buildFinancialRepairPlan(i).patches[0].reason,'inactive');
 i.students=[student({status:'archivado',statusChangeDate:'2026-10-20'})];assert.equal(buildFinancialRepairPlan(i).patches.length,0);
});
test('los primeros meses con decisión propia no se convierten a cuota completa',()=>{
 const i=input();const j={...i,decisions:[{id:'d',studentId:'s',billingPeriod:'2026-10',effectiveJoinDate:'2026-10-20',criterion:'custom' as const,classesRemaining:2,classesPerFullPeriod:4,permanentMonthlyAmount:36000,chargedAmount:36,chargeId:'c',createdAt:i.nowIso,confirmedAt:i.nowIso}]};const plan=buildFinancialRepairPlan(j);assert.ok(plan.patches.every(p=>p.amount===36));
});


