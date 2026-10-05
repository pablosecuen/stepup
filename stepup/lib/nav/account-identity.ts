/**
 * Identidad que muestra el shell (bloque de cuenta del escritorio y botón de cuenta del móvil).
 * Si el nombre falta o falló su carga, se muestra el correo; si tampoco hay correo, un texto neutro: el shell nunca se rompe.
 */
export interface AccountIdentityInput {
  displayName?: string | null;
  email?: string | null;
}

export interface AccountIdentity {
  /** Texto principal: el nombre, o el correo si no hay nombre. */
  primary: string;
  /** Texto secundario: el correo, sólo cuando hay nombre Y correo (si no, `null` para no repetir). */
  secondary: string | null;
  /** Inicial del avatar (una letra o número, en mayúscula). */
  initial: string;
}

export const FALLBACK_ACCOUNT_LABEL = "Mi cuenta";
export const FALLBACK_ACCOUNT_INITIAL = "T";

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function firstInitial(text: string): string {
  const match = text.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toLocaleUpperCase("es") : FALLBACK_ACCOUNT_INITIAL;
}

export function resolveAccountIdentity(input: AccountIdentityInput): AccountIdentity {
  const name = clean(input.displayName);
  const email = clean(input.email);
  if (name) return { primary: name, secondary: email || null, initial: firstInitial(name) };
  if (email) return { primary: email, secondary: null, initial: firstInitial(email) };
  return { primary: FALLBACK_ACCOUNT_LABEL, secondary: null, initial: FALLBACK_ACCOUNT_INITIAL };
}
