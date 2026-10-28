import { evaluateAvailability, type TeacherAvailability } from './availability.ts';
import { localDateTimeToInstantIso } from './timezone.ts';
import type { CalendarViewItem } from './occurrences.ts';
export function calendarEditPayload(item:CalendarViewItem, students:{id:string;name:string;levels:string[]}[]){
 const byId=new Map(students.map(s=>[s.id,s]));
 const ids=[...new Set([...(item.studentId?[item.studentId]:[]),...item.participantIds])];
 return {lesson_id:item.materializedLessonId,recurrence_id:item.recurrenceId,occurrence_key:item.occurrenceKey,
 base:{primary_student_id:item.studentId,student_name:byId.get(item.studentId??'')?.name??item.studentName,level:item.level,lesson_type:item.lessonType,start_at:item.start,end_at:item.end,modality:item.modality,color:'#F2E8FF',recurrence_index:null,class_title:item.title,activity_kind:item.activityKind,participants:ids.map(id=>({student_id:id,student_name:byId.get(id)?.name??'',level:byId.get(id)?.levels[0]??''}))},changes:{class_title:item.title}};
}
export type SlotItem=Pick<CalendarViewItem,'id'|'start'|'end'|'status'|'studentName'|'occupiesSlot'>;
export function daySlots(date:string,duration:number,items:SlotItem[],availability:TeacherAvailability,ignoreId?:string){
 if(!Number.isInteger(duration)||duration<1||duration>480)throw new Error('Duración inválida');
 return Array.from({length:56},(_,i)=>{
  const minutes=8*60+i*15;
  const start=localDateTimeToInstantIso({date,hour:Math.floor(minutes/60),minute:minutes%60,timeZone:availability.timezone});
  const end=new Date(Date.parse(start)+duration*60000).toISOString();
  const occupied=items.filter(item=>item.id!==ignoreId&&item.status!=='cancelled'&&item.occupiesSlot!==false&&item.start<end&&item.end>start);
  const evaluation=evaluateAvailability(start,end,availability);
  return {time:`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`,start,end,available:occupied.length===0&&evaluation.isAvailable,occupied:occupied.map(i=>i.studentName),blocked:evaluation.label};
 });
}
