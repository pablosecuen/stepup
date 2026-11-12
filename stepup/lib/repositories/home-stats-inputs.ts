import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import { isClassHeld, toRegisteredLessonFacts, type RegistrationRowForFacts } from "@/lib/reports/registered-lessons";
import type { HomeStatsRawInputs } from "@/lib/dashboard/home-stats";

/** Las mismas columnas que lee el Resumen financiero para sus «Horas dictadas»: así las dos pantallas parten de los mismos hechos. */
const REGISTRATION_COLUMNS =
  "id, calendar_lesson_id, source_event_type, outcome, holiday_exception, is_billable, scheduled_start_at, scheduled_end_at, actual_started_at, actual_ended_at, scheduled_duration_minutes, actual_duration_minutes, modality, billed_amount, created_at";

/**
 * Lo que necesitan los indicadores de Inicio de las clases dictadas: los registros FINALIZADOS de la cuenta (un registro en curso todavía no es un resultado), sus alumnos y la nota general real de las
 * clases dictadas. Sólo lecturas. La regla de qué cuenta como clase dictada, en qué mes y cuánto duró NO vive acá: es `homeStatsInputsFrom` (puro, compartido con el Resumen financiero), que se aplica
 * después de leer, cuando también se conocen los alumnos de prueba excluidos. Si una lectura falla, el error sube y Inicio muestra «Sin datos» (nunca un 0).
 */
export async function loadHomeStatsRaw(ctx: AuthenticatedDbContext): Promise<HomeStatsRawInputs> {
  const [registrations, roster] = await Promise.all([
    readTable<RegistrationRowForFacts>(ctx.supabase, "lesson_registrations", { columns: REGISTRATION_COLUMNS, filter: (query) => query.eq("owner_id", ctx.ownerId).eq("status", "completed") }),
    readTable<{ lesson_registration_id: string; student_id: string }>(ctx.supabase, "lesson_registration_students", { columns: "id, lesson_registration_id, student_id", filter: (query) => query.eq("owner_id", ctx.ownerId) }),
  ]);
  const heldIds = registrations
    .filter((row) => isClassHeld(toRegisteredLessonFacts(row, { studentIds: [], billedAmountByStudent: null, occurrenceKey: null })))
    .map((row) => row.id);
  const evaluations = await readTableByIds<{ id: string; lesson_registration_id: string; general_grade: number | null }>(ctx.supabase, "lesson_registration_evaluations", {
    columns: "id, lesson_registration_id, general_grade",
    matchColumn: "lesson_registration_id",
    ids: heldIds,
    filter: (query) => query.eq("owner_id", ctx.ownerId).not("general_grade", "is", null),
  });
  // Una clase grupal tiene una evaluación por alumno: cada nota general real cuenta (promedio de TODAS las notas).
  return { registrations, roster, grades: evaluations.map((row) => ({ registrationId: row.lesson_registration_id, grade: Number(row.general_grade) })) };
}
