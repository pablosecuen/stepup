import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Rediseño visual v1 — Bloque 5: Cobros, Recordatorios, Resumen financiero y Reportes (docs/design/web-v1/10-bloque-5.md). Sólo presentación. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VIEWS = ["components/payments/collections-view.tsx", "components/reminders/reminders-view.tsx", "components/finance/financial-overview-view.tsx"];
const PAGES = ["app/(app)/cobros/page.tsx", "app/(app)/recordatorios/page.tsx", "app/(app)/resumen-financiero/page.tsx"];
const MONEY_FILES = [
  ...VIEWS,
  ...PAGES,
  "components/reminders/reminder-icons.ts",
  "components/payments/charge-actions.tsx",
  "components/payments/void-payment-button.tsx",
  "components/payments/dialog-context.tsx",
  "components/students/profile/cobros-tab.tsx",
  "components/students/profile/reportes-tab.tsx",
];

test("Dinero, recordatorios y reportes ya no usan el azul heredado ni los colores del semáforo de cobro, ni colores crudos de Tailwind", () => {
  for (const file of MONEY_FILES) {
    const source = code(file);
    assert.doesNotMatch(source, /brandBlue|statusVerde|statusRojo|statusAmarillo|statusNaranja|statusPendiente|statusSinDatos|pastelLavender|pastelSage/, file);
    assert.doesNotMatch(source, /\b(bg|text|border|ring|accent)-(amber|red|blue|green|yellow|orange)-\d{2,3}\b/, `${file}: sin colores crudos de Tailwind`);
  }
});

