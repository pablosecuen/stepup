import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { RecurrenceRuleRecord } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsInRange } from "@/lib/repositories/calendar-lessons";
import { listRegistrationProgressForCalendarLessonIds } from "@/lib/repositories/lesson-registrations";
import { loadLegacyRegisteredOccurrenceKeys } from "@/lib/repositories/legacy-registered-occurrences";
import { listOpenChargeBalances } from "@/lib/repositories/payments";
import { loadHomeStatsInputs } from "@/lib/repositories/home-stats-inputs";
import { getLiveClassSession } from "@/lib/repositories/live-class";
import type { LiveClassSession } from "@/lib/live-class/live-class";
import { buildHomeStats, weekBounds, type HomeStats } from "@/lib/dashboard/home-stats";
import { composeCalendarView, loadCalendarViewBase } from "@/lib/calendar/view";
import { withoutExcludedLessons, withoutExcludedRules } from "@/lib/data-exclusion/exclusion";
import { DEFAULT_RECURRENCE_HORIZON_DAYS } from "@/lib/calendar/recurrence-engine";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { selectCurrentOrNextOccurrence, type LessonTimingStatus } from "@/lib/calendar/next-class";
import { buildEmptyClassesSummary, type EmptyClassesSummary } from "@/lib/calendar/empty-classes";
import { buildPendingLessons, type PendingLessonItem } from "@/lib/lessons/pending";
import { buildCollectionsCenterEntriesFromBalances, type CollectionsCenterEntry } from "@/lib/payments/collections-center";
import { summarizeCollectionsUrgency, type CollectionsUrgencySummary } from "@/lib/payments/collections-urgency";
import { buildRemindersCenterSummary, type RemindersCenterSummary } from "@/lib/dashboard/reminders-center";
import { instantMinutesOfDay } from "@/lib/calendar/civil-calendar";
import { buildTodayAgenda, type TodayAgendaEntry } from "@/lib/dashboard/today-agenda";
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
  /** Instante de la carga (el reloj con el que se calcularon los estados de «Clases de hoy»). */
  nowIso: string;
  nextClass: HomeNextClass | null;
  /** Indicadores de la cuenta (alumnos activos, clases de la semana, horas del mes, promedio de evaluaciones). */
  stats: HomeStats;
  /** La clase en curso (comenzada con «Comenzar clase»), o `null`. Si no se pudo leer también es `null`: comenzar otra sigue siendo seguro (la base rechaza una segunda). */
  liveClass: LiveClassSession | null;
  /** Clases de hoy NO canceladas (alimentan el contador y «próxima clase»). */
  todayLessons: CalendarViewItem[];
  /** Agenda completa del día civil de Argentina, cronológica y sin límite (incluye las canceladas que el calendario muestra). */
  todayAgenda: TodayAgendaEntry[];
  /** Todo lo compuesto para hoy (para decidir sobre reusar el horario de una clase cancelada, igual que el Calendario). */
  todayAllItems: CalendarViewItem[];
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

  const pendingLookbackStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  // Semana de lunes a domingo (días civiles de Argentina) para «Clases esta semana».
  const week = weekBounds(todayDateKey);
  const weekStart = new Date(localDateTimeToInstantIso({ date: week.startKey, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE }));
  const weekEndExclusive = new Date(new Date(localDateTimeToInstantIso({ date: week.endExclusiveKey, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE })).getTime() - 1);

  // Ola 1: todo lo que no depende de otra lectura sale junto (antes eran seis esperas seguidas, cada una con su ida y vuelta a la
  // base). El resultado es exactamente el mismo.
  // R2: esta lectura NO genera cargos (un GET nunca escribe): la generación del período la dispara `ChargeGenerationTrigger`
  // (Server Action) y la pantalla se refresca si se creó algo. Sólo los cargos con saldo pendiente (calculados en la base).
  // Series, excepciones y alumnos se leen UNA vez y alimentan las dos vistas del calendario (hoy y los últimos 90 días) y el resumen
  // de clases vacías (antes cada vista los volvía a pedir: reglas, alumnos y excepciones se leían tres veces).
  // Las clases de cada rango se leen a la vez que la base (no dependen de ella) y las vistas se componen cuando llega todo.
  const dayStart = new Date(dayStartIso);
  // Información complementaria (horas del mes y promedio): arranca a la vez que las demás lecturas; si no se puede leer, esas dos cifras dicen «Sin datos» y el resto de Inicio sigue igual.
  const statsInputsPromise = loadHomeStatsInputs(ctx, todayDateKey.slice(0, 7)).catch(() => null);
  const liveClassPromise = getLiveClassSession(ctx).catch(() => null);
  const [{ rules: allRules, students, exceptions, occurrenceMarkers, excludedStudentIds }, todayLessonRows, allHorizonLessons, pendingLessonRows, balances] = await Promise.all([
    loadCalendarViewBase(ctx),
    listCalendarLessonsInRange(ctx, dayStart.toISOString(), dayEndExclusive.toISOString()),
    listCalendarLessonsInRange(ctx, now.toISOString(), horizonEnd.toISOString()),
    listCalendarLessonsInRange(ctx, pendingLookbackStart.toISOString(), now.toISOString()),
    listOpenChargeBalances(ctx),
  ]);
  const statsInputs = await statsInputsPromise;
  const liveClass = await liveClassPromise;
  const calendarBase = { rules: allRules, students, exceptions, occurrenceMarkers, excludedStudentIds };
  // Datos de prueba confirmados (R16): fuera de la agenda, los pendientes y las clases vacías; con la lista vacía no cambia nada.
  const rules = withoutExcludedRules(allRules, excludedStudentIds);
  const horizonLessons = withoutExcludedLessons(allHorizonLessons, excludedStudentIds);
  const todayItems = composeCalendarView(calendarBase, todayLessonRows, dayStart, dayEndExclusive);
  const pendingItems = composeCalendarView(calendarBase, pendingLessonRows, pendingLookbackStart, now);

  // Ola 2: lo que depende de las clases pendientes.
  const pendingLessonIds = pendingItems.map((item) => item.materializedLessonId).filter((id): id is string => !!id);
  const [registrations, legacyRegisteredOccurrences] = await Promise.all([listRegistrationProgressForCalendarLessonIds(ctx, pendingLessonIds), loadLegacyRegisteredOccurrenceKeys(ctx)]);

  const todayLessons = todayItems.filter((item) => item.status !== "cancelled");
  // Misma lectura acotada al día (una sola consulta): sin una consulta por clase ni historia que filtrar en el cliente.
  const todayAgenda = buildTodayAgenda(todayItems, now, todayDateKey);
  // La semana sale de las lecturas que ya se hicieron (los últimos 90 días hasta ahora + el horizonte desde ahora): sin una consulta más.
  const weekLessonRows = [...new Map([...pendingLessonRows, ...allHorizonLessons].map((lesson) => [lesson.id, lesson])).values()];
  const weekItems = composeCalendarView(calendarBase, weekLessonRows, weekStart, weekEndExclusive);
  const activeStudentCount = students.filter((student) => student.status === "activo").length;
  const stats: HomeStats = statsInputs
    ? buildHomeStats({ activeStudents: activeStudentCount, weekItems, monthMinutes: statsInputs.monthMinutes, grades: statsInputs.grades })
    : { ...buildHomeStats({ activeStudents: activeStudentCount, weekItems, monthMinutes: [], grades: [] }), hoursTaughtThisMonth: null, averageGrade: null };
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

  const pendingLessons = buildPendingLessons({ calendarItems: pendingItems, now, registrations, legacyRegisteredOccurrences });

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
    nowIso: now.toISOString(),
    nextClass,
    stats,
    liveClass,
    todayLessons,
    todayAgenda,
    todayAllItems: todayItems,
    emptyClasses,
    pendingLessons,
    collectionEntries,
    collectionsUrgency,
    remindersSummary,
  };
}

export type { LessonTimingStatus };
