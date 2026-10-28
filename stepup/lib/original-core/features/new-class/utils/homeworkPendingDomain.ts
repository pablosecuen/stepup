// Puerto VERBATIM del original (`src/features/new-class/utils/homeworkPendingDomain.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { HomeworkReviewEntry, HomeworkReviewOutcome, SavedLesson } from '../types/index.ts';
import type { ActivityKind } from '../../calendar/types/index.ts';
import { activityKindSupportsHomework } from '../../calendar/utils/calendarActivityKind.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: "la tarea pendiente
 * debe reaparecer claramente cuando se registre la siguiente clase del
 * alumno"): motor PURO del ciclo de tareas pendientes — nunca toca
 * AsyncStorage/Supabase/React, mismo patrón que `lessonRegistrationDomain.ts`/
 * `editRegisteredLessonDomain.ts`.
 *
 * DECISIÓN DE ARQUITECTURA (siguiendo la instrucción explícita de auditar
 * antes de crear un store nuevo): todo se deriva de `SavedLesson[]`, que YA
 * contiene las tareas asignadas (`form.homeworkDescription`/
 * `form.evaluations[].individualHomeworkDescription`) y YA se incluye en el
 * respaldo automático. No hace falta un store aparte — sólo un campo
 * ADITIVO y opcional (`SavedLesson.homeworkReviews`) para registrar,
 * DENTRO de la clase donde se revisó, qué pasó con una tarea asignada en
 * una clase anterior. Identidad estable de cada tarea (nunca por posición
 * ni por texto, para que sobreviva ediciones y ordenamientos distintos):
 *   - tarea común:      `common:<savedLessonId de origen>`
 *   - tarea individual: `individual:<savedLessonId de origen>:<studentId>`
 */

export type PendingHomeworkTaskKind = 'common' | 'individual';

export interface PendingHomeworkTask {
  taskId: string;
  studentId: string;
  kind: PendingHomeworkTaskKind;
  description: string;
  dueDate: string | null;
  originLessonId: string;
  /** Fecha+hora ISO de la clase de origen — para ordenar y mostrar "asignada el...". */
  assignedAt: string;
  originDate: string; // YYYY-MM-DD, tal cual quedó en form.date de la clase de origen
}

export function commonHomeworkTaskId(originLessonId: string): string {
  return `common:${originLessonId}`;
}

export function individualHomeworkTaskId(originLessonId: string, studentId: string): string {
  return `individual:${originLessonId}:${studentId}`;
}

/**
 * Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN RESPUESTA
 * PRESELECCIONADA, causa raíz real en "construcción de formularios
 * grupales"): una tarea COMÚN comparte el mismo `taskId` entre TODOS los
 * participantes de su clase de origen a propósito (`commonHomeworkTaskId`
 * no incluye `studentId`) — cada uno la resuelve de forma independiente
 * (`isHomeworkTaskResolved` ya lo exige así, por diseño). Pero el estado de
 * SELECCIÓN en pantalla (`Record<clave, outcome>`) SÍ necesita una clave
 * propia por participante — de lo contrario, si dos alumnos de un mismo
 * grupo comparten esa tarea común pendiente en una clase nueva, elegir la
 * respuesta de UNO la mostraría también como ya elegida para el OTRO (la
 * misma clave `taskId`, sin distinguir de quién es la selección). Única
 * función real para construir esa clave — nunca se arma a mano en otro
 * lugar.
 */
export function homeworkReviewSelectionKey(taskId: string, studentId: string): string {
  return `${taskId}::${studentId}`;
}

function lessonDateTimeIso(lesson: SavedLesson): string {
  return `${lesson.form.date}T${lesson.form.time || '00:00'}:00`;
}

