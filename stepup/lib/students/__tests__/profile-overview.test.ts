import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { formatHours } from "../../format/number-format.ts";
import {
  buildProfileClassStats,
  monthlyDueDayOf,
  pickStudentNextClass,
  resolveProfileAudience,
  skillAveragesFromEvaluations,
  totalCollectedForStudent,
  type AttendanceKind,
  type HeldRegistration,
  type NextClassCandidate,
} from "../profile-overview.ts";

/** B6 — perfil del alumno con datos reales: definiciones, estados vacíos y diferencias entre alumnos. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let seq = 0;
function held(overrides: Partial<Omit<HeldRegistration, "attendance">> & { attendance?: AttendanceKind | null; grade?: number | null; minutes?: number | null } = {}): HeldRegistration {
  const { attendance = "presente", grade = null, minutes = 60, ...rest } = overrides;
  seq += 1;
  const start = new Date(Date.UTC(2026, 0, 1, 21) + seq * 86_400_000).toISOString();
  const end = minutes === null ? null : new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  return {
    registrationId: `r${seq}`,
    anchorAt: start,
    dateKey: start.slice(0, 10),
    scheduledStartAt: minutes === null ? null : start,
    scheduledEndAt: end,
    actualStartedAt: null,
    actualEndedAt: null,
    homeworkDescription: null,
    attendance: attendance === null ? null : { status: attendance, lateMinutes: null },
    evaluation: grade === null ? null : { generalGrade: grade, skillGrades: {}, strengths: [], areasToImprove: [], individualHomeworkDescription: null },
    ...rest,
  };
}

test("sin clases dictadas: todo vacío, nunca ceros inventados ni porcentajes", () => {
  const stats = buildProfileClassStats([]);
  assert.equal(stats.classesHeld, 0);
  assert.equal(stats.attendanceRatePercent, null);
  assert.equal(stats.hours, null);
  assert.equal(stats.averageGrade, null);
  assert.equal(stats.lastAttended, null);
});

test("asistencia: sólo presente/tarde cuentan como clase tomada; ausentes y «sin registrar» quedan aparte", () => {
  const stats = buildProfileClassStats([
    held({ attendance: "presente" }),
    held({ attendance: "tarde" }),
    held({ attendance: "ausente" }),
    held({ attendance: "ausente_aviso" }),
    held({ attendance: "sin_registrar" }),
    held({ attendance: null }),
  ]);
  assert.equal(stats.classesHeld, 6);
  assert.equal(stats.attended, 2);
  assert.equal(stats.absent, 2);
  assert.equal(stats.unresolved, 2);
  assert.equal(stats.attendanceBasis, 4);
  assert.equal(stats.attendanceRatePercent, 50);
});

test("asistencia: sin ninguna resuelta no hay porcentaje (no se asume 0% ni 100%)", () => {
  const stats = buildProfileClassStats([held({ attendance: "sin_registrar" }), held({ attendance: null })]);
  assert.equal(stats.attendanceRatePercent, null);
  assert.equal(stats.unresolved, 2);
  assert.equal(stats.lastAttended, null);
});

test("horas: sólo clases a las que asistió; real si hay inicio y fin reales, si no la programada; sin horario no suma y se informa", () => {
  const stats = buildProfileClassStats([
    held({ attendance: "presente", minutes: 60 }),
    held({ attendance: "tarde", minutes: 90 }),
    held({ attendance: "ausente", minutes: 60 }),
    held({ attendance: "presente", minutes: null }),
    held({
      attendance: "presente",
      scheduledStartAt: "2026-09-20T21:00:00.000Z",
      scheduledEndAt: "2026-09-20T22:00:00.000Z",
      actualStartedAt: "2026-09-20T21:00:00.000Z",
      actualEndedAt: "2026-09-20T21:30:00.000Z",
    }),
  ]);
  // 60 + 90 + 30 (real, no la programada de 60) = 180 min; la ausente no suma; la sin horario no suma.
  assert.equal(stats.hours, 3);
  assert.equal(stats.attendedWithoutDuration, 1);
  assert.equal(formatHours(stats.hours!), "3 h");
  assert.equal(formatHours(1.5), "1,5 h");
});

test("horas: si ninguna clase a la que asistió tiene horario, no hay cifra (null)", () => {
  const stats = buildProfileClassStats([held({ minutes: null }), held({ minutes: null })]);
  assert.equal(stats.hours, null);
  assert.equal(stats.attendedWithoutDuration, 2);
});

test("promedio: sólo notas reales (0 y vacío no cuentan) y coincide con el de Progreso", () => {
  const stats = buildProfileClassStats([held({ grade: 8 }), held({ grade: 9 }), held({ grade: null }), held({ grade: 0 })]);
  assert.equal(stats.averageGrade, 8.5);
  assert.equal(buildProfileClassStats([held({ grade: null })]).averageGrade, null);
});

test("última clase: la más reciente a la que asistió; una ausencia posterior no la reemplaza", () => {
  const a = held({ attendance: "presente" });
  const b = held({ attendance: "tarde" });
  const c = held({ attendance: "ausente" });
  const stats = buildProfileClassStats([c, a, b]);
  assert.equal(stats.lastAttended?.anchorAt, b.anchorAt);
  assert.equal(stats.lastAttended?.attendance, "tarde");
});

test("total cobrado: pagos y obligaciones vigentes; nunca lo anulado ni lo pendiente", () => {
  const total = totalCollectedForStudent({
    charges: [
      { id: "c1", voidedAt: null },
      { id: "c2", voidedAt: null },
      { id: "c3", voidedAt: "2026-09-01T00:00:00Z" },
    ],
    payments: [
      { id: "p1", voidedAt: null },
      { id: "p2", voidedAt: "2026-09-02T00:00:00Z" },
    ],
    allocations: [
      { chargeId: "c1", paymentId: "p1", amount: 10000 },
      { chargeId: "c2", paymentId: "p1", amount: 5000 },
      { chargeId: "c1", paymentId: "p2", amount: 7000 }, // pago anulado
      { chargeId: "c3", paymentId: "p1", amount: 3000 }, // cargo anulado
      { chargeId: "zz", paymentId: "p1", amount: 999 }, // cargo desconocido
    ],
  });
  assert.equal(total, 15000);
  assert.equal(totalCollectedForStudent({ charges: [], payments: [], allocations: [] }), 0);
});

const NOW = new Date("2026-10-05T20:00:00.000Z");
function lesson(id: string, startOffsetMin: number, durationMin: number, overrides: Partial<NextClassCandidate> = {}): NextClassCandidate {
  const start = new Date(NOW.getTime() + startOffsetMin * 60_000);
  return { id, participantIds: ["s1"], start: start.toISOString(), end: new Date(start.getTime() + durationMin * 60_000).toISOString(), status: "scheduled", title: null, modality: "online", ...overrides };
}

test("próxima clase: sólo alumnos activos; pausado/inactivo/archivado → «no aplica»", () => {
  for (const status of ["pausado", "inactivo", "archivado"] as const) {
    assert.deepEqual(pickStudentNextClass({ items: [lesson("a", 60, 60)], studentId: "s1", status, now: NOW }), { kind: "not-applicable" });
  }
});

test("próxima clase: la más cercana de ESTE alumno; ignora canceladas, pasadas y las de otros", () => {
  const items = [
    lesson("otro", 30, 60, { participantIds: ["s2"] }),
    lesson("cancelada", 45, 60, { status: "cancelled" }),
    lesson("pasada", -300, 60),
    lesson("tarde", 600, 60),
    lesson("proxima", 120, 60),
  ];
  const result = pickStudentNextClass({ items, studentId: "s1", status: "activo", now: NOW });
  assert.equal(result.kind, "found");
  if (result.kind === "found") {
    assert.equal(result.timing, "upcoming");
    assert.equal(result.start, items[4].start);
  }
});

test("próxima clase: una en curso gana a una futura; sin ninguna → «none»", () => {
  const items = [lesson("futura", 30, 60), lesson("enCurso", -10, 60)];
  const result = pickStudentNextClass({ items, studentId: "s1", status: "activo", now: NOW });
  assert.equal(result.kind === "found" && result.timing, "in_progress");
  assert.deepEqual(pickStudentNextClass({ items: [], studentId: "s1", status: "activo", now: NOW }), { kind: "none" });
  assert.deepEqual(pickStudentNextClass({ items: [lesson("x", 30, 60, { participantIds: ["s9"] })], studentId: "s1", status: "activo", now: NOW }), { kind: "none" });
});

test("tipo de perfil: archivado, pausado/inactivo, activo sin clases y activo con actividad", () => {
  assert.equal(resolveProfileAudience({ status: "activo", classesHeld: 5 }), "with-activity");
  assert.equal(resolveProfileAudience({ status: "activo", classesHeld: 0 }), "no-activity");
  assert.equal(resolveProfileAudience({ status: "pausado", classesHeld: 5 }), "inactive");
  assert.equal(resolveProfileAudience({ status: "inactivo", classesHeld: 0 }), "inactive");
  assert.equal(resolveProfileAudience({ status: "archivado", classesHeld: 9 }), "archived");
  assert.equal(resolveProfileAudience({ status: "archivado", classesHeld: 0 }), "archived");
});

test("vencimiento mensual: sólo plan mensual con día entero 1-31", () => {
  assert.equal(monthlyDueDayOf({ type: "monthly", amount: 1000, dueDay: 10 }), 10);
  assert.equal(monthlyDueDayOf({ type: "monthly", amount: 1000, dueDay: 31 }), 31);
  assert.equal(monthlyDueDayOf({ type: "monthly", amount: 1000, dueDay: 0 }), null);
  assert.equal(monthlyDueDayOf({ type: "monthly", amount: 1000, dueDay: 32 }), null);
  assert.equal(monthlyDueDayOf({ type: "monthly", amount: 1000, dueDay: 5.5 }), null);
  assert.equal(monthlyDueDayOf({ type: "monthly", amount: 1000 }), null);
  assert.equal(monthlyDueDayOf({ type: "per_class", amount: 1000, dueDay: 10 }), null);
  assert.equal(monthlyDueDayOf(null), null);
});

test("promedio por habilidad: sólo habilidades con nota real; sin notas, lista vacía", () => {
  const result = skillAveragesFromEvaluations([{ skillGrades: { speaking: 8, grammar: 6 } }, { skillGrades: { speaking: 10, grammar: 0, reading: 7 } }, { skillGrades: {} }]);
  assert.deepEqual(
    result.map((r) => [r.skill, r.averageGrade, r.gradedClasses]),
    [["speaking", 9, 2], ["reading", 7, 1], ["grammar", 6, 1]],
    "el orden es el de SKILLS y un 0 no cuenta",
  );
  assert.deepEqual(skillAveragesFromEvaluations([]), []);
  assert.deepEqual(skillAveragesFromEvaluations([{ skillGrades: { speaking: 0 } }]), []);
});

test("cableado: cada pestaña carga sólo lo suyo y el Resumen/Información NUNCA escriben", () => {
  const page = code("app/(app)/alumnos/[id]/page.tsx");
  assert.match(page, /tab === "resumen"\) \{[\s\S]*?loadProfileClassStats\(ctx, id\),\s*loadStudentNextClass\(ctx, student\),\s*listPendingHomeworkTasksForStudent\(ctx, id\)/);
  assert.match(page, /tab === "informacion"\) \{[\s\S]*?loadProfileClassStats\(ctx, id\),\s*loadStudentTotalCollected\(ctx, id\)/);
  assert.match(page, /tab === "clases"\) \{[\s\S]*?listCompletedRegistrationsForStudentReport\(ctx, id\)/);
  assert.match(page, /<ResumenTabContent student=\{student\} stats=\{stats\} nextClass=\{nextClass\} pendingTasks=\{pendingTasks\} \/>/);
  // La generación idempotente de cobros sigue sólo en la pestaña Cobros.
  const ensureCalls = [...page.matchAll(/ensureCurrentMonthlyCharges\(/g)].length;
  assert.equal(ensureCalls, 1);
  assert.match(page, /tab === "cobros"\) \{[\s\S]*?ensureCurrentMonthlyCharges/);

  const loader = code("lib/students/load-profile-overview.ts");
  assert.doesNotMatch(loader, /ensureCurrentMonthlyCharges|ensureTrainingCharges|registerPayment|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(code("lib/students/profile-overview.ts"), /supabase|fetch\(|\.rpc\(/);
  assert.match(loader, /if \(student\.status !== "activo"\) return \{ kind: "not-applicable" \}/, "no consulta el calendario para alumnos no activos");
});

test("Resumen: no usa la columna `pending_homework` (la web nunca la actualiza), ni relleno, ni textos de fases", () => {
  const resumen = code("components/students/profile/resumen-tab.tsx");
  assert.doesNotMatch(resumen, /student\.pendingHomework/, "la tarea pendiente sale de los registros, igual que la pestaña Tareas");
  assert.doesNotMatch(resumen, /Todavía no hay objetivos, fortalezas ni observaciones/, "ese relleno sin salida ya no está");
  assert.doesNotMatch(resumen, /Fase \d|todavía no disponible|Depende de/i);
  assert.match(resumen, /pendingTasks\.slice\(0, MAX_VISIBLE_TASKS\)/);
  assert.match(resumen, /stats\.classesHeld === 0 \? \(\s*<EmptyState/, "sin clases: estado vacío en vez de ceros");
  assert.match(resumen, /action=\{student\.status === "activo" \? \{ label: "Ir a Registro", href: "\/registro" \} : undefined\}/, "un alumno no activo no recibe acción de registrar");
  assert.match(resumen, /\{stats\.attendanceRatePercent !== null && \(/, "asistencia sólo con dato");
  assert.match(resumen, /\{stats\.hours !== null && /, "horas sólo con dato");
  assert.match(resumen, /\{stats\.averageGrade !== null && /, "promedio sólo con dato");
  assert.match(resumen, /audience === "archived"/);
  assert.match(resumen, /audience === "inactive"/);
});

test("Información: actividad real (clases, horas, total cobrado) y fecha de cambio de estado sólo si el alumno NO está activo", () => {
  const info = code("components/students/profile/informacion-tab.tsx");
  assert.match(info, /<h2[^>]*>Actividad<\/h2>/);
  assert.match(info, /label="Clases dictadas"/);
  assert.match(info, /\{stats\.hours !== null && <Row label="Horas de clase"/);
  assert.match(info, /label="Total cobrado"/);
  assert.doesNotMatch(info, /Total invertido|Horas totales|Cantidad (total )?de clases/, "los nombres del móvil ambiguos no vuelven");
  assert.match(info, /statusChangeLabel && student\.statusChangeDate/);
  assert.doesNotMatch(info, /Fecha de pausa\/archivo/);
  assert.match(info, /monthlyDueDay !== null && <Row label="Vencimiento mensual"/);
});

test("Clases, Progreso y Tareas muestran datos reales antes ocultos: día del registro libre, horario, asistencia, habilidades, fecha de asignación", () => {
  const clases = code("components/students/profile/clases-tab.tsx");
  assert.match(clases, /registration\.scheduledStartAt \?\? registration\.actualStartedAt \?\? registration\.createdAt/, "un registro sin reserva ya no dice «Sin fecha»");
  assert.match(clases, /Asistencia: \$\{ATTENDANCE_STATUS_LABEL\[attendance\]\}/);
  const progreso = code("components/students/profile/progreso-tab.tsx");
  assert.match(progreso, /skillAveragesFromEvaluations\(entries\.map/);
  assert.match(progreso, /scheduledStartAt \?\? entry\.registration\.actualStartedAt \?\? entry\.registration\.createdAt/);
  assert.match(code("components/students/profile/tareas-tab.tsx"), /Asignada el \{formatInstantDate\(task\.assignedAt\)\}/);
});

test("alcance: B6 no toca autenticación, B0, Inicio ni migraciones", () => {
  const inicio = code("app/(app)/inicio/page.tsx");
  assert.match(inicio, /redirect\(SESSION_RECOVERY_PATH\)/);
  assert.doesNotMatch(code("components/students/profile/resumen-tab.tsx") + code("components/students/profile/informacion-tab.tsx"), /supabase|signOut|redirect\(/i);
});
