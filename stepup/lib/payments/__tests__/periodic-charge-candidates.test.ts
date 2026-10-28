// Prueba DIFERENCIAL: las funciones de fecha y el armado de candidatos de la web contra el núcleo portado verbatim del original (y sus reglas).
import assert from "node:assert/strict";
import { test } from "node:test";
import { biweeklyPeriodKey, isoWeekKey, startOfIsoWeek, addDaysToDateKey } from "../dates.ts";
import { biweeklyPeriodKey as coreBiweekly, isoWeekKey as coreIsoWeek, startOfIsoWeek as coreStart } from "../../original-core/features/payments/utils/paymentDates.ts";
import { planPeriodicChargeGeneration } from "../../original-core/features/payments/utils/periodicChargeGenerationPlan.ts";
import { buildPeriodicChargeCandidates, dueDateForWeekday, type PeriodicChargeStudentInput } from "../periodic-charge-candidates.ts";

test("semana ISO, lunes de la semana y bloque quincenal coinciden con el original en cada día de 6 años (incluye cambios de año, bisiestos y semana 53)", () => {
  let day = "2022-12-25";
  let checked = 0;
  for (let i = 0; i < 2300; i += 1) {
    assert.equal(isoWeekKey(day), coreIsoWeek(day), `isoWeekKey ${day}`);
    assert.equal(startOfIsoWeek(day), coreStart(day), `startOfIsoWeek ${day}`);
    for (const anchor of ["2024-02-29", "2025-12-31", "2026-10-12"]) assert.equal(biweeklyPeriodKey(day, anchor), coreBiweekly(day, anchor), `biweekly ${day}/${anchor}`);
    day = addDaysToDateKey(day, 1);
    checked += 1;
  }
  assert.equal(checked, 2300);
});

test("vencimiento semanal: el domingo es el último día de la semana ISO (no el primero)", () => {
  assert.equal(dueDateForWeekday("2026-10-26", 1), "2026-10-26");
  assert.equal(dueDateForWeekday("2026-10-26", 5), "2026-10-30");
  assert.equal(dueDateForWeekday("2026-10-26", 6), "2026-10-31");
  assert.equal(dueDateForWeekday("2026-10-26", 0), "2026-11-01");
});

const base = { statusChangeDate: null, billingType: "por_clase" as const, price: 1000 };
function student(id: string, over: Partial<PeriodicChargeStudentInput>): PeriodicChargeStudentInput {
  return { id, status: "activo", billingPlan: null, ...base, ...over };
}

test("candidatos: sólo alumnos con plan semanal/quincenal elegibles; el resto (mensual, por clase, paquete, sin cargo, pausado sin fecha) no genera nada", () => {
  const { weekly, biweekly } = buildPeriodicChargeCandidates(
    [
      student("w", { billingPlan: { type: "weekly", amount: 12000, dueWeekday: 5 } }),
      student("b", { billingPlan: { type: "biweekly", amount: 20000, anchorDate: "2026-10-05" } }),
      student("m", { billingPlan: { type: "monthly", amount: 50000, dueDay: 10 } }),
      student("p", {}),
      student("k", { billingPlan: { type: "class_package", amount: 90000, includedClasses: 8, validFrom: "2026-10-01" } }),
      student("c", { billingPlan: { type: "complimentary" } }),
      student("paused", { status: "pausado", billingPlan: { type: "weekly", amount: 12000, dueWeekday: 1 } }),
      student("old", { status: "inactivo", statusChangeDate: "2026-09-15", billingPlan: { type: "weekly", amount: 12000, dueWeekday: 1 } }),
    ],
    "2026-10-28",
  );
  assert.deepEqual(weekly, [{ studentId: "w", amount: 12000, periodKey: "2026-W44", dueDate: "2026-10-30" }]);
  assert.deepEqual(biweekly, [{ studentId: "b", amount: 20000, periodKey: "2026-10-19", dueDate: "2026-10-19" }]);
});

test("el plan del original sobre estos candidatos es idempotente por (alumno, período) y omite importes inválidos", () => {
  const { weekly } = buildPeriodicChargeCandidates([student("w", { billingPlan: { type: "weekly", amount: 12000, dueWeekday: 3 } }), student("x", { billingPlan: { type: "weekly", amount: 0, dueWeekday: 3 } })], "2026-10-28");
  const first = planPeriodicChargeGeneration({ kind: "semanal", candidates: weekly, existingCharges: [], createdAt: "2026-10-28T12:00:00.000Z" });
  assert.equal(first.toCreate.length, 1);
  assert.deepEqual(first.skipped, [{ studentId: "x", reason: "importe_invalido" }]);
  const second = planPeriodicChargeGeneration({ kind: "semanal", candidates: weekly, existingCharges: first.toCreate, createdAt: "2026-10-28T12:00:00.000Z" });
  assert.equal(second.toCreate.length, 0);
});
