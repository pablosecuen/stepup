"use server";

import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getSignedLessonFileUrl, LessonFileNotAvailableError, LessonFileNotFoundError } from "@/lib/repositories/lesson-content";
import { actionErrorMessage } from "@/lib/errors/action-error";
import type { ActionResult } from "./lesson-registrations";

// Server Action — abrir un adjunto o un material de una clase. Nunca confía en una ruta ni en un identificador de cuenta que mande el cliente: sólo recibe el
// identificador del adjunto/material, y el repositorio verifica que sea de la cuenta de la sesión, que esté disponible y que su ruta cuelgue de esa cuenta.
// La URL es firmada y temporal (5 minutos), nunca una dirección pública permanente.
export async function openLessonFileAction(kind: "attachment" | "material", id: string): Promise<ActionResult<{ url: string }>> {
  try {
    if ((kind !== "attachment" && kind !== "material") || typeof id !== "string" || id.length === 0 || id.length > 64) return { error: "No encontramos ese archivo." };
    const ctx = await requireAuthenticatedDbContext();
    const url = await getSignedLessonFileUrl(ctx, kind, id);
    return { data: { url } };
  } catch (error) {
    if (error instanceof LessonFileNotFoundError) return { error: "No encontramos ese archivo." };
    if (error instanceof LessonFileNotAvailableError) return { error: "Este archivo todavía no está disponible." };
    return { error: actionErrorMessage("lesson-files", error) };
  }
}
