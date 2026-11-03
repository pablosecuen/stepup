"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { decideTapAction, INITIAL_TAP_TRACKER_STATE, type TapTrackerState } from "@/lib/original-core/features/calendar/utils/timeSlotQuickPick";
import { ALL_QUARTER_TIMES, isPrimarySlotTime, PRIMARY_SLOT_TIMES, primaryTimeFor, quickPickTimes } from "@/lib/calendar/time-slot-picker";

export interface TimeSlotState {
  time: string;
  available: boolean;
  occupied: string[];
  blocked: string | null;
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/** «Libre», «Ocupado por Ana» o «Bloqueado: Trabajo»: el estado siempre va escrito, nunca sólo en color. */
export function slotStatusText(slot: TimeSlotState | undefined): string {
  if (!slot) return "Libre";
  if (slot.available) return "Libre";
  if (slot.occupied.length > 0) return `Ocupado por ${slot.occupied.join(", ")}`;
  return `Bloqueado${slot.blocked ? `: ${slot.blocked}` : ""}`;
}

/**
 * Grilla de horarios de inicio, como la de la app original (`RescheduleTimeSlotGrid` + `useTimeSlotQuickPick`): pasos de 30 minutos; MANTENER PRESIONADO o tocar dos veces rápido el mismo
 * horario ofrece ese inicio y el inicio + 15 minutos (:15/:45). Elegir un horario nunca cambia la duración de la clase ni se selecciona al soltar después de mantener presionado.
 * Como mantener presionado no existe con teclado, el botón «Mostrar :15 y :45» (y la tecla Menú / Mayús+F10 sobre un horario) muestra los cuartos de hora sin gesto.
 * Los ocupados y bloqueados se ven en gris con su causa escrita; `selectableUnavailable` decide si se pueden elegir (el servidor vuelve a validar y pide confirmación explícita).
 */
export function TimeSlotGrid({ slots, value, onSelect, selectableUnavailable = false, idPrefix }: { slots: TimeSlotState[]; value: string | null; onSelect: (time: string) => void; selectableUnavailable?: boolean; idPrefix: string }) {
  const [showQuarters, setShowQuarters] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const tracker = useRef<TapTrackerState>(INITIAL_TAP_TRACKER_STATE);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({ timer: null, x: 0, y: 0, fired: false });
  const byTime = useMemo(() => new Map(slots.map((slot) => [slot.time, slot])), [slots]);
  const times = showQuarters ? ALL_QUARTER_TIMES : PRIMARY_SLOT_TIMES;

  useEffect(() => () => { if (press.current.timer) clearTimeout(press.current.timer); }, []);

  const canPick = (time: string) => selectableUnavailable || (byTime.get(time)?.available ?? false);
  const clearTimer = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  const openQuickPick = (time: string) => {
    tracker.current = INITIAL_TAP_TRACKER_STATE;
    setAnchor(isPrimarySlotTime(time) ? time : primaryTimeFor(time));
  };
  const choose = (time: string) => {
    if (!canPick(time)) return;
    setAnchor(null);
    onSelect(time);
  };

  const quick = anchor ? quickPickTimes(anchor) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-textSecondary">Tocá un horario para elegirlo. Mantené presionado (o tocá dos veces) para ver el :15 siguiente.</p>
        <Button variant="secondary" aria-pressed={showQuarters} onClick={() => { setShowQuarters((value) => !value); setAnchor(null); }}>
          {showQuarters ? "Ocultar :15 y :45" : "Mostrar :15 y :45"}
        </Button>
      </div>

      {quick && (
        <div role="group" aria-label={`Alternativas desde las ${anchor}`} className="flex flex-wrap items-center gap-2 rounded-md border-[1.5px] border-accentLine bg-accentSoft p-2.5">
          <span className="text-[14px] font-[650] text-textPrimary">Alternativas desde las {anchor}:</span>
          {quick.map((time) => (
            <Button key={time} variant={value === time ? "primary" : "secondary"} disabled={!canPick(time)} aria-label={`${time}, ${slotStatusText(byTime.get(time))}`} onClick={() => choose(time)}>
              {time}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setAnchor(null)}>
            Cerrar
          </Button>
        </div>
      )}

      <div role="group" aria-label="Horarios de inicio" className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto min-[420px]:grid-cols-4">
        {times.map((time) => {
          const slot = byTime.get(time);
          const selected = value === time;
          const free = slot?.available ?? false;
          const pickable = canPick(time);
          const status = slotStatusText(slot);
          return (
            <button
              key={time}
              id={`${idPrefix}-${time.replace(":", "")}`}
              type="button"
              aria-pressed={selected}
              aria-disabled={!pickable}
              aria-label={`${time}, ${status}${selected ? ", elegido" : ""}`}
              aria-keyshortcuts="Shift+F10"
              title={status}
              onPointerDown={(event) => {
                press.current.fired = false;
                press.current.x = event.clientX;
                press.current.y = event.clientY;
                clearTimer();
                press.current.timer = setTimeout(() => {
                  press.current.fired = true;
                  openQuickPick(time);
                }, LONG_PRESS_MS);
              }}
              onPointerMove={(event) => {
                if (press.current.timer && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > MOVE_TOLERANCE_PX) clearTimer();
              }}
              onPointerUp={clearTimer}
              onPointerCancel={clearTimer}
              onPointerLeave={clearTimer}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                  event.preventDefault();
                  openQuickPick(time);
                }
              }}
              onClick={() => {
                // Soltar después de mantener presionado nunca selecciona.
                if (press.current.fired) {
                  press.current.fired = false;
                  return;
                }
                const decision = decideTapAction(tracker.current, { hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) }, Date.now());
                tracker.current = decision.state;
                if (decision.kind === "open_quick_pick") {
                  openQuickPick(time);
                  return;
                }
                choose(time);
              }}
              className={`min-h-12 touch-manipulation select-none rounded-md border px-1 text-base [-webkit-touch-callout:none] ${
                selected ? "border-ink bg-ink text-white" : free ? "border-borderStrong bg-surface" : "border-border bg-paperDeep text-textMuted"
              } ${pickable ? "" : "cursor-not-allowed"}`}
            >
              <span className="flex items-center justify-center gap-1">
                {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                {time}
              </span>
              <span className="block truncate text-xs">{selected ? "Elegido" : free ? "Libre" : slot && slot.occupied.length > 0 ? "Ocupado" : "Bloqueado"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
