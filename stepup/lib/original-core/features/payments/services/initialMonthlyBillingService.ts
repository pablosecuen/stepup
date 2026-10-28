// Puerto VERBATIM del original (`src/features/payments/services/initialMonthlyBillingService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentMethod } from '../types/index.ts';
import { ARGENTINA_TIME_ZONE, billingPeriodOfDateKey, localDateKeyInTimeZone, nextBillingPeriod } from '../utils/paymentDates.ts';
import { planEnsureMonthlyChargeSituation, type EnsureMonthlyChargeSituationResult, type FirstMonthSituation } from '../utils/initialMonthlyBillingPlan.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';
import { getStudentProfile, updateStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan, resolveEffectiveMonthlyAmount } from '../../student-profile/utils/studentBillingPlan.ts';
import type { StudentProfile } from '../../student-profile/types/index.ts';

export interface ApplyFirstMonthSituationInput {
  studentId: string;
  situation: FirstMonthSituation;
  amount: number;
  /** YYYY-MM-DD — sólo se usa cuando `situation === 'paid'`. Por defecto, hoy (AR). */
  paidAt?: string;
  method?: PaymentMethod;
  notes?: string;
  now?: Date;
  /**
   * Ver el comentario en `EnsureMonthlyChargeSituationInput`
   * (`initialMonthlyBillingPlan.ts`). `true` (default) conserva el
   * comportamiento de siempre — pensado para la declaración de "situación
   * del primer mes" al dar de alta a un alumno, donde `paidAt` es ambiguo
   * por diseño. `markCurrentMonthAsPaid` pasa `false` explícitamente: ahí
   * `paidAt` es la fecha real de la confirmación.
   */
  clampPaidAtToDueDate?: boolean;
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
   * mensualidades "Mes vencido" al comenzar el mes): día real de
   * vencimiento — opcional, por defecto se resuelve del perfil ya
   * persistido del alumno (`resolveStudentBillingPlan`), y si no existe
   * plan mensual todavía, `DEFAULT_MONTHLY_DUE_DAY`. Sólo hace falta
   * pasarlo explícito en una prueba con un perfil falso/inexistente.
   */
  dueDay?: number;
}

/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E02, auditoría de simulación
 * anual): sólo lo que este servicio necesita del store de pagos —
 * inyectable para poder probar "Marcar mes actual como pagado"/"Situación
 * del primer mes" de punta a punta con un adaptador en memoria, sin
 * AsyncStorage real. Mismo patrón exacto que `RegisterPaymentStoreDeps`
 * (`registerPaymentService.ts`) y `MonthlyChargeGenerationStoreDeps`
 * (`monthlyChargeGenerationService.ts`) — antes este servicio era el único
 * de los tres que llamaba directo al singleton real, sin forma de
 * sustituirlo en una prueba.
 */
export type ApplyFirstMonthSituationStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: ApplyFirstMonthSituationStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

/**
 * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
 * orquesta `planEnsureMonthlyChargeSituation` dentro de una única
 * `applyPaymentsMutation` — mismo patrón anti-TOCTOU que
 * `registerPaymentService`/`monthlyChargeGenerationService`: el plan se
 * calcula DENTRO del updater, contra el estado ya confirmado en ese momento
 * de la cola, así dos llamadas concurrentes nunca duplican el cargo ni el
 * pago del mes actual. Usada tanto por el alta/edición de un alumno mensual
 * ("Situación del primer mes") como por la acción "Marcar mes actual como
 * pagado" de un alumno mensual que ya existía.
 */
