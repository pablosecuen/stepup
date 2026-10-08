import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { buttonClass, linkClass, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

// Enlaces de las páginas PÚBLICAS (landing y acceso). Viven en `components/auth/` a propósito: el área privada nunca importa
// `next/link` directo (siempre `PrivateLink`, sin precarga; lo fija lib/nav/__tests__/shell-wiring.test.ts). Las páginas
// públicas sí pueden precargar sus rutas hermanas.

/** Enlace con aspecto de botón. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  block,
  className,
  children,
  ...props
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; children: ReactNode } & ComponentProps<typeof Link>) {
  return (
    <Link className={`${buttonClass({ variant, size, block })}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </Link>
  );
}

/** Enlace de texto (acento oscuro, subrayado al pasar, 44 px de alto). */
export function TextLink({ block, className, children, ...props }: { block?: boolean; children: ReactNode } & ComponentProps<typeof Link>) {
  return (
    <Link className={`${linkClass({ block })}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </Link>
  );
}
