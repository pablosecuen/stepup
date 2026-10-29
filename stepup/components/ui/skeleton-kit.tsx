import type { ReactNode } from "react";
import { PAGE_TITLE_CLASS, PAGE_WIDTH } from "@/components/ui/page-header";
import { buttonClass, type ButtonVariant } from "@/components/ui/button";
import { SkeletonWatchdog } from "@/components/ui/skeleton-watchdog";

/**
 * Primitivas de los esqueletos de carga (29/10/2026). Todo esqueleto se arma con estas piezas y con las superficies compartidas
 * (`surfaces.ts`, `page-header.tsx`), nunca con clases sueltas: así contenido y esqueleto no se desajustan cuando cambia el diseño.
 * Regla de oro: lo que NO depende de datos (el título de la pantalla, el nombre de su acción principal) se dibuja REAL —mismo texto,
 * mismo tamaño— para que el encabezado no parpadee al llegar el contenido; sólo lo que depende de datos es una barra gris.
 * Sin brillo ni animación permanente: el esqueleto aparece al instante y el contenido real lo reemplaza con la entrada común.
 */
export type SkeletonWidth = keyof typeof PAGE_WIDTH;

const BAR = "bg-paperDeep";

/** Barra o bloque de texto/campo (sus dimensiones van en `className`). */
export function SkBar({ className = "" }: { className?: string }) {
  return <div className={`rounded-md ${BAR} ${className}`} />;
}

export function SkRound({ className = "" }: { className?: string }) {
  return <div className={`shrink-0 rounded-full ${BAR} ${className}`} />;
}

export function SkPill({ className = "" }: { className?: string }) {
  return <div className={`rounded-pill ${BAR} ${className}`} />;
}

/** Línea de texto de `lineHeight` px con una barra más baja dentro: ocupa el mismo alto que la línea real. */
export function SkLine({ lineHeight, width, className = "" }: { lineHeight: number; width: string; className?: string }) {
  return (
    <div style={{ height: lineHeight }} className={`flex items-center ${className}`}>
      <div className={`h-[0.72em] rounded ${BAR} ${width}`} style={{ fontSize: lineHeight }} />
    </div>
  );
}

/** La acción principal de una pantalla con su texto REAL (aspecto de botón, no interactivo). */
export function SkAction({ label, variant = "primary", icon, className = "" }: { label: string; variant?: ButtonVariant; icon?: ReactNode; className?: string }) {
  return (
    <span aria-hidden className={`${buttonClass({ variant })} ${className}`}>
      {icon}
      {label}
    </span>
  );
}

/**
 * Encabezado de página: el MISMO contenedor, título y alturas que `PageHeader`, con el título real. `subtitle` dibuja la barra del apoyo
 * (22 px, la línea real de 15 px); `action` es la acción principal real (`SkAction`) o una barra.
 */
export function SkHeader({ title, subtitle = true, action }: { title: string; subtitle?: boolean; action?: ReactNode }) {
  return (
    <div data-tf-header="" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className={PAGE_TITLE_CLASS}>{title}</p>
        {subtitle && (
          <div className="mt-1.5 flex h-[22px] items-center">
            <SkBar className="h-4 w-64 max-w-full" />
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Marco de un esqueleto de pantalla: región ocupada y con nombre (UN solo aviso de carga para lectores de pantalla, no uno por bloque),
 * contenedor de página idéntico al real (`PAGE_WIDTH`) y todo el dibujo decorativo fuera del árbol de accesibilidad. `data-tf-skeleton`
 * lo excluye de la entrada suave: el esqueleto aparece al instante y es el CONTENIDO el que entra. `optimistic` marca el que se dibuja al
 * hacer clic (antes de que llegue nada del servidor): el aviso lo da `NavigationProgress`, así no se anuncia dos veces.
 */
export function ScreenFrame({ label, width = "wide", optimistic = false, retryHref, className, innerClassName, children }: { label: string; width?: SkeletonWidth; optimistic?: boolean; retryHref?: string; className?: string; innerClassName?: string; children: ReactNode }) {
  const drawing = (
    <div aria-hidden className={innerClassName}>
      {children}
    </div>
  );
  if (optimistic) {
    return (
      <div data-tf-skeleton="" data-tf-pending-skeleton="" className={className ?? PAGE_WIDTH[width]}>
        {drawing}
        <SkeletonWatchdog retryHref={retryHref} />
      </div>
    );
  }
  return (
    <div data-tf-skeleton="" role="status" aria-busy="true" aria-live="polite" aria-labelledby="carga-titulo" className={className ?? PAGE_WIDTH[width]}>
      <span id="carga-titulo" className="sr-only">
        {label}
      </span>
      {drawing}
      <SkeletonWatchdog retryHref={retryHref} />
    </div>
  );
}
