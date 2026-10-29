import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
import { paginate } from "@/lib/students/filters";
import { resolveStudentList, parsePaymentStatusFilter, parseSortOption, type StudentListFilterState, type StudentListRow } from "@/lib/students/list-filters";
import { buildStudentsListHref, cleanStudentSearchText } from "@/lib/students/list-url";
import { loadStudentListEntries } from "@/lib/students/load-students-list";
import { loadStudentListAggregates } from "@/lib/repositories/student-list-aggregates";
import { localDateKeyInTimeZone } from "@/lib/payments/dates";
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
  pago?: string;
  orden?: string;
  page?: string;
}

export default async function AlumnosPage({ searchParams }: { searchParams: Promise<AlumnosSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const params = await searchParams;
  const search = cleanStudentSearchText(params.q);
  const status = params.status?.trim() || "activo";
  const level = params.level?.trim() || "todos";
  const modality = params.modality?.trim() || "todos";
  const paymentStatus = parsePaymentStatusFilter(params.pago?.trim());
  const sortBy = parseSortOption(params.orden?.trim());
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let students;
  let customLevels;
  let entries;
  let aggregatesFor: (ids: string[]) => ReturnType<typeof loadStudentListAggregates>;
  const todayDateKey = localDateKeyInTimeZone(new Date());
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [allStudents, levels, excludedStudentIds] = await Promise.all([listStudents(ctx), listCustomLevels(ctx), loadExcludedStudentIds(ctx)]);
    // Datos de prueba ocultos (R16): fuera de la lista. Se consultan y se vuelven a mostrar desde Configuración › Datos de prueba.
    students = withoutExcludedStudents(allStudents, excludedStudentIds);
    customLevels = levels;
    entries = await loadStudentListEntries(ctx, students);
    aggregatesFor = (ids) => loadStudentListAggregates(ctx, ids, todayDateKey);
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

  const filters: StudentListFilterState = {
    search,
    status: status as StudentListFilterState["status"],
    level,
    modality: modality as StudentListFilterState["modality"],
    paymentStatus,
    sortBy,
  };
  // Búsqueda, filtros y orden sobre TODOS los alumnos de la cuenta y recién después la página: un alumno de la página 5 aparece al buscarlo.
  const { items: filtered, matchesOutsideFilters } = resolveStudentList(entries, filters);
  const result = paginate(filtered, page, PAGE_SIZE);
  const isFiltered = search !== "" || status !== "activo" || level !== "todos" || modality !== "todos" || paymentStatus !== "todos";
  // Promedio, clases del mes y tarea pendiente sólo de los alumnos que se muestran. Un fallo de esta información complementaria no rompe la lista.
  const aggregates = await aggregatesFor(result.items.map((entry) => entry.student.id)).catch(() => new Map());
  const rows: StudentListRow[] = result.items.map((entry) => ({ ...entry, aggregates: aggregates.get(entry.student.id) ?? { classesThisMonth: 0, averageGrade: null, hasPendingHomework: false } }));

  return (
    <StudentsListView
      rows={rows}
      page={result.page}
      totalPages={result.totalPages}
      totalItems={result.totalItems}
      isFiltered={isFiltered}
      hasAnyStudentEver={students.length > 0}
      matchesOutsideFilters={matchesOutsideFilters}
      search={search}
      status={status}
      level={level}
      modality={modality}
      paymentStatus={paymentStatus}
      sortBy={sortBy}
      customLevels={customLevels}
      buildHref={(p) => buildStudentsListHref({ ...params, q: search, page: String(p) })}
    />
  );
}
