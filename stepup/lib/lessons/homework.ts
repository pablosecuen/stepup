import { activityKindSupportsHomework } from "../calendar/activity-kind.ts";
import type { ActivityKind } from "../calendar/types.ts";

/**
 * Puerto exacto de `homeworkPendingDomain.ts` (móvil) — identidad estable de
 * tareas y la ÚNICA función real que decide qué tareas pendientes pueden
 * bloquear "Completar alumno"/"Finalizar registro". Corrección 2026-09-12
 * del móvil (entrenamientos grupales atascados en "0 de N completados"):
 * antes cada handler combinaba a mano `activityKindSupportsHomework(...) &&
 * tareasSinResolver` — una combinación que un handler nuevo podía omitir en
 * silencio. Acá, igual que en el móvil, sólo existe UN lugar que decide
 * esto (`getBlockingHomeworkTasks`) — nunca se vuelve a combinar a mano en
 * ningún Server Action ni componente.
 */

export type HomeworkReviewOutcome = "realizada" | "parcial" | "no_realizada" | "ya_no_corresponde";

export interface PendingHomeworkTask {
  taskId: string;
  studentId: string;
  description: string;
  dueDate: string | null;
  originLessonRegistrationId: string;
  assignedAt: string;
}

/** `common:<originLessonRegistrationId>` — tarea asignada a todo el grupo de esa clase. */
export function commonHomeworkTaskId(originLessonRegistrationId: string): string {
  return `common:${originLessonRegistrationId}`;
}

/** `individual:<originLessonRegistrationId>:<studentId>` — tarea asignada a un solo alumno. */
export function individualHomeworkTaskId(originLessonRegistrationId: string, studentId: string): string {
  return `individual:${originLessonRegistrationId}:${studentId}`;
}

/** Clave de selección en pantalla — una tarea común se comparte entre varios alumnos, pero cada uno la resuelve por separado. */
export function homeworkReviewSelectionKey(taskId: string, studentId: string): string {
  return `${taskId}::${studentId}`;
}

/** Una tarea queda cerrada sólo con 'realizada' o 'ya_no_corresponde' — 'parcial'/'no_realizada' la mantienen pendiente. */
export function isHomeworkTaskResolved(outcome: HomeworkReviewOutcome | null | undefined): boolean {
  return outcome === "realizada" || outcome === "ya_no_corresponde";
}

/**
 * Única fuente real de verdad: qué tareas pendientes bloquean de verdad
 * "Completar alumno"/"Guardar clase"/"Finalizar registro" para esta
 * actividad. Un entrenamiento (`activityKindSupportsHomework` = false)
 * NUNCA bloquea, sin importar cuántas tareas heredadas tenga un
 * participante — mismo criterio exacto que el móvil, aplicado en el mismo
 * único lugar tanto para la validación de "completar alumno" como para la
 * validación final (nunca se vuelve a combinar a mano en otro archivo).
 */
export function getBlockingHomeworkTasks(
  activityKind: ActivityKind | string | null | undefined,
  tasks: PendingHomeworkTask[],
  selections: Record<string, HomeworkReviewOutcome>
): PendingHomeworkTask[] {
  if (!activityKindSupportsHomework(activityKind)) return [];
  return tasks.filter((task) => !selections[homeworkReviewSelectionKey(task.taskId, task.studentId)]);
}
