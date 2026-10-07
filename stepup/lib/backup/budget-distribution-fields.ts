/**
 * Distribución 50/30/20 en el asistente de importación (PURO: sin React, sin red).
 *
 * Los tres porcentajes (necesidades, gustos y ahorro) tienen que sumar siempre 100, así que NUNCA se reemplaza uno solo: la pantalla los muestra como UNA
 * decisión («Distribución 50/30/20») y marcar o desmarcar esa decisión mueve los tres campos a la vez. La base lo vuelve a exigir (suma final = 100, en una
 * sola escritura), pero acá se evita que la usuaria llegue a un estado que la base tendría que rechazar.
 */
export const BUDGET_PERCENT_FIELDS = ["needs_percent", "wants_percent", "savings_percent"] as const;

/** Campo de pantalla que representa a los tres porcentajes juntos (no existe como columna). */
export const BUDGET_DISTRIBUTION_FIELD = "distribution";

export const BUDGET_TABLE = "budget_distribution_settings";

type Diff = { web: unknown; backup: unknown };

function joinPercents(values: Record<string, unknown>): string {
  return BUDGET_PERCENT_FIELDS.map((field) => String(values[field] ?? "—")).join("/");
}

/** Los tres porcentajes de la web y de la copia como «50/30/20»; el resto de los campos se muestran como siempre. */
export function groupBudgetFields(web: Record<string, unknown>, backup: Record<string, unknown>): Record<string, Diff> {
  const out: Record<string, Diff> = {};
  const percentsDiffer = BUDGET_PERCENT_FIELDS.some((field) => web[field] !== backup[field]);
  if (percentsDiffer) out[BUDGET_DISTRIBUTION_FIELD] = { web: joinPercents(web), backup: joinPercents(backup) };
  for (const key of Object.keys(web)) {
    if ((BUDGET_PERCENT_FIELDS as readonly string[]).includes(key)) continue;
    out[key] = { web: web[key], backup: backup[key] };
  }
  return out;
}

/** La decisión «Distribución» está marcada cuando están marcados los tres porcentajes. */
export function isDistributionSelected(selected: ReadonlySet<string>): boolean {
  return BUDGET_PERCENT_FIELDS.every((field) => selected.has(field));
}

/** Lo que la pantalla ve como marcado: los porcentajes sueltos desaparecen y queda la decisión agrupada. */
export function groupedSelection(selected: ReadonlySet<string>): Set<string> {
  const out = new Set([...selected].filter((field) => !(BUDGET_PERCENT_FIELDS as readonly string[]).includes(field)));
  if (isDistributionSelected(selected)) out.add(BUDGET_DISTRIBUTION_FIELD);
  return out;
}

/** Marca (o desmarca) los tres porcentajes juntos. Devuelve un conjunto nuevo. */
export function toggleDistribution(selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (isDistributionSelected(selected)) for (const field of BUDGET_PERCENT_FIELDS) next.delete(field);
  else for (const field of BUDGET_PERCENT_FIELDS) next.add(field);
  return next;
}
