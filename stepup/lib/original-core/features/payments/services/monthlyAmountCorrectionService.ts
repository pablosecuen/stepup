// Puerto VERBATIM del original (`src/features/payments/services/monthlyAmountCorrectionService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { MonthlyAmountCorrectionEntry } from '../types/index.ts';
import { ARGENTINA_TIME_ZONE, billingPeriodOfDateKey, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { planMonthlyAmountChange, type MonthlyAmountChangeEffectiveFrom, type MonthlyAmountChangePlan } from '../utils/monthlyAmountCorrection.ts';
import { calculateChargeState } from '../utils/paymentCalculations.ts';
import type { SurchargeSettings } from '../utils/surchargeSettings.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';
import { getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore } from '../hooks/surchargeSettingsStore.ts';
import { appendMonthlyAmountCorrectionEntry } from '../hooks/monthlyAmountCorrectionLogStore.ts';
import { getStudentProfile, updateStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';
import type { StudentProfile } from '../../student-profile/types/index.ts';

const DEFAULT_REASON = 'Corrección de monto mensual';

export interface CorrectMonthlyAmountInput {
  studentId: string;
  newAmount: number;
  effectiveFrom: MonthlyAmountChangeEffectiveFrom;
  reason?: string;
  now?: Date;
}

export interface CorrectMonthlyAmountResult {
  plan: MonthlyAmountChangePlan;
  entry: MonthlyAmountCorrectionEntry;
}

/**
 * Corrección 2026-08-17 (a pedido de Joaquín — auditoría exhaustiva de
 * cambio de monto mensual): sólo lo que este servicio necesita del store de
 * pagos — inyectable para poder probar `correctMonthlyAmount` de punta a
 * punta con un adaptador en memoria, sin AsyncStorage real. Mismo patrón
 * exacto que `ApplyFirstMonthSituationStoreDeps`
 * (`initialMonthlyBillingService.ts`) — antes este servicio era el único de
 * los cuatro (junto a `registerPaymentService`/`monthlyChargeGenerationService`/
 * `initialMonthlyBillingService`) que llamaba directo a los singletons
 * reales, sin forma de sustituirlos en una prueba.
 */
export type CorrectMonthlyAmountStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'> & {
  /**
   * Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO: recargo
   * desactivado que seguía apareciendo como deuda): OPCIONALES a propósito —
   * un llamador real (deps por defecto) los usa para leer la configuración
   * de recargos VIGENTE; una prueba que no los provee sigue calculando con
   * `surchargeSettings: undefined` (el mismo `DEFAULT_SURCHARGE_SETTINGS`
   * que ya usaban todas las pruebas existentes de este servicio) — nunca
   * toca AsyncStorage real sin que el llamador lo pida.
   */
  hydrateSurchargeSettings?: () => Promise<SurchargeSettings>;
  getSurchargeSettingsSnapshot?: () => SurchargeSettings;
};

const defaultStoreDeps: CorrectMonthlyAmountStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
  hydrateSurchargeSettings: hydrateSurchargeSettingsStore,
  getSurchargeSettingsSnapshot,
};

/**
 * Mismo espíritu que `ResumeMonthlyBillingProfileDeps`
 * (`initialMonthlyBillingService.ts`), aplicado acá: el perfil del alumno
 * también vive en un store de módulo real (AsyncStorage), separado del de
 * pagos — inyectable para poder probar la compensación (revertir el cargo
 * si falla guardar el perfil) sin depender de ese singleton real.
 */
export interface CorrectMonthlyAmountProfileDeps {
  getProfile: (studentId: string) => StudentProfile | null;
  saveProfile: (profile: StudentProfile) => Promise<void>;
}

const defaultProfileDeps: CorrectMonthlyAmountProfileDeps = {
  getProfile: getStudentProfile,
  saveProfile: updateStudentProfile,
};

/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual): orquesta el cambio de monto mensual CON
 * vigencia — "Aplicar desde este mes" corrige el cargo del período vigente
 * (si existía) y el importe efectivo del plan en el mismo paso; "Aplicar
 * desde el próximo mes" nunca toca el cargo actual, sólo dejar anotado el
 * cambio pendiente (`billingPlan.pendingAmount`/`pendingAmountEffectiveFrom`)
 * para que `resolveEffectiveMonthlyAmount` lo resuelva solo cuando
 * corresponda. El plan se calcula DENTRO del `applyPaymentsMutation` (mismo
 * criterio anti-condición-de-carrera que `applyFirstMonthSituation`): dos
 * cambios concurrentes nunca se pisan entre sí. Como son dos stores
 * independientes (pagos vs. perfiles), si `updateStudentProfile` falla
 * DESPUÉS de que el cargo ya se corrigió, se revierte el cargo antes de
 * relanzar — nunca queda un cargo corregido con el plan desactualizado.
 */
