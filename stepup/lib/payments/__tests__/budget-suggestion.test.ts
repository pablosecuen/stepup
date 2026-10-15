import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_INPUT_ERROR, parseBudgetDistributionInput, splitCollectedByPercent } from "../budget-suggestion.ts";
import { DEFAULT_BUDGET_DISTRIBUTION, adjustNeeds, adjustSavings, adjustWants, normalizeBudgetDistribution } from "../budget-distribution.ts";

const amounts = (shares: ReturnType<typeof splitCollectedByPercent>) => shares.map((share) => share.amount);
const cents = (shares: ReturnType<typeof splitCollectedByPercent>) => shares.reduce((sum, share) => sum + Math.round(share.amount * 100), 0);

test("cero cobrado: $ 0 en cada categoría, sin NaN ni valores negativos (también con datos inválidos)", () => {
  assert.deepEqual(amounts(splitCollectedByPercent(0, DEFAULT_BUDGET_DISTRIBUTION)), [0, 0, 0]);
  for (const bad of [NaN, -500, Infinity, -Infinity]) {
    const shares = splitCollectedByPercent(bad, DEFAULT_BUDGET_DISTRIBUTION);
    assert.deepEqual(amounts(shares), [0, 0, 0], String(bad));
    assert.ok(shares.every((share) => Number.isFinite(share.amount) && !Number.isNaN(share.percent)));
  }
});

test("importes enteros: 50/30/20 de $ 100.000 son 50.000 / 30.000 / 20.000 y suman el total", () => {
  const shares = splitCollectedByPercent(100000, { needs: 50, wants: 30, savings: 20 });
  assert.deepEqual(shares.map((s) => [s.category, s.percent, s.amount]), [["needs", 50, 50000], ["wants", 30, 30000], ["savings", 20, 20000]]);
  assert.equal(cents(shares), 10000000);
});

test("centavos: el resto mayor reparte el centavo sobrante y los tres importes suman EXACTO el cobrado", () => {
  for (const total of [0.01, 0.02, 0.05, 1, 10.01, 99.99, 1234.56, 1000.01, 333.33, 0.1 + 0.2]) {
    for (const distribution of [{ needs: 50, wants: 30, savings: 20 }, { needs: 34, wants: 33, savings: 33 }, { needs: 100, wants: 0, savings: 0 }, { needs: 0, wants: 0, savings: 100 }, { needs: 1, wants: 98, savings: 1 }]) {
      const shares = splitCollectedByPercent(total, distribution);
      assert.equal(cents(shares), Math.round(total * 100), `${total} con ${JSON.stringify(distribution)}`);
      assert.ok(shares.every((s) => s.amount >= 0), "nunca negativos");
    }
  }
  assert.deepEqual(amounts(splitCollectedByPercent(0.01, { needs: 50, wants: 30, savings: 20 })), [0.01, 0, 0], "un centavo va a la categoría con mayor parte pendiente");
  assert.deepEqual(amounts(splitCollectedByPercent(100.01, { needs: 34, wants: 33, savings: 33 })), [34.01, 33, 33]);
});

test("valores grandes: sin pérdida de precisión hasta cientos de millones con centavos", () => {
  const shares = splitCollectedByPercent(987654321.99, { needs: 50, wants: 30, savings: 20 });
  assert.equal(cents(shares), 98765432199);
  assert.deepEqual(amounts(shares), [493827160.99, 296296296.6, 197530864.4]);
});

test("propiedad: cualquier distribución válida y cualquier total reparten exactamente el total (semillas deterministas)", () => {
  let seed = 20261014;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 400; i++) {
    const needs = Math.floor(rand() * 101);
    const wants = Math.floor(rand() * (101 - needs));
    const distribution = { needs, wants, savings: 100 - needs - wants };
    const total = Math.round(rand() * 1e9) / 100;
    const shares = splitCollectedByPercent(total, distribution);
    assert.equal(cents(shares), Math.round(total * 100), JSON.stringify({ total, distribution }));
    assert.equal(shares.reduce((sum, s) => sum + s.percent, 0), 100);
  }
});

