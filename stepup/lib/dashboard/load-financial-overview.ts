import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listAllCharges, listAllAllocations, listAllPayments } from "@/lib/repositories/payments";
import { listLessonRegistrationsInRange, listRosterForRegistrationIds } from "@/lib/repositories/lesson-registrations";
import { composeCalendarView, loadCalendarViewBase } from "@/lib/calendar/view";
import { listCalendarLessonsInRange } from "@/lib/repositories/calendar-lessons";
import { localDateKeyInTimeZone, ARGENTINA_TIME_ZONE, toDateKey } from "@/lib/payments/dates";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { resolveFinancialPeriodRange, comparePeriodValues, previousComparableRange, type FinancialPeriodPreset, type DateRange } from "@/lib/reports/period";
import { buildPeriodFinancialSummary, type PeriodFinancialSummary } from "@/lib/reports/financial-summary";
import { buildAnnualActivitySummary, buildModalitySummary, type AnnualActivitySummary, type ModalitySummary } from "@/lib/reports/annual-activity";
import { buildCalendarDemandSummary, DEMAND_LOOKBACK_DAYS, type CalendarDemandSummary } from "@/lib/reports/demand";
import { buildProgrammedHourlyRateSummary, type ProgrammedHourlyRateSummary } from "@/lib/reports/hourly-rate";
import { buildStudentYearActivitySummary, buildNewStudentsPerMonthSummary, type StudentYearActivitySummary, type NewStudentsPerMonthSummary } from "@/lib/reports/student-year-summary";

export interface FinancialOverviewData {
  preset: FinancialPeriodPreset;
  range: DateRange;
  summary: PeriodFinancialSummary;
  comparison: { generated: ReturnType<typeof comparePeriodValues>; collected: ReturnType<typeof comparePeriodValues> } | null;
  activity: AnnualActivitySummary;
  modality: ModalitySummary;
  demand: CalendarDemandSummary;
  hourlyRate: ProgrammedHourlyRateSummary;
  studentYear: StudentYearActivitySummary;
  newStudentsPerMonth: NewStudentsPerMonthSummary;
}

/**
 * Orquestador único de "Resumen financiero" (Fase 7) — combina los
 * repositorios ya existentes (Fases 1-6) con los motores puros de
 * `lib/reports/`. Ninguna tarjeta expone nombres de alumnos ni montos
 * individuales — sólo agregados (mismo criterio real del móvil,
 * `FinancialAnalyticsSections.tsx`).
 */
