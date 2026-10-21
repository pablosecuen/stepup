import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXCESS_STATUS_LABEL, excessExplanation, excessLinesForCharge, excessLinesForPayment, sumExcess, type AllocationExcessLike } from "../excess.ts";
import { toPaymentAllocationRecord } from "../../repositories/payments-mapping.ts";
import { calculateChargeBalance, calculatePaidAmountForCharge } from "../charge-balance.ts";

/** Exceso pagado sobre el importe base: se MUESTRA vinculado a su pago sin tocar importes ni saldos y sin presentarse como recargo confirmado. Datos ANONIMIZADOS. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const alloc = (over: Partial<AllocationExcessLike> = {}): AllocationExcessLike => ({ id: "a1", chargeId: "c1", paymentId: "p1", excessAmount: 100, excessStatus: "pendiente_de_clasificacion", ...over });
const voided = (entries: Array<[string, string | null]>) => new Map(entries);

test("el exceso se vincula a su cobro y a su pago; el pago anulado ya no cuenta", () => {
  const list = [alloc(), alloc({ id: "a2", paymentId: "p2", excessAmount: 50 }), alloc({ id: "a3", chargeId: "otro" }), alloc({ id: "a4", excessAmount: 0, excessStatus: null })];
  const lines = excessLinesForCharge("c1", list, voided([["p1", null], ["p2", null]]));
  assert.deepEqual(lines.map((l) => [l.allocationId, l.paymentId, l.amount, l.status]), [["a1", "p1", 100, "pendiente_de_clasificacion"], ["a2", "p2", 50, "pendiente_de_clasificacion"]]);
  assert.equal(sumExcess(lines), 150);
  assert.deepEqual(excessLinesForCharge("c1", list, voided([["p1", "2026-10-01T00:00:00Z"], ["p2", null]])).map((l) => l.paymentId), ["p2"], "el pago anulado no cuenta");
  assert.deepEqual(excessLinesForPayment("p1", list, voided([["p1", null]])).map((l) => l.allocationId), ["a1", "a3"]);
  assert.deepEqual(excessLinesForPayment("p1", list, voided([["p1", "2026-10-01T00:00:00Z"]])), []);
});

test("sumExcess no acumula errores de coma flotante", () => {
  assert.equal(sumExcess([{ allocationId: "x", paymentId: "p", amount: 0.1, status: "pendiente_de_clasificacion" }, { allocationId: "y", paymentId: "p", amount: 0.2, status: "pendiente_de_clasificacion" }]), 0.3);
});

test("el pendiente NO se presenta como recargo confirmado: el texto lo dice con palabras y aclara que importe y saldo no cambian", () => {
  assert.equal(EXCESS_STATUS_LABEL.pendiente_de_clasificacion, "Pendiente de clasificación");
  assert.equal(EXCESS_STATUS_LABEL.recargo_confirmado, "Recargo confirmado");
  const pending = excessExplanation("pendiente_de_clasificacion");
  assert.match(pending, /Todavía no se confirmó como recargo/);
  assert.match(pending, /no se le atribuye ninguna causa/);
  assert.match(pending, /importe original y el saldo no cambian/);
  assert.doesNotMatch(pending, /Recargo confirmado/);
  assert.match(excessExplanation("recargo_confirmado"), /importe original y el saldo no cambian/);
});

test("una asignación de una base sin R13 (sin columnas de exceso) se lee como «sin exceso»; con exceso, lo conserva", () => {
  const base = { id: "a", owner_id: "o", legacy_mobile_id: null, payment_id: "p", charge_id: "c", student_id: "s", amount: 120, created_at: "2026-10-01T00:00:00Z" };
  const old = toPaymentAllocationRecord(base as never);
  assert.deepEqual([old.excessAmount, old.excessStatus], [0, null]);
  const withExcess = toPaymentAllocationRecord({ ...base, excess_amount: 20, excess_status: "pendiente_de_clasificacion", excess_evidence: {} } as never);
  assert.deepEqual([withExcess.amount, withExcess.excessAmount, withExcess.excessStatus], [120, 20, "pendiente_de_clasificacion"]);
});

test("los importes y saldos NO cambian: lo pagado sigue siendo el monto de las asignaciones y el saldo no baja de 0", () => {
  const allocations = [{ chargeId: "c1", amount: 120, paymentVoidedAt: null }];
  const paid = calculatePaidAmountForCharge("c1", allocations);
  assert.equal(paid, 120);
  const balance = calculateChargeBalance({ originalAmount: 100 }, paid);
  assert.deepEqual([balance.totalDue, balance.paidAmount, balance.balance, balance.isFullyPaid], [100, 120, 0, true]);
});

test("la pestaña de cobros muestra el exceso y las incidencias con texto + ícono, sin tocar el cálculo de saldos", () => {
  const source = readFileSync(join(ROOT, "components", "students", "profile", "cobros-tab.tsx"), "utf8");
  assert.match(source, /excessLinesForCharge\(charge\.id, allocations, voidedAtByPaymentId\)/);
  assert.match(source, /excessLinesForPayment\(payment\.id/);
  assert.match(source, /EXCESS_STATUS_LABEL\[line\.status\]/, "el estado de cada exceso se dice con palabras");
  assert.match(source, /QuestionMarkCircleIcon[\s\S]*aria-hidden/, "ícono + texto, no sólo color");
  assert.match(source, /OriginIncidentNote incidents=\{chargeIncidents\[charge\.id\]/);
  assert.match(source, /calculatePaidAmountForCharge\(charge\.id, allocationsLike\)/, "el pagado se calcula como siempre");
  assert.match(source, /const allocationsLike = allocations\.map\(\(a\) => \(\{ chargeId: a\.chargeId, amount: a\.amount, paymentVoidedAt/, "con el monto completo de la asignación");
});

test("el historial de clases y los registros muestran las incidencias heredadas, y una falla al leerlas no rompe la pantalla", () => {
  const clases = readFileSync(join(ROOT, "components", "students", "profile", "clases-tab.tsx"), "utf8");
  assert.match(clases, /OriginIncidentNote incidents=\{incidentsByRegistrationId\[registration\.id\]/);
  for (const page of [join("app", "(app)", "registro", "[calendarLessonId]", "page.tsx"), join("app", "(app)", "registro", "libre", "[registrationId]", "page.tsx")]) {
    const text = readFileSync(join(ROOT, page), "utf8");
    assert.match(text, /<OriginIncidentsCard incidents=\{incidents\} \/>/);
    assert.match(text, /loadRegistrationIncidents\(ctx, \[detail\.registration\.id\]\)\.catch\(/);
  }
  const student = readFileSync(join(ROOT, "app", "(app)", "alumnos", "[id]", "page.tsx"), "utf8");
  assert.match(student, /loadChargeIncidents\(ctx, charges\.map\(\(c\) => c\.id\)\)\.catch\(/);
  assert.match(student, /loadRegistrationIncidents\(ctx, all\.map\(\(r\) => r\.id\)\)\.catch\(/);
});

test("las lecturas de incidencias son sólo de lectura, filtran por la cuenta y toleran que la tabla no exista todavía", () => {
  const source = readFileSync(join(ROOT, "lib", "repositories", "origin-incidents.ts"), "utf8");
  assert.match(source, /eq\("owner_id", ctx\.ownerId\)/);
  assert.match(source, /isMissingTableError\(error\)\) return \[\]/);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
});
