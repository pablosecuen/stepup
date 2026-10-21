/**
 * Control de la vista previa de la importación (PURO): el traslado sólo avanza si no hay conflictos, posibles duplicados ni filas que no se puedan agregar. Misma lectura de
 * la clasificación que usa el ensayo (`real_rehearsal.cjs`); sólo informa cantidades e identificadores de origen, nunca nombres ni importes.
 */

type Rows = Array<Record<string, unknown>>;
const list = (value: unknown): Rows => (Array.isArray(value) ? (value as Rows) : []);

export interface PreviewCheck {
  ok: boolean;
  studentsToAdd: number;
  conflicts: number;
  duplicates: number;
  notInsertable: Array<{ aggregate: string; id: string; reason: string }>;
  omittedByAdapter: number;
  reasons: string[];
}

export function checkImportPreview(classification: unknown, omittedByAdapter: number): PreviewCheck {
  const c = (classification ?? {}) as { maestros?: Record<string, { inserts?: unknown; conflicts?: unknown; duplicates?: unknown }>; aggregates?: Record<string, unknown> };
  let conflicts = 0;
  let duplicates = 0;
  for (const group of Object.values(c.maestros ?? {})) {
    conflicts += list(group?.conflicts).length;
    duplicates += list(group?.duplicates).length;
  }
  const notInsertable: PreviewCheck["notInsertable"] = [];
  for (const [aggregate, rows] of Object.entries(c.aggregates ?? {})) {
    for (const row of list(rows)) {
      if (row.status !== "insertable") notInsertable.push({ aggregate, id: String(row.legacy_mobile_id ?? "?"), reason: String(row.reason ?? row.status ?? "?") });
    }
  }
  const reasons: string[] = [];
  if (conflicts > 0) reasons.push(`${conflicts} conflicto(s) con datos que ya existen en la web.`);
  if (duplicates > 0) reasons.push(`${duplicates} posible(s) duplicado(s) de alumnos.`);
  if (notInsertable.length > 0) reasons.push(`${notInsertable.length} fila(s) que no se pueden agregar (${[...new Set(notInsertable.map((n) => `${n.aggregate}: ${n.reason}`))].slice(0, 5).join("; ")}).`);
  if (omittedByAdapter > 0) reasons.push(`${omittedByAdapter} fila(s) que el adaptador deja sin importar.`);
  return { ok: reasons.length === 0, studentsToAdd: list(c.maestros?.students?.inserts).length, conflicts, duplicates, notInsertable, omittedByAdapter, reasons };
}
