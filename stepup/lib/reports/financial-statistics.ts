import { buildAnnualActivitySummary, buildModalitySummary, type AnnualActivitySummary, type ModalitySummary } from "./annual-activity.ts";
import { buildCalendarDemandSummary, demandRangeFor, type CalendarDemandSummary } from "./demand.ts";
import { buildProgrammedHourlyRateSummary, type HourlyRateCharge, type HourlyRatePackageConsumption, type ProgrammedHourlyRateSummary } from "./hourly-rate.ts";
import { toRegisteredLessonFacts, webOccurrenceKeyFromReservationKey, type RegisteredLessonFacts, type RegistrationRowForFacts } from "./registered-lessons.ts";
import { buildNewStudentsPerMonthSummary, buildStudentYearActivitySummary, type NewStudentsPerMonthSummary, type StudentYearActivitySummary } from "./student-year-summary.ts";
import type { DateRange } from "./period.ts";
import type { AvailabilityException } from "../calendar/availability.ts";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "../payments/billing-plan.ts";

/**
 * Estadísticas del Resumen financiero (valor de la hora, demanda, resumen anual, modalidad, alumnos del año) armadas con las MISMAS reglas que la app anterior sobre filas crudas de la base. PURO: el
 * cargador sólo trae las filas; todo el criterio vive acá y en `registered-lessons`/`hourly-rate`/`demand`/`annual-activity`/`student-year-summary`.
 */
export interface CalendarItemForStatistics {
  id: string;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  materializedLessonId: string | null;
  start: string;
  end: string;
  status: string;
  participantIds: readonly string[];
}

export interface RegistrationRowWithExtras extends RegistrationRowForFacts {
  source_extras: { calendarReservationKey?: unknown } | null;
}

export interface StudentForStatistics {
  id: string;
  levels: readonly string[];
  status: string;
  billingType: "por_clase" | "mensual";
  billingPlan: Record<string, unknown> | null;
  price: number;
  dateJoined: string;
}

export interface FinancialStatisticsInput {
  evaluationDate: string;
  evaluationInstant: string;
  /** Rango del período elegido (para el valor de la hora). */
  range: DateRange;
  year: number;
  /** Agenda real del rango del período (materializada + virtual). */
  periodItems: readonly CalendarItemForStatistics[];
  /** Agenda real de los últimos 90 días (materializada + virtual). */
  demandItems: readonly CalendarItemForStatistics[];
  registrations: readonly RegistrationRowWithExtras[];
  roster: readonly { lesson_registration_id: string; student_id: string }[];
  evaluationAmounts: readonly { lesson_registration_id: string; student_id: string; billed_amount: number | string | null }[];
  rules: readonly { id: string; legacy_mobile_id: string | null }[];
  students: readonly StudentForStatistics[];
  charges: readonly (HourlyRateCharge & { id: string })[];
  packageConsumptions: readonly HourlyRatePackageConsumption[];
  availabilityExceptions: readonly AvailabilityException[];
}

export interface FinancialStatistics {
  hourlyRate: ProgrammedHourlyRateSummary;
  demand: CalendarDemandSummary;
  /** Rango elegido por la profesora (mismo período del Resumen). */
  periodActivity: AnnualActivitySummary;
  annualActivity: AnnualActivitySummary;
  modality: ModalitySummary;
  studentYear: StudentYearActivitySummary;
  newStudentsPerMonth: NewStudentsPerMonthSummary;
}

