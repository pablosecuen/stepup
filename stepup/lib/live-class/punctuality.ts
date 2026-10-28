// Puntualidad del alumno (ALU-13): los registros ya finalizados → resumen con el puntaje del original. Puro: el cálculo es `buildPunctualitySummary` (copia idéntica del original).
import { buildPunctualitySummary, type PunctualityScoreEntry, type PunctualitySummary } from "../payments/engine/features/new-class/utils/punctualityScoring.ts";
import type { StudentArrival, StudentArrivalStatus } from "../payments/engine/features/new-class/types/index.ts";
import { instantDateKey } from "../calendar/civil-calendar.ts";

const STATUSES: ReadonlySet<string> = new Set<StudentArrivalStatus>(["on_time", "within_grace", "late", "teacher_delayed", "mutual_adjustment", "unknown", "no_show"]);

interface RegistrationLike {
  status: string;
  countsAsClass: boolean;
  scheduledStartAt: string | null;
  actualStartedAt: string | null;
  createdAt: string;
  studentArrival?: { status: string; lateMinutes: number; manuallyCorrected: boolean; arrivedAt?: string } | null;
}

/** Lo guardado se acepta sólo si tiene la forma esperada; cualquier otra cosa cuenta como «sin dato» (nunca se inventa una llegada). */
export function readStudentArrival(value: RegistrationLike["studentArrival"]): StudentArrival | null {
  if (!value || !STATUSES.has(value.status) || !Number.isFinite(value.lateMinutes) || value.lateMinutes < 0) return null;
  return { status: value.status as StudentArrivalStatus, lateMinutes: value.lateMinutes, manuallyCorrected: value.manuallyCorrected === true, ...(value.arrivedAt ? { arrivedAt: value.arrivedAt } : {}) };
}

/** Un renglón por clase FINALIZADA (un borrador no cuenta). El día es el de la clase, en hora de Argentina. */
export function buildStudentPunctualityEntries(registrations: readonly RegistrationLike[], todayDateKey: string): PunctualityScoreEntry[] {
  return registrations
    .filter((registration) => registration.status === "completed")
    .map((registration) => {
      const date = instantDateKey(registration.scheduledStartAt ?? registration.actualStartedAt ?? registration.createdAt);
      return { date, arrival: readStudentArrival(registration.studentArrival), isCancelled: !registration.countsAsClass, isFuture: date > todayDateKey };
    });
}

export function buildStudentPunctuality(registrations: readonly RegistrationLike[], todayDateKey: string): PunctualitySummary {
  return buildPunctualitySummary(buildStudentPunctualityEntries(registrations, todayDateKey));
}
