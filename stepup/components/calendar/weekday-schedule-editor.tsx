"use client";

import type { RecurrenceWeek } from "@/lib/calendar/types";

const WEEKDAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export interface WeekdayRow {
  enabled: boolean;
  hour: number;
  minute: number;
  durationMinutes: number;
}

export function defaultWeekdayRows(fromWeeks?: RecurrenceWeek[]): WeekdayRow[] {
  const base: WeekdayRow[] = Array.from({ length: 7 }, () => ({ enabled: false, hour: 18, minute: 0, durationMinutes: 60 }));
  const week0 = fromWeeks?.find((w) => w.weekIndex === 0);
  week0?.sessions.forEach((session) => {
    base[session.weekday] = { enabled: true, hour: session.hour, minute: session.minute, durationMinutes: session.durationMinutes };
  });
  return base;
}

export function weekdayRowsToWeeksJson(rows: WeekdayRow[]): string {
  const weeks: RecurrenceWeek[] = [
    {
      weekIndex: 0,
      sessions: rows
        .map((row, weekday) => ({ ...row, weekday }))
        .filter((row) => row.enabled)
        .map((row) => ({ weekday: row.weekday, hour: row.hour, minute: row.minute, durationMinutes: row.durationMinutes })),
    },
  ];
  return JSON.stringify(weeks);
}

/**
 * Editor compartido "días y horarios de la semana" — usado tanto por
 * "Nueva clase" (serie) como por "Editar futuras" (split esta y las
 * siguientes). Ciclos de 2-4 semanas quedan fuera de esta fase (documentado
 * explícitamente, nunca simulado) — el motor y la base ya lo soportan.
 */
export function WeekdayScheduleEditor({ rows, onChange }: { rows: WeekdayRow[]; onChange: (rows: WeekdayRow[]) => void }) {
  function update(index: number, patch: Partial<WeekdayRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-textSecondary">Días y horarios de la semana *</legend>
      <div className="flex flex-col gap-2">
        {WEEKDAY_LABELS.map((label, index) => {
          const row = rows[index];
          return (
            <div key={label} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <label className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-textPrimary">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
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
                    onChange={(e) => update(index, { hour: Number(e.target.value) })}
                    className="w-16 rounded-md border border-border px-2 py-1 text-sm"
                    aria-label={`Hora — ${label}`}
                  />
                  <span className="text-textMuted">:</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={row.minute}
                    onChange={(e) => update(index, { minute: Number(e.target.value) })}
                    className="w-16 rounded-md border border-border px-2 py-1 text-sm"
                    aria-label={`Minuto — ${label}`}
                  />
                  <input
                    type="number"
                    min="1"
                    value={row.durationMinutes}
                    onChange={(e) => update(index, { durationMinutes: Number(e.target.value) })}
                    className="w-20 rounded-md border border-border px-2 py-1 text-sm"
                    aria-label={`Duración en minutos — ${label}`}
                  />
                  <span className="text-xs text-textMuted">min</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
