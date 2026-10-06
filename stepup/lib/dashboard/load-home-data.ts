import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules, type RecurrenceRuleRecord } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsInRange } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { listRegistrationProgressForCalendarLessonIds } from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { listOpenChargeBalances } from "@/lib/repositories/payments";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { DEFAULT_RECURRENCE_HORIZON_DAYS } from "@/lib/calendar/recurrence-engine";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { selectCurrentOrNextOccurrence, type LessonTimingStatus } from "@/lib/calendar/next-class";
import { buildEmptyClassesSummary, type EmptyClassesSummary } from "@/lib/calendar/empty-classes";
import { buildPendingLessons, type PendingLessonItem } from "@/lib/lessons/pending";
import { buildCollectionsCenterEntriesFromBalances, type CollectionsCenterEntry } from "@/lib/payments/collections-center";
import { summarizeCollectionsUrgency, type CollectionsUrgencySummary } from "@/lib/payments/collections-urgency";
import { buildRemindersCenterSummary, type RemindersCenterSummary } from "@/lib/dashboard/reminders-center";
import { instantMinutesOfDay } from "@/lib/calendar/civil-calendar";
import { localDateKeyInTimeZone, billingPeriodOfDateKey, ARGENTINA_TIME_ZONE } from "@/lib/payments/dates";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import type { RecurrenceRuleForEngine } from "@/lib/calendar/types";

export interface HomeNextClass {
  item: CalendarViewItem;
  timing: "in_progress" | "upcoming";
}

export interface HomeData {
  todayDateKey: string;
  /** Hora civil (0-23) en Argentina al momento de la carga: la usa el saludo (nunca la hora del servidor, que es UTC). */
  localHour: number;
  /** Alumnos de la cuenta en cualquier estado / sólo activos (datos ya cargados, sin consulta extra). */
  studentCount: number;
  activeStudentCount: number;
  /** `true` si lo ya cargado muestra alguna clase o serie; `false` NO prueba que no exista ninguna (ver `loadHomeWelcome`). */
  hasClassSignal: boolean;
  nextClass: HomeNextClass | null;
  todayLessons: CalendarViewItem[];
  emptyClasses: EmptyClassesSummary;
  pendingLessons: PendingLessonItem[];
  collectionEntries: CollectionsCenterEntry[];
  collectionsUrgency: CollectionsUrgencySummary;
  remindersSummary: RemindersCenterSummary;
}

function toEngineRule(rule: RecurrenceRuleRecord): RecurrenceRuleForEngine {
  return {
    recurrenceId: rule.id,
    studentId: rule.primaryStudentId,
    participantIds: rule.participantIds,
    cycleLengthWeeks: rule.cycleLengthWeeks,
    weeks: rule.weeks,
    modality: rule.modality,
    timezone: rule.timezone,
    startDate: rule.startDate,
    endDate: rule.endDate,
    status: rule.status,
    classTitle: rule.classTitle,
    activityKind: rule.activityKind,
  };
}

/**
 * Orquestador único de Inicio y Recordatorios — combina todos los
 * repositorios ya existentes con los motores puros ya portados de esta
 * fase; nunca duplica una consulta que otra pantalla ya resuelve mejor
 * (reutiliza `loadCalendarViewForRange`, `buildCollectionsCenterEntries`,
 * `buildPendingLessons`, ya probados en Fases 3-5). Genera automáticamente
 * los cargos del período vigente (mismo criterio que `/cobros`) antes de
 * calcular las alertas de cobro, para que la campana de Inicio nunca quede
 * desactualizada respecto del Centro de Cobros real.
 */
export async function loadHomeData(ctx: AuthenticatedDbContext): Promise<HomeData> {
  const now = new Date();
  const todayDateKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const dayStartIso = localDateTimeToInstantIso({ date: todayDateKey, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE });
  const dayEndExclusive = new Date(new Date(dayStartIso).getTime() + 24 * 60 * 60 * 1000 - 1);
  const horizonEnd = new Date(now.getTime() + DEFAULT_RECURRENCE_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const [rules, students, todayItems, horizonLessons] = await Promise.all([
    listRecurrenceRules(ctx),
    listStudents(ctx),
    loadCalendarViewForRange(ctx, new Date(dayStartIso), dayEndExclusive),
    listCalendarLessonsInRange(ctx, now.toISOString(), horizonEnd.toISOString()),
  ]);

  const exceptions = await listRecurrenceExceptionsForRules(ctx, rules.map((rule) => rule.id));

  const todayLessons = todayItems.filter((item) => item.status !== "cancelled");
  const nextClassSelection = selectCurrentOrNextOccurrence(todayLessons, now);
  const nextClass: HomeNextClass | null = nextClassSelection ? { item: nextClassSelection.occurrence, timing: nextClassSelection.timing } : null;

  const emptyClasses = buildEmptyClassesSummary({
    recurrenceRules: rules.map(toEngineRule),
    lessons: horizonLessons.map((lesson) => ({
      id: lesson.id,
      recurrenceId: lesson.recurrenceId,
      recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
      status: lesson.status,
      startAt: lesson.startAt,
      isRecurring: lesson.isRecurring,
      participantIds: lesson.participantIds,
      classTitle: lesson.classTitle,
    })),
    exceptions: exceptions.map((exception) => ({
      recurrenceId: exception.recurrenceId,
      occurrenceKey: exception.occurrenceKey,
      type: exception.type,
      replacementLessonId: exception.replacementLessonId,
    })),
    now,
  });

  const pendingLookbackStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const pendingItems = await loadCalendarViewForRange(ctx, pendingLookbackStart, now);
  const pendingLessonIds = pendingItems.map((item) => item.materializedLessonId).filter((id): id is string => !!id);
  const registrations = await listRegistrationProgressForCalendarLessonIds(ctx, pendingLessonIds);
  const pendingLessons = buildPendingLessons({ calendarItems: pendingItems, now, registrations });

  // R2: esta lectura NO genera cargos (un GET nunca escribe): la generación del período la dispara `ChargeGenerationTrigger`
  // (Server Action) y la pantalla se refresca si se creó algo.
  // R2: sólo los cargos con saldo pendiente (calculados en la base), no toda la historia de cargos/asignaciones/pagos.
  const balances = await listOpenChargeBalances(ctx);
  const collectionEntries = buildCollectionsCenterEntriesFromBalances({
    balances,
    students: students.map((s) => ({ id: s.id, name: s.name, status: s.status })),
    todayDateKey,
  });

  const collectionsUrgency = summarizeCollectionsUrgency(collectionEntries, todayDateKey);
  const remindersSummary = buildRemindersCenterSummary({
    emptyClassItems: emptyClasses.items,
    pendingLessons,
    collectionEntries,
    todayDateKey,
  });

  return {
    todayDateKey,
    localHour: Math.floor(instantMinutesOfDay(now.toISOString()) / 60),
    studentCount: students.length,
    activeStudentCount: students.filter((student) => student.status === "activo").length,
    hasClassSignal: rules.length > 0 || todayItems.length > 0 || horizonLessons.length > 0 || pendingItems.length > 0,
    nextClass,
    todayLessons,
    emptyClasses,
    pendingLessons,
    collectionEntries,
    collectionsUrgency,
    remindersSummary,
  };
}

export type { LessonTimingStatus };
