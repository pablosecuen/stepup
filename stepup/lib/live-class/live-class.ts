// «Clase en curso» (INI-07 / REG-11): reglas del diálogo de puntualidad, del contador y del ciclo real de la clase. Puro (sin React, Next ni Supabase) para probarse con `node --test`.
// Las cuentas del contador, la clasificación de la llegada y el puntaje de puntualidad NO se reescriben: salen de `lib/payments/engine` (copias idénticas, byte a byte, del original).
import { classifyArrival, computeMinutesBeforeEffectiveStart } from "../payments/engine/features/new-class/utils/punctualityClassification.ts";
import { computeElapsedMinutesRounded, computeOvertimeSeconds, formatCountdown } from "../payments/engine/features/dashboard/utils/activeClassTiming.ts";
import type { ClassStartSource, ScheduleAdjustment, StudentArrival } from "../payments/engine/features/new-class/types/index.ts";
import { localDateTimeToInstantIso } from "../calendar/timezone.ts";
import { instantDateKey } from "../calendar/civil-calendar.ts";
import { ARGENTINA_TIME_ZONE } from "../payments/dates.ts";

/** La clase en curso de la profesora (nunca hay más de una a la vez). */
export interface LiveClassSession {
  calendarLessonId: string;
  /** Alumno principal de la clase (para «Ver alumno»); `null` si ya no existe. */
  primaryStudentId: string | null;
  studentNames: string[];
  scheduledDurationMinutes: number;
  startedAt: string;
  scheduledStartAt: string;
  effectiveStartAt: string;
  scheduleAdjustment: ScheduleAdjustment | null;
  studentArrival: StudentArrival;
  startSource: ClassStartSource;
  /** `false` si la clase fue cancelada o reprogramada mientras estaba en curso: la sesión ya no es válida y sólo se puede descartar. */
  lessonStillScheduled: boolean;
}

export type ArrivalChoice = "on_time" | "within_grace" | "late" | "teacher_delayed" | "mutual_adjustment" | "unknown";

/** Las seis respuestas del diálogo del original, con sus textos exactos y en el mismo orden. */
export const ARRIVAL_CHOICES: ReadonlyArray<{ choice: ArrivalChoice; label: string }> = [
  { choice: "on_time", label: "Sí, llegó a horario" },
  { choice: "within_grace", label: "Llegó dentro de la tolerancia" },
  { choice: "late", label: "Llegó tarde" },
  { choice: "teacher_delayed", label: "La profesora retrasó la clase" },
  { choice: "mutual_adjustment", label: "Habíamos acordado otro horario" },
  { choice: "unknown", label: "Registrar después" },
];

/** Pregunta del diálogo: «¿Ana y Luis llegó a horario?» (los nombres van juntos, como en el original). */
export function arrivalQuestion(studentNames: readonly string[]): string {
  return `¿${studentNames.join(", ")} llegó a horario?`;
}

/** Minutos que faltan para el horario efectivo (positivo = se está comenzando antes). Dispara la confirmación «Estás comenzando N minutos antes». */
export function minutesStartingEarly(nowIso: string, effectiveStartAtIso: string): number {
  return Math.max(0, computeMinutesBeforeEffectiveStart(nowIso, effectiveStartAtIso));
}

/** Texto de la confirmación de comienzo anticipado. */
export function earlyStartMessage(minutes: number): string {
  return `Estás comenzando ${minutes} ${minutes === 1 ? "minuto" : "minutos"} antes.`;
}

/**
 * Respuesta de puntualidad de las cinco opciones que no piden hora (la profesora contesta y listo): nunca se infiere nada del momento en que se toca el botón. «Llegó tarde» pide la hora real
 * y pasa por `arrivalFromLateTime`.
 */
export function arrivalFromChoice(choice: Exclude<ArrivalChoice, "late">): StudentArrival {
  return { status: choice, lateMinutes: 0, manuallyCorrected: false };
}

/** «Llegó tarde»: se clasifica SIEMPRE contra el horario efectivo (un atraso de la profesora nunca se lee como que el alumno llegó tarde). Una hora igual o anterior queda «a horario». */
export function arrivalFromLateTime(arrivedAtIso: string, effectiveStartAtIso: string): StudentArrival {
  const classification = classifyArrival(arrivedAtIso, effectiveStartAtIso);
  return { arrivedAt: arrivedAtIso, status: classification.status, lateMinutes: classification.lateMinutes, manuallyCorrected: false };
}

/** Hora ingresada a mano (HH:mm, hora de Argentina) combinada con el DÍA de la clase, como `combineTodayWithTime` del original. `null` si la hora no es válida. */
export function instantFromClockTime(referenceIso: string, hhmm: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!match) return null;
  return localDateTimeToInstantIso({ date: instantDateKey(referenceIso), hour: Number(match[1]), minute: Number(match[2]), timeZone: ARGENTINA_TIME_ZONE });
}

export interface LiveClassClock {
  overtimeSeconds: number;
  isOvertime: boolean;
  countdown: string;
  /** 0 a 1; nunca pasa de 1 aunque la clase esté en tiempo extra. */
  progress: number;
}

/** Lo que muestra la tarjeta en cada segundo: cuenta regresiva (o «+mm:ss» de tiempo extra) y avance de la barra. */
export function liveClassClock(session: Pick<LiveClassSession, "startedAt" | "scheduledDurationMinutes">, now: Date): LiveClassClock {
  const overtimeSeconds = computeOvertimeSeconds(session.startedAt, session.scheduledDurationMinutes, now);
  const total = session.scheduledDurationMinutes * 60;
  const elapsed = overtimeSeconds + total;
  return { overtimeSeconds, isOvertime: overtimeSeconds > 0, countdown: formatCountdown(overtimeSeconds), progress: total <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / total)) };
}

/** Minutos reales (redondeados, mínimo 1) que se precargan como «Duración real» al finalizar. */
export function elapsedMinutes(startedAt: string, now: Date): number {
  return computeElapsedMinutesRounded(startedAt, now);
}

/** Resumen de la puntualidad para mostrar junto al contador (siempre con texto, nunca sólo color). */
export function describeArrival(arrival: StudentArrival): string {
  switch (arrival.status) {
    case "on_time":
      return "Llegó a horario";
    case "within_grace":
      return "Llegó dentro de la tolerancia";
    case "late":
      return arrival.lateMinutes > 0 ? `Llegó ${arrival.lateMinutes} ${arrival.lateMinutes === 1 ? "minuto" : "minutos"} tarde` : "Llegó tarde";
    case "teacher_delayed":
      return "La profesora retrasó la clase";
    case "mutual_adjustment":
      return "Habían acordado otro horario";
    case "no_show":
      return "Ausencia";
    default:
      return "Puntualidad sin registrar";
  }
}

/** Ids de clase que NO se pueden comenzar a la vez: si ya hay una en curso, sólo esa. */
export function canStartLiveClass(current: Pick<LiveClassSession, "calendarLessonId"> | null, lessonId: string): boolean {
  return current === null || current.calendarLessonId === lessonId;
}
