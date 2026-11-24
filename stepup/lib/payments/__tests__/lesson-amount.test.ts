import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { computePerClassBilledAmount } from "../adhoc-billing.ts";
import { DEFAULT_BILLABLE_MINUTES, computeHourlyAmount, rateBasisOf, resolveBillableMinutes, toCents } from "../lesson-amount.ts";
import { buildPlanFromForm, describePlan, initialPlanFormValues } from "../plan-form.ts";
import { formatMoney } from "../../format/number-format.ts";
import { initialDurationMinutes } from "../../lessons/registration-form.ts";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "../billing-plan.ts";
import { ratePeriodLabel, ratePeriodShort } from "../per-student-overview.ts";

const HELD = { outcome: "clase_dictada" as const, isClassHeld: true, lateCancellationPolicy: null, lateCancellationPercentage: null };
const START = "2026-11-24T12:00:00.000Z";
/** Importe de una clase de `minutes` minutos (programada) con una tarifa y su base, por la ÚNICA función que usa el servidor al registrar. */
function billed(rate: number, rateBasis: "class" | "hour", minutes: number, over: Omit<Parameters<typeof computePerClassBilledAmount>[0], "perClassAmount" | "rateBasis" | "lessonTimes">): number {
  return computePerClassBilledAmount({ perClassAmount: rate, rateBasis, lessonTimes: { scheduledStartAt: START, scheduledEndAt: new Date(Date.parse(START) + minutes * 60_000).toISOString() }, ...over });
}

test("tarifa 36.000 por hora: 45, 60, 75, 90, 120 y 135 minutos", () => {
  const expected: Array<[number, number]> = [[45, 27000], [60, 36000], [75, 45000], [90, 54000], [120, 72000], [135, 81000]];
  for (const [minutes, amount] of expected) {
    assert.equal(computeHourlyAmount(36000, minutes), amount, `${minutes} min`);
    assert.equal(billed(36000, "hour", minutes, HELD), amount, `${minutes} min (resultado de la clase)`);
  }
});

test("el importe depende de la DURACIÓN, nunca del horario de inicio: misma duración ⇒ mismo importe", () => {
  const at = (start: string, end: string) => resolveBillableMinutes({ scheduledStartAt: start, scheduledEndAt: end });
  const morning = at("2026-11-24T12:00:00.000Z", "2026-11-24T13:30:00.000Z");
  const evening = at("2026-11-24T21:15:00.000Z", "2026-11-24T22:45:00.000Z");
  assert.equal(morning, 90);
  assert.equal(evening, 90);
  assert.equal(computeHourlyAmount(36000, morning), computeHourlyAmount(36000, evening));
});

test("centavos exactos y redondeo mitad hacia arriba al centavo, sin errores de coma flotante", () => {
  assert.equal(toCents(27500.5), 2750050);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(computeHourlyAmount(27500.5, 60), 27500.5);
  assert.equal(computeHourlyAmount(27500.5, 50), 22917.08); // 22917,0833…
  assert.equal(computeHourlyAmount(10000, 50), 8333.33);
  assert.equal(computeHourlyAmount(10000, 40), 6666.67); // 6666,666…
  assert.equal(computeHourlyAmount(0.01, 30), 0.01); // 0,005 → sube al centavo
  assert.equal(computeHourlyAmount(1.01, 30), 0.51); // 0,505 → 0,51
  assert.equal(computeHourlyAmount(36000, 0), 0);
  assert.equal(computeHourlyAmount(0, 90), 0);
  assert.equal(computeHourlyAmount(-5, 90), 0);
  assert.equal(computeHourlyAmount(Number.NaN, 90), 0);
});

test("un importe FIJO por clase (todos los planes existentes) NO depende de la duración y da exactamente lo mismo que siempre", () => {
  for (const minutes of [30, 60, 90, 135]) {
    const fixed = billed(36000, "class", minutes, HELD);
    assert.equal(fixed, 36000);
    assert.equal(fixed, computePerClassBilledAmount({ perClassAmount: 36000, ...HELD }));
  }
  const withCents = billed(27500.5, "class", 90, HELD);
  assert.equal(withCents, computePerClassBilledAmount({ perClassAmount: 27500.5, ...HELD }));
  assert.equal(withCents, 27500.5);
});

