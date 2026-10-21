import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
import { applyStudentFilters, paginate, type StudentsFilterState } from "@/lib/students/filters";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PageTitle, PAGE_WIDTH } from "@/components/ui/page-header";
import { StudentsListView } from "@/components/students/students-list-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alumnos · TeacherFlow" };

const PAGE_SIZE = 24;

interface AlumnosSearchParams {
  q?: string;
  status?: string;
  level?: string;
  modality?: string;
  page?: string;
}

function buildQueryHref(params: AlumnosSearchParams, overrides: Partial<AlumnosSearchParams>): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.q) query.set("q", merged.q);
  if (merged.status && merged.status !== "activo") query.set("status", merged.status);
  if (merged.level && merged.level !== "todos") query.set("level", merged.level);
  if (merged.modality && merged.modality !== "todos") query.set("modality", merged.modality);
  if (merged.page && merged.page !== "1") query.set("page", merged.page);
  const qs = query.toString();
  return qs ? `/alumnos?${qs}` : "/alumnos";
}

export default async function AlumnosPage({ searchParams }: { searchParams: Promise<AlumnosSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const params = await searchParams;
  const search = params.q?.trim() ?? "";
  const status = params.status?.trim() || "activo";
  const level = params.level?.trim() || "todos";
  const modality = params.modality?.trim() || "todos";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let students;
  let customLevels;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [allStudents, levels, excludedStudentIds] = await Promise.all([listStudents(ctx), listCustomLevels(ctx), loadExcludedStudentIds(ctx)]);
    // Datos de prueba ocultos (R16): fuera de la lista. Se consultan y se vuelven a mostrar desde Configuración › Datos de prueba.
    students = withoutExcludedStudents(allStudents, excludedStudentIds);
    customLevels = levels;
  } catch (error) {
    if (error instanceof DbUnauthenticatedError) {
      // El layout privado ya debería haber redirigido — esto es defensa en
      // profundidad, nunca la única barrera (ver server-context.ts).
      return <ErrorState message="Tu sesión expiró. Volvé a iniciar sesión." />;
    }
    return (
      <div className={PAGE_WIDTH.wide}>
        <PageTitle>Alumnos</PageTitle>
        <div className="mt-6 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar tus alumnos." />
          </div>
          <PrivateButtonLink href="/alumnos" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  const filters: StudentsFilterState = {
    search,
    status: status as StudentsFilterState["status"],
    level,
    modality: modality as StudentsFilterState["modality"],
    sortBy: "nombre",
  };
  const filtered = applyStudentFilters(students, filters);
  const result = paginate(filtered, page, PAGE_SIZE);
  const isFiltered = search !== "" || status !== "activo" || level !== "todos" || modality !== "todos";

  return (
    <StudentsListView
      items={result.items}
      page={result.page}
      totalPages={result.totalPages}
      totalItems={result.totalItems}
      isFiltered={isFiltered}
      hasAnyStudentEver={students.length > 0}
      search={search}
      status={status}
      level={level}
      modality={modality}
      customLevels={customLevels}
      buildHref={(p) => buildQueryHref(params, { page: String(p) })}
    />
  );
}
