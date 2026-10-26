import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STANDARD_LEVELS } from "../../students/constants.ts";
import { validateLevelName, type CustomLevelRecord } from "../../repositories/custom-levels-mapping.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const WORKSPACE = "app/(app)/registro/[calendarLessonId]/registration-workspace.tsx";

test("registro grupal: al guardar bien a un alumno, el siguiente (o el resumen) sube debajo del encabezado; sólo ahí, nunca al escribir ni en un refresco", () => {
  const w = read(WORKSPACE);
  assert.ok(w.includes("setScrollRequest((current) => ({ anchor: nextOpenId ? participantAnchorId(nextOpenId) : SUMMARY_ANCHOR_ID"), "al final de la lista va al resumen");
  assert.equal((w.match(/setScrollRequest\(/g) ?? []).length, 1, "un solo lugar pide el desplazamiento: handleParticipantSaved, tras guardar bien");
  assert.ok(w.includes("return scrollElementToTop(target);"), "se cancela si la pantalla cambia");
  assert.ok(w.includes("document.activeElement.blur()"), "se suelta el campo activo (teclado) antes de avanzar, como Keyboard.dismiss de la app");
  // Si falla el guardado no se avanza ni se pierde lo escrito: handleParticipantSaved sólo corre en el camino sin error.
  assert.match(w, /if \(result\.error\) \{\s+setError\(result\.error\);\s+return;\s+\}\s+handleParticipantSaved\(studentId, nextStatus\);/);
  assert.ok(w.includes('<Block title="Resumen" anchorId={SUMMARY_ANCHOR_ID}>'));
  assert.ok(w.includes("scroll-mt-[calc(var(--tf-m-header)+var(--tf-safe-top)+12px)]"), "el ancla respeta el encabezado fijo y el área segura");
  const util = read("lib/ui/scroll-to-element.ts");
  assert.ok(util.includes("findScrollContainer"), "se desplaza el contenedor que de verdad tiene el scroll, no se asume window");
  assert.ok(util.includes("window.scrollTo({ top, behavior })") && util.includes("container.scrollTo({ top, behavior })"));
  assert.ok(read("components/nav/primary-nav.tsx").includes("<header data-tf-top-bar"), "el encabezado fijo se descuenta al desplazar");
});

test("niveles: una cuenta nueva empieza con A1–C2 y nada más; el «+» crea y selecciona el nivel; nombres vacíos y duplicados se rechazan sin bloquear nombres legítimos", () => {
  assert.deepEqual([...STANDARD_LEVELS], ["A1", "A2", "B1", "B2", "C1", "C2"]);
  const repo = read("lib/repositories/custom-levels.ts");
  assert.ok(!/insert\([^)]*(A1|Infantes)/.test(repo), "ningún nivel propio se siembra por defecto");
  const mine: CustomLevelRecord[] = [{ id: "1", name: "Infantes", createdAt: "2026-10-01T00:00:00Z" }];
  assert.equal(validateLevelName("   ", mine)?.message, "Ponele un nombre al nivel.");
  assert.equal(validateLevelName("b1", mine)?.message, "Ese nombre ya corresponde a un nivel estándar (A1-C2).");
  assert.equal(validateLevelName("  infantes ", mine)?.message, "Ya existe un nivel personalizado con ese nombre.");
  for (const legit of ["A1 avanzado", "Preparación First", "B1+", "Niños 6-8"]) assert.equal(validateLevelName(legit, mine), null, legit);
  assert.equal(validateLevelName("Infantes", [], undefined), null, "otra cuenta (otra lista) sí puede tener el mismo nombre");
  const picker = read("components/students/level-picker.tsx");
  assert.ok(picker.includes('aria-label="Crear nivel personalizado"'));
  assert.ok(picker.includes("createLevelInlineAction(name)"));
  assert.ok(picker.includes('if (e.key === "Enter") {\n                  e.preventDefault();'), "Enter agrega el nivel y NO envía el formulario del alumno");
  assert.ok(picker.includes("setSelected((current) => (current.includes(created.name) ? current : [...current, created.name]))"), "el nivel creado queda seleccionado");
  assert.ok(picker.includes("const orphans = selected.filter"), "un nivel que el alumno ya tenía y no figura entre los de la cuenta no se pierde");
  const action = read("lib/actions/students.ts");
  assert.ok(action.includes("export async function createLevelInlineAction"));
  assert.ok(action.includes("await createCustomLevel(ctx, rawName)"), "siempre por la cuenta de la sesión");
  for (const page of ["app/(app)/alumnos/nuevo/new-student-form.tsx", "app/(app)/alumnos/[id]/editar/edit-student-form.tsx"]) assert.ok(read(page).includes("StudentFormFields"), page);
});

test("Calendario: una clase registrada ofrece «Clase registrada» + «Editar registro» (abre su registro y vuelve a la misma semana o día); no es el perfil, la programación ni la serie", () => {
  const modal = read("components/calendar/real-lesson-detail-modal.tsx");
  assert.ok(modal.includes('item.status === "completed" && item.materializedLessonId'));
  assert.ok(modal.includes("Editar registro") && modal.includes("Clase registrada"));
  assert.ok(modal.includes("editRegistrationHref(item.materializedLessonId, calendarPath)"));
  assert.ok(modal.includes("window.location.pathname + window.location.search"), "vuelve a la semana o el día desde el que se abrió");
  const page = read("app/(app)/registro/[calendarLessonId]/page.tsx");
  assert.ok(page.includes("safeCalendarReturn((await searchParams).volver)"), "sólo se vuelve a una ruta interna del Calendario");
  assert.ok(page.includes("if (!calendarLesson) notFound();") && page.includes("No encontramos el registro de esta clase."));
  const w = read(WORKSPACE);
  assert.equal((w.match(/continueAfterSave\((?:true|false), returnHref \?\? "\/registro"\)/g) ?? []).length, 2, "al guardar (primer finalizado o edición) se vuelve a la misma semana o día, pasando antes por el aviso de pago si corresponde");
  // El guardado de una edición sigue siendo la misma llamada atómica con su operación idempotente (no crea otro registro ni duplica nada).
  assert.ok(w.includes("editCompletedRegistrationAction({") && w.includes("editOperationId,"));
});
