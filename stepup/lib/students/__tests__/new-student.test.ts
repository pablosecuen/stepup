// Regla única de la etiqueta «Nuevo» (29/10/2026): desde el alta hasta cumplirse 10 días hábiles posteriores (lunes a viernes, fechas civiles de Argentina), sin feriados inventados.
// Calendario de octubre de 2026: lun 5, mar 6, mié 7, jue 8, vie 9, [sáb 10, dom 11], lun 12 (feriado: cuenta como hábil), mar 13, mié 14, jue 15, vie 16, [sáb 17, dom 18], lun 19, mar 20…
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { isNewStudent, isNewStudentOn, NEW_STUDENT_BUSINESS_DAYS } from "../new-student.ts";
import { studentBadges } from "../list-presentation.ts";
import type { StudentStatusProjection } from "../list-status.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("el plazo son 10 días hábiles", () => assert.equal(NEW_STUDENT_BUSINESS_DAYS, 10));

test("alta reciente: se muestra desde el mismo día del alta", () => {
  assert.equal(isNewStudentOn("2026-10-29", "2026-10-29"), true, "el día del alta");
  assert.equal(isNewStudentOn("2026-10-28", "2026-10-29"), true, "un día después");
  assert.equal(isNewStudentOn("2026-10-22", "2026-10-29"), true, "cinco días hábiles después");
});

test("alta un lunes: visible hasta el viernes de la segunda semana; el décimo día hábil (lunes 19) ya no", () => {
  const alta = "2026-10-05";
  for (const day of ["2026-10-05", "2026-10-06", "2026-10-09", "2026-10-12", "2026-10-15", "2026-10-16"]) assert.equal(isNewStudentOn(alta, day), true, day);
  assert.equal(isNewStudentOn(alta, "2026-10-17"), true, "sábado: todavía van 9 días hábiles");
  assert.equal(isNewStudentOn(alta, "2026-10-18"), true, "domingo: todavía van 9");
  assert.equal(isNewStudentOn(alta, "2026-10-19"), false, "lunes 19: se cumplen los 10 días hábiles posteriores al alta");
  assert.equal(isNewStudentOn(alta, "2026-10-20"), false);
});

test("alta un viernes: la cuenta empieza el lunes siguiente; el viernes 16 se cumplen los 10", () => {
  const alta = "2026-10-02";
  assert.equal(isNewStudentOn(alta, "2026-10-02"), true);
  assert.equal(isNewStudentOn(alta, "2026-10-05"), true, "lunes siguiente = 1.º día hábil");
  assert.equal(isNewStudentOn(alta, "2026-10-15"), true, "jueves 15 = 9.º día hábil");
  assert.equal(isNewStudentOn(alta, "2026-10-16"), false, "viernes 16 = 10.º día hábil");
});

test("alta un sábado o un domingo: igual que el viernes anterior (los fines de semana no cuentan)", () => {
  for (const alta of ["2026-10-03", "2026-10-04"]) {
    assert.equal(isNewStudentOn(alta, alta), true, `${alta}: el día del alta`);
    assert.equal(isNewStudentOn(alta, "2026-10-15"), true, `${alta}: 9.º día hábil`);
    assert.equal(isNewStudentOn(alta, "2026-10-16"), false, `${alta}: 10.º día hábil`);
  }
});

test("límite exacto: el día 9 sí y el día 10 no, sea cual sea el día de la semana del alta", () => {
  for (let offset = 0; offset < 14; offset += 1) {
    const joined = new Date(Date.UTC(2026, 5, 1 + offset)).toISOString().slice(0, 10);
    let business = 0;
    for (let day = 1; day <= 40; day += 1) {
      const date = new Date(Date.UTC(2026, 5, 1 + offset + day));
      const weekday = date.getUTCDay();
      if (weekday >= 1 && weekday <= 5) business += 1;
      assert.equal(isNewStudentOn(joined, date.toISOString().slice(0, 10)), business < 10, `${joined} → ${date.toISOString().slice(0, 10)} (${business} hábiles)`);
    }
  }
});

test("no se inventa un calendario de feriados: el lunes 12/10/2026 cuenta como día hábil", () => {
  assert.equal(isNewStudentOn("2026-10-05", "2026-10-16"), true, "con el 12 contado como hábil van 9");
  assert.equal(isNewStudentOn("2026-10-05", "2026-10-19"), false, "y el 10.º es el 19 (sin sumarle un día por el feriado)");
});

test("alumno antiguo, importado con la fecha de alta real: nunca «Nuevo»", () => {
  assert.equal(isNewStudentOn("2025-03-01", "2026-10-29"), false);
  assert.equal(isNewStudentOn("2026-01-01", "2026-10-29"), false);
  assert.equal(isNewStudentOn("1970-01-01", "2026-10-29"), false);
});

test("sin fecha confiable o con fecha inválida: no se marca como nuevo", () => {
  for (const bad of [null, undefined, "", "   ", "ayer", "2026-02-30", "2026-13-01", "2026-00-10", "2026-10-00", "2026-1-5", "26-10-05", "2026-10-05T00:00:00Z", "05/10/2026", "NaN-NaN-NaN"]) {
    assert.equal(isNewStudentOn(bad as string, "2026-10-29"), false, JSON.stringify(bad));
  }
  assert.equal(isNewStudentOn("2026-10-28", "no es una fecha"), false, "un «hoy» inválido tampoco marca");
});

