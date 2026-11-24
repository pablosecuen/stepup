import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findCalendarConflicts, hasBlockingConflict, rangesOverlap } from "../../calendar-conflicts.ts";
import { toConflictCandidates } from "../conflict-candidates.ts";
import { buildCalendarViewForRange, type MaterializedLessonForMerge } from "../occurrences.ts";
import { applyReplacementVisibility, buildCalendarReplacementLinks } from "../replacement-visibility.ts";
import { isOperativeAgendaItem } from "../agenda.ts";
import { daySlots } from "../parity.ts";
import { evaluateAvailability, type TeacherAvailability } from "../availability.ts";
import { evaluateExtension } from "../extend-duration.ts";
import { localDateTimeToInstantIso } from "../timezone.ts";
import type { RecurrenceRuleForEngine } from "../types.ts";

/**
 * Clases consecutivas (24/11/2026). Un intervalo es [inicio, fin): incluye el inicio y excluye el final. Hay superposición sólo si inicioA < finB && inicioB < finA.
 * La capa de aplicación ya cumplía la regla; el defecto estaba en la base (ver `supabase/tests/postgres/consecutive_classes.mjs`, que lo reproduce). Estas pruebas fijan la regla en TypeScript
 * (validación al guardar y selector de horarios) para que ninguna de las dos capas vuelva a tratar el fin como ocupado.
 */
const TZ = "America/Argentina/Buenos_Aires";
const DAY = "2026-12-01";
const at = (hhmm: string, day = DAY) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return localDateTimeToInstantIso({ date: day, hour, minute, timeZone: TZ });
};
const plus = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
const lesson = (id: string, start: string, end: string, patch: Partial<{ status: "scheduled" | "completed" | "cancelled" | "rescheduled"; overlapAllowed: boolean }> = {}) => ({
  id, start, end, status: patch.status ?? ("scheduled" as const), isRecurring: false, lessonType: "individual" as const, overlapAllowed: patch.overlapAllowed ?? false,
});
const OPEN_WEEK: TeacherAvailability = { timezone: TZ, weeklyBlocks: [], exceptions: [] } as unknown as TeacherAvailability;

const DURATIONS = [45, 60, 75, 90, 135];

test("consecutivas en AMBOS sentidos, con 45, 60, 75, 90 y 135 minutos: ninguna es conflicto", () => {
  for (const existingMinutes of DURATIONS) {
    const existing = lesson("e", at("10:00"), plus(at("10:00"), existingMinutes));
    for (const newMinutes of DURATIONS) {
      const before = findCalendarConflicts(plus(existing.start, -newMinutes), existing.start, [existing]);
      const after = findCalendarConflicts(existing.end, plus(existing.end, newMinutes), [existing]);
      assert.deepEqual(before, [], `${newMinutes} min terminando justo cuando empieza una de ${existingMinutes}`);
      assert.deepEqual(after, [], `${newMinutes} min empezando justo cuando termina una de ${existingMinutes}`);
      assert.equal(rangesOverlap({ start: new Date(plus(existing.start, -newMinutes)), end: new Date(existing.start) }, { start: new Date(existing.start), end: new Date(existing.end) }), false);
    }
  }
});

test("el caso de la captura: 08:30–10:00 (90 min) justo antes de una clase de las 10:00–11:00 no choca con ella", () => {
  const antonio = lesson("virtual:serie-martes", at("10:00"), at("11:00"));
  assert.deepEqual(findCalendarConflicts(at("08:30"), plus(at("08:30"), 90), [antonio]), []);
  // Con 105 minutos sí invade: el choque se informa con sus límites exactos.
  const conflicts = findCalendarConflicts(at("08:30"), plus(at("08:30"), 105), [antonio]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].overlapMinutes, 15);
  assert.equal(conflicts[0].overlapStart, at("10:00"));
  assert.equal(conflicts[0].overlapEnd, plus(at("10:00"), 15));
  assert.equal(hasBlockingConflict(conflicts), true);
});

