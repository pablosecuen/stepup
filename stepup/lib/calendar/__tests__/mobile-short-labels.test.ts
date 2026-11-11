import { test } from "node:test";
import assert from "node:assert/strict";
import * as layout from "../layout.ts";
import { planMobileDay, placeVariableLabels, wrapWords, fitCardText } from "../mobile-short-labels.ts";
import type { CalendarViewItem } from "../occurrences.ts";
import type { LabelSource } from "../short-labels.ts";

const HOUR = 50;
const GRID = 14 * HOUR;
let seq = 0;
function lesson(hhmm: string, minutes: number, name: string, extra: Partial<CalendarViewItem> = {}): CalendarViewItem {
  const [h, m] = hhmm.split(":").map(Number);
  const start = Date.parse(`2026-11-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`);
  const id = `l${++seq}`;
  return { id, recurrenceId: null, occurrenceKey: null, materializedLessonId: id, isMaterialized: true, studentId: id, participantIds: [id], studentName: name, level: "", lessonType: "individual", title: null, start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString(), modality: "online", status: "scheduled", activityKind: "class", isRecurring: false, freedByLessonId: null, notes: null, ...extra } as CalendarViewItem;
}
function plan(items: CalendarViewItem[], colW = 70, dayView = false) {
  const positioned = layout.layoutDayItems(items, HOUR);
  const sources = new Map<string, LabelSource>(items.map((item) => [item.id, { id: item.id, title: item.title?.trim() || item.studentName, timeText: "", stateText: item.status === "cancelled" ? "Cancel." : item.status === "rescheduled" ? "Reprog." : null }]));
  return { positioned, sources, ...planMobileDay(positioned, sources, colW, GRID, dayView) };
}

test("wrapWords: palabras enteras, nunca por letras; lo que no entra lleva «…»", () => {
  assert.deepEqual(wrapWords("Camila Quince", 47, 11, 3), { lines: ["Camila", "Quince"], truncated: false });
  assert.deepEqual(wrapWords("Ana Cinco", 100, 11, 3), { lines: ["Ana Cinco"], truncated: false });
  const long = wrapWords("María de los Ángeles Fernández Villanueva", 47, 11, 2);
  assert.equal(long.truncated, true);
  assert.equal(long.lines.length, 2);
  assert.ok(long.lines[1].endsWith("…"), "el recorte se ve");
  // Una palabra más ancha que la columna se recorta con «…» en UNA línea, no se parte en pedazos de letras en varias.
  const single = wrapWords("Constanza", 30, 11, 3);
  assert.equal(single.lines.length, 1);
  assert.ok(single.lines[0].endsWith("…"));
});

test("fitCardText: un bloque sólo escribe el nombre si entra ENTERO; si no, devuelve null (barra + rótulo)", () => {
  const sizes = [{ fontPx: 12, lineHeightPx: 13 }, { fontPx: 11, lineHeightPx: 12 }];
  assert.ok(fitCardText("Alejandro Pons Estel", null, 62, 48, sizes), "60 min a 50 px/h: tres líneas entran");
  assert.equal(fitCardText("Delfina Treinta", null, 62, 23, sizes), null, "30 min: dos líneas no entran en 23 px");
  assert.ok(fitCardText("Ana", null, 62, 23, sizes), "30 min con un nombre corto entra en una línea");
  assert.equal(fitCardText("Alejandro Pons Estel", "Cancel.", 62, 30, sizes), null, "el estado ocupa su línea");
});

test("clases de 5, 10, 15 y 30 minutos: la barra conserva la duración exacta y el rótulo dice el nombre en palabras completas", () => {
  for (const minutes of [5, 10, 15, 30]) {
    const item = lesson("10:00", minutes, "Camila Quince");
    const { positioned, labelPlan, cards } = plan([item]);
    assert.equal(cards.has(item.id), false, `${minutes} min no entra en su bloque`);
    const planned = labelPlan!.items.get(item.id)!;
    assert.deepEqual(planned.label.text!.lines, ["Camila", "Quince"], "dos líneas de palabras completas");
    // La barra es el propio bloque exacto (alto = duración menos la separación fija), nunca un alto inventado.
    assert.ok(Math.abs(positioned[0].height - (minutes / 60) * HOUR) <= 2.01 || positioned[0].height === 4, `${minutes} min: alto exacto`);
    assert.ok(planned.label.y >= 0 && planned.label.y + planned.label.height <= GRID);
  }
});

