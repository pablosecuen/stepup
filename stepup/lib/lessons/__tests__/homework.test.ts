import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commonHomeworkTaskId,
  individualHomeworkTaskId,
  homeworkReviewSelectionKey,
  isHomeworkTaskResolved,
  getBlockingHomeworkTasks,
  type PendingHomeworkTask,
} from "../homework.ts";

test("commonHomeworkTaskId / individualHomeworkTaskId: forman la identidad estable exacta del móvil", () => {
  assert.equal(commonHomeworkTaskId("lr_1"), "common:lr_1");
  assert.equal(individualHomeworkTaskId("lr_1", "st_2"), "individual:lr_1:st_2");
});

test("isHomeworkTaskResolved: sólo 'realizada' y 'ya_no_corresponde' cierran la tarea", () => {
  assert.equal(isHomeworkTaskResolved("realizada"), true);
  assert.equal(isHomeworkTaskResolved("ya_no_corresponde"), true);
  assert.equal(isHomeworkTaskResolved("parcial"), false);
  assert.equal(isHomeworkTaskResolved("no_realizada"), false);
  assert.equal(isHomeworkTaskResolved(null), false);
  assert.equal(isHomeworkTaskResolved(undefined), false);
});

function task(overrides: Partial<PendingHomeworkTask> & { taskId: string; studentId: string }): PendingHomeworkTask {
  return {
    description: "Tarea de prueba",
    dueDate: null,
    originLessonRegistrationId: "lr_origin",
    assignedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("getBlockingHomeworkTasks: entrenamiento nunca bloquea, aunque haya tareas heredadas sin resolver (regresión 2026-09-12 del móvil)", () => {
  const tasks = [task({ taskId: "individual:lr_old:st_1", studentId: "st_1" })];
  const blocking = getBlockingHomeworkTasks("training", tasks, {});
  assert.deepEqual(blocking, [], "un entrenamiento grupal con tarea heredada nunca queda bloqueado");
});

test("getBlockingHomeworkTasks: una clase con tarea sin resolver sí bloquea", () => {
  const tasks = [task({ taskId: "individual:lr_old:st_1", studentId: "st_1" })];
  const blocking = getBlockingHomeworkTasks("class", tasks, {});
  assert.equal(blocking.length, 1);
});

test("getBlockingHomeworkTasks: una tarea con selección ya cargada no bloquea", () => {
  const t = task({ taskId: "individual:lr_old:st_1", studentId: "st_1" });
  const selections = { [homeworkReviewSelectionKey(t.taskId, t.studentId)]: "realizada" as const };
  const blocking = getBlockingHomeworkTasks("class", [t], selections);
  assert.deepEqual(blocking, []);
});

test("getBlockingHomeworkTasks: una tarea común comparte taskId entre alumnos pero se resuelve por separado", () => {
  const common = commonHomeworkTaskId("lr_old");
  const tasks = [task({ taskId: common, studentId: "st_1" }), task({ taskId: common, studentId: "st_2" })];
  const selections = { [homeworkReviewSelectionKey(common, "st_1")]: "realizada" as const };
  const blocking = getBlockingHomeworkTasks("class", tasks, selections);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].studentId, "st_2");
});