test("fecha futura: no se muestra antes del alta, y aparece el día del alta", () => {
  assert.equal(isNewStudentOn("2026-10-30", "2026-10-29"), false, "mañana");
  assert.equal(isNewStudentOn("2027-01-01", "2026-10-29"), false, "lejos en el futuro");
  assert.equal(isNewStudentOn("2026-10-30", "2026-10-30"), true, "el día del alta ya se muestra");
});

test("«hoy» es la fecha civil de Argentina, igual en el servidor y en el navegador (no la fecha UTC ni la zona del equipo)", () => {
  // 18/10/2026 23:30 en Buenos Aires = 19/10/2026 02:30 UTC. Para Argentina sigue siendo domingo 18 (9 días hábiles); en UTC ya sería lunes 19 (10).
  assert.equal(isNewStudent("2026-10-05", new Date("2026-10-19T02:30:00Z")), true);
  assert.equal(isNewStudent("2026-10-05", new Date("2026-10-19T03:00:00Z")), false, "00:00 del lunes 19 en Buenos Aires");
  assert.equal(isNewStudent("2026-10-29", new Date("2026-10-30T02:59:00Z")), true, "29/10 23:59 en Buenos Aires: el mismo día del alta");
  assert.equal(isNewStudent("2026-10-30", new Date("2026-10-30T02:59:00Z")), false, "todavía es 29/10 en Argentina: el alta del 30 es futura");
  assert.equal(isNewStudent("2026-10-30", new Date("2026-10-30T03:00:00Z")), true);
  // Mismo resultado con cualquier zona horaria del equipo: la regla no usa getDay()/getHours() locales.
  assert.doesNotMatch(source("lib/students/new-student.ts").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""), /\.getDay\(|\.getHours\(|\.getDate\(|\.getMonth\(|getTimezoneOffset|Intl\./, "sólo aritmética civil en UTC");
});

test("vence solo, con el paso de los días, sin cambiar ningún dato", () => {
  const joined = "2026-10-26"; // lunes
  const seen = ["2026-10-26", "2026-11-06", "2026-11-08", "2026-11-09"].map((day) => isNewStudentOn(joined, day));
  assert.deepEqual(seen, [true, true, true, false], "vie 6/11 = 9.º día hábil (sigue), lun 9/11 = 10.º (desaparece)");
});

const payment = { paymentStatus: "verde", hasOverduePayment: false, overdueDebtLabel: null, lastPaymentAt: null } as unknown as StudentStatusProjection;
const badgeKinds = (dateJoined: string | null, now: Date) => studentBadges({ status: "activo", isFeatured: false, dateJoined, now, payment, hasPendingHomework: false }).map((badge) => badge.kind);

test("la insignia «Nuevo» de la lista y las tarjetas sale de la misma regla (y desaparece sin reservar lugar)", () => {
  const now = new Date("2026-10-29T15:00:00Z");
  assert.deepEqual(badgeKinds("2026-10-27", now), ["nuevo"]);
  assert.deepEqual(badgeKinds("2026-09-01", now), [], "alumno de hace dos meses: sin etiqueta y sin lista vacía");
  assert.deepEqual(badgeKinds(null, now), [], "sin fecha de alta");
  assert.deepEqual(badgeKinds("2026-11-02", now), [], "alta futura");
});

test("«Nuevo» no se confunde con el pago, la tarea ni el estado activo", () => {
  const now = new Date("2026-10-29T15:00:00Z");
  const kinds = studentBadges({ status: "activo", isFeatured: false, dateJoined: "2026-10-27", now, payment: { ...payment, hasOverduePayment: true, overdueDebtLabel: "Septiembre vencido" }, hasPendingHomework: true }).map((b) => b.kind);
  assert.deepEqual(kinds, ["nuevo", "pago_vencido", "tarea_pendiente"], "cada insignia con su propio motivo");
  const old = studentBadges({ status: "activo", isFeatured: false, dateJoined: "2026-01-05", now, payment: { ...payment, hasOverduePayment: true, overdueDebtLabel: "Septiembre vencido" }, hasPendingHomework: true }).map((b) => b.kind);
  assert.deepEqual(old, ["pago_vencido", "tarea_pendiente"], "un alumno activo antiguo con deuda y tarea no es «Nuevo»");
});

test("importar, editar, reactivar o registrar una clase NO reinicia el plazo: la regla sólo mira la fecha de alta, no la marca guardada ni las fechas de la fila", () => {
  const rule = source("lib/students/new-student.ts").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.doesNotMatch(rule, /createdAt|updatedAt|lastReactivatedAt|statusChangeDate|isNew\b|is_new|import_|imported/, "ninguna fecha de importación, actualización, reactivación ni la marca guardada");
  // Cada lugar que muestra o proyecta «Nuevo» usa la regla única; nadie lee la marca guardada.
  const parts = source("components/students/student-list-parts.tsx");
  assert.match(parts, /dateJoined: row\.student\.dateJoined/);
  assert.doesNotMatch(parts, /student\.isNew/);
  const presentation = source("lib/students/list-presentation.ts");
  assert.match(presentation, /isNewStudent\(input\.dateJoined, input\.now\)/);
  assert.doesNotMatch(presentation, /input\.isNew|\.isNew\b/);
  assert.match(source("lib/students/list-status.ts"), /isNew: isNewStudentOn\(student\.dateJoined, input\.todayDateKey\)/);
  for (const file of ["components/students/student-card.tsx", "components/students/student-list-parts.tsx", "components/students/profile/profile-header.tsx", "components/students/profile/student-profile-view.tsx"]) {
    assert.doesNotMatch(source(file), /\.isNew\b/, `${file} no lee la marca guardada`);
  }
});
