// Puerto VERBATIM del original (`src/features/calendar/utils/calendarRecurrenceDraftValidation.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PendingRecurrenceDraft } from '../types/index.ts';

export interface RecurrenceDraftValidationError {
  weekIndex: number;
  message: string;
}

/**
 * Corrección 2026-07-26 (a pedido de Joaquín — simplificar serie
 * personalizada, validaciones): pura y reutilizada tanto por
 * `RecurrenceOptions.tsx` (resaltado en rojo + scroll al campo) como por
 * los llamadores (`NewCalendarLessonSheet.tsx`, `EditFutureRecurrenceSheet.tsx`)
 * antes de construir la `RecurrenceRule` — nunca dos implementaciones del
 * mismo chequeo. No valida superposición de horarios (eso ya lo hace
 * `findCalendarConflicts` sobre las ocurrencias generadas, con la
 * duración completa) ni disponibilidad/vacaciones/bloqueos (eso ya lo
 * resuelve `isSessionAvailable` en la grilla) — sólo la forma del propio
 * borrador: al menos un horario por semana, sin dos bloques idénticos.
 */
export function validateRecurrenceDraft(
  draft: PendingRecurrenceDraft
): RecurrenceDraftValidationError[] {
  if (draft.mode === 'single') return [];

  const errors: RecurrenceDraftValidationError[] = [];

  draft.weeks.forEach((week) => {
    if (week.sessions.length === 0) {
      errors.push({
        weekIndex: week.weekIndex,
        message: 'Agregá al menos un día y horario.',
      });
      return;
    }

    const seen = new Set<string>();
    week.sessions.forEach((session) => {
      const key = `${session.weekday}-${session.hour}-${session.minute}`;
      if (seen.has(key)) {
        errors.push({
          weekIndex: week.weekIndex,
          message: 'Hay dos horarios idénticos en la misma semana.',
        });
      }
      seen.add(key);
    });
  });

  return errors;
}
