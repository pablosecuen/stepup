import { planParticipantFreeze, type OccurrenceToFreeze } from "../calendar/participants-split.ts";
import type { RecurrenceRuleForEngine, CalendarLessonForEngine } from "../calendar/types";

/**
 * Motor PURO de la poda de agenda al archivar un alumno — decisión de
 * producto confirmada: archivar/restaurar es el flujo definitivo (nunca
 * hard delete), y al archivar la profesora elige explícitamente si
 * conserva o quita al alumno de la agenda futura (nunca preseleccionado).
 *
 * Esta función NUNCA toca la base — sólo calcula el plan exacto que la RPC
 * `archive_student_and_prune_future` va a ejecutar en una sola transacción.
 * Mismo patrón que `planParticipantFreeze` (io separado de lógica).
 *
 * Reglas (nunca tocar pasado/completadas/canceladas — todos los filtros de
 * entrada ya vienen acotados a `status='scheduled' AND start_at >= efectiva`):
 * - alumno secundario en una serie/clase suelta: se lo quita del roster futuro.
 * - alumno primario SIN otros participantes: termina la serie / cancela la
 *   clase suelta — nunca se borra el registro.
 * - alumno primario CON otros participantes: nunca se cancela la actividad
 *   de los demás — se promueve de forma determinística a otro participante
 *   como primario (el de `createdAt` más antiguo, empate por `studentId`
 *   ascendente — nunca azar, nunca orden de llegada del array).
 */

export interface RuleParticipantForPrune {
  ruleId: string;
  studentId: string;
  createdAt: string;
  studentName: string;
  studentLevel: string;
}

export interface RuleForPrune extends RecurrenceRuleForEngine {
  primaryStudentId: string | null;
}

export interface LooseLessonParticipantForPrune {
  studentId: string;
  studentName: string;
  level: string;
  createdAt: string;
}

export interface LooseLessonForPrune {
  id: string;
  primaryStudentId: string;
  /** Participantes reales de `calendar_lesson_participants`, EXCLUYENDO al alumno que se archiva — ya filtrado por quien llama. */
  otherParticipants: LooseLessonParticipantForPrune[];
}

export interface ArchivePrunePlanInput {
  studentId: string;
  now: Date;
  /** Fecha civil efectiva (YYYY-MM-DD) — el día que se archiva, zona horaria Argentina, nunca UTC implícito. */
  effectiveDateIso: string;
  /** Series activas/pausadas donde el alumno es primario o participante — ya filtradas por quien llama. */
  rules: RuleForPrune[];
  /** Roster completo (todas las filas de recurrence_rule_participants) de esas mismas series, con nombre/nivel reales actuales. */
  ruleParticipants: RuleParticipantForPrune[];
  /** Clases materializadas (cualquier fecha) de esas series — para saber qué ocurrencias virtuales ya están materializadas antes de congelar. */
  lessonsByRule: Record<string, CalendarLessonForEngine[]>;
  /** Clases sueltas futuras `scheduled` (sin recurrencia) donde el alumno es primario o participante. */
  looseLessons: LooseLessonForPrune[];
}

export interface SeriesEndPlan {
  ruleId: string;
}

export interface SeriesPromotePlan {
  ruleId: string;
  newPrimaryStudentId: string;
  newPrimaryStudentName: string;
  newPrimaryLevel: string;
  freezeOccurrences: OccurrenceToFreeze[];
}

export interface SeriesParticipantRemovalPlan {
  ruleId: string;
  freezeOccurrences: OccurrenceToFreeze[];
}

export interface LooseReassignPlan {
  lessonId: string;
  newPrimaryStudentId: string;
  newPrimaryStudentName: string;
  newPrimaryLevel: string;
}

export interface ArchivePrunePlan {
  seriesEnd: SeriesEndPlan[];
  seriesPromote: SeriesPromotePlan[];
  seriesParticipantRemoval: SeriesParticipantRemovalPlan[];
  looseCancel: string[];
  looseReassign: LooseReassignPlan[];
  looseRemoveParticipant: string[];
}

/** Elige de forma determinística quién se promueve — nunca azar, nunca orden de llegada del array. */
function pickPromotionCandidate(candidates: RuleParticipantForPrune[]): RuleParticipantForPrune {
  return [...candidates].sort((a, b) => {
    const byDate = a.createdAt.localeCompare(b.createdAt);
    if (byDate !== 0) return byDate;
    return a.studentId.localeCompare(b.studentId);
  })[0];
}

export function planArchiveStudentPrune(input: ArchivePrunePlanInput): ArchivePrunePlan {
  const { studentId, now, effectiveDateIso, rules, ruleParticipants, lessonsByRule, looseLessons } = input;

  const plan: ArchivePrunePlan = {
    seriesEnd: [],
    seriesPromote: [],
    seriesParticipantRemoval: [],
    looseCancel: [],
    looseReassign: [],
    looseRemoveParticipant: [],
  };

  for (const rule of rules) {
    const others = ruleParticipants.filter((p) => p.ruleId === rule.recurrenceId && p.studentId !== studentId);
    const isPrimary = rule.primaryStudentId === studentId;

    if (isPrimary) {
      if (others.length === 0) {
        plan.seriesEnd.push({ ruleId: rule.recurrenceId });
        continue;
      }
      const promoted = pickPromotionCandidate(others);
      const freezeOccurrences = planParticipantFreeze({
        rule,
        now,
        effectiveDateIso,
        existingLessons: lessonsByRule[rule.recurrenceId] ?? [],
      });
      plan.seriesPromote.push({
        ruleId: rule.recurrenceId,
        newPrimaryStudentId: promoted.studentId,
        newPrimaryStudentName: promoted.studentName,
        newPrimaryLevel: promoted.studentLevel,
        freezeOccurrences,
      });
      continue;
    }

    // Participante secundario (no primario) de esta serie — se lo quita del roster futuro, la serie sigue igual.
    const stillInvolved = ruleParticipants.some((p) => p.ruleId === rule.recurrenceId && p.studentId === studentId);
    if (stillInvolved) {
      const freezeOccurrences = planParticipantFreeze({
        rule,
        now,
        effectiveDateIso,
        existingLessons: lessonsByRule[rule.recurrenceId] ?? [],
      });
      plan.seriesParticipantRemoval.push({ ruleId: rule.recurrenceId, freezeOccurrences });
    }
  }

  for (const lesson of looseLessons) {
    const isPrimary = lesson.primaryStudentId === studentId;
    if (isPrimary) {
      if (lesson.otherParticipants.length === 0) {
        plan.looseCancel.push(lesson.id);
      } else {
        const promoted = [...lesson.otherParticipants].sort((a, b) => {
          const byDate = a.createdAt.localeCompare(b.createdAt);
          if (byDate !== 0) return byDate;
          return a.studentId.localeCompare(b.studentId);
        })[0];
        plan.looseReassign.push({
          lessonId: lesson.id,
          newPrimaryStudentId: promoted.studentId,
          newPrimaryStudentName: promoted.studentName,
          newPrimaryLevel: promoted.level,
        });
      }
    } else {
      plan.looseRemoveParticipant.push(lesson.id);
    }
  }

  return plan;
}
