import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSurchargeAmount,
  determineDueStage,
  determineMonthlyDueStage,
  determinePerClassDueStage,
  isChargeOverdueForDisplay,
  resolveMonthlyDueDateUrgency,
} from "../due-stage.ts";

test("determineMonthlyDueStage: escalones 10/18/26 días", () => {
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-09-10"), "on_time"); // día 1
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-09-19"), "on_time"); // día 10
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-09-20"), "first_late"); // día 11
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-09-27"), "first_late"); // día 18
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-09-28"), "second_late"); // día 19
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-10-05"), "second_late"); // día 26
  assert.equal(determineMonthlyDueStage("2026-09-10", "2026-10-06"), "last_late"); // día 27
});

test("determinePerClassDueStage: 0/7/15 días de atraso", () => {
  assert.equal(determinePerClassDueStage("2026-09-10", "2026-09-10"), "on_time");
  assert.equal(determinePerClassDueStage("2026-09-10", "2026-09-08"), "on_time");
  assert.equal(determinePerClassDueStage("2026-09-10", "2026-09-17"), "first_late");
  assert.equal(determinePerClassDueStage("2026-09-10", "2026-09-18"), "second_late");
  assert.equal(determinePerClassDueStage("2026-09-10", "2026-09-26"), "last_late");
});

test("determineDueStage: 'entrenamiento' comparte EXACTAMENTE el camino de 'mensual'", () => {
  assert.equal(determineDueStage("entrenamiento", "2026-09-10", "2026-10-06"), "last_late");
  assert.equal(determineDueStage("mensual", "2026-09-10", "2026-10-06"), "last_late");
  assert.equal(determineDueStage("entrenamiento", "2026-09-10", "2026-10-06"), determineDueStage("mensual", "2026-09-10", "2026-10-06"));
});

test("determineDueStage: 'por_clase' usa el camino de clase suelta", () => {
  assert.equal(determineDueStage("por_clase", "2026-09-10", "2026-09-18"), "second_late");
});

test("calculateSurchargeAmount: SIEMPRE 0, incluso con inputs que sugerirían mora severa", () => {
  assert.equal(calculateSurchargeAmount(100000, "last_late"), 0);
  assert.equal(calculateSurchargeAmount(1, "on_time"), 0);
});

test("resolveMonthlyDueDateUrgency: pendiente/vence_pronto/vence_hoy/mes_vencido", () => {
  assert.equal(resolveMonthlyDueDateUrgency("2026-09-10", "2026-09-05").urgency, "pendiente_en_termino");
  assert.equal(resolveMonthlyDueDateUrgency("2026-09-10", "2026-09-08").urgency, "vence_pronto");
  assert.equal(resolveMonthlyDueDateUrgency("2026-09-10", "2026-09-10").urgency, "vence_hoy");
  assert.equal(resolveMonthlyDueDateUrgency("2026-09-10", "2026-09-11").urgency, "mes_vencido");
});

test("isChargeOverdueForDisplay: mensual/entrenamiento usan la urgencia real de vencimiento, no la etapa de mora", () => {
  // día 11 (first_late) pero todavía no cruzó dueDate+1 en términos de urgencia real de vencimiento visual.
  assert.equal(isChargeOverdueForDisplay("mensual", "2026-09-10", "first_late", "2026-09-11"), true);
  assert.equal(isChargeOverdueForDisplay("por_clase", "2026-09-10", "first_late", "2026-09-11"), true);
  assert.equal(isChargeOverdueForDisplay("por_clase", "2026-09-10", "on_time", "2026-09-10"), false);
});
