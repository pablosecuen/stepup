import { test } from "node:test";
import assert from "node:assert/strict";
import { LANE_MAX_PX, LANE_MIN_PX, estimateBoldTextWidthPx, mobileLaneNeedPx, mobileNameFontPx, mobileNameWords, FULL_NAME_MIN_WIDTH_PX, INITIALS_MAX_WIDTH_PX, compactStateTag, firstWord, initials, nameForWidth, narrowMeta, wideMeta, type CardStateFacts } from "../card-text.ts";

const base: CardStateFacts = { status: "scheduled", isElapsed: false, isActiveReplacement: false, isInProgress: false };

test("primera palabra e iniciales: el nombre se reconoce aunque la tarjeta sea angosta", () => {
  assert.equal(firstWord("Agostina Staffieri"), "Agostina");
  assert.equal(firstWord("  Ana   Clara  "), "Ana");
  assert.equal(firstWord(""), "");
  assert.equal(initials("Juan Pablo Fernández Ruiz"), "JP");
  assert.equal(initials("agostina staffieri"), "AS");
  assert.equal(initials("Mariana"), "M");
  assert.equal(initials("Ángeles de la Torre"), "ÁD", "con tilde y mayúsculas");
  assert.equal(initials("12 Grupo"), "G", "ignora las palabras que no empiezan con letra");
});

test("el nombre se escribe según el ancho: completo, primera palabra o iniciales", () => {
  assert.equal(nameForWidth("Agostina Staffieri", FULL_NAME_MIN_WIDTH_PX), "Agostina Staffieri");
  assert.equal(nameForWidth("Agostina Staffieri", FULL_NAME_MIN_WIDTH_PX - 1), "Agostina");
  assert.equal(nameForWidth("Agostina Staffieri", INITIALS_MAX_WIDTH_PX), "Agostina");
  assert.equal(nameForWidth("Agostina Staffieri", INITIALS_MAX_WIDTH_PX - 1), "AS");
  assert.equal(nameForWidth("1 2", 10), "1", "si no hay letras, cae en la primera palabra");
});

test("estado en texto corto: los que cambian lo que hay que hacer se ven siempre; «En curso» y «Pasada» sólo donde hay lugar", () => {
  assert.equal(compactStateTag(base), null);
  assert.equal(compactStateTag({ ...base, status: "cancelled" }), "Cancel.");
  assert.equal(compactStateTag({ ...base, status: "rescheduled" }), "Reprog.");
  assert.equal(compactStateTag({ ...base, status: "completed" }), "Dictada");
  assert.equal(compactStateTag({ ...base, isActiveReplacement: true }), "Reemp.");
  assert.equal(compactStateTag({ ...base, isActiveReplacement: true, isElapsed: true }), "Pasada", "un reemplazo que ya pasó es una clase pasada");
  assert.equal(compactStateTag({ ...base, isInProgress: true }), "En curso");
  assert.equal(compactStateTag({ ...base, isElapsed: true }), "Pasada");
  // sólo prioritarios
  assert.equal(compactStateTag({ ...base, isElapsed: true }, true), null);
  assert.equal(compactStateTag({ ...base, isInProgress: true }, true), null);
  assert.equal(compactStateTag({ ...base, status: "cancelled" }, true), "Cancel.");
  assert.equal(compactStateTag({ ...base, status: "completed" }, true), null, "dictada: en una tarjeta angosta se muestra la hora");
  assert.equal(compactStateTag({ ...base, isActiveReplacement: true }, true), "Reemp.");
});

test("segunda línea: angosta = el estado importante o, si no, la hora (como «Cancel.» de la app); ancha = hora, quiénes y estados", () => {
  assert.equal(narrowMeta({ timeLabel: "10:00", facts: base }), "10:00");
  assert.equal(narrowMeta({ timeLabel: "10:00", facts: { ...base, isElapsed: true } }), "10:00", "pasada: la hora vale más en una tarjeta angosta");
  assert.equal(narrowMeta({ timeLabel: "10:00", facts: { ...base, status: "cancelled" } }), "Cancel.");
  assert.equal(narrowMeta({ timeLabel: "10:00", facts: { ...base, isActiveReplacement: true } }), "Reemp.");
  assert.equal(wideMeta({ timeLabel: "10:00", groupSize: null, tags: [] }), "10:00");
  assert.equal(wideMeta({ timeLabel: "10:30", groupSize: 4, tags: ["Pasada"] }), "10:30 · 4 alumnos · Pasada");
  assert.equal(wideMeta({ timeLabel: "09:00", groupSize: 1, tags: ["Entren."] }), "09:00 · Entren.", "un solo alumno no es un grupo");
});

