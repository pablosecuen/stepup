// Lista de clases simultáneas del teléfono (12/11/2026): el grupo es EXACTAMENTE el conjunto que reparte carriles `layoutDayItems`; la lista da nombre completo, horario y modalidad; cada fila abre su clase.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { layoutDayItems } from "../layout.ts";
import type { CalendarViewItem } from "../occurrences.ts";
import { badgeFitsBelow, groupAriaLabel, groupRowDetail, simultaneousGroups } from "../simultaneous-groups.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
let seq = 0;
function lesson(hhmm: string, minutes: number, name: string, extra: Partial<CalendarViewItem> = {}): CalendarViewItem {
  const [h, m] = hhmm.split(":").map(Number);
  const start = Date.parse(`2026-11-11T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`);
  const id = `g${++seq}`;
  return { id, recurrenceId: null, occurrenceKey: null, materializedLessonId: id, isMaterialized: true, studentId: id, participantIds: [id], studentName: name, level: "", lessonType: "individual", title: null, start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString(), modality: "online", status: "scheduled", activityKind: "class", isRecurring: false, freedByLessonId: null, notes: null, ...extra } as CalendarViewItem;
}
const titleOf = (item: CalendarViewItem) => item.title?.trim() || item.studentName;
const groupsOf = (items: CalendarViewItem[]) => simultaneousGroups("2026-11-11", layoutDayItems(items, 50), titleOf);

test("clases sueltas y consecutivas NO forman grupo; dos o más que se tocan, sí", () => {
  assert.equal(groupsOf([lesson("09:00", 60, "Sola")]).length, 0);
  assert.equal(groupsOf([lesson("10:00", 15, "A"), lesson("10:15", 15, "B"), lesson("10:30", 30, "C")]).length, 0, "una cadena de consecutivas no es simultánea");
  const groups = groupsOf([lesson("11:00", 60, "Emma Larga"), lesson("11:00", 15, "Facundo Torres"), lesson("11:15", 30, "Gabriela Soto")]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map(titleOf), ["Emma Larga", "Facundo Torres", "Gabriela Soto"], "por hora de inicio y luego por nombre");
});

test("dos grupos separados en el mismo día son dos grupos, cada uno con sus clases", () => {
  const groups = groupsOf([lesson("11:00", 30, "A1"), lesson("11:00", 30, "A2"), lesson("14:00", 30, "B1"), lesson("14:15", 30, "B2"), lesson("16:00", 30, "Suelta")]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.members.map(titleOf)), [["A1", "A2"], ["B1", "B2"]]);
  assert.ok(groups[0].topPx < groups[1].topPx, "en orden vertical");
  assert.notEqual(groups[0].key, groups[1].key);
});

test("la zona del grupo cubre la zona interactiva de todas sus clases y el fin del grupo es el último fin", () => {
  const items = [lesson("11:00", 60, "Emma Larga"), lesson("11:00", 15, "Facundo Torres")];
  const positioned = layoutDayItems(items, 50);
  const [group] = simultaneousGroups("2026-11-11", positioned, titleOf);
  assert.equal(group.topPx, Math.min(...positioned.map((p) => p.hitTop)));
  assert.equal(group.bottomPx, Math.max(...positioned.map((p) => p.hitTop + p.hitHeight)));
  assert.equal(group.endIso, items[0].end);
});

test("el grupo conserva cancelada y reprogramada como clases (no las oculta) y la lista las nombra con texto, no sólo con color", () => {
  const items = [lesson("11:00", 30, "Lola Cancelada", { status: "cancelled" }), lesson("11:00", 30, "Mateo Reprogramado", { status: "rescheduled" }), lesson("11:00", 30, "Nora", { modality: "presencial" })];
  const [group] = groupsOf(items);
  assert.equal(group.members.length, 3);
  assert.deepEqual(groupRowDetail(group.members.find((m) => m.studentName === "Lola Cancelada")!), { time: "11:00 a 11:30", modality: "Online", state: "Cancelada" });
  assert.equal(groupRowDetail(group.members.find((m) => m.studentName === "Mateo Reprogramado")!).state, "Reprogramada");
  assert.deepEqual(groupRowDetail(group.members.find((m) => m.studentName === "Nora")!), { time: "11:00 a 11:30", modality: "Presencial", state: null });
});

test("etiqueta accesible del grupo: cantidad, hora y todos los nombres completos", () => {
  const [group] = groupsOf([lesson("11:00", 60, "Emma Larga"), lesson("11:00", 15, "Facundo Torres"), lesson("11:15", 30, "Gabriela Soto")]);
  assert.equal(groupAriaLabel(group, titleOf), "3 clases a las 11:00: Emma Larga, Facundo Torres y Gabriela Soto. Abrir la lista.");
  const [pair] = groupsOf([lesson("12:00", 30, "PET A", { title: "PET A" }), lesson("12:00", 30, "Hugo Mena")]);
  assert.equal(groupAriaLabel(pair, titleOf), "2 clases a las 12:00: Hugo Mena y PET A. Abrir la lista.");
});

test("la insignia de cantidad no se dibuja si otra clase empieza justo debajo (taparía su nombre); el contorno punteado y el texto accesible siguen", () => {
  const withNeighbour = layoutDayItems([lesson("11:00", 30, "A1"), lesson("11:00", 30, "A2"), lesson("11:35", 30, "Vecina")], 50);
  const [grouped] = simultaneousGroups("2026-11-11", withNeighbour, titleOf);
  assert.equal(badgeFitsBelow(grouped, withNeighbour), false);
  const alone = layoutDayItems([lesson("11:00", 30, "A1"), lesson("11:00", 30, "A2"), lesson("15:00", 30, "Lejos")], 50);
  const [free] = simultaneousGroups("2026-11-11", alone, titleOf);
  assert.equal(badgeFitsBelow(free, alone), true);
});

test("cableado: sólo teléfono y semana; las clases del grupo quedan inertes; una lista abre el detalle de su propia clase; el foco vuelve a la marca", () => {
  const grid = read("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /const groups = isMobile && isWeek \? simultaneousGroups\(dayKey, positioned, lessonTitle\) : \[\];/, "el escritorio y la vista de un día no cambian");
  assert.match(grid, /<div key=\{key\} style=\{\{ display: "contents" \}\} inert>/, "las clases de un grupo no reciben toque ni foco");
  assert.match(grid, /<GroupMark key=\{group\.key\}/);
  assert.match(grid, /setSelected\(item\);\n\s+\}\}\n\s+onClose=\{\(\) => setOpenGroup\(null\)\}/, "cada fila abre el detalle de su clase y no mueve la grilla");
  assert.match(grid, /data-group-mark/, "al cerrar el detalle el foco vuelve a la marca");
  const sheet = read("components/calendar/simultaneous-group.tsx");
  assert.match(sheet, /<Dialog title=/, "diálogo accesible común: Escape, foco atrapado y devolución del foco");
  assert.match(sheet, /\[overflow-wrap:anywhere\]/, "el nombre completo se parte en líneas, nunca se recorta ni se fragmenta por letras");
  assert.match(sheet, /border-dashed/, "contorno punteado: la identificación no depende sólo del color");
  assert.match(sheet, /min-h-14/, "filas de al menos 56 px de alto para el tacto");
  assert.doesNotMatch(sheet, /truncate|line-clamp|text-ellipsis/, "sin puntos suspensivos en la lista");
});
