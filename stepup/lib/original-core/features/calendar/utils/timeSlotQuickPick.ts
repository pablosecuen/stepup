// Puerto VERBATIM del original (`src/features/calendar/utils/timeSlotQuickPick.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-31 (a pedido de Joaquín — horarios de 15 minutos):
 * lógica pura compartida por TODOS los selectores de horario del
 * calendario para ofrecer "hora original / hora original + 15 minutos" con
 * una pulsación prolongada o un doble toque, sin agregar esos horarios a la
 * grilla principal (que sigue en pasos de 30 minutos). Vive junto a
 * `calendarTimeSlots.ts` a propósito — sin JSX ni React — para poder
 * probarla directo desde `test:recurrence` (esa suite compila con un
 * `tsconfig` sin JSX). Una única implementación: `RescheduleTimeSlotGrid.tsx`
 * y `RecurrenceOptions.tsx` importan estas mismas funciones a través del
 * hook `useTimeSlotQuickPick`, nunca reimplementan la lógica de gestos.
 */

export interface TimeSlotOption {
  hour: number;
  minute: number;
}

export const TIME_SLOT_QUICK_PICK_STEP_MINUTES = 15;

/**
 * Ventana de tiempo, en milisegundos, para considerar que dos toques sobre
 * el MISMO horario son un doble toque. Elegida para que el toque normal siga
 * siendo instantáneo (se resuelve al toque, sin esperar) y sólo el segundo
 * toque —de existir— cambie el resultado.
 */
export const TIME_SLOT_DOUBLE_TAP_WINDOW_MS = 250;

export function formatTimeSlotLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Devuelve exactamente dos opciones: la hora tocada tal cual, y esa misma
 * hora + 15 minutos (normalizada 0-23h, por si el llamador algún día pasa un
 * minuto que no sea :00/:15/:30/:45 — hoy nunca ocurre, la grilla principal
 * siempre pasa minutos en paso de 30). Nunca redondea la hora original.
 */
export function buildQuickPickOptions(hour: number, minute: number): [TimeSlotOption, TimeSlotOption] {
  const bumpedTotalMinutes = hour * 60 + minute + TIME_SLOT_QUICK_PICK_STEP_MINUTES;
  return [
    { hour, minute },
    { hour: Math.floor(bumpedTotalMinutes / 60) % 24, minute: bumpedTotalMinutes % 60 },
  ];
}

export interface TapTrackerState {
  lastSlot: TimeSlotOption | null;
  lastTapAt: number | null;
}

export const INITIAL_TAP_TRACKER_STATE: TapTrackerState = { lastSlot: null, lastTapAt: null };

export type TapDecision =
  | { kind: 'select'; state: TapTrackerState }
  | { kind: 'open_quick_pick'; state: TapTrackerState };

/**
 * Motor puro de decisión toque-normal vs. doble-toque, sin timers ni
 * gesture-handler — el llamador (el hook `useTimeSlotQuickPick`) inyecta
 * `now` (`Date.now()`) y persiste `state` entre llamadas en un ref. Un
 * segundo toque sobre EL MISMO horario dentro de la ventana abre el
 * selector rápido en vez de disparar una segunda selección normal — por
 * eso el toque normal (primer toque, o un toque fuera de ventana/sobre otro
 * horario) siempre se resuelve al instante, sin esperar a ver si llega un
 * segundo toque.
 */
export function decideTapAction(
  tracker: TapTrackerState,
  slot: TimeSlotOption,
  now: number,
  windowMs: number = TIME_SLOT_DOUBLE_TAP_WINDOW_MS
): TapDecision {
  const isSameSlot =
    tracker.lastSlot !== null && tracker.lastSlot.hour === slot.hour && tracker.lastSlot.minute === slot.minute;
  const withinWindow = tracker.lastTapAt !== null && now - tracker.lastTapAt <= windowMs;
  if (isSameSlot && withinWindow) {
    return { kind: 'open_quick_pick', state: INITIAL_TAP_TRACKER_STATE };
  }
  return { kind: 'select', state: { lastSlot: slot, lastTapAt: now } };
}
