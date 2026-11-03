/**
 * Selector rápido de horarios de 15 minutos — puerto de la app móvil (`timeSlotQuickPick.ts` + `calendarTimeSlots.ts`, última versión), misma lógica y mismos valores: la grilla principal va en
 * pasos de 30 minutos (08:00–21:30); mantener presionado o tocar dos veces el MISMO horario dentro de 250 ms ofrece ese inicio y el inicio + 15 minutos. Hay una prueba diferencial contra
 * la copia de referencia del original. PURO.
 */
export interface TimeSlotOption {
  hour: number;
  minute: number;
}

export const TIME_SLOT_START_HOUR = 8;
export const TIME_SLOT_END_HOUR = 22;
export const TIME_SLOT_QUICK_PICK_STEP_MINUTES = 15;
export const TIME_SLOT_DOUBLE_TAP_WINDOW_MS = 250;

export const formatTimeSlotLabel = (hour: number, minute: number): string => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

export function buildTimeSlots(): TimeSlotOption[] {
  return Array.from({ length: (TIME_SLOT_END_HOUR - TIME_SLOT_START_HOUR) * 2 }, (_, index) => {
    const total = TIME_SLOT_START_HOUR * 60 + index * 30;
    return { hour: Math.floor(total / 60), minute: total % 60 };
  });
}

/** El horario tocado tal cual y ese mismo + 15 minutos (nunca redondea el original). */
export function buildQuickPickOptions(hour: number, minute: number): [TimeSlotOption, TimeSlotOption] {
  const bumped = hour * 60 + minute + TIME_SLOT_QUICK_PICK_STEP_MINUTES;
  return [{ hour, minute }, { hour: Math.floor(bumped / 60) % 24, minute: bumped % 60 }];
}

export interface TapTrackerState {
  lastSlot: TimeSlotOption | null;
  lastTapAt: number | null;
}

export const INITIAL_TAP_TRACKER_STATE: TapTrackerState = { lastSlot: null, lastTapAt: null };

export type TapDecision = { kind: "select"; state: TapTrackerState } | { kind: "open_quick_pick"; state: TapTrackerState };

/** Toque normal (se resuelve al instante) o segundo toque sobre el mismo horario dentro de la ventana (abre el selector rápido). */
export function decideTapAction(tracker: TapTrackerState, slot: TimeSlotOption, now: number, windowMs: number = TIME_SLOT_DOUBLE_TAP_WINDOW_MS): TapDecision {
  const sameSlot = tracker.lastSlot !== null && tracker.lastSlot.hour === slot.hour && tracker.lastSlot.minute === slot.minute;
  const withinWindow = tracker.lastTapAt !== null && now - tracker.lastTapAt <= windowMs;
  if (sameSlot && withinWindow) return { kind: "open_quick_pick", state: INITIAL_TAP_TRACKER_STATE };
  return { kind: "select", state: { lastSlot: slot, lastTapAt: now } };
}
