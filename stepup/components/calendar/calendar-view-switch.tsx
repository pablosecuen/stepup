import PrivateLink from "@/components/nav/private-link";

/**
 * Control segmentado Semana · Día: el control principal de la fila de controles. Son enlaces (la vista vive en la URL); la
 * seleccionada se marca con `aria-current` y con el fondo y el peso del texto, nunca sólo con color. 44 px de alto.
 */
export function CalendarViewSwitch({ view, weekHref, dayHref }: { view: "week" | "day"; weekHref: string; dayHref: string }) {
  const isWeek = view === "week";
  const segment = (selected: boolean) =>
    `inline-flex flex-1 items-center justify-center rounded-sm px-5 text-[14.5px] font-[650] transition-colors motion-reduce:transition-none nav:flex-none ${selected ? "bg-surface text-textPrimary shadow-subtle" : "text-textSecondary hover:text-textPrimary"}`;
  return (
    <div role="group" aria-label="Vista del calendario" className="flex w-full items-center gap-1 rounded-md bg-paperDeep p-0.5 ring-1 ring-inset ring-border nav:w-auto">
      <PrivateLink href={weekHref} aria-current={isWeek ? "true" : undefined} className={`min-h-11 ${segment(isWeek)}`}>
        Semana
      </PrivateLink>
      <PrivateLink href={dayHref} aria-current={!isWeek ? "true" : undefined} className={`min-h-11 ${segment(!isWeek)}`}>
        Día
      </PrivateLink>
    </div>
  );
}
