/**
 * Fase 9 — mapeo PURO (sin red) del resultado ya resuelto de
 * `resolveUndoBlockers` (`lib/repositories/backup-import.ts`, que sí toca
 * la base) a mensajes 100% humanos para el panel de "undo bloqueado".
 *
 * Frontera de seguridad real (corrección de UX post-E2E, a pedido explícito
 * de Joaquín): antes, el bloqueo mostraba `table_name`/`row_id` crudos
 * (ej. "students 0ad6d18b-... — tiene datos creados después..."). Esta es
 * la única puerta entre esos datos ya resueltos (nombre real del alumno,
 * fecha/concepto real de la dependencia) y lo que ve el navegador — nunca
 * deja pasar un UUID ni un nombre de tabla en ningún string final.
 */

const HUMAN_TABLE_LABEL: Record<string, string> = {
  students: "un alumno",
  training_billing_agreements: "un acuerdo de entrenamiento",
  recurrence_rules: "una serie de clases",
  recurrence_rule_participants: "un participante de una serie de clases",
  recurrence_exceptions: "una excepción de una serie de clases",
  calendar_lessons: "una clase en el calendario",
  calendar_lesson_participants: "un participante de una clase",
  lesson_registrations: "un registro de clase dictada",
  lesson_registration_students: "un alumno anotado en una clase",
  lesson_registration_attendance: "una asistencia registrada",
  lesson_registration_evaluations: "una evaluación registrada",
  lesson_registration_homework_reviews: "una tarea registrada",
  package_purchases: "una compra de paquete",
  package_credit_movements: "un movimiento de créditos de paquete",
  payment_charges: "un cargo",
  payments: "un pago",
  payment_allocations: "una asignación de pago",
  payment_adjustments: "un ajuste de cobro",
  monthly_amount_corrections: "una corrección de cuota mensual",
  initial_paid_surcharge_corrections: "una corrección de recargo",
  first_month_proration_decisions: "una decisión de prorrateo del primer mes",
  student_status_history: "un cambio de estado del alumno",
  student_level_history: "un cambio de nivel del alumno",
  student_price_history: "un cambio de precio del alumno",
  report_records: "un reporte generado",
  report_draft_claims: "un reporte en curso",
};

/** Nunca devuelve el nombre técnico de la tabla — si no está en el mapa, un rótulo genérico igual de humano. */
export function humanTableLabel(tableName: string): string {
  return HUMAN_TABLE_LABEL[tableName] ?? "un dato posterior";
}

// ---------------------------------------------------------------------------
// Forma intermedia — ya resuelta contra la base real por
// `resolveUndoBlockers`, pero todavía puede contener `tableName`/ids (uso
// interno, nunca se exporta directo al cliente sin pasar por
// `toHumanBlockedRow`).
// ---------------------------------------------------------------------------

export interface ResolvedBlockerChild {
  tableName: string;
  /** false = la fila referenciada ya no se pudo leer (borrada/ajena) — fallback legible, nunca un id. */
  resolved: boolean;
  /** Fecha real de negocio de esa dependencia, si la tabla tiene una razonable (ISO date/timestamp). */
  dateIso?: string | null;
  /** Concepto corto y humano (importe, período, etc.), si aplica. */
  concept?: string | null;
}

export interface ResolvedBlockerRow {
  parentTableName: string;
  /** Sólo para `parentTableName==='students'` — nombre real ya resuelto, o `undefined` si no se pudo leer. */
  parentStudentName?: string;
  children: ResolvedBlockerChild[];
}

// ---------------------------------------------------------------------------
// DTO limpio — lo único que cruza al navegador. Strings 100% humanos.
// ---------------------------------------------------------------------------

export interface HumanBlockedRow {
  /** Ej. "el alumno Juan Pérez", o "un acuerdo de entrenamiento" para tablas sin nombre propio — nunca un id. */
  entityLabel: string;
  /** Una oración humana por dependencia real, ej. "un cargo — $500 (2026-09), vence 10/09/2026". */
  dependencies: string[];
}

export const UNDO_BLOCKED_EXPLANATION =
  "No se puede deshacer esta importación de forma automática: hay información nueva creada después que depende de estos datos. No se va a modificar ni borrar nada, para proteger esa información.";

function formatDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });
}

function describeChild(child: ResolvedBlockerChild): string {
  const label = humanTableLabel(child.tableName);
  if (!child.resolved) return `${label} (no se pudo identificar el detalle)`;
  const parts = [label];
  if (child.concept) parts.push(`— ${child.concept}`);
  const dateLabel = formatDate(child.dateIso);
  if (dateLabel) parts.push(`(${dateLabel})`);
  return parts.join(" ");
}

/** Única puerta real entre los datos ya resueltos y lo que ve el navegador — nunca deja pasar `table_name`/`row_id` crudos. */
export function toHumanBlockedRow(resolved: ResolvedBlockerRow): HumanBlockedRow {
  const entityLabel =
    resolved.parentTableName === "students"
      ? resolved.parentStudentName
        ? `el alumno ${resolved.parentStudentName}`
        : "un alumno sin nombre disponible"
      : humanTableLabel(resolved.parentTableName);
  const dependencies = resolved.children.length > 0 ? resolved.children.map(describeChild) : ["datos posteriores que no se pudieron identificar"];
  return { entityLabel, dependencies };
}

export interface UndoBlockedPreview {
  undoPreviewId: string;
  isSafe: boolean;
  explanation: string;
  blockedRows: HumanBlockedRow[];
}
