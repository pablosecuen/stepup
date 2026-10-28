"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { saveTeacherDisplayName } from "@/lib/repositories/teacher-profile";
import { getBudgetDistributionSettings, saveBudgetDistributionSettings } from "@/lib/repositories/budget-distribution";
import { adjustSavings, resetBudgetDistribution } from "@/lib/payments/budget-distribution";
import { parseSavingsGoalInput } from "@/lib/payments/savings-goal";
import { todayInArgentina } from "@/lib/format/date-format";
import { endActiveSession } from "@/lib/repositories/active-sessions";
import { deleteOwnAccount, removeOwnReportPdfs } from "@/lib/repositories/account-deletion";
import { verifyOwnPassword } from "@/lib/auth/reauth-supabase";
import { runDeleteAccount } from "@/lib/account/delete-account-flow";
import { parseBudgetDistributionInput } from "@/lib/payments/budget-suggestion";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { consumeActionQuota } from "@/lib/repositories/action-quota";
import { getBillingFlags, getBillingRuntime } from "@/lib/billing/runtime";
import { prepareAccountDeletion } from "@/lib/billing/account-deletion";
import { billingErrorMessage } from "@/lib/billing/safe-errors";

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
 * Recibe el valor final de las 3 barras (ya reconciliado en el cliente con `adjustNeeds`/`adjustWants`/`adjustSavings` mientras se
 * edita) y lo VALIDA en el servidor antes de tocar nada: los tres presentes, enteros de 0 a 100 y con suma exacta 100
 * (`parseBudgetDistributionInput`). Un valor parcial o inválido se rechaza entero, sin guardar nada. El guardado es un único
 * `upsert` de la fila de la profesora (atómico) y repetirlo con los mismos valores deja el mismo resultado (idempotente): reintentar
 * tras una respuesta perdida es seguro. La edición vive en el Resumen financiero («Ajustar porcentajes»).
 */
export async function saveBudgetDistributionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseBudgetDistributionInput({ needs: formData.get("needs"), wants: formData.get("wants"), savings: formData.get("savings") });
  if (!parsed.ok) return { error: parsed.error };
  const distribution = parsed.distribution;

  try {
    const ctx = await requireAuthenticatedDbContext();
    // El objetivo de ahorro NO se toca al cambiar los porcentajes: se conserva el que ya estaba guardado (también el importado de la app anterior).
    const current = await getBudgetDistributionSettings(ctx);
    await saveBudgetDistributionSettings(ctx, { distribution, savingsGoal: current.savingsGoal });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/resumen-financiero");
  return { saved: true };
}

/**
 * Objetivo de ahorro (monto y fecha objetivo; opcional, desactivado por defecto). Puede guardarse incompleto (activado sin monto o sin fecha), como en la app original. Nunca cambia los
 * porcentajes 50/30/20: conserva los guardados. Un único `upsert` de la fila de la profesora: atómico e idempotente.
 */
export async function saveSavingsGoalAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseSavingsGoalInput({ enabled: formData.get("enabled"), targetAmount: formData.get("targetAmount"), targetDate: formData.get("targetDate") }, todayInArgentina());
  if (!parsed.ok) return { error: parsed.error };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const current = await getBudgetDistributionSettings(ctx);
    await saveBudgetDistributionSettings(ctx, { distribution: current.distribution, savingsGoal: parsed.goal });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/resumen-financiero");
  return { saved: true };
}

/**
 * «Aplicar sugerencia» (porcentaje de ahorro que cubriría la reserva mensual del objetivo) y «Restablecer 50/30/20». Siempre con confirmación explícita de la profesora (botón propio) y
 * conservando el objetivo de ahorro. El porcentaje sugerido se reparte entre las otras dos barras con el mismo motor de siempre (`adjustSavings`: la suma queda en 100).
 */
export async function applyBudgetPresetAction(input: { kind: "reset" } | { kind: "savings"; percent: number }): Promise<FormState> {
  if (input.kind === "savings" && (!Number.isInteger(input.percent) || input.percent < 0 || input.percent > 100)) return { error: "El porcentaje de ahorro no es válido." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const current = await getBudgetDistributionSettings(ctx);
    const distribution = input.kind === "reset" ? resetBudgetDistribution() : adjustSavings(current.distribution, input.percent);
    await saveBudgetDistributionSettings(ctx, { distribution, savingsGoal: current.savingsGoal });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/resumen-financiero");
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
      // Con la facturación apagada no existe ese paso: el flujo de eliminación es exactamente el de siempre.
      cancelBilling: getBillingFlags().enabled
        ? async () => {
            const runtime = getBillingRuntime();
            if (!runtime.store) return { ok: false, error: billingErrorMessage("deletion_unconfirmed") };
            const prepared = await prepareAccountDeletion({ store: runtime.store, provider: runtime.provider, flags: runtime.flags, now: runtime.now }, ctx.ownerId);
            return prepared.ok ? { ok: true } : { ok: false, error: prepared.message };
          }
        : undefined,
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
