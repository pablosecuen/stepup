// Puerto VERBATIM del original (`src/features/dashboard/utils/programmedHourlyRateSummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Valor programado de tu hora (corrección 2026-08-10, a pedido de Joaquín —
 * "CORRECCIÓN DE DEFINICIONES: RESUMEN FINANCIERO Y VALOR HORA"). Reemplaza
 * por completo `payments/utils/hourlyRateSummary.ts` (eliminado): esa
 * versión sólo recorría `SavedLesson[]` — clases YA registradas
 * pedagógicamente — así que cualquier clase todavía sin registrar (pasada
 * sin cargar, o futura) quedaba completamente afuera del cálculo, tanto del
 * numerador como del denominador. Ver el informe de auditoría entregado
 * para el caso real ($112.640, ~25 horas contabilizadas de ~40
 * programadas).
 *
 * PRINCIPIO (no negociable): el valor programado de la hora es un número
 * TOTALMENTE independiente de:
 *   - si el alumno ya pagó, pagó tarde, o pagó retroactivamente;
 *   - si la profesora todavía no registró el pago;
 *   - si faltan clases por registrar pedagógicamente.
 * Nunca lee `Payment`/`PaymentAllocation`. Cuando sí lee `PaymentCharge`,
 * es únicamente por su `originalAmount` (la obligación contractual, nunca
 * si está pagada) — el mismo criterio que ya usa `periodFinancialSummary.ts`
 * para "Facturación prevista".
 *
 * FUENTE: el calendario COMPLETO del período (`CalendarLesson[]`, reales +
 * virtuales, vía `buildLessonsInRange` — ver `calendarOccurrenceRange.ts`),
 * nunca sólo `SavedLesson[]`. Para cada ocurrencia:
 *   - si ya existe un `SavedLesson` registrado para su
 *     `calendarReservationKey`, se usa su decisión real de facturación
 *     (`isClassHeld`/`isBillable`/`eventType`) — el dato más preciso
 *     posible, incluye historia real de precio si el importe ya quedó
 *     grabado;
 *   - si NO existe todavía, se PROYECTA como programada y facturable,
 *     salvo que el propio `CalendarLesson.status` ya sea `'cancelled'`, o
 *     su fecha caiga dentro de una excepción de "Mi disponibilidad"
 *     declarada como no disponible (`unavailable_full_day`/
 *     `unavailable_block` — la mejor aproximación disponible en el modelo
 *     actual para feriados/vacaciones/licencias/ausencia declarada con
 *     anticipación; ver limitación documentada más abajo).
 *
 * LÍMITE DOCUMENTADO (deliberado, no un descuido): el modelo de datos actual
 * no permite saber CON CERTEZA, antes de que la profesora registre una
 * clase, si terminará siendo "cancelada sin aviso", "alumno ausente" o
 * "feriado no cobrable" — esas categorías sólo existen en
 * `SavedLesson.form`, nunca en un `CalendarLesson` virtual. Por eso una
 * ocurrencia futura o pasada-sin-registrar se PROYECTA como facturable por
 * defecto (con la excepción explícita de disponibilidad declarada, arriba)
 * — el valor mostrado es una ESTIMACIÓN mientras el período no cerró
 * (`isEstimate`), nunca un hecho consumado.
 *
 * Una clase cancelada tardíamente pero COBRADA
 * (`eventType: 'cancelada_tarde'` + política que cobra algo) queda
 * EXCLUIDA de este cálculo (ni horas ni ingreso) a propósito: es un cargo
 * por penalidad, no representa una hora de trabajo docente — sigue
 * apareciendo en "Facturación prevista" (que sí la cuenta, vía el cargo
 * real), pero nunca en el valor-hora.
 */