test("Las páginas sólo resuelven los datos como antes y delegan el dibujo a una vista; las vistas no tocan datos", () => {
  const cobros = code(PAGES[0]);
  assert.match(cobros, /Promise\.all\(\[listOpenChargeBalances\(ctx\), listStudents\(ctx\)\]\)/);
  assert.match(cobros, /buildCollectionsCenterEntriesFromBalances\(\{ balances, students, todayDateKey \}\)/);
  assert.match(cobros, /<ChargeGenerationTrigger \/>\s*<CollectionsView entries=\{entries\} \/>/, "un GET nunca escribe: la generación sigue siendo la Server Action del disparador");
  assert.match(cobros, /return <CollectionsErrorView \/>/);
  const recordatorios = code(PAGES[1]);
  assert.match(recordatorios, /const data = await loadHomeData\(ctx\);\s*summary = data\.remindersSummary;/);
  assert.match(recordatorios, /<RemindersView summary=\{summary\} \/>/);
  const resumen = code(PAGES[2]);
  assert.match(resumen, /data = await loadFinancialOverviewData\(ctx, preset\)/);
  assert.match(resumen, /<FinancialOverviewView data=\{data\} preset=\{preset\} \/>/);
  for (const file of VIEWS) {
    const source = code(file);
    assert.doesNotMatch(source, /import (?!type)[^;]*lib\/repositories/, `${file}: sin repositorios`);
    assert.doesNotMatch(source, /supabase|requireAuthenticatedDbContext|fetch\(|\.rpc\(|"use server"|loadHomeData|loadFinancialOverviewData/, `${file}: sin acceso a datos`);
  }
});

test("Cobros: sólo muestra lo que ya carga (alumno, concepto, vencimiento, importe original, saldo, estado), con los mismos textos de estado y los diálogos reales", () => {
  const view = code(VIEWS[0]);
  for (const text of ['"Vence pronto"', '"Vence hoy"', '"Pago vencido"', '"Pago pendiente"']) assert.ok(view.includes(text), text);
  assert.match(view, /entry\.urgency === "vence_pronto"/);
  assert.match(view, /entry\.urgency === "vence_hoy"/);
  assert.match(view, /entry\.urgency === "mes_vencido"/);
  assert.match(view, /entry\.urgency === "pendiente_en_termino"/);
  assert.match(view, /if \(entry\.isOverdue\) return \{ text: "Pago vencido"/);
  for (const field of ["entry.studentName", "entry.dueDate", "entry.balance", "entry.paidAmount", "entry.originalAmount", "entry.chargeType"]) assert.ok(view.includes(field), field);
  assert.match(view, /formatCivilDate\(entry\.dueDate\)/);
  assert.match(view, /formatMoney\(entry\.balance\)/);
  assert.match(view, /de \{formatMoney\(entry\.originalAmount\)\} · ya pagó \{formatMoney\(entry\.paidAmount\)\}/);
  assert.match(view, /<ChargeActions\s+chargeId=\{entry\.chargeId\}\s+studentId=\{entry\.studentId\}\s+balance=\{entry\.balance\}\s+compact/);
  assert.match(view, /studentName: entry\.studentName,\s*concept,\s*dueDate: entry\.dueDate,\s*originalAmount: entry\.originalAmount,/, "los diálogos conservan el contexto del Bloque 3");
  // Nada del prototipo que hoy no existe: ni resumen por estado, ni filtros, ni «Detalle del cobro».
  assert.doesNotMatch(view, /Detalle|Todos \(|Vencidos \(|filtro|Filter|useState/i);
  assert.match(view, /<EmptyState icon=\{BanknotesIcon\} message="No hay cobros pendientes\." \/>/);
  assert.match(view, /message="No pudimos cargar Cobros\."/);
});

test("ChargeActions: las acciones y la clave de operación no cambiaron; sólo existe la variante compacta para la fila de la tabla", () => {
  const actions = code("components/payments/charge-actions.tsx");
  assert.match(actions, /useDraftOperationId\(`teacherflow:cobros:pago:\$\{chargeId\}`\)/);
  assert.match(actions, /registerPaymentAction\(\{\s*operationId,\s*studentId,\s*amount: parsedAmount,/);
  assert.match(actions, /voidChargeAction\(\{ chargeId, voidReason \}\)/);
  assert.match(actions, /compact = false/);
  assert.match(actions, /<DialogContext title=\{joinContextTitle\(context\?\.studentName, context\?\.concept\)\}/);
});

test("Recordatorios: las cuatro categorías reales, sin acciones nuevas para «resolver» y «Todo al día» cuando no queda nada", () => {
  const view = code(VIEWS[1]);
  assert.match(view, /summary\.categories\.map\(\(category\) =>/);
  assert.match(view, /message="Todo al día\. No hay recordatorios pendientes\."/);
  assert.match(view, /item\.title/);
  assert.match(view, /item\.subtitle/);
  assert.doesNotMatch(view, /Button|onClick|useState|href=\{`/, "las filas son informativas: no existe una acción para resolver un recordatorio");
  const icons = code("components/reminders/reminder-icons.ts");
  for (const kind of ["clases_sin_alumnos", "clases_sin_registrar", "pagos_por_vencer", "pagos_vencidos"]) assert.ok(icons.includes(kind), kind);
  assert.match(code("components/dashboard/home-view.tsx"), /import \{ REMINDER_ICONS \} from "@\/components\/reminders\/reminder-icons"/, "Inicio y Recordatorios comparten íconos");
});

test("Resumen financiero: los cinco períodos, la comparación sólo del mes actual y los formateadores únicos (nunca formatos crudos ni formateadores paralelos)", () => {
  const view = code(VIEWS[2]);
  assert.match(view, /\["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"\]/);
  assert.match(view, /data\.comparison \? <>vs\. período anterior: \{formatChange\(data\.comparison\.generated\.percentChange\)\}<\/> : undefined/);
  assert.match(view, /formatPercent\(value === null \? null : Math\.round\(value\), \{ signed: true \}\)/);
  for (const call of ["formatMoney(data.summary.generated)", "formatMoney(data.summary.collected)", "formatMoney(data.summary.pending)", "formatMoney(data.summary.overdue)", "formatMinutesAsHours(data.activity.heldMinutes)", "formatCivilMonth(month)"]) {
    assert.ok(view.includes(call), call);
  }
  assert.match(view, /aria-current=\{selected \? "true" : undefined\}/);
  assert.match(view, /Sólo montos agregados — nunca nombres de alumnos ni información pedagógica\./);
  assert.doesNotMatch(view, /50\/30\/20|Ingresos por mes|Saldos pendientes/, "ninguna sección del prototipo que hoy no existe");
});

test("Guarda contra formateadores paralelos en las pantallas de dinero, recordatorios y reportes", () => {
  for (const file of [...VIEWS, ...PAGES, "components/students/profile/reportes-tab.tsx", "components/students/profile/cobros-tab.tsx", "components/payments/charge-actions.tsx", "components/payments/dialog-context.tsx"]) {
    const source = code(file);
    assert.doesNotMatch(source, /Intl\.|toLocale(Date|Time)?String|\.toFixed\(|toISOString\(\)\.slice/, `${file}: sólo los formateadores únicos de lib/format`);
    // Las páginas sólo pasan `new Date()` («ahora») a los ayudantes únicos; las vistas y componentes nunca construyen fechas.
    if (!PAGES.includes(file)) assert.doesNotMatch(source, /new Date\(/, `${file}: sin fechas armadas a mano`);
    assert.doesNotMatch(source, /\$\{[^}]*\}\s*%(?!`)|\.toString\(\)\.replace\(/, `${file}: nada de porcentajes ni números armados a mano`);
  }
});

test("Reportes del alumno: el flujo real (previsualizar, generar, regenerar, ver, eliminar con confirmación, limpieza) y la idempotencia no cambiaron", () => {
  const tab = code("components/students/profile/reportes-tab.tsx");
  for (const call of [
    "previewStudentReportAction({ studentId, selectedMonths: [...selectedMonths] })",
    "generateStudentReportAction({",
    "startNewReportDraftAction(studentId)",
    "getReportSignedUrlAction(reportId)",
    "regenerateReportPdfAction(reportId)",
    "deleteReportAction(reportId)",
    "retryPendingReportCleanupAction()",
  ]) {
    assert.ok(tab.includes(call), call);
  }
  assert.match(tab, /if \(result\.data!\.transition === "in_progress"\)/);
  assert.match(tab, /const \{ report, staleClaim, warning: serverWarning \} = result\.data!;/);
  assert.match(tab, /<Dialog\s+title="Eliminar reporte"/);
  assert.match(tab, /<Button variant="danger" onClick=\{\(\) => handleDelete\(confirmingRecord\.id\)\} busy=\{isDeleting\}>/);
  assert.match(tab, /formatCivilDateRange\(preview\.periodStart, preview\.periodEnd\)/);
});
