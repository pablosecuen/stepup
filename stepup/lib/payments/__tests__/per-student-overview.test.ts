import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPerStudentHref, buildPerStudentRows, parsePerStudentQuery, queryPerStudentRows, ratePeriodLabel, rowSortRate, type PerStudentInput, type PerStudentRow } from "../per-student-overview.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord, TrainingBillingAgreementRecord } from "../../repositories/payments-mapping.ts";

/** Cobros › Por alumno: tarifa vigente, último pago y saldo de cada alumno ACTIVO, sin mezclar conceptos. Lógica pura. */

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

const student = (name: string, overrides: Partial<PerStudentInput["students"][number]> = {}): PerStudentInput["students"][number] => ({ id: `s-${name}`, name, status: "activo", billingPlan: null, billingType: "por_clase", price: 20000, ...overrides });
const charge = (studentId: string, overrides: Partial<PaymentChargeRecord> & Pick<PaymentChargeRecord, "chargeType" | "originalAmount">): PaymentChargeRecord => ({
  id: id("c"), studentId, dueDate: "2026-10-10", billingPeriod: "2026-10", savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: "2026-10-01T00:00:00Z", voidedAt: null, voidReason: null, ...overrides,
});
const payment = (studentId: string, amount: number, paidAt: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: id("p"), studentId, amount, method: "efectivo", paidAt, recordedAt: `${paidAt}T12:00:00Z`, notes: null, voidedAt: null, voidReason: null, replacesPaymentId: null, operationId: null, source: null, ...overrides,
});
const allocation = (p: PaymentRecord, c: PaymentChargeRecord, amount: number): PaymentAllocationRecord => ({ id: id("a"), paymentId: p.id, chargeId: c.id, studentId: p.studentId, amount, excessAmount: 0, excessStatus: null });
const agreement = (overrides: Partial<TrainingBillingAgreementRecord> = {}): TrainingBillingAgreementRecord => ({ id: id("ag"), monthlyFee: 60000, pendingMonthlyFee: null, pendingMonthlyFeeEffectiveFrom: null, startPeriod: "2026-09", ...overrides });

function build(overrides: Partial<PerStudentInput>): PerStudentRow[] {
  return buildPerStudentRows({ students: [], charges: [], payments: [], allocations: [], agreements: [], currentPeriod: "2026-10", ...overrides });
}

test("incluye a TODOS los alumnos activos (también sin cargos ni pagos) y excluye pausados, inactivos y archivados", () => {
  const rows = build({ students: [student("Ana"), student("Beto", { status: "inactivo" }), student("Carla", { status: "pausado" }), student("Dani", { status: "archivado" }), student("Eli")] });
  assert.deepEqual(rows.map((row) => row.name), ["Ana", "Eli"]);
  assert.equal(rows[0].latestPaidAt, null);
  assert.equal(rows[0].pendingBalance, 0);
  assert.equal(rows[0].concepts[0].lastPayment, null);
});

test("la tarifa sale del plan vigente con su unidad, nunca del último pago", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 80000, dueDay: 10 } });
  const c = charge(ana.id, { chargeType: "mensual", originalAmount: 80000 });
  const p = payment(ana.id, 30000, "2026-10-05"); // pagó 30.000 de una mensualidad de 80.000
  const [row] = build({ students: [ana], charges: [c], payments: [p], allocations: [allocation(p, c, 30000)] });
  const concept = row.concepts[0];
  assert.deepEqual(concept.rate, { amount: 80000, period: "mes" });
  assert.equal(ratePeriodLabel(concept.rate!), "por mes");
  assert.equal(concept.lastPayment?.amount, 30000, "el importe cobrado es 30.000…");
  assert.equal(concept.pendingBalance, 50000, "…el saldo pendiente 50.000 y la tarifa 80.000: tres cosas distintas");
  assert.equal(concept.openCharges, 1);
});

