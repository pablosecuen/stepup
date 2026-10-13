/**
 * Registro seguro de la facturación (M1). UNA línea JSON por evento, con una lista cerrada de campos y valores que sólo pueden
 * ser códigos cortos: nunca cuerpos de avisos, encabezados, importes de una persona, correos, nombres, documentos, tarjetas,
 * claves, tokens, SQL ni mensajes de error del proveedor o de la base. Un valor que no tiene forma de código se reemplaza por
 * `redacted`: es imposible registrar un dato sensible por descuido.
 */
const ALLOWED_KEYS = ["reason", "code", "status", "provider", "worker", "kind", "method", "count", "attempts", "durationMs"] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

export type BillingLogFields = Partial<Record<AllowedKey, string | number | boolean | null>>;

const SAFE_CODE = /^[a-z0-9_:.\-]{1,64}$/i;

export function sanitizeLogFields(fields: BillingLogFields): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const key of ALLOWED_KEYS) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value === "string") clean[key] = SAFE_CODE.test(value) ? value : "redacted";
    else if (typeof value === "number") clean[key] = Number.isFinite(value) ? value : null;
    else clean[key] = value;
  }
  return clean;
}

export function formatBillingLog(scope: string, kind: string, fields: BillingLogFields = {}): string {
  return `[billing] ${JSON.stringify({ scope: SAFE_CODE.test(scope) ? scope : "redacted", kind: SAFE_CODE.test(kind) ? kind : "redacted", ...sanitizeLogFields(fields) })}`;
}

export function logBilling(scope: string, kind: string, fields: BillingLogFields = {}, level: "info" | "warn" | "error" = "info"): void {
  const line = formatBillingLog(scope, kind, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