export async function correctMonthlyAmount(
  input: CorrectMonthlyAmountInput,
  deps: CorrectMonthlyAmountStoreDeps = defaultStoreDeps,
  profileDeps: CorrectMonthlyAmountProfileDeps = defaultProfileDeps
): Promise<CorrectMonthlyAmountResult> {
  const profile = profileDeps.getProfile(input.studentId);
  if (!profile) {
    throw new Error('No se encontró el alumno.');
  }

  const resolvedPlan = resolveStudentBillingPlan(profile);
  if (resolvedPlan.type !== 'monthly') {
    throw new Error('Este alumno no tiene un plan de cobro mensual.');
  }

  await deps.hydrate();
  if (deps.hydrateSurchargeSettings) await deps.hydrateSurchargeSettings();
  const surchargeSettings = deps.getSurchargeSettingsSnapshot?.();

  const now = input.now ?? new Date();
  const currentBillingPeriod = billingPeriodOfDateKey(localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE));

  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);

  let plan: MonthlyAmountChangePlan | null = null;
  await deps.applyMutation((current) => {
    const existingCharge = current.charges.find(
      (charge) =>
        charge.studentId === input.studentId &&
        charge.type === 'mensual' &&
        charge.billingPeriod === currentBillingPeriod &&
        charge.voidedAt === null
    );
    const currentChargeState = existingCharge
      ? calculateChargeState({
          charge: existingCharge,
          allocations: current.allocations,
          payments: current.payments,
          adjustments: current.adjustments,
          evaluationDate,
          surchargeSettings,
        })
      : null;

    plan = planMonthlyAmountChange({
      studentId: input.studentId,
      currentBillingPeriod,
      newAmount: input.newAmount,
      effectiveFrom: input.effectiveFrom,
      existingCharges: current.charges,
      existingCharge: existingCharge ?? null,
      currentChargeState,
      createdAt: now.toISOString(),
    });
    if (!plan.chargeUpdated) return current; // nada que tocar en el store de pagos todavía.
    return { ...current, charges: plan.updatedCharges };
  });
  if (!plan) {
    // Inalcanzable en la práctica: si `planMonthlyAmountChange` lanza
    // dentro del updater, `applyPaymentsMutation` rechaza y este código
    // nunca corre.
    throw new Error('No se pudo calcular el cambio de monto mensual.');
  }
  const confirmedPlan: MonthlyAmountChangePlan = plan;

  try {
    await profileDeps.saveProfile({
      ...profile,
      billingPlan: { ...resolvedPlan, ...confirmedPlan.planPatch },
    });
  } catch (profileError) {
    if (confirmedPlan.chargeCreated) {
      // Compensación (corrección 2026-08-10): el cargo NO existía antes de
      // esta llamada — si el perfil no se pudo guardar, se retira por
      // completo (nunca queda un cargo huérfano cuyo plan de origen nunca
      // se guardó — desde la perspectiva de la profesora, el cambio de
      // cuota entero se revierte, atómico).
      await deps.applyMutation((current) => ({
        ...current,
        charges: current.charges.filter((charge) => charge.id !== confirmedPlan.chargeId),
      })).catch(() => {
        // Si ni siquiera la reversión se puede escribir, no hay nada más
        // que intentar acá — el error original sigue siendo el que se
        // relanza, para que la pantalla lo muestre tal cual.
      });
    } else if (confirmedPlan.chargeUpdated) {
      // Compensación: el cargo YA EXISTÍA y quedó con el importe nuevo,
      // pero el plan del alumno no se pudo actualizar — revertir el cargo
      // a su importe anterior antes de relanzar, para no dejar el saldo
      // corregido con una configuración desactualizada.
      await deps.applyMutation((current) => ({
        ...current,
        charges: current.charges.map((charge) =>
          charge.id === confirmedPlan.chargeId
            ? { ...charge, originalAmount: confirmedPlan.previousChargeAmount ?? charge.originalAmount }
            : charge
        ),
      })).catch(() => {
        // Si ni siquiera la reversión se puede escribir, no hay nada más
        // que intentar acá — el error original sigue siendo el que se
        // relanza, para que la pantalla lo muestre tal cual.
      });
    }
    throw profileError;
  }

  const entry: MonthlyAmountCorrectionEntry = {
    id: `monthly_amount_correction_${input.studentId}_${now.getTime()}`,
    studentId: input.studentId,
    billingPeriod: currentBillingPeriod,
    previousAmount: confirmedPlan.previousChargeAmount ?? resolvedPlan.amount,
    newAmount: input.newAmount,
    changedAt: now.toISOString(),
    reason: input.reason?.trim() || DEFAULT_REASON,
    effectiveFrom: input.effectiveFrom,
  };
  try {
    await appendMonthlyAmountCorrectionEntry(entry);
  } catch (auditError) {
    // El registro de auditoría es best-effort: la corrección real (cargo +
    // plan) ya se aplicó y persistió con éxito — perder sólo la entrada de
    // auditoría no amerita deshacer un cambio financiero correcto.
    console.error('No se pudo guardar el registro de auditoría de la corrección de monto mensual', auditError);
  }

  return { plan: confirmedPlan, entry };
}
