import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { DEFAULT_RECURRENCE_HORIZON_DAYS } from "@/lib/calendar/recurrence-engine";
import { listCompletedRegistrationsForStudentReport } from "@/lib/repositories/lesson-registrations";
import { listAllocationsForStudent, listChargesForStudent, listPaymentsForStudent } from "@/lib/repositories/payments";
import {
  buildProfileClassStats,
  pickStudentNextClass,
  totalCollectedForStudent,
  type ProfileClassStats,
  type StudentNextClass,
} from "@/lib/students/profile-overview";
import type { StudentRecord } from "@/lib/repositories/students-mapping";

/**
 * Lecturas del perfil del alumno (B6). SÓLO lectura: no genera cobros ni registra nada (la pestaña Cobros tiene su propia
 * generación idempotente; el Resumen y la Información nunca la disparan).
 */

/** Clases dictadas del alumno y sus cifras (ver las definiciones en `profile-overview.ts`). */
export async function loadProfileClassStats(ctx: AuthenticatedDbContext, studentId: string): Promise<ProfileClassStats> {
  const held = await listCompletedRegistrationsForStudentReport(ctx, studentId);
  return buildProfileClassStats(held);
}

/**
 * Próxima clase o clase en curso del alumno entre las ocurrencias reales de la ventana estándar del calendario (60 días).
 * Se arranca 12 h atrás para no perder una clase que ya empezó y todavía no terminó.
 */
export async function loadStudentNextClass(ctx: AuthenticatedDbContext, student: Pick<StudentRecord, "id" | "status">, now: Date = new Date()): Promise<StudentNextClass> {
  if (student.status !== "activo") return { kind: "not-applicable" };
  const rangeStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const rangeEnd = new Date(now.getTime() + DEFAULT_RECURRENCE_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd);
  return pickStudentNextClass({ items, studentId: student.id, status: student.status, now });
}

/** Total efectivamente cobrado al alumno (pagos y obligaciones vigentes). */
export async function loadStudentTotalCollected(ctx: AuthenticatedDbContext, studentId: string): Promise<number> {
  const [charges, payments, allocations] = await Promise.all([
    listChargesForStudent(ctx, studentId),
    listPaymentsForStudent(ctx, studentId),
    listAllocationsForStudent(ctx, studentId),
  ]);
  return totalCollectedForStudent({
    charges: charges.map((c) => ({ id: c.id, voidedAt: c.voidedAt })),
    payments: payments.map((p) => ({ id: p.id, voidedAt: p.voidedAt })),
    allocations: allocations.map((a) => ({ chargeId: a.chargeId, paymentId: a.paymentId, amount: a.amount })),
  });
}
