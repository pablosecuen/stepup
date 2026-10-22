"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea } from "@/components/ui/field";
import type { PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";
import type { LessonContentAttachment, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";
import { LessonFilesEditor } from "./lesson-files-editor";
import { AddItemRow } from "./draft-items";

/** Claves de los borradores de «agregar» del contenido (las usa el guardado para incorporar lo pendiente). */
export const CONTENT_DRAFT_KEYS = { topics: "contenido:temas", objectives: "contenido:objetivos", activities: "contenido:actividades" } as const;

type ContentUpdate = PedagogicalContentInput | ((previous: PedagogicalContentInput) => PedagogicalContentInput);

type ItemsUpdate = (update: (items: string[]) => string[]) => void;

/**
 * Lista editable de textos (objetivos, actividades): cada elemento YA es un campo editable en su lugar (se conserva); se agrega con «+», con Enter o
 * al soltar el campo (✅ de iOS) — una sola vez, ver `AddItemRow`.
 */
function TextList({ label, singular, draftKey, items, onItemsChange }: { label: string; singular: string; draftKey: string; items: string[]; onItemsChange: ItemsUpdate }) {
  const id = useId();
  return <fieldset className="min-w-0 space-y-2">
    <legend className="text-sm font-semibold text-textSecondary">{label}</legend>
    {items.map((item, index) => <div key={index} className="flex min-w-0 items-start gap-2">
      <TextArea rows={1} aria-label={`${singular} ${index + 1}`} value={item} onChange={(e) => { const text = e.target.value; onItemsChange((current) => current.map((v, i) => i === index ? text : v)); }} />
      <Button variant="ghost" onClick={() => onItemsChange((current) => current.filter((_, i) => i !== index))} aria-label={`Eliminar ${singular.toLowerCase()} ${index + 1}`}>×</Button>
    </div>)}
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-[650] text-textSecondary">{`Agregar ${singular.toLowerCase()}`}</label>
      <AddItemRow draftKey={draftKey} id={id} label={`Agregar ${singular.toLowerCase()}`} onAdd={(text) => onItemsChange((current) => [...current, text])} />
    </div>
  </fieldset>;
}

/** `files`: con el registro ya creado, el editor también permite adjuntar fotos y PDF y elegir materiales de la biblioteca (como la app anterior). */
export interface PedagogicalFilesProps {
  registrationId: string;
  attachments: LessonContentAttachment[];
  library: LibraryMaterial[];
  /** Clase grupal: los participantes, para que cada archivo pueda ser «sólo de» uno. */
  participants?: { studentId: string; name: string }[];
}

/**
 * Contenido de la clase, en el mismo orden que la app anterior: temas, objetivos, actividades, notas de actividades y, al final, evidencias y
 * materiales. La observación interna NO va acá: tiene su propio bloque más abajo (`InternalNotesCard`), como en la app.
 */
export function PedagogicalContentEditor({ value, onChange, files, title = "Contenido pedagógico" }: { value: PedagogicalContentInput; onChange: (content: ContentUpdate) => void; files?: PedagogicalFilesProps; title?: string }) {
  const id = useId();
  return <section aria-labelledby={`${id}-title`}>
    <Card padded={false}>
      <CardHeader title={<span id={`${id}-title`}>{title}</span>} />
      <div className="space-y-5 px-4 pb-4 nav:px-5 nav:pb-5">
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold text-textSecondary">Temas</legend>
          <p className="text-sm text-textMuted">Marcá un tema para pasarlo de planificado a visto; podés editar su texto.</p>
          {value.topics.map((topic, index) => <div key={topic.id ?? index} className="flex min-w-0 items-start gap-2">
            <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-ink" aria-label={`Tema ${index + 1} visto`} checked={topic.status === "visto"} onChange={(e) => { const seen = e.target.checked; onChange((current) => ({ ...current, topics: current.topics.map((t, i) => i === index ? { ...t, status: seen ? "visto" : "planificado" } : t) })); }} /><span>{topic.status === "visto" ? "Visto" : "Planificado"}</span></label>
            <TextArea rows={1} aria-label={`Tema ${index + 1}`} value={topic.text} onChange={(e) => { const text = e.target.value; onChange((current) => ({ ...current, topics: current.topics.map((t, i) => i === index ? { ...t, text } : t) })); }} />
            <Button variant="ghost" aria-label={`Eliminar tema ${index + 1}`} onClick={() => onChange((current) => ({ ...current, topics: current.topics.filter((_, i) => i !== index) }))}>×</Button>
          </div>)}
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-topic`} className="text-sm font-[650] text-textSecondary">Agregar tema</label>
            <AddItemRow draftKey={CONTENT_DRAFT_KEYS.topics} id={`${id}-topic`} label="Agregar tema" onAdd={(text) => onChange((current) => ({ ...current, topics: [...current.topics, { id: crypto.randomUUID(), text, status: "planificado" }] }))} />
          </div>
        </fieldset>
        <TextList label="Objetivos" singular="Objetivo" draftKey={CONTENT_DRAFT_KEYS.objectives} items={value.objectives} onItemsChange={(update) => onChange((current) => ({ ...current, objectives: update(current.objectives) }))} />
        <TextList label="Actividades" singular="Actividad" draftKey={CONTENT_DRAFT_KEYS.activities} items={value.activities} onItemsChange={(update) => onChange((current) => ({ ...current, activities: update(current.activities) }))} />
        <Field label="Notas de actividades" htmlFor={`${id}-notes`}><TextArea id={`${id}-notes`} rows={4} placeholder="Qué se hizo en esta clase, en texto libre" value={value.activityNotes} onChange={(e) => onChange({ ...value, activityNotes: e.target.value })} /></Field>
        {files && <LessonFilesEditor registrationId={files.registrationId} attachments={files.attachments} library={files.library} participants={files.participants} materialIds={value.materialIds ?? []} onMaterialIdsChange={(materialIds) => onChange({ ...value, materialIds })} />}
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