test("cada tipo de plan lleva su periodicidad: por clase, semana, quincena, mes y paquete (y «sin cargo» no tiene tarifa)", () => {
  const rows = build({
    students: [
      student("A", { billingPlan: { type: "per_class", amount: 15000 } }),
      student("B", { billingPlan: { type: "weekly", amount: 20000, dueWeekday: 5 } }),
      student("C", { billingPlan: { type: "biweekly", amount: 35000, anchorDate: "2026-10-01" } }),
      student("D", { billingPlan: { type: "monthly", amount: 70000, dueDay: 10 } }),
      student("E", { billingPlan: { type: "class_package", amount: 90000, includedClasses: 8, validFrom: "2026-10-01" } }),
      student("F", { billingPlan: { type: "complimentary" } }),
    ],
  });
  assert.deepEqual(rows.map((row) => row.concepts[0].rate?.period ?? null), ["clase", "semana", "quincena", "mes", "paquete", null]);
  assert.equal(ratePeriodLabel(rows[4].concepts[0].rate!), "por paquete de 8 clases");
  assert.equal(rows[4].concepts[0].label, "Paquete de 8 clases");
});

test("sin plan explícito se deriva del tipo de facturación y del precio heredados", () => {
  const [mensual, porClase] = build({ students: [student("A", { billingType: "mensual", price: 50000 }), student("B", { billingType: "por_clase", price: 12000 })] });
  assert.deepEqual(mensual.concepts[0].rate, { amount: 50000, period: "mes" });
  assert.deepEqual(porClase.concepts[0].rate, { amount: 12000, period: "clase" });
});

test("un cambio de monto programado se informa aparte; la tarifa vigente sigue siendo la actual hasta su mes", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 80000, dueDay: 10, pendingAmount: 90000, pendingAmountEffectiveFrom: "2026-11" } });
  const [antes] = build({ students: [ana], currentPeriod: "2026-10" });
  assert.deepEqual(antes.concepts[0].rate, { amount: 80000, period: "mes" });
  assert.deepEqual(antes.concepts[0].upcomingRate, { amount: 90000, effectiveFrom: "2026-11" });
  const [despues] = build({ students: [ana], currentPeriod: "2026-11" });
  assert.deepEqual(despues.concepts[0].rate, { amount: 90000, period: "mes" });
  assert.equal(despues.concepts[0].upcomingRate, null);
});

test("varios pagos: el último por fecha de pago (no por orden de carga) y los anulados no cuentan", () => {
  const ana = student("Ana", { billingPlan: { type: "per_class", amount: 10000 } });
  const c1 = charge(ana.id, { chargeType: "por_clase", originalAmount: 10000 });
  const c2 = charge(ana.id, { chargeType: "por_clase", originalAmount: 10000 });
  const c3 = charge(ana.id, { chargeType: "por_clase", originalAmount: 10000 });
  const viejo = payment(ana.id, 10000, "2026-09-02");
  const nuevo = payment(ana.id, 10000, "2026-10-08");
  const anulado = payment(ana.id, 10000, "2026-10-20", { voidedAt: "2026-10-21T00:00:00Z", voidReason: "error" });
  const [row] = build({
    students: [ana], charges: [c1, c2, c3], payments: [nuevo, viejo, anulado],
    allocations: [allocation(viejo, c1, 10000), allocation(nuevo, c2, 10000), allocation(anulado, c3, 10000)],
  });
  assert.equal(row.latestPaidAt, "2026-10-08");
  assert.equal(row.concepts[0].lastPayment?.paymentId, nuevo.id);
  assert.equal(row.concepts[0].pendingBalance, 10000, "el cobro del pago anulado vuelve a estar pendiente");
  assert.equal(row.pendingBalance, 10000);
});

test("el saldo pendiente ignora los cobros anulados y no baja de cero", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 50000, dueDay: 10 } });
  const anulado = charge(ana.id, { chargeType: "mensual", originalAmount: 50000, voidedAt: "2026-10-02T00:00:00Z", voidReason: "x" });
  const abierto = charge(ana.id, { chargeType: "mensual", originalAmount: 50000, billingPeriod: "2026-11", dueDate: "2026-11-10" });
  const p = payment(ana.id, 70000, "2026-10-03");
  const [row] = build({ students: [ana], charges: [anulado, abierto], payments: [p], allocations: [allocation(p, abierto, 70000)] });
  assert.equal(row.pendingBalance, 0);
  assert.equal(row.concepts[0].openCharges, 0);
});

