import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canExtendLesson, describeExtension, evaluateExtension, extendOptions, EXTEND_INCREMENTS_MINUTES, MAX_LESSON_DURATION_MINUTES, WORKDAY_END_MINUTES } from "../extend-duration.ts";

// Buenos Aires = UTC−3 todo el año: 13:00 hora de la cuenta = 16:00Z.
const at = (hhmm: string, day = "2026-12-03") => {
  const [hour, minute] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour + 3, minute)).toISOString();
};
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("incrementos rápidos: +15, +30, +45 y +60; ejemplo 13:00–14:00 → +15 → 13:00–14:15, 75 minutos", () => {
  assert.deepEqual([...EXTEND_INCREMENTS_MINUTES], [15, 30, 45, 60]);
  const options = extendOptions(at("13:00"), at("14:00"));
  assert.deepEqual(options.map((option) => option.minutes), [15, 30, 45, 60]);
  assert.ok(options.every((option) => option.disabledReason === null), "una clase de 60 min admite las cuatro (+60 llega justo a 120)");
  assert.deepEqual(describeExtension(at("13:00"), options[0].newEnd), { range: "13:00–14:15", duration: "75 min" });
  assert.equal(options[0].newDuration, 75);
  assert.equal(options[1].newDuration, 90);
  assert.equal(options[2].newDuration, 105);
  assert.equal(options[3].newDuration, 120);
});

test("+45 usa la misma validación: una clase de 75 min llega a 120 con +45 y +60 queda deshabilitada (daría 135); una de 90 admite hasta +30", () => {
  const of75 = extendOptions(at("13:00"), at("14:15"));
  assert.deepEqual(of75.map((option) => option.disabledReason), [null, null, null, "Máximo 120 min por clase."]);
  assert.equal(of75[2].newDuration, 120);
  assert.equal(of75[3].newDuration, 135);
  const ok = evaluateExtension(at("13:00"), at("14:15"), 45);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual({ end: ok.newEnd, duration: ok.newDuration }, { end: at("15:00"), duration: 120 });
  assert.equal(evaluateExtension(at("13:00"), at("14:15"), 60).ok, false, "el servidor rechaza lo mismo que la pantalla deshabilita");
  const of90 = extendOptions(at("13:00"), at("14:30"));
  assert.deepEqual(of90.map((option) => option.disabledReason), [null, null, "Máximo 120 min por clase.", "Máximo 120 min por clase."]);
  // La jornada también aplica a +45: 21:30 + 45 = 22:15.
  const tarde = extendOptions(at("20:30"), at("21:30"));
  assert.deepEqual(tarde.map((option) => option.disabledReason), [null, null, "Terminaría después de las 22:00.", "Terminaría después de las 22:00."]);
});

test("evaluateExtension calcula el fin nuevo y la duración total; sólo acepta +15, +30, +45 o +60", () => {
  const ok = evaluateExtension(at("13:00"), at("14:00"), 15);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual({ end: ok.newEnd, duration: ok.newDuration }, { end: at("14:15"), duration: 75 });
  for (const invalid of [0, 10, 20, 75, 90, 120, -15, Number.NaN]) assert.equal(evaluateExtension(at("13:00"), at("14:00"), invalid).ok, false, String(invalid));
});

test("el máximo de duración existente no se amplía en silencio: la opción que lo supera se deshabilita con su motivo", () => {
  assert.equal(MAX_LESSON_DURATION_MINUTES, 120, "el máximo es el de la lista de duraciones de la clase");
  const options = extendOptions(at("13:00"), at("14:30")); // 90 min
  assert.deepEqual(options.map((option) => option.disabledReason), [null, null, "Máximo 120 min por clase.", "Máximo 120 min por clase."]);
  const full = extendOptions(at("13:00"), at("15:00")); // ya en el máximo
  assert.ok(full.every((option) => option.disabledReason === "Máximo 120 min por clase."));
  const result = evaluateExtension(at("13:00"), at("14:30"), 60);
  assert.equal(result.ok, false);
});

test("la jornada del calendario (hasta las 22:00) tampoco se amplía: terminar justo a las 22:00 sí, pasarse no", () => {
  assert.equal(WORKDAY_END_MINUTES, 22 * 60);
  const tarde = extendOptions(at("20:30"), at("21:30"));
  assert.deepEqual(tarde.map((option) => option.disabledReason), [null, null, "Terminaría después de las 22:00.", "Terminaría después de las 22:00."], "21:30 + 30 = 22:00 exacto está dentro");
  const casi = extendOptions(at("21:00"), at("21:50"));
  assert.ok(casi.every((option) => option.disabledReason === "Terminaría después de las 22:00."));
  const alMediodia = extendOptions(at("11:00"), at("12:00"));
  assert.ok(alMediodia.every((option) => option.disabledReason === null));
  // Una clase que cruza la medianoche civil (la hora se lee en la zona de la cuenta, nunca en UTC) tampoco se extiende.
  const noche = extendOptions(at("23:00"), at("23:50"));
  assert.ok(noche.every((option) => option.disabledReason !== null));
});