test("edición válida: tres enteros de 0 a 100 que suman exactamente 100", () => {
  assert.deepEqual(parseBudgetDistributionInput({ needs: "50", wants: "30", savings: "20" }), { ok: true, distribution: { needs: 50, wants: 30, savings: 20 } });
  assert.deepEqual(parseBudgetDistributionInput({ needs: "100", wants: "0", savings: "0" }), { ok: true, distribution: { needs: 100, wants: 0, savings: 0 } });
  assert.deepEqual(parseBudgetDistributionInput({ needs: " 40 ", wants: "40", savings: "20" }), { ok: true, distribution: { needs: 40, wants: 40, savings: 20 } }, "espacios alrededor");
});

test("edición inválida, parcial o con suma distinta: se RECHAZA entera, sin arreglar nada ni guardar a medias", () => {
  const bad: Array<[string, { needs: unknown; wants: unknown; savings: unknown }]> = [
    ["falta un valor", { needs: "50", wants: "30", savings: null }],
    ["faltan dos", { needs: "50", wants: undefined, savings: undefined }],
    ["vacío", { needs: "", wants: "30", savings: "70" }],
    ["suma 99", { needs: "50", wants: "30", savings: "19" }],
    ["suma 101", { needs: "50", wants: "31", savings: "20" }],
    ["negativo", { needs: "-10", wants: "60", savings: "50" }],
    ["decimal", { needs: "50.5", wants: "29.5", savings: "20" }],
    ["coma decimal", { needs: "50,5", wants: "29,5", savings: "20" }],
    ["texto", { needs: "abc", wants: "30", savings: "20" }],
    ["NaN", { needs: "NaN", wants: "30", savings: "20" }],
    ["notación científica", { needs: "5e1", wants: "30", savings: "20" }],
    ["hexadecimal", { needs: "0x32", wants: "30", savings: "20" }],
    ["mayor que 100", { needs: "150", wants: "0", savings: "-50" }],
    ["no es texto", { needs: 50, wants: 30, savings: 20 }],
    ["objeto", { needs: {}, wants: "30", savings: "20" }],
    ["demasiado largo", { needs: "00050", wants: "30", savings: "20" }],
  ];
  for (const [name, input] of bad) {
    const result = parseBudgetDistributionInput(input);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.error, BUDGET_INPUT_ERROR, name);
  }
  assert.match(BUDGET_INPUT_ERROR, /No se guardó nada/);
});

test("repetida (idempotente): validar y normalizar el mismo valor da siempre el mismo resultado, también tras una respuesta perdida", () => {
  const input = { needs: "45", wants: "35", savings: "20" };
  const first = parseBudgetDistributionInput(input);
  const second = parseBudgetDistributionInput(input);
  assert.deepEqual(first, second);
  assert.ok(first.ok && second.ok);
  if (first.ok) {
    assert.deepEqual(normalizeBudgetDistribution(first.distribution), first.distribution, "el repositorio normaliza y no cambia un valor ya válido");
    assert.deepEqual(normalizeBudgetDistribution(normalizeBudgetDistribution(first.distribution)), first.distribution);
  }
});

test("los motores de edición en vivo siempre dejan suma 100 (lo que el diálogo muestra es lo que se valida)", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let current = { ...DEFAULT_BUDGET_DISTRIBUTION };
  for (let i = 0; i < 300; i++) {
    const value = Math.floor(rand() * 101);
    const pick = Math.floor(rand() * 3);
    current = pick === 0 ? adjustNeeds(current, value) : pick === 1 ? adjustWants(current, value) : adjustSavings(current, value);
    assert.equal(current.needs + current.wants + current.savings, 100);
    const parsed = parseBudgetDistributionInput({ needs: String(current.needs), wants: String(current.wants), savings: String(current.savings) });
    assert.equal(parsed.ok, true, JSON.stringify(current));
  }
});
