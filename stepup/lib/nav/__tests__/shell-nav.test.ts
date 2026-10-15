import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { PRIMARY_NAV_ITEMS, activePrimaryNavHref, isPrimaryNavActive } from "../primary-nav-items.ts";

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
  configuracion: null, // acceso directo abajo a la izquierda de la barra lateral (en móvil, en el encabezado)
  facturacion: null, // acceso directo en la barra lateral (sólo con la facturación encendida)
  recordatorios: null, // se llega desde Inicio
  "resumen-financiero": "/cobros", // pertenece a Cobros: mantiene activa la sección (entrada secundaria, no un sexto destino)
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
  for (const path of ["/configuracion", "/configuracion/respaldo", "/recordatorios", "/login"]) {
    assert.equal(activePrimaryNavHref(path), null, path);
  }
});
