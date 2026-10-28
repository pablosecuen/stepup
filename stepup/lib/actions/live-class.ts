"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { correctLiveClassStart, discardLiveClass, finishLiveClass, startLiveClass } from "@/lib/repositories/live-class";
import { startRegistrationAction } from "@/lib/actions/lesson-registrations";
import { instantFromClockTime } from "@/lib/live-class/live-class";
import { actionErrorMessage } from "@/lib/errors/action-error";
import type { StudentArrival } from "@/lib/payments/engine/features/new-class/types";

// Server Actions — «Clase en curso». Nunca reciben la dueña del navegador: la sesión se resuelve acá. Cada operación es idempotente en la base (reintento, doble toque, otra pestaña).

export interface ActionResult<T = undefined> {
  error?: string;
  data?: T;
}

export interface StartLiveClassActionInput {
  calendarLessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
  arrival: StudentArrival;
}

/**
 * «Comenzar clase». Primero asegura la clase y el registro en borrador de ESA ocurrencia (la misma operación idempotente de «Registrar»: materializa la ocurrencia si hace falta, nunca la duplica) y
 * después abre la sesión. Si el segundo paso falla, el primero queda como cualquier registro en borrador (sin datos): se puede reintentar o registrar la clase normalmente.
 */
export async function startLiveClassAction(input: StartLiveClassActionInput): Promise<ActionResult> {
  try {
    const started = await startRegistrationAction({ calendarLessonId: input.calendarLessonId, recurrenceId: input.recurrenceId, occurrenceKey: input.occurrenceKey, recurrenceIndex: input.recurrenceIndex });
    if (started.error || !started.data) return { error: started.error ?? "No pudimos preparar la clase." };
    const ctx = await requireAuthenticatedDbContext();
    await startLiveClass(ctx, started.data.calendarLessonId, input.arrival);
    revalidatePath("/inicio");
    return {};
  } catch (error) {
    return { error: actionErrorMessage("live-class", error) };
  }
}

/** «Corregir hora de inicio»: `time` es HH:mm de hoy (hora de Argentina). */
export async function correctLiveClassStartAction(input: { time: string }): Promise<ActionResult> {
  try {
    const instant = instantFromClockTime(new Date().toISOString(), input.time);
    if (!instant) return { error: "Ingresá una hora válida." };
    const ctx = await requireAuthenticatedDbContext();
    await correctLiveClassStart(ctx, instant);
    revalidatePath("/inicio");
    return {};
  } catch (error) {
    return { error: actionErrorMessage("live-class", error) };
  }
}

/** Descarta la clase en curso sin registrar nada. */
export async function discardLiveClassAction(): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await discardLiveClass(ctx);
    revalidatePath("/inicio");
    return {};
  } catch (error) {
    return { error: actionErrorMessage("live-class", error) };
  }
}

/** «Finalizar clase»: cierra la sesión, vuelca los tiempos reales y la puntualidad al registro en borrador y devuelve a qué registro seguir. */
export async function finishLiveClassAction(): Promise<ActionResult<{ calendarLessonId: string; elapsedMinutes: number }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const finished = await finishLiveClass(ctx);
    revalidatePath("/inicio");
    return { data: { calendarLessonId: finished.calendarLessonId, elapsedMinutes: finished.elapsedMinutes } };
  } catch (error) {
    return { error: actionErrorMessage("live-class", error) };
  }
}
