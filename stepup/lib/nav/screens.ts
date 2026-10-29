/**
 * Registro ÚNICO de las pantallas del área privada para la carga (29/10/2026). Lo usan por igual:
 *  - cada `loading.tsx` (esqueleto mientras el servidor prepara la pantalla), y
 *  - el esqueleto optimista del clic (`components/nav/screen-slot.tsx`): apenas se pulsa un enlace se dibuja el esqueleto del DESTINO,
 *    sin esperar al servidor, así que nunca queda la pantalla anterior congelada.
 * Como ambos salen de la misma entrada, el relevo entre uno y otro no se ve. Puro (sin React): lo cubren pruebas.
 */
export type ScreenKey =
  | "inicio"
  | "alumnos"
  | "alumno"
  | "alumno-form"
  | "calendario"
  | "series"
  | "serie"
  | "disponibilidad"
  | "calendario-info"
  | "clase-form"
  | "cobros"
  | "resumen"
  | "comportamiento"
  | "registro"
  | "registro-form"
  | "registro-detalle"
  | "recordatorios"
  | "configuracion"
  | "config-sub"
  | "facturacion"
  | "facturacion-sub";

type ScreenWidth = "wide" | "medium" | "narrow";

interface ScreenDefinition {
  readonly key: ScreenKey;
  /** Nombre accesible de la región de carga («Cargando …»): único por pantalla. */
  readonly label: string;
  /** El título REAL de la pantalla cuando no depende de datos (se dibuja idéntico en el esqueleto); `null` si lo trae el contenido (nombre del alumno…). */
  readonly title: string | null;
  /** El mismo contenedor de página (`PAGE_WIDTH`) que usa la pantalla final. */
  readonly width: ScreenWidth;
  /** El «Volver a …» real de la pantalla (texto fijo); «?» si hay enlace pero su texto depende de desde dónde se llegó; `null` si no hay. */
  readonly back: string | null;
  readonly pattern: RegExp;
}

const def = (key: ScreenKey, label: string, title: string | null, width: ScreenWidth, pattern: RegExp, back: string | null = null): ScreenDefinition => ({ key, label, title, width, pattern, back });

/** El orden importa: las rutas más específicas van antes que sus prefijos. */
const DEFINITIONS: readonly ScreenDefinition[] = [
  def("inicio", "Cargando Inicio…", null, "wide", /^\/inicio$/),
  def("alumno-form", "Cargando el formulario de alumno…", "Nuevo alumno", "narrow", /^\/alumnos\/nuevo$/, "Volver a Alumnos"),
  def("alumno-form", "Cargando la edición del alumno…", null, "narrow", /^\/alumnos\/[^\/]+\/editar$/, "Volver a la ficha"),
  def("alumno", "Cargando el perfil del alumno…", null, "medium", /^\/alumnos\/[^\/]+$/, "Volver a Alumnos"),
  def("alumnos", "Cargando alumnos…", "Alumnos", "wide", /^\/alumnos$/),
  def("series", "Cargando las series…", "Series", "wide", /^\/calendario\/series$/, "Volver al Calendario"),
  def("serie", "Cargando la serie…", "Serie", "wide", /^\/calendario\/series\/[^\/]+$/, "Volver al Calendario"),
  def("disponibilidad", "Cargando la disponibilidad…", "Disponibilidad", "wide", /^\/calendario\/disponibilidad$/),
  def("calendario-info", "Cargando la información del calendario…", "Información", "medium", /^\/calendario\/informacion$/, "Volver al Calendario"),
  def("clase-form", "Cargando el formulario de clase…", "Nueva clase", "narrow", /^\/calendario\/nueva$/, "Volver al Calendario"),
  def("calendario", "Cargando el calendario…", "Calendario", "wide", /^\/calendario$/),
  def("alumno", "Cargando los cobros del alumno…", null, "medium", /^\/cobros\/alumnos\/[^\/]+$/, "Volver a Cobros"),
  def("cobros", "Cargando cobros…", "Cobros", "wide", /^\/cobros$/),
  def("comportamiento", "Cargando el comportamiento de pago…", "Comportamiento de pago", "wide", /^\/resumen-financiero\/comportamiento-de-pago$/, "Volver al Resumen financiero"),
  def("resumen", "Cargando el resumen financiero…", "Resumen financiero", "wide", /^\/resumen-financiero$/),
  def("registro-form", "Cargando el formulario de registro…", "Clase no programada", "narrow", /^\/registro\/nuevo$/, "Volver a Clases por registrar"),
  def("registro-detalle", "Cargando el registro de la clase…", null, "medium", /^\/registro\/[^\/]+$/, "?"),
  def("registro-detalle", "Cargando el registro…", null, "medium", /^\/registro\/libre\/[^\/]+$/, "?"),
  def("registro", "Cargando registro de clases…", "Clases por registrar", "wide", /^\/registro$/),
  def("recordatorios", "Cargando recordatorios…", "Recordatorios", "wide", /^\/recordatorios$/, "Volver a Inicio"),
  def("config-sub", "Cargando la revisión de consistencia…", null, "medium", /^\/configuracion\/consistencia$/, "Volver a Configuración"),
  def("config-sub", "Cargando los datos de prueba…", null, "wide", /^\/configuracion\/datos-de-prueba$/),
  def("config-sub", "Cargando la importación de datos…", null, "wide", /^\/configuracion\/respaldo$/),
  def("config-sub", "Cargando el tutorial…", null, "medium", /^\/configuracion\/tutorial$/),
  def("configuracion", "Cargando configuración…", "Configuración", "wide", /^\/configuracion$/),
  def("facturacion-sub", "Cargando las condiciones…", null, "medium", /^\/facturacion\/condiciones$/, "Facturación"),
  def("facturacion-sub", "Cargando los planes…", null, "medium", /^\/facturacion\/planes$/, "Facturación"),
  def("facturacion-sub", "Cargando el resultado del pago…", null, "narrow", /^\/facturacion\/resultado$/, "Facturación"),
  def("facturacion", "Cargando facturación…", "Facturación", "medium", /^\/facturacion$/),
];

export interface ResolvedScreen {
  readonly key: ScreenKey;
  readonly label: string;
  readonly title: string | null;
  readonly width: ScreenWidth;
  readonly back: string | null;
}

/** La pantalla a la que corresponde una ruta (sin parámetros de búsqueda ni ancla), o `null` si no es una pantalla privada conocida. */
export function resolveScreen(pathname: string | null | undefined): ResolvedScreen | null {
  if (!pathname) return null;
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const found = DEFINITIONS.find((definition) => definition.pattern.test(clean));
  return found ? { key: found.key, label: found.label, title: found.title, width: found.width, back: found.back } : null;
}

/** Todas las etiquetas de carga (para comprobar que no se repiten). */
export function allScreenLabels(): string[] {
  return DEFINITIONS.map((definition) => definition.label);
}

/** El nombre de la ruta de una dirección «/ruta?x=y#z». */
export function pathnameOf(destination: string): string {
  return destination.split("#")[0].split("?")[0];
}

/**
 * ¿Ir de `fromPath` a `toDestination` es cambiar de PANTALLA? Cambiar sólo parámetros de búsqueda (pestañas de un perfil, semana del
 * calendario, filtros, páginas) actualiza la pantalla en su sitio y NO debe taparla con un esqueleto de página entera.
 */
export function isScreenChange(fromPath: string, toDestination: string): boolean {
  return pathnameOf(toDestination) !== fromPath;
}
