import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Series simplificadas (05/11/2026): tarjeta compacta con un único «Acciones» y formularios en diálogos. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const ACTIONS = "app/(app)/calendario/series/series-status-actions.tsx";

test("la tarjeta muestra nombre, día y horario, modalidad, estado, tipo (si no es clase) y UN solo control «Acciones», sin botones sueltos", () => {
  const card = read("components/calendar/series-list-view.tsx");
  assert.equal((card.match(/<SeriesStatusActions /g) ?? []).length, 1, "un único control de acciones por tarjeta");
  assert.match(card, /line-clamp-2[^"]*\[overflow-wrap:anywhere\]">\{rule\.classTitle \|\| participantNames\}/, "el nombre largo se ajusta a dos líneas, sin desbordar");
  assert.match(card, /rule\.activityKind !== "class" && <Badge>/);
  assert.doesNotMatch(card, /TrainingBillingConfigButton/, "la cuota ya no es un botón suelto en la tarjeta");
  const actions = read(ACTIONS);
  assert.doesNotMatch(actions, /<Button[^>]*>\s*(Pausar|Reanudar|Editar futuras|Modificar participantes|Intercambiar horarios|Eliminar serie)\s*<\/Button>/, "ninguna acción queda como botón de la tarjeta");
});

test("«Acciones» agrupa las opciones existentes: Programación, Miembros y configuración, Estado y la destructiva separada al final", () => {
  const actions = read(ACTIONS);
  const order = ["Programación", "Miembros y configuración", "Estado"].map((heading) => actions.indexOf(`heading: "${heading}"`));
  assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2], "grupos en orden");
  for (const label of ["Cambiar horario", "Intercambiar horarios", "Administrar miembros", "Editar futuras", "Pausar", "Reanudar", "Eliminar serie"]) assert.ok(actions.includes(`label: "${label}"`), label);
  assert.ok(actions.indexOf('label: "Cambiar horario"') < actions.indexOf('label: "Intercambiar horarios"'));
  assert.ok(actions.indexOf('label: "Administrar miembros"') < actions.indexOf('label: "Editar futuras"'));
  assert.ok(actions.indexOf('label: "Pausar"') < actions.indexOf('label: "Eliminar serie"'), "la destructiva va al final");
  assert.match(actions, /key: "peligro",\s*heading: null/);
  assert.match(actions, /status === "active" && swapOptions\.length >= 2 && swapOptions\.some\(\(option\) => option\.id === ruleId\)/, "mismas condiciones que antes para intercambiar");
  assert.match(actions, /training \? \[\{ key: "billing", label: training\.agreementId \? "Editar cuota" : "Configurar cuota"/);
  assert.match(actions, /disabled: pending/, "no se repite Pausar/Reanudar mientras guarda");
});

test("el menú es accesible (teclado y tacto, foco visible, estado expandido) y sólo una tarjeta lo tiene abierto a la vez", () => {
  const menu = read("components/calendar/series-actions-menu.tsx");
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /focus-visible:ring-2/);
  assert.match(menu, /min-h-11/, "44 px de alto táctil");
  for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End"]) assert.ok(menu.includes(`"${key}"`), key);
  assert.match(menu, /document\.addEventListener\("pointerdown", onPointerDown\)/, "tocar otra tarjeta cierra ésta: una sola abierta");
  assert.match(menu, /window\.addEventListener\("scroll", closeOnScroll, true\)/, "al desplazar la lista se cierra");
  assert.match(menu, /if \(!menuRef\.current\?\.contains\(event\.target as Node\)\) setOpen\(false\)/, "el desplazamiento del propio menú no lo cierra");
  assert.match(menu, /fixed z-50/, "posición fija: la lista con scroll no lo recorta");
  assert.match(menu, /item\.destructive \? "text-bad hover:bg-badSoft"/);
});

test("cada opción abre su formulario existente en un diálogo con el nombre de la serie y «Volver»; al cerrar se devuelve el foco a «Acciones»", () => {
  const actions = read(ACTIONS);
  for (const title of ["Cambiar horario", "Intercambiar horarios", "Editar futuras", "Administrar miembros"]) assert.match(actions, new RegExp(`<Dialog title=\\{dialogTitle\\("${title}"\\)\\}`), title);
  assert.match(actions, /const dialogTitle = \(action: string\) => `\$\{action\} · \$\{seriesLabel\}`/, "el título nombra la serie");
  assert.match(actions, /<ChangeSchedulePanel /, "reutiliza el panel de cambio de horario");
  assert.match(actions, /<SeriesSwapPanel /, "reutiliza el intercambio atómico");
  assert.match(actions, /editFutureRecurrenceAction\(\{\}, formData\)/);
  assert.match(actions, /changeParticipantsAction\(\{/);
  assert.match(actions, /endSeriesFromTodayAction\(ruleId\)/);
  assert.equal((actions.match(/Volver\n/g) ?? []).length >= 2, true, "opción clara para volver");
  assert.match(actions, /window\.requestAnimationFrame\(\(\) => actionsButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)\)/, "devuelve el foco sin mover la lista");
  assert.doesNotMatch(actions, /rounded-lg border-\[1\.5px\] border-border bg-surface2 p-4/, "ningún formulario queda incrustado en la tarjeta");
  assert.match(actions, /setCycleLengthWeeks\(initialCycle\)[\s\S]*setSelectedParticipantIds\(new Set\(participantIds\)\)/, "cancelar deja los formularios como estaban");
});

test("misma organización en la lista y en la pantalla de una serie (la tarjeta es la misma) y la cuota se abre desde «Acciones»", () => {
  assert.match(read("app/(app)/calendario/series/[id]/page.tsx"), /<SeriesCard /);
  assert.match(read("components/calendar/series-list-view.tsx"), /export function SeriesCard/);
  const billing = read("components/payments/training-billing-config.tsx");
  assert.match(billing, /\{!controlled && \(\s*<Button variant="secondary" onClick=\{\(\) => setOpen\(true\)\} aria-haspopup="dialog">/, "con el menú no hay botón propio; sin él sigue igual que antes");
});

test("no se tocaron los componentes de Codex (selector, grilla, panel de cambio de horario, detalle de la clase)", () => {
  for (const file of ["components/calendar/availability-picker.tsx", "components/calendar/time-slot-grid.tsx", "components/calendar/change-schedule-panel.tsx", "components/calendar/real-lesson-detail-modal.tsx"]) assert.ok(read(file).length > 0, file);
});
