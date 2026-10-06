import test from "node:test";
import assert from "node:assert/strict";
import "../../db/__tests__/support/register-alias.mjs";
import { FakePostgrest, uuid, type Row } from "../../db/__tests__/support/fake-postgrest.ts";

// R2 — Los repositorios REALES contra un PostgREST de mentira con `max_rows = 1000`, límite de URL de ~8 KB y dos
// propietarios (A y B) con más de 1.500 filas cada uno. Se prueba lo que importa: lecturas completas, listas de ids en lotes
// de a lo sumo 100, orden estable, errores que se propagan y cero cruces entre cuentas.

const A = uuid(1, "aaaaaaaa");
const B = uuid(2, "bbbbbbbb");

const { listStudents } = await import("../students.ts");
const { listAllCharges, listAllPayments, listAllAllocations, listOpenChargeBalances } = await import("../payments.ts");
const { listCalendarLessonsInRange, listCalendarLessonsForRecurrence } = await import("../calendar-lessons.ts");
const { listRecurrenceRules } = await import("../recurrence-rules.ts");
const { listRecurrenceExceptionsForRules } = await import("../recurrence-exceptions.ts");
const { listLessonRegistrationsForStudent, listLessonRegistrationsInRange, listRegistrationProgressForCalendarLessonIds, listRosterForRegistrationIds } = await import("../lesson-registrations.ts");

function ctxFor(fake: FakePostgrest, ownerId: string) {
  return { supabase: fake as never, ownerId } as never;
}

function pad(n: number, width = 6): string {
  return String(n).padStart(width, "0");
}

function studentRow(i: number, owner: string): Row {
  return {
    id: uuid(i, owner === A ? "aaaaaaaa" : "bbbbbbbb"), owner_id: owner, legacy_mobile_id: null, name: `Alumno ${pad(i % 97, 3)}`, phone: null, whatsapp: null, email: null,
    usual_days: [], usual_time: null, notes: null, birth_date: null, levels: ["A1"], initial_level: "A1", modality: "online", status: "activo", category: "regular",
    billing_type: "monthly", billing_plan: null, date_joined: "2026-01-01", last_reactivated_at: null, status_change_date: null, usual_duration_minutes: 60,
    weekly_frequency: 1, price: 1000, pending_homework: null, alerts: [], current_goals: [], strengths: [], areas_to_improve: [], is_featured: false, is_new: false,
    created_at: "2026-01-01T00:00:00+00:00", updated_at: "2026-01-01T00:00:00+00:00",
  };
}

const ownerPrefix = (owner: string) => (owner === A ? "aaaaaaaa" : "bbbbbbbb");

function twoOwners<T>(make: (i: number, owner: string) => T, countA: number, countB: number): T[] {
  return [
    ...Array.from({ length: countA }, (_, i) => make(i + 1, A)),
    ...Array.from({ length: countB }, (_, i) => make(i + 1, B)),
  ];
}

test("listStudents: 1.700 alumnos de A y 1.800 de B → exactamente los 1.700 de A, en orden (nombre, id), sin ninguno de B", async () => {
  const students = twoOwners(studentRow, 1700, 1800);
  const fake = new FakePostgrest({ tables: { students }, maxRows: 1000 });
  const result = await listStudents(ctxFor(fake, A));
  assert.equal(result.length, 1700);
  assert.ok(result.every((s) => s.id.startsWith("aaaaaaaa")));
  const expected = students.filter((s) => s.owner_id === A).sort((x, y) => (String(x.name) < String(y.name) ? -1 : String(x.name) > String(y.name) ? 1 : String(x.id) < String(y.id) ? -1 : 1));
  assert.deepEqual(result.map((s) => s.id), expected.map((s) => s.id));
  assert.ok(fake.calls.every((c) => c.ownerFilters[0] === A), "todas las páginas filtran por el propietario");
});

