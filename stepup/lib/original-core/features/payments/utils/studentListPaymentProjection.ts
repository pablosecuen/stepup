// Puerto VERBATIM del original (`src/features/payments/utils/studentListPaymentProjection.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../../students/types/index.ts';
import type { PaymentsRepositoryState } from '../types/index.ts';
import type { StudentBillingPlan } from '../../student-profile/types/index.ts';
import { buildStudentPaymentsSummary } from './studentPaymentsSummary.ts';
import { resolveMonthlyStatusKindForDisplay, resolveStudentMonthlyCardStatus, summarizeOverdueDebt } from './monthlyPeriodStatus.ts';
import { isStudentEligibleForCollectionsDisplay } from './studentCollectionEligibility.ts';
import type { SurchargeSettings } from './surchargeSettings.ts';

/**
 * Proyecta el semáforo financiero REAL (calculado a partir del motor puro
 * de pagos) sobre cada `StudentListItem`, sin persistir nada derivado:
 * `Student.paymentStatus`/`hasOverduePayment`/`lastPaymentAt` heredados
 * pueden seguir existiendo en el tipo por compatibilidad, pero nunca se
 * leen acá como fuente de verdad — siempre se recalculan desde
 * `PaymentsRepositoryState` en el momento de leer la lista.
 *
 *  - `paymentStatus` = el semáforo calculado (`trafficLight`, la peor
 *    situación entre las obligaciones vigentes del alumno).
 *  - `hasOverduePayment` = true si tiene saldo realmente vencido (no sólo
 *    pendiente dentro del término) Y el alumno está `'activo'` — igual que
 *    `overdueDebtLabel`, un alumno no activo nunca proyecta esta señal
 *    (`isStudentEligibleForCollectionsDisplay`), aunque la deuda real siga
 *    existiendo en su historial.
 *  - `lastPaymentAt` = la fecha real (`paidAt`) del pago VIGENTE más
 *    reciente — un pago anulado nunca cuenta como "el último pago".
 *
 * Pura — nunca muta `students` ni `paymentsState`.
 *
 * Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y
 * tarjetas de Alumnos): `resolvePlan` (opcional, con default que siempre
 * devuelve `null`) agrega el estado financiero COMPLETO del mes actual
 * (`monthlyStatusLabel`/`monthlyStatusColorKey`/`monthlyStatusBalance`,
 * calculados con `resolveStudentMonthlyCardStatus`) — nunca el semáforo de
 * gravedad (`trafficLight`) solo, que a propósito da verde tanto sin
 * obligaciones como con una obligación todavía en término (día 1–10). El
 * default preserva la firma anterior para no romper los tests existentes
 * que llaman esta función sin el 4° argumento.
 */
export function projectStudentListPaymentStatus(
  students: StudentListItem[],
  paymentsState: PaymentsRepositoryState,
  evaluationDate: string,
  resolvePlan: (studentId: string) => StudentBillingPlan | null = () => null,
  surchargeSettings?: SurchargeSettings
): StudentListItem[] {
  return students.map((student) => {
    const summary = buildStudentPaymentsSummary({
      studentId: student.id,
      state: paymentsState,
      evaluationDate,
      surchargeSettings,
    });

    const lastPaymentAt = summary.activePayments.reduce<string | null>((latest, payment) => {
      if (latest === null || payment.paidAt > latest) return payment.paidAt;
      return latest;
    }, null);

    const plan = resolvePlan(student.id);
    const monthlyStatusInput = plan
      ? {
          plan,
          charges: summary.charges,
          chargeStates: summary.chargeStates,
          evaluationDate,
          surchargeSettings,
          status: student.status,
        }
      : null;
    const monthlyStatus = monthlyStatusInput ? resolveStudentMonthlyCardStatus(monthlyStatusInput) : null;
    // Corrección 2026-09-03 (a pedido de Joaquín — ERROR VISUAL: "Septiembre
    // pendiente" desborda/superpone en la lista de Alumnos): el `kind`
    // canónico (nunca un texto largo con el mes) para que `StudentCard.tsx`
    // arme su propia pastilla compacta — `monthlyStatusLabel` (arriba) sigue
    // siendo el texto completo, usado por el resto de las pantallas.
    const monthlyStatusKind = monthlyStatusInput ? resolveMonthlyStatusKindForDisplay(monthlyStatusInput) : undefined;
    const overdueDebt = summarizeOverdueDebt({ charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate });
    // Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
    // CIRCUITO DE COBROS): `monthlyStatusLabel`/`monthlyStatusKind` (arriba)
    // ya se gatean por estado desde 2026-09-02 (vía `resolveStudentMonthlyCardStatus`),
    // pero `hasOverduePayment`/`overdueDebtLabel` — el badge "Pago vencido" de
    // `StudentBadges.tsx` — se calculaban SIN mirar el estado, así un alumno
    // inactivo con una deuda vencida legítima seguía mostrando el badge de
    // deuda vencida al lado del badge "Inactivo". Misma regla única que el
    // resto del dominio (`isStudentEligibleForCollectionsDisplay`) — la deuda
    // real sigue existiendo (`summary.overdueBalance`/`overdueDebt` no se
    // tocan, sólo se deja de proyectar como señal operativa acá).
    const isEligibleForCollectionsDisplay = isStudentEligibleForCollectionsDisplay(student.status);

    return {
      ...student,
      paymentStatus: summary.trafficLight,
      hasOverduePayment: isEligibleForCollectionsDisplay && summary.overdueBalance > 0,
      lastPaymentAt,
      monthlyStatusLabel: monthlyStatus?.label ?? null,
      monthlyStatusColorKey: monthlyStatus?.colorKey,
      monthlyStatusBalance: monthlyStatus?.balance ?? 0,
      monthlyStatusKind,
      overdueDebtLabel: isEligibleForCollectionsDisplay ? overdueDebt.label : null,
    };
  });
}
