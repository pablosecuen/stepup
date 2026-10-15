import type { CSSProperties, ReactNode } from "react";

/**
 * Bloque que aparece al entrar en la sección (opacidad + 16 px, 320 ms). Es sólo marcado: un único `RevealController` (cliente, una
 * sola vez por página) observa todos los `[data-reveal]`. El HTML llega VISIBLE; sólo se ocultan los bloques que están por debajo del
 * primer viewport, justo antes de observarlos. Con «reducir movimiento» o sin JavaScript nunca se oculta nada.
 */
export function Reveal({ children, className = "", delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" }) {
  const style = delay ? ({ "--d": `${delay}ms` } as CSSProperties) : undefined;
  return (
    <Tag data-reveal="" className={`tf-reveal ${className}`} style={style}>
      {children}
    </Tag>
  );
}
