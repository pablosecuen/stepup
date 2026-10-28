// Puerto VERBATIM del original (`src/features/calendar/utils/scheduleAdjustment.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../types/index.ts';
import type { TeacherAvailability } from '../types/teacherAvailability.ts';
import type {
  ScheduleAdjustment,
  ScheduleAdjustmentDirection,
  ScheduleAdjustmentMinutes,
  ScheduleAdjustmentReason,
} from '../../new-class/types/index.ts';
import { findCalendarConflicts } from './calendarConflicts.ts';
import { evaluateAvailability } from './teacherAvailabilityEngine.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): "Ajustar horario" atrasa o adelanta ÚNICAMENTE la
 * ocurrencia elegida, nunca la serie completa. Pura — recibe siempre las
 * otras clases y la disponibilidad ya cargadas, nunca toca AsyncStorage;
 * quien orquesta la persistencia real es `scheduleAdjustmentService.ts`.
 */
export const SCHEDULE_ADJUSTMENT_MINUTE_OPTIONS: readonly ScheduleAdjustmentMinutes[] = [15, 20, 30, 40, 50, 60];

export function computeAdjustedStart(
  originalStartIso: string,
  direction: ScheduleAdjustmentDirection,
  minutes: ScheduleAdjustmentMinutes
): string {
  const deltaMs = minutes * 60_000 * (direction === 'delayed' ? 1 : -1);
  return new Date(new Date(originalStartIso).getTime() + deltaMs).toISOString();
}

export function computeAdjustedEnd(adjustedStartIso: string, durationMinutes: number): string {
  return new Date(new Date(adjustedStartIso).getTime() + durationMinutes * 60_000).toISOString();
}

export interface ScheduleAdjustmentConflict {
  kind: 'lesson' | 'availability';
  label: string;
  occupiedFrom: string;
  occupiedTo: string;
}

export type ScheduleAdjustmentPlan =
  | { ok: true; newStart: string; newEnd: string; adjustment: ScheduleAdjustment }
  | { ok: false; conflict: ScheduleAdjustmentConflict };

/**
 * Calcula el nuevo horario y verifica conflictos (otras clases reales,
 * disponibilidad de la profesora) — nunca persiste nada. Ante cualquier
 * conflicto, el llamador debe mantener el panel abierto y mostrar
 * exactamente el horario ocupado devuelto acá; nunca guardar.
 */
export function planScheduleAdjustment(input: {
  lesson: CalendarLesson;
  direction: ScheduleAdjustmentDirection;
  minutes: ScheduleAdjustmentMinutes;
  reason: ScheduleAdjustmentReason;
  otherLessons: CalendarLesson[];
  availability: TeacherAvailability;
  now?: Date;
}): ScheduleAdjustmentPlan {
  const durationMinutes = Math.round(
    (new Date(input.lesson.end).getTime() - new Date(input.lesson.start).getTime()) / 60_000
  );
  const newStart = computeAdjustedStart(input.lesson.start, input.direction, input.minutes);
  const newEnd = computeAdjustedEnd(newStart, durationMinutes);

  const conflicts = findCalendarConflicts(newStart, newEnd, input.otherLessons, input.lesson.id);
  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    return {
      ok: false,
      conflict: {
        kind: 'lesson',
        label: `${conflict.conflictingLesson.studentName} ya tiene una clase en ese horario.`,
        occupiedFrom: conflict.conflictingLesson.start,
        occupiedTo: conflict.conflictingLesson.end,
      },
    };
  }

  const availabilityResult = evaluateAvailability(newStart, newEnd, input.availability);
  if (!availabilityResult.isAvailable) {
    return {
      ok: false,
      conflict: {
        kind: 'availability',
        label: availabilityResult.label ?? 'Tenés un bloqueo configurado en ese horario.',
        occupiedFrom: availabilityResult.conflict?.overlapStart ?? newStart,
        occupiedTo: availabilityResult.conflict?.overlapEnd ?? newEnd,
      },
    };
  }

  return {
    ok: true,
    newStart,
    newEnd,
    adjustment: {
      direction: input.direction,
      minutes: input.minutes,
      reason: input.reason,
      adjustedAt: (input.now ?? new Date()).toISOString(),
    },
  };
}

/** Texto exacto pedido: "Atrasada 30 minutos" / "Adelantada 20 minutos". */
export function formatScheduleAdjustmentLabel(adjustment: ScheduleAdjustment): string {
  const verb = adjustment.direction === 'delayed' ? 'Atrasada' : 'Adelantada';
  return `${verb} ${adjustment.minutes} minutos`;
}
