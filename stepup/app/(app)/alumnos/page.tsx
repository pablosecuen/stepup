import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { applyStudentFilters, paginate, type StudentsFilterState } from "@/lib/students/filters";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StudentCard } from "@/components/students/student-card";
import { StudentsFiltersForm } from "@/components/students/students-filters-form";
import { PaginationControls } from "@/components/students/pagination-controls";
import { ManageLevelsSection } from "@/components/students/manage-levels-section";

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
    return <AuthNotConfigured />;
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
    [students, customLevels] = await Promise.all([listStudents(ctx), listCustomLevels(ctx)]);
  } catch (error) {
    if (error instanceof DbUnauthenticatedError) {
      // El layout privado ya debería haber redirigido — esto es defensa en
      // profundidad, nunca la única barrera (ver server-context.ts).
      return <ErrorState message="Tu sesión expiró. Volvé a iniciar sesión." />;
    }
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Alumnos</h1>
        <div className="mt-6">
          <ErrorState message="No pudimos cargar tus alumnos." />
          <Link href="/alumnos" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
            Reintentar
          </Link>
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
  const hasAnyStudentEver = students.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Alumnos</h1>
          <p className="mt-1.5 text-sm text-textMuted">
            {result.totalItems} alumno{result.totalItems === 1 ? "" : "s"}
            {isFiltered ? " (filtrados)" : ""}
          </p>
        </div>
        <Link
          href="/alumnos/nuevo"
          className="rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          + Nuevo alumno
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <StudentsFiltersForm
          search={search}
          status={status}
          level={level}
          modality={modality}
          levelOptions={customLevels.map((l) => l.name)}
        />
        <ManageLevelsSection customLevels={customLevels} />
      </div>

      {result.items.length > 0 ? (
        <>
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {result.items.map((student) => (
              <li key={student.id}>
                <StudentCard student={student} />
              </li>
            ))}
          </ul>
          <PaginationControls page={result.page} totalPages={result.totalPages} buildHref={(p) => buildQueryHref(params, { page: String(p) })} />
        </>
      ) : (
        <div className="mt-6">
          <EmptyState
            message={
              hasAnyStudentEver
                ? "Ningún alumno coincide con los filtros elegidos."
                : "Todavía no hay alumnos cargados."
            }
          />
        </div>
      )}
    </div>
  );
}
