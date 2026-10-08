import { CheckCircleIcon, ExclamationCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import type { ComponentType, ReactNode, SVGProps } from "react";

// Aviso en línea del rediseño (docs/design/web-v1/02-componentes-y-navegacion.md §4). Ícono + texto + tono: un estado
// importante nunca se comunica sólo con color. Los errores se anuncian (`role="alert"`); lo demás es `role="status"`.

export type NoticeTone = "info" | "ok" | "warn" | "bad";

const TONES: Record<NoticeTone, { box: string; icon: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }> = {
  info: { box: "border-infoLine bg-infoSoft", icon: "text-info", Icon: InformationCircleIcon },
  ok: { box: "border-okLine bg-okSoft", icon: "text-ok", Icon: CheckCircleIcon },
  warn: { box: "border-warnLine bg-warnSoft", icon: "text-warn", Icon: ExclamationTriangleIcon },
  bad: { box: "border-badLine bg-badSoft", icon: "text-bad", Icon: ExclamationCircleIcon },
};

export function Notice({ tone = "info", title, role, children }: { tone?: NoticeTone; title?: ReactNode; role?: "alert" | "status"; children: ReactNode }) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div role={role ?? (tone === "bad" ? "alert" : "status")} className={`flex gap-3 rounded-md border-[1.5px] px-4 py-3.5 text-[14.5px] text-textSecondary ${box}`}>
      <Icon className={`mt-px h-5 w-5 shrink-0 ${icon}`} aria-hidden />
      <div className="min-w-0">
        {title && <p className="mb-0.5 font-bold text-textPrimary">{title}</p>}
        {children}
      </div>
    </div>
  );
}