test("listStudents, cuenta pequeña: mismo resultado y MISMO costo que antes (una sola petición)", async () => {
  const students = twoOwners(studentRow, 12, 30);
  const fake = new FakePostgrest({ tables: { students } });
  const legacy = await fake.from("students").select("*").eq("owner_id", A).order("name", { ascending: true });
  const calls0 = fake.calls.length;
  const result = await listStudents(ctxFor(fake, A));
  assert.equal(fake.calls.length - calls0, 1);
  assert.deepEqual(new Set(result.map((s) => s.id)), new Set((legacy.data as Row[]).map((r) => r.id as string)));
  const legacyNames = (legacy.data as Row[]).map((r) => r.name);
  assert.deepEqual(result.map((s) => s.name), legacyNames);
});

test("listStudents: un error en cualquier página falla toda la lectura (nunca un parcial)", async () => {
  const students = twoOwners(studentRow, 1700, 10);
  for (const failing of [0, 1, 3]) {
    const fake = new FakePostgrest({ tables: { students }, failCall: (index) => (index === failing ? { code: "57014", message: "statement timeout" } : null) });
    await assert.rejects(() => listStudents(ctxFor(fake, A)), (error: { code?: string }) => error.code === "57014");
  }
});

function chargeRow(i: number, owner: string): Row {
  return { id: uuid(i, ownerPrefix(owner)), owner_id: owner, student_id: uuid(1 + (i % 40), ownerPrefix(owner)), charge_type: "mensual", original_amount: 1000 + (i % 7) * 100, due_date: `2025-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`, billing_period: `2025-${pad(1 + (i % 12), 2)}`, voided_at: null, created_at: "2026-01-01T00:00:00+00:00" };
}

test("Cobros: cargos, pagos y asignaciones — más de 1.500 filas por propietario, completos y sin cruces", async () => {
  const charges = twoOwners(chargeRow, 1600, 1700);
  const payments = twoOwners((i, owner) => ({ id: uuid(i, ownerPrefix(owner)), owner_id: owner, student_id: uuid(1, ownerPrefix(owner)), amount: 500, method: "efectivo", paid_at: `2025-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`, voided_at: null }), 1550, 1600);
  const allocations = twoOwners((i, owner) => ({ id: uuid(i, ownerPrefix(owner)), owner_id: owner, payment_id: uuid(i, ownerPrefix(owner)), charge_id: uuid(i, ownerPrefix(owner)), student_id: uuid(1, ownerPrefix(owner)), amount: 500 }), 1500, 1500);
  const fake = new FakePostgrest({ tables: { payment_charges: charges, payments, payment_allocations: allocations }, maxRows: 1000 });
  const ctx = ctxFor(fake, A);

  const listedCharges = await listAllCharges(ctx);
  assert.equal(listedCharges.length, 1600);
  assert.ok(listedCharges.every((c) => c.id.startsWith("aaaaaaaa")));
  for (let i = 1; i < listedCharges.length; i += 1) assert.ok(listedCharges[i - 1].dueDate <= listedCharges[i].dueDate, "orden por vencimiento");

  const listedPayments = await listAllPayments(ctx);
  assert.equal(listedPayments.length, 1550);
  for (let i = 1; i < listedPayments.length; i += 1) assert.ok(listedPayments[i - 1].paidAt >= listedPayments[i].paidAt, "más reciente primero");
  assert.ok(listedPayments.every((p) => p.id.startsWith("aaaaaaaa")));

  const listedAllocations = await listAllAllocations(ctx);
  assert.equal(listedAllocations.length, 1500);
  assert.equal(new Set(listedAllocations.map((a) => a.id)).size, 1500);
  assert.ok(fake.calls.every((c) => c.ownerFilters.length === 1 && c.ownerFilters[0] === A));

  // Totales exactos frente a un cálculo independiente (suma directa de las filas de A).
  const independent = allocations.filter((a) => a.owner_id === A).reduce((sum, a) => sum + (a.amount as number), 0);
  assert.equal(listedAllocations.reduce((sum, a) => sum + a.amount, 0), independent);
});

