import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { listAllCharges, listAllAllocations, listAllPayments } from "@/lib/repositories/payments";
import { listLessonRegistrationsInRange, listRosterForRegistrationIds } from "@/lib/repositories/lesson-registrations";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
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

  const [students, charges, allocations, payments] = await Promise.all([listStudents(ctx), listAllCharges(ctx), listAllAllocations(ctx), listAllPayments(ctx)]);

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

  const rangeStartIso = localDateTimeToInstantIso({ date: range.rangeStart, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE });
  const rangeEndIso = localDateTimeToInstantIso({ date: range.rangeEnd, hour: 23, minute: 59, timeZone: ARGENTINA_TIME_ZONE });
  const registrationsInRange = await listLessonRegistrationsInRange(ctx, rangeStartIso, rangeEndIso);

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

  // Demanda: SIEMPRE últimos 90 días fijos, no configurable (mismo
  // criterio real del móvil) — independiente del preset elegido.
  const demandStart = new Date(now.getTime() - DEMAND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const demandItems = await loadCalendarViewForRange(ctx, demandStart, now);
  const demand = buildCalendarDemandSummary(
    demandItems.filter((item) => item.status !== "cancelled").map((item) => ({ startAt: item.start, timeZone: ARGENTINA_TIME_ZONE }))
  );

  // Valor programado de la hora: TODA la agenda real del rango del preset
  // (materializada + virtual), cruzada con los registros ya completados
  // para saber qué ocurrencias ya tienen ingreso real atribuido.
  const hourlyRangeItems = await loadCalendarViewForRange(ctx, new Date(rangeStartIso), new Date(rangeEndIso));
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

  const currentYear = Number(evaluationDate.slice(0, 4));
  const studentsForYear = students.map((s) => ({ id: s.id, status: s.status, dateJoined: s.dateJoined }));

  // `studentYear`/`newStudentsPerMonth` necesitan el AÑO completo, no sólo
  // el rango del preset — si el preset elegido ya es exactamente el año
  // actual, reutiliza lo ya consultado; si no, hace su propia consulta
  // anual real (nunca infiere el año a partir de un rango más angosto).
  const yearStartIso = localDateTimeToInstantIso({ date: `${currentYear}-01-01`, hour: 0, minute: 0, timeZone: ARGENTINA_TIME_ZONE });
  const yearEndIso = localDateTimeToInstantIso({ date: `${currentYear}-12-31`, hour: 23, minute: 59, timeZone: ARGENTINA_TIME_ZONE });
  const yearRegistrationsFull =
    range.rangeStart === `${currentYear}-01-01` && range.rangeEnd === `${currentYear}-12-31` ? registrationsInRange : await listLessonRegistrationsInRange(ctx, yearStartIso, yearEndIso);

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
