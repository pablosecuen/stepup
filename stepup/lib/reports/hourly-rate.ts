import { instantDateKey } from "../calendar/civil-calendar.ts";
import { addDaysToDateKey, billingPeriodOfDateKey, daysBetweenDateKeys } from "../payments/dates.ts";
import { resolveEffectiveMonthlyAmount, type StudentBillingPlan } from "../payments/billing-plan.ts";
import type { AvailabilityException } from "../calendar/availability.ts";
import { isClassHeld, lessonMinutes, type RegisteredLessonFacts } from "./registered-lessons.ts";

/**
 * Puerto exacto de `buildProgrammedHourlyRateSummary` (móvil, `programmedHourlyRateSummary.ts`) — «Valor programado de tu hora». Es un número TOTALMENTE independiente de si el alumno ya pagó: nunca
 * lee pagos ni asignaciones; de los cargos sólo usa su importe contractual (`originalAmount`), el mismo criterio de «Facturación prevista».
 *
 * FUENTE: la agenda COMPLETA del período (clases reales + ocurrencias virtuales). Para cada ocurrencia:
 *   - si ya tiene un registro, se usa su decisión real (resultado «dictada» y facturable) y su duración real o programada;
 *   - si no, se PROYECTA como programada y facturable, salvo que esté cancelada o caiga en un día declarado no disponible.
 * Una clase cancelada tarde pero cobrada queda EXCLUIDA (es un cargo por penalidad, no una hora de trabajo).
 *
 * INGRESO atribuido por (ocurrencia, alumno): planes mensual/semanal/quincenal reparten el total del período del alumno (cargo real si existe; si no, el plan vigente) en proporción a los minutos de
 * cada clase; paquetes, el importe del paquete en proporción a los minutos consumidos; por clase y sin registrar, el valor del plan; registradas, el importe facturado de esa clase.
 *
 * Mientras el período no cerró, el valor es una ESTIMACIÓN (`isEstimate`). Pura.
 */
export type HourlyRateLevelBucket = string;

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
  /** `true` mientras `rangeEnd` no cerró respecto de `evaluationDate`. */
  isEstimate: boolean;
  /** Cuántas de las ocurrencias incluidas todavía no tienen registro — informativo, nunca oculto. */
  unregisteredCount: number;
}

export interface HourlyRateOccurrence {
  id: string;
  start: string;
  end: string;
  status: string;
  participantIds: readonly string[];
  /** Registro de ESA ocurrencia, si existe. */
  registration: RegisteredLessonFacts | null;
}

export interface HourlyRateStudent {
  id: string;
  /** Nivel actual del alumno tal como lo muestra la app (niveles unidos por coma). */
  level: string;
  billingPlan: StudentBillingPlan;
  /** Fecha de ancla de un plan quincenal. */
  biweeklyAnchor?: string;
}

export interface HourlyRateCharge {
  studentId: string;
  chargeType: string;
  billingPeriod: string | null;
  packageId: string | null;
  originalAmount: number;
  voidedAt: string | null;
}

export interface HourlyRatePackageConsumption {
  packageId: string;
  studentId: string;
  registrationId: string;
}

const PERIODIC_PLAN_TYPES = new Set<StudentBillingPlan["type"]>(["monthly", "weekly", "biweekly"]);
const PERIODIC_CHARGE_TYPE_BY_PLAN: Partial<Record<StudentBillingPlan["type"], string>> = { monthly: "mensual", weekly: "semanal", biweekly: "quincenal" };

/** Semana ISO `YYYY-Www` de una fecha. */
function isoWeekKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

/** Inicio del período quincenal que contiene `dateKey`, contando de a 14 días desde el ancla. */
function biweeklyPeriodKey(dateKey: string, anchorDate: string): string {
  const periodIndex = Math.floor(daysBetweenDateKeys(anchorDate, dateKey) / 14);
  return addDaysToDateKey(anchorDate, periodIndex * 14);
}

function periodKeyForPlan(planType: StudentBillingPlan["type"], dateKey: string, biweeklyAnchor: string | undefined): string | null {
  if (planType === "monthly") return billingPeriodOfDateKey(dateKey);
  if (planType === "weekly") return isoWeekKey(dateKey);
  if (planType === "biweekly" && biweeklyAnchor) return biweeklyPeriodKey(dateKey, biweeklyAnchor);
  return null;
}

function resolveEffectiveBillingAmount(plan: StudentBillingPlan, billingPeriod: string): number {
  if (plan.type === "complimentary") return 0;
  if (plan.type === "monthly") return resolveEffectiveMonthlyAmount(plan, billingPeriod);
  return plan.amount;
}