test("listOpenChargeBalances: lee la RPC completa por páginas (clave charge_id) y mapea cada cargo", async () => {
  const rows: Row[] = Array.from({ length: 1234 }, (_, i) => ({ charge_id: uuid(i + 1), student_id: uuid(5), charge_type: "mensual", due_date: "2026-10-10", original_amount: "1500.50", paid_amount: i % 2 ? "0" : "500.25" }));
  const fake = new FakePostgrest({ rpcs: { list_open_charge_balances: () => rows }, maxRows: 1000 });
  const result = await listOpenChargeBalances(ctxFor(fake, A));
  assert.equal(result.length, 1234);
  assert.equal(new Set(result.map((r) => r.charge.id)).size, 1234);
  assert.equal(result[0].charge.originalAmount, 1500.5);
  assert.equal(result[0].paidAmount, 500.25);
  assert.equal(result[1].paidAmount, 0);
  assert.equal(result[0].charge.voidedAt, null);
  assert.equal(fake.writeCalls.length, 0);
});

function lessonRow(i: number, owner: string): Row {
  const day = 1 + (i % 28);
  return { id: uuid(i, ownerPrefix(owner)), owner_id: owner, recurrence_id: null, primary_student_id: uuid(1, ownerPrefix(owner)), student_name: "X", level: "A1", lesson_type: "individual", start_at: `2026-03-${pad(day, 2)}T${pad(10 + (i % 8), 2)}:00:00+00:00`, end_at: `2026-03-${pad(day, 2)}T${pad(11 + (i % 8), 2)}:00:00+00:00`, modality: "online", status: "scheduled", is_recurring: false, created_at: "2026-01-01T00:00:00+00:00", updated_at: "2026-01-01T00:00:00+00:00" };
}

test("Calendario: 1.600 clases en la ventana + participantes de todas (16 lotes de ids ≤ 100): completo, sin URL de más de 8 KB", async () => {
  const lessons = twoOwners(lessonRow, 1600, 1700);
  const participants = twoOwners((i, owner) => ({ id: uuid(i, ownerPrefix(owner)), owner_id: owner, calendar_lesson_id: uuid(i, ownerPrefix(owner)), student_id: uuid(1 + (i % 9), ownerPrefix(owner)), created_at: "2026-01-01T00:00:00+00:00" }), 1600, 1700);
  // Fila "ajena" colada que apunta a una clase de A (en la base real lo impiden RLS y los triggers de FK; acá se comprueba que el
  // repositorio no confía sólo en eso: el filtro explícito de propietario también la descarta).
  participants.push({ id: uuid(999999, "bbbbbbbb"), owner_id: B, calendar_lesson_id: uuid(1, "aaaaaaaa"), student_id: uuid(1, "bbbbbbbb"), created_at: "2026-01-01T00:00:00+00:00" });
  const fake = new FakePostgrest({ tables: { calendar_lessons: lessons, calendar_lesson_participants: participants }, maxRows: 1000, maxUrlLength: 8000 });
  const result = await listCalendarLessonsInRange(ctxFor(fake, A), "2026-03-01T00:00:00+00:00", "2026-03-31T23:59:59+00:00");
  assert.equal(result.length, 1600);
  assert.ok(result.every((l) => l.id.startsWith("aaaaaaaa") && l.participantIds.length === 1), "cada clase trae su participante");
  assert.ok(fake.calls.every((c) => c.inSizes.every((n) => n <= 100) && c.urlLength <= 8000));
  assert.ok(fake.calls.filter((c) => c.table === "calendar_lesson_participants").length >= 16);
});