test("clases consecutivas: ninguna se pierde, los rótulos no se pisan y respetan el orden de las barras", () => {
  const items = [lesson("10:00", 15, "Sofia Riviere"), lesson("10:15", 15, "Tomas Quiroga"), lesson("10:30", 15, "Ursula Benitez"), lesson("10:45", 30, "Valentina Gomez")];
  const { labelPlan, cards } = plan(items);
  assert.equal(cards.size + labelPlan!.items.size, items.length, "todas las clases se dibujan");
  const labels = items.map((item) => labelPlan!.items.get(item.id)!.label).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) assert.ok(labels[i].y >= labels[i - 1].y + labels[i - 1].height - 0.001, "sin superposición");
  const ordered = items.map((item) => labelPlan!.items.get(item.id)!.label.y);
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered, "el orden vertical es el de las barras");
});

test("simultáneas: se numeran en la barra y el rótulo; sin ancho para el nombre queda la inicial o el número, nunca un texto partido", () => {
  const items = [lesson("11:00", 60, "Emma Larga"), lesson("11:00", 15, "Facundo Torres"), lesson("11:15", 30, "Gabriela Soto")];
  const narrow = plan(items, 70);
  assert.equal(narrow.cards.size, 0, "un grupo con alguna clase que no entra pasa entero a barras numeradas");
  assert.deepEqual(items.map((item) => narrow.labelPlan!.items.get(item.id)!.number).sort(), [1, 2, 3]);
  for (const item of items) {
    const text = narrow.labelPlan!.items.get(item.id)!.label.text!;
    assert.ok(text.lines.length <= 1, "una sola pieza (inicial) o ninguna: jamás un nombre partido en fragmentos");
  }
  // Con más ancho (430 px) aparecen las iniciales.
  const wide = plan(items, 79).labelPlan!;
  assert.ok(items.every((item) => wide.items.get(item.id)!.label.text!.lines.length > 0));
});

test("grupos y nombres largos: «PET A» entero; un nombre largo usa tres líneas y termina en «…» sólo si de verdad no entra", () => {
  const group = lesson("13:00", 60, "PET A", { title: "PET A", participantIds: ["a", "b", "c"], lessonType: "group" });
  assert.deepEqual(plan([group]).cards.get(group.id)!.lines, ["PET A"]);
  const longOne = lesson("11:00", 15, "María de los Ángeles Fernández Villanueva");
  const planned = plan([longOne]).labelPlan!.items.get(longOne.id)!;
  assert.equal(planned.label.text!.lines.length, 3);
  assert.ok(planned.label.text!.lines[2].endsWith("…"));
  assert.equal(planned.label.fullNameFits, false, "se informa que el nombre no entró completo");
});

test("vista Día: las clases cortas llevan el nombre completo al costado y las largas son tarjetas de 16 px", () => {
  const items = [lesson("09:00", 5, "Ana Cinco"), lesson("14:00", 60, "Alejandro Pons Estel")];
  const { labelPlan, cards } = plan(items, 354, true);
  assert.deepEqual(labelPlan!.items.get(items[0].id)!.label.text!.lines, ["Ana Cinco"]);
  assert.equal(cards.get(items[1].id)!.fontPx, 16);
});

test("un estado importante se escribe con texto en la tarjeta y en el rótulo (nunca sólo color)", () => {
  const cancelled = lesson("12:00", 15, "Lola Cancelada", { status: "cancelled" });
  assert.equal(plan([cancelled]).labelPlan!.items.get(cancelled.id)!.label.text!.state, "Cancel.");
  const rescheduled = lesson("12:00", 60, "Mateo", { status: "rescheduled" });
  assert.equal(plan([rescheduled]).cards.get(rescheduled.id)!.state, "Reprog.");
});

test("placeVariableLabels: respeta el alto de cada rótulo, no pisa obstáculos y devuelve null si no hay forma", () => {
  const ys = placeVariableLabels([10, 10], [25, 13], [[], []], 100)!;
  assert.ok(ys[1] >= ys[0] + 25 - 0.001, "el segundo empieza donde termina el primero");
  assert.equal(placeVariableLabels([0], [13], [[[0, 100]]], 100), null, "todo el alto tapado: no hay lugar");
});

test("ninguna clase queda sin dibujar ni sin zona táctil, en cualquier mezcla", () => {
  const items = [lesson("09:00", 5, "A"), lesson("09:00", 5, "B"), lesson("09:05", 60, "María de los Ángeles"), lesson("09:30", 15, "Camila"), lesson("10:00", 15, "Juan Pablo Fernández"), lesson("10:00", 30, "Sofía"), lesson("12:00", 30, "Lu")];
  const { positioned, labelPlan, cards } = plan(items);
  for (const p of positioned) {
    assert.ok(cards.has(p.item.id) !== (labelPlan?.items.has(p.item.id) ?? false), `${p.item.studentName} se dibuja exactamente una vez`);
    assert.ok(p.hitHeight >= p.height);
  }
});
