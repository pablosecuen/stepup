import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatInstantDayLongTime } from "@/lib/format/date-format";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";

/**
 * Incidencias heredadas del traslado: cosas que ya faltaban en TeacherFlow anterior (p. ej. la clase del calendario a la que apuntaba este registro). Sólo lectura y en
 * lenguaje simple: el contenido de la clase se conservó completo, no es un error de esta pantalla ni de la profesora. La referencia original queda en un detalle plegado.
 */
export function OriginIncidentsCard({ incidents }: { incidents: OriginIncidentView[] }) {
  if (incidents.length === 0) return null;
  return (
    <section aria-labelledby="incidencias-heredadas" className="mb-5">
      <Card padded={false}>
        <CardHeader title={<span id="incidencias-heredadas">Incidencias heredadas</span>} meta="Ya estaban así antes del traslado" />
        <ul className="space-y-3 px-4 pb-4 nav:px-5 nav:pb-5">
          {incidents.map((incident) => (
            <li key={incident.id} className="text-[15px]">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <Badge tone="info" icon={<InformationCircleIcon className="h-3.5 w-3.5" aria-hidden />}>
                  Heredada
                </Badge>
                <span className="[overflow-wrap:anywhere]">{incident.title}</span>
              </p>
              <p className="mt-1 text-textSecondary [overflow-wrap:anywhere]">{incident.explanation}</p>
              {incident.startsAt && <p className="mt-1 text-[13.5px] text-textMuted">Clase del {formatInstantDayLongTime(incident.startsAt)}.</p>}
              <details className="mt-1 text-[13px] text-textMuted">
                <summary className="cursor-pointer">Ver la referencia original</summary>
                <p className="mt-1 [overflow-wrap:anywhere]">{incident.originalReference}</p>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** Versión compacta para listas (historial de clases, cobros): una línea con el título y la explicación. */
export function OriginIncidentNote({ incidents }: { incidents: OriginIncidentView[] }) {
  if (incidents.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {incidents.map((incident) => (
        <li key={incident.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[13.5px] text-textSecondary">
          <Badge tone="info" icon={<InformationCircleIcon className="h-3.5 w-3.5" aria-hidden />}>
            Incidencia heredada
          </Badge>
          <span className="min-w-0 [overflow-wrap:anywhere]">{incident.explanation}</span>
        </li>
      ))}
    </ul>
  );
}