test("Calendario: la ventana por fecha deja afuera lo anterior y lo posterior (límites de mes/año y medianoche argentina)", async () => {
  // Medianoche de Argentina (UTC-3) = 03:00Z. Cada fila es un instante límite.
  const instants = [
    "2025-12-31T23:59:59+00:00", // antes del inicio de 2026 en UTC
    "2026-01-01T02:59:59+00:00", // 23:59:59 del 31/12 en Argentina
    "2026-01-01T03:00:00+00:00", // 00:00:00 del 1/1 en Argentina — instante exacto de inicio
    "2026-01-31T02:59:59+00:00", // todavía enero (23:59:59 del 30/1 en Argentina)
    "2026-02-01T02:59:59+00:00", // 23:59:59 del 31/1 en Argentina
    "2026-02-01T03:00:00+00:00", // 00:00:00 del 1/2 en Argentina
  ];
  const lessons = instants.map((start, i) => ({ ...lessonRow(i + 1, A), start_at: start }));
  const fake = new FakePostgrest({ tables: { calendar_lessons: lessons, calendar_lesson_participants: [] } });
  const january = await listCalendarLessonsInRange(ctxFor(fake, A), "2026-01-01T03:00:00.000Z", "2026-02-01T02:59:59.999Z");
  assert.deepEqual(january.map((l) => l.startAt), [instants[2], instants[3], instants[4]]);
  const none = await listCalendarLessonsInRange(ctxFor(fake, A), "2027-01-01T03:00:00.000Z", "2027-02-01T02:59:59.999Z");
  assert.equal(none.length, 0);
});

test("listCalendarLessonsForRecurrence: más de 1.000 ocurrencias materializadas de una serie, completas", async () => {
  const lessons = Array.from({ length: 1250 }, (_, i) => ({ ...lessonRow(i + 1, A), recurrence_id: uuid(77), start_at: `2026-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}T10:00:00+00:00` }));
  const fake = new FakePostgrest({ tables: { calendar_lessons: lessons, calendar_lesson_participants: [] }, maxRows: 1000 });
  const result = await listCalendarLessonsForRecurrence(ctxFor(fake, A), uuid(77));
  assert.equal(result.length, 1250);
});

test("Series: 250 reglas con sus participantes y 250 ids de reglas para las excepciones, todo en lotes ≤ 100", async () => {
  const rules = twoOwners((i, owner) => ({ id: uuid(i, ownerPrefix(owner)), owner_id: owner, primary_student_id: uuid(1, ownerPrefix(owner)), rule_type: "weekly", cycle_length_weeks: 1, weeks: [], start_date: "2026-01-01", end_date: null, status: "active", timezone: "America/Argentina/Buenos_Aires", modality: "online", class_title: null, activity_kind: "clase", created_at: `2026-01-${pad(1 + (i % 28), 2)}T00:00:00+00:00`, updated_at: "2026-01-01T00:00:00+00:00" }), 250, 260);
  const participants = twoOwners((i, owner) => ({ id: uuid(i, ownerPrefix(owner)), owner_id: owner, recurrence_rule_id: uuid(i, ownerPrefix(owner)), student_id: uuid(2, ownerPrefix(owner)), created_at: "2026-01-01T00:00:00+00:00" }), 250, 260);
  const exceptions = twoOwners((i, owner) => ({ id: uuid(i, ownerPrefix(owner)), owner_id: owner, recurrence_id: uuid(i, ownerPrefix(owner)), occurrence_key: `k${i}`, exception_type: "cancelled", replacement_lesson_id: null, created_at: "2026-01-01T00:00:00+00:00" }), 250, 260);
  const fake = new FakePostgrest({ tables: { recurrence_rules: rules, recurrence_rule_participants: participants, recurrence_exceptions: exceptions }, maxUrlLength: 8000 });
  const ctx = ctxFor(fake, A);
  const listed = await listRecurrenceRules(ctx);
  assert.equal(listed.length, 250);
  assert.ok(listed.every((r) => r.participantIds.length === 1));
  const found = await listRecurrenceExceptionsForRules(ctx, listed.map((r) => r.id));
  assert.equal(found.length, 250);
  assert.ok(fake.calls.every((c) => c.inSizes.every((n) => n <= 100) && c.urlLength <= 8000));
  assert.ok(fake.calls.every((c) => c.ownerFilters[0] === A));
});

