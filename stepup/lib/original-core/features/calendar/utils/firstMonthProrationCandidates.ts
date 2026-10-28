// Puerto VERBATIM del original (`src/features/calendar/utils/firstMonthProrationCandidates.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { RecurrenceRule } from '../types/index.ts';
import { normalizeActivityKind } from './calendarActivityKind.ts';

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional): para cada
 * alumno recién incorporado a una serie, junta TODAS sus series activas
 * (la recién tocada, más cualquier otra en la que ya participara) — nunca
 * sólo la última, para que "varias series → una sola mensualidad" (nunca
 * una por serie) tenga con qué sumar. Pura — se arma con datos que
 * `CalendarTabScreen.tsx` ya tiene en memoria (el mismo `recurrenceRules`
 * que usan los flujos de agregar participantes), nunca releyendo
 * AsyncStorage — evita la condición de carrera de leer el guardado
 * "en vuelo" (`void saveRecurrenceRules(...)`, fire-and-forget) de la
 * propia serie recién tocada.
 */
export interface FirstMonthProrationCandidate {
  studentId: string;
  activeSeries: RecurrenceRule[];
}

export function ruleParticipantIds(rule: RecurrenceRule): string[] {
  if (rule.participantIds && rule.participantIds.length > 0) return rule.participantIds;
  return rule.studentId ? [rule.studentId] : [];
}

/**
 * CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
 * automático): TODAS las series activas donde participa un alumno —
 * extraída para que la detección en tiempo real
 * (`collectFirstMonthProrationCandidates`, abajo), el panel manual de
 * revisión (`firstMonthProrationReviewService.ts`) y la reparación
 * automática (`firstMonthProrationRepairService.ts`) usen exactamente el
 * mismo criterio, nunca copias que puedan divergir.
 *
 * Corrección 2026-09-14, cuarta ronda (a pedido de Joaquín — el
 * entrenamiento se cobra SIEMPRE aparte, nunca participa del cálculo, del
 * prorrateo ni de la reparación de la mensualidad normal de clases): se
 * excluyen acá, en la fuente única, las series con `activityKind:
 * 'training'` — nunca sólo en un `if` de un llamador puntual, para cubrir
 * todos los consumidores actuales y futuros. `normalizeActivityKind`
 * (única fuente real del significado de `activityKind`) trata cualquier
 * valor ausente/histórico como `'class'`, así que una serie sin el campo
 * sigue contando normalmente.
 */
export function collectActiveSeriesForStudent(studentId: string, recurrenceRules: RecurrenceRule[]): RecurrenceRule[] {
  return recurrenceRules.filter(
    (rule) =>
      rule.status === 'active' &&
      normalizeActivityKind(rule.activityKind) === 'class' &&
      ruleParticipantIds(rule).includes(studentId)
  );
}

export function collectFirstMonthProrationCandidates(input: {
  newlyAddedStudentIds: string[];
  touchedRecurrenceId: string;
  recurrenceRules: RecurrenceRule[];
}): FirstMonthProrationCandidate[] {
  return input.newlyAddedStudentIds.map((studentId) => {
    const activeSeries = input.recurrenceRules.filter((rule) => {
      if (rule.status !== 'active') return false;
      if (normalizeActivityKind(rule.activityKind) !== 'class') return false;
      if (rule.recurrenceId === input.touchedRecurrenceId) return true;
      return ruleParticipantIds(rule).includes(studentId);
    });
    return { studentId, activeSeries };
  });
}
