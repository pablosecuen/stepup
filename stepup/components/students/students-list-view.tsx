import { PlusIcon, UsersIcon } from "@heroicons/react/24/outline";
import { EnterOnChange } from "@/components/ui/enter-on-change";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { PrivateButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { CustomLevelRecord } from "@/lib/repositories/custom-levels-mapping";
import { StudentCard, StudentsTable } from "@/components/students/student-card";
import { StudentsFiltersForm } from "@/components/students/students-filters-form";
import { PaginationControls } from "@/components/students/pagination-controls";
import { ManageLevelsSection } from "@/components/students/manage-levels-section";

/**
 * Lista de alumnos (presentación). La página resuelve los datos, aplica los filtros y pagina; esta vista sólo los dibuja:
 * tabla desde 820 px y tarjetas por debajo.
 */
export function StudentsListView({
  items,
  page,
  totalPages,
  totalItems,
  isFiltered,
  hasAnyStudentEver,
  search,
  status,
  level,
  modality,
  customLevels,
  buildHref,
}: {
  items: StudentRecord[];
  page: number;
  totalPages: number;
  totalItems: number;
  isFiltered: boolean;
  hasAnyStudentEver: boolean;
  search: string;
  status: string;
  level: string;
  modality: string;
  customLevels: CustomLevelRecord[];
  buildHref: (page: number) => string;
}) {
  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader
        title="Alumnos"
        subtitle={
          <>
            {totalItems} alumno{totalItems === 1 ? "" : "s"}
            {isFiltered ? " (filtrados)" : ""}
          </>
        }
        action={
          <PrivateButtonLink href="/alumnos/nuevo" variant="primary">
            <PlusIcon className="h-5 w-5" aria-hidden />
            Nuevo alumno
          </PrivateButtonLink>
        }
      />

      <div className="mt-6 flex flex-col gap-3.5">
        <StudentsFiltersForm search={search} status={status} level={level} modality={modality} levelOptions={customLevels.map((l) => l.name)} />
        <ManageLevelsSection customLevels={customLevels} />
      </div>

      <EnterOnChange changeKey={`${search}|${status}|${level}|${modality}|${page}`}>
      {items.length > 0 ? (
        <>
          <ul className="mt-5 flex flex-col gap-3 nav:hidden">
            {items.map((student) => (
              <li key={student.id}>
                <StudentCard student={student} />
              </li>
            ))}
          </ul>
          <div className="mt-5 hidden nav:block">
            <StudentsTable students={items} />
          </div>
          <PaginationControls page={page} totalPages={totalPages} buildHref={buildHref} />
        </>
      ) : (
        <div className="mt-5">
          <EmptyState
            icon={UsersIcon}
            message={hasAnyStudentEver ? "Ningún alumno coincide con los filtros elegidos." : "Todavía no hay alumnos cargados."}
            action={hasAnyStudentEver ? { label: "Limpiar filtros", href: "/alumnos" } : { label: "Agregar alumno", href: "/alumnos/nuevo" }}
          />
        </div>
      )}
      </EnterOnChange>
    </div>
  );
}
