/**
 * Cómo se nombran, para la profesora, los conteos por tabla del historial de importaciones. El resumen que guarda la
 * importación usa los nombres reales de las tablas (`students`, `calendar_lessons`…): jamás se muestran tal cual.
 * Una tabla que no esté en la lista se agrupa como "otros datos" (nunca se filtra el nombre interno).
 */
const TABLE_LABELS: Record<string, string> = {
  students: "alumnos",
  custom_levels: "niveles personalizados",
  student_level_history: "historial de niveles",
  calendar_lessons: "clases",
  calendar_lesson_participants: "participantes de clases",
  recurrence_rules: "series",
  recurrence_rule_participants: "participantes de series",
  recurrence_exceptions: "excepciones de series",
  lesson_registrations: "registros de clase",
  lesson_registration_students: "alumnos de registros",
  lesson_registration_attendance: "asistencias",
  lesson_registration_evaluations: "evaluaciones",
  lesson_registration_homework_reviews: "revisiones de tareas",
  payment_charges: "cobros",
  payments: "pagos",
  payment_allocations: "asignaciones de pagos",
  payment_adjustments: "ajustes de pagos",
  training_billing_agreements: "acuerdos de entrenamiento",
};

export const OTHER_IMPORT_DATA_LABEL = "otros datos";

export function importCountLabel(table: string): string {
  return TABLE_LABELS[table] ?? OTHER_IMPORT_DATA_LABEL;
}

/** "alumnos: 5, clases: 12" — agrupa las tablas desconocidas en "otros datos" y omite los ceros. */
export function formatImportCounts(counts: Record<string, number> | null | undefined): string {
  if (!counts) return "";
  const grouped = new Map<string, number>();
  for (const [table, count] of Object.entries(counts)) {
    if (!count) continue;
    const label = importCountLabel(table);
    grouped.set(label, (grouped.get(label) ?? 0) + count);
  }
  return [...grouped.entries()].map(([label, count]) => `${label}: ${count}`).join(", ");
}
