import type { ReactNode } from "react";

// Insignia del rediseño: píldora de 26 px con ícono o punto + texto (docs/design/web-v1/02-componentes-y-navegacion.md §4).
// El color acompaña al texto; nunca lo reemplaza.

export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "info" | "accent";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-border bg-paperDeep text-textSecondary",
  ok: "border-okLine bg-okSoft text-ok",
  warn: "border-warnLine bg-warnSoft text-warn",
  bad: "border-badLine bg-badSoft text-bad",
  info: "border-infoLine bg-infoSoft text-info",
  accent: "border-accentLine bg-accentSoft text-accentText",
};

export function Badge({ tone = "neutral", dot = false, icon, children }: { tone?: BadgeTone; dot?: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 text-[12.5px] font-[650] ${TONES[tone]}`}>
      {dot && <span aria-hidden className="h-[7px] w-[7px] rounded-pill bg-current" />}
      {icon}
      {children}
    </span>
  );
}
