import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
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
  const { data, error } = await ctx.supabase
    .from("student_status_history")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as StudentStatusHistoryRow[]).map(toStatusHistoryRecord);
}

export async function listLevelHistory(ctx: AuthenticatedDbContext, studentId: string): Promise<LevelHistoryRecord[]> {
  const { data, error } = await ctx.supabase
    .from("student_level_history")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .order("achieved_on", { ascending: false });
  if (error) throw error;
  return (data as StudentLevelHistoryRow[]).map(toLevelHistoryRecord);
}

export async function listPriceHistory(ctx: AuthenticatedDbContext, studentId: string): Promise<PriceHistoryRecord[]> {
  const { data, error } = await ctx.supabase
    .from("student_price_history")
    .select("*")
    .eq("owner_id", ctx.ownerId)
    .eq("student_id", studentId)
    .order("effective_on", { ascending: false });
  if (error) throw error;
  return (data as StudentPriceHistoryRow[]).map(toPriceHistoryRecord);
}