/** Un bloqueo parcial de un día excluye el día COMPLETO (aproximación deliberada de la app: un falso excluido pesa menos que un falso incluido en un valor «estimado»). */
function isOnDeclaredUnavailableDate(dateKey: string, exceptions: readonly AvailabilityException[]): boolean {
  return exceptions.some((exception) => {
    if (exception.type !== "unavailable_full_day" && exception.type !== "unavailable_block") return false;
    const endDateKey = exception.endDate ?? exception.date;
    return dateKey >= exception.date && dateKey <= endDateKey;
  });
}

/** Una ocurrencia YA registrada cuenta si es facturable y se dictó; «cancelada tarde cobrada», ausencias, reprogramadas y feriados sin excepción quedan afuera. */
function isRegisteredLessonIncluded(registration: RegisteredLessonFacts): boolean {
  return registration.isBillable && isClassHeld(registration);
}

interface OccurrenceInclusion {
  occurrence: HourlyRateOccurrence;
  minutes: number;
  dateKey: string;
  registration: RegisteredLessonFacts | null;
}

function computeInclusion(occurrences: readonly HourlyRateOccurrence[], availabilityExceptions: readonly AvailabilityException[]): OccurrenceInclusion[] {
  const seen = new Set<string>();
  const result: OccurrenceInclusion[] = [];
  occurrences.forEach((occurrence) => {
    if (seen.has(occurrence.id)) return;
    seen.add(occurrence.id);
    if (occurrence.participantIds.length === 0) return;

    const dateKey = instantDateKey(occurrence.start);
    if (occurrence.registration) {
      if (!isRegisteredLessonIncluded(occurrence.registration)) return;
      result.push({ occurrence, minutes: lessonMinutes(occurrence.registration), dateKey, registration: occurrence.registration });
      return;
    }
    if (occurrence.status === "cancelled") return;
    if (isOnDeclaredUnavailableDate(dateKey, availabilityExceptions)) return;
    const minutes = Math.max(0, Math.round((new Date(occurrence.end).getTime() - new Date(occurrence.start).getTime()) / 60_000));
    result.push({ occurrence, minutes, dateKey, registration: null });
  });
  return result;
}

