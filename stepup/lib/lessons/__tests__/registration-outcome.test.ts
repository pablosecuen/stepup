import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  absenceAttendanceStatus,
  lateCancellationSummary,
  outcomeClosesImmediately,
  outcomeLabel,
  outcomeNotice,
  outcomeOptions,
  validateOutcomeDraft,
  type OutcomeDraft,
} from "../registration-outcome.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");

const base: OutcomeDraft = { outcome: "clase_dictada", holidayException: false, lateCancellationPolicy: null, lateCancellationPercentage: null, alreadyRescheduled: false, isGroup: false };

test("las opciones del resultado, en el orden de la app: individual suma las dos ausencias del alumno; el grupo no", () => {
  const group = outcomeOptions(true).map((o) => o.label);
  assert.deepEqual(group, ["Realizada", "Profesora ausente", "Cancelada con aviso", "Cancelada tarde", "Reprogramada", "Feriado"]);
  const individual = outcomeOptions(false);
  assert.deepEqual(individual.map((o) => o.label), [...group, "Alumno ausente con aviso", "Alumno ausente sin aviso"]);
  assert.deepEqual(individual.slice(-2).map((o) => [o.outcome, o.absenceNotice]), [["alumno_ausente", "aviso"], ["alumno_ausente", "sin_aviso"]]);
  assert.equal(new Set(individual.map((o) => o.key)).size, individual.length, "cada opción tiene su propia clave");
});

test("la asistencia que queda cuando el alumno no vino, y el texto del resultado", () => {
  assert.equal(absenceAttendanceStatus("aviso"), "ausente_aviso");
  assert.equal(absenceAttendanceStatus("sin_aviso"), "ausente");
  assert.equal(outcomeLabel({ outcome: "alumno_ausente", absenceNotice: "aviso" }), "Alumno ausente con aviso");
  assert.equal(outcomeLabel({ outcome: "alumno_ausente", absenceNotice: "sin_aviso" }), "Alumno ausente sin aviso");
  assert.equal(outcomeLabel({ outcome: "clase_dictada" }), "Realizada");
  assert.equal(outcomeLabel({ outcome: "cancelada_tarde" }), "Cancelada tarde");
});

test("los avisos del resultado son los de la app", () => {
  assert.equal(outcomeNotice({ outcome: "alumno_ausente", absenceNotice: "aviso" }), "El alumno avisó que no venía — no genera cobro automático.");
  assert.equal(outcomeNotice({ outcome: "alumno_ausente", absenceNotice: "sin_aviso" }), "El alumno faltó sin avisar — no genera cobro automático.");
  assert.equal(outcomeNotice({ outcome: "cancelada_con_aviso" }), "Cancelada con aviso: no genera cobro.");
  assert.equal(outcomeNotice({ outcome: "feriado" }), "Suspendida por feriado — no suma asistencia, horas, cobro ni promedio.");
  assert.equal(outcomeNotice({ outcome: "clase_dictada" }), null);
});

test("sólo «Realizada» y el feriado con excepción dejan el formulario abierto; el resto cierra el registro", () => {
  assert.equal(outcomeClosesImmediately("clase_dictada", false), false);
  assert.equal(outcomeClosesImmediately("feriado", true), false);
  for (const outcome of ["profesora_ausente", "cancelada_con_aviso", "cancelada_tarde", "reprogramada", "alumno_ausente"] as const) assert.equal(outcomeClosesImmediately(outcome, false), true, outcome);
  assert.equal(outcomeClosesImmediately("feriado", false), true);
});

test("validación: ausencia sólo individual y con aviso elegido; cancelada tarde con política; reprogramada sólo con nueva fecha", () => {
  assert.deepEqual(validateOutcomeDraft(base), []);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "alumno_ausente", absenceNotice: "aviso" }), []);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "alumno_ausente" }), ["Elegí si el alumno avisó o no."]);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "alumno_ausente", absenceNotice: "aviso", isGroup: true }), ["«Alumno ausente» sólo se puede elegir en una clase individual."]);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "cancelada_tarde" }), ["Elegí la política de cancelación tardía."]);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "cancelada_tarde", lateCancellationPolicy: "no_cobrar" }), []);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "cancelada_tarde", lateCancellationPolicy: "cobrar_porcentaje" }), ["Indicá el porcentaje a cobrar (de 0 a 100)."]);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "cancelada_tarde", lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 120 }), ["Indicá el porcentaje a cobrar (de 0 a 100)."]);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "cancelada_tarde", lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 50 }), []);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "reprogramada" }), ["Esta clase todavía no tiene una nueva fecha: elegila primero."]);
  assert.deepEqual(validateOutcomeDraft({ ...base, outcome: "reprogramada", alreadyRescheduled: true }), []);
  assert.equal(lateCancellationSummary("cobrar_porcentaje", 30), "Cobrar un porcentaje (30%)");
  assert.equal(lateCancellationSummary(null, null), "Sin política elegida");
});

test("el cobro de una clase con alumno ausente es cero (no se dictó), igual que en la app", async () => {
  const { computePerClassBilledAmount } = await import("../../payments/adhoc-billing.ts");
  const none = { lateCancellationPolicy: null, lateCancellationPercentage: null };
  assert.equal(computePerClassBilledAmount({ perClassAmount: 10000, outcome: "alumno_ausente", isClassHeld: false, ...none }), 0);
  assert.equal(computePerClassBilledAmount({ perClassAmount: 10000, outcome: "clase_dictada", isClassHeld: true, ...none }), 10000);
  assert.equal(computePerClassBilledAmount({ perClassAmount: 10000, outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 50 }), 5000);
});

test("el formulario de registro siempre ofrece cambiar el resultado mientras el registro está en curso, y la acción cubre todos los pasos", () => {
  const workspace = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.match(workspace, /outcomeField && !isFinalized && \(\s*<RegistrationOutcomeField/);
  const action = read("lib/actions/lesson-registrations.ts");
  const body = action.slice(action.indexOf("export async function changeRegistrationOutcomeAction"));
  const at = (needle: string) => {
    const index = body.indexOf(needle);
    assert.ok(index >= 0, `falta: ${needle}`);
    return index;
  };
  // Orden: cambia el resultado → asistencia del alumno ausente → observación → finaliza → cobro → libera el horario si fue cancelada con aviso.
  const order = ["changeLessonRegistrationOutcome(ctx", "absenceAttendanceStatus(input.absenceNotice)", "saveLessonContentDraft(ctx", "finalizeLessonRegistration(ctx", "syncPerClassChargesForRegistration(ctx", "cancelCalendarOccurrence(ctx"].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Un registro ya finalizado nunca cambia de resultado por este camino.
  assert.match(body, /status === "completed"\) return \{ error:/);
  // «Reprogramada» sólo se guarda cuando la clase ya tiene nueva fecha.
  assert.match(body, /alreadyRescheduled: calendarLesson\?\.status === "rescheduled"/);
});
