"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAvailabilityAction } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import type { AvailabilityBlockReason, AvailabilityException, AvailabilityExceptionReason, TeacherAvailability, WeeklyAvailabilityBlock } from "@/lib/calendar/availability";

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const BLOCK_REASON_LABEL: Record<AvailabilityBlockReason, string> = { work: "Trabajo", study: "Estudio", personal: "Personal", other: "Otro" };
const EXCEPTION_REASON_LABEL: Record<AvailabilityExceptionReason, string> = { vacation: "Vacaciones", holiday: "Feriado", leave: "Licencia", other: "Otro" };

function randomId(): string {
  return `avail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    <div className="flex flex-col gap-6">
      {error && <FormErrorBox message={error} />}
      {saved && !error && <FormInfoBox>Guardado.</FormInfoBox>}

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Bloqueos semanales</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {availability.weeklyBlocks.map((block) => (
            <li key={block.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span>
                {WEEKDAY_LABELS[block.weekday]} {block.startTime}–{block.endTime} · {BLOCK_REASON_LABEL[block.reason]}
              </span>
              <button type="button" onClick={() => removeWeeklyBlock(block.id)} disabled={pending} className="text-xs font-semibold text-statusRojo hover:underline disabled:opacity-50">
                Quitar
              </button>
            </li>
          ))}
          {availability.weeklyBlocks.length === 0 && <p className="text-xs text-textMuted">Sin bloqueos semanales todavía.</p>}
        </ul>

        <form action={addWeeklyBlock} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Día</label>
            <select name="weekday" defaultValue="0" className="rounded-md border border-border px-2 py-1.5 text-sm">
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Desde</label>
            <input type="time" name="startTime" required className="rounded-md border border-border px-2 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Hasta</label>
            <input type="time" name="endTime" required className="rounded-md border border-border px-2 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Motivo</label>
            <select name="reason" defaultValue="work" className="rounded-md border border-border px-2 py-1.5 text-sm">
              {Object.entries(BLOCK_REASON_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={pending} className="rounded-md bg-brandBlue px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
            Agregar
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-textPrimary">Excepciones (vacaciones, feriados)</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {availability.exceptions.map((exception) => (
            <li key={exception.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span>
                {exception.date}
                {exception.endDate ? ` – ${exception.endDate}` : ""} · {EXCEPTION_REASON_LABEL[exception.reason]}
              </span>
              <button type="button" onClick={() => removeException(exception.id)} disabled={pending} className="text-xs font-semibold text-statusRojo hover:underline disabled:opacity-50">
                Quitar
              </button>
            </li>
          ))}
          {availability.exceptions.length === 0 && <p className="text-xs text-textMuted">Sin excepciones todavía.</p>}
        </ul>

        <form action={addException} className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Desde</label>
            <input type="date" name="date" required className="rounded-md border border-border px-2 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Hasta (opcional)</label>
            <input type="date" name="endDate" className="rounded-md border border-border px-2 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-textSecondary">Motivo</label>
            <select name="reason" defaultValue="vacation" className="rounded-md border border-border px-2 py-1.5 text-sm">
              {Object.entries(EXCEPTION_REASON_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={pending} className="rounded-md bg-brandBlue px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
            Agregar
          </button>
        </form>
      </section>
    </div>
  );
}