export async function applyFirstMonthSituation(
  input: ApplyFirstMonthSituationInput,
  deps: ApplyFirstMonthSituationStoreDeps = defaultStoreDeps
): Promise<EnsureMonthlyChargeSituationResult> {
  await deps.hydrate();

  const now = input.now ?? new Date();
  const todayDateKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const billingPeriod = billingPeriodOfDateKey(todayDateKey);
  const paidAt = input.paidAt ?? todayDateKey;
  const idSuffix = `${input.studentId}_${billingPeriod}`;

  // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
  // mensualidades "Mes vencido" al comenzar el mes): el vencimiento de una
  // obligación creada acá (alta de alumno nuevo, "Marcar mes actual como
  // pagado", retomar cobro tras una restauración) respeta el `dueDay` REAL
  // ya persistido del alumno — nunca el día 1 fijo. `getStudentProfile` es
  // una lectura en memoria pura (nunca toca AsyncStorage), segura de llamar
  // aunque el perfil todavía no exista (alta en curso): en ese caso cae al
  // default de la profesora (`DEFAULT_MONTHLY_DUE_DAY`).
  const profile = getStudentProfile(input.studentId);
  const existingPlan = profile ? resolveStudentBillingPlan(profile) : null;
  const dueDay = input.dueDay ?? (existingPlan && existingPlan.type === 'monthly' ? existingPlan.dueDay : undefined);

  let result: EnsureMonthlyChargeSituationResult | null = null;
  await deps.applyMutation((current) => {
    result = planEnsureMonthlyChargeSituation({
      studentId: input.studentId,
      situation: input.situation,
      amount: input.amount,
      billingPeriod,
      dueDay,
      paidAt,
      clampPaidAtToDueDate: input.clampPaidAtToDueDate,
      method: input.method ?? 'efectivo',
      todayDateKey,
      createdAt: now.toISOString(),
      recordedAt: now.toISOString(),
      notes: input.notes,
      chargeId: `charge_mensual_${idSuffix}`,
      paymentId: `payment_${idSuffix}_${now.getTime()}`,
      allocationId: `payment_${idSuffix}_${now.getTime()}_alloc_1`,
      state: current,
    });

    let next = current;
    if (result.chargeToCreate) {
      next = { ...next, charges: [...next.charges, result.chargeToCreate] };
    }
    if (result.payment) {
      next = { ...next, payments: [...next.payments, result.payment] };
    }
    if (result.allocation) {
      next = { ...next, allocations: [...next.allocations, result.allocation] };
    }
    return next;
  });

  if (!result) {
    // Inalcanzable: si `planEnsureMonthlyChargeSituation` lanza dentro del
    // updater, `applyPaymentsMutation` rechaza y este código nunca corre.
    throw new Error('No se pudo aplicar la situación del primer mes.');
  }
  return result;
}

/**
 * Atajo semántico para la acción "Marcar mes actual como pagado" (sección
 * "DATOS ACTUALES" del pedido): un alumno mensual que ya existía antes de
 * esta corrección. Misma operación que `applyFirstMonthSituation` con
 * `situation: 'paid'` — nunca un segundo camino de código.
 *
 * Corrección 2026-08-16 (a pedido de Joaquín — Fase 4/5, corrección
 * integral post-simulación): `clampPaidAtToDueDate: false` explícito —
 * acá `paidAt` es la fecha REAL de la confirmación (el alumno paga hoy),
 * nunca una declaración ambigua como en el alta. Antes, esta función
 * heredaba sin querer el clamp pensado sólo para el alta: un alumno
 * genuinamente vencido que se marcaba como pagado HOY quedaba registrado
 * como "en término" (sin el recargo que la vista previa de CobrosTab ya le
 * había mostrado a la profesora un instante antes) — el importe mostrado y
 * el importe realmente asignado podían divergir en silencio.
 */
export async function markCurrentMonthAsPaid(
  input: {
    studentId: string;
    amount: number;
    paidAt?: string;
    method?: PaymentMethod;
    now?: Date;
  },
  deps: ApplyFirstMonthSituationStoreDeps = defaultStoreDeps
): Promise<EnsureMonthlyChargeSituationResult> {
  return applyFirstMonthSituation({ ...input, situation: 'paid', clampPaidAtToDueDate: false }, deps);
}

export type MonthlyBillingResumptionChoice = 'this_month' | 'next_month';

export interface ResumeMonthlyBillingInput {
  studentId: string;
  choice: MonthlyBillingResumptionChoice;
  now?: Date;
}

export interface ResumeMonthlyBillingResult {
  billingPeriod: string;
  /** true si esta llamada tuvo que crear el cargo del período actual (false si ya existía o si se eligió "próximo mes"). */
  chargeCreated: boolean;
}

