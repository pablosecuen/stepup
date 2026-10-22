import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  firstOpenParticipant,
  formatGroupProgressLabel,
  formatMissingParticipants,
  formatParticipantNamesSentence,
  homeworkFieldsFor,
  initialAttendanceStatus,
  initialDurationMinutes,
  isGroupRegistration,
  isStudentHomeworkPersonalized,
  resolveRegistrationHeader,
  showsPendingHomeworkReview,
  summarizeGroupRegistration,
} from "../registration-form.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");

test("el encabezado lo encabeza el alumno (individual) o el grupo, nunca el primer alumno de un grupo", () => {
  const individual = resolveRegistrationHeader({ participantNames: ["Agostina Staffieri"], classTitle: "Inglés martes", kindLabel: "Clase", isRecurring: true });
  assert.equal(individual.title, "Agostina Staffieri");
  assert.equal(individual.typeLine, "Clase individual · Serie recurrente");
  assert.equal(individual.participantsLine, null);

  const group = resolveRegistrationHeader({ participantNames: ["Ana", "Beto", "Carla"], classTitle: "  Grupo B2  ", kindLabel: "Entrenamiento", isRecurring: false });
  assert.equal(group.title, "Grupo B2");
  assert.equal(group.typeLine, "Entrenamiento grupal · Clase suelta");
  assert.equal(group.participantsLine, "Ana, Beto y Carla");

  assert.equal(resolveRegistrationHeader({ participantNames: ["Ana", "Beto"], classTitle: null, kindLabel: "Clase", isRecurring: false }).title, "Clase grupal");
  assert.equal(resolveRegistrationHeader({ participantNames: [], kindLabel: "Clase", isRecurring: false }).title, "Clase individual");
});

test("quiénes participan: se lista hasta tres y el resto se cuenta", () => {
  assert.equal(formatParticipantNamesSentence([]), "");
  assert.equal(formatParticipantNamesSentence(["Ana"]), "Ana");
  assert.equal(formatParticipantNamesSentence(["Ana", "Beto"]), "Ana y Beto");
  assert.equal(formatParticipantNamesSentence(["Ana", "Beto", "Carla"]), "Ana, Beto y Carla");
  assert.equal(formatParticipantNamesSentence(["Ana", "Beto", "Carla", "Dani"]), "Ana, Beto, Carla y +1 alumno");
  assert.equal(formatParticipantNamesSentence(["A", "B", "C", "D", "E"]), "A, B, C y +2 alumnos");
  assert.equal(isGroupRegistration(1), false);
  assert.equal(isGroupRegistration(2), true);
});

test("la tarea: una sola caja en la clase individual; en un grupo, además una personalizada por alumno; un entrenamiento ninguna", () => {
  assert.deepEqual(homeworkFieldsFor({ supportsHomework: true, isGroup: false }), { common: true, personalizedPerStudent: false, pendingReview: true });
  assert.deepEqual(homeworkFieldsFor({ supportsHomework: true, isGroup: true }), { common: true, personalizedPerStudent: true, pendingReview: true });
  assert.deepEqual(homeworkFieldsFor({ supportsHomework: false, isGroup: true }), { common: false, personalizedPerStudent: false, pendingReview: false });
  assert.deepEqual(homeworkFieldsFor({ supportsHomework: false, isGroup: false }), { common: false, personalizedPerStudent: false, pendingReview: false });
});

test("la revisión de la tarea anterior en un grupo sólo aparece si el alumno vino; en la clase individual siempre", () => {
  assert.equal(showsPendingHomeworkReview({ isGroup: false, attendanceStatus: null }), true);
  assert.equal(showsPendingHomeworkReview({ isGroup: true, attendanceStatus: null }), false);
  assert.equal(showsPendingHomeworkReview({ isGroup: true, attendanceStatus: "presente" }), true);
  assert.equal(showsPendingHomeworkReview({ isGroup: true, attendanceStatus: "tarde" }), true);
  assert.equal(showsPendingHomeworkReview({ isGroup: true, attendanceStatus: "ausente" }), false);
  assert.equal(showsPendingHomeworkReview({ isGroup: true, attendanceStatus: "ausente_aviso" }), false);
});

test("asistencia inicial: la clase individual realizada no la pregunta (presente) y un valor guardado nunca se pisa; el grupo arranca sin elegir", () => {
  assert.equal(initialAttendanceStatus(null, false), "presente");
  assert.equal(initialAttendanceStatus("tarde", false), "tarde");
  assert.equal(initialAttendanceStatus("ausente", false), "ausente");
  assert.equal(initialAttendanceStatus(null, true), null);
  assert.equal(initialAttendanceStatus("presente", true), "presente");
});

test("el próximo alumno que se abre: primero los pendientes, después los omitidos; ninguno si ya están todos completos", () => {
  const order = ["a", "b", "c"];
  assert.equal(firstOpenParticipant(order, { a: "completed", b: "pending", c: "pending" }), "b");
  assert.equal(firstOpenParticipant(order, { a: "omitted", b: "completed", c: "pending" }), "c");
  assert.equal(firstOpenParticipant(order, { a: "omitted", b: "completed", c: "completed" }), "a");
  assert.equal(firstOpenParticipant(order, { a: "completed", b: "completed", c: "completed" }), null);
  assert.equal(firstOpenParticipant(order, {}), "a", "sin estado cargado todos están pendientes");
});