import type { CEFRLevel, StudentBillingPlan } from '../../student-profile/types/index.ts';
import type { NewClassFormState, SavedLesson } from '../../new-class/types/index.ts';
import type { CalendarLesson } from '../../calendar/types/index.ts';
import type { AvailabilityException } from '../../calendar/types/teacherAvailability.ts';
import { getLocalDateKey } from '../../calendar/utils/calendarTimezone.ts';
import { buildCalendarReservationKey } from '../../calendar/utils/calendarRecurrenceMutations.ts';
import { isClassHeld } from '../../new-class/utils/validation.ts';
import type { PackageCreditMovement, PackagesRepositoryState, PaymentCharge, PaymentsRepositoryState } from '../../payments/types/index.ts';
import { biweeklyPeriodKey, billingPeriodOfDateKey, daysBetweenDateKeys, isoWeekKey } from '../../payments/utils/paymentDates.ts';
import { resolveEffectiveBillingAmount } from '../../student-profile/utils/studentBillingPlan.ts';

export type HourlyRateLevelBucket = CEFRLevel | 'sin_nivel' | 'nivel_mixto';

export interface HourlyRateByLevel {
  level: HourlyRateLevelBucket;
  ratePerHour: number | null;
  revenue: number;
  programmedHours: number;
  lessonCount: number;
}

export interface ProgrammedHourlyRateSummary {
  rangeStart: string;
  rangeEnd: string;
  generalRatePerHour: number | null;
  totalRevenueAttributed: number;
  totalProgrammedHours: number;
  /** Cantidad de clases ÚNICAS (ocurrencias) incluidas — nunca cuenta grupos más de una vez. */
  lessonCount: number;
  byLevel: HourlyRateByLevel[];
  /** `true` mientras `rangeEnd` no cerró respecto de `evaluationDate` — hay ocurrencias proyectadas, no sólo registradas. */
  isEstimate: boolean;
  /** Cuántas de las ocurrencias incluidas todavía no tienen `SavedLesson` — informativo, nunca oculto. */
  unregisteredCount: number;
}

export interface HourlyRateStudentInfo {
  id: string;
  level: CEFRLevel;
  billingPlan: StudentBillingPlan;
}

function occurrenceDurationMinutes(lesson: CalendarLesson): number {
  return Math.max(0, Math.round((new Date(lesson.end).getTime() - new Date(lesson.start).getTime()) / 60_000));
}

const TIME_ZONE = 'America/Argentina/Buenos_Aires';

function occurrenceDateKey(lesson: CalendarLesson): string {
  return getLocalDateKey(lesson.start, TIME_ZONE);
}

const PERIODIC_PLAN_TYPES = new Set<StudentBillingPlan['type']>(['monthly', 'weekly', 'biweekly']);
const PERIODIC_CHARGE_TYPE_BY_PLAN: Partial<Record<StudentBillingPlan['type'], PaymentCharge['type']>> = {
  monthly: 'mensual',
  weekly: 'semanal',
  biweekly: 'quincenal',
};

function periodKeyForPlan(planType: StudentBillingPlan['type'], dateKey: string, quincenalAnchor: string | undefined): string | null {
  if (planType === 'monthly') return billingPeriodOfDateKey(dateKey);
  if (planType === 'weekly') return isoWeekKey(dateKey);
  if (planType === 'biweekly' && quincenalAnchor) return biweeklyPeriodKey(dateKey, quincenalAnchor);
  return null;
}

/**
 * Aproximación deliberada: un `unavailable_block` (bloqueo parcial de un
 * día) excluye el día COMPLETO, no sólo el horario del bloque — evita
 * comparar horarios cruzando huso horario con más superficie de error, a
 * costa de excluir alguna ocurrencia que en los hechos no se solapaba. Dado
 * que el resultado siempre se etiqueta "estimado" mientras el período no
 * cierra, un falso excluido pesa menos que un falso incluido.
 */
function isOnDeclaredUnavailableDate(dateKey: string, exceptions: readonly AvailabilityException[]): boolean {
  return exceptions.some((exception) => {
    if (exception.type !== 'unavailable_full_day' && exception.type !== 'unavailable_block') return false;
    const endDateKey = exception.endDate ?? exception.date;
    return dateKey >= exception.date && dateKey <= endDateKey;
  });
}

