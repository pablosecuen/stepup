import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTodayAgenda } from "../today-agenda.ts";
import { localDateKeyInTimeZone, ARGENTINA_TIME_ZONE } from "../../payments/dates.ts";
import type { CalendarViewItem } from "../../calendar/occurrences.ts";

/**
 * «Clases de hoy» de Inicio: el día civil COMPLETO de Argentina, cronológico y sin límites. Argentina es UTC−3 sin horario de verano:
 * el día 2026-10-14 va de 2026-10-14T03:00:00Z (incluida) a 2026-10-15T03:00:00Z (excluida).
 */
const TODAY = "2026-10-14";
const iso = (hhmm: string, day = TODAY) => {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 3, m)).toISOString();
};
let counter = 0;
function lesson(from: string, minutes: number, extra: Partial<CalendarViewItem> = {}, day = TODAY): CalendarViewItem {
  const start = iso(from, day);
  return {
    id: `l${++counter}`, recurrenceId: null, occurrenceKey: null, materializedLessonId: null, isMaterialized: true, studentId: "s", participantIds: [], studentName: "Alumno",
    level: "A1", lessonType: "individual", title: null, start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), modality: "online", status: "scheduled",
    activityKind: "class", isRecurring: false, freedByLessonId: null, notes: null, ...extra,
  } as unknown as CalendarViewItem;
}
const ids = (entries: ReturnType<typeof buildTodayAgenda>) => entries.map((e) => e.item.id);
const at = (hhmm: string) => new Date(iso(hhmm));

test("0, 1 y muchas clases: ninguna se corta, sin límite arbitrario ni «Ver todas»", () => {
  assert.deepEqual(buildTodayAgenda([], at("10:00"), TODAY), []);
  const one = [lesson("09:00", 60)];
  assert.equal(buildTodayAgenda(one, at("10:00"), TODAY).length, 1);
  const many = Array.from({ length: 40 }, (_, i) => lesson(`${String(7 + Math.floor(i / 3)).padStart(2, "0")}:${String((i % 3) * 20).padStart(2, "0")}`, 15));
  assert.equal(buildTodayAgenda(many, at("12:00"), TODAY).length, 40, "40 clases: las 40, de la primera a la última");
  assert.equal(buildTodayAgenda(many, at("12:00"), TODAY).length, many.length);
});

test("orden cronológico (inicio, fin e id), sin depender del orden de entrada; primera y última presentes", () => {
  const items = [lesson("18:30", 60), lesson("08:00", 60), lesson("13:00", 30), lesson("13:00", 60), lesson("21:45", 15)];
  const shuffled = [items[3], items[0], items[4], items[2], items[1]];
  const out = buildTodayAgenda(shuffled, at("12:00"), TODAY);
  assert.deepEqual(out.map((e) => e.item.start), [...out.map((e) => e.item.start)].sort());
  assert.equal(out[0].item.id, items[1].id, "la primera es la de las 08:00");
  assert.equal(out[out.length - 1].item.id, items[4].id, "la última es la de las 21:45");
  assert.deepEqual(ids(buildTodayAgenda(items, at("12:00"), TODAY)), ids(out), "el mismo resultado con cualquier orden de entrada");
  const sameStart = buildTodayAgenda([lesson("10:00", 60), lesson("10:00", 30)], at("09:00"), TODAY);
  assert.ok(new Date(sameStart[0].item.end) <= new Date(sameStart[1].item.end), "mismo inicio: primero la que termina antes");
});