test("entrenamiento + clases individuales: un concepto por cada uno, cada pago en el suyo y nada mezclado", () => {
  const eli = student("Eli", { billingPlan: { type: "per_class", amount: 18000 } });
  const ag = agreement({ monthlyFee: 65000 });
  const clase = charge(eli.id, { chargeType: "por_clase", originalAmount: 18000 });
  const entre = charge(eli.id, { chargeType: "entrenamiento", originalAmount: 65000, trainingBillingAgreementId: ag.id, trainingSeriesName: "Entrenamiento de los martes" });
  const pClase = payment(eli.id, 18000, "2026-10-12");
  const pEntre = payment(eli.id, 65000, "2026-10-03");
  const [row] = build({ students: [eli], charges: [clase, entre], payments: [pClase, pEntre], allocations: [allocation(pClase, clase, 18000), allocation(pEntre, entre, 65000)], agreements: [ag] });
  assert.equal(row.concepts.length, 2);
  const [plan, training] = row.concepts;
  assert.equal(plan.kind, "plan");
  assert.deepEqual(plan.rate, { amount: 18000, period: "clase" });
  assert.equal(plan.lastPayment?.paymentId, pClase.id);
  assert.equal(training.kind, "training");
  assert.equal(training.seriesName, "Entrenamiento de los martes");
  assert.deepEqual(training.rate, { amount: 65000, period: "mes" });
  assert.equal(training.lastPayment?.paymentId, pEntre.id, "el pago del entrenamiento no es el de las clases, aunque éste sea más reciente");
  assert.equal(training.lastPayment?.paidAt, "2026-10-03");
});

test("dos acuerdos de entrenamiento del mismo alumno son dos conceptos con su propia cuota y su propio pago", () => {
  const eli = student("Eli", { billingPlan: { type: "complimentary" } });
  const a1 = agreement({ monthlyFee: 40000 });
  const a2 = agreement({ monthlyFee: 55000 });
  const c1 = charge(eli.id, { chargeType: "entrenamiento", originalAmount: 40000, trainingBillingAgreementId: a1.id, trainingSeriesName: "Lunes" });
  const c2 = charge(eli.id, { chargeType: "entrenamiento", originalAmount: 55000, trainingBillingAgreementId: a2.id, trainingSeriesName: "Jueves" });
  const p1 = payment(eli.id, 40000, "2026-10-01");
  const [row] = build({ students: [eli], charges: [c1, c2], payments: [p1], allocations: [allocation(p1, c1, 40000)], agreements: [a1, a2] });
  const training = row.concepts.filter((concept) => concept.kind === "training");
  assert.deepEqual(training.map((concept) => [concept.seriesName, concept.rate?.amount, concept.lastPayment?.paymentId ?? null]), [["Lunes", 40000, p1.id], ["Jueves", 55000, null]]);
  assert.equal(training[1].pendingBalance, 55000);
});

test("un pago repartido entre dos conceptos se muestra en cada uno con SU parte, indicando el total", () => {
  const eli = student("Eli", { billingPlan: { type: "per_class", amount: 18000 } });
  const ag = agreement();
  const clase = charge(eli.id, { chargeType: "por_clase", originalAmount: 18000 });
  const entre = charge(eli.id, { chargeType: "entrenamiento", originalAmount: 60000, trainingBillingAgreementId: ag.id, trainingSeriesName: "Serie" });
  const p = payment(eli.id, 50000, "2026-10-09");
  const [row] = build({ students: [eli], charges: [clase, entre], payments: [p], allocations: [allocation(p, clase, 18000), allocation(p, entre, 32000)], agreements: [ag] });
  assert.deepEqual(row.concepts.map((concept) => [concept.lastPayment?.amount, concept.lastPayment?.paymentAmount]), [[18000, 50000], [32000, 50000]]);
});

test("un pago sin asignación no se atribuye a ningún concepto: queda aparte, sin inventar", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 60000, dueDay: 10 } });
  const suelto = payment(ana.id, 25000, "2026-10-15");
  const [row] = build({ students: [ana], payments: [suelto] });
  assert.equal(row.concepts.length, 1);
  assert.equal(row.concepts[0].lastPayment, null, "ningún cobro de la mensualidad recibió ese pago");
  assert.deepEqual(row.unassignedPayments.map((item) => [item.paymentId, item.amount]), [[suelto.id, 25000]]);
  assert.equal(row.latestPaidAt, "2026-10-15", "igual cuenta como el último pago registrado del alumno");
});

