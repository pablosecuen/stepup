import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ALL_QUARTER_TIMES, buildSlotIgnore, classifyDay, isPrimarySlotTime, primaryTimeFor, PRIMARY_SLOT_TIMES, quickPickTimes } from "../time-slot-picker.ts";
import { daySlots, type SlotItem } from "../parity.ts";
import { decideTapAction, INITIAL_TAP_TRACKER_STATE } from "../../original-core/features/calendar/utils/timeSlotQuickPick.ts";
import { localDateTimeToInstantIso } from "../timezone.ts";
import type { TeacherAvailability } from "../availability.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const TZ = "America/Argentina/Buenos_Aires";
const at = (date: string, time: string) => localDateTimeToInstantIso({ date, hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)), timeZone: TZ });
const open: TeacherAvailability = { schemaVersion: 1, timezone: TZ, weeklyBlocks: [], exceptions: [] };

test("grilla principal de 30 minutos (08:00–21:30) y todos los cuartos de hora alcanzables con el selector rápido", () => {
  assert.equal(PRIMARY_SLOT_TIMES.length, 28);
  assert.equal(PRIMARY_SLOT_TIMES[0], "08:00");
  assert.equal(PRIMARY_SLOT_TIMES.at(-1), "21:30");
  assert.ok(PRIMARY_SLOT_TIMES.every((time) => /:(00|30)$/.test(time)));
  assert.equal(ALL_QUARTER_TIMES.length, 56);
  assert.deepEqual(ALL_QUARTER_TIMES.slice(0, 4), ["08:00", "08:15", "08:30", "08:45"]);
  assert.deepEqual([...ALL_QUARTER_TIMES], daySlots("2026-11-04", 60, [], open).map((slot) => slot.time), "los mismos 56 inicios que evalúa el servidor de disponibilidad");
});

test("selector rápido de la app original: el inicio tocado y ese inicio + 15 minutos, sin cambiar nada más", () => {
  assert.deepEqual(quickPickTimes("18:00"), ["18:00", "18:15"]);
  assert.deepEqual(quickPickTimes("18:30"), ["18:30", "18:45"]);
  assert.deepEqual(quickPickTimes("21:30"), ["21:30", "21:45"]);
  assert.equal(primaryTimeFor("18:15"), "18:00");
  assert.equal(primaryTimeFor("18:45"), "18:30");
  assert.equal(primaryTimeFor("18:30"), "18:30");
  assert.ok(isPrimarySlotTime("18:00") && !isPrimarySlotTime("18:15"));
  // doble toque sobre el mismo horario dentro de la ventana abre el selector rápido; el primer toque selecciona al instante
  const first = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 18, minute: 0 }, 1000);
  assert.equal(first.kind, "select");
  assert.equal(decideTapAction(first.state, { hour: 18, minute: 0 }, 1200).kind, "open_quick_pick");
  assert.equal(decideTapAction(first.state, { hour: 18, minute: 30 }, 1200).kind, "select", "otro horario");
  assert.equal(decideTapAction(first.state, { hour: 18, minute: 0 }, 1400).kind, "select", "fuera de la ventana");
});

test("se evalúa la DURACIÓN completa: un inicio libre no alcanza si la clase termina sobre otra", () => {
  const other = { id: "otra", start: at("2026-11-04", "19:00"), end: at("2026-11-04", "20:00"), status: "scheduled", studentName: "Otra", occupiesSlot: true } as SlotItem;
  const slots = daySlots("2026-11-04", 90, [other], open);
  const by = (time: string) => slots.find((slot) => slot.time === time);
  assert.equal(by("17:45")?.available, false, "17:45 + 90 min termina 19:15 y pisa la clase de las 19:00");
  assert.equal(by("17:30")?.available, true, "17:30 + 90 min termina justo a las 19:00");
  assert.equal(by("20:00")?.available, true, "al terminar la otra clase queda libre");
  assert.deepEqual(by("18:30")?.occupied, ["Otra"], "se informa con quién choca");
});

test("un bloqueo de disponibilidad se identifica y se distingue de una clase ocupada", () => {
  const blocked: TeacherAvailability = { ...open, weeklyBlocks: [{ id: "b", weekday: 2, startTime: "12:00", endTime: "14:00", reason: "work" }] };
  const slot = daySlots("2026-11-04", 60, [], blocked).find((s) => s.time === "12:30");
  assert.equal(slot?.available, false);
  assert.deepEqual(slot?.occupied, []);
  assert.match(slot?.blocked ?? "", /Trabajo/);
});