/** Decisión de inclusión para una ocurrencia YA REGISTRADA — igual criterio que la versión anterior (isClassHeld && isBillable), más la exclusión explícita de "cancelada tardía pero cobrada" (penalidad, no hora docente). */
function isRegisteredLessonIncluded(form: NewClassFormState): boolean {
  if (!form.isBillable) return false;
  if (isClassHeld(form)) return true;
  return false; // alumno_ausente, profesora_ausente, cancelada_con_aviso, cancelada_tarde (aunque cobre), reprogramada, feriado sin excepción
}

interface OccurrenceInclusion {
  lesson: CalendarLesson;
  minutes: number;
  dateKey: string;
  registered: boolean;
}

function computeInclusion(
  lessons: readonly CalendarLesson[],
  savedLessonByReservationKey: ReadonlyMap<string, SavedLesson>,
  availabilityExceptions: readonly AvailabilityException[]
): OccurrenceInclusion[] {
  const seen = new Set<string>();
  const result: OccurrenceInclusion[] = [];

  lessons.forEach((lesson) => {
    if (seen.has(lesson.id)) return;
    seen.add(lesson.id);
    if (lesson.participants.length === 0) return;

    const reservationKey = buildCalendarReservationKey(lesson);
    const savedLesson = savedLessonByReservationKey.get(reservationKey);

    if (savedLesson) {
      if (!isRegisteredLessonIncluded(savedLesson.form)) return;
      const minutes = savedLesson.form.actualDurationMinutes ?? savedLesson.form.scheduledDurationMinutes;
      result.push({ lesson, minutes, dateKey: occurrenceDateKey(lesson), registered: true });
      return;
    }

    if (lesson.status === 'cancelled') return;
    const dateKey = occurrenceDateKey(lesson);
    if (isOnDeclaredUnavailableDate(dateKey, availabilityExceptions)) return;

    result.push({ lesson, minutes: occurrenceDurationMinutes(lesson), dateKey, registered: false });
  });

  return result;
}

