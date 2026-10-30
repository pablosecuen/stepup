import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listAllAllocations, listAllCharges, listAllPayments, listTrainingBillingAgreements } from "@/lib/repositories/payments";
import { listStudents } from "@/lib/repositories/students";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
import { PerStudentErrorView, PerStudentView } from "@/components/payments/per-student-view";
import { buildPerStudentRows, parsePerStudentQuery, type PerStudentRow } from "@/lib/payments/per-student-overview";
import { localDateKeyInTimeZone } from "@/lib/payments/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobros por alumno · TeacherFlow" };

/**
 * Cobros › Por alumno. SÓLO LEE: no dispara la generación de cobros (eso lo hace el Centro de cobros) ni escribe nada; combina alumnos, planes, cobros, pagos, asignaciones
 * y acuerdos de entrenamiento de la propia cuenta (todas las lecturas filtran por el propietario autenticado).
 */
export default async function PerStudentPage({ searchParams }: { searchParams: Promise<{ q?: string; plan?: string; orden?: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const initialQuery = parsePerStudentQuery(await searchParams);
  let rows: PerStudentRow[];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const todayDateKey = localDateKeyInTimeZone(new Date());
    const [allStudents, charges, payments, allocations, agreements, excludedStudentIds] = await Promise.all([listStudents(ctx), listAllCharges(ctx), listAllPayments(ctx), listAllAllocations(ctx), listTrainingBillingAgreements(ctx), loadExcludedStudentIds(ctx)]);
    // Mismo criterio que la lista de Alumnos: los alumnos de prueba que la propia cuenta confirmó como excluidos (reversible) no figuran.
    const students = withoutExcludedStudents(allStudents, excludedStudentIds);
    rows = buildPerStudentRows({ students, charges, payments, allocations, agreements, currentPeriod: todayDateKey.slice(0, 7), todayDateKey });
  } catch {
    return <PerStudentErrorView />;
  }

  return <PerStudentView rows={rows} initialQuery={initialQuery} />;
}