test("textos de avance y resumen del grupo", () => {
  assert.equal(formatGroupProgressLabel(1, 3), "1 de 3 alumnos completados");
  assert.equal(formatMissingParticipants(1), "Faltan 1 alumno por completar");
  assert.equal(formatMissingParticipants(2), "Faltan 2 alumnos por completar");
  const summary = summarizeGroupRegistration([
    { attendanceStatus: "presente", homeworkDescription: "" },
    { attendanceStatus: "tarde", homeworkDescription: "  " },
    { attendanceStatus: "ausente_aviso", homeworkDescription: "Unidad 5" },
    { attendanceStatus: "ausente", homeworkDescription: "" },
    { attendanceStatus: null, homeworkDescription: "" },
  ]);
  assert.deepEqual(summary, { present: 1, late: 1, absentWithNotice: 1, absent: 1, total: 5, personalizedHomework: 1 });
  assert.equal(isStudentHomeworkPersonalized("  "), false);
  assert.equal(isStudentHomeworkPersonalized("Unidad 5"), true);
});

test("la duración real inicial es la real si existe (registro finalizado o progreso guardado); si no, la programada", () => {
  const scheduled = { scheduledStartAt: "2026-10-21T13:00:00.000Z", scheduledEndAt: "2026-10-21T14:00:00.000Z" };
  assert.equal(initialDurationMinutes({ ...scheduled, actualStartedAt: null, actualEndedAt: null }), 60);
  assert.equal(initialDurationMinutes({ ...scheduled, actualStartedAt: "2026-10-21T13:00:00.000Z", actualEndedAt: "2026-10-21T14:30:00.000Z" }), 90);
  assert.equal(initialDurationMinutes({ ...scheduled, actualStartedAt: "2026-10-21T13:00:00.000Z", actualEndedAt: null }), 60);
  assert.equal(initialDurationMinutes({ scheduledStartAt: "2026-10-21T13:00:00.000Z", scheduledEndAt: "2026-10-21T13:00:00.000Z", actualStartedAt: null, actualEndedAt: null }), 60);
});

test("el formulario respeta el orden de la app: individual y grupal, sin duplicar la tarea", () => {
  const source = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  const at = (needle: string) => {
    const index = source.indexOf(needle);
    assert.ok(index >= 0, `falta: ${needle}`);
    return index;
  };
  // Clase individual: tarea pendiente → duración → evaluación → contenido → observaciones internas → tarea para la próxima clase.
  const order = ["<PendingHomeworkReview", "Duración real (minutos)", '<Block title="Evaluación">', "<PedagogicalContentEditor", "<InternalNotesCard", '<Block title="Tarea para la próxima clase">'].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "el orden del formulario individual cambió");
  // Grupo: duración → contenido → participantes → observaciones internas → tarea → resumen → acciones.
  const group = ["Duración real (minutos)", "<PedagogicalContentEditor", 'aria-label="Participantes"', "<InternalNotesCard", '<Block title="Tarea para la próxima clase">', '<Block title="Resumen" anchorId={SUMMARY_ANCHOR_ID}>', ': "Guardar progreso"}'].map(at);
  assert.deepEqual([...group].sort((a, b) => a - b), group, "el orden del formulario grupal cambió");
  // La tarea común ya no se rotula «para todo el grupo» ni se ofrece en una clase individual junto a otra tarea del alumno.
  assert.ok(!source.includes("Tarea común para todo el grupo"));
  assert.ok(!source.includes("Tarea individual nueva"));
  assert.ok(!source.includes("Guardar sin completar"), "la app no tiene esa acción: «Guardar progreso» la reemplaza");
  const parts = read("components/registro/registration-form-parts.tsx");
  assert.match(parts, /Personalizar tarea para este alumno/);
  // La tarea personalizada sólo existe dentro de la tarjeta de cada participante del grupo.
  const card = source.slice(at("function ParticipantCard"), at("export function RegistrationWorkspace"));
  assert.match(card, /<PersonalizedHomework/);
  assert.ok(!source.slice(at("export function RegistrationWorkspace")).includes("<PersonalizedHomework"), "una clase individual nunca ofrece una segunda tarea del alumno");
});

test("el encabezado de las pantallas de registro nombra al alumno o al grupo antes que el contenido", () => {
  const page = read("app/(app)/registro/[calendarLessonId]/page.tsx");
  assert.match(page, /resolveRegistrationHeader\(/);
  assert.match(page, /title=\{header\.title\}/);
  assert.match(page, /lines=\{\[header\.typeLine/);
  assert.ok(!page.includes('classTitle?.trim() || "Registrar clase"'), "el título ya no cae en «Registrar clase» sin nombrar al alumno");
});
