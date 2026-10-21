import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ADHOC_OUTCOME_LABEL } from "../../lessons/adhoc.ts";
import { STATUS_LABELS } from "../../calendar-theme.ts";

/**
 * «Cancelada» y «Reprogramada» en el registro ad-hoc frente a Calendario y Registro programado (verificación de paridad,
 * 14/10/2026): una sola fuente de etiquetas, mismo texto base y ningún color propio. No toca estados de base ni reglas.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("el texto de «Cancelada» y «Reprogramada» del registro coincide con el de Calendario (las dos cancelaciones sólo agregan el motivo)", () => {
  assert.equal(ADHOC_OUTCOME_LABEL.reprogramada, STATUS_LABELS.rescheduled);
  assert.equal(ADHOC_OUTCOME_LABEL.cancelada_con_aviso.startsWith(STATUS_LABELS.cancelled), true);
  assert.equal(ADHOC_OUTCOME_LABEL.cancelada_tarde.startsWith(STATUS_LABELS.cancelled), true);
  assert.notEqual(ADHOC_OUTCOME_LABEL.cancelada_con_aviso, ADHOC_OUTCOME_LABEL.cancelada_tarde, "el motivo distingue las dos (aviso a tiempo o tarde)");
});

test("una sola fuente de etiquetas: el formulario ad-hoc, el registro no programado, el registro programado y el historial del alumno usan el mismo mapa", () => {
  for (const file of [
    "app/(app)/registro/nuevo/nuevo-registro-form.tsx",
    "app/(app)/registro/libre/[registrationId]/page.tsx",
    "app/(app)/registro/[calendarLessonId]/registration-workspace.tsx",
    "components/students/profile/clases-tab.tsx",
  ]) {
    const source = code(file);
    assert.match(source, /ADHOC_OUTCOME_LABEL/, file);
    assert.match(source, /from "@\/lib\/lessons\/adhoc"/, file);
    assert.doesNotMatch(source, /["'`]Cancelada (con aviso|tarde)["'`]|["'`]Reprogramada["'`]/, `${file}: sin una segunda copia del texto`);
  }
  const form = code("app/(app)/registro/nuevo/nuevo-registro-form.tsx");
  const offered = form.match(/const OUTCOMES: AdhocOutcome\[\] = \[([^\]]+)\]/)?.[1].replace(/["\s]/g, "").split(",");
  // «Alumno ausente» no se ofrece al crear una clase no programada (la app tampoco: sólo en una clase individual PROGRAMADA, desde `RegistrationOutcomeField`).
  assert.deepEqual(offered, Object.keys(ADHOC_OUTCOME_LABEL).filter((key) => key !== "alumno_ausente"), "el formulario ofrece los seis resultados, en el orden del mapa");
  const outcomeField = code("components/registro/registration-outcome-field.tsx");
  assert.match(outcomeField, /outcomeOptions\(isGroup\)/, "el registro programado ofrece las ocho opciones (individual) o las seis (grupo)");
});

test("el resultado «no dictado» se avisa con texto en un solo tono (info) para cancelada, reprogramada, ausencia y feriado: sin colores propios por resultado", () => {
  const workspace = code("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.match(workspace, /\{!countsAsClass && \(\s*<Notice tone="info">/);
  for (const file of ["app/(app)/registro/nuevo/nuevo-registro-form.tsx", "app/(app)/registro/libre/[registrationId]/page.tsx", "components/students/profile/clases-tab.tsx"]) {
    assert.doesNotMatch(code(file), /outcomeTone|outcomeColor|OUTCOME_(COLOR|TONE)|ADHOC_OUTCOME_(COLOR|TONE)/, `${file}: ningún color propio por resultado`);
  }
  // El color de «Cancelada» y «Reprogramada» es de la escala congelada del Calendario: este módulo no se toca.
  assert.equal(STATUS_LABELS.cancelled, "Cancelada");
});