test("la acción se ofrece sólo para una clase vigente: no cancelada, no reemplazada, no el origen liberado de una reprogramación, no registrada", () => {
  assert.equal(canExtendLesson({ status: "scheduled" }), true);
  assert.equal(canExtendLesson({ status: "rescheduled" }), true, "una clase reprogramada (su destino) sí");
  assert.equal(canExtendLesson({ status: "rescheduled", occupiesSlot: false }), false, "el origen liberado no");
  assert.equal(canExtendLesson({ status: "cancelled" }), false);
  assert.equal(canExtendLesson({ status: "completed" }), false);
  assert.equal(canExtendLesson({ status: "scheduled", hiddenByReplacement: true }), false, "reemplazada");
});

test("cableado: botón visible junto a Reprogramar y Administrar miembros (no escondido en «Más opciones»), sin «Guardar igual»", () => {
  const modal = read("components/calendar/real-lesson-detail-modal.tsx");
  const reschedule = modal.indexOf("Reprogramar<span");
  const extend = modal.indexOf("Extender duración\n");
  const members = modal.indexOf("Administrar miembros\n");
  const more = modal.indexOf("<details");
  assert.ok(reschedule > 0 && extend > reschedule && members > extend && more > members, "orden: Reprogramar, Extender duración, Administrar miembros y recién después «Más opciones»");
  assert.match(modal, /canExtend = canEdit && canExtendLesson\(item\)/);
  assert.match(modal, /<ExtendDurationPanel/);

  const panel = read("components/calendar/extend-duration-panel.tsx");
  assert.match(panel, /useState<ExtendIncrement \| null>\(null\)/, "ninguna opción seleccionada automáticamente");
  assert.match(panel, /if \(!chosen \|\| inFlight\.current \|\| pending\) return;/, "sin doble envío");
  assert.match(panel, /guardNetwork\(\(\) =>\s*extendLessonDurationAction/);
  assert.doesNotMatch(panel, /Guardar igual|allowOverlap|Agendar igualmente/, "ante un choque no se ofrece guardar igual");
  assert.match(panel, /setError\(\{ message: response\.error/, "ante un error la selección se conserva (no se reinicia)");
  assert.match(panel, /router\.refresh\(\)/, "la tarjeta y el detalle se actualizan sin salir del Calendario");
  assert.match(panel, /onExtended\?\.\(savedEnd\)/, "el detalle completo recibe el fin nuevo al instante");
  assert.match(modal, /onExtended=\{setExtendedEnd\}/);
  assert.match(modal, /\{ \.\.\.shownItem, end: extendedEnd \}/, "chips, horario y duración salen del fin guardado");
  assert.match(modal, /<MetaChip>\{timeLabel\}–\{instantTimeLabel\(item\.end\)\}<\/MetaChip>/, "el chip de horario muestra inicio y fin");
  assert.match(panel, /Actualizar el calendario/, "cambio desde otro dispositivo: se pide actualizar");
});

test("cableado de servidor: identidad de la clase, agenda operativa compartida, disponibilidad y RPC atómico", () => {
  const action = read("lib/actions/lesson-duration.ts");
  assert.match(action, /^"use server";/);
  assert.match(action, /rpc\("calendar_agenda_stamp"\)/);
  assert.match(action, /toConflictCandidates\(items\)/, "agenda operativa: una cancelada, reemplazada u origen liberado no bloquea");
  assert.match(action, /findCalendarConflicts\(item\.start, requested\.newEnd, toConflictCandidates\(items\), item\.id\)/, "la propia clase se excluye por su identidad");
  assert.match(action, /evaluateAvailability\(item\.start, requested\.newEnd, availability\)/, "intervalo final completo contra bloqueos, vacaciones y feriados");
  assert.match(action, /rpc\("extend_calendar_lesson_duration"/);
  for (const code of ["TF001", "TF002", "TF003"]) assert.match(action, new RegExp(code), code);
  assert.doesNotMatch(action, /allowOverlap|allowBlocked/, "nunca «guardar igual»");
  assert.doesNotMatch(action, /payment_|billing|from\("(payments?|students|student_plans)"\)|rpc\("(register|apply)_/i, "no cambia tarifas ni genera cobros");
  assert.match(action, /candidate\.recurrenceId === input\.recurrenceId && candidate\.occurrenceKey === input\.occurrenceKey/, "una ocurrencia ya materializada se encuentra por serie y clave (reintento)");
  const migration = read("supabase/migrations/20261118200000_extend_duration_and_series_end.sql");
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_owner::text, 31100000\)\)/, "mismo lock por cuenta que reprogramar");
  assert.match(migration, /calendar_lesson_occupies_slot\(c\)/);
  assert.match(migration, /c\.start_at < v_new_end and c\.end_at > v_lesson\.start_at/, "terminar justo cuando empieza otra no invade");
  const creation = read("lib/actions/calendar.ts");
  assert.match(creation, /guardOverlap: readString\(formData, "allowOverlap"\) !== "true"/, "una clase nueva simultánea también se valida dentro de la transacción");
});
