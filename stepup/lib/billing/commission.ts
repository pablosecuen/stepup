/**
 * Costo estimado del proveedor de cobros (informativo; NO interviene en ningún cobro ni en ningún precio).
 *
 *   comisión publicada ................. 3,9 %
 *   IVA sobre la comisión (21 %) ....... 3,9 % × 1,21 = 4,719 %
 *   costo efectivo estimado ............ 4,719 %  (4.719 / 100.000)
 *
 * El neto estimado es el precio menos ese costo efectivo, en centavos y con redondeo al centavo más cercano (mitades hacia
 * arriba), con aritmética entera. Las retenciones y percepciones fiscales —que dependen de la condición tributaria de la cuenta
 * que cobra— pueden reducir el neto real y NO están incluidas.
 */
export const PROVIDER_FEE_PERCENT_PUBLISHED = 3.9;
export const PROVIDER_FEE_VAT_PERCENT = 21;
/** 4,719 % expresado en cienmilésimos (3,9 % × 1,21 = 4,719 %). */
export const EFFECTIVE_FEE_PER_100_000 = 4_719;

export interface FeeEstimate {
  readonly grossMinor: number;
  readonly feeMinor: number;
  readonly netMinor: number;
}

export function estimateNet(grossMinor: number): FeeEstimate {
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) throw new RangeError("Importe inválido.");
  // Mitades hacia arriba sin pasar por decimales: floor((x * 4719 + 50_000) / 100_000).
  const feeMinor = Math.floor((grossMinor * EFFECTIVE_FEE_PER_100_000 + 50_000) / 100_000);
  return { grossMinor, feeMinor, netMinor: grossMinor - feeMinor };
}
