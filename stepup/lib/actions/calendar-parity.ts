"use server";
import {revalidatePath} from 'next/cache';
import {requireAuthenticatedDbContext} from '@/lib/db/server-context';
import {loadCalendarViewForRange} from '@/lib/calendar/view';
import {getTeacherAvailability} from '@/lib/repositories/teacher-availability';
import {listStudents,createStudent,type NewStudentInput} from '@/lib/repositories/students';
import {calendarEditPayload} from '@/lib/calendar/parity';
import {instantDateKey} from '@/lib/calendar/civil-calendar';
import {localDateTimeToInstantIso} from '@/lib/calendar/timezone';
import {instantFromClockTime,arrivalFromLateTime} from '@/lib/live-class/live-class';
import {actionErrorMessage} from '@/lib/errors/action-error';
import type {StudentArrival} from '@/lib/payments/engine/features/new-class/types';
const zone='America/Argentina/Buenos_Aires';
function refresh(){for(const p of ['/inicio','/calendario','/alumnos','/registro','/configuracion'])revalidatePath(p);}
export async function calendarSlotsAction(month:string){
 try{
  if(!/^\d{4}-\d{2}$/.test(month))throw new Error('Mes inválido');
  const ctx=await requireAuthenticatedDbContext();const date=`${month}-01`;
  const start=localDateTimeToInstantIso({date,hour:0,minute:0,timeZone:zone});
  const [items,availability]=await Promise.all([loadCalendarViewForRange(ctx,new Date(start),new Date(Date.parse(start)+32*86400000),undefined,{includeTestData:true}),getTeacherAvailability(ctx)]);
  return {items:items.map(({id,start,end,status,studentName,occupiesSlot})=>({id,start,end,status,studentName,occupiesSlot})),availability};
 }catch(error){return {error:actionErrorMessage('calendar-slots',error)};}
}
export async function nextHomeworkDatesAction(studentId:string|string[],after:string){
 try{
  const ctx=await requireAuthenticatedDbContext();
  const start=new Date(after);if(!Number.isFinite(start.getTime()))throw new Error('Fecha inválida');
  const items=await loadCalendarViewForRange(ctx,start,new Date(start.getTime()+90*86400000),undefined,{includeTestData:true});
  const ids=Array.isArray(studentId)?studentId:[studentId];
  return {dates:[...new Set(items.filter(i=>i.start>after&&(i.status==='scheduled'||i.status==='rescheduled')&&i.occupiesSlot!==false&&ids.every(id=>i.studentId===id||i.participantIds.includes(id))).map(i=>instantDateKey(i.start)))].slice(0,12)};
 }catch(error){return {error:actionErrorMessage('homework-dates',error)};}
}
export async function inlineCalendarStudentAction(input:NewStudentInput,operationId:string,confirmDuplicate=false){
 try{const ctx=await requireAuthenticatedDbContext();const result=await createStudent(ctx,input,{operationId,confirmDuplicate});if(result.status==='possible_duplicate')return {error:'Ya hay alumnos parecidos. Confirmá si querés crear otro.',duplicate:true};refresh();return {student:{id:result.student.id,name:result.student.name,level:result.student.levels.join(', '),status:result.student.status}};}catch(error){return {error:actionErrorMessage('inline-student',error)};}
}
export async function getLivePreferencesAction(){const ctx=await requireAuthenticatedDbContext();const {data,error}=await ctx.supabase.from('teacher_interaction_preferences').select('live_tracking').eq('owner_id',ctx.ownerId).maybeSingle();if(error)throw error;return {enabled:data?.live_tracking!==false};}
export async function saveLivePreferencesAction(enabled:boolean){try{if(typeof enabled!=='boolean')throw new Error('Preferencia inválida');const ctx=await requireAuthenticatedDbContext();const {error}=await ctx.supabase.from('teacher_interaction_preferences').upsert({owner_id:ctx.ownerId,live_tracking:enabled});if(error)throw error;refresh();return {};}catch(error){return {error:actionErrorMessage('live-preferences',error)};}}
export async function correctRegisteredSessionAction(input:{id:string;date:string;start:string;end:string;arrival:StudentArrival;expected:string}){
 try{const ctx=await requireAuthenticatedDbContext();const start=instantFromClockTime(`${input.date}T12:00:00-03:00`,input.start),end=instantFromClockTime(`${input.date}T12:00:00-03:00`,input.end);if(!start||!end)throw new Error('Ingresá horarios válidos');
 const {data:r,error:e}=await ctx.supabase.from('lesson_registrations').select('effective_start_at,scheduled_start_at').eq('owner_id',ctx.ownerId).eq('id',input.id).single();if(e)throw e;
 let arrival=input.arrival;if(arrival.arrivedAt)arrival={...arrivalFromLateTime(arrival.arrivedAt,r.effective_start_at??r.scheduled_start_at??start),manuallyCorrected:true};
 const {error}=await ctx.supabase.rpc('correct_registered_session',{p_id:input.id,p_start:start,p_end:end,p_arrival:arrival,p_expected:input.expected});if(error)throw error;refresh();return {};
 }catch(error){return {error:actionErrorMessage('session-correction',error)};}
}
export async function adjustCalendarScheduleAction(input:{id:string;start:string;direction:'advanced'|'delayed';minutes:number;reason:'teacher'|'mutual_agreement';allowBlocked?:boolean}){
 try{if(![15,20,30,40,50,60].includes(input.minutes)||!['advanced','delayed'].includes(input.direction)||!['teacher','mutual_agreement'].includes(input.reason))throw new Error('Ajuste inválido');
 const ctx=await requireAuthenticatedDbContext();const start=new Date(input.start);if(!Number.isFinite(start.getTime()))throw new Error('Fecha inválida');
 const items=await loadCalendarViewForRange(ctx,new Date(start.getTime()-86400000),new Date(start.getTime()+86400000),undefined,{includeTestData:true});const item=items.find(i=>i.id===input.id&&i.start===input.start);if(!item)throw new Error('La clase cambió. Recargá la agenda');
 const newStart=new Date(start.getTime()+input.minutes*60000*(input.direction==='delayed'?1:-1)).toISOString();const newEnd=new Date(Date.parse(newStart)+Date.parse(item.end)-Date.parse(item.start)).toISOString();
 if(items.some(i=>i.id!==item.id&&i.status!=='cancelled'&&i.occupiesSlot!==false&&i.start<newEnd&&i.end>newStart))throw new Error('El nuevo horario está ocupado');
 const availability=await getTeacherAvailability(ctx);const {evaluateAvailability}=await import('@/lib/calendar/availability');const evaluation=evaluateAvailability(newStart,newEnd,availability);if(!evaluation.isAvailable&&!input.allowBlocked)return {error:evaluation.label??'Horario bloqueado',blocked:true};
 const students=await listStudents(ctx);const {error}=await ctx.supabase.rpc('adjust_calendar_schedule',{p_edit:calendarEditPayload(item,students),p_expected:item.start,p_start:newStart,p_adjustment:{direction:input.direction,minutes:input.minutes,reason:input.reason,adjustedAt:new Date().toISOString()}});if(error)throw error;refresh();return {};
 }catch(error){return {error:actionErrorMessage('schedule-adjustment',error)};}
}
export async function replacementNoticesAction(studentId:string){const ctx=await requireAuthenticatedDbContext();const {data,error}=await ctx.supabase.from('calendar_replacement_notices').select('id,cancelled_start_at').eq('owner_id',ctx.ownerId).eq('student_id',studentId).is('dismissed_at',null);if(error)throw error;return data??[];}
export async function dismissReplacementNoticeAction(id:string){try{const ctx=await requireAuthenticatedDbContext();const {error}=await ctx.supabase.rpc('dismiss_calendar_replacement_notice',{p_id:id});if(error)throw error;refresh();return {};}catch(error){return {error:actionErrorMessage('replacement-notice',error)};}}
