// Puerto VERBATIM del original (`src/features/calendar/utils/calendarAnalytics.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarAnalytics,
  CalendarLesson,
} from '../types/index.ts';

const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 22;
const DAYS_PER_WEEK = 7;

interface TimeInterval {
  start: number;
  end: number;
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, '0');
  const day = String(
    date.getDate()
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getDayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
  }).format(new Date(dateIso));
}

function capitalize(value: string): string {
  if (!value) return value;

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function mergeIntervals(
  intervals: TimeInterval[]
): TimeInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort(
    (first, second) =>
      first.start - second.start
  );

  const merged: TimeInterval[] = [
    { ...sorted[0] },
  ];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous =
      merged[merged.length - 1];

    if (current.start <= previous.end) {
      previous.end = Math.max(
        previous.end,
        current.end
      );
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function calculateOccupiedHours(
  lessons: CalendarLesson[]
): number {
  const intervalsByDay = new Map<
    string,
    TimeInterval[]
  >();

  lessons.forEach((lesson) => {
    const start = new Date(lesson.start);
    const end = new Date(lesson.end);

    const startTime = start.getTime();
    const endTime = end.getTime();

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime <= startTime
    ) {
      return;
    }

    const dayKey = getLocalDateKey(start);

    const currentIntervals =
      intervalsByDay.get(dayKey) ?? [];

    currentIntervals.push({
      start: startTime,
      end: endTime,
    });

    intervalsByDay.set(
      dayKey,
      currentIntervals
    );
  });

  let occupiedMilliseconds = 0;

  intervalsByDay.forEach((intervals) => {
    const merged = mergeIntervals(intervals);

    merged.forEach((interval) => {
      occupiedMilliseconds +=
        interval.end - interval.start;
    });
  });

  return (
    Math.round(
      (occupiedMilliseconds / 3_600_000) * 10
    ) / 10
  );
}

export function calculateCalendarAnalytics(
  lessons: CalendarLesson[]
): CalendarAnalytics {
  const validLessons = lessons.filter(
    (lesson) =>
      lesson.status !== 'cancelled'
  );

  const lessonsByDay = new Map<
    string,
    number
  >();

  const studentsByHour = new Map<
    number,
    number
  >();

  let onlineLessons = 0;
  let presencialLessons = 0;
  let mixedLessons = 0;

  let groupLessons = 0;
  let individualLessons = 0;
  let intentionalOverlaps = 0;
  let totalStudentsServed = 0;

  validLessons.forEach((lesson) => {
    const startDate = new Date(
      lesson.start
    );

    const dayKey =
      getLocalDateKey(startDate);

    const startHour =
      startDate.getHours();

    lessonsByDay.set(
      dayKey,
      (lessonsByDay.get(dayKey) ?? 0) + 1
    );

    const participantCount = Math.max(
      1,
      lesson.participants.length
    );

    studentsByHour.set(
      startHour,
      (studentsByHour.get(startHour) ?? 0) +
        participantCount
    );

    totalStudentsServed += participantCount;

    switch (lesson.modality) {
      case 'online':
        onlineLessons += 1;
        break;

      case 'presencial':
        presencialLessons += 1;
        break;

      case 'mixta':
        mixedLessons += 1;
        break;
    }

    if (lesson.lessonType === 'group') {
      groupLessons += 1;
    } else {
      individualLessons += 1;
    }

    if (lesson.overlapAllowed) {
      intentionalOverlaps += 1;
    }
  });

  let busiestDayKey = '';
  let busiestDayCount = 0;

  lessonsByDay.forEach(
    (count, dayKey) => {
      if (count > busiestDayCount) {
        busiestDayCount = count;
        busiestDayKey = dayKey;
      }
    }
  );

  let busiestHour = WORKDAY_START_HOUR;
  let busiestHourDemand = 0;

  studentsByHour.forEach(
    (demand, hour) => {
      if (demand > busiestHourDemand) {
        busiestHourDemand = demand;
        busiestHour = hour;
      }
    }
  );

  const availableHours =
    (WORKDAY_END_HOUR -
      WORKDAY_START_HOUR) *
    DAYS_PER_WEEK;

  const occupiedHours =
    calculateOccupiedHours(validLessons);

  const occupationRate =
    availableHours > 0
      ? Math.min(
          100,
          Math.round(
            (occupiedHours /
              availableHours) *
              100
          )
        )
      : 0;

  return {
    busiestDay: busiestDayKey
      ? capitalize(
          getDayLabel(
            `${busiestDayKey}T12:00:00`
          )
        )
      : 'Sin datos',

    busiestHour,

    occupationRate,

    totalLessons: validLessons.length,

    totalStudentsServed,

    occupiedHours,

    freeHours:
      Math.round(
        Math.max(
          0,
          availableHours -
            occupiedHours
        ) * 10
      ) / 10,

    onlineLessons,

    presencialLessons,

    mixedLessons,

    groupLessons,

    individualLessons,

    intentionalOverlaps,
  };
}