import type { ReactNode } from "react";
import { CheckIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { buttonClass, linkClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

// Piezas compartidas de Configuración y sus subpáginas: secciones con título en serifa, filas con jerarquía fija (título →
// descripción → control) y los cuatro estilos de botón (principal, secundario, peligro con contorno, peligro lleno), que son los
// del sistema (`components/ui/button.tsx`). Un solo lugar para el ritmo, los focos y los tamaños (44 px) en todos los apartados.

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
  /** Clases de la grilla de tarjetas (cada hijo es un `SettingsCard`): organiza el contenido en dos o tres columnas cuando entra. Sin esto, una sola tarjeta con filas. */
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
