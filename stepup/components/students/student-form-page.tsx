import type { ReactNode } from "react";
import { BackLink, PageTitle, PAGE_WIDTH } from "@/components/ui/page-header";

/** Marco de «Nuevo alumno» y «Editar alumno»: «Volver», título y el formulario (angosto, centrado). */
export function StudentFormPage({ backHref, backLabel, title, subtitle, children }: { backHref: string; backLabel: string; title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className={PAGE_WIDTH.narrow}>
      <BackLink href={backHref}>{backLabel}</BackLink>
      <div className="mt-2">
        <PageTitle>{title}</PageTitle>
        {subtitle && <p className="mt-1.5 text-[15px] text-textMuted">{subtitle}</p>}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}