test("la superposición real mínima es 1 minuto (precisión del formulario) y se detecta; 1 ms también a nivel de instante", () => {
  const existing = lesson("e", at("10:00"), at("11:00"));
  assert.equal(findCalendarConflicts(plus(at("11:00"), -1), plus(at("11:00"), 44), [existing]).length, 1, "empieza 1 min antes de que termine");
  assert.equal(findCalendarConflicts(plus(at("10:00"), -44), plus(at("10:00"), 1), [existing]).length, 1, "termina 1 min después de que empieza");
  assert.equal(findCalendarConflicts(at("11:00"), plus(at("11:00"), 45), [existing]).length, 0);
  const startMs = Date.parse(at("11:00"));
  assert.equal(findCalendarConflicts(new Date(startMs - 1).toISOString(), new Date(startMs + 3_600_000).toISOString(), [existing]).length, 1, "1 ms de solapamiento");
  assert.equal(findCalendarConflicts(new Date(startMs).toISOString(), new Date(startMs + 3_600_000).toISOString(), [existing]).length, 0, "0 ms: sólo se tocan");
  // Segundos y milisegundos en el fin guardado no inventan un choque con la clase siguiente ni la ocultan.
  const withSeconds = lesson("s", at("10:00"), new Date(Date.parse(at("11:00")) - 1).toISOString());
  assert.equal(findCalendarConflicts(at("11:00"), at("12:00"), [withSeconds]).length, 0);
});

test("el selector de horarios y la validación al guardar coinciden: lo que el selector ofrece nunca lo rechaza la validación (y al revés)", () => {
  const items = [{ id: "a", start: at("10:00"), end: at("11:00"), status: "scheduled" as const, studentName: "A" }];
  for (const duration of DURATIONS) {
    for (const slot of daySlots(DAY, duration, items, OPEN_WEEK)) {
      const conflicts = findCalendarConflicts(slot.start, slot.end, toConflictCandidates(items.map((item) => ({ ...item, isRecurring: false, lessonType: "individual" as const, recurrenceId: null }))));
      assert.equal(slot.available, !hasBlockingConflict(conflicts), `${slot.time} · ${duration} min`);
    }
  }
  const slots = daySlots(DAY, 90, items, OPEN_WEEK);
  assert.equal(slots.find((slot) => slot.time === "08:30")?.available, true, "08:30–10:00 se ofrece");
  assert.equal(slots.find((slot) => slot.time === "08:45")?.available, false, "08:45–10:15 invade 15 min");
  assert.equal(slots.find((slot) => slot.time === "11:00")?.available, true, "11:00 se ofrece");
});

test("edición sin cambiar el horario: la propia clase se excluye; con otra al lado sigue sin chocar", () => {
  const own = lesson("own", at("10:00"), at("11:00"));
  const next = lesson("next", at("11:00"), at("12:00"));
  assert.deepEqual(findCalendarConflicts(own.start, own.end, [own, next], "own"), []);
  assert.equal(findCalendarConflicts(own.start, own.end, [own, next]).length, 1, "sin excluirla, chocaría consigo misma: por eso se excluye por identidad");
});

const RULE: RecurrenceRuleForEngine = {
  recurrenceId: "serie-martes", studentId: "a", participantIds: ["a"], cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 10, minute: 0, durationMinutes: 60 }] }],
  modality: "online", timezone: TZ, startDate: "2026-07-27", endDate: null, status: "active", classTitle: null, activityKind: "class",
};
const RANGE = { rangeStart: new Date(at("00:00")), rangeEnd: new Date(at("00:00", "2026-12-02")) };

test("clase recurrente VIRTUAL y MATERIALIZADA: la de las 10:00 no bloquea a una que termina a las 10:00 ni a una que empieza a las 11:00", () => {
  const virtual = buildCalendarViewForRange({ ...RANGE, rules: [RULE], exceptions: [], lessons: [] });
  const tuesday = virtual.filter((item) => item.recurrenceId === "serie-martes");
  assert.equal(tuesday.length, 1);
  assert.equal(tuesday[0].isMaterialized, false);
  assert.equal(tuesday[0].start, at("10:00"));
  assert.equal(tuesday[0].end, at("11:00"));
  const candidates = toConflictCandidates(virtual);
  assert.deepEqual(findCalendarConflicts(at("08:30"), at("10:00"), candidates), []);
  assert.deepEqual(findCalendarConflicts(at("11:00"), at("12:15"), candidates), []);
  assert.equal(findCalendarConflicts(at("09:59"), at("10:30"), candidates).length, 1);

  const materializedLesson: MaterializedLessonForMerge = {
    id: "m1", recurrenceId: "serie-martes", recurrenceOccurrenceKey: tuesday[0].occurrenceKey, primaryStudentId: "a", studentName: "A", level: "A1", lessonType: "individual", startAt: at("10:00"), endAt: at("11:00"),
    modality: "online", status: "scheduled", recurrenceOriginalStart: null, isRecurring: true, classTitle: null, activityKind: "class", freedByLessonId: null, notes: null, participantIds: ["a"],
  };
  const materialized = buildCalendarViewForRange({ ...RANGE, rules: [RULE], exceptions: [], lessons: [materializedLesson] });
  const sameSlot = materialized.filter((item) => item.start === at("10:00"));
  assert.equal(sameSlot.length, 1, "materializada: no se duplica con la virtual");
  assert.equal(sameSlot[0].isMaterialized, true);
  const materializedCandidates = toConflictCandidates(materialized);
  assert.deepEqual(findCalendarConflicts(at("08:30"), at("10:00"), materializedCandidates), []);
  assert.deepEqual(findCalendarConflicts(at("11:00"), at("12:15"), materializedCandidates), []);
  assert.equal(findCalendarConflicts(at("09:59"), at("10:30"), materializedCandidates).length, 1);
});

