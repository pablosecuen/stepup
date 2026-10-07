"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { saveTeacherDisplayName } from "@/lib/repositories/teacher-profile";
import { saveBudgetDistributionSettings } from "@/lib/repositories/budget-distribution";
import { endActiveSession } from "@/lib/repositories/active-sessions";
import { deleteOwnAccount, removeOwnReportPdfs } from "@/lib/repositories/account-deletion";
import { verifyOwnPassword } from "@/lib/auth/reauth-supabase";
import { runDeleteAccount } from "@/lib/account/delete-account-flow";
import { normalizeBudgetDistribution } from "@/lib/payments/budget-distribution";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { consumeActionQuota } from "@/lib/repositories/action-quota";

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
  return actionErrorMessage("account", error);
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
export async function requestOwnPasswordChangeAction(captchaToken?: string): Promise<RequestPasswordChangeState> {
  const ctx = await requireAuthenticatedDbContext();
  const {
    data: { user },
  } = await ctx.supabase.auth.getUser();
  if (!user?.email) return { error: "No pudimos determinar tu correo." };

  // R3: el correo consume la cuota de envíos del proveedor — límite por cuenta en la base ANTES de pedirlo.
  try {
    await consumeActionQuota(ctx, "password_change_email");
  } catch (error) {
    return { error: actionErrorMessage("account", error) };
  }

  // Con CAPTCHA activo en Supabase, el pedido de recuperación también exige el token (se valida su forma antes de reenviarlo).
  const safeToken = typeof captchaToken === "string" && /^[0-9A-Za-z._-]{1,2048}$/.test(captchaToken) ? captchaToken : undefined;
  const result = await createSupabaseAuthAdapter().requestPasswordReset(user.email, { captchaToken: safeToken });
  if (!result.ok) return { error: result.error.message };
  return { sent: true };
}

// ---------------------------------------------------------------------------
// Eliminación de cuenta
// ---------------------------------------------------------------------------

/**
 * Mismo orden que móvil (`deleteAccount()`, `useAuthSession.ts`): primero borrar en el servidor, RECIÉN DESPUÉS cerrar sesión — si
 * el borrado falla, la cuenta sigue existiendo intacta y nunca se cierra sesión sobre una cuenta que en realidad sobrevivió.
 *
 * R4 (M-06): es una acción CRÍTICA e irreversible, así que exige reautenticación: la contraseña se vuelve a verificar contra
 * Supabase Auth en esta misma petición (una sesión robada no alcanza), la palabra de confirmación se valida acá (no sólo en el
 * navegador), el intento consume un límite por hora de la cuenta, y los PDF de reportes se borran de Storage y se comprueba que no
 * quede ninguno ANTES de eliminar la cuenta (la cascada de la base no llega a Storage). Ver `lib/account/delete-account-flow.ts`.
 */
export interface DeleteAccountInput {
  password: string;
  confirmation: string;
  captchaToken?: string;
}

export async function deleteOwnAccountAction(input: DeleteAccountInput): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const outcome = await runDeleteAccount(input ?? { password: "", confirmation: "" }, {
      getEmail: async () => (await ctx.supabase.auth.getUser()).data.user?.email ?? null,
      consumeReauthQuota: () => consumeActionQuota(ctx, "account_reauth"),
      verifyPassword: verifyOwnPassword,
      removePdfs: () => removeOwnReportPdfs(ctx),
      deleteAccount: () => deleteOwnAccount(ctx),
      errorMessage: friendlyErrorMessage,
    });
    if (!outcome.ok) return { error: outcome.error };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }

  await createSupabaseAuthAdapter().signOut();
  redirect("/login");
}
