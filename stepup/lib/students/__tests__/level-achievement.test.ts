import { test } from "node:test";
import assert from "node:assert/strict";
import { levelAchievementPreview } from "../level-achievement.ts";

const base = { levels: ["Apoyo", "A2"], history: [], dateJoined: "2026-01-01", level: "B1", date: "2026-02-01", today: "2026-10-28" };
test("logro: nivel estándar entre niveles propios, tiempo real y fecha civil", () => {
  assert.deepEqual(levelAchievementPreview(base), { fromLevel: "A2", durationDays: 31, warning: undefined });
});
test("logro: rechaza fecha inexistente, futura, anterior al alta y nivel repetido", () => {
  for (const patch of [{ date: "2026-02-30" }, { date: "2026-11-01" }, { date: "2025-01-01" }, { level: "A2" }, { level: "inventado" }]) assert.ok(levelAchievementPreview({ ...base, ...patch }).error);
});
test("logro: salto y corrección requieren confirmación, historial se ordena por fecha", () => {
  assert.ok(levelAchievementPreview({ ...base, level: "C1" }).warning);
  assert.ok(levelAchievementPreview({ ...base, level: "A1" }).warning);
  assert.ok(levelAchievementPreview({ ...base, history: [{ id: "a", level: "A2", fromLevel: "A1", achievedOn: "2026-03-01" }] }).error);
});
