"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import type { PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";

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

export function PedagogicalContentEditor({ value, onChange }: { value: PedagogicalContentInput; onChange: (content: PedagogicalContentInput) => void }) {
  const id = useId();
  const [topicDraft, setTopicDraft] = useState("");
  function addTopic() {
    if (!topicDraft.trim()) return;
    onChange({ ...value, topics: [...value.topics, { id: crypto.randomUUID(), text: topicDraft.trim(), status: "planificado" }] });
    setTopicDraft("");
  }
  return <section aria-labelledby={`${id}-title`}>
    <Card padded={false}>
      <CardHeader title={<span id={`${id}-title`}>Contenido pedagógico</span>} />
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
        <Field label="Observación interna (privada)" htmlFor={`${id}-internal`} hint="Solo la ve la profesora; no se incluye en reportes."><TextArea id={`${id}-internal`} rows={3} value={value.internalNotes} onChange={(e) => onChange({ ...value, internalNotes: e.target.value })} /></Field>
      </div>
    </Card>
  </section>;
}