export function buildRegisteredLessonFacts(input: Pick<FinancialStatisticsInput, "registrations" | "roster" | "evaluationAmounts" | "rules">): RegisteredLessonFacts[] {
  const ruleIdByLegacyId = new Map(input.rules.filter((rule) => rule.legacy_mobile_id).map((rule) => [rule.legacy_mobile_id as string, rule.id]));
  const studentsByRegistration = new Map<string, string[]>();
  input.roster.forEach((entry) => {
    const list = studentsByRegistration.get(entry.lesson_registration_id) ?? [];
    list.push(entry.student_id);
    studentsByRegistration.set(entry.lesson_registration_id, list);
  });
  const amountsByRegistration = new Map<string, Record<string, number>>();
  input.evaluationAmounts.forEach((entry) => {
    if (entry.billed_amount === null || entry.billed_amount === undefined) return;
    const amount = Number(entry.billed_amount);
    if (!Number.isFinite(amount)) return;
    const record = amountsByRegistration.get(entry.lesson_registration_id) ?? {};
    record[entry.student_id] = amount;
    amountsByRegistration.set(entry.lesson_registration_id, record);
  });
  return input.registrations.map((row) =>
    toRegisteredLessonFacts(row, {
      studentIds: studentsByRegistration.get(row.id) ?? [],
      billedAmountByStudent: amountsByRegistration.get(row.id) ?? null,
      occurrenceKey: webOccurrenceKeyFromReservationKey(typeof row.source_extras?.calendarReservationKey === "string" ? row.source_extras.calendarReservationKey : null, ruleIdByLegacyId),
    })
  );
}

export function buildFinancialStatistics(input: FinancialStatisticsInput): FinancialStatistics {
  const facts = buildRegisteredLessonFacts(input);
  const factsByCalendarLessonId = new Map<string, RegisteredLessonFacts>();
  const factsByOccurrenceKey = new Map<string, RegisteredLessonFacts>();
  facts.forEach((fact) => {
    if (fact.calendarLessonId) factsByCalendarLessonId.set(fact.calendarLessonId, fact);
    if (fact.occurrenceKey) factsByOccurrenceKey.set(fact.occurrenceKey, fact);
  });
  const registrationOf = (item: CalendarItemForStatistics): RegisteredLessonFacts | null => {
    if (item.materializedLessonId) {
      const linked = factsByCalendarLessonId.get(item.materializedLessonId);
      if (linked) return linked;
    }
    if (item.recurrenceId && item.occurrenceKey) return factsByOccurrenceKey.get(`${item.recurrenceId}|${item.occurrenceKey}`) ?? null;
    return null;
  };

  const students = input.students.map((student) => {
    const billingPlan = student.billingPlan as StudentBillingPlan | null;
    return {
      id: student.id,
      level: student.levels.join(", "),
      billingPlan: resolveStudentBillingPlan({ billingPlan, billingType: student.billingType, price: student.price }),
      biweeklyAnchor: billingPlan?.type === "biweekly" ? billingPlan.anchorDate : undefined,
    };
  });

  const hourlyRate = buildProgrammedHourlyRateSummary({
    occurrences: input.periodItems.map((item) => ({ id: item.id, start: item.start, end: item.end, status: item.status, participantIds: item.participantIds, registration: registrationOf(item) })),
    registeredLessons: facts,
    charges: input.charges,
    packageConsumptions: input.packageConsumptions,
    students,
    availabilityExceptions: input.availabilityExceptions,
    rangeStart: input.range.rangeStart,
    rangeEnd: input.range.rangeEnd,
    evaluationDate: input.evaluationDate,
  });

  const demandRange = demandRangeFor(input.evaluationDate);
  const demand = buildCalendarDemandSummary({
    occurrences: input.demandItems.map((item) => ({ start: item.start, end: item.end, status: item.status, participantCount: item.participantIds.length })),
    rangeStart: demandRange.rangeStart,
    rangeEnd: demandRange.rangeEnd,
    evaluationInstant: input.evaluationInstant,
  });

  const yearRange = { rangeStart: `${input.year}-01-01`, rangeEnd: `${input.year}-12-31` };
  const studentsForYear = input.students.map((student) => ({ id: student.id, status: student.status, dateJoined: student.dateJoined ? String(student.dateJoined).slice(0, 10) : "" }));

  return {
    hourlyRate,
    demand,
    periodActivity: buildAnnualActivitySummary(facts, input.range),
    annualActivity: buildAnnualActivitySummary(facts, yearRange),
    modality: buildModalitySummary(facts, yearRange),
    studentYear: buildStudentYearActivitySummary({ year: input.year, students: studentsForYear, lessons: facts }),
    newStudentsPerMonth: buildNewStudentsPerMonthSummary({ year: input.year, students: studentsForYear }),
  };
}
