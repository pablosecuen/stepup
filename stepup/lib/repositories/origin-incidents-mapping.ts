/**
 * Incidencias heredadas del traslado: referencias que YA estaban rotas en TeacherFlow anterior (apuntaban a algo que no existe en el respaldo). Lógica PURA de presentación
 * (separada del I/O de `origin-incidents.ts`): convierte cada fila en un texto en lenguaje simple, sin códigos internos, y deja la referencia original aparte para quien quiera verla.
 * Una incidencia no es un error de la web ni una pérdida: el contenido de la fila afectada se conservó completo.
 */

export interface OriginIncidentRow {
  id: string;
  legacy_mobile_id: string;
  entity: string;
  row_legacy_id: string;
  field: string;
  original_reference: string;
  kind: string;
  detail: unknown;
}

export interface OriginIncidentView {
  id: string;
  /** Título corto en lenguaje simple. */
  title: string;
  /** Qué pasó y qué se hizo (nunca atribuye el problema a la persona usuaria ni a la web). */
  explanation: string;
  /** Inicio de la clase afectada (ISO), si el origen lo traía. */
  startsAt: string | null;
  /** La referencia original tal cual estaba en el origen (detalle técnico, secundario). */
  originalReference: string;
}

const COPY: Record<string, { title: string; explanation: string }> = {
  "pedagogicalLessons.calendarLessonId": {
    title: "Sin clase del calendario vinculada",
    explanation: "La clase del calendario a la que apuntaba este registro ya no existía en el respaldo del traslado. El registro se conservó completo, sin ese vínculo, y no se creó ninguna clase del calendario.",
  },
  "paymentCharges.calendarLessonId": {
    title: "Cobro sin clase del calendario vinculada",
    explanation: "Este cobro apuntaba a una clase del calendario que ya no existía en el respaldo del traslado. El cobro se conservó completo, con su importe, sin ese vínculo.",
  },
  "calendarLessons.freedByLessonId": {
    title: "Clase que liberó este horario no encontrada",
    explanation: "La clase que había liberado este horario ya no existía en el respaldo del traslado. La clase se conservó completa, sin ese dato.",
  },
  "recurrenceExceptions.replacementLessonId": {
    title: "Clase de reemplazo no encontrada",
    explanation: "La clase de reemplazo de esta excepción ya no existía en el respaldo del traslado. La excepción se conservó, sin ese vínculo.",
  },
  "initialPaidSurchargeCorrections.studentId": {
    title: "Corrección de un alumno que ya no existía",
    explanation: "Esta corrección apuntaba a un alumno que ya no existía en el respaldo del traslado. Se conservó con la referencia original; no se creó ningún alumno.",
  },
  "initialPaidSurchargeCorrections.voidedPaymentId": {
    title: "Pago anulado de la corrección no encontrado",
    explanation: "El pago al que apuntaba esta corrección ya no existía en el respaldo del traslado. Se conservó con la referencia original; no se creó ningún pago.",
  },
  "initialPaidSurchargeCorrections.newPaymentId": {
    title: "Pago nuevo de la corrección no encontrado",
    explanation: "El pago al que apuntaba esta corrección ya no existía en el respaldo del traslado. Se conservó con la referencia original; no se creó ningún pago.",
  },
};

const FALLBACK = {
  title: "Referencia que ya faltaba en el origen",
  explanation: "Este dato apuntaba a algo que ya no existía en el respaldo del traslado. Se conservó la referencia original; no se inventó nada.",
};

export function toIncidentView(row: OriginIncidentRow): OriginIncidentView {
  const copy = COPY[`${row.entity}.${row.field}`] ?? FALLBACK;
  const detail = row.detail !== null && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : {};
  const startsAt = typeof detail.inicio === "string" && detail.inicio.trim() !== "" ? detail.inicio : null;
  return { id: row.id, title: copy.title, explanation: copy.explanation, startsAt, originalReference: row.original_reference };
}

/** Agrupa las vistas por la fila afectada (identificador de la web), conservando el orden. */
export function groupIncidentViews(rows: readonly OriginIncidentRow[], webIdByLegacyId: ReadonlyMap<string, string>): Record<string, OriginIncidentView[]> {
  const out: Record<string, OriginIncidentView[]> = {};
  for (const row of rows) {
    const webId = webIdByLegacyId.get(row.row_legacy_id);
    if (!webId) continue;
    (out[webId] ??= []).push(toIncidentView(row));
  }
  return out;
}
