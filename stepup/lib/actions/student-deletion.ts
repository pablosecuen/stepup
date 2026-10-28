"use server";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { actionErrorMessage } from "@/lib/errors/action-error";

export interface StudentDeletionImpact {
  id: string; name: string; token: string; classes: number; series: number;
  registrations: number; charges: number; payments: number; reports: number;
}

export async function previewStudentDeletion(id: string): Promise<{ impact?: StudentDeletionImpact; error?: string }> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const { data, error } = await ctx.supabase.rpc("preview_student_deletion", { p_student: id });
    if (error) throw error;
    return { impact: data as StudentDeletionImpact };
  } catch (error) { return { error: actionErrorMessage("student-delete-preview", error) }; }
}

/** Sólo elimina objetos sin referencias; la cola sobrevive a fallos de red o Storage. */
export async function sweepStudentFilesAction() {
  const ctx = await requireAuthenticatedDbContext();
  const { data, error } = await ctx.supabase.from("student_file_cleanup_jobs").select("id,bucket,path").eq("owner_id", ctx.ownerId).limit(50);
  if (error) return;
  for (const job of data ?? []) {
    if (!job.path.startsWith(`${ctx.ownerId}/`)) continue;
    const table = job.bucket === "report-pdfs" ? "report_records" : "lesson_attachments";
    const column = job.bucket === "report-pdfs" ? "pdf_url" : "storage_path";
    const { data: refs, error: checkError } = await ctx.supabase.from(table).select("id").eq("owner_id", ctx.ownerId).eq(column, job.path).limit(1);
    if (checkError || refs?.length) continue;
    // Un material de biblioteca puede compartir el mismo archivo de una foto.
    if (job.bucket === "lesson-files") {
      const { data: materials, error: materialError } = await ctx.supabase.from("material_library_items").select("id").eq("owner_id", ctx.ownerId).eq("storage_path", job.path).limit(1);
      if (materialError || materials?.length) continue;
    }
    const { error: removeError } = await ctx.supabase.storage.from(job.bucket).remove([job.path]);
    if (!removeError) await ctx.supabase.from("student_file_cleanup_jobs").delete().eq("owner_id", ctx.ownerId).eq("id", job.id);
  }
}

export async function deleteStudentPermanently(input: { id: string; token: string; operationId: string; confirmation: string }) {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const { error } = await ctx.supabase.rpc("delete_student_permanently", { p_student: input.id, p_token: input.token, p_operation: input.operationId, p_confirmation: input.confirmation });
    if (error) throw error;
    await sweepStudentFilesAction().catch(() => {});
    revalidatePath("/", "layout");
    return {};
  } catch (error) { return { error: actionErrorMessage("student-delete", error) }; }
}
