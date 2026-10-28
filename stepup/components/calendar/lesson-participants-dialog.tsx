"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { loadParticipantChoicesAction, changeSingleLessonParticipantsAction } from "@/lib/actions/lesson-participants";
import { guardNetwork } from "@/lib/actions/network-guard";
import { StudentPicker } from "@/components/students/student-picker";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { InlineStudent } from "@/components/calendar/inline-student";

export function LessonParticipantsDialog({ item, onBack, onDone }: { item: CalendarViewItem; onBack: () => void; onDone: () => void }) {
  const router = useRouter();
  const original = [...new Set([...(item.studentId ? [item.studentId] : []), ...item.participantIds])];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(original));
  const [students, setStudents] = useState<{ id: string; name: string; level: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating,setCreating]=useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  async function load() {
    setLoading(true);
    const result = await guardNetwork(() => loadParticipantChoicesAction());
    if (result.error) setError(result.error);
    else { setStudents(result.students ?? []); setError(undefined); }
    setLoading(false);
  }
  useEffect(() => { let active=true; guardNetwork(() => loadParticipantChoicesAction()).then(result => { if(!active)return; if(result.error)setError(result.error); else setStudents(result.students??[]); setLoading(false); }); return()=>{active=false;}; }, []);
  function save() {
    if(selected.size===0){setError("Elegí al menos un alumno.");return;}
    startTransition(async()=>{
      const result=await guardNetwork(() => changeSingleLessonParticipantsAction({itemId:item.id,startAt:item.start,studentIds:[...selected],expectedIds:original}));
      if(result.error){setError(result.error);return;}
      router.refresh();onDone();
    });
  }
  return <Dialog title="Modificar participantes de esta clase" busy={pending} onClose={()=>{if(!pending)onBack();}} footer={<><Button variant="secondary" disabled={pending} onClick={onBack}>Volver</Button><Button disabled={pending||loading} onClick={save}>{pending?"Guardando…":"Guardar participantes"}</Button></>}>
    <p className="mb-4 text-textSecondary">El cambio afecta sólo a esta clase. Las demás fechas de la serie conservan sus alumnos.</p>
    {loading?<p role="status">Cargando alumnos…</p>:<StudentPicker students={students.filter(s=>s.status==="activo"||original.includes(s.id))} selectedIds={selected} onToggle={id=>{setSelected(current=>{const next=new Set(current);if(next.has(id)){if(next.size===1){setError("La clase debe conservar al menos un alumno.");return current;}next.delete(id);}else next.add(id);setError(undefined);return next;});}} />}
    {error&&<div className="mt-3"><Notice tone="bad">{error}</Notice>{students.length===0&&<Button variant="secondary" onClick={load}>Reintentar</Button>}</div>}
    {creating?<InlineStudent onCancel={()=>setCreating(false)} onCreated={student=>{setStudents(v=>[...v.filter(s=>s.id!==student.id),student]);setSelected(v=>new Set([...v,student.id]));setCreating(false);}} />:<div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={pending} onClick={()=>setCreating(true)}>Crear alumno nuevo</Button><Button variant="secondary" disabled={loading||pending} onClick={load}>Actualizar alumnos</Button></div>}
  </Dialog>;
}
