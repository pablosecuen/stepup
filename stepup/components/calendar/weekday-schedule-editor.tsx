"use client";

import { CheckIcon } from "@heroicons/react/24/outline";
import type { RecurrenceWeek } from "@/lib/calendar/types";
import { TextInput, checkClass } from "@/components/ui/field";

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export interface WeekdayRow {
  enabled: boolean;
  hour: number;
  minute: number;
  durationMinutes: number;
}

/** Un ciclo completo = 1 a 4 `WeekRows`, cada una con sus 7 días (móvil: `RecurrenceWeek[]`, cap de 4 semanas). */
export type WeekRows = WeekdayRow[];

function emptyWeekRows(): WeekRows {
  return Array.from({ length: 7 }, () => ({ enabled: false, hour: 18, minute: 0, durationMinutes: 60 }));
}

function weekRowsFromRecurrenceWeek(week?: RecurrenceWeek): WeekRows {
  const base = emptyWeekRows();
  week?.sessions.forEach((session) => {
    base[session.weekday] = { enabled: true, hour: session.hour, minute: session.minute, durationMinutes: session.durationMinutes };
  });
  return base;
}

export function defaultWeekCycles(cycleLengthWeeks: number, fromWeeks?: RecurrenceWeek[]): WeekRows[] {
  return Array.from({ length: cycleLengthWeeks }, (_, weekIndex) => weekRowsFromRecurrenceWeek(fromWeeks?.find((w) => w.weekIndex === weekIndex)));
}

/** Cambiar la duración del ciclo conserva las semanas que ya existían y agrega/recorta el resto vacío — nunca pierde lo ya cargado. */
export function resizeWeekCycles(current: WeekRows[], newLength: number): WeekRows[] {
  if (newLength === current.length) return current;
  if (newLength < current.length) return current.slice(0, newLength);
  return [...current, ...Array.from({ length: newLength - current.length }, () => emptyWeekRows())];
}

export function weekCyclesToWeeksJson(weekCycles: WeekRows[]): string {
  const weeks: RecurrenceWeek[] = weekCycles.map((rows, weekIndex) => ({
    weekIndex,
    sessions: rows
      .map((row, weekday) => ({ ...row, weekday }))
      .filter((row) => row.enabled)
      .map((row) => ({ weekday: row.weekday, hour: row.hour, minute: row.minute, durationMinutes: row.durationMinutes })),
  }));
  return JSON.stringify(weeks);
}

const CYCLE_OPTIONS: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: "Todas las semanas iguales" },
  { value: 2, label: "Ciclo de 2 semanas" },
  { value: 3, label: "Ciclo de 3 semanas" },
  { value: 4, label: "Ciclo de 4 semanas" },
];

/**
 * Editor compartido "días y horarios de la semana" — usado tanto por "Nueva
 * clase" (serie) como por "Editar futuras" (split esta y las siguientes).
 * Ciclo de 1-4 semanas, cada semana con su propio día/horario — mismo tope y
 * mismo algoritmo que el móvil (`RecurrenceWeek[]`, `cycleLengthWeeks`), el
 * motor y la base ya lo soportaban desde Fase 3; esto conecta la interfaz.
 */
export function WeekdayScheduleEditor({
  cycleLengthWeeks,
  onCycleLengthChange,
  weekCycles,
  onChange,
}: {
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  onCycleLengthChange: (weeks: 1 | 2 | 3 | 4) => void;
  weekCycles: WeekRows[];
  onChange: (weekCycles: WeekRows[]) => void;
}) {
  function updateCell(weekIndex: number, dayIndex: number, patch: Partial<WeekdayRow>) {
    onChange(weekCycles.map((week, wi) => (wi === weekIndex ? week.map((row, di) => (di === dayIndex ? { ...row, ...patch } : row)) : week)));
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <legend className="text-sm font-[650] text-textSecondary">Duración del ciclo</legend>
        <div className="flex flex-wrap gap-2">
          {CYCLE_OPTIONS.map((option) => {
            const selected = cycleLengthWeeks === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onCycleLengthChange(option.value)}
                aria-pressed={cycleLengthWeeks === option.value}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-150 ${
                  selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
                }`}
              >
                {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {weekCycles.map((rows, weekIndex) => (
        <div key={weekIndex} className="flex flex-col gap-2 rounded-lg border-[1.5px] border-border bg-surface2 p-2.5">
          {cycleLengthWeeks > 1 && <p className="px-1.5 pt-1 text-label font-bold uppercase text-textMuted">Semana {weekIndex + 1} del ciclo</p>}
          <div className="flex flex-col gap-1.5">
            {WEEKDAY_LABELS.map((label, dayIndex) => {
              const row = rows[dayIndex];
              return (
                <div key={label} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border-[1.5px] bg-surface px-2 py-1 ${row.enabled ? "border-borderMid" : "border-border"}`}>
                  <label className="flex min-h-11 w-36 shrink-0 cursor-pointer items-center gap-3 px-1 text-[15px] font-[650] text-textPrimary">
                    <input type="checkbox" checked={row.enabled} onChange={(e) => updateCell(weekIndex, dayIndex, { enabled: e.target.checked })} className={checkClass} />
                    {label}
                  </label>
                  {row.enabled && (
                    <div className="flex flex-wrap items-center gap-2 pb-1 sm:pb-0">
                      <TextInput
                        type="number"
                        min="0"
                        max="23"
                        value={row.hour}
                        onChange={(e) => updateCell(weekIndex, dayIndex, { hour: Number(e.target.value) })}
                        className="!w-[72px] px-2.5"
                        aria-label={`Hora — semana ${weekIndex + 1}, ${label}`}
                      />
                      <span aria-hidden className="text-textMuted">:</span>
                      <TextInput
                        type="number"
                        min="0"
                        max="59"
                        value={row.minute}
                        onChange={(e) => updateCell(weekIndex, dayIndex, { minute: Number(e.target.value) })}
                        className="!w-[72px] px-2.5"
                        aria-label={`Minuto — semana ${weekIndex + 1}, ${label}`}
                      />
                      <TextInput
                        type="number"
                        min="1"
                        value={row.durationMinutes}
                        onChange={(e) => updateCell(weekIndex, dayIndex, { durationMinutes: Number(e.target.value) })}
                        className="!w-[84px] px-2.5"
                        aria-label={`Duración en minutos — semana ${weekIndex + 1}, ${label}`}
                      />
                      <span className="text-[13px] text-textMuted">min</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
