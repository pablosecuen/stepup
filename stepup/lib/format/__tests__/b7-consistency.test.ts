import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { toDateKey } from "../../payments/dates.ts";
import { computeSelectedMonthsRange, getStudentMonthsWithClasses } from "../../reports/months.ts";
import { buildDeterministicReportNarrative } from "../../reports/narrative.ts";
import { buildStudentReportData, type RegistrationForStudentReport } from "../../reports/student-report-data.ts";
import { buildProgrammedHourlyRateSummary } from "../../reports/hourly-rate.ts";

/** B7 — formatos únicos (importes, porcentajes, horas, notas) y días civiles de Argentina en Reportes. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return out;
}

// --- Días civiles de Argentina (el pendiente de B6) -------------------------------------------------------------------

test("toDateKey: un date key queda igual y un instante pasa al día CIVIL de Argentina (no al día UTC)", () => {
  assert.equal(toDateKey("2026-09-30"), "2026-09-30");
  // 22:00 del 30/09 en Argentina = 01:00 UTC del 01/10: el recorte UTC daba octubre.
  assert.equal(toDateKey("2026-10-01T01:00:00.000Z"), "2026-09-30");
  assert.equal(toDateKey("2026-10-01T01:00:00+00:00"), "2026-09-30");
  assert.equal(toDateKey("2026-09-30T23:59:00.000Z"), "2026-09-30");
  // 00:00 del 01/10 en Argentina = 03:00 UTC.
  assert.equal(toDateKey("2026-10-01T02:59:59.000Z"), "2026-09-30");
  assert.equal(toDateKey("2026-10-01T03:00:00.000Z"), "2026-10-01");
  // Fin de año: la clase del 31/12 a las 22:30 no pasa al año siguiente.
  assert.equal(toDateKey("2027-01-01T01:30:00.000Z"), "2026-12-31");
});

test("Reportes: una clase nocturna de fin de mes cuenta en SU mes (septiembre), no en octubre", () => {
  const lateClass = { countsAsClass: true, dateKey: toDateKey("2026-10-01T01:00:00.000Z") };
  const midMonth = { countsAsClass: true, dateKey: toDateKey("2026-09-15T21:00:00.000Z") };
  assert.deepEqual(getStudentMonthsWithClasses([lateClass, midMonth], "2026-10-05"), ["2026-09"]);
  const range = computeSelectedMonthsRange([lateClass, midMonth], ["2026-09"], "2026-10-05");
  assert.deepEqual(range, { periodStart: "2026-09-15", periodEnd: "2026-09-30", classCount: 2 });
  assert.equal(computeSelectedMonthsRange([lateClass, midMonth], ["2026-10"], "2026-10-05"), null);
});

test("el listado de clases dictadas deriva su día con la función civil, nunca recortando el texto del instante", () => {
  const repo = code("lib/repositories/lesson-registrations.ts");
  assert.match(repo, /import \{ instantDateKey \} from "@\/lib\/calendar\/civil-calendar";/);
  assert.match(repo, /dateKey: instantDateKey\(anchor\)/);
  assert.doesNotMatch(repo, /anchor\.slice\(0, 10\)/);
  assert.match(code("lib/payments/dates.ts"), /return instantDateKey\(isoOrDateKey\);/);
  assert.doesNotMatch(code("lib/payments/dates.ts"), /isoOrDateKey\.slice\(/);
});

test("las demás cuentas de Reportes y del Resumen financiero también usan el día civil (misma función)", () => {
  // Una ocurrencia de la noche del 30/09 (22:00 ART) entra en el período de septiembre, no en el de octubre.
  const occurrence = { scheduledStartAt: "2026-10-01T01:00:00.000Z", scheduledEndAt: "2026-10-01T02:00:00.000Z", isCancelled: false, isRegisteredHeld: true, billedAmount: 1000 };
  const september = buildProgrammedHourlyRateSummary([occurrence as never], { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" }, "2026-10-05");
  const october = buildProgrammedHourlyRateSummary([occurrence as never], { rangeStart: "2026-10-01", rangeEnd: "2026-10-31" }, "2026-10-05");
  assert.equal(september.totalProgrammedHours, 1);
  assert.equal(october.totalProgrammedHours, 0);
});

// --- Formatos únicos -------------------------------------------------------------------------------------------------

test("no hay formateadores paralelos de números ni de fechas: Intl.NumberFormat, toFixed y toLocale* viven sólo en los formateadores únicos", () => {
  const allowed = new Set(["lib/format/number-format.ts", "lib/format/date-format.ts"]);
  const offenders: string[] = [];
  for (const file of sources(["app", "components", "lib"])) {
    if (allowed.has(file)) continue;
    const source = code(file);
    for (const pattern of [/new Intl\.NumberFormat/, /\.toFixed\(/, /\.toLocale(Date|Time)?String\(/]) {
      if (pattern.test(source)) offenders.push(`${file}: ${pattern}`);
    }
    // Un Intl.DateTimeFormat sólo se admite con zona explícita (los cálculos civiles del calendario): nunca la del proceso.
    if (/new Intl\.DateTimeFormat/.test(source) && !/timeZone/.test(source)) offenders.push(`${file}: Intl.DateTimeFormat sin zona`);
  }
  assert.deepEqual(offenders, []);
});

test("cada pantalla de importes usa formatMoney (ya no hay un formatCurrency propio por archivo)", () => {
  const files = [
    "app/(app)/cobros/page.tsx",
    "app/(app)/resumen-financiero/page.tsx",
    "components/payments/charge-actions.tsx",
    "components/payments/training-billing-config.tsx",
    "components/students/profile/cobros-tab.tsx",
    "components/students/profile/informacion-tab.tsx",
  ];
  for (const file of files) {
    const source = code(file);
    assert.match(source, /formatMoney\(/, `${file} usa formatMoney`);
    assert.match(source, /from "@\/lib\/format\/number-format"/);
    assert.doesNotMatch(source, /function formatCurrency|formatCurrencyARS/, `${file} sin formateador propio`);
  }
});

test("la pestaña Cobros del perfil formatea cada importe (original, pagado, pendiente y cada pago) con formatMoney", () => {
  const cobros = code("components/students/profile/cobros-tab.tsx");
  for (const call of ["formatMoney(charge.originalAmount)", "formatMoney(paidAmount)", "formatMoney(balance.balance)", "formatMoney(payment.amount)"]) {
    assert.ok(cobros.includes(call), call);
  }
});

test("horas, notas y duraciones salen del formateador único en el perfil, Reportes y el Resumen financiero", () => {
  assert.match(code("components/students/profile/progreso-tab.tsx"), /formatGrade\(average\)/);
  assert.match(code("components/students/profile/resumen-tab.tsx"), /formatGrade\(stats\.averageGrade\)/);
  assert.match(code("components/students/profile/resumen-tab.tsx"), /formatHours\(stats\.hours\)/);
  assert.match(code("components/students/profile/informacion-tab.tsx"), /formatMinutes\(student\.usualDurationMinutes\)/);
  assert.match(code("components/calendar/real-lesson-detail-modal.tsx"), /formatMinutes\(durationMinutes\)/);
  const reportes = code("components/students/profile/reportes-tab.tsx");
  assert.match(reportes, /formatHours\(preview\.data\.hoursTaught\)/);
  assert.match(reportes, /formatGrade\(preview\.data\.generalAverageGrade\)/);
  assert.match(reportes, /formatCivilMonth\(month\)/, "los meses con el formateador de fechas, no una lista propia");
  assert.doesNotMatch(reportes, /function monthLabel/);
  const financiero = code("app/(app)/resumen-financiero/page.tsx");
  assert.match(financiero, /formatMinutesAsHours/);
  assert.doesNotMatch(financiero, /Math\.round\(\(minutes \/ 60\) \* 10\) \/ 10/);
});

test("el PDF del reporte no muestra formatos técnicos: fechas dd/mm/aaaa, asistencia con su etiqueta, horas y notas con unidad y coma", () => {
  const pdf = code("lib/reports/pdf.tsx");
  assert.match(pdf, /formatCivilDate\(lesson\.dateKey\)/);
  assert.match(pdf, /Generado el \{formatCivilDate\(input\.generatedAtDateKey\)\}/);
  assert.match(pdf, /Reporte generado el \{formatCivilDate\(input\.generatedAtDateKey\)\}/);
  assert.match(pdf, /ATTENDANCE_STATUS_LABEL\[lesson\.attendanceStatus as AttendanceStatus\]/, "nunca «ausente_aviso» crudo");
  assert.match(pdf, /formatHours\(data\.hoursTaught\)/);
  assert.match(pdf, /formatGrade\(s\.averageGrade\)/);
  assert.match(pdf, /key=\{`\$\{lesson\.dateKey\}-\$\{index\}`\}/, "dos clases el mismo día ya no repiten la clave");
  assert.doesNotMatch(pdf, /\{lesson\.dateKey\}<\/Text>/);
  assert.doesNotMatch(pdf, /\{lesson\.attendanceStatus \?\? "—"\}/);
});

function registration(overrides: Partial<RegistrationForStudentReport> = {}): RegistrationForStudentReport {
  return {
    registrationId: "r1",
    dateKey: "2026-09-10",
    scheduledStartAt: "2026-09-10T21:00:00.000Z",
    scheduledEndAt: "2026-09-10T22:30:00.000Z",
    actualStartedAt: null,
    actualEndedAt: null,
    homeworkDescription: null,
    attendance: { status: "presente", lateMinutes: null },
    evaluation: { generalGrade: 8.5, skillGrades: { speaking: 9 }, strengths: [], areasToImprove: [], individualHomeworkDescription: null },
    ...overrides,
  };
}

test("la narrativa del reporte usa coma decimal: «8,5», «2,5 horas», «100%»", () => {
  const data = buildStudentReportData([registration(), registration({ registrationId: "r2", dateKey: "2026-09-11", scheduledStartAt: "2026-09-11T21:00:00.000Z", scheduledEndAt: "2026-09-11T22:00:00.000Z" })]);
  const text = buildDeterministicReportNarrative(data, { generalComment: "", behaviorAndParticipation: "", nextObjectives: "", recommendations: "" });
  assert.match(text, /totalizando 2,5 horas reales/);
  assert.match(text, /El promedio general del período fue 8,5\./);
  assert.match(text, /Habla 9,0/);
  assert.match(text, /La asistencia registrada fue del 100%\./);
  assert.doesNotMatch(text, /\d\.\d/, "ningún decimal con punto");
});

// --- Anchos, densidad y textos -------------------------------------------------------------------------------------------

test("anchos: los nombres y títulos sin espacios se parten en vez de desbordar (regla global + nombres de Cobros)", () => {
  const css = read("app/globals.css");
  assert.match(css, /h1,\s*h2,\s*h3,\s*p\s*\{\s*overflow-wrap: anywhere;\s*\}/);
  const cobros = code("app/(app)/cobros/page.tsx");
  assert.match(cobros, /<div className="min-w-0">\s*<Link href=\{`\/alumnos\/\$\{entry\.studentId\}`\} className="[^"]*\[overflow-wrap:anywhere\]/);
  assert.match(code("components/payments/training-billing-config.tsx"), /<li key=\{c\.studentId\} className="[^"]*\[overflow-wrap:anywhere\]/);
});

test("densidad: Series no repite los alumnos como subtítulo cuando ya son el título, y Registro no estira el botón en escritorio", () => {
  assert.match(code("app/(app)/calendario/series/page.tsx"), /\{rule\.classTitle && <p className="mt-0\.5 text-xs text-textMuted">\{participantNames\}<\/p>\}/);
  assert.match(code("app/(app)/registro/start-registration-button.tsx"), /className="flex flex-col gap-1\.5 sm:items-start"/);
});

test("el selector de período del Resumen financiero dice «Mes actual» (no «Mes», ambiguo)", () => {
  assert.match(code("lib/reports/period.ts"), /current_month: "Mes actual"/);
});