/**
 * Todas las tareas alguna vez asignadas (comunes e individuales) en
 * cualquier `SavedLesson` — sin filtrar todavía por resueltas/pendientes.
 * Sólo cuenta clases que realmente se dictaron (`countsAsClass`, el mismo
 * campo persistido que ya decide si una clase suma a horas/asistencia/
 * promedio) — una clase cancelada o un feriado sin excepción nunca asigna
 * tarea, exactamente como ya impide la UI (la sección "Tarea" sólo se
 * muestra cuando `classHeld`).
 *
 * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): un
 * entrenamiento nunca asigna tarea a una clase posterior — mismo criterio que ya aplica la UI de
 * registro (`activityKindSupportsHomework`, nunca muestra la sección de
 * tarea para un entrenamiento, así que en la práctica ya guarda esos campos
 * vacíos; este chequeo es la defensa real del dominio, no depende de que la
 * UI se haya comportado bien).
 */
export function collectAssignedHomeworkTasks(lessons: SavedLesson[]): PendingHomeworkTask[] {
  const tasks: PendingHomeworkTask[] = [];

  lessons.forEach((lesson) => {
    if (!lesson.countsAsClass) return;
    if (!activityKindSupportsHomework(lesson.form.activityKind)) return;
    const assignedAt = lessonDateTimeIso(lesson);

    const commonDescription = lesson.form.homeworkDescription?.trim();
    if (commonDescription) {
      lesson.form.studentIds.forEach((studentId) => {
        tasks.push({
          taskId: commonHomeworkTaskId(lesson.id),
          studentId,
          kind: 'common',
          description: commonDescription,
          dueDate: lesson.form.homeworkDueDate ?? null,
          originLessonId: lesson.id,
          assignedAt,
          originDate: lesson.form.date,
        });
      });
    }

    lesson.form.evaluations.forEach((evaluation) => {
      const individualDescription = evaluation.individualHomeworkDescription?.trim();
      if (!individualDescription) return;
      tasks.push({
        taskId: individualHomeworkTaskId(lesson.id, evaluation.studentId),
        studentId: evaluation.studentId,
        kind: 'individual',
        description: individualDescription,
        dueDate: evaluation.individualHomeworkDueDate ?? null,
        originLessonId: lesson.id,
        assignedAt,
        originDate: lesson.form.date,
      });
    });
  });

  return tasks;
}

const TERMINAL_OUTCOMES: HomeworkReviewOutcome[] = ['realizada', 'ya_no_corresponde'];

/**
 * Una tarea queda CERRADA apenas exista, en CUALQUIER clase (no
 * necesariamente la más reciente), una revisión con resultado terminal
 * ("realizada" o "ya_no_corresponde"). "parcial"/"no_realizada" nunca
 * cierran nada — la tarea sigue abierta para la próxima revisión.
 *
 * Corrección de diseño: una tarea COMÚN comparte el mismo `taskId` entre
 * todos los participantes de la clase de origen (`common:<lessonId>`) a
 * propósito — pero cada alumno la resuelve de forma independiente
 * ("resolver la tarea de un alumno nunca debe resolver la de los demás").
 * Por eso la revisión SIEMPRE se busca también por `studentId`, nunca sólo
 * por `taskId` — de lo contrario, marcar a un alumno "realizada" cerraría
 * en silencio la misma tarea para todo el resto del grupo.
 */
export function isHomeworkTaskResolved(taskId: string, studentId: string, lessons: SavedLesson[]): boolean {
  return lessons.some((lesson) =>
    (lesson.homeworkReviews ?? []).some(
      (review) => review.taskId === taskId && review.studentId === studentId && TERMINAL_OUTCOMES.includes(review.outcome)
    )
  );
}

/**
 * Tareas pendientes de UN alumno puntual, en orden cronológico de
 * asignación (la más vieja primero — "nunca perder las tareas antiguas
 * existentes"). `excludeOriginLessonId` evita que una clase se muestre a
 * sí misma como pendiente de su propia tarea recién escrita (todavía sin
 * guardar) — "una tarea escrita en la clase actual no debe aparecer como
 * pendiente dentro de esa misma clase".
 */