export async function loadFinancialOverviewData(ctx: AuthenticatedDbContext, preset: FinancialPeriodPreset): Promise<FinancialOverviewData> {
  const now = new Date();
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const range = resolveFinancialPeriodRange(preset, evaluationDate);

  const rangeStartIso = localDateTimeToInstantIso({ date: range.rangeStart, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE });
  const rangeEndIso = localDateTimeToInstantIso({ date: range.rangeEnd, hour: 23, minute: 59, timeZone: ARGENTINA_TIME_ZONE });
  // Demanda: SIEMPRE últimos 90 días fijos, no configurable (mismo criterio real del móvil) — independiente del preset elegido.
  const demandStart = new Date(now.getTime() - DEMAND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const currentYear = Number(evaluationDate.slice(0, 4));
  // `studentYear`/`newStudentsPerMonth` necesitan el AÑO completo, no sólo el rango del preset — si el preset elegido ya es
  // exactamente el año actual, reutiliza lo ya consultado; si no, hace su propia consulta anual real (nunca infiere el año a
  // partir de un rango más angosto).
  const yearStartIso = localDateTimeToInstantIso({ date: `${currentYear}-01-01`, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE });
  const yearEndIso = localDateTimeToInstantIso({ date: `${currentYear}-12-31`, hour: 23, minute: 59, timeZone: ARGENTINA_TIME_ZONE });
  const rangeIsCurrentYear = range.rangeStart === `${currentYear}-01-01` && range.rangeEnd === `${currentYear}-12-31`;

  // Todas las lecturas que NO dependen unas de otras salen juntas (antes eran seis esperas seguidas, cada una con su ida y vuelta
  // a la base): el resultado es exactamente el mismo.
  // Series, excepciones y alumnos se leen UNA vez para las dos vistas del calendario (demanda y valor de la hora).
  const [{ students, rules, exceptions }, charges, allocations, payments, registrationsInRange, demandLessons, hourlyLessons, ownYearRegistrations] = await Promise.all([
    loadCalendarViewBase(ctx),
    listAllCharges(ctx),
    listAllAllocations(ctx),
    listAllPayments(ctx),
    listLessonRegistrationsInRange(ctx, rangeStartIso, rangeEndIso),
    listCalendarLessonsInRange(ctx, demandStart.toISOString(), now.toISOString()),
    // Valor programado de la hora: TODA la agenda real del rango del preset (materializada + virtual).
    listCalendarLessonsInRange(ctx, new Date(rangeStartIso).toISOString(), new Date(rangeEndIso).toISOString()),
    rangeIsCurrentYear ? Promise.resolve(null) : listLessonRegistrationsInRange(ctx, yearStartIso, yearEndIso),
  ]);

  const calendarBase = { rules, students, exceptions };
  const demandItems = composeCalendarView(calendarBase, demandLessons, demandStart, now);
  const hourlyRangeItems = composeCalendarView(calendarBase, hourlyLessons, new Date(rangeStartIso), new Date(rangeEndIso));

  const summary = buildPeriodFinancialSummary({
    charges,
    allocations: allocations.map((a) => ({ chargeId: a.chargeId, paymentId: a.paymentId, amount: a.amount })),
    payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, voidedAt: p.voidedAt })),
    range,
    evaluationDate,
  });

  // La comparación con el período anterior SÓLO aplica al mes actual —
  // mismo criterio real del móvil (nunca para los otros 4 presets).
  let comparison: FinancialOverviewData["comparison"] = null;
  if (preset === "current_month") {
    const previousRange = previousComparableRange(range);
    const previousSummary = buildPeriodFinancialSummary({
      charges,
      allocations: allocations.map((a) => ({ chargeId: a.chargeId, paymentId: a.paymentId, amount: a.amount })),
      payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, voidedAt: p.voidedAt })),
      range: previousRange,
      evaluationDate,
    });
    comparison = {
      generated: comparePeriodValues(summary.generated, previousSummary.generated),
      collected: comparePeriodValues(summary.collected, previousSummary.collected),
    };
  }

  const activityInput = registrationsInRange.map((r) => ({
    countsAsClass: r.countsAsClass,
    scheduledStartAt: r.scheduledStartAt,
    scheduledEndAt: r.scheduledEndAt,
    actualStartedAt: r.actualStartedAt,
    actualEndedAt: r.actualEndedAt,
    outcome: r.outcome,
    modality: r.modality,
    calendarLessonId: r.calendarLessonId,
    id: r.id,
  }));
  const activity = buildAnnualActivitySummary(activityInput, range);
  const modality = buildModalitySummary(activityInput, range);

  const demand = buildCalendarDemandSummary(
    demandItems.filter((item) => item.status !== "cancelled").map((item) => ({ startAt: item.start, timeZone: ARGENTINA_TIME_ZONE }))
  );

  // Cruza la agenda del rango con los registros ya completados para saber qué ocurrencias ya tienen ingreso real atribuido.
  const registrationByCalendarLessonId = new Map(registrationsInRange.filter((r) => r.calendarLessonId).map((r) => [r.calendarLessonId as string, r]));
  const hourlyRate = buildProgrammedHourlyRateSummary(
    hourlyRangeItems
      .filter((item) => item.status !== "cancelled")
      .map((item) => {
        const registration = item.isMaterialized ? registrationByCalendarLessonId.get(item.id) : undefined;
        const isRegisteredHeld = !!registration && registration.status === "completed" && registration.countsAsClass;
        return {
          scheduledStartAt: item.start,
          scheduledEndAt: item.end,
          isCancelled: false,
          isRegisteredHeld,
          billedAmount: isRegisteredHeld ? registration!.billedAmount : null,
        };
      }),
    range,
    evaluationDate
  );

  const studentsForYear = students.map((s) => ({ id: s.id, status: s.status, dateJoined: s.dateJoined }));

  const yearRegistrationsFull = rangeIsCurrentYear || !ownYearRegistrations ? registrationsInRange : ownYearRegistrations;

  const heldRegistrationIds = yearRegistrationsFull.filter((r) => r.countsAsClass).map((r) => r.id);
  const roster = await listRosterForRegistrationIds(ctx, heldRegistrationIds);
  const registrationById = new Map(yearRegistrationsFull.map((r) => [r.id, r]));
  const yearRosterEntries = roster
    .map((entry) => {
      const registration = registrationById.get(entry.registrationId);
      if (!registration) return null;
      return { studentId: entry.studentId, countsAsClass: registration.countsAsClass, dateKey: toDateKey(registration.scheduledStartAt ?? registration.createdAt) };
    })
    .filter((entry): entry is { studentId: string; countsAsClass: boolean; dateKey: string } => entry !== null);

  const studentYear = buildStudentYearActivitySummary({ year: currentYear, students: studentsForYear, registrations: yearRosterEntries });
  const newStudentsPerMonth = buildNewStudentsPerMonthSummary({ year: currentYear, students: studentsForYear });

  return { preset, range, summary, comparison, activity, modality, demand, hourlyRate, studentYear, newStudentsPerMonth };
}
