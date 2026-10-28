// Circuito WEB de «Clase en curso»: las reglas del diálogo, el contador, la puntualidad y el aviso, ejecutadas sobre el código que usa la pantalla (reglas idénticas a las del original en
// `lib/payments/engine`), más el cableado de la acción, la tarjeta y la carga de Inicio. Las operaciones de base se prueban en Postgres real (`supabase/tests/postgres/live_class_sessions.cjs`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  arrivalFromChoice,
  arrivalFromLateTime,
  arrivalQuestion,
  ARRIVAL_CHOICES,
  canStartLiveClass,
  describeArrival,
  earlyStartMessage,
  elapsedMinutes,
  instantFromClockTime,
  liveClassClock,
  minutesStartingEarly,
} from "../live-class.ts";
import { buildLiveClassNotification, LIVE_CLASS_NOTIFICATION_REFRESH_MS, LIVE_CLASS_NOTIFICATION_TAG } from "../notification.ts";
import { buildPunctualitySummary } from "../../payments/engine/features/new-class/utils/punctualityScoring.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
// 12:00 en Argentina (UTC-3) = 15:00Z.
const START = "2026-10-28T15:00:00.000Z";

test("el diálogo ofrece las seis respuestas del original, con sus textos y en su orden", () => {
  assert.deepEqual(
    ARRIVAL_CHOICES.map((entry) => entry.label),
    ["Sí, llegó a horario", "Llegó dentro de la tolerancia", "Llegó tarde", "La profesora retrasó la clase", "Habíamos acordado otro horario", "Registrar después"],
  );
  assert.equal(arrivalQuestion(["Ana", "Luis"]), "¿Ana, Luis llegó a horario?");
});

test("las cinco respuestas sin hora fijan su estado sin inferir nada del momento del toque", () => {
  for (const choice of ["on_time", "within_grace", "teacher_delayed", "mutual_adjustment", "unknown"] as const) {
    assert.deepEqual(arrivalFromChoice(choice), { status: choice, lateMinutes: 0, manuallyCorrected: false });
  }
});

test("«Llegó tarde» se clasifica contra el horario EFECTIVO: 12 minutos tarde, o a horario si la hora es igual o anterior", () => {
  assert.deepEqual(arrivalFromLateTime("2026-10-28T15:12:00.000Z", START), { arrivedAt: "2026-10-28T15:12:00.000Z", status: "late", lateMinutes: 12, manuallyCorrected: false });
  assert.equal(arrivalFromLateTime(START, START).status, "on_time");
  assert.equal(arrivalFromLateTime("2026-10-28T14:50:00.000Z", START).lateMinutes, 0);
});

test("comenzar antes del horario pide confirmación con el texto del original; a horario o tarde no", () => {
  assert.equal(minutesStartingEarly("2026-10-28T14:45:00.000Z", START), 15);
  assert.equal(minutesStartingEarly(START, START), 0);
  assert.equal(minutesStartingEarly("2026-10-28T15:20:00.000Z", START), 0);
  assert.equal(earlyStartMessage(15), "Estás comenzando 15 minutos antes.");
  assert.equal(earlyStartMessage(1), "Estás comenzando 1 minuto antes.");
});

test("la hora escrita a mano se combina con el día de la clase en hora de Argentina; una hora inválida se rechaza", () => {
  assert.equal(instantFromClockTime(START, "12:10"), "2026-10-28T15:10:00.000Z");
  assert.equal(instantFromClockTime("2026-10-28T02:30:00.000Z", "23:45"), "2026-10-28T02:45:00.000Z", "02:30Z sigue siendo el 27 en Argentina (23:30 del 27): 23:45 es del 27");
  for (const bad of ["25:00", "12:60", "", "abc", "9:5"]) assert.equal(instantFromClockTime(START, bad), null, bad);
});

