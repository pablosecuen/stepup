import type { RecoverySecrets } from "./recovery-marker.ts";

/**
 * Secreto de firma del marcador de recuperación (R4). Sólo se lee de variables de entorno del SERVIDOR (nunca `NEXT_PUBLIC_*`):
 *  - `RECOVERY_MARKER_SECRET`           secreto vigente (obligatorio en Production).
 *  - `RECOVERY_MARKER_SECRET_PREVIOUS`  secreto anterior, sólo durante una rotación (se acepta para validar, nunca para firmar).
 *
 * Qué pasa si falta o es inválido (mismo criterio de «fallar cerrado» que `config.ts`):
 *  - Desarrollo y pruebas locales (`NODE_ENV !== "production"`): se usa un secreto fijo de desarrollo, para poder trabajar sin
 *    configurar nada. No protege nada y nunca se usa en Production.
 *  - Production: NO hay firma posible. Un enlace de recuperación verificado no deja marcador (la persona ve un error controlado
 *    y la sesión que dejó el enlace se cierra) y cualquier marcador existente se considera inválido. Nunca se acepta uno sin firmar.
 * Nunca se imprime el valor: sólo el estado.
 */
export type RecoverySecretState = "ok" | "missing" | "invalid";

type Env = Record<string, string | undefined>;

export const RECOVERY_SECRET_MIN_LENGTH = 32;
const DEV_ONLY_SECRET = "tf-desarrollo-local-secreto-de-firma-sin-valor-real";
const PLACEHOLDER = /^(?:changeme|change-me|example|placeholder|your|secret|password|x{6,}|0{6,})/i;

function readEnv(env: Env, name: string): string | undefined {
  const trimmed = env[name]?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isUsable(value: string): boolean {
  if (value.length < RECOVERY_SECRET_MIN_LENGTH) return false;
  if (PLACEHOLDER.test(value)) return false;
  return new Set(value).size >= 8; // descarta cadenas repetidas ("aaaa…")
}

export function evaluateRecoverySecrets(env: Env = process.env): { state: RecoverySecretState; secrets: RecoverySecrets | null } {
  const current = readEnv(env, "RECOVERY_MARKER_SECRET");
  const previous = readEnv(env, "RECOVERY_MARKER_SECRET_PREVIOUS");

  if (!current) {
    if (env.NODE_ENV !== "production") return { state: "ok", secrets: { current: DEV_ONLY_SECRET } };
    return { state: "missing", secrets: null };
  }
  if (!isUsable(current)) return { state: "invalid", secrets: null };
  if (previous && !isUsable(previous)) return { state: "invalid", secrets: null };
  return { state: "ok", secrets: previous ? { current, previous } : { current } };
}

export function getRecoverySecrets(env: Env = process.env): RecoverySecrets | null {
  return evaluateRecoverySecrets(env).secrets;
}
