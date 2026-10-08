import type { ComponentProps, ReactNode } from "react";

// Tarjeta del rediseño: superficie clara, borde fino de 1,5 px, sombra cálida suave
// (docs/design/web-v1/02-componentes-y-navegacion.md §4).

export type CardTone = "default" | "warn" | "bad" | "ok";

const TONES: Record<CardTone, string> = {
  default: "border-border bg-surface",
  warn: "border-warnLine bg-[#FFF8E5]",
  bad: "border-badLine bg-[#FDF1EF]",
  ok: "border-okLine bg-[#F2F8F1]",
};

export function Card({ tone = "default", flat = false, padded = true, className, children, ...props }: { tone?: CardTone; flat?: boolean; padded?: boolean } & ComponentProps<"div">) {
  return (
    <div className={`rounded-lg border-[1.5px] ${TONES[tone]} ${flat ? "" : "shadow-card"} ${padded ? "p-4 nav:p-5" : ""}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </div>
  );
}

/** Cabecera de una tarjeta: título en serifa a la izquierda y, opcionalmente, un dato o acción a la derecha. */
export function CardHeader({ title, meta, as: Heading = "h2" }: { title: ReactNode; meta?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 nav:px-5">
      <Heading className="font-display text-card font-semibold">{title}</Heading>
      {meta && <div className="text-[13px] font-medium text-textMuted">{meta}</div>}
    </div>
  );
}
