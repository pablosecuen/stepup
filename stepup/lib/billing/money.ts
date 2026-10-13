import { MINOR_UNITS_PER_PESO } from "./plans.ts";

/**
 * Importes del módulo de facturación. Todo se guarda y se compara en centavos ENTEROS; los decimales sólo existen en los bordes
 * (lo que se le envía al proveedor y lo que se lee de él), y se convierten acá con aritmética entera, nunca con `x * 100` en
 * coma flotante (`19.99 * 100 === 1998.9999999999998`).
 */

/** Centavos → texto decimal con punto, el formato que pide el proveedor (`24900.00`). */
export function minorToProviderDecimal(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError("Importe inválido.");
  const pesos = Math.trunc(amountMinor / MINOR_UNITS_PER_PESO);
  const cents = amountMinor % MINOR_UNITS_PER_PESO;
  return `${pesos}.${String(cents).padStart(2, "0")}`;
}

/**
 * Importe que informa el proveedor (número o texto, hasta 2 decimales) → centavos enteros. `null` ante cualquier valor que no sea
 * un importe finito, no negativo y con a lo sumo dos decimales: ante la duda se rechaza, nunca se redondea.
 */
export function providerAmountToMinor(value: unknown): number | null {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : typeof value === "string" ? value.trim() : "";
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const minor = Number(match[1]) * MINOR_UNITS_PER_PESO + cents;
  return Number.isSafeInteger(minor) ? minor : null;
}
