import { test } from "node:test";
import assert from "node:assert/strict";
import { GRACE_DAYS, addMonthsToDateKey, civilDayOf, coverageOf, graceEndsAtFor } from "../periods.ts";
import { buildCoverage, cancelAccessEnd, deriveFields, finalOutcomes, nextCheckAt, projectStatus, reduceSnapshot, type BillingSnapshot, type ExecutionFact } from "../ledger.ts";
import { ar, approved, permutations, rejected, rng, shuffled, snap } from "./helpers.ts";

const at = (date: string, hour = 0, minute = 0, second = 0) => new Date(Date.parse(ar(date, hour, minute)) + second * 1000);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

test("los meses se suman en fecha civil y el día se ajusta al último del mes (31/01 + 1 mes = 28/02, o 29/02 en bisiesto)", () => {
  assert.equal(addMonthsToDateKey("2026-10-01", 1), "2026-11-01");
  assert.equal(addMonthsToDateKey("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonthsToDateKey("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsToDateKey("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonthsToDateKey("2028-02-29", 12), "2029-02-28");
  assert.equal(addMonthsToDateKey("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonthsToDateKey("2026-08-31", 6), "2027-02-28");
  assert.throws(() => addMonthsToDateKey("2026-02-30", 1), RangeError);
  assert.throws(() => addMonthsToDateKey("2026-10-01", -1), RangeError);
});

test("el día civil es el de ARGENTINA, no el de UTC: 23:30 del 30/09 en Buenos Aires ya es 01/10 en UTC", () => {
  const instant = "2026-10-01T02:30:00.000Z"; // 23:30 del 30/09 en Argentina (UTC-3)
  assert.equal(civilDayOf(instant), "2026-09-30");
  assert.notEqual(instant.slice(0, 10), civilDayOf(instant), "la fecha UTC es distinta: nunca se usa");
  const coverage = coverageOf(instant, 1);
  assert.equal(coverage.startIso, ar("2026-09-30"));
  assert.equal(coverage.endIso, ar("2026-10-30"));
  // El fin de un período siempre es las 00:00 de Argentina.
  assert.equal(coverageOf(ar("2026-10-01", 10), 1).endIso, "2026-11-01T03:00:00.000Z");
});

test("períodos: mensual, trimestral, semestral y anual compran 1, 3, 6 y 12 meses desde el día de vencimiento", () => {
  const due = ar("2026-10-01", 10);
  assert.equal(coverageOf(due, 1).endIso, ar("2026-11-01"));
  assert.equal(coverageOf(due, 3).endIso, ar("2027-01-01"));
  assert.equal(coverageOf(due, 6).endIso, ar("2027-04-01"));
  assert.equal(coverageOf(due, 12).endIso, ar("2027-10-01"));
});

test("cinco días corridos de gracia: el 1/10 vence, 2 al 6 son gracia completa y el modo limitado empieza el 7/10 a las 00:00", () => {
  assert.equal(GRACE_DAYS, 5);
  assert.equal(graceEndsAtFor(ar("2026-10-01", 10)), ar("2026-10-07"));
  const base = snap({ status: "grace_period" });
  const facts: ExecutionFact[] = [approved("e1", "2026-09-01"), rejected("e2", "2026-10-01")];
  const reducedAt = (now: Date) => reduceSnapshot(base, facts, now).next;
  assert.equal(reducedAt(at("2026-09-30", 23, 59, 59)).status, "active"); // el período pagado dura hasta las 00:00 del 1/10
  const justAfterDue = reducedAt(at("2026-10-01", 0, 0, 1));
  assert.equal(justAfterDue.status, "grace_period");
  assert.equal(justAfterDue.graceEndsAt, ar("2026-10-07"));
  assert.equal(reducedAt(at("2026-10-06", 23, 59, 59)).status, "grace_period", "último segundo de la gracia");
  assert.equal(reducedAt(at("2026-10-07", 0, 0, 0)).status, "limited", "00:00 del día 7: modo limitado");
});

test("sin rechazo confirmado el período vencido es past_due con la misma ventana de cinco días", () => {
  const facts = [approved("e1", "2026-09-01")]; // cubre [01/09, 01/10)
  const base = snap({ status: "active" });
  assert.equal(reduceSnapshot(base, facts, at("2026-09-30", 23)).next.status, "active");
  assert.equal(reduceSnapshot(base, facts, at("2026-10-01")).next.status, "past_due", "a las 00:00 en punto del día de vencimiento el período ya terminó (el fin es exclusivo)");
  assert.equal(reduceSnapshot(base, facts, at("2026-10-01", 0, 0, 1)).next.status, "past_due");
  assert.equal(reduceSnapshot(base, facts, at("2026-10-06", 23, 59, 59)).next.status, "past_due");
  assert.equal(reduceSnapshot(base, facts, at("2026-10-07")).next.status, "limited");
});

test("el estado se proyecta con el reloj: una cuenta guardada como active cuyo período ya venció se resuelve como limited", () => {
  const stored = snap({ status: "active", planCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-09-01"), currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-07") });
  assert.equal(projectStatus(stored, at("2026-09-15")), "active");
  assert.equal(projectStatus(stored, at("2026-10-03")), "past_due");
  assert.equal(projectStatus(stored, at("2026-10-07")), "limited");
});

test("encadenado de períodos: renovación a tiempo, adelantada, dentro de la gracia y tardía", () => {
  // A tiempo: cada mes empieza donde terminó el anterior.
  const onTime = buildCoverage([approved("a", "2026-09-01"), approved("b", "2026-10-01"), approved("c", "2026-11-01")]);
  assert.deepEqual(onTime.map((p) => [p.startIso, p.endIso]), [[ar("2026-09-01"), ar("2026-10-01")], [ar("2026-10-01"), ar("2026-11-01")], [ar("2026-11-01"), ar("2026-12-01")]]);
  // Adelantada: se apila (no se pierde un día pagado).
  const early = buildCoverage([approved("a", "2026-09-01"), approved("b", "2026-09-15")]);
  assert.equal(early[1].startIso, ar("2026-10-01"));
  assert.equal(early[1].endIso, ar("2026-11-01"));
  // Dentro de la gracia (pagó el día 3 de un vencimiento del 1): sigue sin hueco.
  const inGrace = buildCoverage([approved("a", "2026-09-01"), approved("b", "2026-10-01", { occurredAt: ar("2026-10-03", 12) })]);
  assert.equal(inGrace[1].startIso, ar("2026-10-01"));
  // Tardía (después de la gracia): el período nuevo empieza el día del pago.
  const late = buildCoverage([approved("a", "2026-09-01"), approved("b", "2026-10-01", { occurredAt: ar("2026-10-20", 12) })]);
  assert.equal(late[1].startIso, ar("2026-10-20"));
  assert.equal(late[1].endIso, ar("2026-11-20"));
  // Vencimiento mucho después del fin (la cuenta volvió a pagar tras meses): empieza en su propia fecha.
  const gap = buildCoverage([approved("a", "2026-01-01"), approved("b", "2026-06-01")]);
  assert.equal(gap[1].startIso, ar("2026-06-01"));
});

test("cada ejecución tiene UN resultado: el más reciente; a igual instante gana approved", () => {
  const rejectedFirst = rejected("e", "2026-10-01", { occurredAt: ar("2026-10-01", 10) });
  const approvedLater = approved("e", "2026-10-01", { occurredAt: ar("2026-10-02", 10) });
  assert.equal(finalOutcomes([rejectedFirst, approvedLater])[0].outcome, "approved");
  assert.equal(finalOutcomes([approvedLater, rejectedFirst])[0].outcome, "approved", "un rechazo VIEJO que llega tarde no pisa al cobro aprobado");
  const tieA = approved("e", "2026-10-01", { occurredAt: ar("2026-10-01", 10) });
  assert.equal(finalOutcomes([rejectedFirst, tieA])[0].outcome, "approved");
  assert.equal(finalOutcomes([tieA, rejectedFirst])[0].outcome, "approved");
  assert.equal(finalOutcomes([approvedLater, approvedLater, approvedLater]).length, 1, "duplicados: una sola ejecución");
});

test("IDEMPOTENCIA: aplicar el mismo cobro una o cinco veces da el mismo resultado, y repetir el cálculo no cambia nada", () => {
  const now = at("2026-10-15");
  const base = snap({ status: "pending" });
  const fact = approved("e1", "2026-10-01");
  const once = reduceSnapshot(base, [fact], now);
  const five = reduceSnapshot(base, [fact, fact, fact, fact, fact], now);
  assert.deepEqual(five.next, once.next);
  assert.equal(once.next.status, "active");
  const again = reduceSnapshot(once.next, [fact], now);
  assert.deepEqual(again.next, once.next);
  assert.equal(again.changed, false);
});

test("ORDEN: cualquier orden de llegada de los mismos cobros da el MISMO estado (todas las permutaciones)", () => {
  const facts = [approved("e1", "2026-07-01"), approved("e2", "2026-08-01"), rejected("e3", "2026-09-01"), approved("e3", "2026-09-01", { occurredAt: ar("2026-09-03", 9) })];
  const now = at("2026-09-20");
  const base = snap({ status: "active" });
  const expected = reduceSnapshot(base, facts, now);
  assert.equal(expected.next.status, "active");
  for (const order of permutations(facts)) assert.deepEqual(reduceSnapshot(base, order, now), expected);
});

test("ORDEN: 200 barajados aleatorios (semilla fija) de 10 cobros con rechazos, reintentos y duplicados dan el mismo resultado", () => {
  const random = rng(20261014);
  const facts: ExecutionFact[] = [];
  for (let month = 1; month <= 8; month += 1) {
    const due = `2026-${String(month).padStart(2, "0")}-01`;
    if (month === 4) facts.push(rejected(`e${month}`, due), approved(`e${month}`, due, { occurredAt: ar("2026-04-03", 9) })); // rechazado y luego reintentado con éxito
    else if (month === 8) facts.push(rejected(`e${month}`, due)); // la renovación de agosto fue rechazada
    else facts.push(approved(`e${month}`, due));
  }
  facts.push(approved("e2", "2026-02-01"), approved("e5", "2026-05-01")); // duplicados
  const base = snap({ status: "active" });
  const now = at("2026-08-04"); // el 1/8 venció y rechazaron el cobro: dentro de los 5 días de gracia
  const expected = reduceSnapshot(base, facts, now);
  assert.equal(expected.next.status, "grace_period");
  assert.equal(expected.next.graceEndsAt, ar("2026-08-07"));
  for (let round = 0; round < 200; round += 1) assert.deepEqual(reduceSnapshot(base, shuffled(facts, random), now), expected, `ronda ${round}`);
});

test("un aviso VIEJO que llega al final no pisa un estado más nuevo (rechazo anterior después de un cobro aprobado posterior)", () => {
  const now = at("2026-10-15");
  const base = snap({ status: "active" });
  const staleRejection = rejected("e1", "2026-10-01", { occurredAt: ar("2026-10-01", 9) });
  const approvedLater = approved("e1", "2026-10-01", { occurredAt: ar("2026-10-02", 9) });
  const settled = reduceSnapshot(base, [approvedLater], now);
  const withStale = reduceSnapshot(settled.next, [approvedLater, staleRejection], now);
  assert.equal(withStale.next.status, "active");
  assert.deepEqual(withStale.next.currentPeriodEnd, settled.next.currentPeriodEnd);
});

test("cancelar conserva el acceso hasta el fin del período pagado, sin gracia ni renovación", () => {
  const cancelRequestedAt = ar("2026-10-10", 12);
  const base = snap({ status: "cancel_at_period_end", cancelRequestedAt });
  const facts = [approved("e1", "2026-10-01")]; // cubre [01/10, 01/11)
  assert.equal(reduceSnapshot(base, facts, at("2026-10-20")).next.status, "cancel_at_period_end");
  assert.equal(reduceSnapshot(base, facts, at("2026-10-31", 23, 59, 59)).next.status, "cancel_at_period_end");
  assert.equal(reduceSnapshot(base, facts, at("2026-11-01")).next.status, "canceled", "al terminar lo pagado: canceled, sin días de gracia");
  assert.equal(reduceSnapshot(base, facts, at("2026-11-03")).next.status, "canceled");
  assert.equal(cancelAccessEnd({ currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07"), cancelRequestedAt }), ar("2026-11-01"));
});

test("cancelar cuando ya estaba vencida conserva el acceso sólo hasta el fin de esa gracia", () => {
  const cancelRequestedAt = ar("2026-11-03", 12); // después del fin del período (01/11), dentro de la gracia
  const base = snap({ status: "cancel_at_period_end", cancelRequestedAt });
  const facts = [approved("e1", "2026-10-01"), rejected("e2", "2026-11-01")];
  assert.equal(reduceSnapshot(base, facts, at("2026-11-05")).next.status, "cancel_at_period_end");
  assert.equal(reduceSnapshot(base, facts, at("2026-11-07")).next.status, "canceled");
});

test("un cobro aprobado DESPUÉS de cancelar se registra como anomalía y no revive la cuenta cancelada", () => {
  const cancelRequestedAt = ar("2026-10-10", 12);
  const facts = [approved("e1", "2026-10-01"), approved("e2", "2026-11-01")]; // e2: un cobro posterior a la cancelación
  // Todavía dentro del período pagado: la cuenta sigue en cancel_at_period_end (con el período extendido) y se informa la anomalía.
  const during = reduceSnapshot(snap({ status: "cancel_at_period_end", cancelRequestedAt }), facts, at("2026-11-05"));
  assert.deepEqual(during.anomalies, [{ code: "paid_after_cancel", executionId: "e2" }]);
  assert.equal(during.next.status, "cancel_at_period_end");
  // Ya cancelada: el estado calculado (cancel_at_period_end) no es alcanzable desde canceled → no cambia y se informa.
  const after = reduceSnapshot(snap({ status: "canceled", cancelRequestedAt }), facts, at("2026-11-05"));
  assert.equal(after.next.status, "canceled");
  assert.equal(after.changed, false);
  assert.deepEqual(after.anomalies.map((a) => a.code).sort(), ["impossible_transition", "paid_after_cancel"]);
  assert.equal(after.next.currentPeriodEnd, snap().currentPeriodEnd, "el snapshot no se modifica ante una transición imposible");
});

test("volver a suscribirse tras cancelar o expirar: el período anterior ya no cuenta (pending) y el primer cobro nuevo activa", () => {
  const restartedAt = ar("2026-12-10", 12);
  const old = [approved("e1", "2026-10-01")]; // terminó el 01/11
  const base = snap({ status: "pending", restartedAt, currentPeriodEnd: ar("2026-11-01") });
  assert.equal(reduceSnapshot(base, old, at("2026-12-11")).next.status, "pending");
  const renewed = [...old, approved("e2", "2026-12-10", { occurredAt: ar("2026-12-10", 13) })];
  const result = reduceSnapshot(base, renewed, at("2026-12-20"));
  assert.equal(result.next.status, "active");
  assert.equal(result.next.currentPeriodStart, ar("2026-12-10"));
  assert.equal(result.next.currentPeriodEnd, ar("2027-01-10"));
});

test("grandfathered: sin cobros sigue grandfathered; al pagar es active; si deja de pagar sigue el camino normal", () => {
  const base = snap({ status: "grandfathered", grandfathered: true });
  assert.equal(reduceSnapshot(base, [], at("2027-06-01")).next.status, "grandfathered");
  assert.equal(reduceSnapshot(base, [rejected("e1", "2026-10-01")], at("2026-10-05")).next.status, "grandfathered", "un cobro rechazado sin período no cambia nada");
  const paid = reduceSnapshot(base, [approved("e1", "2026-10-01")], at("2026-10-05"));
  assert.equal(paid.next.status, "active");
  assert.equal(reduceSnapshot(paid.next, [approved("e1", "2026-10-01")], at("2026-12-01")).next.status, "limited");
});

test("expired: el proveedor terminó la suscripción; hasta el fin de lo pagado sigue active, después expired", () => {
  const base = snap({ status: "active", providerEndedAt: ar("2026-10-10") });
  const facts = [approved("e1", "2026-10-01")];
  assert.equal(reduceSnapshot(base, facts, at("2026-10-20")).next.status, "active");
  assert.equal(reduceSnapshot(base, facts, at("2026-11-02")).next.status, "expired");
});

test("cambio de plan: el plan programado se resuelve cuando llega el cobro del plan nuevo, sin duplicar suscripciones", () => {
  const base = snap({ status: "active", planCode: "tf_monthly_ars_v1", pendingPlanCode: "tf_annual_ars_v1" });
  const facts = [approved("e1", "2026-09-01"), approved("e2", "2026-10-01", { planCode: "tf_annual_ars_v1", amountMinor: 24_900_000 })];
  const result = reduceSnapshot(base, facts, at("2026-10-15"));
  assert.equal(result.next.planCode, "tf_annual_ars_v1");
  assert.equal(result.next.pendingPlanCode, null);
  assert.equal(result.next.currentPeriodEnd, ar("2027-10-01"));
  const before = reduceSnapshot(base, [facts[0]], at("2026-09-15"));
  assert.equal(before.next.pendingPlanCode, "tf_annual_ars_v1", "mientras no cobre el plan nuevo, sigue programado");
});

test("deriveFields no usa más que el conjunto de cobros (sin cobros: todo en null)", () => {
  assert.deepEqual(deriveFields([]), { planCode: null, currentPeriodStart: null, currentPeriodEnd: null, renewalRejectedDueAt: null, graceEndsAt: null });
  const rejectedOnly = deriveFields([rejected("e1", "2026-10-01")]);
  assert.equal(rejectedOnly.currentPeriodEnd, null);
  assert.equal(rejectedOnly.renewalRejectedDueAt, null);
});

test("un rechazo viejo (de un vencimiento ya cubierto por un cobro posterior) no genera gracia", () => {
  const facts = [rejected("e1", "2026-09-01"), approved("e2", "2026-09-04"), approved("e3", "2026-10-04")];
  const fields = deriveFields(facts);
  assert.equal(fields.renewalRejectedDueAt, null);
});

test("nextCheckAt: sólo los estados que dependen del reloj tienen próxima revisión", () => {
  const dates = { currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07"), cancelRequestedAt: null };
  assert.equal(nextCheckAt({ status: "active", ...dates }), ar("2026-11-01"));
  assert.equal(nextCheckAt({ status: "past_due", ...dates }), ar("2026-11-07"));
  assert.equal(nextCheckAt({ status: "grace_period", ...dates }), ar("2026-11-07"));
  assert.equal(nextCheckAt({ status: "cancel_at_period_end", ...dates, cancelRequestedAt: ar("2026-10-10") }), ar("2026-11-01"));
  for (const status of ["grandfathered", "pending", "limited", "canceled", "expired"] as const) assert.equal(nextCheckAt({ status, ...dates }), null, status);
});

test("reduceSnapshot no modifica sus argumentos (entrada congelada)", () => {
  const base = deepFreeze(snap({ status: "active" }));
  const facts = deepFreeze([approved("e1", "2026-10-01"), rejected("e2", "2026-11-01")]);
  assert.doesNotThrow(() => reduceSnapshot(base as BillingSnapshot, facts as ExecutionFact[], at("2026-11-02")));
});