test("el pago declarado al dar de alta se marca como tal (no es un ingreso observado)", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 60000, dueDay: 10 } });
  const c = charge(ana.id, { chargeType: "mensual", originalAmount: 60000 });
  const p = payment(ana.id, 60000, "2026-10-01", { source: "initial_student_setup" });
  const [row] = build({ students: [ana], charges: [c], payments: [p], allocations: [allocation(p, c, 60000)] });
  assert.equal(row.concepts[0].lastPayment?.declared, true);
});

test("pagos de un plan anterior no se mezclan con el plan actual: aparece como concepto aparte, sin tarifa vigente", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 70000, dueDay: 10 } });
  const vieja = charge(ana.id, { chargeType: "por_clase", originalAmount: 12000, dueDate: "2026-08-10", billingPeriod: "2026-08" });
  const pVieja = payment(ana.id, 12000, "2026-08-12");
  const [row] = build({ students: [ana], charges: [vieja], payments: [pVieja], allocations: [allocation(pVieja, vieja, 12000)] });
  assert.deepEqual(row.concepts.map((concept) => [concept.kind, concept.label, concept.rate, concept.lastPayment?.paymentId ?? null]), [
    ["plan", "Mensual", { amount: 70000, period: "mes" }, null],
    ["previous_plan", "Plan anterior (por clase)", null, pVieja.id],
  ]);
  // un plan anterior ya saldado y sin pagos asignados no ensucia la fila
  const sinNada = charge(ana.id, { chargeType: "semanal", originalAmount: 5000, voidedAt: "2026-08-01T00:00:00Z", voidReason: "x" });
  const [limpio] = build({ students: [ana], charges: [sinNada] });
  assert.equal(limpio.concepts.length, 1);
});

test("no se cruzan cuentas ni alumnos: los cobros y pagos de otro alumno no aparecen", () => {
  const ana = student("Ana", { billingPlan: { type: "monthly", amount: 70000, dueDay: 10 } });
  const bruno = student("Bruno", { billingPlan: { type: "monthly", amount: 90000, dueDay: 10 } });
  const c = charge(bruno.id, { chargeType: "mensual", originalAmount: 90000 });
  const p = payment(bruno.id, 90000, "2026-10-02");
  const [rowAna, rowBruno] = build({ students: [ana, bruno], charges: [c], payments: [p], allocations: [allocation(p, c, 90000)] });
  assert.equal(rowAna.latestPaidAt, null);
  assert.equal(rowAna.pendingBalance, 0);
  assert.equal(rowBruno.latestPaidAt, "2026-10-02");
});

function sample(): PerStudentRow[] {
  const students = [
    student("Ana Pérez", { billingPlan: { type: "monthly", amount: 80000, dueDay: 10 } }),
    student("Beto Gómez", { billingPlan: { type: "per_class", amount: 20000 } }),
    student("Carla Díaz", { billingPlan: { type: "monthly", amount: 60000, dueDay: 10 } }),
    student("Dani Ruiz", { billingPlan: { type: "per_class", amount: 9000 } }),
    student("Eli Soto", { billingPlan: { type: "complimentary" } }),
    student("Fede Luna", { billingPlan: { type: "weekly", amount: 25000, dueWeekday: 2 } }),
  ];
  const pagos = [payment(students[0].id, 80000, "2026-10-02"), payment(students[1].id, 20000, "2026-09-15"), payment(students[2].id, 60000, "2026-10-09")];
  return build({ students, payments: pagos });
}

test("ordenar por tarifa compara sólo dentro de la misma periodicidad: clase, semana y mes no se mezclan", () => {
  const asc = queryPerStudentRows(sample(), { text: "", plan: "todos", sort: "tarifa_asc" }).map((row) => row.name);
  // clase (9.000 < 20.000) → semana → mes (60.000 < 80.000) → sin tarifa al final
  assert.deepEqual(asc, ["Dani Ruiz", "Beto Gómez", "Fede Luna", "Carla Díaz", "Ana Pérez", "Eli Soto"]);
  const desc = queryPerStudentRows(sample(), { text: "", plan: "todos", sort: "tarifa_desc" }).map((row) => row.name);
  assert.deepEqual(desc, ["Beto Gómez", "Dani Ruiz", "Fede Luna", "Ana Pérez", "Carla Díaz", "Eli Soto"], "los grupos de periodicidad mantienen su orden; dentro de cada uno se invierte el importe");
});

