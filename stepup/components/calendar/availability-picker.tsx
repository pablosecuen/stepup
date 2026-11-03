"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { calendarSlotsAction } from "@/lib/actions/calendar-parity";
import { daySlots, type SlotItem } from "@/lib/calendar/parity";
import type { TeacherAvailability } from "@/lib/calendar/availability";
import { buildSlotIgnore, classifyDay, DAY_LOAD_TEXT, type DayLoad } from "@/lib/calendar/time-slot-picker";
import { todayInArgentina, formatCivilDate } from "@/lib/format/date-format";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { TimeSlotGrid } from "@/components/calendar/time-slot-grid";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

const DAY_CLASSES: Record<DayLoad | "out", string> = {
  wide: "border-okLine bg-okSoft",
  limited: "border-warnLine bg-warnSoft",
  none: "border-border bg-paperDeep text-textMuted",
  past: "border-border bg-paperDeep text-textMuted opacity-60",
  out: "border-border bg-paperDeep text-textMuted opacity-60",
};

const monthLabel = (month: string) => {
  const label = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const shiftMonth = (month: string, delta: number) => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export interface AvailabilityPickerProps {
  /** Selección actual (fecha civil y «HH:MM»). */
  date: string;
  time: string;
  duration: number;
  /** La clase que se mueve: no cuenta como ocupada. */
  ignoreId?: string;
  /** «Esta y las siguientes»: los tramos de la serie y la clase original, para que la propia sesión que se reemplaza no figure como ocupada. */
  series?: { recurrenceId: string; originalStartIso: string };
  /** Si se pueden elegir horarios ocupados o bloqueados (el servidor pide una confirmación explícita). Con una serie nunca. */
  selectableUnavailable?: boolean;
  /** Muestra el selector abierto, sin el botón que lo despliega. */
  inline?: boolean;
  minDate?: string;
  maxDate?: string;
  onSelect: (date: string, time: string) => void;
}

/**
 * Selector de fecha y horario libre del Calendario. Días coloreados según disponibilidad (con su leyenda y la cantidad de horarios libres escrita), grilla de horarios de 30 minutos con
 * el :15/:45 por pulsación prolongada, doble toque o botón visible (`TimeSlotGrid`), ocupados y bloqueos en gris con su causa, evaluando la DURACIÓN completa de la clase. Mantener
 * presionado un horario nunca cambia la duración. Los horarios se verifican de nuevo en el servidor al guardar.
 */
export function AvailabilityPicker({ date, time, duration, ignoreId, series, selectableUnavailable = false, inline = false, minDate, maxDate, onSelect }: AvailabilityPickerProps) {
  const [open, setOpen] = useState(inline);
  const [day, setDay] = useState(date || todayInArgentina());
  const [data, setData] = useState<{ items: SlotItem[]; availability: TeacherAvailability; lineage: string[]; todayDate: string } | null>(null);
  const [error, setError] = useState("");
  const uid = useId();
  const month = day.slice(0, 7);
  const recurrenceId = series?.recurrenceId ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    calendarSlotsAction(month, recurrenceId)
      .then((result) => {
        if (!active) return;
        if (result.error) setError(result.error);
        else if (result.items && result.availability) {
          setData({ items: result.items as SlotItem[], availability: result.availability, lineage: result.lineage ?? [], todayDate: result.todayDate ?? todayInArgentina() });
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("No pudimos cargar la disponibilidad.");
      });
    return () => {
      active = false;
    };
  }, [month, open, recurrenceId]);

  const length = Math.max(1, Math.min(480, duration || 60));
  const ignore = useMemo(
    () =>
      buildSlotIgnore({
        ignoreId,
        ...(series && data ? { series: { lineage: data.lineage.length > 0 ? data.lineage : [series.recurrenceId], fromInstant: series.originalStartIso, originalStartIso: series.originalStartIso, timeZone: TIMEZONE } } : {}),
      }),
    [ignoreId, series, data]
  );
  const today = data?.todayDate ?? todayInArgentina();
  const slots = useMemo(() => (data ? daySlots(day, length, data.items, data.availability, ignore) : []), [data, day, length, ignore]);
  const dayCount = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const firstWeekday = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
  const monthDays = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`).map((d) => {
        const outside = (!!minDate && d < minDate) || (!!maxDate && d > maxDate);
        const free = data && !outside && d >= today ? daySlots(d, length, data.items, data.availability, ignore).filter((slot) => slot.available).length : 0;
        return { d, free, outside, load: classifyDay(free, d < today) };
      }),
    [month, dayCount, data, length, ignore, today, minDate, maxDate]
  );

  const body = (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" aria-label="Mes anterior" onClick={() => setDay(`${shiftMonth(month, -1)}-01`)}>
          <ChevronLeftIcon className="h-5 w-5" aria-hidden />
        </Button>
        <p id={`${uid}-month`} role="status" aria-live="polite" className="text-[15px] font-semibold text-textPrimary">
          {monthLabel(month)}
        </p>
        <Button variant="secondary" aria-label="Mes siguiente" onClick={() => setDay(`${shiftMonth(month, 1)}-01`)}>
          <ChevronRightIcon className="h-5 w-5" aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1" role="group" aria-labelledby={`${uid}-month`}>
        {WEEKDAY_INITIALS.map((name, index) => (
          <span key={`weekday-${index}`} aria-hidden className="text-center text-xs font-semibold text-textSecondary">
            {name}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span key={`empty-${index}`} aria-hidden />
        ))}
        {monthDays.map(({ d, free, outside, load }) => {
          const disabled = outside || load === "past";
          const selected = day === d;
          const state = outside ? "fuera del rango permitido" : DAY_LOAD_TEXT[load];
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`${formatCivilDate(d)}: ${state}${!disabled ? `, ${free} horarios libres` : ""}${date === d ? ", fecha elegida" : ""}`}
              onClick={() => setDay(d)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-md border text-base leading-tight ${selected ? "border-ink bg-ink text-white" : DAY_CLASSES[outside ? "out" : load]} ${disabled ? "cursor-not-allowed" : ""}`}
            >
              <span>{Number(d.slice(-2))}</span>
              {!disabled && <span className={`text-[10.5px] ${selected ? "text-white" : "text-textSecondary"}`}>{free}</span>}
            </button>
          );
        })}
      </div>

      <ul aria-label="Referencias de colores" className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-textSecondary">
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded-sm border border-okLine bg-okSoft" />Amplia: más de 20 horarios libres</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded-sm border border-warnLine bg-warnSoft" />Limitada: pocos horarios libres</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3.5 w-3.5 rounded-sm border border-border bg-paperDeep" />Sin horarios libres, pasada o fuera de rango</li>
        <li>El número chico de cada día son sus horarios libres.</li>
      </ul>

      {error && <Notice tone="bad">{error}</Notice>}
      {!data && !error && <p role="status">Cargando disponibilidad…</p>}
      {data && (
        <>
          <p role="status" aria-live="polite" className="text-[14px] font-[650] text-textPrimary">
            {formatCivilDate(day)} · clase de {length} min
          </p>
          <TimeSlotGrid idPrefix={`${uid}-slot`} slots={slots} value={date === day ? time : null} selectableUnavailable={selectableUnavailable} onSelect={(picked) => onSelect(day, picked)} />
          <p className="text-[13px] text-textSecondary">Gris: ocupado por otra clase o bloqueado en tu disponibilidad (se ve la causa). Se mide la duración completa. Los horarios se verifican nuevamente al guardar.</p>
        </>
      )}
    </div>
  );

  if (inline) return <section className="min-w-0">{body}</section>;
  return (
    <section className="min-w-0">
      <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Ocultar horarios" : "Buscar horario libre"}
      </Button>
      {open && <div className="mt-3">{body}</div>}
    </section>
  );
}
