import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** Pruebas de CABLEADO del shell (no hay DOM en este runner): leen el código real y fijan sus invariantes. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

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

const nav = read("components/nav/primary-nav.tsx");
const menu = read("components/nav/account-menu.tsx");
const layout = read("app/(app)/layout.tsx");

test("escritorio: barra lateral con logo, los cinco destinos y el bloque de cuenta abajo; Configuración fuera de la navegación", () => {
  assert.match(nav, /fixed inset-y-0 left-0[^"]*hidden[^"]*md:flex/, "sidebar sólo en md+");
  assert.match(nav, /<Logo \/>/);
  assert.match(nav, /<AccountMenu identity=\{account\} variant="sidebar" \/>/, "bloque de cuenta en la barra lateral");
  assert.match(nav, /PRIMARY_NAV_ITEMS\.map/, "los destinos salen de la lista única");
  assert.doesNotMatch(nav, /Configuraci|Cog6Tooth/, "Configuración ya no está en la navegación principal");
  assert.match(menu, /href="\/configuracion"[\s\S]*Configuración/, "Configuración está en el menú de cuenta");
});

test("móvil: encabezado con logo y botón de cuenta + barra inferior con los mismos destinos", () => {
  assert.match(nav, /<header[^>]*md:hidden/, "encabezado sólo en móvil");
  assert.match(nav, /<AccountMenu identity=\{account\} variant="header" \/>/);
  const bottom = nav.slice(nav.indexOf("fixed inset-x-0 bottom-0"));
  assert.match(bottom, /md:hidden/, "barra inferior sólo en móvil");
  assert.equal((nav.match(/PRIMARY_NAV_ITEMS\.map/g) ?? []).length, 2, "móvil y escritorio recorren la MISMA lista de destinos");
});