test("semana en el teléfono: una línea lleva la primera palabra y desde 38 px de alto, las dos primeras (nunca iniciales ni palabras partidas)", () => {
  assert.deepEqual(mobileNameWords("Juan Pablo Fernández Ruiz", 25), ["Juan"]);
  assert.deepEqual(mobileNameWords("Juan Pablo Fernández Ruiz", 38), ["Juan", "Pablo"]);
  assert.deepEqual(mobileNameWords("Grupo B2 martes y jueves", 100), ["Grupo", "B2"]);
  assert.deepEqual(mobileNameWords("  Ana  ", 100), ["Ana"]);
  assert.deepEqual(mobileNameWords("", 100), []);
  assert.equal(mobileNameFontPx(["Ana"]), 10.5);
  assert.equal(mobileNameFontPx(["Guadalupe"]), 10.5, "la letra del nombre nunca baja de 10 px: se ensancha la columna");
});

test("ancho que necesita el carril: crece con la palabra más larga que se ve, con piso y techo, y es generoso (quedarse corto corta la palabra)", () => {
  assert.ok(estimateBoldTextWidthPx("Valentina", 9.5) > estimateBoldTextWidthPx("Ana", 9.5));
  assert.ok(estimateBoldTextWidthPx("MMM", 10) > estimateBoldTextWidthPx("iii", 10), "las anchas miden más que las angostas");
  assert.equal(mobileLaneNeedPx("Zoe", 25), LANE_MIN_PX, "un nombre corto no baja del piso");
  assert.ok(mobileLaneNeedPx("Valentina Acosta", 25) > mobileLaneNeedPx("Zoe", 25));
  assert.equal(mobileLaneNeedPx("Anticonstitucionalmente", 25), LANE_MAX_PX, "el techo evita ensanchar sin límite: el nombre se acorta con «…»");
  assert.ok(mobileLaneNeedPx("Ana Constantinopla", 60) > mobileLaneNeedPx("Ana Constantinopla", 25), "la segunda palabra sólo cuenta cuando se ve (tarjeta alta)");
  assert.equal(mobileLaneNeedPx("", 25), LANE_MIN_PX);
});
test("una clase cerrada sin dictar (cancelada tarde, ausencias, feriado) dice su resultado y nunca «Dictada»/«Completada»; los colores no cambian", async () => {
  assert.equal(compactStateTag({ ...base, status: "completed", closedOutcome: "cancelada_tarde" }), "Canc. tarde");
  assert.equal(compactStateTag({ ...base, status: "completed", closedOutcome: "profesora_ausente" }), "Prof. aus.");
  assert.equal(compactStateTag({ ...base, status: "completed", closedOutcome: "alumno_ausente" }), "Alumno aus.");
  assert.equal(compactStateTag({ ...base, status: "completed", closedOutcome: "feriado" }), "Feriado");
  assert.equal(compactStateTag({ ...base, status: "completed", closedOutcome: "cancelada_tarde" }, true), null, "en una tarjeta angosta sigue la hora");
  assert.equal(compactStateTag({ ...base, status: "completed", closedOutcome: null }), "Dictada", "una clase dictada sigue igual");
  const { lessonStatusLabel, resolveLessonColors } = await import("../../calendar-theme.ts");
  assert.equal(lessonStatusLabel({ status: "completed", closedOutcome: "cancelada_tarde" }), "Cancelada tarde");
  assert.equal(lessonStatusLabel({ status: "completed" }), "Completada");
  assert.equal(lessonStatusLabel({ status: "completed", closedOutcome: null }), "Completada");
  assert.equal(lessonStatusLabel({ status: "cancelled", closedOutcome: "cancelada_tarde" }), "Cancelada", "el rótulo sólo cambia en clases completadas");
  assert.equal(resolveLessonColors.length, 1, "los colores sólo dependen de estado, modalidad y reloj: el resultado no los cambia");
});
