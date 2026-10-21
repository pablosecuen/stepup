/**
 * Ocurrencias de una serie que TeacherFlow anterior ya había REGISTRADO pero cuya clase de calendario no figura en el respaldo (el registro se importó completo, sin enlace, y quedó una incidencia
 * heredada con la clave de la ocurrencia). La app anterior las excluía de «clases por registrar» por su clave de reserva; la web las excluye con esta misma información, SIN crear clases ni
 * marcar nada como registrado: el registro ya existe. PURO.
 */

export interface LegacyIncidentLike {
  field?: string | null;
  detail?: unknown;
}
export interface RuleIdsLike {
  id: string;
  legacy_mobile_id: string | null;
}

/** Claves `<id de la serie en la web>|<clave de la ocurrencia con el id nuevo>` (la forma que genera el motor de la web). */
export function buildLegacyRegisteredOccurrenceKeys(incidents: readonly LegacyIncidentLike[], rules: readonly RuleIdsLike[]): Set<string> {
  const idByLegacy = new Map(rules.filter((r) => r.legacy_mobile_id).map((r) => [r.legacy_mobile_id as string, r.id]));
  const out = new Set<string>();
  for (const incident of incidents) {
    if (incident.field !== "calendarLessonId") continue;
    const detail = incident.detail as { ocurrencia?: unknown } | null | undefined;
    const key = typeof detail?.ocurrencia === "string" ? detail.ocurrencia : "";
    const separator = key.indexOf(":");
    if (separator <= 0) continue;
    const legacyRuleId = key.slice(0, separator);
    const ruleId = idByLegacy.get(legacyRuleId);
    if (!ruleId) continue;
    out.add(`${ruleId}|${ruleId}${key.slice(separator)}`);
  }
  return out;
}
