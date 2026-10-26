import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activityKindAssignsHomework, activityKindSupportsHomework } from "../../calendar/activity-kind.ts";
import { getBlockingHomeworkTasks, type PendingHomeworkTask } from "../homework.ts";
import { homeworkFieldsFor } from "../registration-form.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("clases y entrenamientos ASIGNAN tarea; sólo una clase REVISA tareas anteriores y sólo una clase se bloquea por ellas", () => {
  assert.equal(activityKindAssignsHomework("class"), true);
  assert.equal(activityKindAssignsHomework("training"), true);
  assert.equal(activityKindAssignsHomework(null), true, "sin dato se trata como clase");
  assert.equal(activityKindSupportsHomework("class"), true);
  assert.equal(activityKindSupportsHomework("training"), false);
  const task: PendingHomeworkTask = { taskId: "common:r1", studentId: "s", description: "Leer", dueDate: null, originLessonRegistrationId: "r1", assignedAt: "2026-10-20T10:00:00Z" };
  assert.deepEqual(getBlockingHomeworkTasks("training", [task], {}), [], "un entrenamiento sigue sin bloquearse (no se repite el atasco de «0 de N completados»)");
  assert.equal(getBlockingHomeworkTasks("class", [task], {}).length, 1);
});

test("entrenamiento individual y grupal: caja de tarea común; en grupo, además una personalizada por alumno; sin revisión de tareas anteriores", () => {
  const supportsHomework = activityKindSupportsHomework("training");
  const assignsHomework = activityKindAssignsHomework("training");
  assert.deepEqual(homeworkFieldsFor({ supportsHomework, assignsHomework, isGroup: false }), { common: true, personalizedPerStudent: false, pendingReview: false });
  assert.deepEqual(homeworkFieldsFor({ supportsHomework, assignsHomework, isGroup: true }), { common: true, personalizedPerStudent: true, pendingReview: false });
});

test("cableado: el entrenamiento guarda y reabre la tarea con el mismo circuito que la clase, y la tarea se consulta después", () => {
  const ws = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.match(ws, /const assignsHomework = activityKindAssignsHomework\(registration\.activityKind\);/);
  assert.match(ws, /homeworkFieldsFor\(\{ supportsHomework, assignsHomework, isGroup \}\)/);
  assert.match(ws, /homeworkDescription: countsAsClass && assignsHomework \?/, "finalizar / guardar cambios envía la tarea común también en un entrenamiento");
  assert.match(ws, /homeworkDescription: homeworkFields\.common \?/, "guardar progreso también");
  assert.match(ws, /\{assignsHomework && <PersonalizedHomework/, "tarea personalizada por alumno en un grupo");
  assert.match(ws, /\{countsAsClass && homeworkFields\.common && \(\n\s+<Block title="Tarea para la próxima clase">/, "visible aunque los participantes ya estén completados");
  // La revisión de tareas anteriores sigue siendo sólo de clases.
  assert.match(ws, /\{supportsHomework && showsPendingHomeworkReview/);
  assert.match(read("app/(app)/registro/[calendarLessonId]/page.tsx"), /if \(activityKindSupportsHomework\(detail\.registration\.activityKind\)\)/);
  // La ficha del alumno y la revisión en su próxima clase leen las tareas de cualquier registro que asigne (clase o entrenamiento).
  const repo = read("lib/repositories/lesson-registrations.ts");
  assert.match(repo, /activityKindAssignsHomework\(r\.activityKind\) && r\.id !==/);
  assert.doesNotMatch(repo, /activityKindSupportsHomework/);
});
