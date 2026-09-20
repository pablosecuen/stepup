"use client";

import type { RecurrenceWeek } from "@/lib/calendar/types";

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
    <fieldset className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-textSecondary">Duración del ciclo</legend>
        <div className="flex flex-wrap gap-2">
          {CYCLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onCycleLengthChange(option.value)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                cycleLengthWeeks === option.value ? "border-brandBlue bg-brandBlue/10 text-brandBlueDark" : "border-border text-textSecondary hover:border-brandBlue/30"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {weekCycles.map((rows, weekIndex) => (
        <div key={weekIndex} className="flex flex-col gap-2 rounded-md border border-border p-3">
          {cycleLengthWeeks > 1 && <p className="text-xs font-semibold uppercase tracking-wide text-textMuted">Semana {weekIndex + 1} del ciclo</p>}
          <div className="flex flex-col gap-2">
            {WEEKDAY_LABELS.map((label, dayIndex) => {
              const row = rows[dayIndex];
              return (
                <div key={label} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <label className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-textPrimary">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) => updateCell(weekIndex, dayIndex, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-border text-brandBlue focus:ring-brandBlue"
                    />
                    {label}
                  </label>
                  {row.enabled && (
                    <>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={row.hour}
                        onChange={(e) => updateCell(weekIndex, dayIndex, { hour: Number(e.target.value) })}
                        className="w-16 rounded-md border border-border px-2 py-1 text-sm"
                        aria-label={`Hora — semana ${weekIndex + 1}, ${label}`}
                      />
                      <span className="text-textMuted">:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={row.minute}
                        onChange={(e) => updateCell(weekIndex, dayIndex, { minute: Number(e.target.value) })}
                        className="w-16 rounded-md border border-border px-2 py-1 text-sm"
                        aria-label={`Minuto — semana ${weekIndex + 1}, ${label}`}
                      />
                      <input
                        type="number"
                        min="1"
                        value={row.durationMinutes}
                        onChange={(e) => updateCell(weekIndex, dayIndex, { durationMinutes: Number(e.target.value) })}
                        className="w-20 rounded-md border border-border px-2 py-1 text-sm"
                        aria-label={`Duración en minutos — semana ${weekIndex + 1}, ${label}`}
                      />
                      <span className="text-xs text-textMuted">min</span>
                    </>
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
