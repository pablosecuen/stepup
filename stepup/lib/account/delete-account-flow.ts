import { ReportPdfCleanupIncompleteError } from "../repositories/report-pdf-storage.ts";
import type { PasswordCheck } from "../auth/reauth.ts";
import { AUTH_ERROR_MESSAGES } from "../auth/error-messages.ts";

/**
 * Orquestación PURA de la eliminación de cuenta (R4, hallazgo M-06). La Server Action sólo inyecta las dependencias reales; las
 * pruebas inyectan unas en memoria y comprueban el ORDEN, que es lo que protege:
 *
 *   1. la confirmación («ELIMINAR») y la contraseña se validan en el SERVIDOR (antes sólo la palabra se validaba en el navegador);
 *   2. se consume el límite por hora de reautenticación (la base, por cuenta) ANTES de verificar la contraseña: una sesión robada no
 *      puede probar contraseñas sin fin a través de la web;
 *   3. se verifica la contraseña contra Supabase Auth (reautenticación);
 *   4. se borran TODOS los PDF de la cuenta en Storage y se comprueba que no quede ninguno;
 *   5. recién entonces se elimina la cuenta (`delete_own_account`).
 *
 * Si cualquier paso anterior falla, los siguientes NO se ejecutan y la cuenta queda intacta. Si el borrado de la cuenta falla después
 * de borrar los PDF, la cuenta sigue existiendo (los PDF se pueden volver a generar desde Reportes). Sin registrar datos personales.
 */
export const DELETE_ACCOUNT_CONFIRM_WORD = "ELIMINAR";

export interface DeleteAccountDeps {
  getEmail(): Promise<string | null>;
  consumeReauthQuota(): Promise<void>;
  verifyPassword(email: string, password: string, captchaToken?: string): Promise<PasswordCheck>;
  removePdfs(): Promise<void>;
  deleteAccount(): Promise<void>;
  /** Traduce un error inesperado a un texto para la persona (nunca el error crudo). */
  errorMessage(error: unknown): string;
}

export type DeleteAccountOutcome = { ok: true } | { ok: false; error: string };

export const DELETE_ACCOUNT_MESSAGES = {
  confirmation: `Escribí ${DELETE_ACCOUNT_CONFIRM_WORD} para confirmar.`,
  passwordRequired: "Ingresá tu contraseña para confirmar.",
  wrongPassword: "La contraseña no es correcta.",
  unavailable: "No pudimos verificar tu contraseña ahora. Tu cuenta no se eliminó; probá de nuevo en unos minutos.",
  noEmail: "No pudimos determinar tu correo.",
  pdfIncomplete: "No pudimos eliminar todos tus archivos. Tu cuenta NO se eliminó; volvé a intentarlo.",
} as const;

const MAX_PASSWORD_LENGTH = 1024;
const CAPTCHA_TOKEN = /^[0-9A-Za-z._-]{1,2048}$/;

export async function runDeleteAccount(input: { password: unknown; confirmation: unknown; captchaToken?: unknown }, deps: DeleteAccountDeps): Promise<DeleteAccountOutcome> {
  if (typeof input.confirmation !== "string" || input.confirmation.trim() !== DELETE_ACCOUNT_CONFIRM_WORD) {
    return { ok: false, error: DELETE_ACCOUNT_MESSAGES.confirmation };
  }
  if (typeof input.password !== "string" || input.password.length === 0 || input.password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: DELETE_ACCOUNT_MESSAGES.passwordRequired };
  }
  const captchaToken = typeof input.captchaToken === "string" && CAPTCHA_TOKEN.test(input.captchaToken) ? input.captchaToken : undefined;

  let email: string | null;
  try {
    email = await deps.getEmail();
  } catch (error) {
    return { ok: false, error: deps.errorMessage(error) };
  }
  if (!email) return { ok: false, error: DELETE_ACCOUNT_MESSAGES.noEmail };

  try {
    await deps.consumeReauthQuota();
  } catch (error) {
    return { ok: false, error: deps.errorMessage(error) };
  }

  const check = await deps.verifyPassword(email, input.password, captchaToken);
  if (!check.ok) {
    switch (check.reason) {
      case "wrong_password":
        return { ok: false, error: DELETE_ACCOUNT_MESSAGES.wrongPassword };
      case "captcha_failed":
        return { ok: false, error: AUTH_ERROR_MESSAGES.captcha_failed };
      case "rate_limited":
        return { ok: false, error: AUTH_ERROR_MESSAGES.rate_limited };
      default:
        return { ok: false, error: DELETE_ACCOUNT_MESSAGES.unavailable };
    }
  }

  try {
    await deps.removePdfs();
  } catch (error) {
    if (error instanceof ReportPdfCleanupIncompleteError) return { ok: false, error: DELETE_ACCOUNT_MESSAGES.pdfIncomplete };
    return { ok: false, error: deps.errorMessage(error) };
  }

  try {
    await deps.deleteAccount();
  } catch (error) {
    return { ok: false, error: deps.errorMessage(error) };
  }
  return { ok: true };
}
