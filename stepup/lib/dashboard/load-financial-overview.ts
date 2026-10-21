import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listAllCharges, listAllAllocations, listAllPayments } from "@/lib/repositories/payments";
import { getBudgetDistributionSettings } from "@/lib/repositories/budget-distribution";
import { DEFAULT_BUDGET_DISTRIBUTION, type BudgetDistribution } from "@/lib/payments/budget-distribution";
import { buildMonthlyCollectedSeries, chartMonthsForRange, type MonthlyCollectedPoint } from "@/lib/reports/monthly-collected";
import { composeCalendarView, loadCalendarViewBase } from "@/lib/calendar/view";
import { listCalendarLessonsInRange } from "@/lib/repositories/calendar-lessons";
import { localDateKeyInTimeZone, ARGENTINA_TIME_ZONE } from "@/lib/payments/dates";
import { readTable } from "@/lib/db/read";
import { getTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { dayRangeInstants } from "@/lib/calendar/civil-calendar";
import { resolveFinancialPeriodRange, comparePeriodValues, previousComparableRange, type FinancialPeriodPreset, type DateRange } from "@/lib/reports/period";
import { buildPeriodFinancialSummary, type PeriodFinancialSummary } from "@/lib/reports/financial-summary";
import type { AnnualActivitySummary, ModalitySummary } from "@/lib/reports/annual-activity";
import { demandRangeFor, type CalendarDemandSummary } from "@/lib/reports/demand";
import type { ProgrammedHourlyRateSummary } from "@/lib/reports/hourly-rate";
import { buildFinancialStatistics, type RegistrationRowWithExtras } from "@/lib/reports/financial-statistics";
import type { StudentYearActivitySummary, NewStudentsPerMonthSummary } from "@/lib/reports/student-year-summary";
import { buildMonthSnapshot, type MonthSnapshot } from "@/lib/reports/month-snapshot";
import { withoutExcludedRegistrations, withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";

export interface FinancialOverviewData {
  preset: FinancialPeriodPreset;
  range: DateRange;
  summary: PeriodFinancialSummary;
  /** Deuda de meses anteriores y alumnos que pagaron / con deuda: siempre del mes en curso, independientes del período elegido. */
  monthSnapshot: MonthSnapshot;
  /** Cobrado por mes (gráfico «Evolución de cobros»): sólo dinero efectivamente cobrado, cronológico. */
  collectedSeries: MonthlyCollectedPoint[];
  /** Porcentajes guardados de la distribución sugerida (50/30/20 por defecto). */
  budget: BudgetDistribution;
  comparison: { generated: ReturnType<typeof comparePeriodValues>; collected: ReturnType<typeof comparePeriodValues> } | null;
  /** Actividad del período elegido (mismas reglas que el resumen anual). */
  activity: AnnualActivitySummary;
  /** Resumen anual del año en curso: no depende del período elegido. */
  year: number;
  annualActivity: AnnualActivitySummary;
  modality: ModalitySummary;
  /** Últimos 90 días: siempre fijos, independientes del período elegido. */
  demand: CalendarDemandSummary;
  hourlyRate: ProgrammedHourlyRateSummary;
  studentYear: StudentYearActivitySummary;
  newStudentsPerMonth: NewStudentsPerMonthSummary;
}

const REGISTRATION_COLUMNS =
  "id, calendar_lesson_id, source_event_type, outcome, holiday_exception, is_billable, scheduled_start_at, scheduled_end_at, actual_started_at, actual_ended_at, scheduled_duration_minutes, actual_duration_minutes, modality, billed_amount, created_at, source_extras";

/**
 * Orquestador único de "Resumen financiero" (Fase 7) — combina los
 * repositorios ya existentes (Fases 1-6) con los motores puros de
 * `lib/reports/`. Ninguna tarjeta expone nombres de alumnos ni montos
 * individuales — sólo agregados (mismo criterio real del móvil,
 * `FinancialAnalyticsSections.tsx`).
 *
 * Las estadísticas de actividad (valor de la hora, demanda, resumen anual, modalidad, alumnos del año) usan las MISMAS reglas que la app anterior: ver `lib/reports/financial-statistics.ts`.
 */
export async function loadFinancialOverviewData(ctx: AuthenticatedDbContext, preset: FinancialPeriodPreset): Promise<FinancialOverviewData> {
  const now = new Date();
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const range = resolveFinancialPeriodRange(preset, evaluationDate);
  const year = Number(evaluationDate.slice(0, 4));

  // Período elegido y demanda (90 días terminando hoy, por fecha civil de Argentina): ambos como rangos de días completos.
  const periodInstants = dayRangeInstants(range.rangeStart, range.rangeEnd);
  const demandRange = demandRangeFor(evaluationDate);
  const demandInstants = dayRangeInstants(demandRange.rangeStart, demandRange.rangeEnd);

  // Todas las lecturas que NO dependen unas de otras salen juntas. Series, excepciones y alumnos se leen UNA vez para las dos vistas del calendario.
  const [calendarBase, charges, allocations, payments, periodLessons, demandLessons, registrations, roster, evaluationAmounts, ruleIds, packageMovements, availability, budgetSettings] = await Promise.all([
    loadCalendarViewBase(ctx),
    listAllCharges(ctx),
    listAllAllocations(ctx),
    listAllPayments(ctx),
    listCalendarLessonsInRange(ctx, periodInstants.startIso, periodInstants.endIso),
    listCalendarLessonsInRange(ctx, demandInstants.startIso, demandInstants.endIso),
    // Registros terminados de TODA la cuenta: el resumen anual y el valor de la hora los cruzan con la agenda (un registro en curso todavía no es un resultado).
    readTable<RegistrationRowWithExtras>(ctx.supabase, "lesson_registrations", { columns: REGISTRATION_COLUMNS, filter: (query) => query.eq("owner_id", ctx.ownerId).eq("status", "completed") }),
    readTable<{ lesson_registration_id: string; student_id: string }>(ctx.supabase, "lesson_registration_students", { columns: "id, lesson_registration_id, student_id", filter: (query) => query.eq("owner_id", ctx.ownerId) }),
    readTable<{ lesson_registration_id: string; student_id: string; billed_amount: number | string | null }>(ctx.supabase, "lesson_registration_evaluations", {
      columns: "id, lesson_registration_id, student_id, billed_amount",
      filter: (query) => query.eq("owner_id", ctx.ownerId),
    }),
    readTable<{ id: string; legacy_mobile_id: string | null }>(ctx.supabase, "recurrence_rules", { columns: "id, legacy_mobile_id", filter: (query) => query.eq("owner_id", ctx.ownerId) }),
    readTable<{ package_id: string; student_id: string; saved_lesson_id: string | null }>(ctx.supabase, "package_credit_movements", {
      columns: "id, package_id, student_id, saved_lesson_id",
      filter: (query) => query.eq("owner_id", ctx.ownerId).eq("movement_type", "consumo").is("voided_at", null).not("saved_lesson_id", "is", null),
    }),
    getTeacherAvailability(ctx),
    // Una sola fila por profesora; si no se puede leer, la sugerencia usa 50/30/20 (nunca rompe el resumen).
    getBudgetDistributionSettings(ctx).catch(() => null),
  ]);

  const periodItems = composeCalendarView(calendarBase, periodLessons, new Date(periodInstants.startIso), new Date(periodInstants.endIso));
  const demandItems = composeCalendarView(calendarBase, demandLessons, new Date(demandInstants.startIso), new Date(demandInstants.endIso));

  // Datos de prueba confirmados (R16): fuera de las estadísticas (registros y alumnos); con la lista vacía no cambia nada. La agenda ya viene filtrada por `composeCalendarView`.
  const excludedStudentIds = calendarBase.excludedStudentIds;
  const studentsByRegistration = new Map<string, string[]>();
  roster.forEach((entry) => studentsByRegistration.set(entry.lesson_registration_id, [...(studentsByRegistration.get(entry.lesson_registration_id) ?? []), entry.student_id]));
  const visibleStudents = withoutExcludedStudents(calendarBase.students, excludedStudentIds);

  const statistics = buildFinancialStatistics({
    evaluationDate,
    evaluationInstant: now.toISOString(),
    range,
    year,
    periodItems,
    demandItems,
    registrations: withoutExcludedRegistrations(registrations, studentsByRegistration, excludedStudentIds),
    roster,
    evaluationAmounts,
    rules: ruleIds,
    students: visibleStudents,
    charges,
    packageConsumptions: packageMovements.flatMap((movement) => (movement.saved_lesson_id ? [{ packageId: movement.package_id, studentId: movement.student_id, registrationId: movement.saved_lesson_id }] : [])),
    availabilityExceptions: availability.exceptions,
  });

  const summary = buildPeriodFinancialSummary({
    charges,
    allocations: allocations.map((a) => ({ chargeId: a.chargeId, paymentId: a.paymentId, amount: a.amount })),
    payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, voidedAt: p.voidedAt })),
    range,
    evaluationDate,
  });

  const monthSnapshot = buildMonthSnapshot({
    charges,
    allocations: allocations.map((a) => ({ chargeId: a.chargeId, paymentId: a.paymentId, amount: a.amount })),
    payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, voidedAt: p.voidedAt })),
    studentStatusById: new Map(visibleStudents.map((student) => [student.id, student.status])),
    evaluationDate,
  });

  // Evolución de cobros: los mismos pagos y asignaciones ya cargados, agrupados por mes (sin consultas por elemento).
  const collectedSeries = buildMonthlyCollectedSeries(
    { charges, allocations: allocations.map((a) => ({ chargeId: a.chargeId, paymentId: a.paymentId, amount: a.amount })), payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, voidedAt: p.voidedAt })) },
    chartMonthsForRange(range, evaluationDate, preset)
  );
  const budget = budgetSettings ? budgetSettings.distribution : DEFAULT_BUDGET_DISTRIBUTION;

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

  return {
    preset,
    range,
    summary,
    monthSnapshot,
    collectedSeries,
    budget,
    comparison,
    activity: statistics.periodActivity,
    year,
    annualActivity: statistics.annualActivity,
    modality: statistics.modality,
    demand: statistics.demand,
    hourlyRate: statistics.hourlyRate,
    studentYear: statistics.studentYear,
    newStudentsPerMonth: statistics.newStudentsPerMonth,
  };
}