test("ordenar por fecha de pago: el más reciente primero o el más antiguo primero; sin pagos siempre al final", () => {
  const recent = queryPerStudentRows(sample(), { text: "", plan: "todos", sort: "pago_reciente" }).map((row) => row.name);
  assert.deepEqual(recent.slice(0, 3), ["Carla Díaz", "Ana Pérez", "Beto Gómez"]);
  assert.deepEqual(new Set(recent.slice(3)), new Set(["Dani Ruiz", "Eli Soto", "Fede Luna"]));
  const old = queryPerStudentRows(sample(), { text: "", plan: "todos", sort: "pago_antiguo" }).map((row) => row.name);
  assert.deepEqual(old.slice(0, 3), ["Beto Gómez", "Ana Pérez", "Carla Díaz"]);
  assert.equal(old.slice(3).includes("Ana Pérez"), false);
});

test("ordenar por nombre en ambos sentidos", () => {
  assert.deepEqual(queryPerStudentRows(sample(), { text: "", plan: "todos", sort: "nombre" }).map((row) => row.name)[0], "Ana Pérez");
  assert.deepEqual(queryPerStudentRows(sample(), { text: "", plan: "todos", sort: "nombre_desc" }).map((row) => row.name)[0], "Fede Luna");
});

test("filtrar por plan deja sólo a quienes lo tienen vigente; la búsqueda recorre la lista completa sin importar el filtro de orden", () => {
  assert.deepEqual(queryPerStudentRows(sample(), { text: "", plan: "monthly", sort: "nombre" }).map((row) => row.name), ["Ana Pérez", "Carla Díaz"]);
  assert.deepEqual(queryPerStudentRows(sample(), { text: "", plan: "complimentary", sort: "nombre" }).map((row) => row.name), ["Eli Soto"]);
  assert.deepEqual(queryPerStudentRows(sample(), { text: "", plan: "training", sort: "nombre" }), []);
  // búsqueda sin tildes y por fragmento, desde la primera letra
  assert.deepEqual(queryPerStudentRows(sample(), { text: "perez", plan: "todos", sort: "nombre" }).map((row) => row.name), ["Ana Pérez"]);
  assert.deepEqual(queryPerStudentRows(sample(), { text: "d", plan: "todos", sort: "nombre" }).map((row) => row.name).includes("Dani Ruiz"), true);
  assert.deepEqual(queryPerStudentRows(sample(), { text: "zzzz", plan: "todos", sort: "nombre" }), []);
});

test("con un plan filtrado, la tarifa de orden es la de ese plan (el entrenamiento de un alumno con plan por clase se ordena como entrenamiento)", () => {
  const eli = student("Eli", { billingPlan: { type: "per_class", amount: 18000 } });
  const ag = agreement({ monthlyFee: 65000 });
  const entre = charge(eli.id, { chargeType: "entrenamiento", originalAmount: 65000, trainingBillingAgreementId: ag.id, trainingSeriesName: "S" });
  const [row] = build({ students: [eli], charges: [entre], agreements: [ag] });
  assert.deepEqual(rowSortRate(row, "todos"), { amount: 18000, period: "clase" });
  assert.deepEqual(rowSortRate(row, "training"), { amount: 65000, period: "mes" });
  assert.equal(queryPerStudentRows([row], { text: "", plan: "training", sort: "nombre" }).length, 1);
});

test("el estado de la consulta viaja en la dirección: sólo lo que se aparta de lo predeterminado, y valores inválidos vuelven al predeterminado", () => {
  assert.equal(buildPerStudentHref({ text: "", plan: "todos", sort: "nombre" }), "/cobros/por-alumno");
  assert.equal(buildPerStudentHref({ text: " ana ", plan: "monthly", sort: "tarifa_desc" }), "/cobros/por-alumno?q=ana&plan=monthly&orden=tarifa_desc");
  assert.deepEqual(parsePerStudentQuery({ q: "ana", plan: "monthly", orden: "tarifa_desc" }), { text: "ana", plan: "monthly", sort: "tarifa_desc" });
  assert.deepEqual(parsePerStudentQuery({ plan: "inventado", orden: "otro" }), { text: "", plan: "todos", sort: "nombre" });
});
