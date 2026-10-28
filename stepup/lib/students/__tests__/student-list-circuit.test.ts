// Circuito WEB de la lista de Alumnos: registros con la forma de la base → estado de pago, filtros, orden y presentación. Ejecuta el código de la web (no el del original).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../../repositories/payments-mapping.ts";
import type { StudentRecord } from "../../repositories/students-mapping.ts";
import { projectStudentStatuses, toEnginePaymentsState } from "../list-status.ts";
import { applyStudentListFilters, parsePaymentStatusFilter, parseSortOption, type StudentListEntry, type StudentListFilterState } from "../list-filters.ts";
import { averageGradeLabel, nextClassLabel, paymentChip, studentBadges } from "../list-presentation.ts";
import { buildStudentListAggregates } from "../list-aggregates.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function student(id: string, over: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id, name: id, phone: null, whatsapp: null, email: null, usualDays: [], usualTime: null, notes: null, birthDate: null, levels: ["B1"], initialLevel: "B1", modality: "presencial", status: "activo",
    category: "otro", billingType: "mensual", billingPlan: { type: "monthly", amount: 50000, dueDay: 10 }, dateJoined: "2026-01-01", lastReactivatedAt: null, statusChangeDate: null, usualDurationMinutes: 60,
    weeklyFrequency: 1, price: 50000, pendingHomework: null, alerts: [], currentGoals: [], strengths: [], areasToImprove: [], isFeatured: false, isNew: false, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  };
}
function charge(id: string, studentId: string, period: string, amount: number, dueDate: string, over: Partial<PaymentChargeRecord> = {}): PaymentChargeRecord {
  return { id, studentId, chargeType: "mensual", originalAmount: amount, dueDate, billingPeriod: period, savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: `${period}-01T12:00:00Z`, voidedAt: null, voidReason: null, ...over };
}
function pay(id: string, studentId: string, amount: number, paidAt: string, over: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id, studentId, amount, method: "efectivo", paidAt, recordedAt: `${paidAt}T15:00:00Z`, notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, operationId: null, ...over };
}
function alloc(id: string, paymentId: string, chargeId: string, studentId: string, amount: number): PaymentAllocationRecord {
  return { id, paymentId, chargeId, studentId, amount, excessAmount: 0, excessStatus: null };
}

const TODAY = "2026-10-28";
const project = (students: StudentRecord[], charges: PaymentChargeRecord[], payments: PaymentRecord[], allocations: PaymentAllocationRecord[]) =>
  projectStudentStatuses({ students, payments: toEnginePaymentsState({ charges, payments, allocations }), todayDateKey: TODAY });

test("estado de pago del mes: pagado, parcial (con saldo), vencido (con el período) y sin cargo todavía", () => {
  const students = [student("paga"), student("parcial"), student("debe"), student("nueva")];
  const charges = [
    charge("c1", "paga", "2026-10", 50000, "2026-10-10"),
    charge("c2", "parcial", "2026-10", 50000, "2026-10-10"),
    charge("c3", "debe", "2026-09", 50000, "2026-09-10"),
    charge("c4", "debe", "2026-10", 50000, "2026-10-10"),
  ];
  const payments = [pay("p1", "paga", 50000, "2026-10-05"), pay("p2", "parcial", 20000, "2026-10-06")];
  const allocations = [alloc("a1", "p1", "c1", "paga", 50000), alloc("a2", "p2", "c2", "parcial", 20000)];
  const result = project(students, charges, payments, allocations);

  assert.equal(paymentChip(result.get("paga")!).text, "Pagado");
  assert.equal(paymentChip(result.get("paga")!).tone, "ok");
  assert.equal(result.get("paga")!.lastPaymentAt, "2026-10-05");

  const parcial = paymentChip(result.get("parcial")!);
  assert.match(parcial.text, /^Pago parcial · /);
  assert.ok(parcial.text.includes("30.000"), parcial.text);

  const debe = result.get("debe")!;
  assert.equal(debe.hasOverduePayment, true);
  assert.ok(debe.overdueDebtLabel && /vencid/i.test(debe.overdueDebtLabel), String(debe.overdueDebtLabel));
  assert.equal(paymentChip(debe).text, "Pago vencido");
  assert.equal(paymentChip(debe).tone === "ok", false, "una deuda vencida nunca se muestra como al día");

  assert.equal(result.get("nueva")!.hasOverduePayment, false);
  assert.equal(result.get("nueva")!.lastPaymentAt, null);
});

