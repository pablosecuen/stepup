import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPerStudentRows, queryPerStudentRows, rowCobroAmount, PER_STUDENT_SORT_LABEL, type PerStudentInput, type PerStudentQuery, type PerStudentRow } from "../per-student-overview.ts";
import type { PaymentChargeRecord } from "../../repositories/payments-mapping.ts";

/**
 * «Cobro: de mayor a menor / de menor a mayor»: se ordena TODA la lista por el importe numérico que muestra la columna «Cobro» (deuda total o tarifa), sin agrupar antes por plan,
 * periodicidad, deuda ni cantidad de conceptos; ausentes al final en ambos sentidos, el cero participa, empates por nombre, y sobre todos los resultados de búsqueda y filtros.
 */
let seq = 0;
const student = (name: string, billingPlan: unknown, status = "activo"): PerStudentInput["students"][number] => ({ id: `s-${name}`, name, status, billingPlan, billingType: "por_clase", price: 1000 });
const charge = (studentId: string, originalAmount: number, overrides: Partial<PaymentChargeRecord> = {}): PaymentChargeRecord => ({
  id: `c-${++seq}`, studentId, chargeType: "por_clase", originalAmount, dueDate: "2026-10-10", billingPeriod: "2026-10", savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: "2026-10-01T00:00:00Z", voidedAt: null, voidReason: null, ...overrides,
});
const monthly = (amount: number) => ({ type: "monthly", amount, dueDay: 10 });
const perClass = (amount: number) => ({ type: "per_class", amount });

/** Mezcla planes mensuales, por clase, semanales, deudas (de varios cargos), centavos, cero, ausente y empates. Entre paréntesis, el importe que debe mostrar la fila. */
function fixture(): PerStudentRow[] {
  const students = [
    student("A Clase 27500", perClass(27500)), // 27.500 (tarifa por clase)
    student("B Mensual 30000", monthly(30000)), // 30.000 (tarifa mensual)
    student("C Clase 36000", perClass(36000)), // 36.000
    student("D Debe 73500", monthly(50000)), // 73.500 (deuda; su tarifa mensual de 50.000 NO se muestra)
    student("E Debe 94500", { type: "weekly", amount: 25000, dueWeekday: 3 }), // 94.500 (deuda de dos cargos)
    student("F Mensual 99750", monthly(99750)), // 99.750
    student("G Debe 288750", perClass(12000)), // 288.750 (deuda de tres cargos de otra periodicidad)
    student("H Centavos", monthly(27500.5)), // 27.500,50
    student("I Cero", perClass(0)), // 0 real
    student("J Sin cargo", { type: "complimentary" }), // ausente
    student("K Empate 27500", monthly(27500)), // empata con A (27.500)
    student("L Empate 36000", monthly(36000)), // empata con C (36.000)
    student("M Inactivo", monthly(1), "inactivo"),
  ];
  const id = (name: string) => `s-${name}`;
  const charges = [
    charge(id("D Debe 73500"), 73500, { chargeType: "mensual" }),
    charge(id("E Debe 94500"), 50000, { chargeType: "semanal" }),
    charge(id("E Debe 94500"), 44500, { chargeType: "semanal", dueDate: "2026-10-03" }),
    charge(id("G Debe 288750"), 100000),
    charge(id("G Debe 288750"), 90000),
    charge(id("G Debe 288750"), 98750),
    charge(id("G Debe 288750"), 5000, { voidedAt: "2026-10-04T00:00:00Z", voidReason: "x" }), // anulado: no suma
  ];
  return buildPerStudentRows({ students, charges, payments: [], allocations: [], agreements: [], currentPeriod: "2026-10", todayDateKey: "2026-10-30" });
}

const query = (sort: PerStudentQuery["sort"], extra: Partial<PerStudentQuery> = {}): PerStudentQuery => ({ text: "", plan: "todos", sort, ...extra });
const amounts = (rows: readonly PerStudentRow[]) => rows.map((row) => rowCobroAmount(row));

test("la fila muestra (y ordena por) la deuda total si debe, o la tarifa si no; nunca una tarifa convertida", () => {
  const byName = Object.fromEntries(fixture().map((row) => [row.name, rowCobroAmount(row)]));
  assert.deepEqual(byName, {
    "A Clase 27500": 27500, "B Mensual 30000": 30000, "C Clase 36000": 36000, "D Debe 73500": 73500, "E Debe 94500": 94500, "F Mensual 99750": 99750,
    "G Debe 288750": 288750, "H Centavos": 27500.5, "I Cero": 0, "J Sin cargo": null, "K Empate 27500": 27500, "L Empate 36000": 36000,
  });
});

test("de mayor a menor: toda la lista por el importe numérico, descendente; ausente al final; empates por nombre", () => {
  const rows = queryPerStudentRows(fixture(), query("tarifa_desc"));
  assert.deepEqual(rows.map((row) => row.name), [
    "G Debe 288750", "F Mensual 99750", "E Debe 94500", "D Debe 73500", "C Clase 36000", "L Empate 36000", "B Mensual 30000", "H Centavos", "A Clase 27500", "K Empate 27500", "I Cero", "J Sin cargo",
  ]);
  assert.deepEqual(amounts(rows), [288750, 99750, 94500, 73500, 36000, 36000, 30000, 27500.5, 27500, 27500, 0, null]);
});

