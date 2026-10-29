import PrivateLink from "@/components/nav/private-link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { linkClass } from "@/components/ui/button";
import type { ReactNode } from "react";

// Encabezado de página del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §8): título en serifa, «Volver» como
// enlace de texto (nunca un botón que compita con la acción principal) y la acción principal a la derecha.

/**
 * Contenedores de página del área privada — LA primitiva compartida (nunca se repiten estas clases pantalla por pantalla):
 *  - `wide` (1180 px): pantallas de listas y paneles que usan el ancho útil del shell (Inicio, Calendario, Alumnos, Cobros,
 *    Resumen financiero, Disponibilidad, Configuración, Series, Registro, Recordatorios);
 *  - `medium` (960 px): fichas con lectura continua (perfil de un alumno, formulario de registro de una clase, Facturación);
 *  - `narrow` (760 px): formularios breves y confirmaciones (nuevo alumno, nueva clase, nuevo registro), que no se estiran.
 * Arriba hay poco relleno en escritorio porque la fila superior del shell («Cerrar sesión») ya separa el contenido del borde.
 */
export const PAGE_WIDTH = {
  wide: "tf-screen mx-auto w-full max-w-[1180px] px-4 py-5 nav:px-10 nav:pb-[30px] nav:pt-2",
  medium: "tf-screen mx-auto w-full max-w-[960px] px-4 py-5 nav:px-10 nav:pb-[30px] nav:pt-2",
  narrow: "tf-screen mx-auto w-full max-w-[760px] px-4 py-5 nav:px-10 nav:pb-[30px] nav:pt-2",
} as const;

/**
 * Ancho de lectura de una lista de filas o tarjetas (Recordatorios, Clases por registrar): sin tope, en un escritorio de 1366 px cada fila
 * se estira ~1.100 px y el dato queda lejos de su acción. En móvil no limita nada (la pantalla ya es más angosta); a la grilla de dos
 * columnas de Recordatorios cada sección le queda por debajo de este máximo.
 */
export const READING_WIDTH = "w-full max-w-[720px]";

export const PAGE_TITLE_CLASS =
  "font-display text-[34px] font-medium leading-[1.06] tracking-[-0.03em] text-textPrimary [overflow-wrap:anywhere] max-[360px]:text-[30px] nav:text-[44px]";

/** Título reducido para pantallas donde el alto es escaso (Calendario): la misma serifa, sin el cuerpo de 44 px. */
export const PAGE_TITLE_COMPACT_CLASS =
  "font-display text-[28px] font-medium leading-[1.1] tracking-[-0.03em] text-textPrimary [overflow-wrap:anywhere] nav:text-[30px]";

export function PageTitle({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <h1 className={compact ? PAGE_TITLE_COMPACT_CLASS : PAGE_TITLE_CLASS}>{children}</h1>;
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <PrivateLink href={href} className={linkClass()} data-tf-static="">
      <ArrowLeftIcon className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </PrivateLink>
  );
}

/**
 * Título + texto de apoyo + acción principal. En móvil la acción baja debajo del título si no entra. `data-tf-header`: el esqueleto de carga
 * dibuja el mismo título y la misma acción REALES (`SkHeader`), así que el encabezado no se anima al llegar el contenido (no parpadea).
 */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div data-tf-header="" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <PageTitle>{title}</PageTitle>
        {subtitle && <p className="mt-1.5 text-[15px] text-textMuted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
