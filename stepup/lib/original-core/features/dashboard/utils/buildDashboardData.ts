// Puerto VERBATIM del original (`src/features/dashboard/utils/buildDashboardData.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import { buildCalendarReservationKey } from '../../calendar/utils/calendarRecurrenceMutations.ts';
import type { SavedLesson } from '../../new-class/types/index.ts';
import type { StudentListItem } from '../../students/types/index.ts';
import type { DashboardData, NextClass, TodayLesson } from '../types/index.ts';
import { lessonDisplayTitle } from '../../calendar/utils/calendarParticipants.ts';
import { selectCurrentOrNextOccurrence } from '../../calendar/utils/calendarNextClassAt.ts';
import { buildLessonsInRange } from './calendarOccurrenceRange.ts';
import { buildEmptyClassesSummary } from './emptyClasses.ts';
import { buildPendingClasses } from './pendingClasses.ts';

export interface DashboardDataSources {
  now: Date;
  students: StudentListItem[];
  lessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
  savedLessons: SavedLesson[];
}

function startOfWeek(value: Date): Date {
  const start = new Date(value);
  const day = start.getDay();
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfWeek(value: Date): Date {
  const end = startOfWeek(value);
  end.setDate(end.getDate() + 7);
  return end;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthKey(value: Date): string {
  return localDateKey(value).slice(0, 7);
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function durationMinutes(lesson: CalendarLesson): number {
  return Math.max(
    0,
    Math.round((new Date(lesson.end).getTime() - new Date(lesson.start).getTime()) / 60_000)
  );
}

function toTodayLesson(lesson: CalendarLesson): TodayLesson {
  return {
    id: lesson.id,
    studentId: lesson.studentId,
    time: formatTime(lesson.start),
    start: lesson.start,
    durationMinutes: durationMinutes(lesson),
    studentNames: lesson.participants.map((participant) => participant.studentName),
    displayTitle: lessonDisplayTitle(lesson),
    isGroupClass: lesson.lessonType === 'group',
    modality: lesson.modality,
    status: lesson.status,
    originalStart: lesson.recurrenceOriginalStart,
    scheduleAdjustment: lesson.scheduleAdjustment,
    calendarRegistration: {
      reservationKey: buildCalendarReservationKey(lesson),
      lessonId: lesson.id,
      studentId: lesson.studentId,
      start: lesson.start,
      end: lesson.end,
      modality: lesson.modality,
      recurrenceId: lesson.recurrenceId,
      recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
    },
  };
}

function buildWeekLessons(sources: DashboardDataSources): CalendarLesson[] {
  return buildLessonsInRange(sources, startOfWeek(sources.now), endOfWeek(sources.now));
}

export function buildDashboardData(sources: DashboardDataSources): DashboardData {
  const weekLessons = buildWeekLessons(sources);
  const todayKey = localDateKey(sources.now);
  const todayLessons = weekLessons
    .filter(
      (lesson) =>
        lesson.status !== 'cancelled' && localDateKey(new Date(lesson.start)) === todayKey
    )
    .map(toTodayLesson);

  // Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
  // TERMINE LA CLASE EN CURSO): antes exigía `start >= now` — en el instante
  // exacto en que una clase empezaba, dejaba de cumplir esa condición y el
  // resultado saltaba de inmediato a la clase siguiente de hoy, aunque la
  // actual siguiera en curso. `selectCurrentOrNextOccurrence` (única función
  // real de selección/prioridad) prioriza la clase EN CURSO; recién cuando
  // ninguna está en curso elige la próxima futura.
  const nextClassSelection = selectCurrentOrNextOccurrence(
    todayLessons.map((lesson) => ({
      ...lesson,
      end: new Date(new Date(lesson.start).getTime() + lesson.durationMinutes * 60_000).toISOString(),
    })),
    sources.now
  );
  const nextClass: NextClass | null = nextClassSelection
    ? (() => {
        const { end: _end, ...todayLesson } = nextClassSelection.occurrence;
        return { ...todayLesson, timing: nextClassSelection.timing };
      })()
    : null;

  const currentMonth = monthKey(sources.now);
  const completedThisMonth = sources.savedLessons.filter(
    (lesson) => lesson.countsAsClass && lesson.form.date.slice(0, 7) === currentMonth
  );
  const taughtMinutes = completedThisMonth.reduce(
    (total, lesson) => total + (lesson.form.actualDurationMinutes ?? 0),
    0
  );
  const grades = sources.savedLessons.flatMap((lesson) =>
    lesson.countsAsClass
      ? lesson.form.evaluations
          .map((evaluation) => evaluation.generalGrade)
          .filter((grade): grade is number => grade !== null)
      : []
  );
  const averageGrade =
    grades.length === 0
      ? null
      : Math.round((grades.reduce((total, grade) => total + grade, 0) / grades.length) * 10) /
        10;

  const pendingClasses = buildPendingClasses(sources);
  const emptyClasses = buildEmptyClassesSummary({
    recurrenceRules: sources.recurrenceRules,
    lessons: sources.lessons,
    recurrenceExceptions: sources.recurrenceExceptions,
    now: sources.now,
  });

  return {
    nextClass,
    todayLessons,
    pendingClasses,
    emptyClasses,
    stats: {
      activeStudents: sources.students.filter((student) => student.status === 'activo').length,
      lessonsThisWeek: weekLessons.filter((lesson) => lesson.status !== 'cancelled').length,
      hoursTaughtThisMonth: Math.round((taughtMinutes / 60) * 10) / 10,
      averageGrade,
    },
  };
}
