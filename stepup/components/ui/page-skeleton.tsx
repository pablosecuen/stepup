import { PAGE_WIDTH } from "@/components/ui/page-header";

/**
 * Esqueleto de carga de una pantalla privada (lo usan los `loading.tsx` de cada sección). Se muestra DENTRO del shell
 * (la navegación queda en pantalla) mientras el servidor prepara la página. Accesible: `role="status"` + `aria-busy`, con el
 * nombre de la sección como nombre accesible de la región (`aria-labelledby`, texto sólo para lectores de pantalla): ni se ve ni
 * añade un segundo título (no es un encabezado) mientras el HTML en streaming trae también el contenido real.
 *
 * Geometría: cada variante usa el MISMO contenedor (`PAGE_WIDTH`) y las mismas alturas de título, barra de herramientas, filas y paneles
 * que la pantalla final, así que cuando llega el contenido no hay saltos de diseño. No hay brillo ni animación permanente: el esqueleto
 * aparece al instante (`data-tf-skeleton` lo excluye de la entrada de página) y el contenido real entra después con la transición común.
 */
export type SkeletonVariant = "list" | "calendar" | "finance" | "profile" | "form" | "settings" | "detail";

const WIDTH: Record<SkeletonVariant, keyof typeof PAGE_WIDTH> = { list: "wide", calendar: "wide", finance: "wide", profile: "medium", form: "narrow", settings: "wide", detail: "medium" };

const BLOCK = "rounded-md bg-paperDeep";
const PANEL = "rounded-xl border-[1.5px] border-border bg-surface shadow-card";

/** Encabezado: título de 34 px (44 en escritorio) con su interlínea, apoyo y la acción principal a la derecha. */
function HeaderBlock({ action = true, subtitle = true }: { action?: boolean; subtitle?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className={`h-[36px] w-56 max-w-full nav:h-[47px] nav:w-72 ${BLOCK}`} />
        {subtitle && <div className={`mt-2.5 h-[18px] w-72 max-w-full ${BLOCK} opacity-80`} />}
      </div>
      {action && <div className={`h-11 w-full nav:w-40 ${BLOCK}`} />}
    </div>
  );
}

function Rows({ count, height = 72 }: { count: number; height?: number }) {
  return (
    <div className={`${PANEL} overflow-hidden`}>
      {new Array(count).fill(0).map((_, i) => (
        <div key={i} style={{ height }} className="flex items-center gap-3 border-b border-border px-4 last:border-b-0">
          <div className="h-10 w-10 shrink-0 rounded-full bg-paperDeep" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-48 max-w-full rounded bg-paperDeep" />
            <div className="mt-2 h-3 w-32 max-w-full rounded bg-paperDeep opacity-80" />
          </div>
          <div className="hidden h-6 w-20 rounded-pill bg-paperDeep nav:block" />
        </div>
      ))}
    </div>
  );
}

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case "list":
      return (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <div className={`h-11 min-w-0 flex-1 basis-60 ${BLOCK}`} />
            <div className={`h-11 w-36 ${BLOCK}`} />
            <div className={`hidden h-11 w-36 nav:block ${BLOCK}`} />
          </div>
          <div className="mt-4">
            <Rows count={7} />
          </div>
        </>
      );
    case "calendar":
      return (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className={`h-11 w-44 ${BLOCK}`} />
            <div className={`h-11 w-48 ${BLOCK}`} />
            <div className={`h-11 w-full nav:w-36 ${BLOCK}`} />
          </div>
          <div className={`${PANEL} mt-3 h-[480px] nav:mt-2 nav:h-[calc(100vh-232px)] nav:min-h-[440px]`} />
        </>
      );
    case "finance":
      return (
        <>
          <div className="mt-5 flex gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="min-w-0 flex-1">
                <div className={`h-[34px] w-24 max-w-full ${BLOCK}`} />
                <div className={`mt-2 h-3.5 w-28 max-w-full ${BLOCK} opacity-80`} />
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 nav:grid-cols-2">
            <div className={`${PANEL} h-[300px]`} />
            <div className={`${PANEL} h-[300px]`} />
          </div>
          <div className="mt-5">
            <Rows count={4} />
          </div>
        </>
      );
    case "profile":
      return (
        <>
          <div className="mt-5 flex items-center gap-4">
            <div className="h-14 w-14 shrink-0 rounded-full bg-paperDeep nav:h-24 nav:w-24" />
            <div className="min-w-0 flex-1">
              <div className={`h-[36px] w-60 max-w-full ${BLOCK}`} />
              <div className={`mt-2.5 h-[18px] w-44 max-w-full ${BLOCK} opacity-80`} />
            </div>
          </div>
          <div className="mt-6 flex gap-2 overflow-hidden">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-11 w-24 shrink-0 ${BLOCK}`} />
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-5">
            <div className={`${PANEL} h-40`} />
            <div className={`${PANEL} h-56`} />
          </div>
        </>
      );
    case "form":
      return (
        <div className={`${PANEL} mt-6 p-5`}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={i === 0 ? "" : "mt-5"}>
              <div className={`h-4 w-32 ${BLOCK}`} />
              <div className={`mt-2 h-11 w-full ${BLOCK} opacity-80`} />
            </div>
          ))}
          <div className={`mt-6 h-12 w-full nav:w-44 ${BLOCK}`} />
        </div>
      );
    case "settings":
      return (
        <div className="mt-6 flex flex-col gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${PANEL} h-36`} />
          ))}
        </div>
      );
    default:
      return (
        <div className="mt-6 flex flex-col gap-5">
          <div className={`${PANEL} h-32`} />
          <div className={`${PANEL} h-48`} />
          <div className={`${PANEL} h-32`} />
        </div>
      );
  }
}

export function PageSkeleton({ label, variant = "list" }: { label: string; variant?: SkeletonVariant }) {
  return (
    <div data-tf-skeleton="" role="status" aria-busy="true" aria-live="polite" aria-labelledby="carga-titulo" className={PAGE_WIDTH[WIDTH[variant]]}>
      <span id="carga-titulo" className="sr-only">
        {label}
      </span>
      <div aria-hidden>
        <HeaderBlock action={variant !== "settings" && variant !== "profile"} subtitle={variant !== "calendar"} />
        <Body variant={variant} />
      </div>
    </div>
  );
}
