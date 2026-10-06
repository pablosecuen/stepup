"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { saveTeacherDisplayName, InvalidTeacherNameError } from "@/lib/repositories/teacher-profile";
import { saveBudgetDistributionSettings } from "@/lib/repositories/budget-distribution";
import { endActiveSession, ActiveSessionMismatchError } from "@/lib/repositories/active-sessions";
import { deleteOwnAccount } from "@/lib/repositories/account-deletion";
import { normalizeBudgetDistribution } from "@/lib/payments/budget-distribution";

// Server Actions — Cuenta/Configuración (Fase 8). Mismo patrón que
// `lib/actions/students.ts`: nunca reciben `ownerId` del navegador,
// `requireAuthenticatedDbContext()` siempre resuelve la sesión real en el
// servidor; toda mutación pasa por `lib/repositories/*`.

export interface FormState {
  error?: string;
  /** Un guardado terminó bien (la pantalla lo anuncia hasta que la persona vuelva a editar). */
  saved?: boolean;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

// ---------------------------------------------------------------------------
// Perfil de la profesora
// ---------------------------------------------------------------------------

export async function saveTeacherProfileAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const displayName = readString(formData, "displayName");
  try {
    const ctx = await requireAuthenticatedDbContext();
    await saveTeacherDisplayName(ctx, displayName);
  } catch (error) {
    if (error instanceof InvalidTeacherNameError) return { error: error.message };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/configuracion");
  return { saved: true };
}

// ---------------------------------------------------------------------------
// Distribución 50/30/20
// ---------------------------------------------------------------------------

/**
 * Recibe el valor final de las 3 barras (ya reconciliado en el cliente con
 * `adjustNeeds`/`adjustWants`/`adjustSavings` mientras se arrastra) y lo
 * vuelve a pasar por `normalizeBudgetDistribution` server-side antes de
 * guardar — nunca confía en que la suma 100 ya venga garantizada del
 * cliente, aunque en la práctica siempre debería.
 */
export async function saveBudgetDistributionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const needs = Number(readString(formData, "needs"));
  const wants = Number(readString(formData, "wants"));
  const savings = Number(readString(formData, "savings"));
  const distribution = normalizeBudgetDistribution({ needs, wants, savings });

  try {
    const ctx = await requireAuthenticatedDbContext();
    await saveBudgetDistributionSettings(ctx, {
      distribution,
      savingsGoal: { enabled: false, targetAmount: null, targetDate: null },
    });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/configuracion");
  return { saved: true };
}

// ---------------------------------------------------------------------------
// Sesión activa
// ---------------------------------------------------------------------------

export interface EndSessionFormState extends FormState {
  success?: boolean;
}

export async function endActiveSessionAction(deviceId: string, generation: number): Promise<EndSessionFormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await endActiveSession(ctx, deviceId, generation);
  } catch (error) {
    if (error instanceof ActiveSessionMismatchError) return { error: error.message };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/configuracion");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Cambiar contraseña (desde una sesión ya iniciada)
// ---------------------------------------------------------------------------

export interface RequestPasswordChangeState extends FormState {
  sent?: boolean;
}

/**
 * `/recuperar-contrasena` redirige si ya hay sesión (es la pantalla para
 * profesoras SIN sesión) — así que "cambiar contraseña" desde Configuración
 * llama directo al mismo adaptador real (`requestPasswordReset`) con el
 * correo de la sesión activa, sin pasar por esa página. Mismo email real,
 * nunca uno provisto por el cliente.
 */
export async function requestOwnPasswordChangeAction(): Promise<RequestPasswordChangeState> {
  const ctx = await requireAuthenticatedDbContext();
  const {
    data: { user },
  } = await ctx.supabase.auth.getUser();
  if (!user?.email) return { error: "No pudimos determinar tu correo." };

  const result = await createSupabaseAuthAdapter().requestPasswordReset(user.email);
  if (!result.ok) return { error: result.error.message };
  return { sent: true };
}

// ---------------------------------------------------------------------------
// Eliminación de cuenta
// ---------------------------------------------------------------------------

/**
 * Mismo orden que móvil (`deleteAccount()`, `useAuthSession.ts`): primero
 * borrar en el servidor, RECIÉN DESPUÉS cerrar sesión — si el borrado falla,
 * la cuenta sigue existiendo intacta y nunca se cierra sesión sobre una
 * cuenta que en realidad sobrevivió.
 */
export async function deleteOwnAccountAction(): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await deleteOwnAccount(ctx);
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }

  await createSupabaseAuthAdapter().signOut();
  redirect("/login");
}
