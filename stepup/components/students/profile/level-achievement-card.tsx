"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordLevelAchievementAction } from "@/lib/actions/level-achievement";
import { guardNetwork } from "@/lib/actions/network-guard";
import { ACHIEVEMENT_LEVELS, levelAchievementPreview } from "@/lib/students/level-achievement";
import type { LevelHistoryRecord } from "@/lib/repositories/student-history-mapping";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput, TextArea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatCivilDate } from "@/lib/format/date-format";

export function LevelAchievementCard({ studentId, levels, history, dateJoined, today }: { studentId: string; levels: string[]; history: LevelHistoryRecord[]; dateJoined: string; today: string }) {
  const [open, setOpen] = useState(false);
  return <Card>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-card font-semibold">Logros de nivel</h2>
      <Button variant="secondary" onClick={() => setOpen(true)}>Registrar cambio de nivel</Button>
    </div>
    {history.length === 0 ? <p className="mt-3 text-textMuted">Todavía no hay logros registrados.</p> : <ul className="mt-3 divide-y divide-border">{history.map((entry) => <li key={entry.id} className="py-3 text-textSecondary">
      <p><strong>{entry.fromLevel ? `${entry.fromLevel} → ` : ""}{entry.level}</strong> · {formatCivilDate(entry.achievedOn)}</p>
      {entry.durationDays != null && <p className="text-sm">{entry.durationDays} días desde el hito anterior</p>}
      {entry.note && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{entry.note}</p>}
    </li>)}</ul>}
    {open && <AchievementDialog studentId={studentId} levels={levels} history={history} dateJoined={dateJoined} today={today} onClose={() => setOpen(false)} />}
  </Card>;
}

function AchievementDialog({ studentId, levels, history, dateJoined, today, onClose }: { studentId: string; levels: string[]; history: LevelHistoryRecord[]; dateJoined: string; today: string; onClose: () => void }) {
  const router = useRouter();
  const [operationId] = useState(() => crypto.randomUUID());
  const [level, setLevel] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const preview = levelAchievementPreview({ levels, history, dateJoined, level, date, today });
  function save() {
    if (preview.error) { setError(preview.error); return; }
    if (preview.warning && !confirmed) { setError("Confirmá el cambio de nivel antes de guardar."); return; }
    startTransition(async () => {
      const result = await guardNetwork(() => recordLevelAchievementAction({ studentId, operationId, level, date, note, confirmWarning: confirmed, expectedLevel: preview.fromLevel ?? "" }));
      if (result.error) { setError(result.error); return; }
      onClose(); router.refresh();
    });
  }
  return <Dialog title="Registrar cambio de nivel" size="md" busy={pending} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!pending) save(); }} className="flex flex-col gap-4">
      <Field label="Nuevo nivel" htmlFor="achievement-level"><select id="achievement-level" value={level} onChange={(event) => { setLevel(event.target.value); setConfirmed(false); setError(undefined); }} className="min-h-12 w-full rounded-lg border border-borderMid bg-surface px-3 text-base" required><option value="">Elegí un nivel</option>{ACHIEVEMENT_LEVELS.map((entry) => <option key={entry}>{entry}</option>)}</select></Field>
      <Field label="Fecha real del logro" htmlFor="achievement-date"><TextInput id="achievement-date" type="date" value={date} max={today} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} required /></Field>
      <Field label="Nota (opcional)" htmlFor="achievement-note"><TextArea id="achievement-note" value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} /></Field>
      {!preview.error && preview.durationDays != null && <p className="text-textSecondary">Tiempo desde el hito anterior: {preview.durationDays} días.</p>}
      {preview.warning && <Notice tone="info"><label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />{preview.warning}</label></Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={pending} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar logro"}</Button></div>
    </form>
  </Dialog>;
}
