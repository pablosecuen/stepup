import { test } from "node:test";
import assert from "node:assert/strict";
import { allScreenLabels, isScreenChange, pathnameOf, resolveScreen } from "../screens.ts";
import { activePendingNavigation, clearPendingNavigation, getPendingNavigation, setPendingNavigation, subscribePendingNavigation } from "../pending-destination.ts";

/** Registro único de pantallas (esqueletos de carga) y destino pendiente de la navegación: lógica pura. */

test("cada ruta privada resuelve a SU pantalla (las específicas antes que sus prefijos) y lo desconocido a nada", () => {
  const table: Array<[string, string]> = [
    ["/inicio", "inicio"],
    ["/alumnos", "alumnos"],
    ["/alumnos/nuevo", "alumno-form"],
    ["/alumnos/6f1c0a3e-1111-2222-3333-444455556666", "alumno"],
    ["/alumnos/6f1c0a3e-1111-2222-3333-444455556666/editar", "alumno-form"],
    ["/calendario", "calendario"],
    ["/calendario/series", "series"],
    ["/calendario/series/abc", "serie"],
    ["/calendario/disponibilidad", "disponibilidad"],
    ["/calendario/informacion", "calendario-info"],
    ["/calendario/nueva", "clase-form"],
    ["/cobros", "cobros"],
    ["/resumen-financiero", "resumen"],
    ["/resumen-financiero/comportamiento-de-pago", "comportamiento"],
    ["/registro", "registro"],
    ["/registro/nuevo", "registro-form"],
    ["/registro/abc", "registro-detalle"],
    ["/registro/libre/abc", "registro-detalle"],
    ["/recordatorios", "recordatorios"],
    ["/configuracion", "configuracion"],
    ["/configuracion/respaldo", "config-sub"],
    ["/configuracion/consistencia", "config-sub"],
    ["/configuracion/datos-de-prueba", "config-sub"],
    ["/configuracion/tutorial", "config-sub"],
    ["/facturacion", "facturacion"],
    ["/facturacion/planes", "facturacion-sub"],
    ["/facturacion/condiciones", "facturacion-sub"],
    ["/facturacion/resultado", "facturacion-sub"],
  ];
  for (const [path, key] of table) assert.equal(resolveScreen(path)?.key, key, path);
  assert.equal(resolveScreen("/login"), null);
  assert.equal(resolveScreen("/alumnos/a/b/c"), null);
  assert.equal(resolveScreen(null), null);
  assert.deepEqual(resolveScreen("/alumnos/"), resolveScreen("/alumnos"), "la barra final no cambia la pantalla");
});

test("las etiquetas accesibles de carga son únicas y todas dicen «Cargando …»; los títulos reales sólo existen si no dependen de datos", () => {
  const labels = allScreenLabels();
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => /^Cargando .+…$/.test(label)));
  assert.equal(resolveScreen("/alumnos")?.title, "Alumnos");
  assert.equal(resolveScreen("/resumen-financiero")?.title, "Resumen financiero");
  assert.equal(resolveScreen("/alumnos/abc")?.title, null, "el nombre del alumno lo trae el contenido");
  assert.equal(resolveScreen("/inicio")?.title, null, "el saludo de Inicio depende de la hora y del nombre");
});

test("el contenedor del esqueleto es el de la pantalla final: ancho por ruta", () => {
  const widths: Array<[string, string]> = [
    ["/alumnos", "wide"],
    ["/alumnos/abc", "medium"],
    ["/alumnos/nuevo", "narrow"],
    ["/registro/abc", "medium"],
    ["/facturacion", "medium"],
    ["/facturacion/resultado", "narrow"],
    ["/configuracion/respaldo", "wide"],
    ["/configuracion/tutorial", "medium"],
  ];
  for (const [path, width] of widths) assert.equal(resolveScreen(path)?.width, width, path);
});

test("cambiar de PANTALLA (otra ruta) muestra esqueleto de página; cambiar sólo parámetros (pestaña, filtro, semana, página) no", () => {
  assert.equal(pathnameOf("/alumnos?q=ana#x"), "/alumnos");
  assert.equal(isScreenChange("/alumnos", "/cobros"), true);
  assert.equal(isScreenChange("/alumnos", "/alumnos/abc"), true);
  assert.equal(isScreenChange("/alumnos", "/alumnos?q=ana&page=2"), false, "buscar y paginar actualizan la lista en su lugar");
  assert.equal(isScreenChange("/alumnos/abc", "/alumnos/abc?tab=cobros"), false, "las pestañas del perfil cargan su propio cuerpo");
  assert.equal(isScreenChange("/calendario", "/calendario?view=day&day=2026-10-29"), false, "el Calendario conserva su geometría y posición");
});

test("destino pendiente: se publica, avisa a quien lo mira y deja de aplicar al instante en que cambia la ruta", () => {
  clearPendingNavigation();
  let notified = 0;
  const unsubscribe = subscribePendingNavigation(() => {
    notified += 1;
  });
  assert.equal(getPendingNavigation(), null);
  setPendingNavigation({ destination: "/cobros", fromPath: "/alumnos" });
  assert.deepEqual(getPendingNavigation(), { destination: "/cobros", fromPath: "/alumnos" });
  assert.equal(notified, 1);
  setPendingNavigation({ destination: "/cobros", fromPath: "/alumnos" });
  assert.equal(notified, 1, "el mismo valor no vuelve a avisar");
  assert.equal(activePendingNavigation(getPendingNavigation(), "/alumnos")?.destination, "/cobros", "mientras la ruta sea la de origen, aplica");
  assert.equal(activePendingNavigation(getPendingNavigation(), "/cobros"), null, "llegó al destino: el esqueleto optimista no se ve junto a la pantalla real");
  // Ráfaga de clics: llega la pantalla de un destino ANTERIOR (otra ruta que no es la última pulsada): el esqueleto del último destino sigue a la vista
  assert.equal(activePendingNavigation(getPendingNavigation(), "/calendario")?.destination, "/cobros", "pantalla intermedia: no reemplaza al esqueleto del último destino");
  assert.equal(activePendingNavigation(null, "/alumnos"), null);
  clearPendingNavigation();
  assert.equal(getPendingNavigation(), null);
  assert.equal(notified, 2);
  clearPendingNavigation();
  assert.equal(notified, 2, "limpiar lo ya limpio no avisa");
  unsubscribe();
  setPendingNavigation({ destination: "/registro", fromPath: "/inicio" });
  assert.equal(notified, 2, "sin suscripción no llega nada");
  clearPendingNavigation();
});