export function computePendingHomeworkTasks(
  studentId: string,
  lessons: SavedLesson[],
  options: { excludeOriginLessonId?: string } = {}
): PendingHomeworkTask[] {
  return collectAssignedHomeworkTasks(lessons)
    .filter((task) => task.studentId === studentId)
    .filter((task) => task.originLessonId !== options.excludeOriginLessonId)
    .filter((task) => !isHomeworkTaskResolved(task.taskId, task.studentId, lessons))
    .sort((first, second) => new Date(first.assignedAt).getTime() - new Date(second.assignedAt).getTime());
}

/**
 * Upsert por `(taskId, studentId)` — reintentar el guardado (mismo taskId,
 * mismo resultado o corregido) nunca agrega una segunda entrada; reemplaza
 * la existente. Editar una clase y cambiar la revisión (ver
 * `EditRegisteredLessonSheet.tsx`) pasa por acá mismo — nunca un array que
 * sólo crece.
 *
 * Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN RESPUESTA
 * PRESELECCIONADA): antes agrupaba SÓLO por `taskId` — una tarea COMÚN
 * comparte el mismo `taskId` entre varios alumnos a propósito, así que
 * guardar la revisión de un segundo alumno con esa misma tarea PISABA (con
 * `Map.set`) la revisión ya guardada del primero, perdiendo su respuesta
 * real. Ahora agrupa por la clave compuesta real
 * (`homeworkReviewSelectionKey`), igual que el estado de selección en
 * pantalla — nunca vuelve a mezclar respuestas de alumnos distintos.
 */
export function upsertHomeworkReviews(
  existing: HomeworkReviewEntry[] | undefined,
  entries: HomeworkReviewEntry[]
): HomeworkReviewEntry[] {
  const byKey = new Map<string, HomeworkReviewEntry>(
    (existing ?? []).map((entry) => [homeworkReviewSelectionKey(entry.taskId, entry.studentId), entry])
  );
  entries.forEach((entry) => byKey.set(homeworkReviewSelectionKey(entry.taskId, entry.studentId), entry));
  return Array.from(byKey.values());
}

/**
 * Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN RESPUESTA
 * PRESELECCIONADA): reconstruye las selecciones YA respondidas y
 * guardadas (`HomeworkReviewEntry[]`, de un registro editado o de un
 * borrador grupal reabierto) al formato `Record<taskId, outcome>` que usan
 * los paneles — única función real para esto, reutilizada por
 * `EditRegisteredLessonSheet.tsx` y `RegisterPendingClassSheet.tsx`. Sin
 * entradas reales, devuelve `{}` — nunca inventa una respuesta.
 */
export function homeworkReviewsToSelections(
  reviews: HomeworkReviewEntry[] | undefined
): Record<string, HomeworkReviewOutcome> {
  if (!reviews) return {};
  return Object.fromEntries(
    reviews.map((entry) => [homeworkReviewSelectionKey(entry.taskId, entry.studentId), entry.outcome])
  );
}

/**
 * Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN RESPUESTA
 * PRESELECCIONADA): única función pura que decide qué tareas pendientes
 * TODAVÍA no tienen una respuesta real elegida — usada por los tres
 * paneles de registro (`NewClassScreen.tsx`, `RegisterPendingClassSheet.tsx`,
 * `EditRegisteredLessonSheet.tsx`) para BLOQUEAR "Completar alumno"/
 * "Guardar clase"/"Finalizar registro" mientras queden tareas sin
 * responder — nunca cada pantalla decide esto por su cuenta. `selections`
 * está indexado por `homeworkReviewSelectionKey(taskId, studentId)` (nunca
 * sólo `taskId` — una tarea COMÚN comparte taskId entre varios alumnos);
 * una clave ausente (nunca `''` ni ningún otro valor "vacío" ambiguo)
 * significa "sin responder".
 */
export function getUnresolvedHomeworkTaskIds(
  pendingTasks: PendingHomeworkTask[],
  selections: Record<string, HomeworkReviewOutcome>
): string[] {
  return pendingTasks
    .filter((task) => !selections[homeworkReviewSelectionKey(task.taskId, task.studentId)])
    .map((task) => task.taskId);
}

