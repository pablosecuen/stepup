"use server";
import {activityPreviewFingerprint} from '@/lib/calendar/change-preview';
import {requireAuthenticatedDbContext} from '@/lib/db/server-context';import {revalidatePath} from 'next/cache';
import {loadCalendarViewForRange} from '@/lib/calendar/view';import {listStudents} from '@/lib/repositories/students';import {getRecurrenceRule,listRecurrenceRules} from '@/lib/repositories/recurrence-rules';import {buildSplitPayload} from '@/lib/repositories/recurrence-split';
import {calendarEditPayload} from '@/lib/calendar/parity';import {instantDateKey} from '@/lib/calendar/civil-calendar';import {todayInArgentina} from '@/lib/format/date-format';import {parseMoneyInput} from '@/lib/format/money-input';import {actionErrorMessage} from '@/lib/errors/action-error';
import {computeTrainingFirstPeriodCharge} from '@/lib/payments/training-charge-plan';import {resolveEditableSegment} from '@/lib/calendar/lineage';
import {listRecurrenceExceptionsForRules} from '@/lib/repositories/recurrence-exceptions';import {listCalendarLessonsForRecurrence} from '@/lib/repositories/calendar-lessons';
export async function convertActivityAction(input:{id:string;start:string;kind:'class'|'training';scope:'series'|'thisAndFuture';fee:string;criterion:'proportional'|'full'|'no_charge';operationId:string;confirm?:boolean;previewFingerprint?:string}){
 try{
  if(!['class','training'].includes(input.kind)||!['series','thisAndFuture'].includes(input.scope)||!['proportional','full','no_charge'].includes(input.criterion)||!/^[-\da-f]{36}$/i.test(input.operationId))throw new Error('Cambio inválido');
  const ctx=await requireAuthenticatedDbContext();
  const {data:replay}=await ctx.supabase.from('calendar_activity_operations').select('result,payload').eq('owner_id',ctx.ownerId).eq('operation_id',input.operationId).maybeSingle();if(replay){if(replay.payload.source_id!==input.id||replay.payload.activity_kind!==input.kind)throw new Error('La operación pertenece a otro cambio');return {done:true};}
  const anchor=new Date(input.start);if(!Number.isFinite(anchor.getTime()))throw new Error('Fecha inválida');
  const items=await loadCalendarViewForRange(ctx,new Date(anchor.getTime()-86400000),new Date(anchor.getTime()+86400000),undefined,{includeTestData:true});const item=items.find(i=>i.id===input.id);if(!item)throw new Error('La clase cambió. Recargá la agenda');
  if(item.activityKind===input.kind)return {done:true};
  const students=await listStudents(ctx);const today=todayInArgentina();let effective=input.scope==='series'?today:instantDateKey(item.start);if(effective<today)throw new Error('No se puede convertir el pasado');
  let rule=item.recurrenceId?await getRecurrenceRule(ctx,item.recurrenceId):null;if(rule&&input.scope==='series'&&effective<(rule.effectiveFromDate??rule.startDate))effective=rule.effectiveFromDate??rule.startDate;let split:ReturnType<typeof buildSplitPayload>|undefined;let endIds:string[]=[];
  if(rule){const all=(await listRecurrenceRules(ctx)).map(r=>({...r,recurrenceId:r.id}));const segment=resolveEditableSegment(all,rule.id,effective);if(!segment)throw new Error('La fecha no pertenece a la serie');rule=await getRecurrenceRule(ctx,segment.target.id);if(!rule||!rule.primaryStudentId)throw new Error('Serie sin alumno principal');endIds=segment.superseded.map(r=>r.id);split=buildSplitPayload(rule,{originalRecurrenceId:rule.id,effectiveDate:effective,todayDate:today,ruleType:rule.ruleType,cycleLengthWeeks:rule.cycleLengthWeeks,weeks:rule.weeks,participantIds:rule.participantIds,primaryStudentId:rule.primaryStudentId,activityKind:input.kind,successorEndDate:segment.superseded.length?segment.superseded[segment.superseded.length-1].endDate:rule.endDate});}
  const ids=rule?.participantIds??[...new Set([...(item.studentId?[item.studentId]:[]),...item.participantIds])];if(ids.some(id=>students.find(s=>s.id===id)?.status!=='activo'))throw new Error('Todos los participantes deben estar activos');
  let fee=0,amount=0;const period=effective.slice(0,7);
  if(input.kind==='training'){const parsed=parseMoneyInput(input.fee);if('error'in parsed||parsed.amount<=0)throw new Error('Ingresá una cuota mensual válida');fee=parsed.amount;amount=fee;
   if(input.criterion==='no_charge')amount=0;else if(input.criterion==='proportional'&&rule){const [exceptions,existingLessons]=await Promise.all([listRecurrenceExceptionsForRules(ctx,[rule.id]),listCalendarLessonsForRecurrence(ctx,rule.id)]);const suggestion=computeTrainingFirstPeriodCharge({monthlyFee:fee,effectiveJoinDate:effective,rule:{...rule,recurrenceId:rule.id,studentId:rule.primaryStudentId},exceptions,existingLessons});amount=suggestion.amount;}
  }
  const warnings=endIds.length?`Se reemplazan ${endIds.length} cambios futuros de esta serie.`:'';
  const payload={source_id:input.id,operation_id:input.operationId,activity_kind:input.kind,expected_kind:rule?.activityKind??item.activityKind,expected_rule_updated_at:rule?.updatedAt,title:item.title??item.studentName,start_period:period,monthly_fee:fee,charges:input.kind==='training'?ids.map(id=>({student_id:id,amount,due_date:effective})):[],...(split?{split,end_rule_ids:endIds}:{edit:calendarEditPayload(item,students)})};
  // Compare semantic inputs; split payloads contain a new technical successor UUID on each read.
  const fingerprint=activityPreviewFingerprint({source:input.id,start:item.start,end:item.end,kind:input.kind,scope:input.scope,fee,amount,effective,criterion:input.criterion,rule:rule?.id,version:rule?.updatedAt,endIds,participants:ids,title:payload.title});
  if(!input.confirm)return {preview:{amount,fee,period,participants:ids.map(id=>students.find(s=>s.id===id)?.name??''),warnings,effective,fingerprint}};
  if(input.previewFingerprint!==fingerprint)throw new Error('Los datos cambiaron desde la vista previa. Volvé y revisá los cambios antes de confirmar.');
  const {error}=await ctx.supabase.rpc('convert_calendar_activity',{p_payload:payload});if(error)throw error;
  for(const p of ['/calendario','/registro','/inicio','/cobros','/alumnos'])revalidatePath(p);return {done:true};
 }catch(error){return {error:actionErrorMessage('activity-conversion',error)};}
}
