// Puerto VERBATIM del original (`src/features/calendar/utils/calendarStudentIntegrity.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarLesson,
  CalendarModality,
  PendingLessonDraft,
} from '../types/index.ts';
import type { StudentListItem } from '../../students/types/index.ts';
import { normalizeSearchText } from '../../../shared/utils/studentSearch.ts';
import { joinLevelsForDisplay } from '../../students/utils/studentLevelsCore.ts';

// Corrección puntual 2026-08-18 (a pedido de Joaquín — VERDE EXCLUSIVO
// PARA CLASES DE REEMPLAZO): "presencial" pasa de `#E3F6E8` (verde) a
// `#FFE4D2` (el mismo peach real de `MODALITY_LEGEND.presencial` en
// calendarVisualLegend.ts) — este `.color` nunca lo lee ninguna tarjeta
// real (el color de pantalla lo decide `resolveLessonColor`), pero nunca
// debe poder entregar el verde reservado.
function lessonColorForModality(modality: CalendarModality): string {
  if (modality === 'online') return '#DDEBFF';
  if (modality === 'mixta') return '#F2E8FF';
  return '#FFE4D2';
}

// Construye la CalendarLesson completa a partir de un pendingLessonDraft
// (fecha/hora/duración/modalidad ya elegidas en el sheet) + el alumno
// recién creado — usado para la confirmación única del punto 1 (crear
// la clase inmediatamente, sin reabrir el sheet).
export function buildLessonFromDraft(
  draft: PendingLessonDraft,
  student: StudentListItem
): CalendarLesson {
  const start = new Date(draft.date);
  start.setHours(draft.hour, draft.minute, 0, 0);

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + draft.durationMinutes);

  return {
    id: `calendar_lesson_${Date.now()}`,
    studentId: student.id,
    studentName: student.name,
    level: joinLevelsForDisplay(student.levels),
    participants: [
      { studentId: student.id, studentName: student.name, level: joinLevelsForDisplay(student.levels) },
    ],
    lessonType: 'individual',
    start: start.toISOString(),
    end: end.toISOString(),
    modality: draft.modality,
    status: 'scheduled',
    color: lessonColorForModality(draft.modality),
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
  };
}

export function isKnownStudent(
  studentId: string,
  students: StudentListItem[]
): boolean {
  return students.some((student) => student.id === studentId);
}

// Una clase es "huérfana" si CUALQUIERA de sus participantes (incluida
// una clase individual, que tiene un solo participante) apunta a un
// studentId que no existe en studentStore.
export function isOrphanLesson(
  lesson: CalendarLesson,
  students: StudentListItem[]
): boolean {
  return !lesson.participants.every((participant) =>
    isKnownStudent(participant.studentId, students)
  );
}

export function findOrphanLessons(
  lessons: CalendarLesson[],
  students: StudentListItem[]
): CalendarLesson[] {
  return lessons.filter((lesson) => isOrphanLesson(lesson, students));
}

// Filtra huérfanas para MOSTRAR (no borra nada de calendarStore) — así
// una clase con un alumno inexistente deja de verse como si fuera una
// clase real, sin destruir el dato por si se quiere migrar después.
export function filterOrphanLessons(
  lessons: CalendarLesson[],
  students: StudentListItem[]
): CalendarLesson[] {
  const orphanIds = new Set(
    findOrphanLessons(lessons, students).map((lesson) => lesson.id)
  );

  return lessons.filter((lesson) => !orphanIds.has(lesson.id));
}

// Antes de guardar CUALQUIER clase nueva: todos sus participantes tienen
// que existir ya en studentStore. Es la barrera que pediste para que
// "ninguna clase nueva pueda guardarse con un alumno inexistente".
export function validateLessonStudents(
  lesson: CalendarLesson,
  students: StudentListItem[]
): { isValid: boolean; missingStudentIds: string[] } {
  const missingStudentIds = lesson.participants
    .filter((participant) => !isKnownStudent(participant.studentId, students))
    .map((participant) => participant.studentId);

  return {
    isValid: missingStudentIds.length === 0,
    missingStudentIds,
  };
}

export interface MigrationResult {
  createdStudents: StudentListItem[];
  stillOrphanLessonIds: string[];
}

// OPCIONAL — no se llama automáticamente en ningún lado. Convierte cada
// participante huérfano en un alumno real, reutilizando el mismo
// studentId que ya tenía la clase (así la clase queda enlazada sin
// tocar CalendarLesson), y sin duplicar nombres que ya existen.
export function migrateOrphanLessonsToStudents(
  lessons: CalendarLesson[],
  students: StudentListItem[]
): MigrationResult {
  const existingNames = new Set(
    students.map((student) => normalizeSearchText(student.name))
  );

  const createdStudents: StudentListItem[] = [];
  const createdInThisRun = new Set<string>();

  findOrphanLessons(lessons, students).forEach((lesson) => {
    lesson.participants.forEach((participant) => {
      if (isKnownStudent(participant.studentId, students)) {
        return;
      }

      const normalized = normalizeSearchText(participant.studentName);

      if (
        existingNames.has(normalized) ||
        createdInThisRun.has(normalized)
      ) {
        return;
      }

      // `participant.level` es el string ya unido con ", " (ver
      // `joinLevelsForDisplay`) — se separa de vuelta para reconstruir la
      // lista; caso límite aceptable en esta migración OPCIONAL y ya
      // best-effort (nunca se llama automáticamente).
      const reconstructedLevels = participant.level
        ? participant.level.split(',').map((level) => level.trim()).filter(Boolean)
        : [];
      createdStudents.push({
        id: participant.studentId,
        name: participant.studentName,
        levels: reconstructedLevels.length > 0 ? reconstructedLevels : ['A1'],
        status: 'activo',
        modality: 'presencial',
        nextClassAt: null,
        paymentStatus: 'verde',
        averageGrade: 0,
        classesThisMonth: 0,
        lastPaymentAt: null,
        isFeatured: false,
        isNew: true,
        hasOverduePayment: false,
        hasPendingReport: false,
        hasPendingHomework: false,
      });

      createdInThisRun.add(normalized);
    });
  });

  const studentsAfterMigration = [...students, ...createdStudents];

  const stillOrphanLessonIds = findOrphanLessons(
    lessons,
    studentsAfterMigration
  ).map((lesson) => lesson.id);

  return { createdStudents, stillOrphanLessonIds };
}
