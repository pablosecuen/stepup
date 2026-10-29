import { CheckCircleIcon } from "@heroicons/react/24/outline";
import PrivateLink from "@/components/nav/private-link";
import { Badge } from "@/components/ui/badge";
import { linkClass } from "@/components/ui/button";
import { BackLink, PageHeader, PAGE_WIDTH, READING_WIDTH } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { REMINDER_ICONS } from "@/components/reminders/reminder-icons";
import type { RemindersCenterSummary } from "@/lib/dashboard/reminders-center";

/**
 * Recordatorios (presentación). Las cuatro categorías reales con lo que ya traen (título y subtítulo). Hoy no existe una acción
 * para «resolver» un recordatorio —uno resuelto desaparece—, así que las filas son sólo informativas.
 */
export function RemindersView({ summary }: { summary: RemindersCenterSummary }) {
  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href="/inicio">Volver a Inicio</BackLink>
      <div className="mt-3">
        <PageHeader
          title="Recordatorios"
          subtitle={
            <>
              {summary.totalCount} recordatorio{summary.totalCount === 1 ? "" : "s"} pendiente{summary.totalCount === 1 ? "" : "s"}.
            </>
          }
        />
      </div>

      {summary.categories.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={CheckCircleIcon} message="Todo al día. No hay recordatorios pendientes." />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 items-start gap-x-6 gap-y-6 min-[1040px]:grid-cols-2">
          {summary.categories.map((category) => {
            const { icon: Icon, tone } = REMINDER_ICONS[category.kind];
            return (
              <section key={category.kind} aria-labelledby={`reminders-${category.kind}`} className={`min-w-0 ${READING_WIDTH}`}>
                <div className="flex items-center gap-3">
                  <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-pill ${tone === "bad" ? "bg-badSoft text-bad" : "bg-warnSoft text-warn"}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 id={`reminders-${category.kind}`} className="min-w-0 font-display text-section font-semibold [overflow-wrap:anywhere]">
                    {category.label}
                  </h2>
                  {/* El número va siempre escrito (y con su explicación para lectores de pantalla): el rojo sólo acompaña. */}
                  <Badge tone="bad">
                    {category.items.length}
                    <span className="sr-only"> {category.items.length === 1 ? "pendiente" : "pendientes"}</span>
                  </Badge>
                </div>
                <ul className="mt-2.5 overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card">
                  {category.items.map((item) => (
                    <li key={item.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
                      <p className="text-[15px] font-[650] leading-snug text-textPrimary [overflow-wrap:anywhere]">{item.title}</p>
                      <p className="mt-0.5 text-[13.5px] leading-snug text-textMuted tf-num [overflow-wrap:anywhere]">{item.subtitle}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Error al cargar Recordatorios: el mensaje de siempre y un reintento. */
export function RemindersErrorView() {
  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href="/inicio">Volver a Inicio</BackLink>
      <div className="mt-3">
        <PageHeader title="Recordatorios" />
      </div>
      <div className="mt-6 flex flex-col items-start gap-2">
        <div className="w-full">
          <ErrorState message="No pudimos cargar los recordatorios." />
        </div>
        <PrivateLink href="/recordatorios" className={linkClass()}>
          Reintentar
        </PrivateLink>
      </div>
    </div>
  );
}
