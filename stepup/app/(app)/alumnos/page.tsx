import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { listCustomLevels } from "@/lib/repositories/custom-levels";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
import { paginate } from "@/lib/students/filters";
import { applyStudentListFilters, parsePaymentStatusFilter, parseSortOption, type StudentListFilterState, type StudentListRow } from "@/lib/students/list-filters";
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

function buildQueryHref(params: AlumnosSearchParams, overrides: Partial<AlumnosSearchParams>): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.q) query.set("q", merged.q);
  if (merged.status && merged.status !== "activo") query.set("status", merged.status);
  if (merged.level && merged.level !== "todos") query.set("level", merged.level);
  if (merged.modality && merged.modality !== "todos") query.set("modality", merged.modality);
  if (merged.pago && merged.pago !== "todos") query.set("pago", merged.pago);
  if (merged.orden && merged.orden !== "nombre") query.set("orden", merged.orden);
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
  const filtered = applyStudentListFilters(entries, filters);
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
      search={search}
      status={status}
      level={level}
      modality={modality}
      paymentStatus={paymentStatus}
      sortBy={sortBy}
      customLevels={customLevels}
      buildHref={(p) => buildQueryHref(params, { page: String(p) })}
    />
  );
}