function registrationRow(i: number, owner: string, extra: Row = {}): Row {
  return { id: uuid(i, ownerPrefix(owner)), owner_id: owner, calendar_lesson_id: null, status: "completed", counts_as_class: true, scheduled_start_at: `2026-04-${pad(1 + (i % 28), 2)}T12:00:00+00:00`, scheduled_end_at: null, created_at: "2026-04-01T00:00:00+00:00", updated_at: "2026-04-01T00:00:00+00:00", outcome: null, modality: "online", activity_kind: "clase", ...extra };
}

test("Historial de un alumno: 450 registros → lotes de ids ≤ 100, orden global más reciente primero (sin horario al final)", async () => {
  const student = uuid(5, "aaaaaaaa");
  const registrations = [
    ...Array.from({ length: 450 }, (_, i) => registrationRow(i + 1, A)),
    registrationRow(9001, A, { scheduled_start_at: null }),
    ...Array.from({ length: 300 }, (_, i) => registrationRow(i + 1, B)),
  ];
  const roster = [
    ...Array.from({ length: 450 }, (_, i) => ({ id: uuid(i + 1, "cccccccc"), owner_id: A, lesson_registration_id: uuid(i + 1, "aaaaaaaa"), student_id: student })),
    { id: uuid(9001, "cccccccc"), owner_id: A, lesson_registration_id: uuid(9001, "aaaaaaaa"), student_id: student },
    ...Array.from({ length: 300 }, (_, i) => ({ id: uuid(i + 1, "dddddddd"), owner_id: B, lesson_registration_id: uuid(i + 1, "bbbbbbbb"), student_id: student })),
  ];
  const fake = new FakePostgrest({ tables: { lesson_registrations: registrations, lesson_registration_students: roster }, maxUrlLength: 8000 });
  const result = await listLessonRegistrationsForStudent(ctxFor(fake, A), student);
  assert.equal(result.length, 451);
  assert.ok(result.every((r) => r.id.startsWith("aaaaaaaa")));
  for (let i = 1; i < 450; i += 1) assert.ok(Date.parse(result[i - 1].scheduledStartAt as string) >= Date.parse(result[i].scheduledStartAt as string), "desc");
  assert.equal(result[450].scheduledStartAt, null, "sin horario programado, al final");
  assert.ok(fake.calls.every((c) => c.inSizes.every((n) => n <= 100) && c.urlLength <= 8000));
});

test("Registros por rango: sólo los anclados dentro de [inicio, fin] (programado, o alta si no tiene horario) — también el instante exacto de inicio", async () => {
  const START = "2026-04-01T03:00:00.000Z";
  const END = "2026-04-30T23:59:00.000Z";
  const rows = [
    registrationRow(1, A, { scheduled_start_at: "2026-04-01T03:00:00+00:00" }), // instante exacto de inicio: entra
    registrationRow(2, A, { scheduled_start_at: "2026-04-01T02:59:59+00:00" }), // un segundo antes: afuera
    registrationRow(3, A, { scheduled_start_at: "2026-04-30T23:59:00+00:00" }), // instante exacto de fin: entra
    registrationRow(4, A, { scheduled_start_at: "2026-04-30T23:59:01+00:00" }), // un segundo después: afuera
    registrationRow(5, A, { scheduled_start_at: null, created_at: "2026-04-15T10:00:00+00:00" }), // ad-hoc dentro
    registrationRow(6, A, { scheduled_start_at: null, created_at: "2026-05-15T10:00:00+00:00" }), // ad-hoc fuera
    registrationRow(7, A, { scheduled_start_at: "2027-01-01T10:00:00+00:00" }), // futuro lejano: afuera
    registrationRow(8, B, { scheduled_start_at: "2026-04-10T10:00:00+00:00" }), // otro propietario: nunca
  ];
  const fake = new FakePostgrest({ tables: { lesson_registrations: rows } });
  const result = await listLessonRegistrationsInRange(ctxFor(fake, A), START, END);
  assert.deepEqual(new Set(result.map((r) => r.id)), new Set([uuid(1, "aaaaaaaa"), uuid(3, "aaaaaaaa"), uuid(5, "aaaaaaaa")]));
  // La ventana la aplica la BASE: el servidor nunca devuelve filas fuera del rango (antes se bajaba todo desde el inicio y se filtraba en la web).
  assert.equal(fake.calls.reduce((sum, call) => sum + call.rowsReturned, 0), 3);
});

