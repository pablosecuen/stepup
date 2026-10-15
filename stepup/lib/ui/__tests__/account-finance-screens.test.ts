import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/**
 * Bloque de cuenta, Configuración, Resumen financiero y anchos generales: cableado de las pantallas (el comportamiento real —
 * medidas, teclado, desbordes— se verifica en el navegador). Los cálculos tienen sus propias pruebas
 * (`lib/reports/__tests__/monthly-collected.test.ts`, `lib/payments/__tests__/budget-suggestion.test.ts`).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const VIEW = "components/finance/financial-overview-view.tsx";
const CHART = "components/finance/collected-evolution-chart.tsx";
const SUGGESTION = "components/finance/budget-suggestion.tsx";
const DIALOG = "components/finance/budget-adjust-dialog.tsx";

test("Resumen financiero: encabezado, períodos y métricas conservados; el orden es cifras → evolución → distribución → actividad", () => {
  const view = code(VIEW);
  assert.match(view, /<PageHeader title="Resumen financiero" subtitle="Tus cobros, actividad y una guía para organizar lo ingresado\." \/>/);
  assert.match(view, /\["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"\]/);
  for (const label of ["Facturación prevista", "Cobrado (por fecha real de pago)", "Pendiente en término", "Vencido"]) assert.ok(view.includes(`label="${label}"`), label);
  const order = ['aria-label="Cifras del período"', 'id="evolucion-titulo"', 'id="distribucion-titulo"', "Actividad del período"].map((needle) => view.indexOf(needle));
  assert.ok(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join(), `orden de secciones: ${order}`);
  for (const kept of ["Clases dictadas", "Horas dictadas", "Canceladas", "Reprogramadas", "Presencial", "Online", "Mixta"]) assert.ok(view.includes(kept), `Actividad del período conserva «${kept}»`);
  assert.match(view, /className=\{PAGE_WIDTH\.wide\}/);
  assert.doesNotMatch(view, /studentName|displayName|student\.name/, "sólo montos agregados: nunca nombres de alumnos");
  // la actividad sigue separada de lo financiero
  const activity = view.slice(view.indexOf("Actividad del período"), view.indexOf("Valor programado de la hora"));
  assert.doesNotMatch(activity, /BudgetSuggestion|CollectedEvolutionChart|formatMoney/, "la actividad no se mezcla con la distribución financiera");
});

test("«Evolución de cobros»: datos reales del cargador, barras verdes, accesible por teclado y lector, con tabla alternativa y estado vacío", () => {
  const view = code(VIEW);
  assert.match(view, /<CollectedEvolutionChart series=\{data\.collectedSeries\} caption=\{chartCaption\} \/>/);
  const chart = code(CHART);
  assert.match(chart, /bg-ok/, "barras verdes: representan ingresos");
  assert.doesNotMatch(chart, /bg-bad|bg-accent|text-bad|accentDark|badLine|terracota|bg-red/, "rojo y terracota quedan para vencidos y alertas");
  assert.match(chart, /formatMoney\(/, "importes con el formateador monetario único");
  assert.doesNotMatch(chart, /Intl\.|toLocale|\.toFixed\(/);
  assert.match(chart, /role="tooltip"/);
  assert.match(chart, /aria-describedby=\{tip && tip\.text === label\(point\)/);
  assert.match(chart, /event\.key === "Escape"/, "Escape cierra el tooltip");
  assert.match(chart, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/, "flechas, Inicio y Fin");
  assert.match(chart, /tabIndex=\{index === activeIndex \? 0 : -1\}/, "una sola parada de Tab");
  assert.match(chart, /aria-label=\{label\(point\)\}/, "cada barra se anuncia con período e importe");
  assert.match(chart, /matches\(":focus-visible"\)/, "el tooltip también aparece con el teclado");
  assert.match(chart, /<details/);
  assert.match(chart, /<table[\s\S]*<caption className="sr-only">[\s\S]*<th scope="col"[\s\S]*<th scope="row"/, "tabla accesible con el mismo contenido");
  assert.match(chart, /series\.length === 0 \|\| total <= 0/, "sin cobros: estado vacío");
  assert.match(chart, /Todavía no hay cobros registrados en estos meses/);
  assert.match(chart, /max-w-\[540px\] rounded-md border-2 border-dashed/, "estado vacío compacto, alineado a la izquierda");
  assert.match(chart, /point\.amount > 0 && max > 0 \? Math\.max\(2, Math\.round/, "un mes sin cobros no dibuja barra ficticia");
  assert.match(chart, /motion-reduce:transition-none/);
  // el cargador usa lo ya cargado: sin consultas por elemento
  const loader = code("lib/dashboard/load-financial-overview.ts");
  assert.match(loader, /const collectedSeries = buildMonthlyCollectedSeries\(/);
  assert.match(loader, /chartMonthsForRange\(range, evaluationDate, preset\)/);
  const seriesBlock = loader.slice(loader.indexOf("const collectedSeries"), loader.indexOf("const budget ="));
  assert.doesNotMatch(seriesBlock, /await|ctx\./, "la serie sale de pagos y asignaciones ya cargados: ni una consulta más, ni N+1");
  assert.equal((loader.match(/listAllPayments\(ctx\)/g) ?? []).length, 1, "los pagos se leen una sola vez");
  assert.match(read("lib/reports/monthly-collected.ts"), /toDateKey\(payment\.paidAt\)/, "mes civil de Argentina por la fecha real de pago");
});

test("«Distribución sugerida»: sobre lo COBRADO del período, con aclaración visible, dona, barra apilada, tres categorías con porcentaje e importe y suma 100 %", () => {
  const view = code(VIEW);
  assert.match(view, /<BudgetSuggestion collected=\{data\.summary\.collected\} distribution=\{data\.budget\} \/>/, "la base es lo cobrado: nunca lo previsto, lo pendiente ni lo vencido");
  assert.doesNotMatch(view.slice(view.indexOf("<BudgetSuggestion"), view.indexOf("<BudgetSuggestion") + 120), /generated|pending|overdue/);
  const suggestion = code(SUGGESTION);
  assert.match(suggestion, /Proyección orientativa sobre lo cobrado; no representa tus gastos ni tu ahorro real\./);
  assert.match(suggestion, /splitCollectedByPercent\(collected, distribution\)/);
  for (const label of ["Necesidades", "Gustos", "Ahorro"]) assert.ok(suggestion.includes(`label: "${label}"`), label);
  assert.match(suggestion, /<Donut shares=\{shares\}/);
  assert.match(suggestion, /role="img" aria-label=\{`Distribución sugerida: \$\{summary\}`\}/, "la dona se lee como texto");
  assert.match(suggestion, /<span>Suma<\/span>[\s\S]*\{sum\} %/, "suma final visible");
  assert.match(suggestion, /\{share\.percent\} %/);
  assert.match(suggestion, /formatMoney\(share\.amount\)/);
  assert.match(suggestion, /Ajustar porcentajes/);
  assert.match(suggestion, /Todavía no hay dinero cobrado en este período, así que cada categoría muestra/, "cero cobrado: $ 0 y un estado claro");
  assert.match(suggestion, /formatMoney\(hasCollected \? collected : 0\)/, "nunca NaN");
  // colores: azul, violeta y verde; nada de rojo para categorías normales
  assert.match(suggestion, /needs: \{[^}]*dataNeeds/);
  assert.match(suggestion, /wants: \{[^}]*pastelLavenderText/);
  assert.match(suggestion, /savings: \{[^}]*pastelSageText/);
  assert.doesNotMatch(suggestion, /bg-bad|text-bad|stroke-bad|accent|statusRojo/);
  assert.doesNotMatch(suggestion, /gastaste|ahorraste/i, "nunca presenta los importes como gastos o ahorro reales");
});

test("«Ajustar porcentajes»: diálogo compacto con la acción existente, suma en vivo, Escape sin guardar y foco atrapado/devuelto (Dialog)", () => {
  const dialog = code(DIALOG);
  assert.match(dialog, /<Dialog\s+title="Ajustar porcentajes"/);
  assert.match(dialog, /onClose=\{onClose\}/);
  assert.match(dialog, /useGuardedActionState\(saveBudgetDistributionAction, INITIAL_STATE\)/, "reutiliza la acción de guardado existente (atómica e idempotente)");
  for (const field of ["needs", "wants", "savings"]) assert.match(dialog, new RegExp(`<input type="hidden" name="${field}"`));
  for (const fn of ["adjustNeeds", "adjustWants", "adjustSavings"]) assert.match(dialog, new RegExp(`${fn}\\(draft, value\\)`));
  assert.match(dialog, /Suma: \{sum\} %/);
  assert.match(dialog, /role="status" aria-live="polite"/);
  assert.match(dialog, /state\.error && <FormErrorBox message=\{state\.error\} \/>/);
  assert.match(dialog, /form=\{formId\}/, "el botón Guardar del pie envía el formulario");
  assert.match(dialog, /if \(state\.saved === true && !state\.error\) onSaved\(\)/);
  const ui = code("components/ui/dialog.tsx");
  assert.match(ui, /useDialogA11y\(requestClose\)/, "Escape, foco atrapado y foco devuelto al abrir/cerrar");
  assert.match(code("lib/ui/use-dialog-a11y.ts"), /event\.key === "Escape"[\s\S]*onCloseRef\.current\(\)/);
  assert.match(code("lib/ui/use-dialog-a11y.ts"), /opener\.focus\(\)/);
  // los tres controles no ocupan la pantalla de forma permanente: sólo existen dentro del diálogo
  assert.doesNotMatch(code(SUGGESTION), /type="range"/);
  assert.match(dialog, /type="range"/);
});

test("la acción de guardado valida antes de tocar nada y repetirla es seguro; la edición ya no existe en Configuración", () => {
  const action = code("lib/actions/account.ts");
  assert.match(action, /const parsed = parseBudgetDistributionInput\(\{ needs: formData\.get\("needs"\), wants: formData\.get\("wants"\), savings: formData\.get\("savings"\) \}\);\n  if \(!parsed\.ok\) return \{ error: parsed\.error \};/);
  assert.ok(action.indexOf("parseBudgetDistributionInput(") < action.indexOf("requireAuthenticatedDbContext()", action.indexOf("saveBudgetDistributionAction")), "se valida ANTES de pedir la sesión y escribir");
  assert.match(action, /revalidatePath\("\/resumen-financiero"\)/);
  const repo = code("lib/repositories/budget-distribution.ts");
  assert.match(repo, /\.upsert\(\{/, "un único upsert por propietaria: atómico e idempotente");
  assert.match(repo, /owner_id: ctx\.ownerId/, "aislamiento por propietaria");
  // el 50/30/20 aparece SÓLO en Resumen financiero (componentes de finanzas), nunca en Configuración ni en otra pantalla
  // La landing pública sólo NOMBRA «Distribución sugerida» en una maqueta demostrativa (sin acciones, sin guardado, sin cálculo real).
  const all = [...sources("app"), ...sources("components")];
  const isLanding = (file: string) => file.startsWith("components/landing/");
  const holders = all.filter((file) => !isLanding(file) && /Ajustar porcentajes|Distribución sugerida|saveBudgetDistributionAction|splitCollectedByPercent/.test(code(file)));
  assert.deepEqual(holders.sort(), [DIALOG, SUGGESTION, VIEW].sort(), "la funcionalidad vive sólo en Resumen financiero");
  for (const file of all.filter(isLanding)) assert.doesNotMatch(code(file), /Ajustar porcentajes|saveBudgetDistributionAction|splitCollectedByPercent|BudgetSuggestion|budget-adjust-dialog/, `${file}: la landing no trae la funcionalidad, sólo una maqueta`);
  assert.equal(existsSync(join(ROOT, "components/account/budget-distribution-form.tsx")), false, "no se duplica: el formulario de Configuración se retiró");
});

test("inventario de anchos: cada pantalla privada usa la primitiva compartida PAGE_WIDTH (sin clases de ancho repetidas) con el ancho que corresponde a su contenido", () => {
  const EXPECTED: Record<string, "wide" | "medium" | "narrow"> = {
    // listas y paneles: ancho útil del shell
    "components/dashboard/home-view.tsx": "wide",
    "components/dashboard/home-error.tsx": "medium",
    "app/(app)/calendario/page.tsx": "wide",
    "app/(app)/calendario/disponibilidad/page.tsx": "wide",
    "app/(app)/calendario/series/page.tsx": "wide",
    "components/calendar/series-list-view.tsx": "wide",
    "components/students/students-list-view.tsx": "wide",
    "components/payments/collections-view.tsx": "wide",
    "components/finance/financial-overview-view.tsx": "wide",
    "app/(app)/configuracion/page.tsx": "wide",
    "app/(app)/configuracion/respaldo/page.tsx": "wide",
    "app/(app)/registro/page.tsx": "wide",
    "components/registro/pending-list-view.tsx": "wide",
    "components/reminders/reminders-view.tsx": "wide",
    // fichas de lectura continua y formularios largos: ancho medio (a propósito)
    "components/students/profile/student-profile-view.tsx": "medium",
    "components/registro/registro-page-frame.tsx": "medium",
    "app/(app)/registro/libre/[registrationId]/page.tsx": "medium",
    "app/(app)/alumnos/[id]/page.tsx": "medium",
    // formularios breves y confirmaciones: angosto (a propósito, no se estiran)
    "components/students/student-form-page.tsx": "narrow",
    "components/ui/form-page.tsx": "narrow",
    "app/(app)/alumnos/nuevo/page.tsx": "narrow",
    "app/(app)/alumnos/[id]/editar/page.tsx": "narrow",
    "app/(app)/calendario/nueva/page.tsx": "narrow",
    "app/(app)/registro/nuevo/page.tsx": "narrow",
  };
  for (const [file, width] of Object.entries(EXPECTED)) {
    const found = new Set([...code(file).matchAll(/PAGE_WIDTH\.(wide|medium|narrow)/g)].map((m) => m[1]));
    assert.deepEqual([...found], [width], `${file}: PAGE_WIDTH.${width}`);
  }
  // La primitiva es el ÚNICO lugar con los anchos máximos y el relleno de página
  const offenders = [...sources("app/(app)"), ...sources("components")].filter((file) => file !== "components/ui/page-header.tsx" && /mx-auto w-full max-w-\[(1180|960|760)px\] px-4/.test(read(file)));
  assert.deepEqual(offenders, [], "ninguna pantalla repite las clases de ancho de página");
  const header = code("components/ui/page-header.tsx");
  assert.match(header, /wide: "mx-auto w-full max-w-\[1180px\] px-4 py-5 nav:px-10 nav:pb-\[30px\] nav:pt-2"/);
  // Lo que NO se ensancha: autenticación y diálogos conservan su lectura angosta
  for (const file of ["components/auth/auth-shell.tsx", "app/iniciando-sesion/page.tsx"]) assert.match(code(file), /max-w-\[440px\]/, file);
  assert.doesNotMatch(code("components/ui/dialog.tsx"), /PAGE_WIDTH/);
});

test("estados vacíos compactos: alineados a la izquierda y de ~560 px como máximo en pantallas anchas; fluidos en móvil", () => {
  const states = code("components/ui/states.tsx");
  assert.match(states, /<div className="w-full max-w-\[560px\] rounded-lg border-2 border-dashed/);
  assert.doesNotMatch(states.slice(states.indexOf("export function EmptyState")), /mx-auto w-full max-w-\[560px\]/, "el bloque no se centra: queda a la izquierda");
});

test("una sola fila superior de sesión y contenedores que no la tapan: Inicio, Configuración y Resumen financiero heredan el mismo shell", () => {
  const layout = code("app/(app)/layout.tsx");
  assert.equal((layout.match(/<main/g) ?? []).length, 1, "un solo <main> por pantalla privada");
  for (const file of sources("app/(app)").filter((f) => f.endsWith("page.tsx"))) {
    assert.doesNotMatch(code(file), /<main\b/, `${file}: el <main> es del layout`);
  }
  assert.match(layout, /data-session-bar/);
});
