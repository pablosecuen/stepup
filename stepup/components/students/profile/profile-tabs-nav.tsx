import Link from "@/components/nav/private-link";

export type ProfileTabKey = "resumen" | "clases" | "progreso" | "tareas" | "cobros" | "reportes" | "informacion";

const TABS: { key: ProfileTabKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "clases", label: "Clases" },
  { key: "progreso", label: "Progreso" },
  { key: "tareas", label: "Tareas" },
  { key: "cobros", label: "Cobros" },
  { key: "reportes", label: "Reportes" },
  { key: "informacion", label: "Información" },
];

// Mismas 7 pestañas que StudentProfileScreen.tsx en móvil (SegmentedTabs).
export function ProfileTabsNav({ studentId, active }: { studentId: string; active: ProfileTabKey }) {
  return (
    <nav aria-label="Secciones del perfil" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={`/alumnos/${studentId}?tab=${tab.key}`}
                aria-current={isActive ? "page" : undefined}
                className={`inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors duration-150 ease-premium focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue ${
                  isActive
                    ? "border-brandBlue text-brandBlueDark"
                    : "border-transparent text-textSecondary hover:text-textPrimary"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
