import type { CalendarViewItem } from "../calendar/occurrences.ts";

/**
 * Puerto exacto de `isOccurrenceEligibleForPendingRegistration`/
 * `pendingClasses.ts` (móvil). Se habilita para registrar desde
 * `max(inicio, fin - 10min)` — nunca antes de que la clase realmente
 * empiece a terminar — y queda pendiente indefinidamente hasta que se
 * registre (sin vencimiento). `calendar_lessons.status` es la única fuente
 * real de "ya no necesita registro": al finalizar un registro, ese status
 * pasa a `'completed'` en la misma transacción (ver
 * `finalize_lesson_registration`), así que una clase ya finalizada nunca
 * vuelve a pasar este filtro — no hace falta consultar `lesson_registrations`
 * para la exclusión, sólo para mostrar progreso de una en curso.
 */
export const PENDING_REGISTRATION_LEAD_TIME_MS = 10 * 60 * 1000;

export function isEligibleForPendingRegistration(item: CalendarViewItem, now: Date): boolean {
  if (item.status !== "scheduled" && item.status !== "rescheduled") return false;
  const startTime = new Date(item.start).getTime();
  const endTime = new Date(item.end).getTime();
  const availableFrom = Math.max(startTime, endTime - PENDING_REGISTRATION_LEAD_TIME_MS);
  return availableFrom <= now.getTime();
}

export type PendingLessonRegistrationState = "not_started" | "in_progress";

export interface RegistrationProgressForMerge {
  registrationId: string;
  calendarLessonId: string;
  status: "in_progress" | "completed";
  completedParticipants: number;
  totalParticipants: number;
}

export interface PendingLessonItem {
  item: CalendarViewItem;
  registrationState: PendingLessonRegistrationState;
  registrationId: string | null;
  completedParticipants: number;
  totalParticipants: number;
}

/**
 * Lista real de "clases por registrar" — una grupal parcialmente completada
 * muestra progreso real (`completedParticipants`/`totalParticipants`) en
 * vez de desaparecer o mostrarse como si no se hubiera tocado nada;
 * cerrar y reabrir conserva ese progreso porque viene de la fila real de
 * `lesson_registrations`/`lesson_registration_students`, nunca de estado
 * efímero del navegador.
 */
export function buildPendingLessons(params: {
  calendarItems: CalendarViewItem[];
  now: Date;
  registrations: RegistrationProgressForMerge[];
}): PendingLessonItem[] {
  const registrationByLessonId = new Map(params.registrations.map((registration) => [registration.calendarLessonId, registration]));

  const results: PendingLessonItem[] = [];
  for (const item of params.calendarItems) {
    if (!isEligibleForPendingRegistration(item, params.now)) continue;
    const registration = item.materializedLessonId ? registrationByLessonId.get(item.materializedLessonId) : undefined;
    results.push({
      item,
      registrationState: registration ? "in_progress" : "not_started",
      registrationId: registration?.registrationId ?? null,
      completedParticipants: registration?.completedParticipants ?? 0,
      totalParticipants: registration?.totalParticipants ?? Math.max(item.participantIds.length, 1),
    });
  }
  return results.sort((a, b) => new Date(a.item.start).getTime() - new Date(b.item.start).getTime());
}