export function buildProgrammedHourlyRateSummary(input: {
  /** Ocurrencias del período (reales + virtuales), ya recortadas al rango. */
  occurrences: readonly HourlyRateOccurrence[];
  /** TODOS los registros conocidos (para repartir el importe de un paquete entre las clases que lo consumieron). */
  registeredLessons: readonly RegisteredLessonFacts[];
  charges: readonly HourlyRateCharge[];
  packageConsumptions?: readonly HourlyRatePackageConsumption[];
  students: readonly HourlyRateStudent[];
  availabilityExceptions: readonly AvailabilityException[];
  rangeStart: string;
  rangeEnd: string;
  evaluationDate: string;
}): ProgrammedHourlyRateSummary {
  const { occurrences, registeredLessons, charges, packageConsumptions = [], students, availabilityExceptions, rangeStart, rangeEnd, evaluationDate } = input;
  const studentById = new Map(students.map((student) => [student.id, student]));
  const included = computeInclusion(occurrences, availabilityExceptions);

  // Paso 1: minutos totales por (alumno, período) para planes periódicos.
  const minutesByStudentPeriod = new Map<string, number>();
  included.forEach(({ occurrence, minutes, dateKey }) => {
    occurrence.participantIds.forEach((studentId) => {
      const student = studentById.get(studentId);
      if (!student || !PERIODIC_PLAN_TYPES.has(student.billingPlan.type)) return;
      const periodKey = periodKeyForPlan(student.billingPlan.type, dateKey, student.biweeklyAnchor);
      if (periodKey === null) return;
      const key = `${student.id}|${periodKey}`;
      minutesByStudentPeriod.set(key, (minutesByStudentPeriod.get(key) ?? 0) + minutes);
    });
  });

  // Paso 2: importe total del período para cada (alumno, período) — cargo real si existe, si no, el plan vigente.
  const activeCharges = charges.filter((charge) => charge.voidedAt === null);
  function periodTotalForStudent(studentId: string, plan: StudentBillingPlan, periodKey: string): number {
    const chargeType = PERIODIC_CHARGE_TYPE_BY_PLAN[plan.type];
    const realCharge = chargeType ? activeCharges.find((charge) => charge.studentId === studentId && charge.chargeType === chargeType && charge.billingPeriod === periodKey) : undefined;
    if (realCharge) return realCharge.originalAmount;
    return resolveEffectiveBillingAmount(plan, periodKey);
  }

  // Paso 3: paquetes — vínculo real clase↔consumo, sólo para ocurrencias YA registradas.
  const packageChargeByPackageId = new Map<string, HourlyRateCharge>();
  activeCharges.forEach((charge) => {
    if (charge.chargeType === "paquete" && charge.packageId) packageChargeByPackageId.set(charge.packageId, charge);
  });
  const consumptionsByRegistrationId = new Map<string, HourlyRatePackageConsumption[]>();
  packageConsumptions.forEach((consumption) => {
    const list = consumptionsByRegistrationId.get(consumption.registrationId) ?? [];
    list.push(consumption);
    consumptionsByRegistrationId.set(consumption.registrationId, list);
  });
  const minutesByPackageId = new Map<string, number>();
  registeredLessons
    .filter((registration) => isRegisteredLessonIncluded(registration))
    .forEach((registration) => {
      const consumptions = consumptionsByRegistrationId.get(registration.id);
      if (!consumptions) return;
      const minutes = lessonMinutes(registration);
      consumptions.forEach((consumption) => {
        if (!packageChargeByPackageId.has(consumption.packageId)) return;
        minutesByPackageId.set(consumption.packageId, (minutesByPackageId.get(consumption.packageId) ?? 0) + minutes);
      });
    });

  // Paso 4: atribución de ingreso por (ocurrencia, alumno).
  const revenueByOccurrence = new Map<string, number>();
  included.forEach(({ occurrence, minutes, dateKey, registration }) => {
    const participantCount = occurrence.participantIds.length;
    let lessonRevenue = 0;
    occurrence.participantIds.forEach((studentId) => {
      const student = studentById.get(studentId);
      let amount = 0;
      if (student && PERIODIC_PLAN_TYPES.has(student.billingPlan.type)) {
        const periodKey = periodKeyForPlan(student.billingPlan.type, dateKey, student.biweeklyAnchor);
        if (periodKey !== null) {
          const totalMinutes = minutesByStudentPeriod.get(`${student.id}|${periodKey}`) ?? 0;
          const periodTotal = periodTotalForStudent(student.id, student.billingPlan, periodKey);
          amount = totalMinutes > 0 ? periodTotal * (minutes / totalMinutes) : 0;
        }
      } else if (registration) {
        const perStudentAmount = registration.billedAmountByStudent?.[studentId];
        if (perStudentAmount !== undefined) {
          amount = perStudentAmount;
        } else if (student?.billingPlan.type === "class_package") {
          const packageId = consumptionsByRegistrationId.get(registration.id)?.find((consumption) => consumption.studentId === studentId)?.packageId;
          const packageCharge = packageId ? packageChargeByPackageId.get(packageId) : undefined;
          if (packageCharge && packageId) {
            const totalMinutesInPackage = minutesByPackageId.get(packageId) ?? 0;
            amount = totalMinutesInPackage > 0 ? packageCharge.originalAmount * (minutes / totalMinutesInPackage) : 0;
          }
        } else if (participantCount === 1) {
          amount = registration.billedAmount ?? 0;
        } else {
          // Último recurso, igual que la app: dato histórico sin desglose por alumno, reparto proporcional simple (nunca un monto inventado).
          amount = (registration.billedAmount ?? 0) / participantCount;
        }
      } else if (student) {
        // Ocurrencia proyectada (sin registrar): usa el plan vigente del alumno.
        if (student.billingPlan.type === "per_class") amount = resolveEffectiveBillingAmount(student.billingPlan, billingPeriodOfDateKey(dateKey));
        else if (student.billingPlan.type === "class_package") amount = student.billingPlan.includedClasses > 0 ? student.billingPlan.amount / student.billingPlan.includedClasses : 0;
      }
      lessonRevenue += amount;
    });
    revenueByOccurrence.set(occurrence.id, lessonRevenue);
  });

  // Nivel canónico por ocurrencia: mismo nivel en todos los participantes -> ese; si no, «nivel mixto».
  function lessonLevelBucket(participantIds: readonly string[]): HourlyRateLevelBucket {
    const levels = new Set(participantIds.map((studentId) => studentById.get(studentId)?.level ?? "sin_nivel"));
    if (levels.size === 1) return levels.values().next().value as HourlyRateLevelBucket;
    return "nivel_mixto";
  }

  let totalRevenueAttributed = 0;
  let totalProgrammedMinutes = 0;
  let unregisteredCount = 0;
  const byLevelMap = new Map<HourlyRateLevelBucket, { revenue: number; minutes: number; lessonCount: number }>();
  included.forEach(({ occurrence, minutes, registration }) => {
    const lessonRevenue = revenueByOccurrence.get(occurrence.id) ?? 0;
    totalRevenueAttributed += lessonRevenue;
    totalProgrammedMinutes += minutes; // una vez por ocurrencia, nunca por participante.
    if (!registration) unregisteredCount += 1;
    const level = lessonLevelBucket(occurrence.participantIds);
    const current = byLevelMap.get(level) ?? { revenue: 0, minutes: 0, lessonCount: 0 };
    byLevelMap.set(level, { revenue: current.revenue + lessonRevenue, minutes: current.minutes + minutes, lessonCount: current.lessonCount + 1 });
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