const moved = (id: string, start: string, end: string, patch: Partial<MaterializedLessonForMerge> = {}): MaterializedLessonForMerge => ({
  id, recurrenceId: "serie-otra", recurrenceOccurrenceKey: null, primaryStudentId: "g", studentName: "G", level: "A1", lessonType: "individual", startAt: start, endAt: end, modality: "presencial",
  status: "rescheduled", recurrenceOriginalStart: "2026-12-23T11:00:00.000Z", isRecurring: true, classTitle: null, activityKind: "class", freedByLessonId: null, notes: null, participantIds: ["g"], ...patch,
});

test("horario LIBERADO por cancelación o reprogramación: ninguna de las clases que dejó el horario lo vuelve a ocupar; un destino activo sí ocupa", () => {
  // El caso real: una ocurrencia se reprogramó al martes 08:00–09:00 (destino) y después esa clase volvió a moverse a otro día (vínculo «moved» hacia 'otro-destino').
  const destination = moved("destino-vigente", at("08:00"), at("09:00"));
  const releasedOrigin = moved("origen-movido", at("08:00"), at("09:00"));
  const cancelled = moved("cancelada", at("08:00"), at("09:00"), { status: "cancelled" });
  const otherDestination = moved("otro-destino", at("16:00", "2026-12-04"), at("17:00", "2026-12-04"));
  const links = buildCalendarReplacementLinks({
    lessons: [{ original_lesson_id: "origen-movido", replacement_lesson_id: "otro-destino", kind: "moved" }],
    series: [],
    replacementLessons: [{ id: "otro-destino", status: "rescheduled", recurrence_original_start: "2026-12-30T11:00:00.000Z" }],
  });
  const view = (lessons: MaterializedLessonForMerge[]) =>
    applyReplacementVisibility(buildCalendarViewForRange({ rangeStart: new Date(at("00:00", "2026-11-30")), rangeEnd: new Date(at("00:00", "2026-12-07")), rules: [], exceptions: [], lessons }), links);
  const operative = (lessons: MaterializedLessonForMerge[]) => view(lessons).filter((item) => isOperativeAgendaItem(item)).map((item) => item.id).sort();

  assert.deepEqual(operative([releasedOrigin, otherDestination]), ["otro-destino"], "el origen movido (vínculo) ya no ocupa su horario");
  assert.deepEqual(operative([cancelled, otherDestination]), ["otro-destino"], "la cancelada no ocupa");
  assert.deepEqual(operative([destination, otherDestination]), ["destino-vigente", "otro-destino"], "un destino vigente SÍ ocupa");
  const candidates = toConflictCandidates(view([releasedOrigin, cancelled, otherDestination]));
  assert.deepEqual(findCalendarConflicts(at("08:30"), at("10:00"), candidates), [], "08:30–10:00 queda libre");
  const blocked = findCalendarConflicts(at("08:30"), at("10:00"), toConflictCandidates(view([destination])));
  assert.equal(blocked.length, 1, "pero sí choca con el destino vigente");
  assert.equal(blocked[0].overlapStart, at("08:30"));
  assert.equal(blocked[0].overlapEnd, at("09:00"));
  // Una clase DICTADA es evidencia histórica: un vínculo no la libera.
  const completedOrigin = moved("origen-dictado", at("08:00"), at("09:00"), { status: "completed" });
  const completedLinks = buildCalendarReplacementLinks({ lessons: [{ original_lesson_id: "origen-dictado", replacement_lesson_id: "otro-destino", kind: "moved" }], series: [], replacementLessons: [{ id: "otro-destino", status: "rescheduled", recurrence_original_start: "2026-12-30T11:00:00.000Z" }] });
  const completedView = applyReplacementVisibility(buildCalendarViewForRange({ rangeStart: new Date(at("00:00", "2026-11-30")), rangeEnd: new Date(at("00:00", "2026-12-07")), rules: [], exceptions: [], lessons: [completedOrigin] }), completedLinks);
  assert.equal(completedView.filter((item) => isOperativeAgendaItem(item)).length, 1);
});

