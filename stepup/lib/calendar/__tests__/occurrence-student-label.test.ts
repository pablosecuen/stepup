import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveOccurrenceStudentLabel, type StudentForLabel } from "../occurrence-student-label.ts";
import { buildCalendarViewForRange } from "../occurrences.ts";
import { buildParticipantFreezePayload } from "../participants-freeze-payload.ts";
import { buildPendingLessons } from "../../lessons/pending.ts";
import { buildRemindersCenterSummary } from "../../dashboard/reminders-center.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

/**
 * "Serie sin alumnos": las ocurrencias VIRTUALES (series todavía no materializadas) nacían con `studentName: ""` aunque la
 * serie tuviera participantes. Ahora toman nombre y nivel con la MISMA regla que las clases materializadas/congeladas.
 */
const BA = "America/Argentina/Buenos_Aires";
const MONDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];
const ANA = { id: "s-ana", name: "QA Alumno Editado", levels: ["B1", "B2"] };
const BETO = { id: "s-beto", name: "QA Alumno Dos", levels: ["A2"] };
const SIN_NIVEL = { id: "s-sin", name: "Sin Nivel", levels: [] as string[] };
const STUDENTS = new Map<string, StudentForLabel & { id: string }>([ANA, BETO, SIN_NIVEL].map((s) => [s.id, s]));

function rule(overrides: Partial<RecurrenceRuleForEngine>): RecurrenceRuleForEngine {
  return {
    recurrenceId: "r1",
    studentId: ANA.id,
    participantIds: [ANA.id],
    cycleLengthWeeks: 1,
    modality: "presencial",
    timezone: BA,
    startDate: "2026-09-28",
    endDate: null,
    status: "active",
    weeks: MONDAY_18,
    classTitle: null,
    activityKind: "class",
    ...overrides,
  };
}

function virtualItems(r: RecurrenceRuleForEngine, students?: ReadonlyMap<string, StudentForLabel>) {
  return buildCalendarViewForRange({
    rangeStart: new Date("2026-10-04T03:00:00Z"),
    rangeEnd: new Date("2026-10-11T02:59:59Z"),
    rules: [r],
    exceptions: [],
    lessons: [],
    students,
  });
}

test("resolveOccurrenceStudentLabel: individual — nombre y PRIMER nivel del alumno principal", () => {
  assert.deepEqual(resolveOccurrenceStudentLabel({ primaryStudentId: ANA.id, participantIds: [ANA.id], students: STUDENTS }), {
    primaryStudentId: ANA.id,
    studentName: "QA Alumno Editado",
    level: "B1",
  });
});

test("resolveOccurrenceStudentLabel: grupo — manda el principal GUARDADO, nunca el orden del array de participantes", () => {
  const label = resolveOccurrenceStudentLabel({ primaryStudentId: BETO.id, participantIds: [ANA.id, BETO.id], students: STUDENTS });
  assert.equal(label.studentName, "QA Alumno Dos");
  assert.equal(label.level, "A2");
});

test("resolveOccurrenceStudentLabel: principal desconocido → el primer participante conocido; sin nivel → vacío", () => {
  assert.equal(resolveOccurrenceStudentLabel({ primaryStudentId: "borrado", participantIds: ["otro-borrado", BETO.id, ANA.id], students: STUDENTS }).studentName, "QA Alumno Dos");
  assert.deepEqual(resolveOccurrenceStudentLabel({ primaryStudentId: SIN_NIVEL.id, participantIds: [SIN_NIVEL.id], students: STUDENTS }), { primaryStudentId: SIN_NIVEL.id, studentName: "Sin Nivel", level: "" });
});

test("resolveOccurrenceStudentLabel: realmente sin participantes → nombre y nivel vacíos (recién ahí la UI dice 'Serie sin alumnos')", () => {
  assert.deepEqual(resolveOccurrenceStudentLabel({ primaryStudentId: null, participantIds: [], students: STUDENTS }), { primaryStudentId: null, studentName: "", level: "" });
  assert.equal(resolveOccurrenceStudentLabel({ primaryStudentId: "borrado", participantIds: ["borrado"], students: STUDENTS }).studentName, "");
});

test("ocurrencia virtual INDIVIDUAL: ya no queda sin nombre (el caso R1 y R4 del QA)", () => {
  const [item] = virtualItems(rule({}), STUDENTS);
  assert.equal(item.isMaterialized, false, "sigue siendo virtual");
  assert.equal(item.studentName, "QA Alumno Editado");
  assert.equal(item.level, "B1");
  assert.equal(item.lessonType, "individual");
});

test("ocurrencia virtual de GRUPO: nombre del principal guardado (como una materializada), lessonType group, ambos participantes", () => {
  const [item] = virtualItems(rule({ studentId: BETO.id, participantIds: [ANA.id, BETO.id] }), STUDENTS);
  assert.equal(item.studentName, "QA Alumno Dos");
  assert.equal(item.lessonType, "group");
  assert.deepEqual(item.participantIds, [ANA.id, BETO.id]);
});

