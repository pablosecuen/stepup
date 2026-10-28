// Puerto VERBATIM del original (`src/features/students/hooks/studentArchiveService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { loadCalendarLessons } from '../../calendar/hooks/calendarStore.ts';
import { applyRecurrenceMutation, type RecurrenceSnapshot } from '../../calendar/hooks/recurrenceMutationQueue.ts';
import { publishExternalCalendarChange } from '../../calendar/hooks/calendarExternalSyncEvents.ts';
import { getDeviceTimeZone } from '../../calendar/utils/calendarPendingRecurrence.ts';
import { getLocalDateKey } from '../../calendar/utils/calendarTimezone.ts';
import { removeFutureUncompletedMaterializations, truncateStudentRecurrencesFromDate } from '../../calendar/utils/calendarRecurrenceSplit.ts';
import { removeParticipantFromLesson } from '../../calendar/utils/calendarParticipants.ts';
import { getStudentProfile, hydrateStudentProfiles, updateStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import type { StatusChangeInput } from '../../student-profile/types/index.ts';
import { getStudentsStore, hydrateStudentsStore, updateStudentPersisted } from './studentStore.ts';

/**
 * Corrección 2026-07-24 (a pedido de Joaquín — "TUTORIAL RÁPIDO SALTEABLE +
 * ACCIONES POR DESLIZAMIENTO EN ALUMNOS", ítem J): archivar/restaurar
 * reutiliza el mismo campo `StudentStatus.status` que ya existía (Fase 6C —
 * "Cambiar estado"/"Archivar alumno" desde Alumnos), nunca un estado
 * paralelo. Lo nuevo acá es la opción de quitar al alumno de las clases
 * FUTURAS al archivar, reutilizando el motor de recurrencias ya existente
 * (`truncateStudentRecurrencesFromDate`/`removeFutureUncompletedMaterializations`,
 * el mismo que usa "Eliminar esta y todas las siguientes") — nunca se
 * reimplementa ese cálculo acá.
 *
 * Orden deliberado (no es una única transacción atómica entre las cuatro
 * colecciones — limitación conocida, documentada en el informe de esta
 * fase): primero se persiste el recorte del calendario (si corresponde),
 * recién después se marca al alumno como archivado en la lista/perfil. Si
 * el segundo paso fallara tras un primer paso exitoso, el peor caso es que
 * el calendario ya quedó recortado pero el alumno todavía figura activo —
 * nunca se pierde información, y reintentar "Archivar" corrige el estado.
 * El orden inverso arriesgaría lo contrario (alumno ya archivado, pero
 * sus clases futuras intactas) — se prefiere el primero porque el estado
 * "activo/archivado" es lo que gobierna qué swipe/filtro ve la profesora,
 * así que es más importante que quede sincronizado que que la limpieza del
 * calendario ocurra primero.
 */

export interface ArchiveStudentOptions {
  /** true = "Archivar y quitar de futuras" (opción recomendada); false = "Archivar conservando su agenda". */
  removeFromFuture: boolean;
  reason?: string;
  internalNote?: string;
}

let operationInProgress: Promise<void> | null = null;

function runExclusive(operation: () => Promise<void>): Promise<void> {
  const chained = (operationInProgress ?? Promise.resolve()).then(operation, operation);
  operationInProgress = chained.finally(() => {
    if (operationInProgress === chained) operationInProgress = null;
  });
  return operationInProgress;
}

// Corrección 2026-09-14, CUARTA ronda (a pedido de Joaquín — revisión
// independiente, punto 2): antes esto leía un snapshot fresco, calculaba el
// recorte completo (reglas truncadas, materializaciones futuras removidas,
// participación quitada de clases sueltas) y encolaba las TRES colecciones
// ya armadas — si otra operación (por ejemplo, un vínculo financiero de
// entrenamiento) escribía mientras esta esperaba su turno, la escritura de
// archivado, al llegar su turno, sobrescribía igual con su copia vieja.
// Ahora todo el cálculo puro se recalcula adentro de `applyRecurrenceMutation`,
// contra `current` — el snapshot REALMENTE persistido en el momento exacto
// en que le toca escribir.
function computeFutureCalendarTrim(
  current: RecurrenceSnapshot,
  studentId: string,
  effectiveDate: string,
  timezone: string
): RecurrenceSnapshot {
  const { rules: nextRules, truncatedRecurrenceIds } = truncateStudentRecurrencesFromDate({
    rules: current.rules,
    studentId,
    effectiveDate,
  });

  const lessonsAfterRecurrenceTrim = removeFutureUncompletedMaterializations(
    current.lessons,
    truncatedRecurrenceIds,
    effectiveDate,
    timezone
  );

  // Clases sueltas futuras (no recurrentes) donde participa el alumno: se
  // quita su participación puntual con la misma función pura que ya usa
  // "Quitar alumno" desde la hoja de acciones de una clase — si la clase
  // queda sin nadie, se conserva como "Sin alumnos" (nunca se borra sola),
  // que ya alimenta el recordatorio existente de "Clases sin alumnos".
  const now = Date.now();
  const nextLessons = lessonsAfterRecurrenceTrim.map((lesson) => {
    if (lesson.recurrenceId) return lesson; // ya cubierta por el recorte de arriba
    if (lesson.status === 'cancelled' || lesson.status === 'completed') return lesson;
    if (new Date(lesson.start).getTime() <= now) return lesson;
    const participates = lesson.participants.some((participant) => participant.studentId === studentId);
    if (!participates) return lesson;
    return removeParticipantFromLesson(lesson, studentId);
  });

  return { lessons: nextLessons, rules: nextRules, exceptions: current.exceptions };
}

async function removeStudentFromFutureCalendar(studentId: string): Promise<void> {
  const timezone = getDeviceTimeZone();
  const effectiveDate = getLocalDateKey(new Date().toISOString(), timezone);

  const verified = await applyRecurrenceMutation((current) =>
    computeFutureCalendarTrim(current, studentId, effectiveDate, timezone)
  );
  publishExternalCalendarChange({
    lessons: verified.lessons,
    recurrenceRules: verified.rules,
    recurrenceExceptions: verified.exceptions,
  });
}

/**
 * Archiva un alumno. Nunca elimina nada — el historial, las clases
 * registradas y los pagos se conservan intactos. `options.removeFromFuture`
 * decide si además se lo quita de las clases futuras (agendadas, no
 * dictadas todavía); las clases pasadas nunca se modifican en ningún caso.
 */
export async function archiveStudent(studentId: string, options: ArchiveStudentOptions): Promise<void> {
  return runExclusive(async () => {
    await Promise.all([hydrateStudentsStore(), hydrateStudentProfiles()]);
    const student = getStudentsStore().find((item) => item.id === studentId);
    if (!student) throw new Error('No se encontró el alumno.');

    if (options.removeFromFuture) {
      await removeStudentFromFutureCalendar(studentId);
    }

    const nowIso = new Date().toISOString();

    await updateStudentPersisted({
      ...student,
      status: 'archivado',
      nextClassAt: options.removeFromFuture ? null : student.nextClassAt,
    });

    // El perfil detallado (mock local hidratado en memoria, ver
    // `useStudentProfile.ts`) se actualiza best-effort: si todavía no se
    // abrió nunca en esta sesión, `getStudentProfile` devuelve `null` y no
    // hay nada que sincronizar acá — la lista de Alumnos (la mutación de
    // arriba) es la fuente real para el filtro/gesto, así que archivar
    // nunca depende de que el perfil ya esté cargado.
    const profile = getStudentProfile(studentId);
    if (profile) {
      const statusEntry: StatusChangeInput = {
        status: 'archivado',
        date: nowIso,
        reason: options.reason,
        internalNote: options.internalNote,
      };
      await updateStudentProfile({
        ...profile,
        status: 'archivado',
        statusChangeDate: nowIso,
        statusHistory: [...profile.statusHistory, statusEntry],
        nextClassAt: options.removeFromFuture ? null : profile.nextClassAt,
      });
    }
  });
}

/**
 * Corrección 2026-07-24 (ítem J — mostrar "Este alumno participa en X
 * clases futuras" con un número real, nunca inventado): sólo lectura,
 * cuenta las mismas clases que `removeStudentFromFutureCalendar` afectaría
 * si se elige "quitar de futuras" — recurrentes materializadas y sueltas
 * por igual, nunca canceladas/completadas/pasadas.
 */
export async function countStudentFutureLessons(studentId: string): Promise<number> {
  const lessons = await loadCalendarLessons();
  const now = Date.now();
  return (lessons ?? []).filter((lesson) => {
    if (lesson.status === 'cancelled' || lesson.status === 'completed') return false;
    if (new Date(lesson.start).getTime() <= now) return false;
    return lesson.studentId === studentId || lesson.participants.some((participant) => participant.studentId === studentId);
  }).length;
}

/**
 * Restaura un alumno archivado: vuelve a "Activos". Nunca recrea clases
 * pasadas ni futuras (la agenda que se haya quitado al archivar no vuelve
 * sola) y nunca modifica pagos — sólo el campo de estado.
 */
export async function restoreStudent(studentId: string): Promise<void> {
  return runExclusive(async () => {
    await Promise.all([hydrateStudentsStore(), hydrateStudentProfiles()]);
    const student = getStudentsStore().find((item) => item.id === studentId);
    if (!student) throw new Error('No se encontró el alumno.');

    await updateStudentPersisted({ ...student, status: 'activo' });

    const profile = getStudentProfile(studentId);
    if (profile) {
      const nowIso = new Date().toISOString();
      const statusEntry: StatusChangeInput = { status: 'activo', date: nowIso };
      await updateStudentProfile({
        ...profile,
        status: 'activo',
        statusChangeDate: null,
        statusHistory: [...profile.statusHistory, statusEntry],
      });
    }
  });
}