test("el contador: cuenta regresiva, «+mm:ss» de tiempo extra y barra que nunca pasa de 100 %", () => {
  const session = { startedAt: START, scheduledDurationMinutes: 60 };
  const early = liveClassClock(session, new Date("2026-10-28T15:30:00.000Z"));
  assert.deepEqual([early.countdown, early.isOvertime, early.progress], ["30:00", false, 0.5]);
  const over = liveClassClock(session, new Date("2026-10-28T16:05:00.000Z"));
  assert.deepEqual([over.countdown, over.isOvertime, over.progress], ["+05:00", true, 1]);
  assert.equal(liveClassClock(session, new Date("2026-10-28T14:59:00.000Z")).progress, 0, "antes del inicio la barra no es negativa");
});

test("los minutos reales se redondean y nunca son menos de 1", () => {
  assert.equal(elapsedMinutes(START, new Date("2026-10-28T15:00:10.000Z")), 1);
  assert.equal(elapsedMinutes(START, new Date("2026-10-28T15:47:40.000Z")), 48);
});

test("la puntualidad se muestra siempre con texto", () => {
  assert.equal(describeArrival({ status: "late", lateMinutes: 12, manuallyCorrected: false }), "Llegó 12 minutos tarde");
  assert.equal(describeArrival({ status: "late", lateMinutes: 1, manuallyCorrected: false }), "Llegó 1 minuto tarde");
  assert.equal(describeArrival({ status: "unknown", lateMinutes: 0, manuallyCorrected: false }), "Puntualidad sin registrar");
  assert.equal(describeArrival({ status: "teacher_delayed", lateMinutes: 0, manuallyCorrected: false }), "La profesora retrasó la clase");
});

test("sólo puede haber una clase en curso: comenzar otra no está permitido, repetir la misma sí", () => {
  assert.equal(canStartLiveClass(null, "a"), true);
  assert.equal(canStartLiveClass({ calendarLessonId: "a" }, "a"), true);
  assert.equal(canStartLiveClass({ calendarLessonId: "a" }, "b"), false);
});

test("el aviso del navegador usa el título y el texto de la notificación de Android del original", () => {
  const session = { studentNames: ["Ana", "Luis"], startedAt: START, scheduledDurationMinutes: 60 };
  assert.deepEqual(buildLiveClassNotification(session, new Date("2026-10-28T15:25:00.000Z")), { title: "Clase en curso — Ana, Luis", body: "Quedan 35:00 de 60 min" });
  assert.equal(buildLiveClassNotification(session, new Date("2026-10-28T16:03:00.000Z")).body, "Tiempo extra: +03:00");
  assert.equal(LIVE_CLASS_NOTIFICATION_REFRESH_MS, 30_000);
  assert.equal(LIVE_CLASS_NOTIFICATION_TAG, "active-class-session");
});

test("la puntualidad guardada por «Comenzar clase» alimenta el puntaje del original (3 clases mínimo; ‘la profesora retrasó’ no cuenta)", () => {
  const entry = (date: string, status: "on_time" | "late" | "teacher_delayed", lateMinutes = 0) => ({ date, arrival: { status, lateMinutes, manuallyCorrected: false }, isCancelled: false, isFuture: false });
  assert.equal(buildPunctualitySummary([entry("2026-10-01", "on_time"), entry("2026-10-08", "late", 15)]).category, "insuficiente");
  const summary = buildPunctualitySummary([entry("2026-10-01", "on_time"), entry("2026-10-08", "on_time"), entry("2026-10-15", "late", 15), entry("2026-10-22", "teacher_delayed")]);
  assert.equal(summary.evaluatedClasses, 3, "teacher_delayed queda fuera");
  assert.equal(summary.lateArrivalsCount, 1);
});

test("las funciones retiradas no se ofrecen en la interfaz", () => {
  assert.doesNotMatch(read("components/dashboard/day-planner.tsx"), /StartClassButton|ActiveClassCard|ScheduleAdjustDialog|getLivePreferencesAction/);
  assert.doesNotMatch(read("components/calendar/real-lesson-detail-modal.tsx"), /ScheduleAdjustDialog|Ajustar horario/);
  assert.doesNotMatch(read("components/account/configuration-view.tsx"), /LiveTrackingPreference/);
  assert.doesNotMatch(read("app/(app)/layout.tsx"), /LiveClassGlobal/);
  assert.doesNotMatch(read("lib/dashboard/load-home-data.ts"), /getLiveClassSession/);
  assert.doesNotMatch(read("components/registro/registration-form-parts.tsx"), /'Mostrar'|'Ocultar'/);
});

