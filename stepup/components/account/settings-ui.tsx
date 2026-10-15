import type { ComponentType, ReactNode, SVGProps } from "react";
import { CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { buttonClass, linkClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

// Piezas compartidas de Configuración y sus subpáginas: secciones con título en serifa, filas con jerarquía fija (título →
// descripción → control) y los cuatro estilos de botón (principal, secundario, peligro con contorno, peligro lleno), que son los
// del sistema (`components/ui/button.tsx`). Un solo lugar para el ritmo, los focos y los tamaños (44 px) en todos los apartados.

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Acción principal de un formulario (guardar). */
export const BUTTON_PRIMARY = buttonClass({ variant: "primary" });
/** Acción normal que no guarda datos (pedir un enlace, cancelar). */
export const BUTTON_SECONDARY = buttonClass({ variant: "secondary" });
/** Acción sensible: abre una confirmación, nunca ejecuta de inmediato. */
export const BUTTON_DANGER_OUTLINE = buttonClass({ variant: "dangerOutline" });
/** Confirmación final de una acción sensible. */
export const BUTTON_DANGER = buttonClass({ variant: "danger" });

/** Campo de texto de un formulario de Configuración (borde de control con 3:1 de contraste, 46 px de alto). */
export const FIELD_CLASS = inputClass;

export type SettingsSectionTone = "default" | "danger";

/**
 * Sección de Configuración: un `h2` y, debajo, una tarjeta con sus filas separadas por una línea. `id` es el destino del
 * índice de la página; `scroll-mt-20` evita que el encabezado fijo del móvil tape el título al saltar.
 */
export function SettingsSection({
  id,
  title,
  description,
  tone = "default",
  columns,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  tone?: SettingsSectionTone;
  /** Clases de la grilla de tarjetas (cada hijo es un `SettingsCard`/`SettingsLinkCard`): organiza el contenido en dos o tres columnas cuando entra. Sin esto, una sola tarjeta con filas. */
  columns?: string;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  if (columns) {
    return (
      <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-20">
        <h2 id={`${id}-titulo`} className={`font-display text-section font-semibold ${danger ? "text-bad" : "text-textPrimary"}`}>
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[14.5px] text-textMuted">{description}</p>}
        <div className={`mt-3 grid items-start gap-4 ${columns}`}>{children}</div>
      </section>
    );
  }
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-20">
      <h2 id={`${id}-titulo`} className={`font-display text-section font-semibold ${danger ? "text-bad" : "text-textPrimary"}`}>
        {title}
      </h2>
      {description && <p className="mt-0.5 text-[14.5px] text-textMuted">{description}</p>}
      <div
        className={`mt-3 divide-y overflow-hidden rounded-lg border-[1.5px] bg-surface shadow-card ${
          danger ? "divide-badLine border-badLine" : "divide-border border-border"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/** Tarjeta de una sección en grilla: filas separadas por una línea (mismo aspecto que la tarjeta única de siempre). */
export function SettingsCard({ tone = "default", children }: { tone?: SettingsSectionTone; children: ReactNode }) {
  const danger = tone === "danger";
  return <div className={`min-w-0 divide-y overflow-hidden rounded-lg border-[1.5px] bg-surface shadow-card ${danger ? "divide-badLine border-badLine" : "divide-border border-border"}`}>{children}</div>;
}

/** Tarjeta que es un enlace completo a otra pantalla (toda la tarjeta es el objetivo táctil). */
export function SettingsLinkCard({ href, title, description, icon: Icon }: { href: string; title: string; description: string; icon: IconComponent }) {
  return (
    <PrivateLink
      href={href}
      className="flex min-h-[88px] min-w-0 items-start gap-3 rounded-lg border-[1.5px] border-border bg-surface px-4 py-4 shadow-card transition-colors duration-150 hover:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
    >
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accentSoft text-accentText">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-[650] text-textPrimary">{title}</span>
        <span className="mt-0.5 block text-[14px] text-textMuted">{description}</span>
      </span>
      <ChevronRightIcon className="mt-2 h-5 w-5 shrink-0 text-textMuted" aria-hidden />
    </PrivateLink>
  );
}

/** Fila con jerarquía fija: título (`h3`), descripción opcional y, debajo, el control o el dato. */
export function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <h3 className="text-[15px] font-[650] text-textPrimary">{title}</h3>
      {description && <p className="mt-0.5 text-[14px] text-textMuted">{description}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Fila que es un enlace completo a otra pantalla (todo el renglón es el objetivo táctil). */
export function SettingsLinkRow({ href, title, description, icon: Icon }: { href: string; title: string; description: string; icon?: IconComponent }) {
  return (
    <PrivateLink
      href={href}
      className="flex min-h-14 items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface2 focus:outline-none focus-visible:bg-surface2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink sm:px-5"
    >
      {Icon && (
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-accentSoft text-accentText">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-[650] text-textPrimary">{title}</span>
        <span className="mt-0.5 block text-[14px] text-textMuted">{description}</span>
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-textMuted" aria-hidden />
    </PrivateLink>
  );
}

export interface SettingsIndexItem {
  id: string;
  label: string;
  icon?: IconComponent;
}

/**
 * Índice de la página: enlaces a cada sección. En el móvil es una fila que se desplaza en horizontal; desde `md` queda fija
 * a la izquierda mientras se recorre la página.
 */
export function SettingsIndex({ items }: { items: readonly SettingsIndexItem[] }) {
  return (
    <nav aria-label="Secciones de Configuración" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:sticky md:top-8 md:mx-0 md:self-start md:overflow-visible md:px-0">
      <ul className="flex gap-1.5 md:flex-col md:gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-pill border-[1.5px] border-borderMid bg-surface px-3.5 text-[14.5px] font-[650] text-textPrimary transition-colors duration-150 hover:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink md:w-full md:rounded-md md:border-transparent md:bg-transparent md:px-3 md:text-textSecondary md:hover:bg-surface md:hover:text-ink"
              >
                {Icon && <Icon className="hidden h-[18px] w-[18px] shrink-0 md:block" aria-hidden />}
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Ruta de una subpágina: «Configuración / Respaldo». La página actual no es un enlace y lleva `aria-current`. */
export function SettingsBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Ruta de navegación">
      <ol className="flex flex-wrap items-center gap-x-2 text-[14.5px]">
        <li>
          <PrivateLink href="/configuracion" className={linkClass()}>
            Configuración
          </PrivateLink>
        </li>
        <li aria-hidden className="text-textMuted">
          /
        </li>
        <li aria-current="page" className="font-[650] text-textPrimary">
          {current}
        </li>
      </ol>
    </nav>
  );
}

/** Aviso de éxito o de estado de un formulario: la región viva queda SIEMPRE montada para que el cambio se anuncie. */
export function LiveMessage({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={children ? "flex items-center gap-1.5 text-[14px] font-[650] text-ok" : "sr-only"}>
      {children && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </div>
  );
}
