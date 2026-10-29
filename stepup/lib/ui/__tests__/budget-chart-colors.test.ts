// Colores de los gráficos del plan 50/30/20 (29/10/2026): Necesidades azul #2563EB, Gustos violeta #9333EA, Ahorro verde #008568, iguales en dona, barras, leyendas, indicadores y vistas relacionadas;
// «Real / Mes en curso / Estimado» se distinguen por texto, borde y trama (nunca aclarando el color). La paleta por meses de «Evolución de cobros» y los colores generales no cambian.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../../tailwind.config.ts";
import { contrastRatio } from "../contrast.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const colors = (config.theme!.extend as { colors: Record<string, string> }).colors;

/** Distancia de color CIE76 (ΔE) entre dos #RRGGBB. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const lin = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const [r, g, b2] = lin;
    const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b2) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b2, (0.0193 * r + 0.1192 * g + 0.9505 * b2) / 1.08883];
    const f = xyz.map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

test("las tres categorías tienen su color: azul, violeta y verde", () => {
  assert.equal(colors.budgetNeeds, "#2563EB");
  assert.equal(colors.budgetWants, "#9333EA");
  assert.equal(colors.budgetSavings, "#008568");
});

test("los tres colores se distinguen claramente entre sí y de los tonos neutros de los estados, y se ven (3:1) sobre las superficies", () => {
  const cats = [colors.budgetNeeds, colors.budgetWants, colors.budgetSavings];
  for (let i = 0; i < cats.length; i += 1) {
    for (let j = i + 1; j < cats.length; j += 1) assert.ok(deltaE(cats[i], cats[j]) >= 35, `${cats[i]} vs ${cats[j]}: ΔE ${deltaE(cats[i], cats[j]).toFixed(1)}`);
    for (const surface of [colors.background, colors.surface, colors.surface2]) assert.ok(contrastRatio(cats[i], surface) >= 3, `${cats[i]} sobre ${surface}`);
    for (const neutral of [colors.textSecondary, colors.textMuted, colors.ink]) assert.ok(deltaE(cats[i], neutral) >= 25, `${cats[i]} vs neutro ${neutral}`);
  }
});

test("el color de cada categoría es el mismo en la dona, la barra, la leyenda, el diálogo, el objetivo de ahorro, las barras anuales y la landing", () => {
  const suggestion = code("components/finance/budget-suggestion.tsx");
  assert.match(suggestion, /needs: \{ label: "Necesidades", swatch: "bg-budgetNeeds", stroke: "stroke-budgetNeeds" \}/);
  assert.match(suggestion, /wants: \{ label: "Gustos", swatch: "bg-budgetWants", stroke: "stroke-budgetWants" \}/);
  assert.match(suggestion, /savings: \{ label: "Ahorro", swatch: "bg-budgetSavings", stroke: "stroke-budgetSavings" \}/);
  const annual = code("components/finance/annual-projection.tsx");
  assert.match(annual, /needs: \{ solid: "fill-budgetNeeds", hatch: "fill-budgetNeeds", pattern: "budget-hatch-needs", swatch: "bg-budgetNeeds" \}/);
  assert.match(annual, /wants: \{ solid: "fill-budgetWants", hatch: "fill-budgetWants", pattern: "budget-hatch-wants", swatch: "bg-budgetWants" \}/);
  assert.match(annual, /savings: \{ solid: "fill-budgetSavings", hatch: "fill-budgetSavings", pattern: "budget-hatch-savings", swatch: "bg-budgetSavings" \}/);
  assert.match(annual, /swatch=\{PART_STYLE\.needs\.swatch\} label="Necesidades"/);
  assert.match(annual, /swatch=\{PART_STYLE\.wants\.swatch\} label="Gustos"/);
  assert.match(annual, /swatch=\{PART_STYLE\.savings\.swatch\} label="Ahorro"/);
  const dialog = code("components/finance/budget-adjust-dialog.tsx");
  assert.match(dialog, /label="Necesidades".*swatch="bg-budgetNeeds"/);
  assert.match(dialog, /label="Gustos".*swatch="bg-budgetWants"/);
  assert.match(dialog, /label="Ahorro".*swatch="bg-budgetSavings"/);
  assert.match(code("components/finance/savings-goal-form.tsx"), /bg-budgetSavings/);
  const landing = code("components/landing/screens.tsx");
  assert.match(landing, /\["stroke-budgetNeeds", "stroke-budgetWants", "stroke-budgetSavings"\]/);
  assert.match(landing, /\["bg-budgetNeeds", "bg-budgetWants", "bg-budgetSavings"\]/);
  // Ninguna vista financiera conserva los tonos anteriores (marrón / lavanda grisáceo / oliva) para las categorías.
  for (const file of ["components/finance/budget-suggestion.tsx", "components/finance/annual-projection.tsx", "components/finance/budget-adjust-dialog.tsx", "components/finance/savings-goal-form.tsx", "components/finance/financial-overview-view.tsx"]) {
    assert.doesNotMatch(code(file), /dataNeeds|pastelLavender|pastelSage/, file);
  }
});

test("los segmentos no se aclaran con opacidad: coinciden con la leyenda (los estados se distinguen por borde y trama)", () => {
  for (const file of ["components/finance/budget-suggestion.tsx", "components/finance/annual-projection.tsx"]) {
    assert.doesNotMatch(code(file), /opacity[=:{\s"-]|\bopacity-\d|fill-opacity|stroke-opacity/, `${file}: sin opacidad en los colores de datos`);
  }
  const annual = code("components/finance/annual-projection.tsx");
  assert.match(annual, /<pattern key=\{key\} id=\{PART_STYLE\[key\]\.pattern\}/, "una trama por categoría, con el color de la categoría");
  assert.match(annual, /fill=\{estimated \? `url\(#\$\{PART_STYLE\[part\.key\]\.pattern\}\)` : undefined\}/, "«Estimado» = trama");
  assert.match(annual, /className=\{current \? "stroke-ink" : "stroke-textSecondary"\}/, "«Mes en curso» = borde grueso de tinta; «Estimado» = borde punteado");
  assert.match(annual, /strokeDasharray=\{estimated \? "3 2" : undefined\}/);
  assert.match(annual, /kind="current"/);
  assert.match(annual, /kind="hatched"/);
  for (const label of ["Real", "Mes en curso", "Estimado"]) assert.match(annual, new RegExp(`label="${label}"`), `la leyenda dice «${label}»`);
  assert.match(annual, /const STATUS_LABEL: Record<MonthBudgetStatus, string> = \{ real: "Dato real", current_month: "Mes en curso", projected: "Proyección" \}/, "el estado también va en texto en la tabla y en el resumen accesible");
});

test("las cifras, los períodos, la tabla y la selección de año se conservan", () => {
  const annual = code("components/finance/annual-projection.tsx");
  for (const piece of ["Ahorro teórico acumulado con ingresos reales", "Ahorro estimado al completar 12 meses", "Ver detalle mes a mes", "aria-label={`Ver año ${option}`}", "formatMoney(month.totalForDistribution)", "<MonthRow key={month.billingPeriod} month={month} />", "preset=${preset}&anio=${option}"]) {
    assert.ok(annual.includes(piece), piece);
  }
  const suggestion = code("components/finance/budget-suggestion.tsx");
  assert.match(suggestion, /formatMoney\(share\.amount\)/);
  assert.match(suggestion, /\{share\.percent\} %/);
  assert.match(suggestion, /<span>Suma<\/span>/);
});

test("no se tocan los colores generales ni la paleta por meses de «Evolución de cobros»", () => {
  assert.equal(colors.dataNeeds, "#583B1F", "el token anterior sigue existiendo para quien lo usara");
  assert.equal(colors.pastelLavenderText, "#625571");
  assert.equal(colors.pastelSageText, "#59602F");
  assert.equal(colors.statusVerde, "#1B7634", "el semáforo de cobro no cambia");
  const evolution = code("components/finance/collected-evolution-chart.tsx");
  assert.doesNotMatch(evolution, /budgetNeeds|budgetWants|budgetSavings/, "la evolución mensual conserva su propia paleta");
});
