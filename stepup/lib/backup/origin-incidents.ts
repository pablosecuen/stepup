/**
 * Incidencias del origen: referencias que YA estaban rotas en la app (apuntan a algo que no existe en el respaldo). Se conservan como filas explícitas de la cuenta (`origin_incidents`), con la
 * referencia original tal cual, para que el traslado NO pierda esa información ni la dé por enlazada:
 *   - el contenido de la fila afectada se importa completo (sin inventar la clase o el pago que falta);
 *   - la falta del vínculo se declara una vez, como inconsistencia del ORIGEN (no como omisión del traslado).
 * Puro: lo comparten el adaptador (para importar) y el comparador (para saber qué debe haber en la web).
 */
import { CalendarRefResolver } from "./calendar-refs.ts";

type Obj = Record<string, unknown>;

export const INCIDENT_KIND = "referencia_inexistente_en_origen" as const;

export interface OriginIncident {
  /** Identificador estable (clave de origen de la incidencia). */
  id: string;
  /** Colección del respaldo a la que pertenece la fila afectada. */
  entity: "pedagogicalLessons" | "paymentCharges" | "calendarLessons" | "recurrenceExceptions" | "initialPaidSurchargeCorrections";
  /** Identificador de origen de la fila afectada. */
  rowId: string;
  /** Campo de la fila que apunta a algo inexistente. */
  field: string;
  /** La referencia original, sin tocar. */
  originalReference: string;
  kind: typeof INCIDENT_KIND;
  detail: Obj;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

const incident = (entity: OriginIncident["entity"], rowId: string, field: string, originalReference: string, detail: Obj): OriginIncident => ({
  id: `incidencia:${entity}:${rowId}:${field}`,
  entity,
  rowId,
  field,
  originalReference,
  kind: INCIDENT_KIND,
  detail,
});

export function buildOriginIncidents(doc: Obj, refs: CalendarRefResolver): OriginIncident[] {
  const out: OriginIncident[] = [];

  for (const lesson of arr(doc.pedagogicalLessons)) {
    const id = str(lesson.id);
    if (!id) continue;
    if (CalendarRefResolver.isMissingAtOrigin(refs.forRegistration(id))) {
      const cr = isObj(lesson.calendarRegistration) ? lesson.calendarRegistration : null;
      const ref = str(lesson.calendarLessonId) ?? str(cr?.lessonId);
      if (ref) out.push(incident("pedagogicalLessons", id, "calendarLessonId", ref, { motivo: "La clase del calendario a la que apuntaba el registro no existe en el respaldo (ya faltaba en TeacherFlow anterior). El registro se conserva completo, sin clase de calendario.", ocurrencia: str(cr?.recurrenceOccurrenceKey), inicio: str(cr?.start) }));
    }
  }

  for (const charge of arr(doc.paymentCharges)) {
    const id = str(charge.id);
    const ref = str(charge.calendarLessonId);
    if (id && ref && CalendarRefResolver.isMissingAtOrigin(refs.forCharge(ref, str(charge.savedLessonId)))) {
      out.push(incident("paymentCharges", id, "calendarLessonId", ref, { motivo: "La clase del calendario del cobro por clase no existe en el respaldo. El cobro se conserva completo, sin ese enlace." }));
    }
  }

  for (const lesson of arr(doc.calendarLessons)) {
    const id = str(lesson.id);
    const ref = str(lesson.freedByLessonId);
    if (id && ref && !refs.has(ref)) out.push(incident("calendarLessons", id, "freedByLessonId", ref, { motivo: "La clase que liberó este horario no existe en el respaldo." }));
  }

  for (const exception of arr(doc.recurrenceExceptions)) {
    const ref = str(exception.replacementLessonId);
    const recurrenceId = str(exception.recurrenceId);
    const occurrenceKey = str(exception.occurrenceKey);
    if (ref && recurrenceId && occurrenceKey && !refs.has(ref)) out.push(incident("recurrenceExceptions", `${recurrenceId}|${occurrenceKey}`, "replacementLessonId", ref, { motivo: "La clase de reemplazo de la excepción no existe en el respaldo." }));
  }

  const paymentIds = new Set(arr(doc.payments).map((p) => str(p.id)).filter((x): x is string => x !== null));
  const studentIds = new Set(arr(doc.students).map((s) => str(s.id)).filter((x): x is string => x !== null));
  for (const correction of arr(doc.initialPaidSurchargeCorrections)) {
    const id = str(correction.id);
    if (!id) continue;
    const student = str(correction.studentId);
    if (student && !studentIds.has(student)) out.push(incident("initialPaidSurchargeCorrections", id, "studentId", student, { motivo: "El alumno de la corrección no existe en el respaldo (ya faltaba en TeacherFlow anterior). No se crea ningún alumno: la corrección se conserva con la referencia original." }));
    for (const field of ["voidedPaymentId", "newPaymentId"] as const) {
      const ref = str(correction[field]);
      if (ref && !paymentIds.has(ref)) out.push(incident("initialPaidSurchargeCorrections", id, field, ref, { motivo: "El pago al que apunta la corrección no existe en el respaldo. No se crea ningún pago: la corrección se conserva con la referencia original." }));
    }
  }

  return out;
}
