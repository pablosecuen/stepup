/**
 * Destinos de la navegación principal del área privada (escritorio y móvil: los MISMOS cinco).
 * Configuración NO es un destino principal: vive en el menú de cuenta (ver `account-menu.tsx`).
 * Recordatorios no tiene destino propio (se llega desde Inicio). Resumen financiero PERTENECE a Cobros: no es un sexto destino,
 * es una entrada secundaria de Cobros (`secondary`) y mantiene activa a Cobros (`related`).
 */
export type PrimaryNavIconKey = "home" | "students" | "calendar" | "payments" | "registry";

export interface SecondaryNavItem {
  href: string;
  label: string;
}

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon: PrimaryNavIconKey;
  /** Otras rutas de la MISMA sección: mientras se está en ellas este destino sigue siendo el activo. */
  related?: readonly string[];
  /** Entradas secundarias (barra lateral de escritorio): nunca un destino principal más. */
  secondary?: readonly SecondaryNavItem[];
}

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { href: "/inicio", label: "Inicio", icon: "home" },
  { href: "/alumnos", label: "Alumnos", icon: "students" },
  { href: "/calendario", label: "Calendario", icon: "calendar" },
  { href: "/cobros", label: "Cobros", icon: "payments", related: ["/resumen-financiero"], secondary: [{ href: "/resumen-financiero", label: "Resumen financiero" }] },
  { href: "/registro", label: "Registro", icon: "registry" },
];

/** Quita la query/hash y las barras finales: `/registro/` y `/registro?x=1` cuentan como `/registro`. */
function normalizePathname(pathname: string): string {
  const withoutSuffix = pathname.split(/[?#]/)[0];
  const trimmed = withoutSuffix.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Activo por segmento completo: la ruta del destino o cualquiera de sus subrutas (`/registro/nuevo`,
 * `/alumnos/123/editar`). Nunca por prefijo de texto: `/calendarioX` o `/registros` NO activan `/calendario`/`/registro`.
 */
export function isPrimaryNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  const path = normalizePathname(pathname);
  return path === href || path.startsWith(`${href}/`);
}

/** ¿La ruta pertenece a la sección de este destino (su ruta, sus subrutas o una ruta relacionada)? */
export function isPrimarySectionActive(pathname: string | null | undefined, item: PrimaryNavItem): boolean {
  return isPrimaryNavActive(pathname, item.href) || (item.related ?? []).some((related) => isPrimaryNavActive(pathname, related));
}

/** Destino activo para una ruta, o `null` si ninguno corresponde (Configuración, Recordatorios…). */
export function activePrimaryNavHref(pathname: string | null | undefined): string | null {
  return PRIMARY_NAV_ITEMS.find((item) => isPrimarySectionActive(pathname, item))?.href ?? null;
}
