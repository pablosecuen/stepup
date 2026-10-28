// Puerto VERBATIM del original (`src/features/calendar/utils/calendarConflicts.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarConflict,
  CalendarLesson,
} from '../types/index.ts';

function toTimestamp(value: string): number {
  return new Date(value).getTime();
}

function intervalsOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): boolean {
  return firstStart < secondEnd && firstEnd > secondStart;
}

export function findCalendarConflicts(
  candidateStart: string,
  candidateEnd: string,
  lessons: CalendarLesson[],
  ignoredLessonId?: string
): CalendarConflict[] {
  const candidateStartTime = toTimestamp(candidateStart);
  const candidateEndTime = toTimestamp(candidateEnd);

  if (
    !Number.isFinite(candidateStartTime) ||
    !Number.isFinite(candidateEndTime) ||
    candidateEndTime <= candidateStartTime
  ) {
    return [];
  }

  return lessons
    .filter((lesson) => {
      if (lesson.id === ignoredLessonId) {
        return false;
      }

      if (lesson.status === 'cancelled') {
        return false;
      }

      const lessonStart = toTimestamp(lesson.start);
      const lessonEnd = toTimestamp(lesson.end);

      return intervalsOverlap(
        candidateStartTime,
        candidateEndTime,
        lessonStart,
        lessonEnd
      );
    })
    .map((lesson) => {
      const lessonStart = toTimestamp(lesson.start);
      const lessonEnd = toTimestamp(lesson.end);

      const overlapStartTime = Math.max(
        candidateStartTime,
        lessonStart
      );

      const overlapEndTime = Math.min(
        candidateEndTime,
        lessonEnd
      );

      const exactSameSchedule =
        candidateStartTime === lessonStart &&
        candidateEndTime === lessonEnd;

      return {
        conflictingLesson: lesson,

        overlapStart: new Date(
          overlapStartTime
        ).toISOString(),

        overlapEnd: new Date(
          overlapEndTime
        ).toISOString(),

        overlapMinutes: Math.max(
          0,
          Math.round(
            (overlapEndTime - overlapStartTime) /
              60_000
          )
        ),

        exactSameSchedule,

        /**
         * Para convertir dos eventos en una clase grupal exigimos que
         * compartan exactamente inicio, final y modalidad compatible.
         */
        canConvertToGroup:
          exactSameSchedule &&
          !lesson.isRecurring &&
          lesson.lessonType !== 'group',
      };
    });
}

export function hasBlockingConflict(
  conflicts: CalendarConflict[]
): boolean {
  return conflicts.some(
    (conflict) =>
      !conflict.conflictingLesson.overlapAllowed
  );
}

export function createOverlapGroupId(): string {
  return `overlap_${Date.now()}`;
}

export function mergeLessonsIntoGroup(
  existingLesson: CalendarLesson,
  newLesson: CalendarLesson
): CalendarLesson {
  const participantsMap = new Map(
    existingLesson.participants.map(
      (participant) => [
        participant.studentId,
        participant,
      ]
    )
  );

  newLesson.participants.forEach(
    (participant) => {
      participantsMap.set(
        participant.studentId,
        participant
      );
    }
  );

  const participants = Array.from(
    participantsMap.values()
  );

  const firstParticipant =
    participants[0];

  return {
    ...existingLesson,

    studentId:
      firstParticipant?.studentId ??
      existingLesson.studentId,

    studentName:
      participants.length > 1
        ? `${participants[0]?.studentName ?? ''} + ${
            participants.length - 1
          }`
        : existingLesson.studentName,

    level:
      firstParticipant?.level ??
      existingLesson.level,

    participants,

    lessonType: 'group',

    overlapAllowed: false,

    overlapGroupId: null,

    notes: [
      existingLesson.notes,
      newLesson.notes,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
