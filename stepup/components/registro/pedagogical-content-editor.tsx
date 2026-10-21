"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import type { PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";
import type { LessonContentAttachment, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";
import { LessonFilesEditor } from "./lesson-files-editor";

function TextList({ label, singular, items, onChange }: { label: string; singular: string; items: string[]; onChange: (items: string[]) => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  function add() {
    if (!draft.trim()) return;
    onChange([...items, draft.trim()]);
    setDraft("");
  }
  return <fieldset className="min-w-0 space-y-2">
    <legend className="text-sm font-semibold text-textSecondary">{label}</legend>
    {items.map((item, index) => <div key={index} className="flex min-w-0 items-start gap-2">
      <TextArea rows={1} aria-label={`${singular} ${index + 1}`} value={item} onChange={(e) => onChange(items.map((v, i) => i === index ? e.target.value : v))} />
      <Button variant="ghost" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`Eliminar ${singular.toLowerCase()} ${index + 1}`}>×</Button>
    </div>)}
    <div className="flex min-w-0 items-end gap-2">
      <div className="min-w-0 flex-1"><Field htmlFor={id} label={`Agregar ${singular.toLowerCase()}`}><TextInput id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /></Field></div>
      <Button variant="secondary" onClick={add} disabled={!draft.trim()} aria-label={`Agregar ${singular.toLowerCase()}`}>+</Button>
    </div>
  </fieldset>;
}

/** `files`: con el registro ya creado, el editor también permite adjuntar fotos y PDF y elegir materiales de la biblioteca (como la app anterior). */
export interface PedagogicalFilesProps {
  registrationId: string;
  attachments: LessonContentAttachment[];
  library: LibraryMaterial[];
}

/**
 * Contenido de la clase, en el mismo orden que la app anterior: temas, objetivos, actividades, notas de actividades y, al final, evidencias y
 * materiales. La observación interna NO va acá: tiene su propio bloque más abajo (`InternalNotesCard`), como en la app.
 */
export function PedagogicalContentEditor({ value, onChange, files, title = "Contenido pedagógico" }: { value: PedagogicalContentInput; onChange: (content: PedagogicalContentInput) => void; files?: PedagogicalFilesProps; title?: string }) {
  const id = useId();
  const [topicDraft, setTopicDraft] = useState("");
  function addTopic() {
    if (!topicDraft.trim()) return;
    onChange({ ...value, topics: [...value.topics, { id: crypto.randomUUID(), text: topicDraft.trim(), status: "planificado" }] });
    setTopicDraft("");
  }
  return <section aria-labelledby={`${id}-title`}>
    <Card padded={false}>
      <CardHeader title={<span id={`${id}-title`}>{title}</span>} />
      <div className="space-y-5 px-4 pb-4 nav:px-5 nav:pb-5">
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold text-textSecondary">Temas</legend>
          <p className="text-sm text-textMuted">Marcá un tema para pasarlo de planificado a visto; podés editar su texto.</p>
          {value.topics.map((topic, index) => <div key={topic.id ?? index} className="flex min-w-0 items-start gap-2">
            <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-ink" aria-label={`Tema ${index + 1} visto`} checked={topic.status === "visto"} onChange={(e) => onChange({ ...value, topics: value.topics.map((t, i) => i === index ? { ...t, status: e.target.checked ? "visto" : "planificado" } : t) })} /><span>{topic.status === "visto" ? "Visto" : "Planificado"}</span></label>
            <TextArea rows={1} aria-label={`Tema ${index + 1}`} value={topic.text} onChange={(e) => onChange({ ...value, topics: value.topics.map((t, i) => i === index ? { ...t, text: e.target.value } : t) })} />
            <Button variant="ghost" aria-label={`Eliminar tema ${index + 1}`} onClick={() => onChange({ ...value, topics: value.topics.filter((_, i) => i !== index) })}>×</Button>
          </div>)}
          <div className="flex min-w-0 items-end gap-2">
            <div className="min-w-0 flex-1"><Field label="Agregar tema" htmlFor={`${id}-topic`}><TextInput id={`${id}-topic`} value={topicDraft} onChange={(e) => setTopicDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }} /></Field></div>
            <Button variant="secondary" onClick={addTopic} disabled={!topicDraft.trim()} aria-label="Agregar tema">+</Button>
          </div>
        </fieldset>
        <TextList label="Objetivos" singular="Objetivo" items={value.objectives} onChange={(objectives) => onChange({ ...value, objectives })} />
        <TextList label="Actividades" singular="Actividad" items={value.activities} onChange={(activities) => onChange({ ...value, activities })} />
        <Field label="Notas de actividades" htmlFor={`${id}-notes`}><TextArea id={`${id}-notes`} rows={4} placeholder="Qué se hizo en esta clase, en texto libre" value={value.activityNotes} onChange={(e) => onChange({ ...value, activityNotes: e.target.value })} /></Field>
        {files && <LessonFilesEditor registrationId={files.registrationId} attachments={files.attachments} library={files.library} materialIds={value.materialIds ?? []} onMaterialIdsChange={(materialIds) => onChange({ ...value, materialIds })} />}
      </div>
    </Card>
  </section>;
}

/** «Observaciones internas»: sólo las ve la profesora y nunca salen en un reporte. Va después de los participantes, antes de la tarea. */
export function InternalNotesCard({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return <section aria-labelledby={`${id}-title`}>
    <Card padded={false}>
      <CardHeader title={<span id={`${id}-title`}>Observaciones internas</span>} />
      <div className="px-4 pb-4 nav:px-5 nav:pb-5">
        <Field label={<span className="sr-only">Observaciones internas</span>} htmlFor={`${id}-internal`} hint="Solo la ve la profesora — no se incluye en reportes.">
          <TextArea id={`${id}-internal`} rows={3} placeholder="Observaciones privadas sobre esta clase" value={value} onChange={(e) => onChange(e.target.value)} />
        </Field>
      </div>
    </Card>
  </section>;
}
