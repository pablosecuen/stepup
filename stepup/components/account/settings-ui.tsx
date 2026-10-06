import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";

// Piezas compartidas de Configuración y sus subpáginas: secciones con título, filas con jerarquía fija (título → descripción →
// control) y los cuatro estilos de botón (principal, secundario, peligro con contorno, peligro lleno). Un solo lugar para el
// ritmo, los focos y los tamaños (44 px) en todos los apartados.

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition-all duration-150 ease-premium active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/** Acción principal de un formulario (guardar). */
export const BUTTON_PRIMARY = `${BUTTON_BASE} bg-brandBlue text-white hover:bg-brandBlueDark focus-visible:ring-brandBlue`;
/** Acción normal que no guarda datos (pedir un enlace, cancelar). */
export const BUTTON_SECONDARY = `${BUTTON_BASE} border border-borderStrong bg-surface text-textPrimary hover:bg-background focus-visible:ring-brandBlue`;
/** Acción sensible: abre una confirmación, nunca ejecuta de inmediato. */
export const BUTTON_DANGER_OUTLINE = `${BUTTON_BASE} border border-statusRojo bg-surface text-statusRojo hover:bg-statusRojo/5 focus-visible:ring-statusRojo`;
/** Confirmación final de una acción sensible. */
export const BUTTON_DANGER = `${BUTTON_BASE} bg-statusRojo text-white hover:bg-statusRojo/90 focus-visible:ring-statusRojo`;

/** Campo de texto de un formulario de Configuración (borde de control con 3:1 de contraste). */
export const FIELD_CLASS =
  "w-full rounded-md border border-borderStrong bg-background px-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue";

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
  children,
}: {
  id: string;
  title: string;
  description?: string;
  tone?: SettingsSectionTone;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-20">
      <h2 id={`${id}-titulo`} className={`text-lg font-semibold tracking-tight ${danger ? "text-statusRojo" : "text-textPrimary"}`}>
        {title}
      </h2>
      {description && <p className="mt-0.5 text-sm text-textMuted">{description}</p>}
      <div
        className={`mt-3 divide-y overflow-hidden rounded-lg border bg-surface shadow-card ${
          danger ? "divide-statusRojo/20 border-statusRojo/40" : "divide-border border-border"
        }`}
      >
        {children}
      </div>
    </section>
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
      <h3 className="text-sm font-semibold text-textPrimary">{title}</h3>
      {description && <p className="mt-0.5 text-sm text-textMuted">{description}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Fila que es un enlace completo a otra pantalla (todo el renglón es el objetivo táctil). */
export function SettingsLinkRow({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <PrivateLink
      href={href}
      className="flex min-h-14 items-center justify-between gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-background focus:outline-none focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brandBlue sm:px-5"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-textPrimary">{title}</span>
        <span className="mt-0.5 block text-sm text-textMuted">{description}</span>
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-textMuted" aria-hidden />
    </PrivateLink>
  );
}

export interface SettingsIndexItem {
  id: string;
  label: string;
}

/**
 * Índice de la página: enlaces a cada sección. En el móvil es una fila que se desplaza en horizontal; desde `md` queda fija
 * a la izquierda mientras se recorre la página.
 */
export function SettingsIndex({ items }: { items: readonly SettingsIndexItem[] }) {
  return (
    <nav aria-label="Secciones de Configuración" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:sticky md:top-8 md:mx-0 md:self-start md:overflow-visible md:px-0">
      <ul className="flex gap-1.5 md:flex-col md:gap-0.5">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-textSecondary transition-colors duration-150 hover:text-textPrimary focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue md:w-full md:border-transparent md:bg-transparent md:px-3 md:hover:bg-surface"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Ruta de una subpágina: «Configuración / Respaldo». La página actual no es un enlace y lleva `aria-current`. */
export function SettingsBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Ruta de navegación">
      <ol className="flex flex-wrap items-center gap-x-2 text-sm">
        <li>
          <PrivateLink href="/configuracion" className="inline-flex min-h-11 items-center font-medium text-brandBlue hover:underline">
            Configuración
          </PrivateLink>
        </li>
        <li aria-hidden className="text-textMuted">
          /
        </li>
        <li aria-current="page" className="font-medium text-textPrimary">
          {current}
        </li>
      </ol>
    </nav>
  );
}

/** Aviso de éxito o de estado de un formulario: la región viva queda SIEMPRE montada para que el cambio se anuncie. */
export function LiveMessage({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={children ? "flex items-center gap-1.5 text-sm font-medium text-statusVerde" : "sr-only"}>
      {children && <CheckIcon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </div>
  );
}
