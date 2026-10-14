import PrivateLink from "@/components/nav/private-link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { linkClass } from "@/components/ui/button";
import type { ReactNode } from "react";

// Encabezado de página del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §8): título en serifa, «Volver» como
// enlace de texto (nunca un botón que compita con la acción principal) y la acción principal a la derecha.

/** Ancho de contenido: lista (ancha), ficha (media) y formulario (angosto). */
export const PAGE_WIDTH = {
  wide: "mx-auto w-full max-w-[1180px] px-4 py-5 nav:px-10 nav:py-[30px]",
  medium: "mx-auto w-full max-w-[960px] px-4 py-5 nav:px-10 nav:py-[30px]",
  narrow: "mx-auto w-full max-w-[760px] px-4 py-5 nav:px-10 nav:py-[30px]",
} as const;

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
    <PrivateLink href={href} className={linkClass()}>
      <ArrowLeftIcon className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </PrivateLink>
  );
}

/** Título + texto de apoyo + acción principal. En móvil la acción baja debajo del título si no entra. */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <PageTitle>{title}</PageTitle>
        {subtitle && <p className="mt-1.5 text-[15px] text-textMuted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