test("un pago anulado no cuenta como último pago ni como pagado; un cargo anulado no genera deuda", () => {
  const students = [student("a"), student("b")];
  const charges = [charge("c1", "a", "2026-10", 50000, "2026-10-10"), charge("c2", "b", "2026-09", 50000, "2026-09-10", { voidedAt: "2026-09-20T10:00:00Z", voidReason: "error" })];
  const payments = [pay("p1", "a", 50000, "2026-10-05", { voidedAt: "2026-10-06T10:00:00Z", voidReason: "error de carga" })];
  const allocations = [alloc("a1", "p1", "c1", "a", 50000)];
  const result = project(students, charges, payments, allocations);
  assert.equal(result.get("a")!.lastPaymentAt, null, "el pago anulado no es «el último pago»");
  assert.notEqual(paymentChip(result.get("a")!).text, "Pagado", "con el pago anulado el mes vuelve a estar impago");
  assert.equal(result.get("b")!.hasOverduePayment, false, "un cobro anulado no es deuda");
});

test("un alumno inactivo conserva su deuda en el historial pero no muestra el aviso «Pago vencido»", () => {
  const students = [student("baja", { status: "inactivo", statusChangeDate: "2026-09-15" })];
  const charges = [charge("c1", "baja", "2026-09", 50000, "2026-09-10")];
  const result = project(students, charges, [], []);
  assert.equal(result.get("baja")!.hasOverduePayment, false);
  assert.equal(result.get("baja")!.overdueDebtLabel, null);
});

test("un alumno por clase o con plan semanal no queda como «al día» por inercia: muestra su plan, y la mensualidad que empieza el mes próximo dice «Comienza pronto»", () => {
  const students = [
    student("porclase", { billingType: "por_clase", billingPlan: null, price: 8000 }),
    student("semanal", { billingPlan: { type: "weekly", amount: 12000, dueWeekday: 5 } }),
    student("pronto", { billingPlan: { type: "monthly", amount: 50000, dueDay: 10, startPeriod: "2026-11" } }),
  ];
  const result = project(students, [], [], []);
  assert.ok(paymentChip(result.get("porclase")!).text.length > 0);
  assert.notEqual(paymentChip(result.get("porclase")!).text, "Pagado");
  assert.notEqual(paymentChip(result.get("semanal")!).text, "Pagado");
  assert.equal(paymentChip(result.get("pronto")!).text, "Comienza pronto");
});

function entries(): StudentListEntry[] {
  const students = [student("Zoe", { levels: ["A1"], modality: "online" }), student("álvaro", { levels: ["B2", "Infantes"] }), student("Bea", { status: "pausado" }), student("Carla", { modality: "mixta" })];
  const charges = [charge("c1", "Zoe", "2026-09", 50000, "2026-09-10"), charge("c2", "Carla", "2026-10", 50000, "2026-10-10")];
  const payments = [pay("p1", "álvaro", 50000, "2026-10-20"), pay("p2", "Carla", 50000, "2026-10-02")];
  const allocations = [alloc("a1", "p2", "c2", "Carla", 50000)];
  const status = project(students, charges, payments, allocations);
  const next: Record<string, string | null> = { Zoe: "2026-10-30T13:00:00Z", álvaro: "2026-10-29T13:00:00Z", Bea: null, Carla: "2026-11-02T13:00:00Z" };
  return students.map((s) => ({ student: s, payment: status.get(s.id)!, nextClassStart: next[s.id], nextClassEnd: next[s.id] }));
}
const base: StudentListFilterState = { search: "", status: "todos", level: "todos", modality: "todos", paymentStatus: "todos", sortBy: "nombre" };
const names = (list: StudentListEntry[]) => list.map((entry) => entry.student.name);

