import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_NAME_MIN_WIDTH_PX, INITIALS_MAX_WIDTH_PX, compactStateTag, firstWord, initials, nameForWidth, narrowMeta, wideMeta, type CardStateFacts } from "../card-text.ts";

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
