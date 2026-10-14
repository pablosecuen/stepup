import type { ProviderCustomer } from "./provider.ts";

/**
 * Datos de la persona que el proveedor exige al crear el suscriptor (decisión cerrada 3): nombre y DNI/CUIT, más el correo de la
 * sesión. Reglas:
 *  - se piden SÓLO al empezar la suscripción y viajan de servidor a Mobbex;
 *  - NO se persisten, no entran en registros, eventos, analítica ni mensajes de error; ningún mensaje repite lo que se escribió;
 *  - el documento nunca se completa con otros datos de la cuenta (alumnos, perfil): lo escribe la persona en ese momento;
 *  - la validación sólo mira la forma (largo y dígitos); la verificación real es del proveedor.
 */
export type CustomerField = "name" | "identification";

export type ParsedCustomer = { readonly ok: true; readonly customer: ProviderCustomer } | { readonly ok: false; readonly field: CustomerField; readonly message: string };

export const CUSTOMER_MESSAGES: Readonly<Record<CustomerField, string>> = {
  name: "Escribí tu nombre y apellido (entre 3 y 80 letras).",
  identification: "Escribí un DNI de 7 u 8 dígitos o un CUIT/CUIL de 11 dígitos, sólo números.",
};

const NAME_PATTERN = /^[\p{L}][\p{L}\p{M} '.-]{1,78}[\p{L}.]$/u;

/** Normaliza el documento: quita puntos, guiones y espacios; acepta DNI (7–8 dígitos) o CUIT/CUIL (11 dígitos). */
export function normalizeIdentification(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 20) return null;
  const digits = value.replace(/[.\-\s]/g, "");
  return /^[0-9]{7,8}$/.test(digits) || /^[0-9]{11}$/.test(digits) ? digits : null;
}

export function parseCheckoutCustomer(input: { readonly name: unknown; readonly identification: unknown }, email: string | null | undefined): ParsedCustomer {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 3 || name.length > 80 || !NAME_PATTERN.test(name)) return { ok: false, field: "name", message: CUSTOMER_MESSAGES.name };
  const identification = normalizeIdentification(input.identification);
  if (!identification) return { ok: false, field: "identification", message: CUSTOMER_MESSAGES.identification };
  const cleanEmail = typeof email === "string" ? email.trim() : "";
  if (!cleanEmail || cleanEmail.length > 254 || !cleanEmail.includes("@")) return { ok: false, field: "name", message: "No pudimos determinar el correo de tu cuenta. Volvé a iniciar sesión e intentá de nuevo." };
  return { ok: true, customer: { email: cleanEmail, name, identification } };
}
