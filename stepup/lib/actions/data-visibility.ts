"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { setTestDataHidden } from "@/lib/repositories/excluded-students";
import { actionErrorMessage } from "@/lib/errors/action-error";

// Server Actions — mostrar u ocultar los datos de prueba confirmados (R16). Nunca reciben el dueño de los datos desde el navegador. Nunca borran nada: sólo cambian si la exclusión está vigente o revocada.

export interface DataVisibilityState {
  error?: string;
  /** Qué quedó hecho en el último intento exitoso. */
  done?: "shown" | "hidden";
}

const SCREENS = ["/inicio", "/calendario", "/calendario/series", "/alumnos", "/registro", "/recordatorios", "/resumen-financiero", "/configuracion", "/configuracion/datos-de-prueba"];

async function change(hidden: boolean): Promise<DataVisibilityState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await setTestDataHidden(ctx, hidden);
  } catch (error) {
    return { error: actionErrorMessage("account", error) };
  }
  for (const path of SCREENS) revalidatePath(path);
  return { done: hidden ? "hidden" : "shown" };
}

export async function showTestDataAction(_prev: DataVisibilityState, _formData?: FormData): Promise<DataVisibilityState> {
  return change(false);
}

export async function hideTestDataAction(_prev: DataVisibilityState, _formData?: FormData): Promise<DataVisibilityState> {
  return change(true);
}