/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E04, corrección integral
 * post-simulación): sólo lo que esta función necesita del perfil del
 * alumno — inyectable para poder probarla de punta a punta con un
 * almacén en memoria, sin AsyncStorage real. Mismo espíritu que
 * `ApplyFirstMonthSituationStoreDeps` arriba, aplicado ahora al perfil
 * (`getStudentProfile`/`updateStudentProfile`, que antes sólo existían
 * como el singleton real).
 */
export interface ResumeMonthlyBillingProfileDeps {
  getProfile: (studentId: string) => StudentProfile | null;
  saveProfile: (profile: StudentProfile) => Promise<void>;
}

const defaultProfileDeps: ResumeMonthlyBillingProfileDeps = {
  getProfile: getStudentProfile,
  saveProfile: updateStudentProfile,
};

/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E04, corrección integral
 * post-simulación): al restaurar/reactivar un alumno mensual a mitad de
 * mes, la generación automática de cargos ya había corrido para este
 * período (excluyendo al alumno, que en ese momento estaba archivado) — sin
 * esta función, el alumno queda "sin cargo vigente" hasta el próximo ciclo
 * automático (próximo cambio de día/mes, o próximo reinicio de la app),
 * mostrando una ventana silenciosa donde parece no deberle nada a la
 * profesora. Reutiliza EXACTAMENTE el mismo mecanismo que el alta de un
 * alumno nuevo (`applyFirstMonthSituation`, `situation: 'pending'` o
 * `'starts_next_month'`) — nunca un segundo motor financiero — así que la
 * decisión ("Cobrar desde este mes" / "Comenzar el próximo mes") se aplica
 * de inmediato, sin esperar ningún ciclo automático posterior.
 *
 * Idempotente: `applyFirstMonthSituation('pending')` nunca duplica un
 * cargo si ya existe uno para el período (por ejemplo, un alumno que ya
 * estaba pagado antes de archivarse conserva ese cargo/pago intactos —
 * esta función nunca los toca, sólo verifica que la obligación exista).
 */
export async function resumeMonthlyBillingAfterRestore(
  input: ResumeMonthlyBillingInput,
  deps: ApplyFirstMonthSituationStoreDeps = defaultStoreDeps,
  profileDeps: ResumeMonthlyBillingProfileDeps = defaultProfileDeps
): Promise<ResumeMonthlyBillingResult> {
  const now = input.now ?? new Date();
  const todayDateKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const currentBillingPeriod = billingPeriodOfDateKey(todayDateKey);

  const profile = profileDeps.getProfile(input.studentId);
  if (!profile) {
    throw new Error('No se encontró el perfil del alumno — no se puede decidir desde cuándo se retoma el cobro.');
  }
  const plan = resolveStudentBillingPlan(profile);
  if (plan.type !== 'monthly') {
    throw new Error('Este alumno no tiene un plan mensual — no corresponde elegir desde cuándo se cobra.');
  }

  if (input.choice === 'next_month') {
    const startPeriod = nextBillingPeriod(currentBillingPeriod);
    await profileDeps.saveProfile({ ...profile, billingPlan: { ...plan, startPeriod } });
    return { billingPeriod: startPeriod, chargeCreated: false };
  }

  // 'this_month': generar exactamente un cargo del período actual (si no existía ya), respetando el importe vigente real del plan.
  const effectiveAmount = resolveEffectiveMonthlyAmount(plan, currentBillingPeriod);
  const result = await applyFirstMonthSituation(
    // dueDay explícito: `profileDeps` es inyectable (pruebas con un perfil
    // falso) — nunca depender acá del lookup interno de `applyFirstMonthSituation`
    // contra el singleton real, que en una prueba con perfil falso no lo vería.
    { studentId: input.studentId, situation: 'pending', amount: effectiveAmount, dueDay: plan.dueDay, now },
    deps
  );
  await profileDeps.saveProfile({ ...profile, billingPlan: { ...plan, startPeriod: currentBillingPeriod } });
  return { billingPeriod: currentBillingPeriod, chargeCreated: result.chargeToCreate !== null };
}
