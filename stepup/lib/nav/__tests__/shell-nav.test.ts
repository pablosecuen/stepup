import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { PRIMARY_NAV_ITEMS, activePrimaryNavHref, isPrimaryNavActive } from "../primary-nav-items.ts";
import { FALLBACK_ACCOUNT_INITIAL, FALLBACK_ACCOUNT_LABEL, resolveAccountIdentity } from "../account-identity.ts";
import { menuKeyAction, triggerKeyAction } from "../menu-keyboard.ts";

const APP_DIR = fileURLToPath(new URL("../../../app/(app)", import.meta.url));

/** Todas las rutas reales del área privada (cada `page.tsx` bajo app/(app)), con los segmentos dinámicos reemplazados por un valor. */
function privateRoutes(): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const segments = relative(APP_DIR, dir).split(sep).filter(Boolean).map((s) => (s.startsWith("[") ? "abc123" : s));
        routes.push("/" + segments.join("/"));
      }
    }
  };
  walk(APP_DIR);
  return routes.sort();
}

/** Destino que debe quedar activo según el primer segmento. `null` = ningún destino principal (decisión explícita, no omisión). */
const EXPECTED_BY_FIRST_SEGMENT: Record<string, string | null> = {
  inicio: "/inicio",
  alumnos: "/alumnos",
  calendario: "/calendario",
  cobros: "/cobros",
  registro: "/registro",
  configuracion: null, // vive en el menú de cuenta
  recordatorios: null, // se llega desde Inicio
  "resumen-financiero": null, // se llega desde Cobros
};

test("navegación principal: exactamente Inicio, Alumnos, Calendario, Cobros y Registro, en ese orden (Configuración fuera)", () => {
  assert.deepEqual(
    PRIMARY_NAV_ITEMS.map((item) => [item.label, item.href]),
    [
      ["Inicio", "/inicio"],
      ["Alumnos", "/alumnos"],
      ["Calendario", "/calendario"],
      ["Cobros", "/cobros"],
      ["Registro", "/registro"],
    ],
  );
  assert.ok(!PRIMARY_NAV_ITEMS.some((item) => /configuraci/i.test(item.label + item.href)), "Configuración no es un destino principal");
  assert.equal(new Set(PRIMARY_NAV_ITEMS.map((item) => item.icon)).size, 5, "cada destino tiene su propio ícono");
});

test("TODAS las rutas y subrutas privadas reales activan el destino correcto (o ninguno, por decisión explícita)", () => {
  const routes = privateRoutes();
  assert.ok(routes.length >= 15, `se descubrieron las rutas reales (${routes.length})`);
  for (const route of routes) {
    const first = route.split("/")[1];
    assert.ok(first in EXPECTED_BY_FIRST_SEGMENT, `ruta nueva sin decisión de navegación: ${route} (agregarla a EXPECTED_BY_FIRST_SEGMENT)`);
    assert.equal(activePrimaryNavHref(route), EXPECTED_BY_FIRST_SEGMENT[first], `destino activo para ${route}`);
  }
});

test("Registro queda activo en TODAS sus subrutas y en ninguna otra", () => {
  for (const path of ["/registro", "/registro/", "/registro/nuevo", "/registro/libre/abc", "/registro/xyz-123", "/registro/nuevo?x=1", "/registro/nuevo#a"]) {
    assert.equal(isPrimaryNavActive(path, "/registro"), true, path);
  }
  assert.equal(PRIMARY_NAV_ITEMS.filter((item) => isPrimaryNavActive("/registro/nuevo", item.href)).length, 1, "un solo destino activo a la vez");
});

test("sin falsos positivos: sólo segmentos completos, nunca prefijos de texto", () => {
  const nearMisses: Array<[string, string]> = [
    ["/registros", "/registro"],
    ["/registro-x", "/registro"],
    ["/calendarioX", "/calendario"],
    ["/calendario2/series", "/calendario"],
    ["/alumnos-viejos", "/alumnos"],
    ["/cobro", "/cobros"],
    ["/cobros2", "/cobros"],
    ["/inicio2", "/inicio"],
    ["/iniciox/uno", "/inicio"],
    ["/", "/inicio"],
    ["", "/inicio"],
  ];
  for (const [path, href] of nearMisses) assert.equal(isPrimaryNavActive(path, href), false, `${path} no activa ${href}`);
  assert.equal(isPrimaryNavActive(null, "/inicio"), false);
  assert.equal(isPrimaryNavActive(undefined, "/inicio"), false);
  // Rutas hermanas fuera de los cinco destinos no activan ninguno.
  for (const path of ["/configuracion", "/configuracion/respaldo", "/recordatorios", "/resumen-financiero", "/login"]) {
    assert.equal(activePrimaryNavHref(path), null, path);
  }
});

