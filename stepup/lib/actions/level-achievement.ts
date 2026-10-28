"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listLevelHistory, recordLevelAchievement } from "@/lib/repositories/student-history";
import { levelAchievementPreview } from "@/lib/students/level-achievement";
import { todayInArgentina } from "@/lib/format/date-format";
import { parseOperationId } from "@/lib/calendar/operation-id";
import { actionErrorMessage } from "@/lib/errors/action-error";

export async function recordLevelAchievementAction(input: { studentId: string; operationId: string; level: string; date: string; note: string; confirmWarning: boolean; expectedLevel: string }): Promise<{ error?: string; saved?: boolean }> {
  try {
    if (!parseOperationId(input.operationId)) return { error: "Falta una clave válida para guardar. Cerrá y volvé a abrir el formulario." };
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, input.studentId);
    if (!student) return { error: "Alumno no encontrado." };
    const history = await listLevelHistory(ctx, student.id);
    // El repositorio resuelve primero los reintentos ya guardados.
    const alreadySaved = history.some((entry) => entry.id === input.operationId);
    const preview = levelAchievementPreview({ levels: student.levels, history, dateJoined: student.dateJoined, level: input.level, date: input.date, today: todayInArgentina() });
    if (!alreadySaved && preview.error) return { error: preview.error };
    if (!alreadySaved && preview.warning && !input.confirmWarning) return { error: preview.warning };
    await recordLevelAchievement(ctx, input);
    revalidatePath("/alumnos");
    revalidatePath(`/alumnos/${student.id}`);
    return { saved: true };
  } catch (error) {
    return { error: actionErrorMessage("level-achievement", error) };
  }
}