test("de menor a mayor: exactamente lo mismo, ascendente; el cero participa como cero y el ausente sigue al final", () => {
  const rows = queryPerStudentRows(fixture(), query("tarifa_asc"));
  assert.deepEqual(rows.map((row) => row.name), [
    "I Cero", "A Clase 27500", "K Empate 27500", "H Centavos", "B Mensual 30000", "C Clase 36000", "L Empate 36000", "D Debe 73500", "E Debe 94500", "F Mensual 99750", "G Debe 288750", "J Sin cargo",
  ]);
  assert.deepEqual(amounts(rows), [0, 27500, 27500, 27500.5, 30000, 36000, 36000, 73500, 94500, 99750, 288750, null]);
});

test("la secuencia pedida 27.500; 30.000; 36.000; 73.500; 94.500; 99.750; 288.750 queda ordenada en ambos sentidos (sin grupos por plan, periodicidad ni deuda)", () => {
  const wanted = [27500, 30000, 36000, 73500, 94500, 99750, 288750];
  const pick = (rows: PerStudentRow[]) => amounts(rows).filter((amount): amount is number => amount !== null && wanted.includes(amount));
  assert.deepEqual([...new Set(pick(queryPerStudentRows(fixture(), query("tarifa_asc"))))], wanted);
  assert.deepEqual([...new Set(pick(queryPerStudentRows(fixture(), query("tarifa_desc"))))], [...wanted].reverse());
});

test("todos los importes consecutivos respetan el orden elegido, con y sin búsqueda y filtros", () => {
  const cases: Array<Partial<PerStudentQuery>> = [{}, { text: "debe" }, { text: "e" }, { plan: "monthly" }, { plan: "per_class" }, { plan: "weekly" }, { plan: "monthly", text: "mensual" }, { text: "zzz" }];
  for (const extra of cases) {
    for (const sort of ["tarifa_asc", "tarifa_desc"] as const) {
      const rows = queryPerStudentRows(fixture(), query(sort, extra));
      const present = amounts(rows).filter((amount): amount is number => amount !== null);
      for (let i = 1; i < present.length; i++) assert.ok(sort === "tarifa_asc" ? present[i - 1] <= present[i] : present[i - 1] >= present[i], `${sort} ${JSON.stringify(extra)}: ${present[i - 1]} → ${present[i]}`);
      // los ausentes (null) siempre al final, en ambos sentidos
      const firstNull = amounts(rows).indexOf(null);
      if (firstNull >= 0) assert.ok(amounts(rows).slice(firstNull).every((amount) => amount === null), `${sort} ${JSON.stringify(extra)}: ausentes al final`);
      // el desempate por nombre es estable entre iguales
      for (let i = 1; i < rows.length; i++) if (amounts(rows)[i - 1] === amounts(rows)[i]) assert.ok(rows[i - 1].name.localeCompare(rows[i].name, "es") <= 0, "empate por nombre");
    }
  }
});

test("el orden se aplica sobre TODOS los resultados filtrados, no sólo los visibles: el filtro por plan reduce la lista y el orden sigue siendo por el importe mostrado", () => {
  const porClase = queryPerStudentRows(fixture(), query("tarifa_desc", { plan: "per_class" })).map((row) => row.name);
  assert.deepEqual(porClase, ["G Debe 288750", "C Clase 36000", "A Clase 27500", "I Cero"], "G muestra su deuda (288.750), no su tarifa por clase");
  const buscado = queryPerStudentRows(fixture(), query("tarifa_asc", { text: "debe" })).map((row) => row.name);
  assert.deepEqual(buscado, ["D Debe 73500", "E Debe 94500", "G Debe 288750"]);
  assert.equal(queryPerStudentRows(fixture(), query("tarifa_desc")).some((row) => row.name === "M Inactivo"), false, "un alumno inactivo nunca figura");
});

test("se compara el número real, nunca el texto: 9.999 < 27.500 < 100.000 aunque como texto «9.999» sea mayor que «100.000»", () => {
  const students = [student("P Nueve", perClass(9999)), student("Q Cien", monthly(100000)), student("R Veintisiete", perClass(27500))];
  const rows = buildPerStudentRows({ students, charges: [], payments: [], allocations: [], agreements: [], currentPeriod: "2026-10", todayDateKey: "2026-10-30" });
  assert.deepEqual(queryPerStudentRows(rows, query("tarifa_asc")).map((row) => row.name), ["P Nueve", "R Veintisiete", "Q Cien"]);
  assert.deepEqual(queryPerStudentRows(rows, query("tarifa_desc")).map((row) => row.name), ["Q Cien", "R Veintisiete", "P Nueve"]);
});

test("rótulos del selector: «Cobro: de mayor a menor» y «Cobro: de menor a mayor»", () => {
  assert.equal(PER_STUDENT_SORT_LABEL.tarifa_desc, "Cobro: de mayor a menor");
  assert.equal(PER_STUDENT_SORT_LABEL.tarifa_asc, "Cobro: de menor a mayor");
});
