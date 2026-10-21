import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { BackLink, PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";

/**
 * Marco de las pantallas de registro de una clase (programada o no programada): «Volver», título (el alumno o el grupo), día y hora, tipo de
 * clase y participantes, el tipo de actividad como insignia y el contenido. Ancho medio, igual que la lista de clases por registrar.
 */
export function RegistroPageFrame({
  title,
  subtitle,
  lines = [],
  kindLabel,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Renglones debajo del título (tipo de clase, quiénes participan), como el encabezado del formulario de la app. */
  lines?: string[];
  kindLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className={PAGE_WIDTH.medium}>
      <BackLink href="/registro">Volver a Clases por registrar</BackLink>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <PageTitle>{title}</PageTitle>
          {subtitle && <p className="mt-1.5 text-[15px] text-textMuted [overflow-wrap:anywhere]">{subtitle}</p>}
          {lines.map((line) => (
            <p key={line} className="mt-0.5 text-[15px] text-textSecondary [overflow-wrap:anywhere]">
              {line}
            </p>
          ))}
        </div>
        {kindLabel && <Badge>{kindLabel}</Badge>}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}