test("identidad de cuenta: nombre + correo, inicial del nombre", () => {
  assert.deepEqual(resolveAccountIdentity({ displayName: "  María   Pérez ", email: "maria@example.com" }), {
    primary: "María Pérez",
    secondary: "maria@example.com",
    initial: "M",
  });
  assert.equal(resolveAccountIdentity({ displayName: "álvaro", email: "a@x.com" }).initial, "Á", "la inicial respeta acentos");
});

test("fallback de cuenta: si el nombre falta o falló, se muestra el correo (sin repetirlo) y el shell no se rompe", () => {
  for (const displayName of [null, undefined, "", "   "]) {
    assert.deepEqual(resolveAccountIdentity({ displayName, email: "profe@example.com" }), {
      primary: "profe@example.com",
      secondary: null,
      initial: "P",
    });
  }
  // Ni nombre ni correo: texto neutro, nunca vacío ni excepción.
  assert.deepEqual(resolveAccountIdentity({}), { primary: FALLBACK_ACCOUNT_LABEL, secondary: null, initial: FALLBACK_ACCOUNT_INITIAL });
  assert.deepEqual(resolveAccountIdentity({ displayName: null, email: null }), { primary: FALLBACK_ACCOUNT_LABEL, secondary: null, initial: FALLBACK_ACCOUNT_INITIAL });
  // Nombre sin correo: se muestra el nombre solo.
  assert.deepEqual(resolveAccountIdentity({ displayName: "Ana", email: null }), { primary: "Ana", secondary: null, initial: "A" });
  // Nombre sin letras ni números: la inicial cae al valor neutro.
  assert.equal(resolveAccountIdentity({ displayName: "—", email: null }).initial, FALLBACK_ACCOUNT_INITIAL);
});

test("teclado del menú: flechas circulares, Inicio/Fin, Escape devuelve el foco, Tab cierra sin forzar foco", () => {
  assert.deepEqual(menuKeyAction("ArrowDown", -1, 2), { kind: "focus", index: 0 });
  assert.deepEqual(menuKeyAction("ArrowDown", 0, 2), { kind: "focus", index: 1 });
  assert.deepEqual(menuKeyAction("ArrowDown", 1, 2), { kind: "focus", index: 0 }, "da la vuelta");
  assert.deepEqual(menuKeyAction("ArrowUp", -1, 2), { kind: "focus", index: 1 });
  assert.deepEqual(menuKeyAction("ArrowUp", 0, 2), { kind: "focus", index: 1 }, "da la vuelta");
  assert.deepEqual(menuKeyAction("ArrowUp", 1, 2), { kind: "focus", index: 0 });
  assert.deepEqual(menuKeyAction("Home", 1, 2), { kind: "focus", index: 0 });
  assert.deepEqual(menuKeyAction("End", 0, 2), { kind: "focus", index: 1 });
  assert.deepEqual(menuKeyAction("Escape", 1, 2), { kind: "close", restoreFocus: true });
  assert.deepEqual(menuKeyAction("Tab", 0, 2), { kind: "close", restoreFocus: false });
  assert.deepEqual(menuKeyAction("a", 0, 2), { kind: "none" });
  assert.deepEqual(menuKeyAction("Enter", 0, 2), { kind: "none" }, "Enter lo resuelve el propio elemento (enlace/botón)");
  assert.deepEqual(menuKeyAction("Escape", -1, 0), { kind: "close", restoreFocus: true }, "Escape cierra aunque no haya elementos");
  assert.deepEqual(menuKeyAction("ArrowDown", -1, 0), { kind: "none" }, "sin elementos no hay foco que mover");
});

test("teclado del botón de cuenta: ↓ abre y enfoca el primero, ↑ el último; otras teclas no (Enter/Espacio son el clic nativo)", () => {
  assert.deepEqual(triggerKeyAction("ArrowDown"), { open: true, focus: "first" });
  assert.deepEqual(triggerKeyAction("ArrowUp"), { open: true, focus: "last" });
  for (const key of ["Enter", " ", "Escape", "Tab", "a"]) assert.equal(triggerKeyAction(key), null, key);
});
