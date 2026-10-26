import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { availabilityLabel, type LessonContent } from "@/lib/repositories/lesson-content-mapping";
import { LessonPhotoViewer } from "./lesson-photo-viewer";
import { OpenLessonFileButton } from "./open-lesson-file-button";

const SECTION_TITLE = "text-[13px] font-semibold uppercase tracking-wide text-textMuted";

/**
 * Contenido propio de una clase ya cargada (traslado): temas con su estado, objetivos, actividades, notas, materiales y archivos adjuntos. Sólo lectura.
 * Las notas internas son privadas de la profesora: figuran acá, pero nunca salen en un reporte para terceros.
 */
export function LessonContentCard({ content, studentNames, includePedagogy = true }: { content: LessonContent; studentNames: Record<string, string>; includePedagogy?: boolean }) {
  const list = (items: string[]) => (
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[15px] [overflow-wrap:anywhere]">
      {items.map((item, i) => (
        <li key={`${i}-${item}`}>{item}</li>
      ))}
    </ul>
  );
  if (!includePedagogy && content.materials.length === 0 && content.attachments.length === 0 && content.isBillable && content.consumesMonthlyPackage) return null;
  return (
    <section aria-labelledby="contenido-de-la-clase" className="mb-5">
      <Card padded={false}>
        <CardHeader title={<span id="contenido-de-la-clase">{includePedagogy ? "Contenido de la clase" : "Evidencias y materiales de la clase"}</span>} meta="Sólo lectura" />
        <div className="space-y-4 px-4 pb-4 nav:px-5 nav:pb-5">
          {includePedagogy && content.topics.length > 0 && (
            <div>
              <h3 className={SECTION_TITLE}>Temas</h3>
              <ul className="mt-1 space-y-1">
                {content.topics.map((topic, i) => (
                  <li key={`${topic.id ?? i}`} className="flex flex-wrap items-center gap-2 text-[15px] [overflow-wrap:anywhere]">
                    <span>{topic.text}</span>
                    {topic.status === "visto" && <Badge tone="ok">Visto</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {includePedagogy && content.objectives.length > 0 && (
            <div>
              <h3 className={SECTION_TITLE}>Objetivos</h3>
              {list(content.objectives)}
            </div>
          )}
          {includePedagogy && content.activities.length > 0 && (
            <div>
              <h3 className={SECTION_TITLE}>Actividades</h3>
              {list(content.activities)}
            </div>
          )}
          {includePedagogy && content.activityNotes !== "" && (
            <div>
              <h3 className={SECTION_TITLE}>Notas de las actividades</h3>
              <p className="mt-1 whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{content.activityNotes}</p>
            </div>
          )}
          {includePedagogy && content.internalNotes !== "" && (
            <div>
              <h3 className={SECTION_TITLE}>Notas internas (privadas)</h3>
              <p className="mt-1 whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{content.internalNotes}</p>
            </div>
          )}
          {content.materials.length > 0 && (
            <div>
              <h3 className={SECTION_TITLE}>Materiales usados</h3>
              <ul className="mt-1 space-y-2">
                {content.materials.map((m) => (
                  <li key={m.legacyId} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-medium">{m.name}</span>
                      {m.note && <span className="text-textMuted"> · {m.note}</span>}
                      <span className="block text-[13px] text-textMuted">{m.inLibrary ? availabilityLabel(m.availability) : "Todavía no se trasladó este material"}</span>
                    </span>
                    {m.id && m.hasFile && m.availability === "disponible" && <OpenLessonFileButton kind="material" id={m.id} label={`Abrir el material ${m.name}`} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {content.attachments.length > 0 && (
            <div>
              <h3 className={SECTION_TITLE}>Archivos adjuntos</h3>
              <ul className="mt-1 space-y-2">
                {content.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-medium">{a.name}</span> <Badge>{a.kind === "image" ? "Foto" : "PDF"}</Badge>
                      {a.caption && <span className="text-textMuted"> · {a.caption}</span>}
                      <span className="block text-[13px] text-textMuted">
                        {a.studentId ? `De ${studentNames[a.studentId] ?? "un alumno"} · ` : "De toda la clase · "}
                        {availabilityLabel(a.availability)}
                      </span>
                    </span>
                    {a.availability === "disponible" &&
                      (a.kind === "image" ? <LessonPhotoViewer id={a.id} name={a.name} /> : <OpenLessonFileButton kind="attachment" id={a.id} label={`Abrir el archivo ${a.name}`} />)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(!content.isBillable || !content.consumesMonthlyPackage) && (
            <p className="text-[14px] text-textMuted">
              {!content.isBillable && "Esta clase está marcada como no facturable. "}
              {!content.consumesMonthlyPackage && "Esta clase no consume una clase de la cuota o del paquete."}
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}