test("reprogramación y extensión que terminan justo al inicio de otra clase: permitidas; un minuto más, no", () => {
  const neighbor = lesson("vecina", at("11:00"), at("12:00"));
  // Extensión de una clase 10:00–10:45: +15 termina a las 11:00 (permitido); +30 invade 15 minutos.
  const extended = evaluateExtension(at("10:00"), plus(at("10:00"), 45), 15);
  assert.ok(extended.ok);
  if (extended.ok) assert.deepEqual(findCalendarConflicts(at("10:00"), extended.newEnd, [neighbor]), []);
  const tooLong = evaluateExtension(at("10:00"), plus(at("10:00"), 45), 30);
  assert.ok(tooLong.ok);
  if (tooLong.ok) assert.equal(findCalendarConflicts(at("10:00"), tooLong.newEnd, [neighbor], "propia")[0].overlapMinutes, 15);
  // Reprogramar 60 min para que termine justo al inicio de otra y empiece justo cuando termina otra.
  const before = lesson("antes", at("08:00"), at("09:00"));
  assert.deepEqual(findCalendarConflicts(at("09:00"), at("10:00"), [before, lesson("despues", at("10:00"), at("11:00"))]), []);
});

test("límites exactos de bloqueos de disponibilidad y vacaciones: terminar justo cuando empieza un bloqueo y empezar justo cuando termina, permitido", () => {
  const availability = {
    timezone: TZ,
    weeklyBlocks: [{ id: "b", weekday: 1, startTime: "12:00", endTime: "14:00", reason: "personal", note: null }],
    exceptions: [{ id: "v", type: "unavailable_full_day", date: "2026-12-08", endDate: null, startTime: null, endTime: null, reason: "vacaciones", note: null }],
  } as unknown as TeacherAvailability;
  assert.equal(evaluateAvailability(at("11:00"), at("12:00"), availability).isAvailable, true, "termina justo cuando empieza el bloqueo");
  assert.equal(evaluateAvailability(at("14:00"), at("15:00"), availability).isAvailable, true, "empieza justo cuando termina el bloqueo");
  assert.equal(evaluateAvailability(at("11:01"), at("12:01"), availability).isAvailable, false, "1 minuto dentro del bloqueo");
  assert.equal(evaluateAvailability(at("13:59"), at("14:59"), availability).isAvailable, false, "1 minuto dentro del final del bloqueo");
  assert.equal(evaluateAvailability(at("20:00", "2026-12-07"), at("00:00", "2026-12-08"), availability).isAvailable, true, "termina a medianoche, justo antes de un día de vacaciones");
  assert.equal(evaluateAvailability(at("00:00", "2026-12-09"), at("01:00", "2026-12-09"), availability).isAvailable, true, "empieza justo cuando termina el día de vacaciones");
  assert.equal(evaluateAvailability(at("23:00", "2026-12-07"), at("01:00", "2026-12-08"), availability).isAvailable, false, "invade el día de vacaciones");
});

test("cableado: la acción de crear, la base y el selector usan las MISMAS comparaciones estrictas y la MISMA regla de agenda operativa", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(read("lib/calendar-conflicts.ts"), /return firstStart < secondEnd && firstEnd > secondStart;/);
  assert.match(read("lib/calendar/parity.ts"), /item\.start<end&&item\.end>start/);
  const sql = read("supabase/migrations/20261124200000_slot_occupancy_replacement_links.sql");
  assert.match(sql, /calendar_replacement_links/, "la base conoce los vínculos de reemplazo, igual que la agenda operativa de la aplicación");
  assert.doesNotMatch(sql, /start_at\s*<=|end_at\s*>=/, "ningún fin ocupado de manera inclusiva");
});
