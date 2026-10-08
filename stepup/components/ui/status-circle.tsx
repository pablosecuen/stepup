import type { ComponentType, SVGProps } from "react";

export type StatusTone = "ok" | "warn" | "bad" | "info" | "accent";

const STATUS_TONES: Record<StatusTone, string> = {
  ok: "bg-okSoft text-ok",
  warn: "bg-warnSoft text-warn",
  bad: "bg-badSoft text-bad",
  info: "bg-infoSoft text-info",
  accent: "bg-accentSoft text-accentText",
};

/** Círculo de estado de 72 px: ícono + tono (nunca sólo color; el título de la pantalla dice lo mismo en texto). Decorativo. */
export function StatusCircle({ tone, icon: Icon }: { tone: StatusTone; icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  return (
    <span aria-hidden className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-pill ${STATUS_TONES[tone]}`}>
      <Icon className="h-9 w-9" />
    </span>
  );
}
