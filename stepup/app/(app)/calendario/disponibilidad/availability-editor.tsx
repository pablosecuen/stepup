"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAvailabilityAction } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AVAILABILITY_EMPTY_CLASS, AVAILABILITY_FORM_GRID, AVAILABILITY_ROW_CLASS } from "@/components/calendar/availability-layout";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import type { AvailabilityBlockReason, AvailabilityException, AvailabilityExceptionReason, TeacherAvailability, WeeklyAvailabilityBlock } from "@/lib/calendar/availability";
import { formatCivilDate } from "@/lib/format/date-format";

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const BLOCK_REASON_LABEL: Record<AvailabilityBlockReason, string> = { work: "Trabajo", study: "Estudio", personal: "Personal", other: "Otro" };
const EXCEPTION_REASON_LABEL: Record<AvailabilityExceptionReason, string> = { vacation: "Vacaciones", holiday: "Feriado", leave: "Licencia", other: "Otro" };

function randomId(): string {
  return `avail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Campos de un formulario de esta pantalla: se reparten solos según el ancho (cada uno de al menos 170 px y nunca más ancho que
 * la tarjeta), de modo que en escritorio entran en una fila, en anchos medios en dos o tres y en móvil en una columna, sin
 * desbordes ni campos comprimidos. El botón de enviar es la última celda.
 */
const FORM_GRID = AVAILABILITY_FORM_GRID;

/**
 * Estado vacío de una lista: un bloque compacto alineado a la izquierda (como máximo ~540 px en escritorio) que en móvil ocupa el
 * ancho disponible. Sólo afecta al estado vacío: las filas reales de la lista usan todo el ancho que necesitan.
 */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return <li className={AVAILABILITY_EMPTY_CLASS}>{children}</li>;
}

/** Una fila de la lista (bloqueo o excepción) con «Quitar» (texto rojo, al otro extremo). */
function ListRow({ children, onRemove, disabled }: { children: React.ReactNode; onRemove: () => void; disabled: boolean }) {
  return (
    <li className={AVAILABILITY_ROW_CLASS}>
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
          {availability.weeklyBlocks.length === 0 && <EmptyNote>Sin bloqueos semanales todavía.</EmptyNote>}
        </ul>

        <form action={addWeeklyBlock} className={FORM_GRID}>
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
          <Button type="submit" variant="secondary" busy={pending} className="w-full">
            Agregar bloqueo
          </Button>
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
          {availability.exceptions.length === 0 && <EmptyNote>Sin excepciones todavía.</EmptyNote>}
        </ul>

        <form action={addException} className={FORM_GRID}>
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
          <Button type="submit" variant="secondary" busy={pending} className="w-full">
            Agregar excepción
          </Button>
        </form>
      </Card>
    </div>
  );
}
