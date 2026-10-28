// Puerto VERBATIM del original (`src/features/payments/services/surchargeSettingsService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { calculateChargeState, isSurchargeWaivedForCharge } from '../utils/paymentCalculations.ts';
import { buildAdjustment } from '../utils/paymentMutations.ts';
import { ARGENTINA_TIME_ZONE, billingPeriodOfDateKey, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { proposeSurchargeSettingsChange, type SurchargeSettings, type SurchargeSettingsVigencia, type SurchargeTierValues } from '../utils/surchargeSettings.ts';
import { applySurchargeSettingsMutation, getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore, type SurchargeSettingsStoreController } from '../hooks/surchargeSettingsStore.ts';
import { applyPaymentsMutation, getPaymentsSnapshot, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): orquesta los
 * cambios de configuración de recargos, mismo patrón que
 * `registerPaymentService.ts` — hidrata, arma el cambio con el motor puro
 * (`proposeSurchargeSettingsChange`) y lo persiste con una única mutación
 * atómica (rollback automático si la escritura falla, ya incluido en
 * `applyMutation` de cada store).
 */

export type SurchargeSettingsServiceDeps = Pick<SurchargeSettingsStoreController, 'hydrate' | 'applyMutation' | 'getSnapshot'>;
export type PaymentsServiceDepsForSurcharge = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation' | 'getSnapshot'>;

const defaultSurchargeDeps: SurchargeSettingsServiceDeps = {
  hydrate: hydrateSurchargeSettingsStore,
  applyMutation: applySurchargeSettingsMutation,
  getSnapshot: getSurchargeSettingsSnapshot,
};

const defaultPaymentsDeps: PaymentsServiceDepsForSurcharge = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
  getSnapshot: getPaymentsSnapshot,
};

function resolveTodayDateKey(now: Date): string {
  return localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
}

/**
 * Corrección 2026-08-13 (a pedido de Joaquín — corrección visual del menú:
 * el switch "flotante" en el menú lateral se quitó por completo; el único
 * punto de la app donde se activa/desactiva y se configuran días/
 * porcentajes es este panel). Guarda TODO junto — switch `enabled`, los 4
 * días, los 3 porcentajes y la vigencia elegida — en una única mutación
 * atómica: antes existían dos funciones separadas (`saveSurchargeTierValues`
 * sólo días/porcentajes + `setSurchargesEnabled` sólo el switch) porque
 * había dos puntos de entrada en la UI; con uno solo, tiene sentido un único
 * punto de guardado.
 *
 * `clearCurrentSurcharges: true` (opción "Quitar recargos vigentes" de la
 * confirmación que se muestra al guardar con el switch recién apagado)
 * además condona el recargo YA acumulado de cada obligación abierta con
 * recargo vigente en este mismo momento, reutilizando la infraestructura
 * existente de condonación (`PaymentAdjustment`) — nunca modifica
 * `originalAmount`, pagos ni asignaciones; nunca borra historial; las
 * obligaciones ya saldadas quedan afuera (`chargeState.settledAt` ya las
 * excluye vía `surchargeAmount`, congelado desde que se saldaron). Ambas
 * escrituras (configuración + condonaciones) son atómicas cada una por
 * separado, con rollback automático si falla — si la segunda falla, la
 * primera ya quedó aplicada y no se revierte (desactivar recargos hacia
 * adelante es siempre seguro de dejar aplicado incluso si condonar lo ya
 * acumulado falla; nunca al revés).
 */
export async function saveSurchargeTierValues(
  input: {
    nextValues: SurchargeTierValues;
    vigencia: SurchargeSettingsVigencia;
    clearCurrentSurcharges?: boolean;
    now?: Date;
  },
  deps: SurchargeSettingsServiceDeps = defaultSurchargeDeps,
  paymentsDeps: PaymentsServiceDepsForSurcharge = defaultPaymentsDeps
): Promise<SurchargeSettings> {
  await deps.hydrate();
  const now = input.now ?? new Date();
  const todayBillingPeriod = billingPeriodOfDateKey(resolveTodayDateKey(now));
  // Capturada ANTES de mutar: `clearCurrentlyAccruedSurcharges` necesita
  // saber qué obligaciones tenían un recargo realmente vigente HOY, bajo la
  // configuración que regía hasta este instante — usar la configuración ya
  // guardada más abajo daría siempre `surchargeAmount: 0` y no condonaría
  // nada.
  const settingsBeforeChange = deps.getSnapshot();

  const nextSettings = await deps.applyMutation((current) =>
    proposeSurchargeSettingsChange(current, input.nextValues, input.vigencia, todayBillingPeriod)
  );

  if (!input.nextValues.enabled && input.clearCurrentSurcharges) {
    await clearCurrentlyAccruedSurcharges(
      { now, reason: 'Recargos automáticos desactivados por la profesora', surchargeSettings: settingsBeforeChange },
      paymentsDeps
    );
  }

  return nextSettings;
}

/**
 * Condona el recargo ya acumulado de toda obligación abierta (no saldada, no
 * anulada) que hoy tenga un recargo realmente vigente (`surchargeAmount >
 * 0`) — obligaciones al día o ya condonadas se saltean sin generar una
 * condonación redundante. Una única `applyPaymentsMutation` agrega TODAS las
 * condonaciones de una vez: atómica, con rollback completo si cualquiera
 * fallara la validación (nunca deja una condonación aplicada y otra no).
 */
async function clearCurrentlyAccruedSurcharges(
  input: { now: Date; reason: string; surchargeSettings: SurchargeSettings },
  deps: PaymentsServiceDepsForSurcharge
): Promise<void> {
  await deps.hydrate();
  const todayDateKey = resolveTodayDateKey(input.now);
  const nowIso = input.now.toISOString();

  await deps.applyMutation((current) => {
    const chargesNeedingClearing = current.charges.filter((charge) => {
      if (charge.voidedAt !== null) return false;
      if (isSurchargeWaivedForCharge(charge.id, current.adjustments)) return false;
      const chargeState = calculateChargeState({
        charge,
        allocations: current.allocations,
        payments: current.payments,
        adjustments: current.adjustments,
        evaluationDate: todayDateKey,
        surchargeSettings: input.surchargeSettings,
      });
      return chargeState.settledAt === null && chargeState.surchargeAmount > 0;
    });

    if (chargesNeedingClearing.length === 0) return current;

    const newAdjustments = chargesNeedingClearing.map((charge, index) =>
      buildAdjustment({
        id: `surcharge_clear_${charge.id}_${input.now.getTime()}_${index}`,
        chargeId: charge.id,
        studentId: charge.studentId,
        reason: input.reason,
        createdAt: nowIso,
      })
    );

    return { ...current, adjustments: [...current.adjustments, ...newAdjustments] };
  });
}
