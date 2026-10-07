// Traducción de los errores de CUOTA de la base (R3) a un texto claro para la usuaria. Pura (sin React/Next/Supabase).
//
// La base levanta SQLSTATE 53400 (`configuration_limit_exceeded`) con mensajes estables y la categoría en `details`:
//   quota_exceeded      → llegó al tope total de una categoría
//   quota_rate_exceeded → demasiadas operaciones en la ventana de tiempo (por hora o por acción costosa)
//   quota_row_too_large → lo que se intenta guardar es demasiado grande
// Nunca se muestran tablas, SQL, claves internas ni cifras de los límites: sólo el rubro en lenguaje simple.

export const QUOTA_SQLSTATE = "53400";

const CATEGORY_LABEL: Record<string, string> = {
  students: "alumnos",
  student_creation_claims: "altas de alumnos",
  student_creation_claims_pending: "altas de alumnos",
  calendar_lessons: "clases",
  calendar_lessons_future: "clases programadas",
  calendar_lesson_participants: "clases",
  recurrence_rules: "series de clases",
  recurrence_rule_participants: "series de clases",
  recurrence_exceptions: "series de clases",
  lesson_registrations: "registros de clases",
  lesson_registration_students: "registros de clases",
  lesson_registration_attendance: "registros de clases",
  lesson_registration_evaluations: "registros de clases",
  lesson_registration_homework_reviews: "registros de clases",
  lesson_registration_edit_history: "registros de clases",
  payments: "pagos",
  payment_charges: "cobros",
  payment_allocations: "pagos",
  payment_adjustments: "pagos",
  training_billing_agreements: "cobros",
  pending_training_billing_operations: "cobros",
  package_purchases: "paquetes",
  package_credit_movements: "paquetes",
  first_month_proration_decisions: "cobros",
  monthly_amount_corrections: "cobros",
  initial_paid_surcharge_corrections: "cobros",
  student_status_history: "alumnos",
  student_level_history: "alumnos",
  student_price_history: "alumnos",
  custom_levels: "niveles personalizados",
  report_records: "reportes",
  report_pdf_cleanup_jobs: "reportes",
  import_previews: "importaciones",
  import_previews_pending: "importaciones",
  import_runs: "importaciones",
  import_undo_previews: "importaciones",
  import_undo_previews_pending: "importaciones",
};

const PENDING_KEYS = new Set(["student_creation_claims_pending", "import_previews_pending", "import_undo_previews_pending"]);

function readString(value: unknown, key: string): string | null {
  if (value === null || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

/** Mensaje para un error de cuota, o `null` si el error no es de cuota. */
export function quotaErrorMessage(error: unknown): string | null {
  if (readString(error, "code") !== QUOTA_SQLSTATE) return null;
  const message = readString(error, "message") ?? (error instanceof Error ? error.message : "");
  const detail = readString(error, "details") ?? readString(error, "detail") ?? "";

  if (message === "quota_rate_exceeded") {
    return "Hiciste esta operación demasiadas veces en poco tiempo. Esperá unos minutos y volvé a intentar.";
  }
  if (message === "quota_row_too_large") {
    return "Lo que intentás guardar es demasiado grande. Probá con menos contenido.";
  }
  if (message === "quota_exceeded") {
    if (PENDING_KEYS.has(detail)) {
      return "Tenés demasiadas operaciones en curso. Terminá o esperá unos minutos a que venzan y volvé a intentar.";
    }
    const label = CATEGORY_LABEL[detail];
    return label
      ? `Alcanzaste el límite de ${label} de tu cuenta. Si necesitás más espacio, escribinos y lo revisamos.`
      : "Alcanzaste un límite de uso de tu cuenta. Si necesitás más espacio, escribinos y lo revisamos.";
  }
  return "Alcanzaste un límite de uso de tu cuenta. Probá de nuevo más tarde.";
}

/** ¿Es uno de los textos de cuota ya traducidos? (para que capas de traducción posteriores —p. ej. la de importaciones— lo dejen pasar tal cual). */
const QUOTA_TEXT_PREFIXES = [
  "Alcanzaste el límite de ",
  "Alcanzaste un límite de uso",
  "Hiciste esta operación demasiadas veces",
  "Lo que intentás guardar es demasiado grande",
  "Tenés demasiadas operaciones en curso",
];
export function isQuotaMessage(text: string): boolean {
  return QUOTA_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix));
}
