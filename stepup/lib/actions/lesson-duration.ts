"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { toConflictCandidates } from "@/lib/calendar/conflict-candidates";
import { findCalendarConflicts } from "@/lib/calendar-conflicts";
import { getTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { listStudents } from "@/lib/repositories/students";
import { evaluateAvailability } from "@/lib/calendar/availability";
import { canExtendLesson, evaluateExtension, MAX_LESSON_DURATION_MINUTES } from "@/lib/calendar/extend-duration";
import { instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { actionErrorMessage } from "@/lib/errors/action-error";

/**
 * «Extender duración» de UNA clase (+15, +30 o +60 min). Todo se decide en el servidor y la escritura es atómica:
 *  1. se relee la clase por su IDENTIDAD (id real, o serie + clave de ocurrencia si todavía es virtual), nunca por nombre u horario;
 *  2. se valida el intervalo FINAL completo contra la agenda operativa compartida (clases reales y ocurrencias virtuales vigentes; una cancelada, reemplazada u origen liberado no bloquea; la propia
 *     clase se excluye por su identidad) y contra la disponibilidad (bloqueos semanales, vacaciones y feriados);
 *  3. el RPC `extend_calendar_lesson_duration` repite, dentro de UNA transacción y bajo el lock por cuenta, la detección de cambios desde otro dispositivo, el solapamiento con las clases reales
 *     (incluida una clase nueva creada a la vez) y la huella de la agenda; materializa la ocurrencia virtual una sola vez. Un reintento deja una única modificación.
 * No toca tarifas, cobros, registros ni participantes. Nunca ofrece «Guardar igual» ni recorta la ampliación.
 */
export interface ExtendLessonDurationInput {
  /** Id de la tarjeta (`virtual:<clave>` si todavía no es una clase creada). */
  viewItemId: string;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  /** Inicio y fin que vio la pantalla: si otro dispositivo cambió la clase, se pide actualizar. */
  startAt: string;
  endAt: string;
  minutes: number;
}

export interface ExtendLessonDurationResult {
  error?: string;
  /** La clase o la agenda cambiaron desde otro dispositivo: hay que actualizar el calendario antes de reintentar. */
  stale?: boolean;
  newEnd?: string;
}

const MODALITY_COLOR: Record<string, string> = { online: "#DDEBFF", mixta: "#F2E8FF", presencial: "#FFE4D2" };
const STALE_MESSAGE = "La clase cambió desde otro dispositivo. Actualizá el calendario y volvé a intentarlo.";
const STALE_AGENDA_MESSAGE = "La agenda cambió mientras se guardaba. Actualizá el calendario y volvé a intentarlo.";

function sameInstant(first: string, second: string): boolean {
  return Date.parse(first) === Date.parse(second);
}

function conflictMessage(name: string | undefined, startIso: string, endIso: string): string {
  const who = name ? `la clase de ${name}` : "otra clase";
  return `Se superpone con ${who} (${instantTimeLabel(startIso)}–${instantTimeLabel(endIso)}). No se cambió nada.`;
}

export async function extendLessonDurationAction(input: ExtendLessonDurationInput): Promise<ExtendLessonDurationResult> {
  if (!input || typeof input.viewItemId !== "string" || !Number.isFinite(Date.parse(input.startAt)) || !Number.isFinite(Date.parse(input.endAt))) return { error: "No se pudo identificar la clase. Actualizá el calendario." };
  const requested = evaluateExtension(input.startAt, input.endAt, input.minutes);
  if (!requested.ok) return { error: requested.error };

  try {
    const ctx = await requireAuthenticatedDbContext();

    // La huella se lee ANTES de cargar la agenda: cualquier cambio posterior la hace distinta y la base lo detecta al escribir.
    const { data: stamp, error: stampError } = await ctx.supabase.rpc("calendar_agenda_stamp");
    if (stampError) throw stampError;

    const anchor = new Date(input.startAt);
    const rangeStart = new Date(anchor.getTime() - 86_400_000);
    const rangeEnd = new Date(Date.parse(requested.newEnd) + 86_400_000);
    const [items, availability, students] = await Promise.all([
      loadCalendarViewForRange(ctx, rangeStart, rangeEnd, undefined, { includeTestData: true }),
      getTeacherAvailability(ctx),
      listStudents(ctx),
    ]);

    // Por identidad: el id de la tarjeta o, si ya se materializó (reintento tras una respuesta perdida), su serie y clave de ocurrencia.
    const item = items.find((candidate) => candidate.id === input.viewItemId) ?? (input.recurrenceId && input.occurrenceKey ? items.find((candidate) => candidate.recurrenceId === input.recurrenceId && candidate.occurrenceKey === input.occurrenceKey && !(candidate.occupiesSlot === false)) : undefined);
    if (!item) return { error: STALE_MESSAGE, stale: true };

    // Reintento: la clase ya termina donde se pidió → una única modificación, ya aplicada.
    if (sameInstant(item.start, input.startAt) && sameInstant(item.end, requested.newEnd)) return { newEnd: requested.newEnd };
    if (!sameInstant(item.start, input.startAt) || !sameInstant(item.end, input.endAt)) return { error: STALE_MESSAGE, stale: true };
    if (!canExtendLesson(item)) return { error: "Esta clase ya no se puede extender: está cancelada, reemplazada o registrada." };

    // Intervalo final completo contra la agenda operativa (la propia clase se excluye por su identidad).
    const conflicts = findCalendarConflicts(item.start, requested.newEnd, toConflictCandidates(items), item.id);
    const first = conflicts.find((conflict) => !conflict.conflictingLesson.overlapAllowed) ?? conflicts[0];
    if (first) return { error: conflictMessage(first.conflictingLesson.label, first.conflictingLesson.start, first.conflictingLesson.end) };

    const evaluation = evaluateAvailability(item.start, requested.newEnd, availability);
    if (!evaluation.isAvailable) return { error: `Ese horario está bloqueado en tu disponibilidad (${evaluation.label ?? "no disponible"}). No se cambió nada.` };

    // Para materializar una ocurrencia virtual, los alumnos se resuelven acá contra los reales de la cuenta (nunca del navegador).
    let base: Record<string, unknown> | null = null;
    if (!item.materializedLessonId) {
      if (!item.recurrenceId || !item.occurrenceKey) return { error: "No se pudo identificar la clase. Actualizá el calendario.", stale: true };
      const byId = new Map(students.map((student) => [student.id, student]));
      const primary = item.studentId ? byId.get(item.studentId) : undefined;
      const participants = item.participantIds.map((id) => byId.get(id));
      if (!primary) return { error: "El alumno principal ya no está disponible." };
      if (participants.some((student) => !student)) return { error: "Alguno de los alumnos ya no está disponible." };
      base = {
        primary_student_id: primary.id,
        student_name: primary.name,
        level: primary.levels[0] ?? "",
        lesson_type: item.lessonType,
        start_at: item.start,
        end_at: item.end,
        modality: item.modality,
        color: MODALITY_COLOR[item.modality] ?? MODALITY_COLOR.presencial,
        recurrence_index: null,
        class_title: item.title,
        activity_kind: item.activityKind,
        participants: participants.map((student) => ({ student_id: student!.id, student_name: student!.name, level: student!.levels[0] ?? "" })),
      };
    }

    const { data, error } = await ctx.supabase.rpc("extend_calendar_lesson_duration", {
      p_payload: {
        lesson_id: item.materializedLessonId,
        recurrence_id: item.recurrenceId,
        occurrence_key: item.occurrenceKey,
        ...(base ? { base } : {}),
        expected_start_at: item.start,
        expected_end_at: item.end,
        new_end_at: requested.newEnd,
        max_duration_minutes: MAX_LESSON_DURATION_MINUTES,
        agenda_stamp: stamp as string,
      },
    });
    if (error) {
      if (error.code === "TF001") return { error: STALE_MESSAGE, stale: true };
      if (error.code === "TF003") return { error: STALE_AGENDA_MESSAGE, stale: true };
      if (error.code === "TF002") {
        // Una clase se creó o movió a la vez: se relee la agenda para decir con cuál se superpone (nunca se devuelve el detalle crudo de la base).
        const fresh = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd, undefined, { includeTestData: true });
        const clash = findCalendarConflicts(item.start, requested.newEnd, toConflictCandidates(fresh), item.id)[0];
        return { error: clash ? conflictMessage(clash.conflictingLesson.label, clash.conflictingLesson.start, clash.conflictingLesson.end) : "Se superpone con otra clase. No se cambió nada.", stale: true };
      }
      throw error;
    }
    void data;
    for (const path of ["/calendario", "/inicio", "/alumnos", "/registro"]) revalidatePath(path);
    return { newEnd: requested.newEnd };
  } catch (error) {
    return { error: actionErrorMessage("extend-lesson-duration", error) };
  }
}
