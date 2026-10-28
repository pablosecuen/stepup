// Puerto VERBATIM del original (`src/features/calendar/hooks/calendarStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';

import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';

export const CALENDAR_STORAGE_KEYS = {
  lessons: '@teacherflow/calendar_lessons',
  recurrenceRules: '@teacherflow/calendar_recurrence_rules',
  recurrenceExceptions: '@teacherflow/calendar_recurrence_exceptions',
} as const;

export interface HydratedCalendarState {
  lessons: CalendarLesson[];
  rules: RecurrenceRule[];
  exceptions: RecurrenceException[];
}

/**
 * Corrección 2026-08-27, cuarta ronda (a pedido de Joaquín — prueba real de
 * hidratación no destructiva, con adaptadores en memoria, no sólo texto):
 * la ÚNICA lógica real detrás de `hydrateCalendar`/`refetch` en
 * `useWeeklyCalendar.ts` (además de la orquestación de estado de React, que
 * no se puede probar sin montar el hook — convención de este proyecto).
 * Deliberadamente NO repara, NO reordena, NO filtra nada — sólo sustituye
 * `null` (clave todavía sin escribir) por un array vacío. Al extraerla acá
 * como función pura, se puede probar con datos reales en memoria — sanos o
 * ya dañados — sin mockear `AsyncStorage` ni montar el hook.
 */
export function deriveHydratedCalendarState(input: {
  storedLessons: CalendarLesson[] | null;
  storedRules: RecurrenceRule[] | null;
  storedExceptions: RecurrenceException[] | null;
}): HydratedCalendarState {
  return {
    lessons: input.storedLessons ?? [],
    rules: input.storedRules ?? [],
    exceptions: input.storedExceptions ?? [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCalendarLesson(value: unknown): CalendarLesson | null {
  if (!isRecord(value)) return null;

  const requiredStrings = [
    'id',
    'studentId',
    'studentName',
    'level',
    'start',
    'end',
    'modality',
    'status',
    'color',
  ];

  if (requiredStrings.some((key) => typeof value[key] !== 'string')) {
    return null;
  }

  if (!Array.isArray(value.participants)) return null;

  const legacyLessonType = value.lessonType;
  const lessonType =
    legacyLessonType === 'group' || legacyLessonType === 'grupal'
      ? 'group'
      : 'individual';

  return {
    ...(value as unknown as CalendarLesson),
    lessonType,
    overlapAllowed: value.overlapAllowed === true,
    overlapGroupId:
      typeof value.overlapGroupId === 'string'
        ? value.overlapGroupId
        : null,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
    isRecurring: value.isRecurring === true,
    recurrenceId:
      typeof value.recurrenceId === 'string' ? value.recurrenceId : null,
    recurrenceOccurrenceKey:
      typeof value.recurrenceOccurrenceKey === 'string'
        ? value.recurrenceOccurrenceKey
        : null,
    recurrenceIndex:
      typeof value.recurrenceIndex === 'number'
        ? value.recurrenceIndex
        : null,
    recurrenceOriginalStart:
      typeof value.recurrenceOriginalStart === 'string'
        ? value.recurrenceOriginalStart
        : null,
  };
}

async function readArray(key: string): Promise<unknown[] | null> {
  const storedValue = await AsyncStorage.getItem(key);
  if (!storedValue) return null;

  const parsedValue: unknown = JSON.parse(storedValue);
  return Array.isArray(parsedValue) ? parsedValue : null;
}

async function writeArray<T>(key: string, values: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(values));
}

export async function loadCalendarLessons(): Promise<CalendarLesson[] | null> {
  try {
    const storedLessons = await readArray(CALENDAR_STORAGE_KEYS.lessons);
    if (!storedLessons) return null;

    return storedLessons
      .map(normalizeCalendarLesson)
      .filter((lesson): lesson is CalendarLesson => lesson !== null);
  } catch (error) {
    console.error('Error cargando las clases del calendario:', error);
    return null;
  }
}

export async function saveCalendarLessons(
  lessons: CalendarLesson[]
): Promise<void> {
  try {
    await writeArray(CALENDAR_STORAGE_KEYS.lessons, lessons);
  } catch (error) {
    console.error('Error guardando las clases del calendario:', error);
    throw error;
  }
}

export async function loadRecurrenceRules(): Promise<RecurrenceRule[] | null> {
  try {
    return (await readArray(
      CALENDAR_STORAGE_KEYS.recurrenceRules
    )) as RecurrenceRule[] | null;
  } catch (error) {
    console.error('Error cargando las reglas recurrentes:', error);
    return null;
  }
}

export async function saveRecurrenceRules(
  rules: RecurrenceRule[]
): Promise<void> {
  try {
    await writeArray(CALENDAR_STORAGE_KEYS.recurrenceRules, rules);
  } catch (error) {
    console.error('Error guardando las reglas recurrentes:', error);
    throw error;
  }
}

export async function loadRecurrenceExceptions(): Promise<
  RecurrenceException[] | null
> {
  try {
    return (await readArray(
      CALENDAR_STORAGE_KEYS.recurrenceExceptions
    )) as RecurrenceException[] | null;
  } catch (error) {
    console.error('Error cargando las excepciones recurrentes:', error);
    return null;
  }
}

export async function saveRecurrenceExceptions(
  exceptions: RecurrenceException[]
): Promise<void> {
  try {
    await writeArray(CALENDAR_STORAGE_KEYS.recurrenceExceptions, exceptions);
  } catch (error) {
    console.error('Error guardando las excepciones recurrentes:', error);
    throw error;
  }
}

export async function saveCalendarRecurrenceSnapshot(
  lessons: CalendarLesson[],
  rules: RecurrenceRule[],
  exceptions: RecurrenceException[]
): Promise<void> {
  await AsyncStorage.multiSet([
    [CALENDAR_STORAGE_KEYS.lessons, JSON.stringify(lessons)],
    [CALENDAR_STORAGE_KEYS.recurrenceRules, JSON.stringify(rules)],
    [CALENDAR_STORAGE_KEYS.recurrenceExceptions, JSON.stringify(exceptions)],
  ]);
}

export async function clearCalendarLessons(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CALENDAR_STORAGE_KEYS.lessons);
  } catch (error) {
    console.error('Error eliminando las clases del calendario:', error);
    throw error;
  }
}

export async function clearCalendarRecurrenceData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      CALENDAR_STORAGE_KEYS.recurrenceRules,
      CALENDAR_STORAGE_KEYS.recurrenceExceptions,
    ]);
  } catch (error) {
    console.error('Error eliminando los datos recurrentes:', error);
    throw error;
  }
}
