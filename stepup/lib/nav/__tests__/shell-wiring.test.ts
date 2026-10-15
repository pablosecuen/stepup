import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** Pruebas de CABLEADO del shell (no hay DOM en este runner): leen el código real y fijan sus invariantes. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const nav = code("components/nav/primary-nav.tsx");
const signOut = code("components/nav/sign-out-button.tsx");
const layout = code("app/(app)/layout.tsx");

test("escritorio: barra lateral con logo, los cinco destinos y, abajo y separado, un enlace directo a Configuración (no un menú)", () => {
  assert.match(nav, /fixed inset-y-0 left-0[^"]*hidden[^"]*nav:flex/, "sidebar sólo desde 820 px (breakpoint nav)");
  assert.match(nav, /<Logo className="text-background" \/>/);
  assert.match(nav, /PRIMARY_NAV_ITEMS\.map/, "los destinos salen de la lista única");
  const sidebar = nav.slice(nav.indexOf("fixed inset-y-0 left-0"));
  const bottom = sidebar.slice(sidebar.indexOf("</nav>"));
  assert.match(bottom, /border-t border-sideLine/, "separado visualmente de la navegación principal");
  assert.match(bottom, /href="\/configuracion"[\s\S]*Configuración/, "Configuración abajo a la izquierda, al final de la barra");
  assert.match(bottom, /<PrivateLink\s+href="\/configuracion"/, "es un enlace directo");
  assert.doesNotMatch(sidebar, /aria-haspopup|role="menu"|AccountMenu|ChevronUpDown/, "ya no hay menú desplegable ni bloque de cuenta con correo");
  assert.doesNotMatch(sidebar, /Cerrar sesión|SignOutButton/, "la barra lateral no tiene «Cerrar sesión»");
  assert.doesNotMatch(nav.slice(0, nav.indexOf("fixed inset-y-0 left-0")).replace(/<header[\s\S]*?<\/header>/, ""), /href="\/configuracion"/, "fuera del encabezado móvil y de la barra lateral no hay otra entrada");
});

test("móvil: encabezado con logo, acceso directo a Configuración (enlace propio) y «Cerrar sesión»; barra inferior con los mismos destinos", () => {
  const header = nav.slice(nav.indexOf("<header"), nav.indexOf("</header>"));
  assert.match(nav, /<header[^>]*nav:hidden/, "encabezado sólo en móvil (< 820 px)");
  assert.match(header, /href="\/configuracion"[\s\S]*aria-label="Configuración"/, "Configuración sigue accesible en móvil");
  assert.match(header, /h-11 w-11 items-center justify-center/, "44 × 44 px");
  assert.match(header, /<SignOutButton iconOnlyBelowSm \/>/);
  assert.equal((header.match(/href="\/configuracion"/g) ?? []).length, 1);
  const bottomBar = nav.slice(nav.indexOf("fixed inset-x-0 bottom-0"));
  assert.match(bottomBar, /nav:hidden/, "barra inferior sólo en móvil (< 820 px)");
  assert.equal((nav.match(/PRIMARY_NAV_ITEMS\.map/g) ?? []).length, 2, "móvil y escritorio recorren la MISMA lista de destinos");
});

