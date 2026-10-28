"use client";
import { guardNetwork } from "@/lib/actions/network-guard";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewStudentDeletion, deleteStudentPermanently, type StudentDeletionImpact } from "@/lib/actions/student-deletion";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function DeleteStudentButton({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<StudentDeletionImpact | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [pending, run] = useTransition();
  const operation = useRef<string | null>(null);
  const router = useRouter();
  function review() {
    setOpen(true); setError(""); setConfirmation(""); setAcknowledged(false); setImpact(null);
    operation.current = crypto.randomUUID();
    run(async () => { const result = await guardNetwork(() => previewStudentDeletion(studentId)); setImpact(result.impact ?? null); setError(result.error ?? ""); });
  }
  return <div id="eliminar-alumno" className="mt-5 rounded-xl border border-badLine p-4">
    <h3 className="font-semibold">Eliminar alumno definitivamente</h3>
    <p className="my-2 text-sm text-textSecondary">Borra también su historial. Para conservarlo, usá Archivar o Pausar.</p>
    <Button variant="secondary" onClick={review}>Revisar eliminación</Button>
    {open && <Dialog title="Eliminar alumno definitivamente" busy={pending} onBeforeClose={() => !pending} onClose={() => setOpen(false)}>
      {error && <Notice tone="bad">{error}</Notice>}
      {pending && !impact && <p role="status">Calculando el impacto…</p>}
      {impact && <>
        <p className="font-semibold">{impact.name}</p>
        <dl className="my-4 grid grid-cols-2 gap-3">{([
          ["Clases relacionadas", impact.classes], ["Series relacionadas", impact.series],
          ["Registros", impact.registrations], ["Cobros", impact.charges], ["Pagos", impact.payments], ["Reportes", impact.reports],
        ] as const).map(([label, count]) => <div key={label}><dt className="text-sm text-textSecondary">{label}</dt><dd className="font-semibold">{count}</dd></div>)}</dl>
        <Notice tone="bad">Se elimina su información, incluidos sus cobros, pagos, reportes y archivos exclusivos. En las clases y series compartidas se retira sólo a este alumno: los demás conservan sus datos. No se puede deshacer.</Notice>
        <Field label="Escribí su nombre completo para confirmar" htmlFor="delete-student-name"><TextInput id="delete-student-name" value={confirmation} autoComplete="off" onChange={e => setConfirmation(e.target.value)} /></Field>
        <label className="my-4 flex min-h-12 items-center gap-3"><input type="checkbox" className="h-6 w-6 shrink-0" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Entiendo que se borra su historial financiero y pedagógico.</label>
        <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={!acknowledged || confirmation !== impact.name || pending} busy={pending} onClick={() => run(async () => {
          const result = await guardNetwork(() => deleteStudentPermanently({ id: studentId, token: impact.token, operationId: operation.current!, confirmation }));
          if (result.error) { setError(result.error); return; }
          setOpen(false); router.push("/alumnos"); router.refresh();
        })}>Eliminar definitivamente</Button></div>
      </>}
    </Dialog>}
  </div>;
}

