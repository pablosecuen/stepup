"use client";

import { useId } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea, checkClass } from "@/components/ui/field";
import type { PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";
import type { LessonContentAttachment, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";
import { LessonFilesEditor } from "./lesson-files-editor";
import { EditableTextList } from "./editable-text-list";

/** Claves de los borradores de «agregar» del contenido (las usa el guardado para incorporar lo pendiente). */
export const CONTENT_DRAFT_KEYS = { topics: "contenido:temas", objectives: "contenido:objetivos", activities: "contenido:actividades" } as const;

type ContentUpdate = PedagogicalContentInput | ((previous: PedagogicalContentInput) => PedagogicalContentInput);

type ItemsUpdate = (update: (items: string[]) => string[]) => void;

/** Lista de textos simples (objetivos, actividades): la lista editable compartida del registro (editar, eliminar, agregar). */
function TextList({ label, singular, draftKey, items, onItemsChange }: { label: string; singular: string; draftKey: string; items: string[]; onItemsChange: ItemsUpdate }) {
  return <EditableTextList
    label={label}
    singular={singular}
    placeholder={`Agregar ${singular.toLowerCase()}`}
    draftKey={draftKey}
    items={items.map((text) => ({ text }))}
    onEditText={(index, text) => onItemsChange((current) => current.map((v, i) => i === index ? text : v))}
    onRemove={(index) => onItemsChange((current) => current.filter((_, i) => i !== index))}
    onAdd={(text) => onItemsChange((current) => [...current, text])}
  />;
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
        <EditableTextList
          label="Temas"
          singular="Tema"
          placeholder="Agregar tema"
          draftKey={CONTENT_DRAFT_KEYS.topics}
          items={value.topics.map((topic, index) => ({
            text: topic.text,
            note: topic.status === "visto" ? <><CheckCircleIcon className="h-4 w-4" aria-hidden />Visto</> : undefined,
            // Marcar un tema como visto sigue siendo posible, compacto y sin etiqueta de estado; cambiar sólo el texto nunca toca `status`.
            leading: <label className="flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center" title="Marcar como visto"><input type="checkbox" className={checkClass} aria-label={`Tema ${index + 1} visto`} checked={topic.status === "visto"} onChange={(e) => { const seen = e.target.checked; onChange((current) => ({ ...current, topics: current.topics.map((t, i) => i === index ? { ...t, status: seen ? "visto" : "planificado" } : t) })); }} /></label>,
          }))}
          onEditText={(index, text) => onChange((current) => ({ ...current, topics: current.topics.map((t, i) => i === index ? { ...t, text } : t) }))}
          onRemove={(index) => onChange((current) => ({ ...current, topics: current.topics.filter((_, i) => i !== index) }))}
          onAdd={(text) => onChange((current) => ({ ...current, topics: [...current.topics, { id: crypto.randomUUID(), text, status: "planificado" }] }))}
        />
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