test("un plan sin base explícita es importe fijo; sólo `rateBasis: \"hour\"` en un plan por clase es tarifa horaria", () => {
  const legacy: StudentBillingPlan = { type: "per_class", amount: 36000 };
  assert.equal(rateBasisOf(legacy), "class");
  assert.equal(rateBasisOf({ type: "per_class", amount: 36000, rateBasis: "hour" }), "hour");
  assert.equal(rateBasisOf({ type: "monthly", amount: 36000, dueDay: 10 }), "class");
  // El plan derivado del tipo de cobro y el precio de un alumno antiguo NUNCA se vuelve horario por sí solo.
  assert.deepEqual(resolveStudentBillingPlan({ billingPlan: null, billingType: "por_clase", price: 36000 }), { type: "per_class", amount: 36000 });
});

test("resultado de la clase sobre el valor de ESTA clase: dictada 100 %, cancelada tarde según política, no dictada 0", () => {
  assert.equal(billed(36000, "hour", 90, { outcome: "clase_dictada", isClassHeld: true, lateCancellationPolicy: null, lateCancellationPercentage: null }), 54000);
  assert.equal(billed(36000, "hour", 90, { outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_100", lateCancellationPercentage: null }), 54000);
  assert.equal(billed(36000, "hour", 90, { outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 50 }), 27000);
  assert.equal(billed(36000, "hour", 90, { outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 33 }), 17820);
  assert.equal(billed(36000, "hour", 90, { outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "no_cobrar", lateCancellationPercentage: null }), 0);
  assert.equal(billed(36000, "hour", 90, { outcome: "alumno_ausente", isClassHeld: false, lateCancellationPolicy: null, lateCancellationPercentage: null }), 0);
  assert.equal(billed(36000, "hour", 90, { outcome: "reprogramada", isClassHeld: false, lateCancellationPolicy: null, lateCancellationPercentage: null }), 0);
});

test("duración facturable: la real si existe; si no, la programada; 60 sólo como último recurso — igual que la pantalla de registro", () => {
  assert.equal(DEFAULT_BILLABLE_MINUTES, 60);
  const cases = [
    { actualStartedAt: "2026-11-24T12:00:00.000Z", actualEndedAt: "2026-11-24T13:30:00.000Z", scheduledStartAt: "2026-11-24T12:00:00.000Z", scheduledEndAt: "2026-11-24T13:00:00.000Z" },
    { actualStartedAt: null, actualEndedAt: null, scheduledStartAt: "2026-11-24T12:00:00.000Z", scheduledEndAt: "2026-11-24T13:45:00.000Z" },
    { actualStartedAt: "2026-11-24T12:00:00.000Z", actualEndedAt: "2026-11-24T12:00:00.000Z", scheduledStartAt: "2026-11-24T12:00:00.000Z", scheduledEndAt: "2026-11-24T14:00:00.000Z" },
    { actualStartedAt: null, actualEndedAt: null, scheduledStartAt: "2026-11-24T12:00:00.000Z", scheduledEndAt: "2026-11-24T12:00:00.000Z" },
  ];
  for (const input of cases) assert.equal(resolveBillableMinutes(input), initialDurationMinutes(input as Parameters<typeof initialDurationMinutes>[0]), JSON.stringify(input));
  assert.equal(resolveBillableMinutes({}), 60);
  assert.equal(resolveBillableMinutes({ scheduledStartAt: "2026-11-24T12:00:00.000Z", scheduledEndAt: "2026-11-24T13:30:00.000Z" }), 90);
});

test("«Extender duración»: 60 + 30 = 90 min vale 54.000, y 45 + 45 también (la clase ya extendida es la que se factura)", () => {
  const start = "2026-11-24T12:00:00.000Z";
  const extended = (minutes: number) => new Date(Date.parse(start) + minutes * 60_000).toISOString();
  assert.equal(computeHourlyAmount(36000, resolveBillableMinutes({ scheduledStartAt: start, scheduledEndAt: extended(60 + 30) })), 54000);
  assert.equal(computeHourlyAmount(36000, resolveBillableMinutes({ scheduledStartAt: start, scheduledEndAt: extended(45 + 45) })), 54000);
  assert.equal(computeHourlyAmount(36000, resolveBillableMinutes({ scheduledStartAt: start, scheduledEndAt: extended(60 + 15) })), 45000);
});

test("Plan de cobro: la base se elige expresamente y se conserva; sin elegirla el plan queda como siempre", () => {
  const fixed: StudentBillingPlan = { type: "per_class", amount: 36000 };
  const hourly: StudentBillingPlan = { type: "per_class", amount: 36000, rateBasis: "hour" };
  const base = initialPlanFormValues("per_class", fixed, "2026-11-24", "36.000");
  assert.equal(base.rateBasis, "class");
  assert.deepEqual(buildPlanFromForm(base, fixed), { plan: { type: "per_class", amount: 36000 } });
  assert.deepEqual(buildPlanFromForm({ ...base, rateBasis: "hour" }, fixed), { plan: { type: "per_class", amount: 36000, rateBasis: "hour" } });
  assert.equal(initialPlanFormValues("per_class", hourly, "2026-11-24", "36.000").rateBasis, "hour");
  // Pasar a otro tipo de plan descarta la base: ningún plan que no sea «por clase» la lleva.
  assert.deepEqual(buildPlanFromForm({ ...base, type: "weekly", rateBasis: "hour", dueWeekday: 2 }, hourly), { plan: { type: "weekly", amount: 36000, dueWeekday: 2 } });
  assert.deepEqual(describePlan(hourly).lines, [`${formatMoney(36000)} por hora`]);
  assert.deepEqual(describePlan(fixed).lines, [`${formatMoney(36000)} por clase`]);
});

test("circuito: el registro calcula con la regla compartida y la base de datos la repite; la tarifa fija no cambia", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const action = read("lib/actions/lesson-registrations.ts");
  assert.match(action, /const amount = detail\.registration\.isBillable === false \|\| decision\.kind === "covered" \? 0 : computePerClassBilledAmount\(\{\s*perClassAmount: plan\.amount,\s*rateBasis: plan\.rateBasis === "hour" \? "hour" : "class",\s*lessonTimes,/, "la misma función de siempre, con la base del plan y los horarios de la clase");
  assert.match(action, /if \(participants\.length > 0\) await syncPerClassCharge\(ctx, registrationId, participants\);/);
});

test("Cobros › Por alumno rotula la tarifa por hora como «por hora» y el importe fijo como «por clase»", () => {
  assert.equal(ratePeriodLabel({ amount: 36000, period: "hora" }), "por hora");
  assert.equal(ratePeriodShort({ amount: 36000, period: "hora" }), "/ hora");
  assert.equal(ratePeriodLabel({ amount: 36000, period: "clase" }), "por clase");
  const source = readFileSync(new URL("../per-student-overview.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(source, /period: plan\.rateBasis === "hour" \? "hora" : "clase"/);
});

test("la migración es ADITIVA: agrega columnas y funciones, no reescribe ninguna fila ni migración anterior, y no se aplica sola a datos reales", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261124100000_hourly_rate_billing.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sql, /add column if not exists rate_per_hour numeric\(12, 2\)/);
  assert.match(sql, /add column if not exists billed_minutes integer/);
  assert.doesNotMatch(sql, /\bdrop (table|column)\b|\btruncate\b|\bdelete from\b/i, "nada destructivo");
  // Los únicos UPDATE de filas están dentro de funciones (la corrección explícita y el retiro por falta de cobro, que ya existía): ninguno corre al cargar la migración.
  const outsideFunctions = sql.replace(/create or replace function[\s\S]*?\n\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\bupdate public\./i, "ninguna fila se actualiza al migrar");
  assert.match(sql, /'hourly_rate_repair'/, "toda corrección deja su estado anterior en la auditoría");
});
