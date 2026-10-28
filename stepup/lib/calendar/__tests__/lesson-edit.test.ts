import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyDurationToWeeks, computeEndFromDuration, DURATION_OPTIONS_MINUTES, isValidDurationOption, lessonDurationMinutes, normalizeClassTitle, sessionSlotForInstant, validateClassTitleInput } from "../lesson-edit.ts";

const TZ = "America/Argentina/Buenos_Aires";

test("nombre de la clase: se recorta, vacío vuelve al automático y no pasa de 60 caracteres", () => {
  assert.equal(normalizeClassTitle("  Conversación B2  "), "Conversación B2");
  assert.equal(normalizeClassTitle("   "), null);
  assert.deepEqual(validateClassTitleInput("x".repeat(60)), { valid: true });
  const tooLong = validateClassTitleInput("x".repeat(61));
  assert.equal(tooLong.valid, false);
  assert.match(tooLong.valid === false ? tooLong.error : "", /60 caracteres/);
  assert.deepEqual(validateClassTitleInput("   "), { valid: true });
});

test("duración: opciones del original, fin calculado y minutos de una clase", () => {
  assert.deepEqual([...DURATION_OPTIONS_MINUTES], [30, 45, 60, 75, 90, 120]);
  assert.equal(isValidDurationOption(45), true);
  assert.equal(isValidDurationOption(50), false);
  assert.equal(computeEndFromDuration("2026-11-06T23:00:00.000Z", 90), "2026-11-07T00:30:00.000Z");
  assert.throws(() => computeEndFromDuration("2026-11-06T23:00:00.000Z", 0), /mayor a cero/);
  assert.throws(() => computeEndFromDuration("no-es-fecha", 60), /inicio/);
  assert.equal(lessonDurationMinutes("2026-11-06T23:00:00.000Z", "2026-11-07T00:15:00.000Z"), 75);
});

test("la sesión de una clase se identifica por día de la semana y hora civil de la serie (lunes = 0)", () => {
  // Viernes 06/11/2026 20:00 en Buenos Aires = 23:00Z.
  assert.deepEqual(sessionSlotForInstant("2026-11-06T23:00:00.000Z", TZ), { weekday: 4, hour: 20, minute: 0 });
  // Domingo 08/11/2026 10:30 en Buenos Aires.
  assert.deepEqual(sessionSlotForInstant("2026-11-08T13:30:00.000Z", TZ), { weekday: 6, hour: 10, minute: 30 });
  // 23:30 locales del lunes 02/11 ya son el martes en UTC: sigue siendo lunes para la serie.
  assert.deepEqual(sessionSlotForInstant("2026-11-03T02:30:00.000Z", TZ), { weekday: 0, hour: 23, minute: 30 });
});

test("«esta y las siguientes»: la duración nueva se aplica sólo a la sesión tocada y se avisa si ninguna coincide", () => {
  const weeks = [
    {
      weekIndex: 0,
      sessions: [
        { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
        { weekday: 3, hour: 18, minute: 0, durationMinutes: 60 },
      ],
    },
    { weekIndex: 1, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 45 }] },
  ];
  const changed = applyDurationToWeeks(weeks, { weekday: 3, hour: 18, minute: 0 }, 90);
  assert.equal(changed.matched, 1);
  assert.equal(changed.weeks[0].sessions[1].durationMinutes, 90);
  assert.equal(changed.weeks[0].sessions[0].durationMinutes, 60, "el otro día de la misma semana no cambia");
  assert.equal(changed.weeks[1].sessions[0].durationMinutes, 45, "ni las otras semanas del ciclo");
  assert.equal(weeks[0].sessions[1].durationMinutes, 60, "no muta el patrón original");
  assert.equal(applyDurationToWeeks(weeks, { weekday: 2, hour: 9, minute: 0 }, 90).matched, 0);
  const both = applyDurationToWeeks(weeks, { weekday: 0, hour: 18, minute: 0 }, 75);
  assert.equal(both.matched, 2, "la misma sesión repetida en varias semanas del ciclo se cambia en todas");
});

test("la migración de acciones de clase es de invocador, con search_path vacío y sin acceso anónimo", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261027100000_calendar_lesson_actions.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const fn of ["edit_calendar_lesson", "edit_recurrence_class_title", "restore_calendar_occurrence", "delete_cancelled_calendar_lesson"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(p_payload jsonb\\)[\\s\\S]*?security invoker\\s+set search_path = ''`), `${fn}: invocador y search_path vacío`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\(jsonb\\) from public, anon;`), `${fn}: sin acceso anónimo`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(jsonb\\) to authenticated;`), `${fn}: sólo autenticadas`);
  }
  assert.doesNotMatch(sql, /security definer/i);
});

test("cableado: el detalle de la clase ofrece nombre, duración, restaurar y eliminar, y cada paso corre en el servidor con guardNetwork y sin doble envío", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const modal = read("components/calendar/real-lesson-detail-modal.tsx");
  for (const label of ["Editar nombre de la clase", "Cambiar duración", "Restaurar esta clase", "Eliminar esta y las siguientes", "Eliminar clase cancelada"]) assert.match(modal, new RegExp(label), label);
  assert.match(modal, /if \(editMode\) return <LessonEditDialog/);
  const dialog = read("components/calendar/lesson-edit-dialog.tsx");
  for (const action of ["editLessonTitleAction", "changeLessonDurationAction", "restoreOccurrenceAction", "deleteCancelledLessonAction", "deleteSeriesFromOccurrenceAction"]) assert.match(dialog, new RegExp(String.raw`guardNetwork\(\(\) => ${action}\(`), action);
  assert.match(dialog, /if \(inFlight\.current \|\| pending\) return;/, "sin doble envío");
  assert.match(dialog, /onBeforeClose=\{\(\) => !pending\}/, "no se cierra durante un envío");
  assert.match(dialog, /¿Dónde querés aplicar el nuevo nombre\?/);
  assert.match(dialog, /¿Dónde querés aplicar la nueva duración\?/);
  assert.match(dialog, /Nunca se tocan las clases pasadas\./);
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /export async function editLessonTitleAction/);
  assert.match(actions, /export async function changeLessonDurationAction/);
  assert.match(actions, /formData\.set\("keepPattern", "true"\)/, "esta y las siguientes: el patrón y los alumnos son los del tramo vigente");
  assert.match(actions, /checkConflictsAndAvailability\(ctx, ref\.startAt, newEnd, ref\.viewItemId\)/, "la nueva duración se valida contra otras clases y bloqueos sin contar la propia clase");
  assert.match(actions, /const patternUnchanged = keepPattern && !durationPatch;/, "sólo un cambio de nombre omite el chequeo de choques");
  // Los nombres y niveles de los alumnos nunca se toman del navegador.
  assert.doesNotMatch(read("components/calendar/lesson-edit-dialog.tsx"), /studentName: item\.studentName|level: item\.level/);
});
