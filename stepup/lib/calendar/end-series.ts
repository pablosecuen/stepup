import { addDaysToDateKey } from "./timezone.ts";
import { listPredecessorsRunningFrom } from "./lineage.ts";
import type { RuleForLineage } from "./lineage.ts";

/**
 * «Esta y todas las series»: quita la serie ELEGIDA (su tramo vigente y los tramos anteriores que todavía generan clases) desde una fecha — por defecto hoy — y nada más: las demás series de la cuenta
 * y de los mismos alumnos no se tocan. Igual que la app original («Eliminar esta y todas las siguientes»): lo anterior a la fecha se conserva (se le pone fecha de fin el día anterior); un tramo que
 * todavía no había empezado se cierra por estado. PURO: sólo decide qué reglas se cortan y cuáles se cierran.
 */
export interface EndSeriesPlan {
  /** Reglas que ya tenían clases antes de la fecha: se les pone fecha de fin = día anterior. */
  truncate: { id: string; endDate: string }[];
  /** Reglas que empezaban en o después de la fecha: se cierran (nunca se fabrica una fecha de fin anterior al inicio). */
  end: string[];
}

export function planEndSeriesFromDate<T extends RuleForLineage & { id: string; startDate: string }>(rules: T[], headId: string, effectiveDate: string): EndSeriesPlan | null {
  const head = rules.find((rule) => rule.id === headId);
  if (!head || head.status === "ended") return null;
  const affected = [head, ...listPredecessorsRunningFrom(rules, head.recurrenceId, effectiveDate)];
  const cutoff = addDaysToDateKey(effectiveDate, -1);
  const plan: EndSeriesPlan = { truncate: [], end: [] };
  for (const rule of affected) {
    if (rule.status === "ended") continue;
    if (rule.startDate < effectiveDate) plan.truncate.push({ id: rule.id, endDate: cutoff });
    else plan.end.push(rule.id);
  }
  return plan;
}
