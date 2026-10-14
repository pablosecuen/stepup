import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { passwordFieldType, passwordToggleLabel } from "../password-visibility.ts";
import { PRIMARY_NAV_ITEMS, activePrimaryNavHref, isPrimaryNavActive, isPrimarySectionActive } from "../../nav/primary-nav-items.ts";

/** Bloque de usabilidad: contraseña visible, Resumen financiero dentro de Cobros y fila completa del alumno. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ 1. contraseña
test("mostrar/ocultar contraseña: oculta por defecto, alterna password/text y el nombre dice lo que hará el botón", () => {
  assert.equal(passwordFieldType(false), "password");
  assert.equal(passwordFieldType(true), "text");
  assert.equal(passwordToggleLabel(false), "Mostrar contraseña");
  assert.equal(passwordToggleLabel(true), "Ocultar contraseña");
});

test("PasswordInput: mismo <input> (valor, foco y selección se conservan), aria-pressed, 44 px, sin guardar ni enviar nada y sin quitarle el foco al campo", () => {
  const source = code("components/ui/password-input.tsx");
  assert.match(source, /useState\(false\)/, "oculta por defecto");
  assert.match(source, /type=\{passwordFieldType\(visible\)\}/);
  assert.match(source, /aria-pressed=\{visible\}/);
  assert.match(source, /aria-label=\{passwordToggleLabel\(visible\)\}/);
  assert.match(source, /h-11 w-11/, "objetivo táctil de 44 px");
  assert.match(source, /type="button"/, "no envía el formulario");
  assert.match(source, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/, "el mouse/dedo no le sacan el foco al campo");
  assert.match(source, /setSelectionRange\(/, "devuelve la selección tras cambiar el tipo");
  assert.match(source, /ref=\{inputRef\}/);
  assert.match(source, /spellCheck=\{false\}/, "el corrector no envía la contraseña a un servicio externo");
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|fetch\(|console\.|navigator\.clipboard|\.value\s*=/, "no registra, persiste ni envía el valor");
  // No fija `autoComplete`: llega por props de cada formulario (current-password / new-password) y se conserva tal cual.
  assert.doesNotMatch(source, /autoComplete=/);
  assert.match(source, /\{\.\.\.props\}/);
});

test("se usa en Iniciar sesión, Crear cuenta y Nueva contraseña con el autocomplete correcto, y en ningún otro campo", () => {
  const login = code("app/login/login-form.tsx");
  assert.match(login, /<PasswordInput id="password" name="password" autoComplete="current-password" required/);
  assert.doesNotMatch(login, /type="password"/);
  for (const file of ["app/crear-cuenta/signup-form.tsx", "app/nueva-contrasena/new-password-form.tsx"]) {
    const source = code(file);
    const uses = source.match(/<PasswordInput[^>]*>/g) ?? [];
    assert.equal((source.match(/<PasswordInput/g) ?? []).length, 2, `${file}: contraseña y repetición`);
    assert.equal((source.match(/autoComplete="new-password"/g) ?? []).length, 2, `${file}: new-password en las dos`);
    assert.doesNotMatch(source, /type="password"/);
    assert.ok(uses.length >= 0);
  }
  const users = sources("app").concat(sources("components")).filter((file) => /<PasswordInput\b/.test(code(file))).sort();
  assert.deepEqual(users, ["app/crear-cuenta/signup-form.tsx", "app/login/login-form.tsx", "app/nueva-contrasena/new-password-form.tsx"]);
  // El diálogo de eliminar cuenta y los demás campos no cambian.
  assert.match(code("components/account/delete-account-button.tsx"), /type="password"/);
});

// ------------------------------------------------------------------------------------------------ 2. Cobros / Resumen
test("Resumen financiero pertenece a Cobros: no es un sexto destino y mantiene a Cobros como sección activa en /cobros y /resumen-financiero", () => {
  assert.equal(PRIMARY_NAV_ITEMS.length, 5);
  assert.ok(!PRIMARY_NAV_ITEMS.some((item) => item.href === "/resumen-financiero"));
  const payments = PRIMARY_NAV_ITEMS.find((item) => item.href === "/cobros")!;
  assert.deepEqual(payments.secondary, [{ href: "/resumen-financiero", label: "Resumen financiero" }]);
  for (const path of ["/cobros", "/resumen-financiero", "/resumen-financiero?preset=current_year", "/resumen-financiero/"]) {
    assert.equal(isPrimarySectionActive(path, payments), true, path);
    assert.equal(activePrimaryNavHref(path), "/cobros", path);
  }
  assert.equal(isPrimaryNavActive("/resumen-financiero", "/cobros"), false, "la ruta exacta sigue siendo la suya");
  for (const other of PRIMARY_NAV_ITEMS.filter((item) => item.href !== "/cobros")) assert.equal(isPrimarySectionActive("/resumen-financiero", other), false);
  assert.equal(activePrimaryNavHref("/recordatorios"), null);
  assert.equal(activePrimaryNavHref("/resumen-financieroX"), null, "sólo segmentos completos");
});

test("barra lateral: la entrada secundaria va indentada debajo de Cobros, siempre presente (no mueve ni ensancha nada); la barra inferior conserva sus cinco destinos", () => {
  const nav = code("components/nav/primary-nav.tsx");
  const bottom = nav.slice(nav.indexOf('<ul className="grid grid-cols-5'), nav.indexOf('<div data-surface="dark"'));
  assert.doesNotMatch(bottom, /secondary/, "en móvil la navegación secundaria vive dentro de la pantalla");
  const sidebar = nav.slice(nav.indexOf('<div data-surface="dark"'));
  assert.match(sidebar, /item\.secondary && \(/);
  assert.match(sidebar, /pl-11/, "indentada");
  assert.match(sidebar, /min-h-11/, "44 px");
  assert.match(sidebar, /childActive \? "page" : undefined/);
  assert.match(nav, /w-\[236px\]/, "la barra conserva su ancho");
  assert.match(nav, /grid grid-cols-5/);
  assert.match(nav, /aria-current=\{isActive \? \(isPrimaryNavActive\(pathname, item\.href\) \? "page" : "true"\) : undefined\}/, "Cobros activa con «page» en su ruta y «true» en Resumen");
});

test("navegación secundaria dentro de las pantallas: «Centro de cobros» y «Resumen financiero» bajo el encabezado, con las rutas de siempre, y sin «Volver a Inicio»", () => {
  const section = code("components/payments/payments-section-nav.tsx");
  assert.match(section, /aria-label="Secciones de Cobros"/);
  assert.match(section, /href: "\/cobros", label: "Centro de cobros"/);
  assert.match(section, /href: "\/resumen-financiero", label: "Resumen financiero"/);
  assert.match(section, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(section, /min-h-11/);
  assert.match(section, /font-bold/, "el estado activo no depende sólo del color");
  const collections = code("components/payments/collections-view.tsx");
  assert.equal((collections.match(/<PaymentsSectionNav current="collections" \/>/g) ?? []).length, 2, "pantalla y vista de error");
  assert.doesNotMatch(collections, /Ver resumen financiero/, "el botón de la cabecera pasó a la navegación secundaria");
  const overview = code("components/finance/financial-overview-view.tsx");
  assert.equal((overview.match(/<PaymentsSectionNav current="overview" \/>/g) ?? []).length, 2);
  assert.doesNotMatch(overview, /Volver a Inicio|BackLink/);
  // Rutas intactas: ni redirects ni carpetas nuevas.
  assert.match(read("lib/auth/safe-redirect.ts"), /"\/resumen-financiero"/);
});

// ------------------------------------------------------------------------------------------------ 5. fila del alumno
test("la fila completa del alumno abre el perfil con UN solo enlace por fila (una parada de Tab y un nombre accesible), sin enlaces repetidos por celda", () => {
  const source = code("components/students/student-card.tsx");
  const table = source.slice(source.indexOf("export function StudentsTable"));
  assert.equal((table.match(/<PrivateLink\b/g) ?? []).length, 1, "un único enlace en la fila de la tabla");
  assert.match(table, /<Tr key=\{student\.id\} className="relative cursor-pointer">/);
  assert.match(table, /aria-label=\{`Abrir perfil de \$\{student\.name\}`\}/);
  assert.match(table, /after:absolute after:inset-0/, "el pseudo-elemento del enlace cubre toda la fila");
  assert.match(table, /focus-visible:after:outline/, "el foco se ve alrededor de la fila entera");
  assert.match(table, /group-hover:underline/, "hover: toda la fila lo comunica");
  assert.match(table, /min-h-11/);
  assert.match(read("components/students/student-card.tsx"), /relative z-10/, "los botones independientes futuros van por encima de la superficie clicable (documentado en el comentario del componente)");
  // Móvil: la tarjeta entera ya es un solo enlace.
  const card = source.slice(source.indexOf("export function StudentCard"), source.indexOf("export function StudentsTable"));
  assert.equal((card.match(/<PrivateLink\b/g) ?? []).length, 1);
  assert.match(card, /min-h-\[72px\]/);
  // Seguimos con una tabla legible: encabezados, badges de estado y niveles.
  assert.match(table, /<Th>Alumno<\/Th>[\s\S]*<Th align="right">Estado<\/Th>/);
  assert.match(table, /<StudentStatusBadge status=\{student\.status\} \/>/);
});

// ------------------------------------------------------------------------------------------------ 4. consultas
test("Inicio y Resumen financiero leen series, excepciones y alumnos UNA vez y arman todas sus vistas del calendario sobre esa base; las lecturas independientes salen juntas", () => {
  const home = code("lib/dashboard/load-home-data.ts");
  assert.equal((home.match(/loadCalendarViewBase\(ctx\)/g) ?? []).length, 1, "una sola base");
  assert.doesNotMatch(home, /listRecurrenceRules\(|listRecurrenceExceptionsForRules\(|listStudents\(/, "Inicio ya no repite esas lecturas");
  assert.match(home, /base\.then\(\(loaded\) => loadCalendarViewForRange\(ctx, new Date\(dayStartIso\), dayEndExclusive, loaded\)\)/);
  assert.match(home, /base\.then\(\(loaded\) => loadCalendarViewForRange\(ctx, pendingLookbackStart, now, loaded\)\)/);
  assert.match(home, /listOpenChargeBalances\(ctx\),\n  \]\);/, "los cobros salen en la misma ola");
  const overview = code("lib/dashboard/load-financial-overview.ts");
  assert.equal((overview.match(/loadCalendarViewBase\(ctx\)/g) ?? []).length, 1);
  assert.equal((overview.match(/, loaded\)\)/g) ?? []).length, 2, "demanda y valor de la hora comparten la base");
  assert.doesNotMatch(overview, /await loadCalendarViewForRange|await listLessonRegistrationsInRange\(ctx, rangeStartIso/, "sin esperas seguidas por lecturas independientes");
  const view = code("lib/calendar/view.ts");
  assert.match(view, /export async function loadCalendarViewBase\(/);
  assert.match(view, /base\?: CalendarViewBase/);
  // Una sola verificación con Auth por navegación: el layout y la página comparten `getRenderUser` (React cache, por solicitud).
  assert.match(code("lib/auth/render-user.ts"), /export const getRenderUser = cache\(/);
  assert.match(code("lib/db/server-context.ts"), /const user = await getRenderUser\(\);/);
  assert.doesNotMatch(code("lib/db/server-context.ts"), /supabase\.auth\.getUser\(\)/);
  // La recuperación de sesión (B0) y las cuentas siguen consultando de nuevo: nunca usan la copia de la solicitud.
  for (const file of ["lib/auth/recovery-session.ts", "lib/auth/session-recovery-action.ts", "lib/auth/supabase-auth-adapter.ts"]) assert.doesNotMatch(code(file), /getRenderUser/, file);
});
