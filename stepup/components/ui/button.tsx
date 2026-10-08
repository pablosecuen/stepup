import PrivateLink from "@/components/nav/private-link";
import type { ComponentProps, ReactNode } from "react";

// Botones del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §2). Una sola fuente de clases para <button> y para
// enlaces con aspecto de botón. Nunca hay un tamaño por debajo de 44 px (B8): `min-h-11` va en TODAS las variantes.

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "dangerOutline";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border-[1.5px] px-[18px] py-2 text-center text-[14.5px] font-[650] leading-tight transition-[background-color,border-color,color,transform] duration-150 ease-premium active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border-ink bg-ink text-background hover:border-sideLine hover:bg-sideLine",
  accent: "border-accent bg-accent text-white hover:border-accentDark hover:bg-accentDark",
  secondary: "border-borderMid bg-surface text-ink hover:border-ink hover:bg-white",
  ghost: "border-transparent bg-transparent text-textSecondary hover:bg-paperDeep hover:text-ink",
  danger: "border-bad bg-bad text-white hover:border-[#7A1F17] hover:bg-[#7A1F17]",
  dangerOutline: "border-bad bg-transparent text-bad hover:bg-badSoft",
};

const SIZES: Record<ButtonSize, string> = {
  md: "",
  lg: "min-h-[52px] px-6 text-base",
};

/** Clases de un botón (o de un enlace con aspecto de botón). Siempre incluye `min-h-11`. */
export function buttonClass({ variant = "primary", size = "md", block = false }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], block ? "w-full" : ""].filter(Boolean).join(" ");
}

/** Clases de un enlace de texto (acento oscuro, subrayado al pasar). 44 px de alto. */
export function linkClass({ block = false }: { block?: boolean } = {}): string {
  return `inline-flex min-h-11 items-center gap-1.5 text-[14.5px] font-[650] text-accentDark underline-offset-[3px] hover:underline${block ? " w-full justify-center" : ""}`;
}

/** Giro de «ocupado» dentro de un botón. Se detiene con «reducir movimiento». */
export function Spinner({ onFilled = true }: { onFilled?: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-4 w-4 animate-spin rounded-full border-2 motion-reduce:animate-none ${onFilled ? "border-white/40 border-t-white" : "border-borderMid border-t-ink"}`}
    />
  );
}

const FILLED: ReadonlySet<ButtonVariant> = new Set(["primary", "accent", "danger"]);

interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Acción en curso: muestra el giro, marca `aria-busy` y deshabilita el botón. */
  busy?: boolean;
}

export function Button({ variant = "primary", size = "md", block, busy, className, children, type = "button", disabled, ...props }: ButtonOwnProps & ComponentProps<"button">) {
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={`${buttonClass({ variant, size, block })}${className ? ` ${className}` : ""}`} {...props}>
      {busy && <Spinner onFilled={FILLED.has(variant)} />}
      {children}
    </button>
  );
}

type LinkOwnProps = Omit<ButtonOwnProps, "busy"> & { children: ReactNode };

/**
 * Enlace con aspecto de botón dentro del área privada (sin precarga). Los equivalentes para las páginas públicas (`ButtonLink`,
 * `TextLink`) están en `components/auth/public-links.tsx`: el área privada nunca importa `next/link` directo.
 */
export function PrivateButtonLink({ variant = "primary", size = "md", block, className, children, ...props }: LinkOwnProps & ComponentProps<typeof PrivateLink>) {
  return (
    <PrivateLink className={`${buttonClass({ variant, size, block })}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </PrivateLink>
  );
}
