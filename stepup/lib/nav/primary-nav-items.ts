/**
 * Destinos de la navegación principal del área privada (escritorio y móvil: los MISMOS cinco).
 * Configuración NO es un destino principal: vive en el menú de cuenta (ver `account-menu.tsx`).
 * Recordatorios y Resumen financiero no tienen destino propio: se llegan desde Inicio y Cobros, como hasta ahora.
 */
export type PrimaryNavIconKey = "home" | "students" | "calendar" | "payments" | "registry";

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon: PrimaryNavIconKey;
}

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { href: "/inicio", label: "Inicio", icon: "home" },
  { href: "/alumnos", label: "Alumnos", icon: "students" },
  { href: "/calendario", label: "Calendario", icon: "calendar" },
  { href: "/cobros", label: "Cobros", icon: "payments" },
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

/** Destino activo para una ruta, o `null` si ninguno corresponde (Configuración, Recordatorios, Resumen financiero…). */
export function activePrimaryNavHref(pathname: string | null | undefined): string | null {
  return PRIMARY_NAV_ITEMS.find((item) => isPrimaryNavActive(pathname, item.href))?.href ?? null;
}