test("al mover una clase no cuenta como ocupada ni ella ni (en «esta y las siguientes») su propia sesión de la serie; las demás clases y sesiones SÍ ocupan", () => {
  const mk = (id: string, date: string, time: string, recurrenceId: string | null) => ({ id, start: at(date, time), end: new Date(Date.parse(at(date, time)) + 3_600_000).toISOString(), status: "scheduled", studentName: id, occupiesSlot: true, recurrenceId }) as SlotItem;
  const own = mk("propia", "2026-11-02", "18:00", "serie"); // la clase que se mueve (lunes)
  const nextWeek = mk("siguiente", "2026-11-09", "18:00", "serie"); // misma sesión, la semana siguiente: la operación la reemplaza
  const sibling = mk("hermana", "2026-11-04", "18:00", "serie"); // OTRA sesión de la serie (miércoles): sigue ocupando
  const foreign = mk("ajena", "2026-11-06", "18:00", "otra-serie");
  const ignore = buildSlotIgnore({ ignoreId: "propia", series: { lineage: ["serie"], fromInstant: own.start, originalStartIso: own.start, timeZone: TZ } }) as (item: SlotItem) => boolean;
  assert.equal(ignore(own), true);
  assert.equal(ignore(nextWeek), true);
  assert.equal(ignore(sibling), false, "la otra sesión de la serie no se reemplaza");
  assert.equal(ignore(foreign), false, "otra serie siempre ocupa");
  assert.equal((buildSlotIgnore({ ignoreId: "propia" }) as (item: SlotItem) => boolean)(nextWeek), false, "«solo esta clase» ignora únicamente la propia");
  const slots = daySlots("2026-11-04", 60, [own, nextWeek, sibling, foreign], open, ignore);
  assert.equal(slots.find((slot) => slot.time === "18:00")?.available, false, "el miércoles 18:00 lo ocupa la sesión hermana");
});

test("días coloreados: amplio, limitado, sin horarios y pasado — cada estado tiene su texto", () => {
  assert.equal(classifyDay(40, false), "wide");
  assert.equal(classifyDay(21, false), "wide");
  assert.equal(classifyDay(20, false), "limited");
  assert.equal(classifyDay(1, false), "limited");
  assert.equal(classifyDay(0, false), "none");
  assert.equal(classifyDay(50, true), "past");
});

test("mantener presionado NUNCA cambia la duración ni selecciona al soltar; hay alternativa visible y por teclado", () => {
  const picker = read("components/calendar/availability-picker.tsx");
  assert.doesNotMatch(picker, /onDurationChange|duration \+ 15|Sumar 15 minutos de duración/, "el selector ya no toca la duración");
  const grid = read("components/calendar/time-slot-grid.tsx");
  assert.match(grid, /LONG_PRESS_MS = 450/);
  assert.match(grid, /decideTapAction\(/, "doble toque de la app original");
  assert.match(grid, /if \(press\.current\.fired\) \{\s*press\.current\.fired = false;\s*return;\s*\}/, "soltar tras mantener presionado no selecciona");
  assert.match(grid, /Mostrar :15 y :45/, "alternativa visible sin gesto");
  assert.match(grid, /event\.key === "ContextMenu" \|\| \(event\.shiftKey && event\.key === "F10"\)/, "alternativa de teclado");
  assert.match(grid, /aria-disabled=\{!pickable\}/, "un horario no elegible sigue enfocable y anunciado");
  assert.match(grid, /\$\{time\}, \$\{status\}/, "el estado va escrito en la etiqueta accesible");
});

// Prueba DIFERENCIAL: el puerto de producción coincide con la copia de referencia del original (última versión de timeSlotQuickPick y calendarTimeSlots).
import * as port from "../time-slot-quick-pick.ts";
import * as original from "../../original-core/features/calendar/utils/timeSlotQuickPick.ts";
import * as originalSlots from "../../original-core/features/calendar/utils/calendarTimeSlots.ts";

test("diferencial contra el original: mismas constantes, grilla, opciones rápidas y decisión de toque", () => {
  assert.equal(port.TIME_SLOT_QUICK_PICK_STEP_MINUTES, original.TIME_SLOT_QUICK_PICK_STEP_MINUTES);
  assert.equal(port.TIME_SLOT_DOUBLE_TAP_WINDOW_MS, original.TIME_SLOT_DOUBLE_TAP_WINDOW_MS);
  assert.deepEqual(port.buildTimeSlots(), originalSlots.buildTimeSlots());
  for (const slot of port.buildTimeSlots()) {
    assert.deepEqual(port.buildQuickPickOptions(slot.hour, slot.minute), original.buildQuickPickOptions(slot.hour, slot.minute));
    for (const gap of [0, 100, 250, 251, 900]) {
      const base = port.decideTapAction(port.INITIAL_TAP_TRACKER_STATE, slot, 1000).state;
      assert.deepEqual(port.decideTapAction(base, slot, 1000 + gap), original.decideTapAction(base, slot, 1000 + gap));
    }
  }
});
