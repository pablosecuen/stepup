/**
 * Lógica PURA sobre si un claim de generación activo (server-side, ver
 * `lib/repositories/report-drafts.ts`) sigue siendo válido para el pedido
 * actual, o quedó obsoleto y debe rotarse a un `operation_id` nuevo.
 *
 * Nunca rota un claim que sigue en curso (sin PDF todavía) — sólo un
 * reporte YA completo con meses distintos a los pedidos ahora se considera
 * obsoleto. Esto evita devolver silenciosamente un reporte viejo cuando la
 * usuaria pidió meses distintos sin haber liberado el claim anterior de
 * forma explícita (por ejemplo, si esa liberación explícita falló o
 * todavía no llegó a ejecutarse).
 */
export interface ExistingClaimedReport {
  selectedMonths: string[];
  pdfPath: string | null;
}

function normalizeMonths(months: string[]): string {
  return [...months].sort().join(",");
}

export function isClaimStaleForRequest(existing: ExistingClaimedReport | null, requestedMonths: string[]): boolean {
  if (!existing) return false;
  if (existing.pdfPath === null) return false;
  return normalizeMonths(existing.selectedMonths) !== normalizeMonths(requestedMonths);
}