test("filtros: búsqueda sin tildes, nivel (incluye personalizados), modalidad, estado del alumno y estado de pago", () => {
  assert.deepEqual(names(applyStudentListFilters(entries(), { ...base })), ["álvaro", "Bea", "Carla", "Zoe"], "orden por nombre ignora mayúsculas y tildes");
  assert.deepEqual(names(applyStudentListFilters(entries(), { ...base, search: "alvaro" })), ["álvaro"]);
  assert.deepEqual(names(applyStudentListFilters(entries(), { ...base, level: "Infantes" })), ["álvaro"]);
  assert.deepEqual(names(applyStudentListFilters(entries(), { ...base, modality: "mixta" })), ["Carla"]);
  assert.deepEqual(names(applyStudentListFilters(entries(), { ...base, status: "pausado" })), ["Bea"]);
  const red = applyStudentListFilters(entries(), { ...base, paymentStatus: "rojo" });
  const green = applyStudentListFilters(entries(), { ...base, paymentStatus: "verde" });
  assert.ok(names(red).includes("Zoe"), "Zoe debe el mes anterior");
  assert.ok(!names(green).includes("Zoe"));
  assert.equal(names(red).length + names(green).length + names(applyStudentListFilters(entries(), { ...base, paymentStatus: "amarillo" })).length + names(applyStudentListFilters(entries(), { ...base, paymentStatus: "naranja" })).length, 4, "cada alumno cae en un único estado");
});

test("orden: próxima clase (sin clase al final) y último pago (sin pagos al final)", () => {
  assert.deepEqual(names(applyStudentListFilters(entries(), { ...base, sortBy: "proxima_clase" })), ["álvaro", "Zoe", "Carla", "Bea"]);
  const byPayment = applyStudentListFilters(entries(), { ...base, sortBy: "ultimo_pago" });
  assert.equal(byPayment[0].student.name, "álvaro", "el pago más reciente primero");
  assert.equal(byPayment[1].student.name, "Carla");
  assert.deepEqual(byPayment.slice(2).map((e) => e.payment.lastPaymentAt), [null, null], "los que nunca pagaron, al final");
});

test("parámetros de la URL: lo desconocido vuelve al valor por defecto (nunca rompe la lista)", () => {
  assert.equal(parsePaymentStatusFilter("rojo"), "rojo");
  assert.equal(parsePaymentStatusFilter("<script>"), "todos");
  assert.equal(parsePaymentStatusFilter(undefined), "todos");
  assert.equal(parseSortOption("ultimo_pago"), "ultimo_pago");
  assert.equal(parseSortOption("zzz"), "nombre");
});

test("insignias, próxima clase y promedio se presentan con texto (nunca sólo color) y en el orden del original", () => {
  const status = project([student("x", { isFeatured: true, isNew: true, status: "pausado" })], [charge("c", "x", "2026-09", 1000, "2026-09-10")], [], []).get("x")!;
  const badges = studentBadges({ status: "pausado", isFeatured: true, isNew: true, payment: { ...status, hasOverduePayment: true, overdueDebtLabel: "Septiembre vencido" }, hasPendingHomework: true });
  assert.deepEqual(badges.map((b) => b.kind), ["pausado", "destacado", "nuevo", "pago_vencido", "tarea_pendiente"]);
  assert.equal(badges[3].label, "Septiembre vencido");
  assert.equal(studentBadges({ status: "activo", isFeatured: false, isNew: false, payment: { ...status, hasOverduePayment: false }, hasPendingHomework: false }).length, 0);

  const now = new Date("2026-10-28T15:00:00Z"); // 12:00 en Buenos Aires
  assert.equal(nextClassLabel(null, null, now), "Sin próxima clase programada");
  assert.equal(nextClassLabel("2026-10-28T14:00:00Z", "2026-10-28T16:00:00Z", now), "Clase en curso");
  assert.equal(nextClassLabel("2026-10-28T13:00:00Z", "2026-10-28T14:00:00Z", now), "Sin próxima clase programada", "una clase que ya terminó no es «próxima»");
  assert.match(nextClassLabel("2026-10-28T21:00:00Z", "2026-10-28T22:00:00Z", now), /^Hoy 18:00/);
  assert.match(nextClassLabel("2026-10-29T12:30:00Z", "2026-10-29T13:30:00Z", now), /^Mañana 09:30/);
  assert.equal(averageGradeLabel(null), "Sin calificaciones");
});

