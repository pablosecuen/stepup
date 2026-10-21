import "server-only";
import type { AuthenticatedDbContext } from "../db/server-context.ts";
import { readTable } from "../db/read.ts";
import { isMissingTableError } from "../transfer/export-destination.ts";
import { NO_EXCLUDED_STUDENTS } from "../data-exclusion/exclusion.ts";
import { buildTestDataSummary, type TestDataExclusionRow, type TestDataSummary } from "../data-exclusion/summary.ts";

/**
 * Alumnos de PRUEBA confirmados (R16) cuyos datos se excluyen de agenda, pendientes, estadísticas y listas. Sólo lectura, siempre por la cuenta de la sesión. Sin la tabla (migración sin aplicar) o sin filas
 * vigentes devuelve vacío: la aplicación se comporta exactamente como siempre. Una exclusión revocada (`revoked_at`) deja de aplicarse.
 */
export async function loadExcludedStudentIds(ctx: AuthenticatedDbContext): Promise<ReadonlySet<string>> {
  try {
    const rows = await readTable<{ id: string; student_id: string }>(ctx.supabase, "test_data_exclusions", {
      columns: "id, student_id",
      filter: (query) => query.eq("owner_id", ctx.ownerId).is("revoked_at", null),
    });
    return rows.length === 0 ? NO_EXCLUDED_STUDENTS : new Set(rows.map((row) => row.student_id));
  } catch (error) {
    if (isMissingTableError(error)) return NO_EXCLUDED_STUDENTS;
    throw error;
  }
}

async function readExclusionRows(ctx: AuthenticatedDbContext): Promise<TestDataExclusionRow[]> {
  try {
    return await readTable<TestDataExclusionRow>(ctx.supabase, "test_data_exclusions", {
      columns: "id, student_id, reason, evidence, created_at, revoked_at",
      filter: (query) => query.eq("owner_id", ctx.ownerId),
    });
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

/** Qué hay marcado como prueba (visible u oculto) y cuánto cuelga de cada alumno, para consultarlo y revertirlo desde la pantalla. Nunca modifica nada. */
export async function loadTestDataSummary(ctx: AuthenticatedDbContext): Promise<TestDataSummary> {
  const exclusions = await readExclusionRows(ctx);
  if (exclusions.length === 0) return buildTestDataSummary({ exclusions, students: [], ruleLinks: [], lessonLinks: [], registrationLinks: [], charges: [] });
  const studentIds = [...new Set(exclusions.map((row) => row.student_id))];
  const byStudent = (query: any) => query.eq("owner_id", ctx.ownerId).in("student_id", studentIds);
  const [students, ruleLinks, lessonLinks, registrationLinks, charges] = await Promise.all([
    readTable<{ id: string; name: string; status: string; created_at: string }>(ctx.supabase, "students", { columns: "id, name, status, created_at", filter: (query: any) => query.eq("owner_id", ctx.ownerId).in("id", studentIds) }),
    readTable<{ student_id: string; recurrence_rule_id: string }>(ctx.supabase, "recurrence_rule_participants", { columns: "id, student_id, recurrence_rule_id", filter: byStudent }),
    readTable<{ student_id: string; calendar_lesson_id: string }>(ctx.supabase, "calendar_lesson_participants", { columns: "id, student_id, calendar_lesson_id", filter: byStudent }),
    readTable<{ student_id: string; lesson_registration_id: string }>(ctx.supabase, "lesson_registration_students", { columns: "id, student_id, lesson_registration_id", filter: byStudent }),
    readTable<{ student_id: string; voided_at: string | null }>(ctx.supabase, "payment_charges", { columns: "id, student_id, voided_at", filter: byStudent }),
  ]);
  return buildTestDataSummary({ exclusions, students, ruleLinks, lessonLinks, registrationLinks, charges });
}

/**
 * Oculta o vuelve a mostrar los datos de prueba. NUNCA borra nada: «mostrar» marca como revocadas las exclusiones vigentes; «ocultar» reactiva con una fila nueva (copia de la última de cada alumno).
 * Devuelve cuántos alumnos cambiaron de estado.
 */
export async function setTestDataHidden(ctx: AuthenticatedDbContext, hidden: boolean): Promise<number> {
  const rows = await readExclusionRows(ctx);
  if (!hidden) {
    const { data, error } = await ctx.supabase.from("test_data_exclusions").update({ revoked_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).is("revoked_at", null).select("id");
    if (error) throw error;
    return (data ?? []).length;
  }
  const activeStudents = new Set(rows.filter((row) => row.revoked_at === null).map((row) => row.student_id));
  const latestByStudent = new Map<string, TestDataExclusionRow>();
  [...rows]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .forEach((row) => {
      if (!activeStudents.has(row.student_id)) latestByStudent.set(row.student_id, row);
    });
  const inserts = [...latestByStudent.values()].map((row) => ({ owner_id: ctx.ownerId, student_id: row.student_id, reason: row.reason, evidence: row.evidence }));
  if (inserts.length === 0) return 0;
  const { error } = await ctx.supabase.from("test_data_exclusions").insert(inserts);
  if (error) throw error;
  return inserts.length;
}