test("Registros por rango: 1.600 registros dentro de la ventana → completos (antes se truncaban a 1.000)", async () => {
  const rows = Array.from({ length: 1600 }, (_, i) => registrationRow(i + 1, A, { scheduled_start_at: `2026-04-${pad(1 + (i % 28), 2)}T${pad(i % 20, 2)}:00:00+00:00` }));
  const fake = new FakePostgrest({ tables: { lesson_registrations: rows }, maxRows: 1000 });
  const result = await listLessonRegistrationsInRange(ctxFor(fake, A), "2026-04-01T00:00:00.000Z", "2026-04-30T23:59:00.000Z");
  assert.equal(result.length, 1600);
});

test("Progreso de registros e integrantes: más de 210 ids de clases → lotes ≤ 100 y resultado completo", async () => {
  const lessonIds = Array.from({ length: 450 }, (_, i) => uuid(i + 1, "aaaaaaaa"));
  const registrations = lessonIds.map((id, i) => registrationRow(i + 1, A, { calendar_lesson_id: id, status: i % 2 ? "in_progress" : "completed" }));
  const roster = registrations.flatMap((r, i) => [
    { id: uuid(i * 2 + 1, "eeeeeeee"), owner_id: A, lesson_registration_id: r.id, student_id: uuid(1), participant_status: "completed" },
    { id: uuid(i * 2 + 2, "eeeeeeee"), owner_id: A, lesson_registration_id: r.id, student_id: uuid(2), participant_status: "pending" },
  ]);
  const fake = new FakePostgrest({ tables: { lesson_registrations: registrations, lesson_registration_students: roster }, maxUrlLength: 8000 });
  const progress = await listRegistrationProgressForCalendarLessonIds(ctxFor(fake, A), lessonIds);
  assert.equal(progress.length, 450);
  assert.ok(progress.every((p) => p.totalParticipants === 2 && p.completedParticipants === 1));
  const rosterRows = await listRosterForRegistrationIds(ctxFor(fake, A), registrations.map((r) => r.id as string));
  assert.equal(rosterRows.length, 900);
  assert.ok(fake.calls.every((c) => c.inSizes.every((n) => n <= 100) && c.urlLength <= 8000));
});

test("un fallo en un lote de ids falla toda la operación (progreso de registros)", async () => {
  const lessonIds = Array.from({ length: 250 }, (_, i) => uuid(i + 1, "aaaaaaaa"));
  const registrations = lessonIds.map((id, i) => registrationRow(i + 1, A, { calendar_lesson_id: id }));
  const fake = new FakePostgrest({ tables: { lesson_registrations: registrations, lesson_registration_students: [] }, failCall: (index) => (index === 1 ? { code: "500", message: "x" } : null) });
  await assert.rejects(() => listRegistrationProgressForCalendarLessonIds(ctxFor(fake, A), lessonIds), (error: { code?: string }) => error.code === "500");
});

test("ninguna lectura de repositorio escribe (ni siquiera con RPC): cero llamadas de escritura", async () => {
  const fake = new FakePostgrest({ tables: { students: twoOwners(studentRow, 20, 20), payment_charges: [], payments: [], payment_allocations: [] }, rpcs: { list_open_charge_balances: () => [] } });
  const ctx = ctxFor(fake, A);
  await listStudents(ctx);
  await listAllCharges(ctx);
  await listAllPayments(ctx);
  await listAllAllocations(ctx);
  await listOpenChargeBalances(ctx);
  assert.equal(fake.writeCalls.length, 0);
});