export function buildProgrammedHourlyRateSummary(input: {
  /** Ocurrencias del período (reales + virtuales), ya recortadas al rango — ver `buildLessonsInRange`. */
  lessons: readonly CalendarLesson[];
  /** TODOS los `SavedLesson` conocidos (no hace falta pre-filtrar por rango: se cruzan por `calendarReservationKey`). */
  savedLessons: readonly SavedLesson[];
  paymentsState: PaymentsRepositoryState;
  packagesState?: PackagesRepositoryState;
  students: readonly HourlyRateStudentInfo[];
  quincenalAnchors?: Readonly<Record<string, string>>;
  availabilityExceptions: readonly AvailabilityException[];
  rangeStart: string;
  rangeEnd: string;
  evaluationDate: string;
}): ProgrammedHourlyRateSummary {
  const {
    lessons,
    savedLessons,
    paymentsState,
    packagesState,
    students,
    quincenalAnchors = {},
    availabilityExceptions,
    rangeStart,
    rangeEnd,
    evaluationDate,
  } = input;

  const studentById = new Map(students.map((student) => [student.id, student]));
  const savedLessonByReservationKey = new Map<string, SavedLesson>();
  savedLessons.forEach((saved) => {
    if (saved.calendarReservationKey) savedLessonByReservationKey.set(saved.calendarReservationKey, saved);
  });

  const included = computeInclusion(lessons, savedLessonByReservationKey, availabilityExceptions);

  // --- Paso 1: minutos totales por (alumno, período) para planes periódicos (mensual/semanal/quincenal). ---
  const minutesByStudentPeriod = new Map<string, number>();
  included.forEach(({ lesson, minutes, dateKey }) => {
    lesson.participants.forEach((participant) => {
      const student = studentById.get(participant.studentId);
      if (!student || !PERIODIC_PLAN_TYPES.has(student.billingPlan.type)) return;
      const periodKey = periodKeyForPlan(student.billingPlan.type, dateKey, quincenalAnchors[student.id]);
      if (periodKey === null) return;
      const key = `${student.id}|${periodKey}`;
      minutesByStudentPeriod.set(key, (minutesByStudentPeriod.get(key) ?? 0) + minutes);
    });
  });

  // --- Paso 2: importe total del período para cada (alumno, período) con plan periódico — cargo real si existe, si no, estimación del plan vigente. ---
  const activeCharges = paymentsState.charges.filter((charge) => charge.voidedAt === null);
  function periodTotalForStudent(studentId: string, plan: StudentBillingPlan, periodKey: string): number {
    const chargeType = PERIODIC_CHARGE_TYPE_BY_PLAN[plan.type];
    const realCharge = chargeType
      ? activeCharges.find((charge) => charge.studentId === studentId && charge.type === chargeType && charge.billingPeriod === periodKey)
      : undefined;
    if (realCharge) return realCharge.originalAmount;
    return resolveEffectiveBillingAmount(plan, periodKey);
  }

  // --- Paso 3: paquetes — mismo vínculo real clase↔consumo que la versión anterior, sólo para ocurrencias YA REGISTRADAS. ---
  const activePackageChargeByPackageId = new Map<string, PaymentCharge>();
  activeCharges.forEach((charge) => {
    if (charge.type === 'paquete' && charge.packageId) activePackageChargeByPackageId.set(charge.packageId, charge);
  });
  const consumoMovementsByLessonId = new Map<string, PackageCreditMovement[]>();
  (packagesState?.creditMovements ?? [])
    .filter((movement) => movement.type === 'consumo' && movement.voidedAt === null && movement.savedLessonId)
    .forEach((movement) => {
      const lessonId = movement.savedLessonId as string;
      const list = consumoMovementsByLessonId.get(lessonId) ?? [];
      list.push(movement);
      consumoMovementsByLessonId.set(lessonId, list);
    });
  const minutesByPackageId = new Map<string, number>();
  savedLessons
    .filter((saved) => isRegisteredLessonIncluded(saved.form))
    .forEach((saved) => {
      const movements = consumoMovementsByLessonId.get(saved.id);
      if (!movements) return;
      const minutes = saved.form.actualDurationMinutes ?? saved.form.scheduledDurationMinutes;
      movements.forEach((movement) => {
        if (!activePackageChargeByPackageId.has(movement.packageId)) return;
        minutesByPackageId.set(movement.packageId, (minutesByPackageId.get(movement.packageId) ?? 0) + minutes);
      });
    });
  function findPackageChargeForSavedLesson(savedLessonId: string, studentId: string): PaymentCharge | undefined {
    const movements = consumoMovementsByLessonId.get(savedLessonId);
    const movement = movements?.find((entry) => entry.studentId === studentId);
    if (!movement) return undefined;
    return activePackageChargeByPackageId.get(movement.packageId);
  }

  // --- Paso 4: atribución de ingreso por (ocurrencia, alumno). ---
  interface AttributedEntry {
    amount: number;
    minutes: number;
    level: CEFRLevel | 'sin_nivel';
  }
  const attributedByLesson = new Map<string, AttributedEntry[]>();

  included.forEach(({ lesson, minutes, dateKey, registered }) => {
    const entries: AttributedEntry[] = [];
    const savedLesson = registered ? savedLessonByReservationKey.get(buildCalendarReservationKey(lesson)) : undefined;
    const participantCount = lesson.participants.length;

    lesson.participants.forEach((participant) => {
      const student = studentById.get(participant.studentId);
      const level: CEFRLevel | 'sin_nivel' = student?.level ?? 'sin_nivel';
      let amount = 0;

      if (student && PERIODIC_PLAN_TYPES.has(student.billingPlan.type)) {
        const periodKey = periodKeyForPlan(student.billingPlan.type, dateKey, quincenalAnchors[student.id]);
        if (periodKey !== null) {
          const totalMinutes = minutesByStudentPeriod.get(`${student.id}|${periodKey}`) ?? 0;
          const periodTotal = periodTotalForStudent(student.id, student.billingPlan, periodKey);
          amount = totalMinutes > 0 ? periodTotal * (minutes / totalMinutes) : 0;
        }
      } else if (registered && savedLesson) {
        const perStudentAmount = savedLesson.billedAmountByStudent?.[participant.studentId];
        if (perStudentAmount !== undefined) {
          amount = perStudentAmount;
        } else if (student?.billingPlan.type === 'class_package') {
          const packageCharge = findPackageChargeForSavedLesson(savedLesson.id, participant.studentId);
          if (packageCharge?.packageId) {
            const totalMinutesInPackage = minutesByPackageId.get(packageCharge.packageId) ?? 0;
            amount = totalMinutesInPackage > 0 ? packageCharge.originalAmount * (minutes / totalMinutesInPackage) : 0;
          }
        } else if (participantCount === 1) {
          amount = savedLesson.billedAmount ?? 0;
        } else {
          // Último recurso — igual que la versión anterior: dato histórico
          // sin desglose por alumno, reparto proporcional simple documentado
          // como aproximación (nunca un monto inventado).
          amount = (savedLesson.billedAmount ?? 0) / participantCount;
        }
      } else if (student) {
        // Ocurrencia proyectada (sin registrar): usa el plan vigente del alumno.
        if (student.billingPlan.type === 'per_class') {
          amount = resolveEffectiveBillingAmount(student.billingPlan, billingPeriodOfDateKey(dateKey));
        } else if (student.billingPlan.type === 'class_package') {
          const plan = student.billingPlan;
          amount = plan.includedClasses > 0 ? plan.amount / plan.includedClasses : 0;
        } else if (student.billingPlan.type === 'complimentary') {
          amount = 0;
        }
      }

      entries.push({ amount, minutes, level });
    });

    attributedByLesson.set(lesson.id, entries);
  });

  // --- Paso 5: nivel canónico por ocurrencia (mismo nivel en todos los participantes -> ese nivel; si no, "nivel_mixto"). ---
  function lessonLevelBucket(lesson: CalendarLesson): HourlyRateLevelBucket {
    const levels = new Set(lesson.participants.map((participant) => studentById.get(participant.studentId)?.level ?? 'sin_nivel'));
    if (levels.size === 1) return levels.values().next().value as HourlyRateLevelBucket;
    return 'nivel_mixto';
  }

  // --- Totales. ---
  let totalRevenueAttributed = 0;
  let totalProgrammedMinutes = 0;
  let unregisteredCount = 0;
  const byLevelMap = new Map<HourlyRateLevelBucket, { revenue: number; minutes: number; lessonCount: number }>();

  included.forEach(({ lesson, minutes, registered }) => {
    const entries = attributedByLesson.get(lesson.id) ?? [];
    const lessonRevenue = entries.reduce((sum, entry) => sum + entry.amount, 0);
    totalRevenueAttributed += lessonRevenue;
    totalProgrammedMinutes += minutes; // una vez por ocurrencia, nunca por participante.
    if (!registered) unregisteredCount += 1;

    const level = lessonLevelBucket(lesson);
    const current = byLevelMap.get(level) ?? { revenue: 0, minutes: 0, lessonCount: 0 };
    byLevelMap.set(level, {
      revenue: current.revenue + lessonRevenue,
      minutes: current.minutes + minutes,
      lessonCount: current.lessonCount + 1,
    });
  });

  const totalProgrammedHours = totalProgrammedMinutes / 60;
  const generalRatePerHour = totalProgrammedHours > 0 ? totalRevenueAttributed / totalProgrammedHours : null;

  const byLevel: HourlyRateByLevel[] = Array.from(byLevelMap.entries())
    .map(([level, data]) => ({
      level,
      revenue: data.revenue,
      programmedHours: data.minutes / 60,
      lessonCount: data.lessonCount,
      ratePerHour: data.minutes > 0 ? data.revenue / (data.minutes / 60) : null,
    }))
    .sort((a, b) => (a.level < b.level ? -1 : a.level > b.level ? 1 : 0));

  return {
    rangeStart,
    rangeEnd,
    generalRatePerHour,
    totalRevenueAttributed,
    totalProgrammedHours,
    lessonCount: included.length,
    byLevel,
    isEstimate: daysBetweenDateKeys(evaluationDate, rangeEnd) >= 0,
    unregisteredCount,
  };
}
