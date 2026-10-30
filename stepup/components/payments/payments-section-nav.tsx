import PrivateLink from "@/components/nav/private-link";

// Navegación secundaria de «Cobros»: «Centro de cobros», «Por alumno» y «Resumen financiero» son tres vistas de la misma sección (el resumen ya
// no es una pantalla aislada; «Por alumno» es una vista de consulta). Mismas rutas de siempre. En móvil es la única forma de pasar de una a otra dentro de la pantalla
// (la barra inferior conserva sus cinco destinos). El estado activo se dice con texto en negrita y `aria-current`, no sólo con color.

const SECTIONS = [
  { key: "collections", href: "/cobros", label: "Centro de cobros" },
  { key: "students", href: "/cobros/por-alumno", label: "Por alumno" },
  { key: "overview", href: "/resumen-financiero", label: "Resumen financiero" },
] as const;

export type PaymentsSectionKey = (typeof SECTIONS)[number]["key"];

export function PaymentsSectionNav({ current }: { current: PaymentsSectionKey }) {
  return (
    <nav aria-label="Secciones de Cobros" className="mt-4">
      <ul className="flex flex-wrap gap-2">
        {SECTIONS.map((section) => {
          const active = section.key === current;
          return (
            <li key={section.key}>
              <PrivateLink
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-pill border-[1.5px] px-4 text-[14.5px] transition-colors ${
                  active ? "border-ink bg-ink font-bold text-background" : "border-borderStrong bg-surface font-semibold text-textPrimary hover:border-ink hover:bg-paperDeep"
                }`}
              >
                {section.label}
              </PrivateLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