test("límites de medianoche y zona horaria de Argentina: 00:00 y 23:59 de hoy entran; 23:59 de ayer y 00:00 de mañana no", () => {
  const first = lesson("00:00", 30);
  const last = lesson("23:59", 1);
  const yesterday = lesson("23:59", 1, {}, "2026-10-13");
  const tomorrow = lesson("00:00", 30, {}, "2026-10-15");
  const out = buildTodayAgenda([tomorrow, last, yesterday, first], at("12:00"), TODAY);
  assert.deepEqual(ids(out), [first.id, last.id]);
  // El mismo instante en UTC cae en otro día civil: 02:59Z del 15/10 es el 14/10 23:59 en Argentina; 03:00Z del 15/10 ya es el 15/10
  const utcEdgeIn = { ...lesson("10:00", 30), start: "2026-10-15T02:59:00.000Z", end: "2026-10-15T03:30:00.000Z" } as CalendarViewItem;
  const utcEdgeOut = { ...lesson("10:00", 30), start: "2026-10-15T03:00:00.000Z", end: "2026-10-15T03:30:00.000Z" } as CalendarViewItem;
  const utcStartIn = { ...lesson("10:00", 30), start: "2026-10-14T03:00:00.000Z", end: "2026-10-14T03:30:00.000Z" } as CalendarViewItem;
  const utcStartOut = { ...lesson("10:00", 30), start: "2026-10-14T02:59:00.000Z", end: "2026-10-14T03:30:00.000Z" } as CalendarViewItem;
  assert.deepEqual(ids(buildTodayAgenda([utcEdgeIn, utcEdgeOut, utcStartIn, utcStartOut], at("12:00"), TODAY)), [utcStartIn.id, utcEdgeIn.id]);
  // el día civil sale de la hora de Argentina, no de la del servidor (UTC)
  assert.equal(localDateKeyInTimeZone(new Date("2026-10-15T02:59:00Z"), ARGENTINA_TIME_ZONE), "2026-10-14");
  assert.equal(localDateKeyInTimeZone(new Date("2026-10-15T03:00:00Z"), ARGENTINA_TIME_ZONE), "2026-10-15");
});

test("nunca mezcla otros días aunque el cargador los entregue (mañana, ayer, semana pasada)", () => {
  const items = [lesson("09:00", 60, {}, "2026-10-13"), lesson("09:00", 60), lesson("09:00", 60, {}, "2026-10-15"), lesson("09:00", 60, {}, "2026-10-07")];
  const out = buildTodayAgenda(items, at("08:00"), TODAY);
  assert.equal(out.length, 1);
  assert.equal(out[0].item.id, items[1].id);
});

test("estados reales: canceladas, reprogramadas, completadas, transcurridas, en curso y próximas se conservan (nada se oculta por su estado)", () => {
  const items = [
    lesson("08:00", 60, { status: "completed" }),
    lesson("09:30", 60, { status: "cancelled" }),
    lesson("10:00", 60, { status: "rescheduled" }),
    lesson("12:00", 60),
    lesson("15:00", 60),
  ];
  const out = buildTodayAgenda(items, at("12:30"), TODAY);
  assert.equal(out.length, 5, "las cinco están, también la cancelada");
  assert.deepEqual(out.map((e) => [e.item.status, e.timing]), [["completed", "finished"], ["cancelled", "finished"], ["rescheduled", "finished"], ["scheduled", "in_progress"], ["scheduled", "upcoming"]]);
  // límites del reloj (mitad abierta): en el instante exacto del inicio está en curso y en el del final ya terminó
  assert.equal(buildTodayAgenda([lesson("12:00", 60)], at("12:00"), TODAY)[0].timing, "in_progress");
  assert.equal(buildTodayAgenda([lesson("12:00", 60)], at("13:00"), TODAY)[0].timing, "finished");
  assert.equal(buildTodayAgenda([lesson("12:00", 60)], at("11:59"), TODAY)[0].timing, "upcoming");
});

test("la agenda válida del Calendario: una cancelada con reemplazo activo se oculta y se ve sólo el reemplazo; la cancelada sola se muestra", () => {
  const original = lesson("11:00", 60, { status: "cancelled", id: "orig" });
  const replacement = lesson("11:00", 60, { id: "repl", freedByLessonId: "orig" });
  const alone = lesson("16:00", 60, { status: "cancelled", id: "alone" });
  const out = buildTodayAgenda([original, replacement, alone], at("08:00"), TODAY);
  assert.deepEqual(ids(out), ["repl", "alone"]);
});

test("no modifica la entrada y es determinista (mismos datos, mismo resultado)", () => {
  const items = [lesson("14:00", 60), lesson("09:00", 60)];
  const copy = JSON.stringify(items);
  const a = buildTodayAgenda(items, at("12:00"), TODAY);
  const b = buildTodayAgenda(items, at("12:00"), TODAY);
  assert.equal(JSON.stringify(items), copy);
  assert.deepEqual(ids(a), ids(b));
});
