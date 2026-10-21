/**
 * Diferencia entre DOS copias del origen (el respaldo de la app tomado en dos momentos): qué se cargó, cambió o desapareció en Expo Go después de la copia que se usó para
 * importar. Sirve en la pausa de carga: si entre la copia final y el cierre alguien cargó algo en la app anterior, acá aparece por colección e identificador, y recién
 * entonces se lo incorpora (nueva copia → nueva importación) antes de cerrar el traslado.
 *
 * Puro. NUNCA devuelve valores: sólo colección, identificador de origen y NOMBRES de campo que cambiaron (nunca nombres de personas, teléfonos ni importes).
 */
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const canonical = (v: unknown): string => {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

/** Colecciones del respaldo y cómo se identifica cada elemento. */
const KEYED: Array<{ collection: string; key: (row: Obj) => string | null }> = [
  { collection: "students", key: (r) => str(r.id) },
  { collection: "pedagogicalLessons", key: (r) => str(r.id) },
  { collection: "calendarLessons", key: (r) => str(r.id) },
  { collection: "recurrenceRules", key: (r) => str(r.recurrenceId) ?? str(r.id) },
  { collection: "recurrenceExceptions", key: (r) => (str(r.recurrenceId) && str(r.occurrenceKey) ? `${r.recurrenceId}|${r.occurrenceKey}` : null) },
  { collection: "paymentCharges", key: (r) => str(r.id) },
  { collection: "payments", key: (r) => str(r.id) },
  { collection: "paymentAllocations", key: (r) => str(r.id) },
  { collection: "paymentAdjustments", key: (r) => str(r.id) },
  { collection: "packagePurchases", key: (r) => str(r.id) },
  { collection: "packageCreditMovements", key: (r) => str(r.id) },
  { collection: "reportRecords", key: (r) => str(r.id) },
  { collection: "customLevels", key: (r) => str(r.id) },
  { collection: "trainingBillingAgreements", key: (r) => str(r.id) },
  { collection: "monthlyAmountCorrections", key: (r) => str(r.id) },
  { collection: "initialPaidSurchargeCorrections", key: (r) => str(r.id) },
  { collection: "firstMonthProrationDecisions", key: (r) => str(r.id) },
];
const SINGLETONS = ["teacherProfile", "teacherAvailability", "surchargeSettings", "budgetDistribution"];
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export interface CollectionDelta {
  collection: string;
  added: string[];
  removed: string[];
  /** Elementos que existían en las dos copias pero cambiaron: identificador + nombres de los campos que difieren. */
  changed: Array<{ id: string; fields: string[] }>;
  /** Elementos sin identificador (no se pueden comparar uno a uno): sólo se cuenta si cambió la cantidad. */
  withoutId: { before: number; after: number };
}

export interface OriginDelta {
  collections: CollectionDelta[];
  singletons: Array<{ name: string; changed: boolean; fields: string[] }>;
  /** ¿Hay algo para incorporar antes de cerrar el traslado? */
  hasChanges: boolean;
  totals: { added: number; removed: number; changed: number };
}

function fieldDiff(a: unknown, b: unknown): string[] {
  const left = isObj(a) ? a : {};
  const right = isObj(b) ? b : {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((k) => canonical(left[k]) !== canonical(right[k])).sort();
}

export function diffOrigins(before: Obj, after: Obj): OriginDelta {
  const collections: CollectionDelta[] = [];
  const profilesBefore = isObj(before.profiles) ? before.profiles : {};
  const profilesAfter = isObj(after.profiles) ? after.profiles : {};

  const compareMaps = (collection: string, a: Map<string, unknown>, b: Map<string, unknown>, withoutId: { before: number; after: number }) => {
    const added = [...b.keys()].filter((k) => !a.has(k)).sort();
    const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
    const changed = [...a.keys()].filter((k) => b.has(k) && canonical(a.get(k)) !== canonical(b.get(k))).sort().map((id) => ({ id, fields: fieldDiff(a.get(id), b.get(id)) }));
    collections.push({ collection, added, removed, changed, withoutId });
  };
  const index = (rows: Obj[], key: (row: Obj) => string | null) => {
    const map = new Map<string, unknown>();
    let without = 0;
    for (const row of rows) {
      const k = key(row);
      if (k) map.set(k, row);
      else without += 1;
    }
    return { map, without };
  };

  for (const spec of KEYED) {
    const a = index(arr(before[spec.collection]), spec.key);
    const b = index(arr(after[spec.collection]), spec.key);
    compareMaps(spec.collection, a.map, b.map, { before: a.without, after: b.without });
  }
  compareMaps("profiles", new Map(Object.entries(profilesBefore)), new Map(Object.entries(profilesAfter)), { before: 0, after: 0 });

  const singletons = SINGLETONS.map((name) => {
    const fields = fieldDiff(before[name], after[name]);
    return { name, changed: canonical(before[name]) !== canonical(after[name]), fields };
  });

  const totals = collections.reduce((t, c) => ({ added: t.added + c.added.length, removed: t.removed + c.removed.length, changed: t.changed + c.changed.length }), { added: 0, removed: 0, changed: 0 });
  const withoutIdChanged = collections.some((c) => c.withoutId.before !== c.withoutId.after);
  return { collections, singletons, totals, hasChanges: totals.added + totals.removed + totals.changed > 0 || singletons.some((s) => s.changed) || withoutIdChanged };
}