/**
 * Corrección 2026-09-12 (a pedido de Joaquín — ENTRENAMIENTOS GRUPALES
 * ATASCADOS EN "0 de N completados", corrección ESTRUCTURAL definitiva):
 * ÚNICA función real que decide qué tareas pendientes pueden bloquear de
 * verdad "Completar alumno"/"Guardar clase"/"Finalizar registro". Antes cada
 * handler combinaba a mano `activityKindSupportsHomework(...) &&
 * getUnresolvedHomeworkTaskIds(...)` — una combinación que un handler nuevo
 * (o uno viejo, como pasó acá) podía omitir en silencio. Ahora ningún
 * llamador vuelve a decidir esto por su cuenta: siempre pasa por acá.
 *
 * Contrato (nunca un segundo criterio de compatibilidad — reutiliza
 * `activityKindSupportsHomework`/`normalizeActivityKind`, la única fuente
 * real de qué admite tarea):
 *   - `activityKind` que no admite tarea (entrenamiento) → nunca bloquea,
 *     sin importar cuántas tareas sigan sin responder.
 *   - `activityKind` que admite tarea (clase) → bloquean las que sigan sin
 *     una respuesta real elegida.
 *   - `activityKind` ausente (registro histórico anterior a Entrenamientos)
 *     → se normaliza a clase, igual que siempre: bloquea igual que una
 *     clase.
 *
 * `tasks` debe llegar ya acotado a lo realmente visible/aplicable para esta
 * decisión (por alumno, por asistencia Presente/Tarde, etc.) — ese recorte
 * sigue siendo responsabilidad de quien llama; esta función sólo conoce el
 * tipo de actividad y las tareas que le pasan.
 */
export function getBlockingHomeworkTasks(
  activityKind: ActivityKind | string | null | undefined,
  tasks: PendingHomeworkTask[],
  selections: Record<string, HomeworkReviewOutcome>
): PendingHomeworkTask[] {
  if (!activityKindSupportsHomework(activityKind)) return [];
  return tasks.filter((task) => !selections[homeworkReviewSelectionKey(task.taskId, task.studentId)]);
}

/**
 * Construye las entradas de revisión a partir de las selecciones hechas en
 * la tarjeta "Tarea pendiente" de la pantalla — puro, no decide nada de UI.
 * Recorre `pendingTasks` (nunca `Object.entries(selections)`): así cada
 * entrada de salida queda con SU PROPIO `studentId` real, incluso cuando
 * dos alumnos comparten el mismo `taskId` de una tarea común — antes
 * indexaba por `taskId` crudo y una tarea común con dos revisiones
 * distintas colapsaba a una sola en el `Map`, perdiendo la del otro
 * alumno.
 */
export function buildHomeworkReviewEntries(
  selections: Record<string, HomeworkReviewOutcome>,
  pendingTasks: PendingHomeworkTask[],
  reviewedAt: string
): HomeworkReviewEntry[] {
  return pendingTasks
    .map((task) => {
      const outcome = selections[homeworkReviewSelectionKey(task.taskId, task.studentId)];
      if (!outcome) return null;
      return { taskId: task.taskId, studentId: task.studentId, outcome, reviewedAt };
    })
    .filter((entry): entry is HomeworkReviewEntry => entry !== null);
}

/**
 * Proyección canónica de `StudentProfile.pendingHomework` (una cadena, por
 * compatibilidad con el tipo existente y los respaldos ya guardados) —
 * ANTES se sobrescribía ciegamente con la última tarea escrita, sin noción
 * de "resuelta" (ver `profileLessonOutcome.ts`). Ahora refleja el estado
 * REAL: todas las tareas abiertas de este alumno, de la más vieja a la más
 * nueva, nunca sólo la última. `null` cuando no queda ninguna abierta.
 */
export function projectPendingHomeworkSummary(studentId: string, lessons: SavedLesson[]): string | null {
  const pending = computePendingHomeworkTasks(studentId, lessons);
  if (pending.length === 0) return null;
  return pending.map((task) => task.description).join('; ');
}