test("objetivos táctiles de 44 px como mínimo (nav, logo, botón de cuenta, elementos del menú)", () => {
  assert.match(nav, /min-h-16 flex-col/, "barra inferior: 64 px de alto por destino");
  assert.match(nav, /min-h-11 items-center gap-3 rounded-md px-3/, "destinos de la barra lateral: 44 px");
  assert.match(nav, /flex min-h-11 items-center gap-2\.5/, "logo: 44 px");
  assert.match(menu, /h-11 w-11 items-center justify-center rounded-full/, "botón de cuenta del encabezado: 44×44");
  assert.match(menu, /min-h-14 w-full/, "bloque de cuenta de escritorio");
  assert.match(menu, /const ITEM_CLASS =\s*"flex min-h-11 w-full/, "elementos del menú: 44 px");
  assert.match(nav, /<li key=\{item\.href\} className="min-w-0 flex-1">/, "cinco destinos reparten el ancho sin desbordar");
});

test("safe areas: arriba (muesca), abajo (barra de inicio) y laterales; viewport-fit=cover sólo en el área privada", () => {
  assert.match(nav, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(nav, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(nav, /pl-\[max\(1rem,env\(safe-area-inset-left\)\)\][^"]*pr-\[max\(1rem,env\(safe-area-inset-right\)\)\]/);
  assert.match(nav, /pl-\[env\(safe-area-inset-left\)\] pr-\[env\(safe-area-inset-right\)\]/);
  assert.match(layout, /export const viewport: Viewport = \{ viewportFit: "cover" \}/);
  assert.doesNotMatch(read("app/layout.tsx"), /viewportFit/, "el layout raíz (login, etc.) no cambia");
  assert.match(layout, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0/, "el contenido deja lugar a la barra inferior + safe area");
});

test("menú de cuenta: ARIA, teclado, Escape, clic exterior, devolución de foco y cierre al navegar", () => {
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /role="menu"/);
  assert.equal((menu.match(/\srole="menuitem"/g) ?? []).length, 2, "dos elementos: Configuración y Cerrar sesión");
  assert.match(menu, /menuKeyAction\(/, "teclado vía lógica pura probada");
  assert.match(menu, /triggerKeyAction\(/);
  assert.match(menu, /if \(restoreFocus\) triggerRef\.current\?\.focus\(\)/, "devuelve el foco al botón");
  assert.match(menu, /document\.addEventListener\("pointerdown"/, "clic/toque exterior");
  assert.match(menu, /document\.removeEventListener\("pointerdown"/, "sin fugas de listeners");
  assert.match(menu, /onBlur=\{onBlur\}/, "el foco que sale del menú lo cierra");
  assert.match(menu, /tabIndex=\{-1\}/, "foco itinerante: los elementos se alcanzan con flechas");
  assert.match(menu, /if \(pathname !== lastPathname\)[\s\S]*setOpen\(false\)/, "navegar cierra el menú");
});

test("logout: acción propia (botón → signOutAction existente vía guardNetwork), nunca un enlace ni un form pelado", () => {
  const signOut = read("lib/nav/request-sign-out.ts");
  assert.match(signOut, /import \{ signOutAction \} from "@\/lib\/auth\/actions"/, "reusa la acción existente, sin lógica nueva de auth");
  assert.match(signOut, /await signOutAction\(\);\n  return \{\};/);
  assert.match(menu, /guardNetwork\(\(\) => requestSignOut\(\)\)/, "una falla de red no rompe la pantalla (regla guardNetwork del repo)");
  assert.match(menu, /if \(result\.error\) setSignOutError\(result\.error\)/, "el error se muestra");
  assert.match(menu, /role="alert"/);
  assert.match(menu, /type="button"\n\s+role="menuitem"[\s\S]*onClick=\{signOut\}/, "es un botón propio");
  assert.match(menu, /Cerrar sesión/);
  assert.match(menu, /useTransition/);
  assert.doesNotMatch(menu, /<form|signOutAction\(|from "@\/lib\/auth\/actions"/,"nada de form pelado ni del Server Action directo en el componente cliente");
  assert.doesNotMatch(menu, /<PrivateLink[^>]*(logout|login|sign)/i, "cerrar sesión no es un enlace");
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
  assert.match(menu, /import PrivateLink from "@\/components\/nav\/private-link"/);
  assert.doesNotMatch(nav + menu, /from "next\/link"/);
});

test("ningún cambio en autenticación ni datos: el shell sólo LEE el nombre y reusa signOutAction (vía request-sign-out)", () => {
  const loader = read("lib/nav/load-account-identity.ts");
  assert.match(loader, /getTeacherProfile\(/, "lee la fila de perfil que ya lee Configuración");
  assert.doesNotMatch(loader, /\.(insert|update|upsert|delete|rpc)\(|saveTeacherDisplayName/, "sin escrituras");
  assert.match(loader, /try \{[\s\S]*\} catch \{\s*return \{ displayName: null, email \};/, "si falla el nombre, queda el correo");
  assert.doesNotMatch(loader, /console\./, "nunca loguea nombre ni correo");
  assert.match(loader, /getTeacherProfile\(\{ supabase, ownerId: user\.id \}\)/, "reusa el usuario ya verificado (no pide otro getUser)");

  // El layout conserva EXACTAMENTE su verificación de sesión: una sola llamada a getUser y la misma regla de acceso.
  assert.equal((layout.match(/adapter\.getUser\(\)/g) ?? []).length, 1);
  assert.match(layout, /resolvePrivateAreaAccess\(\{ configured, hasSession, pathname: "\/inicio" \}\)/);
  assert.match(layout, /if \(decision\.kind === "redirect"\) redirect\(decision\.to\);\n  \}\n\n  const account = /, "la identidad se carga DESPUÉS de la verificación de sesión");

  // El shell no importa nada de escritura de auth/datos salvo signOutAction.
  for (const file of ["components/nav/primary-nav.tsx", "components/nav/account-menu.tsx", "components/nav/private-link.tsx"]) {
    const imports = read(file).match(/from "@\/lib\/[^"]+"/g) ?? [];
    for (const imported of imports) {
      assert.match(imported, /@\/lib\/(nav\/|actions\/network-guard")/, `${file} importa sólo lib/nav y guardNetwork (${imported})`);
    }
  }
});

test("Recordatorios y Resumen financiero siguen accesibles desde sus puntos actuales", () => {
  assert.match(read("components/dashboard/home-view.tsx"), /href="\/recordatorios"/);
  assert.match(read("app/(app)/cobros/page.tsx"), /href="\/resumen-financiero"/);
});

test("el shell no incluye alcance ajeno (textos de fase, pestañas del perfil, safe redirect)", () => {
  assert.doesNotMatch(nav + menu, /Fase \d|next=|sanitizeNextPath/);
});
