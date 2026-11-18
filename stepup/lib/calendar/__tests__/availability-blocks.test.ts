// Señal visual de «Vacaciones / feriados» en el Calendario: sale de las mismas excepciones y de la misma regla de cobertura que la validación al crear o reprogramar una clase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availabilityBlocksForDays, fullDayBlockLabel, segmentTimeRange } from "../availability-blocks.ts";
import { evaluateAvailability, type AvailabilityException, type TeacherAvailability } from "../availability.ts";
import { weekDateKeys } from "../civil-calendar.ts";
import { addDaysToDateKey, localDateTimeToInstantIso } from "../timezone.ts";

const BA = "America/Argentina/Buenos_Aires";
const availability = (exceptions: AvailabilityException[], timezone = BA): TeacherAvailability => ({ schemaVersion: 1, timezone, weeklyBlocks: [], exceptions });
const holiday: AvailabilityException = { id: "feriado", date: "2026-11-23", type: "unavailable_full_day", reason: "holiday" };
const vacation: AvailabilityException = { id: "vacaciones", date: "2026-11-27", endDate: "2026-12-02", type: "unavailable_full_day", reason: "vacation" };
const partial: AvailabilityException = { id: "tramo", date: "2026-11-24", type: "unavailable_block", startTime: "14:00", endTime: "16:00", reason: "other" };
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const WEEK_OF_23 = weekDateKeys("2026-11-23");
const WEEK_OF_30 = weekDateKeys("2026-11-30");

test("un feriado de un día marca sólo ese día, con el rótulo «Feriado»", () => {
  const blocks = availabilityBlocksForDays(WEEK_OF_23, availability([holiday]));
  assert.deepEqual(Object.keys(blocks), ["2026-11-23"]);
  assert.equal(fullDayBlockLabel(blocks["2026-11-23"]), "Feriado");
  assert.deepEqual(blocks["2026-11-23"], [{ id: "feriado", reason: "holiday", label: "Feriado", startMinutes: 0, endMinutes: 1440, fullDay: true }]);
});

test("unas vacaciones de varios días cruzan semana y mes, con el último día INCLUIDO", () => {
  const first = availabilityBlocksForDays(WEEK_OF_23, availability([vacation]));
  assert.deepEqual(Object.keys(first), ["2026-11-27", "2026-11-28", "2026-11-29"], "viernes a domingo de la primera semana");
  const second = availabilityBlocksForDays(WEEK_OF_30, availability([vacation]));
  assert.deepEqual(Object.keys(second), ["2026-11-30", "2026-12-01", "2026-12-02"], "lunes a miércoles de la semana siguiente (ya en diciembre): el 2 de diciembre cuenta");
  assert.equal(fullDayBlockLabel(second["2026-12-02"]), "Vacaciones");
  assert.equal(second["2026-12-03"], undefined, "el día siguiente al último no está bloqueado");
});

test("un bloqueo de un solo horario marca únicamente ese tramo", () => {
  const blocks = availabilityBlocksForDays(WEEK_OF_23, availability([partial]));
  assert.deepEqual(Object.keys(blocks), ["2026-11-24"]);
  const [segment] = blocks["2026-11-24"];
  assert.equal(segment.startMinutes, 14 * 60);
  assert.equal(segment.endMinutes, 16 * 60);
  assert.equal(segment.fullDay, false);
  assert.equal(fullDayBlockLabel(blocks["2026-11-24"]), null, "sin rótulo de día completo");
  assert.equal(segmentTimeRange(segment), "14:00–16:00");
});

test("quitar el período quita su señal; sin excepciones no hay nada", () => {
  assert.deepEqual(availabilityBlocksForDays(WEEK_OF_23, availability([holiday, vacation])).hasOwnProperty("2026-11-23"), true);
  assert.deepEqual(availabilityBlocksForDays(WEEK_OF_23, availability([vacation])).hasOwnProperty("2026-11-23"), false);
  assert.deepEqual(availabilityBlocksForDays(WEEK_OF_23, availability([])), {});
});