test("ocurrencia virtual SIN participantes: sigue vacía — es el único caso en que corresponde 'Serie sin alumnos'", () => {
  const [item] = virtualItems(rule({ studentId: null as never, participantIds: [] }), STUDENTS);
  assert.equal(item.studentName, "");
  assert.equal(item.level, "");
  assert.equal(item.participantIds.length, 0);
});

test("compatibilidad: sin el mapa de alumnos las virtuales quedan sin nombre, como antes (ningún llamador existente se rompe)", () => {
  const [item] = virtualItems(rule({}));
  assert.equal(item.studentName, "");
});

test("MISMA regla que las clases materializadas: el nombre/nivel de la virtual coincide con el de la ocurrencia congelada de la misma serie", () => {
  const cases = [
    rule({}),
    rule({ studentId: BETO.id, participantIds: [ANA.id, BETO.id] }),
    rule({ studentId: "borrado", participantIds: ["borrado", BETO.id] }),
    rule({ studentId: SIN_NIVEL.id, participantIds: [SIN_NIVEL.id] }),
  ];
  for (const r of cases) {
    const [virtual] = virtualItems(r, STUDENTS);
    const [frozen] = buildParticipantFreezePayload({
      occurrences: [{ occurrenceKey: "k", recurrenceIndex: 0, start: virtual.start, end: virtual.end }],
      rule: { primaryStudentId: r.studentId, participantIds: r.participantIds, modality: r.modality, classTitle: null, activityKind: "class" },
      students: STUDENTS,
    });
    assert.equal(virtual.studentName, frozen.student_name, `nombre — principal ${String(r.studentId)}`);
    assert.equal(virtual.level, frozen.level, `nivel — principal ${String(r.studentId)}`);
  }
});

test("Calendario, Inicio, Registro y Recordatorios muestran el nombre de una ocurrencia virtual individual y de grupo", () => {
  const individual = virtualItems(rule({ recurrenceId: "r-ind" }), STUDENTS);
  const group = virtualItems(rule({ recurrenceId: "r-grp", studentId: BETO.id, participantIds: [ANA.id, BETO.id] }), STUDENTS);
  const empty = virtualItems(rule({ recurrenceId: "r-vacia", studentId: null as never, participantIds: [] }), STUDENTS);
  const items = [...individual, ...group, ...empty];

  // Calendario (tarjeta y detalle): `title || studentName || "Serie sin alumnos"` — se lee `item.studentName`.
  const cardLabel = (item: (typeof items)[number]) => item.title?.trim() || item.studentName || "Serie sin alumnos";
  assert.equal(cardLabel(individual[0]), "QA Alumno Editado");
  assert.equal(cardLabel(group[0]), "QA Alumno Dos");
  assert.equal(cardLabel(empty[0]), "Serie sin alumnos");

  // Registro y Recordatorios: la lista real de "clases sin registrar" y su título real.
  const pending = buildPendingLessons({ calendarItems: items, now: new Date("2026-10-12T12:00:00Z"), registrations: [] });
  const summary = buildRemindersCenterSummary({ emptyClassItems: [], pendingLessons: pending, collectionEntries: [], todayDateKey: "2026-10-12" });
  const titles = summary.categories.find((category) => category.kind === "clases_sin_registrar")?.items.map((entry) => entry.title) ?? [];
  assert.ok(titles.includes("QA Alumno Editado"), `Recordatorios muestra el alumno individual (${titles.join(" | ")})`);
  assert.ok(titles.includes("Clase grupal · 2 alumnos"), "Recordatorios muestra la clase grupal por su cantidad");
  assert.ok(titles.includes("Sin alumnos"), "y SÓLO la realmente vacía queda como 'Sin alumnos'");
  assert.equal(titles.filter((title) => title === "Sin alumnos").length, 1);
});

test("cableado: las pantallas siguen leyendo `item.studentName` (la corrección entra por una sola vía) y el loader le pasa los alumnos", () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8");
  assert.match(read("components/calendar/real-lesson-card.tsx"), /item\.title\?\.trim\(\) \|\| item\.studentName \|\| "Serie sin alumnos"/);
  assert.match(read("components/calendar/real-lesson-detail-modal.tsx"), /item\.title\?\.trim\(\) \|\| item\.studentName \|\| "Serie sin alumnos"/);
  assert.match(read("app/(app)/registro/page.tsx"), /item\.studentName \|\| "Sin alumnos"/);
  assert.match(read("components/dashboard/home-view.tsx"), /item\.studentName \|\| "Sin alumnos"/);
  assert.match(read("lib/dashboard/reminders-center.ts"), /pending\.item\.studentName \|\| "Sin alumnos"/);
  const view = read("lib/calendar/view.ts");
  assert.match(view, /listStudents\(ctx\)/);
  assert.match(view, /students: new Map\(students\.map/);
});
