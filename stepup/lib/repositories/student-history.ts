import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable } from "@/lib/db/read";
import type { StudentLevelHistoryRow, StudentPriceHistoryRow, StudentStatusHistoryRow } from "@/lib/db/database.types";
import {
  toStatusHistoryRecord,
  toLevelHistoryRecord,
  toPriceHistoryRecord,
  type StatusHistoryRecord,
  type LevelHistoryRecord,
  type PriceHistoryRecord,
} from "./student-history-mapping";

/**
 * Repositorio de historial de alumno (estado/nivel/precio) — append-only,
 * nunca expone update/delete. Único punto de lectura de
 * `student_status_history`/`student_level_history`/`student_price_history`.
 */
export async function listStatusHistory(ctx: AuthenticatedDbContext, studentId: string): Promise<StatusHistoryRecord[]> {
  const data = await readTable<StudentStatusHistoryRow>(ctx.supabase, "student_status_history", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    order: [
      { column: "occurred_on", ascending: false },
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ],
  });
  return data.map(toStatusHistoryRecord);
}

export async function listLevelHistory(ctx: AuthenticatedDbContext, studentId: string): Promise<LevelHistoryRecord[]> {
  const data = await readTable<StudentLevelHistoryRow>(ctx.supabase, "student_level_history", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    order: [
      { column: "achieved_on", ascending: false },
      { column: "id", ascending: false },
    ],
  });
  return data.map(toLevelHistoryRecord);
}

export async function listPriceHistory(ctx: AuthenticatedDbContext, studentId: string): Promise<PriceHistoryRecord[]> {
  const data = await readTable<StudentPriceHistoryRow>(ctx.supabase, "student_price_history", {
    filter: (query) => query.eq("owner_id", ctx.ownerId).eq("student_id", studentId),
    order: [
      { column: "effective_on", ascending: false },
      { column: "id", ascending: false },
    ],
  });
  return (data as StudentPriceHistoryRow[]).map(toPriceHistoryRecord);
}

export async function recordLevelAchievement(ctx: AuthenticatedDbContext, input: { studentId: string; operationId: string; level: string; date: string; note: string; confirmWarning: boolean; expectedLevel: string }): Promise<void> {
  const { error } = await ctx.supabase.rpc("record_student_level_achievement", {
    p_student_id: input.studentId, p_operation_id: input.operationId,
    p_level: input.level, p_achieved_on: input.date, p_note: input.note,
    p_confirm_warning: input.confirmWarning, p_expected_level: input.expectedLevel,
  });
  if (error) throw new Error(error.message);
}