test("datos dañados no rompen el Calendario: la excepción inutilizable se ignora", () => {
  const broken: AvailabilityException = { id: "roto", date: "no-es-fecha", type: "unavailable_full_day", reason: "vacation" };
  const inverted: AvailabilityException = { id: "invertido", date: "2026-11-25", type: "unavailable_block", startTime: "18:00", endTime: "17:00", reason: "other" };
  assert.deepEqual(availabilityBlocksForDays(WEEK_OF_23, availability([broken, inverted, holiday])), availabilityBlocksForDays(WEEK_OF_23, availability([holiday])));
});

test("la disponibilidad extra que ya anula un bloqueo al validar también lo recorta en la señal", () => {
  const extra: AvailabilityException = { id: "extra", date: "2026-11-23", type: "available_extra", startTime: "10:00", endTime: "12:00", reason: "other" };
  const blocks = availabilityBlocksForDays(WEEK_OF_23, availability([holiday, extra]));
  assert.deepEqual(blocks["2026-11-23"].map((segment) => [segment.startMinutes, segment.endMinutes, segment.fullDay]), [[0, 600, false], [720, 1440, false]]);
});

/** La señal y la validación usan la misma información: para toda hora de cada día, «hay tramo que se superpone» ⇔ `evaluateAvailability` rechaza por una excepción. */
test("la señal visual coincide con la validación de disponibilidad hora por hora, en cualquier zona de la cuenta", () => {
  const sets: AvailabilityException[][] = [[holiday], [vacation], [partial], [holiday, vacation, partial]];
  for (const timezone of [BA, "Pacific/Auckland", "America/Los_Angeles"]) {
    for (const exceptions of sets) {
      const data = availability(exceptions, timezone);
      for (const days of [WEEK_OF_23, WEEK_OF_30]) {
        const blocks = availabilityBlocksForDays(days, data);
        for (const day of days) {
          for (let hour = 0; hour < 24; hour += 1) {
            const start = localDateTimeToInstantIso({ date: day, hour, minute: 0, timeZone: BA });
            const end = new Date(Date.parse(start) + 3_600_000).toISOString();
            const evaluation = evaluateAvailability(start, end, data);
            const drawn = (blocks[day] ?? []).some((segment) => segment.startMinutes < (hour + 1) * 60 && segment.endMinutes > hour * 60);
            assert.equal(!evaluation.isAvailable, drawn, `${timezone} ${day} ${hour}:00`);
            if (drawn) assert.ok((blocks[day] ?? []).some((segment) => segment.id === evaluation.conflict?.sourceId), "el mismo período explica ambos");
          }
        }
      }
    }
  }
});

test("las fechas son civiles: ningún día se corre por una conversión a UTC", () => {
  // 23/11 en Argentina empieza a las 03:00 UTC: tomarlo como medianoche UTC lo correría un día.
  const blocks = availabilityBlocksForDays(["2026-11-22", "2026-11-23", "2026-11-24"], availability([holiday]));
  assert.deepEqual(Object.keys(blocks), ["2026-11-23"]);
  assert.equal(addDaysToDateKey("2026-11-30", 1), "2026-12-01");
});

test("cableado: el Calendario carga las excepciones guardadas, las pinta en Semana y Día y al guardar se actualiza sin cerrar sesión", () => {
  const page = read("app/(app)/calendario/page.tsx");
  assert.match(page, /getTeacherAvailability\(ctx\)/);
  assert.match(page, /availabilityBlocksForDays\(dayKeys, /);
  assert.match(page, /blocks=\{blocks\}/);
  const grid = read("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /fullDayBlockLabel\(blocks\?\.\[dayKey\]\)/);
  assert.match(grid, /data-availability-block/);
  assert.match(grid, /pointer-events-none/, "la señal no tapa los toques de la grilla");
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /export async function saveAvailabilityAction[\s\S]*?revalidatePath\("\/calendario"\)/, "guardar o quitar un período refresca el Calendario");
});