test("cableado: la tarjeta finaliza/descarta con la red protegida, cierra el aviso y lleva al registro", () => {
  const card = read("components/dashboard/active-class-card.tsx");
  for (const action of ["finishLiveClassAction", "discardLiveClassAction", "correctLiveClassStartAction"]) assert.ok(card.includes(`guardNetwork(() => ${action}(`), action);
  assert.match(card, /router\.push\(`\/registro\/\$\{result\.data\.calendarLessonId\}`\)/);
  assert.equal((card.match(/closeLiveClassNotification\(\)/g) ?? []).length, 2, "al finalizar y al descartar");
  assert.match(card, /!session\.lessonStillScheduled/);
  assert.match(read("components/dashboard/start-class-dialog.tsx"), /requestLiveClassNotificationPermission\(\)/);
});

test("el service worker es sólo de notificaciones: sin manejador de fetch ni caché", () => {
  const worker = read("public/sw.js");
  assert.doesNotMatch(worker, /addEventListener\(\s*["']fetch["']/);
  assert.doesNotMatch(worker, /caches\./);
  assert.match(worker, /notificationclick/);
});

test("Puntualidad del alumno: sólo cuentan las clases FINALIZADAS que cuentan como clase; lo guardado con forma rara es «sin dato»", async () => {
  const { buildStudentPunctuality, buildStudentPunctualityEntries, readStudentArrival } = await import("../punctuality.ts");
  const registration = (day: string, over: Record<string, unknown> = {}) => ({
    status: "completed",
    countsAsClass: true,
    scheduledStartAt: `2026-10-${day}T15:00:00.000Z`,
    actualStartedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    studentArrival: { status: "on_time", lateMinutes: 0, manuallyCorrected: false },
    ...over,
  });
  const regs = [
    registration("01"),
    registration("08"),
    registration("15", { studentArrival: { status: "late", lateMinutes: 15, manuallyCorrected: false } }),
    registration("16", { status: "in_progress" }), // borrador: no cuenta
    registration("17", { countsAsClass: false }), // cancelada tarde: no cuenta
    registration("18", { studentArrival: null }), // sin dato: no cuenta
    registration("19", { studentArrival: { status: "inventado", lateMinutes: 0, manuallyCorrected: false } }), // forma rara: sin dato
    registration("30"), // futura respecto de «hoy»
  ];
  const entries = buildStudentPunctualityEntries(regs, "2026-10-28");
  assert.equal(entries.length, 7, "el borrador queda fuera desde el principio");
  const summary = buildStudentPunctuality(regs, "2026-10-28");
  assert.equal(summary.evaluatedClasses, 3);
  assert.equal(summary.lateArrivalsCount, 1);
  assert.equal(summary.onTimeOrGracePercent, 67);
  assert.equal(summary.averageLateMinutes, 15);
  assert.deepEqual(summary.monthlyEvolution, [{ monthKey: "2026-10", averageScore: 87 }]);
  assert.equal(readStudentArrival({ status: "late", lateMinutes: -1, manuallyCorrected: false }), null);
  assert.equal(readStudentArrival(undefined), null);
  assert.equal(buildStudentPunctuality([], "2026-10-28").category, "insuficiente");
});

test("cableado: la pestaña Clases del alumno muestra la puntualidad calculada con los registros reales", () => {
  assert.match(read("components/students/profile/student-profile-view.tsx"), /buildStudentPunctuality\(data\.registrations, todayInArgentina\(\)\)/);
  assert.match(read("lib/repositories/lesson-registrations-mapping.ts"), /studentArrival: row\.student_arrival \?\? null/);
});
