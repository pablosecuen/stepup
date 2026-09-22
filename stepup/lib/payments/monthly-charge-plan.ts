/**
 * Puerto de `isStudentBillableForPeriod` (`monthlyChargeGenerationPlan.ts`,
 * móvil): un alumno `activo` siempre factura; uno inactivo sin fecha de
 * cambio de estado nunca factura; uno inactivo CON fecha de cambio factura
 * hasta el período de esa baja inclusive, nunca uno posterior. Reutilizada
 * tanto por la generación de mensualidades como por la de cuotas de
 * entrenamiento (`selectTrainingChargeCandidates`).
 */
export function isStudentBillableForPeriod(input: {
  status: "activo" | "pausado" | "inactivo" | "archivado";
  statusChangeDate: string | null; // YYYY-MM-DD
  billingPeriod: string; // YYYY-MM
}): boolean {
  if (input.status === "activo") return true;
  if (!input.statusChangeDate) return false;
  return input.statusChangeDate.slice(0, 7) >= input.billingPeriod;
}