test("clases del mes y promedio: sólo asistencia real del mes actual y notas reales (un 0 nunca cuenta)", () => {
  const rows = [
    { studentId: "a", dateKey: "2026-10-03", attendanceStatus: "presente", generalGrade: 8 },
    { studentId: "a", dateKey: "2026-10-10", attendanceStatus: "tarde", generalGrade: 6 },
    { studentId: "a", dateKey: "2026-10-17", attendanceStatus: "ausente", generalGrade: null },
    { studentId: "a", dateKey: "2026-09-26", attendanceStatus: "presente", generalGrade: 10 },
    { studentId: "a", dateKey: "2026-10-24", attendanceStatus: null, generalGrade: 0 },
    { studentId: "b", dateKey: "2026-10-02", attendanceStatus: "presente", generalGrade: null },
  ];
  const result = buildStudentListAggregates(rows, ["a", "b", "c"], TODAY);
  assert.equal(result.get("a")!.classesThisMonth, 2);
  assert.equal(result.get("a")!.averageGrade, 8, "(8 + 6 + 10) / 3");
  assert.equal(result.get("b")!.classesThisMonth, 1);
  assert.equal(result.get("b")!.averageGrade, null);
  assert.deepEqual(result.get("c"), { classesThisMonth: 0, averageGrade: null, hasPendingHomework: false });
});

test("el motor de estado de pago de producción es IDÉNTICO, byte a byte, al núcleo del original que pasa sus pruebas originales", () => {
  const prod = join(ROOT, "lib/payments/engine");
  const core = join(ROOT, "lib/original-core");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(prod, full).split(sep).join("/"));
    }
  };
  walk(prod);
  assert.ok(files.length >= 16, `se esperaban 16 archivos, hay ${files.length}`);
  for (const file of files) {
    const a = readFileSync(join(prod, file), "utf8").replace(/\r\n/g, "\n");
    const b = readFileSync(join(core, file), "utf8").replace(/\r\n/g, "\n");
    assert.equal(a, b, `${file} difiere del núcleo del original`);
  }
});

test("cableado: la página de Alumnos usa el motor, los filtros y los datos agregados (y la tarjeta nunca decide «al día» por su cuenta)", () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
  const page = read("app/(app)/alumnos/page.tsx");
  assert.match(page, /applyStudentListFilters\(entries, filters\)/);
  assert.match(page, /loadStudentListEntries\(ctx, students\)/);
  assert.match(page, /loadStudentListAggregates\(ctx, ids, todayDateKey\)/);
  assert.match(read("lib/students/list-status.ts"), /projectStudentListPaymentStatus/);
  assert.doesNotMatch(read("components/students/student-list-parts.tsx"), /Al día/);
  const form = read("components/students/students-filters-form.tsx");
  assert.match(form, /name="pago"/);
  assert.match(form, /name="orden"/);
});

test("la web nunca usa el formateador de moneda del motor (pesos enteros): todo importe pasa por formatMoney", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "engine" || entry === "original-core" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && /formatCurrencyARS/.test(readFileSync(full, "utf8"))) offenders.push(relative(ROOT, full));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(ROOT, dir));
  assert.deepEqual(offenders, []);
});