test("«Cerrar sesión»: único control de sesión, arriba a la derecha del área principal en todas las pantallas privadas, sólo ese texto", () => {
  // Escritorio: una fila propia del layout privado (todas las rutas de app/(app)); móvil: el encabezado del shell.
  assert.match(layout, /<div data-session-bar className="hidden h-\[var\(--tf-shell-top\)\] items-center justify-end px-10 nav:flex">\s*<SignOutButton \/>\s*<\/div>/);
  assert.ok(layout.indexOf("<PrimaryNav") < layout.indexOf("data-session-bar") && layout.indexOf("data-session-bar") < layout.indexOf("<main"), "la fila va antes del contenido de cada pantalla");
  assert.equal((layout.match(/<SignOutButton/g) ?? []).length, 1);
  assert.match(read("app/globals.css"), /--tf-shell-top: 3\.25rem;/);
  // El control contiene únicamente «Cerrar sesión» (y su estado de espera): ni Configuración ni otro destino.
  assert.match(signOut, /\{pending \? "Cerrando sesión…" : "Cerrar sesión"\}/);
  assert.doesNotMatch(signOut, /Configuraci|PrivateLink|href=|role="menu|aria-haspopup/, "sin Configuración ni menú dentro");
  assert.match(signOut, /min-h-11/, "44 px de alto");
  assert.match(signOut, /focus-visible:ring-2 focus-visible:ring-ink/, "foco visible");
  assert.match(signOut, /<button\s+type="button"\s+onClick=\{signOut\}/, "un botón: funciona con mouse y teclado (Enter y Espacio nativos)");
  // En todo el área privada «Cerrar sesión» está en UN solo lugar.
  const offenders = [...sourceFiles("app/(app)"), ...sourceFiles("components")].filter((file) => /Cerrar sesión/.test(code(file)) && file !== "components/nav/sign-out-button.tsx");
  assert.deepEqual(offenders, [], "ninguna otra pantalla ofrece «Cerrar sesión»");
});

test("objetivos táctiles de 44 px como mínimo (nav, logo, Configuración, Cerrar sesión)", () => {
  assert.match(nav, /min-h-16 flex-col/, "barra inferior: 64 px de alto por destino");
  assert.match(nav, /min-h-\[46px\] items-center gap-3 rounded-\[12px\] px-3/, "destinos de la barra lateral: 46 px (≥ 44), también Configuración");
  assert.match(nav, /flex min-h-11 w-fit items-center/, "logo: 44 px");
  assert.match(nav, /<ul className="grid grid-cols-5/, "cinco columnas iguales");
  assert.match(nav, /<li key=\{item\.href\} className="min-w-0">/, "cinco destinos reparten el ancho sin desbordar");
});

test("safe areas: arriba (muesca), abajo (barra de inicio) y laterales; viewport-fit=cover sólo en el área privada", () => {
  assert.match(nav, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(nav, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(nav, /pl-\[max\(1rem,env\(safe-area-inset-left\)\)\][^"]*pr-\[max\(1rem,env\(safe-area-inset-right\)\)\]/);
  assert.match(nav, /pl-\[env\(safe-area-inset-left\)\] pr-\[env\(safe-area-inset-right\)\]/);
  assert.match(layout, /export const viewport: Viewport = \{ viewportFit: "cover" \}/);
  assert.doesNotMatch(read("app/layout.tsx"), /viewportFit/, "el layout raíz (login, etc.) no cambia");
  assert.match(layout, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\] nav:pb-0/, "el contenido deja lugar a la barra inferior + safe area");
});

test("logout: acción propia (botón → signOutAction existente vía guardNetwork), nunca un enlace ni un form pelado; sin confirmación nueva", () => {
  const request = read("lib/nav/request-sign-out.ts");
  assert.match(request, /import \{ signOutAction \} from "@\/lib\/auth\/actions"/, "reusa la acción existente, sin lógica nueva de auth");
  assert.match(request, /await signOutAction\(\);\n  return \{\};/);
  assert.match(signOut, /guardNetwork\(\(\) => requestSignOut\(\)\)/, "una falla de red no rompe la pantalla (regla guardNetwork del repo)");
  assert.match(signOut, /if \(result\.error\) setError\(result\.error\)/, "el error se muestra");
  assert.match(signOut, /role="alert"/);
  assert.match(signOut, /useTransition/);
  assert.doesNotMatch(signOut, /<form|signOutAction\(|from "@\/lib\/auth\/actions"/, "nada de form pelado ni del Server Action directo en el componente cliente");
  assert.doesNotMatch(signOut, /confirm\(|Dialog|window\.confirm/, "como antes, cerrar sesión no pide confirmación (no destruye nada)");
});

test("ausencia de prefetch: ningún enlace del área privada puede precargar", () => {
  const privateLink = read("components/nav/private-link.tsx");
  assert.match(privateLink, /<NextLink \{\.\.\.props\} prefetch=\{false\} \/>/, "prefetch={false} va DESPUÉS del spread: no se puede reactivar");
  assert.match(privateLink, /Omit<ComponentProps<typeof NextLink>, "prefetch">/, "el tipo ni siquiera acepta `prefetch`");

  const offenders: string[] = [];
  for (const file of [...sourceFiles("app/(app)"), ...sourceFiles("components").filter((f) => !f.startsWith("components/auth/"))]) {
    if (file === "components/nav/private-link.tsx") continue;
    const source = read(file);
    if (/from "next\/link"/.test(source)) offenders.push(`${file}: importa next/link directo`);
    if (/prefetch\s*=\s*\{?\s*(true|"auto"|null)/.test(source) || /router\.prefetch\(/.test(source)) offenders.push(`${file}: precarga explícita`);
  }
  assert.deepEqual(offenders, [], "todo el área privada usa PrivateLink");
  assert.match(nav, /import PrivateLink from "@\/components\/nav\/private-link"/);
  assert.doesNotMatch(nav, /from "next\/link"/);
});

test("ningún cambio en autenticación ni datos: el shell ya no lee el perfil y reusa signOutAction (vía request-sign-out)", () => {
  // El layout conserva EXACTAMENTE su verificación de sesión: una sola llamada a getUser y la misma regla de acceso.
  // (desde el bloque de usabilidad: la misma verificación con Auth, compartida con la página por solicitud — `getRenderUser`).
  assert.equal((layout.match(/getRenderUser\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(layout, /adapter\.getUser\(\)/);
  assert.match(layout, /resolvePrivateAreaAccess\(\{ configured, hasSession, pathname: "\/inicio" \}\)/);
  assert.match(layout, /if \(decision\.kind === "redirect"\) redirect\(decision\.to\);\n  \}/);
  assert.doesNotMatch(layout, /loadAccountIdentity|resolveAccountIdentity|teacher_profiles|getTeacherProfile/, "el shell ya no necesita el nombre: una lectura menos por navegación");
  assert.throws(() => read("lib/nav/load-account-identity.ts"), "el lector de identidad ya no existe");

  // El shell no importa nada de escritura de auth/datos salvo signOutAction (vía request-sign-out) y guardNetwork.
  for (const file of ["components/nav/primary-nav.tsx", "components/nav/sign-out-button.tsx", "components/nav/private-link.tsx"]) {
    const imports = read(file).match(/from "@\/lib\/[^"]+"/g) ?? [];
    for (const imported of imports) {
      assert.match(imported, /@\/lib\/(nav\/|actions\/network-guard")/, `${file} importa sólo lib/nav y guardNetwork (${imported})`);
    }
  }
});

test("Recordatorios y Resumen financiero siguen accesibles desde sus puntos actuales", () => {
  assert.match(read("components/dashboard/home-view.tsx"), /href="\/recordatorios"/);
  // Resumen financiero se llega desde la navegación secundaria de Cobros (barra lateral y pestañas de la pantalla), con la misma ruta de siempre.
  assert.match(read("components/payments/payments-section-nav.tsx"), /href: "\/resumen-financiero"/);
  assert.match(read("lib/nav/primary-nav-items.ts"), /secondary: \[\{ href: "\/resumen-financiero", label: "Resumen financiero" \}\]/);
});

test("Inicio: «Cerrar sesión» (fila superior del shell) y la campana de Recordatorios no se superponen y tienen objetivos separados", () => {
  const home = code("components/dashboard/home-view.tsx");
  assert.doesNotMatch(home, /Cerrar sesión|SignOutButton/, "Inicio no dibuja el control de sesión: lo pone el shell en su propia fila");
  assert.match(home, /h-11 w-11 shrink-0 items-center justify-center rounded-full/, "la campana mide 44 × 44 y no se encoge");
  // la fila del shell reserva su propio alto: el contenido de cada pantalla empieza debajo y nunca por encima
  assert.match(layout, /h-\[var\(--tf-shell-top\)\]/);
});

test("el shell no incluye alcance ajeno (textos de fase, pestañas del perfil, safe redirect)", () => {
  assert.doesNotMatch(nav + signOut, /Fase \d|next=|sanitizeNextPath/);
});
