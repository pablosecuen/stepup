import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { DEFAULT_RECURRENCE_HORIZON_DAYS } from "@/lib/calendar/recurrence-engine";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { listAllAllocations, listAllCharges, listAllPayments } from "@/lib/repositories/payments";
import { localDateKeyInTimeZone } from "@/lib/payments/dates";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { pickStudentNextClass } from "./profile-overview";
import { projectStudentStatuses, toEnginePaymentsState } from "./list-status";
import type { StudentListEntry } from "./list-filters";

/**
 * Todo lo que la lista de Alumnos necesita para filtrar y ordenar (estado de pago de cada alumno y su próxima clase), con UNA lectura de cobros/pagos y UNA vista del calendario
 * (la ventana estándar de 60 días, desde 12 h atrás para no perder una clase en curso). Sólo lecturas.
 */
export async function loadStudentListEntries(ctx: AuthenticatedDbContext, students: readonly StudentRecord[], now: Date = new Date()): Promise<StudentListEntry[]> {
  const todayDateKey = localDateKeyInTimeZone(now);
  const rangeStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const rangeEnd = new Date(now.getTime() + DEFAULT_RECURRENCE_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const [charges, payments, allocations, items] = await Promise.all([listAllCharges(ctx), listAllPayments(ctx), listAllAllocations(ctx), loadCalendarViewForRange(ctx, rangeStart, rangeEnd)]);
  const statuses = projectStudentStatuses({ students, payments: toEnginePaymentsState({ charges, payments, allocations }), todayDateKey });
  return students.map((student) => {
    const next = pickStudentNextClass({ items, studentId: student.id, status: student.status, now });
    return { student, payment: statuses.get(student.id)!, nextClassStart: next.kind === "found" ? next.start : null, nextClassEnd: next.kind === "found" ? next.end : null };
  });
}
