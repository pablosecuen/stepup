"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { changeSingleLessonParticipants } from "@/lib/repositories/calendar-lessons";
import { actionErrorMessage } from "@/lib/errors/action-error";

export async function loadParticipantChoicesAction(): Promise<{ error?: string; students?: { id: string; name: string; level: string; status: string }[] }> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    return { students: (await listStudents(ctx)).map(s => ({ id: s.id, name: s.name, level: s.levels.join(", "), status: s.status })) };
  } catch { return { error: "No pudimos cargar los alumnos. Volvé a intentar." }; }
}

export async function changeSingleLessonParticipantsAction(input: { itemId: string; startAt: string; studentIds: string[]; expectedIds: string[] }): Promise<{ error?: string }> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const start = new Date(input.startAt);
    if (!Number.isFinite(start.getTime())) return { error: "La fecha de la clase no es válida." };
    // La hora sólo acota la búsqueda. Los datos a materializar se resuelven desde la agenda real, nunca desde el navegador.
    const items = await loadCalendarViewForRange(ctx, new Date(start.getTime()-86400000), new Date(start.getTime()+86400000), undefined, { includeTestData: true });
    const item = items.find(entry => entry.id === input.itemId);
    if (!item) return { error: "La clase cambió o ya no existe. Recargá el calendario." };
    const students = await listStudents(ctx);
    await changeSingleLessonParticipants(ctx, item, students, input.studentIds, input.expectedIds);
    for (const route of ["/calendario", "/inicio", "/alumnos", "/registro"]) revalidatePath(route);
    return {};
  } catch (error) { return { error: actionErrorMessage("lesson-participants", error) }; }
}
