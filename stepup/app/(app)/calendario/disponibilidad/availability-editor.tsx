"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAvailabilityAction } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import type { AvailabilityBlockReason, AvailabilityException, AvailabilityExceptionReason, TeacherAvailability, WeeklyAvailabilityBlock } from "@/lib/calendar/availability";
import { formatCivilDate } from "@/lib/format/date-format";

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const BLOCK_REASON_LABEL: Record<AvailabilityBlockReason, string> = { work: "Trabajo", study: "Estudio", personal: "Personal", other: "Otro" };
const EXCEPTION_REASON_LABEL: Record<AvailabilityExceptionReason, string> = { vacation: "Vacaciones", holiday: "Feriado", leave: "Licencia", other: "Otro" };

function randomId(): string {
  return `avail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Una fila de la lista (bloqueo o excepción) con «Quitar» (texto rojo, al otro extremo). */
function ListRow({ children, onRemove, disabled }: { children: React.ReactNode; onRemove: () => void; disabled: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border-[1.5px] border-border bg-surface2 py-1 pl-3.5 pr-1.5 text-[15px] text-textPrimary">
      <span className="min-w-0 py-1.5 [overflow-wrap:anywhere]">{children}</span>
      <Button variant="dangerGhost" onClick={onRemove} disabled={disabled}>
        Quitar
      </Button>
    </li>
  );
}

export function AvailabilityEditor({ initial }: { initial: TeacherAvailability }) {
  const router = useRouter();
  const [availability, setAvailability] = useState<TeacherAvailability>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function persist(next: TeacherAvailability) {
    setAvailability(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await guardNetwork(() => saveAvailabilityAction(next));
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function addWeeklyBlock(formData: FormData) {
    const weekday = Number(formData.get("weekday"));
    const startTime = String(formData.get("startTime") ?? "");
    const endTime = String(formData.get("endTime") ?? "");
    const reason = String(formData.get("reason") ?? "other") as AvailabilityBlockReason;
    if (!startTime || !endTime || startTime >= endTime) {
      setError("El horario de fin debe ser posterior al de inicio.");
      return;
    }
    const block: WeeklyAvailabilityBlock = { id: randomId(), weekday: weekday as WeeklyAvailabilityBlock["weekday"], startTime, endTime, reason };
    persist({ ...availability, weeklyBlocks: [...availability.weeklyBlocks, block] });
  }

  function removeWeeklyBlock(id: string) {
    persist({ ...availability, weeklyBlocks: availability.weeklyBlocks.filter((b) => b.id !== id) });
  }

  function addException(formData: FormData) {
    const date = String(formData.get("date") ?? "");
    const endDate = String(formData.get("endDate") ?? "").trim() || undefined;
    const reason = String(formData.get("reason") ?? "other") as AvailabilityExceptionReason;
    if (!date) {
      setError("Elegí una fecha.");
      return;
    }
    const exception: AvailabilityException = { id: randomId(), date, endDate, type: "unavailable_full_day", reason };
    persist({ ...availability, exceptions: [...availability.exceptions, exception] });
  }

  function removeException(id: string) {
    persist({ ...availability, exceptions: availability.exceptions.filter((e) => e.id !== id) });
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <FormErrorBox message={error} />}
      {saved && !error && <FormInfoBox>Guardado.</FormInfoBox>}

      <Card>
        <h2 className="font-display text-card font-semibold">Bloqueos semanales</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {availability.weeklyBlocks.map((block) => (
            <ListRow key={block.id} onRemove={() => removeWeeklyBlock(block.id)} disabled={pending}>
              {WEEKDAY_LABELS[block.weekday]} {block.startTime}–{block.endTime} · {BLOCK_REASON_LABEL[block.reason]}
            </ListRow>
          ))}
          {availability.weeklyBlocks.length === 0 && <li className="rounded-md border-2 border-dashed border-borderMid px-4 py-3.5 text-[14.5px] text-textMuted">Sin bloqueos semanales todavía.</li>}
        </ul>

        <form action={addWeeklyBlock} className="mt-4 grid grid-cols-1 gap-3.5 border-t-[1.5px] border-border pt-4 sm:grid-cols-2 nav:grid-cols-4">
          <Field label="Día" htmlFor="weekday">
            <SelectInput id="weekday" name="weekday" aria-label="Día de la semana" defaultValue="0">
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Desde" htmlFor="block-start">
            <TextInput id="block-start" type="time" name="startTime" required />
          </Field>
          <Field label="Hasta" htmlFor="block-end">
            <TextInput id="block-end" type="time" name="endTime" required />
          </Field>
          <Field label="Motivo" htmlFor="block-reason">
            <SelectInput id="block-reason" name="reason" aria-label="Motivo del bloqueo" defaultValue="work">
              {Object.entries(BLOCK_REASON_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="sm:col-span-2 nav:col-span-4">
            <Button type="submit" variant="secondary" busy={pending}>
              Agregar bloqueo
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="font-display text-card font-semibold">Excepciones (vacaciones, feriados)</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {availability.exceptions.map((exception) => (
            <ListRow key={exception.id} onRemove={() => removeException(exception.id)} disabled={pending}>
              {formatCivilDate(exception.date)}
              {exception.endDate ? ` – ${formatCivilDate(exception.endDate)}` : ""} · {EXCEPTION_REASON_LABEL[exception.reason]}
            </ListRow>
          ))}
          {availability.exceptions.length === 0 && <li className="rounded-md border-2 border-dashed border-borderMid px-4 py-3.5 text-[14.5px] text-textMuted">Sin excepciones todavía.</li>}
        </ul>

        <form action={addException} className="mt-4 grid grid-cols-1 gap-3.5 border-t-[1.5px] border-border pt-4 sm:grid-cols-3">
          <Field label="Desde" htmlFor="exception-start">
            <TextInput id="exception-start" type="date" name="date" required />
          </Field>
          <Field label="Hasta (opcional)" htmlFor="exception-end">
            <TextInput id="exception-end" type="date" name="endDate" />
          </Field>
          <Field label="Motivo" htmlFor="exception-reason">
            <SelectInput id="exception-reason" name="reason" aria-label="Motivo de la excepción" defaultValue="vacation">
              {Object.entries(EXCEPTION_REASON_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" busy={pending}>
              Agregar excepción
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
