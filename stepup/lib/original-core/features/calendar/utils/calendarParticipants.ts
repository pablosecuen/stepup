// Puerto VERBATIM del original (`src/features/calendar/utils/calendarParticipants.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, CalendarLessonParticipant } from '../types/index.ts';
import type { StudentListItem } from '../../students/types/index.ts';
import { joinLevelsForDisplay } from '../../students/utils/studentLevelsCore.ts';
import { normalizeClassTitle } from './calendarClassTitle.ts';

/**
 * Corrección 2026-07-20 (a pedido de Joaquín — agregar alumnos a una clase
 * "Sin alumnos"): función pura, movida a un archivo `.ts` (no `.tsx`) para
 * poder probarla directamente desde `test:integration` — esa suite
 * compila sin JSX. 1 participante deriva "individual", 2 o más deriva
 * "group" — nunca se le pide a la profesora que lo elija a mano. Nunca
 * muta `lesson` ni `participants` (ambos sólo se leen). Usada por
 * `AddParticipantsSheet.tsx`, que la importa tal cual — una sola
 * implementación.
 */
export function buildLessonWithParticipants(
  lesson: CalendarLesson,
  participants: StudentListItem[]
): CalendarLesson {
  const first = participants[0];
  return {
    ...lesson,
    studentId: first.id,
    studentName: participants.length > 1 ? `${first.name} +${participants.length - 1}` : first.name,
    level: joinLevelsForDisplay(first.levels),
    participants: participants.map((participant) => ({
      studentId: participant.id,
      studentName: participant.name,
      level: joinLevelsForDisplay(participant.levels),
    })),
    lessonType: participants.length > 1 ? 'group' : 'individual',
  };
}

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — flujo clases→alumnos, §C),
 * extendida 2026-08-01 (a pedido de Joaquín — nombre editable de la clase):
 * ÚNICA fuente de verdad para el título visible de una clase en todo
 * TeacherFlow (calendario semanal, diario, próxima clase, agenda del día,
 * clases sin alumnos, detalle de la clase). Prioridad exacta:
 *   1. `lesson.classTitle`, si la profesora eligió uno (nunca vacío tras
 *      `normalizeClassTitle` — ver `calendarClassTitle.ts`).
 *   2. si no hay título propio, se deriva de los alumnos reales, igual que
 *      siempre: 1 alumno → su nombre; varios → "Clase grupal · N alumnos";
 *      ninguno → "Clase sin alumnos".
 * Nunca modifica `studentName`/`participants`/el perfil del alumno — sólo
 * lee. Pura.
 *
 * Corrección 2026-09-02 (a pedido de Joaquín — editar el nombre de una
 * serie antes de guardar): el parámetro es un `Pick`, no `CalendarLesson`
 * completo, para poder reusar esta MISMA función durante la creación de una
 * serie/clase (borrador en memoria en `NewCalendarLessonSheet.tsx`, todavía
 * sin id/fecha/etc. — nunca un `CalendarLesson` real). Todo llamador
 * existente que pasa un `CalendarLesson` completo sigue funcionando exacto
 * igual, sin cambios.
 */
export function lessonDisplayTitle(
  lesson: Pick<CalendarLesson, 'classTitle'> & { participants: readonly Pick<CalendarLessonParticipant, 'studentName'>[] }
): string {
  const customTitle = lesson.classTitle?.trim();
  if (customTitle) return customTitle;
  if (lesson.participants.length === 0) return 'Clase sin alumnos';
  if (lesson.participants.length === 1) return lesson.participants[0].studentName;
  return `Clase grupal · ${lesson.participants.length} alumnos`;
}

/**
 * Corrección 2026-09-02 (a pedido de Joaquín — editar el nombre de una
 * serie antes de guardar, IMPLEMENTACIÓN): única fuente que resuelve, a la
 * vez, (a) el `classTitle` real a persistir y (b) la vista previa a
 * mostrar ("Nombre actual"), a partir de lo que la profesora tipeó en el
 * campo y los participantes elegidos EN ESE MOMENTO — reutiliza
 * `normalizeClassTitle` (nunca guarda una cadena vacía) y `lessonDisplayTitle`
 * (nunca reimplementa la regla de 1 alumno / varios / ninguno). El estado
 * "¿hay título personalizado?" es enteramente explícito en el campo mismo
 * del formulario (vacío = todavía sigue el automático, texto = personalizado)
 * — nunca se determina comparando el texto contra el nombre automático
 * calculado. Pura.
 */
export function resolveDraftClassTitle(
  titleInput: string,
  participants: readonly Pick<CalendarLessonParticipant, 'studentName'>[]
): { classTitle: string | undefined; displayTitle: string } {
  const classTitle = normalizeClassTitle(titleInput);
  return { classTitle, displayTitle: lessonDisplayTitle({ classTitle, participants }) };
}

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — encabezado de
 * RegisterPendingClassSheet): "Juan Pérez, María López y Camila Torres" —
 * nunca antes existía un formateador de nombres en prosa (sólo
 * "Clase grupal · N alumnos" en `lessonDisplayTitle` y "Juan +2" en
 * `buildLessonWithParticipants`, pensados para otros contextos). Con más de
 * `maxNames` participantes, corta a los primeros y agrega "+N alumnos" —
 * nunca trunca un nombre a la mitad. Nunca muta `names`. Pura.
 */
export function formatParticipantNamesSentence(names: readonly string[], maxNames = 3): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];

  if (names.length > maxNames) {
    const shown = names.slice(0, maxNames);
    const remaining = names.length - maxNames;
    return `${shown.join(', ')} y +${remaining} alumno${remaining === 1 ? '' : 's'}`;
  }

  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — flujo clases→alumnos,
 * §E): quitar un participante nunca debe dejar una clase que YA tenía al
 * menos un alumno completamente vacía por un toque accidental. Una clase
 * creada sin alumnos desde el principio (`originalParticipantIds` vacío)
 * nunca activa esta regla — ahí "vaciar" no tiene sentido porque nunca
 * hubo nadie que "vaciar". Pura.
 */
export function wouldRemoveLastParticipant(
  originalParticipantIds: readonly string[],
  nextParticipantIds: readonly string[]
): boolean {
  return originalParticipantIds.length > 0 && nextParticipantIds.length === 0;
}

export const LAST_PARTICIPANT_GUARD_MESSAGE =
  'Esta clase debe conservar al menos un alumno. Si ya no se dictará, cancelá o eliminá la clase.';

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — flujo clases→alumnos,
 * §C/§E): quita un único participante puntual — nunca borra al alumno de
 * TeacherFlow, sólo su participación en esta clase. El llamador es
 * responsable de aplicar `wouldRemoveLastParticipant` ANTES de llamar a
 * esto (acá nunca se bloquea nada, sólo se calcula el resultado). Pura —
 * nunca muta `lesson`.
 */
export function removeParticipantFromLesson(lesson: CalendarLesson, studentId: string): CalendarLesson {
  const nextParticipants = lesson.participants.filter((participant) => participant.studentId !== studentId);
  const first = nextParticipants[0] as (typeof nextParticipants)[number] | undefined;
  return {
    ...lesson,
    studentId: first?.studentId ?? '',
    studentName:
      nextParticipants.length > 1 && first
        ? `${first.studentName} +${nextParticipants.length - 1}`
        : first?.studentName ?? 'Sin alumnos',
    level: first?.level ?? '',
    participants: nextParticipants,
    lessonType: nextParticipants.length > 1 ? 'group' : 'individual',
  };
}
