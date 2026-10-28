// Puerto VERBATIM del original (`src/features/payments/services/__tests__/surchargeSettingsService.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { createSurchargeSettingsStoreController, type SurchargeSettingsPersistenceAdapter } from '../../hooks/surchargeSettingsStore.ts';
import { saveSurchargeTierValues, type PaymentsServiceDepsForSurcharge, type SurchargeSettingsServiceDeps } from '../surchargeSettingsService.ts';
import { calculateChargeState } from '../../utils/paymentCalculations.ts';
import { DEFAULT_SURCHARGE_SETTINGS, DEFAULT_SURCHARGE_TIER_VALUES, resolveEffectiveSurchargeTierValues, type SurchargeSettingsVigencia } from '../../utils/surchargeSettings.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora") + corrección
 * 2026-08-13 (a pedido de Joaquín — corrección visual: el switch flotante
 * se quitó del menú; `saveSurchargeTierValues` pasó a ser el ÚNICO punto de
 * guardado, guardando `enabled` + días + porcentajes + vigencia juntos, ya
 * que ahora hay un solo punto de entrada en la UI — el panel). Pruebas de
 * orquestación del servicio, con adaptadores en memoria (nunca AsyncStorage
 * real). Cubre los casos 10-14, 16-17, 25-26 y 28 del pedido.
 */

function makeSurchargeDeps(initial = DEFAULT_SURCHARGE_SETTINGS): { deps: SurchargeSettingsServiceDeps } {
  const store = { persisted: initial };
  const adapter: SurchargeSettingsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (settings) => {
      store.persisted = settings;
    },
  };
  const controller = createSurchargeSettingsStoreController(adapter);
  return { deps: { hydrate: controller.hydrate, applyMutation: controller.applyMutation, getSnapshot: controller.getSnapshot } };
}

function monthlyCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge-1',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 10000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function makePaymentsDeps(initial: PaymentsRepositoryState = emptyPaymentsState()): {
  deps: PaymentsServiceDepsForSurcharge;
  store: { persisted: PaymentsRepositoryState };
} {
  const store = { persisted: initial };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state) => {
      store.persisted = state;
    },
  };
  const controller = createPaymentsStoreController(adapter);
  return {
    deps: { hydrate: controller.hydrate, applyMutation: controller.applyMutation, getSnapshot: controller.getSnapshot },
    store,
  };
}

const JULY_15 = new Date('2026-07-15T12:00:00.000Z'); // Buenos Aires: 09:00, 15/07

/** Atajo: guarda sólo cambiando `enabled`, conservando los días/porcentajes por defecto — mismo caso de uso que el switch del panel. */
function toggleEnabled(
  enabled: boolean,
  deps: SurchargeSettingsServiceDeps,
  options: { vigencia?: SurchargeSettingsVigencia; clearCurrentSurcharges?: boolean; now?: Date; paymentsDeps?: PaymentsServiceDepsForSurcharge } = {}
) {
  return saveSurchargeTierValues(
    {
      nextValues: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled },
      vigencia: options.vigencia ?? 'current_month',
      clearCurrentSurcharges: options.clearCurrentSurcharges,
      now: options.now ?? JULY_15,
    },
    deps,
    options.paymentsDeps
  );
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): los casos 10-13 originales probaban que
// `saveSurchargeTierValues({ enabled: true })` realmente activaba recargos
// — esa posibilidad ya no existe, sin importar la vigencia elegida.
// `saveSurchargeTierValues` en sí ya no tiene ningún punto de entrada real
// en la UI (se quitó de `LogoMenuSheet.tsx`), pero se conserva como función
// pura/servicio para no reescribir toda la infraestructura de guardado — la
// prueba real que importa ahora es que, aunque alguien la llamara con
// `enabled: true` (a mano, por error, o desde un dispositivo con un cliente
// viejo), el resultado JAMÁS resuelve a `enabled: true` — el sanitizador
// central (`resolveEffectiveSurchargeTierValues`) lo impide siempre.
// ---------------------------------------------------------------------------

asyncTest('caso 10 — "activar" desde el mes actual nunca activa nada: la regla central lo normaliza a desactivado igual', async () => {
  const disabled = { current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false }, pending: null, pendingEffectiveFrom: null };
  const { deps } = makeSurchargeDeps(disabled);
  const result = await toggleEnabled(true, deps);
  assertEqual(resolveEffectiveSurchargeTierValues(result, '2026-07').enabled, false, 'julio nunca queda con recargos activados, ni pidiéndolo explícitamente');
});

asyncTest('caso 11 — "activar" desde el próximo mes tampoco activa nada en ningún período', async () => {
  const disabled = { current: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false }, pending: null, pendingEffectiveFrom: null };
  const { deps } = makeSurchargeDeps(disabled);
  const result = await toggleEnabled(true, deps, { vigencia: 'next_month' });
  assertEqual(resolveEffectiveSurchargeTierValues(result, '2026-07').enabled, false, 'julio sigue desactivado');
  assertEqual(resolveEffectiveSurchargeTierValues(result, '2026-08').enabled, false, 'agosto tampoco se activa, aunque se haya pedido explícitamente');
});

asyncTest('caso 12 — desactivar desde el mes actual: rige de inmediato para el mes en curso (ya era el único estado posible)', async () => {
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const result = await toggleEnabled(false, deps);
  assertEqual(resolveEffectiveSurchargeTierValues(result, '2026-07').enabled, false, 'julio usa la configuración desactivada');
});

asyncTest('caso 13 — desactivar desde el próximo mes: ambos períodos quedan desactivados (nunca hay un período intermedio con recargos)', async () => {
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const result = await toggleEnabled(false, deps, { vigencia: 'next_month' });
  assertEqual(resolveEffectiveSurchargeTierValues(result, '2026-07').enabled, false, 'julio nunca tiene recargos activados');
  assertEqual(resolveEffectiveSurchargeTierValues(result, '2026-08').enabled, false, 'agosto tampoco');
});

// ---------------------------------------------------------------------------
// Caso 14: quitar recargos vigentes — condona el recargo YA acumulado de
// las obligaciones abiertas, sin tocar originalAmount/pagos/asignaciones.
// ---------------------------------------------------------------------------

// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada): el caso 14 original probaba que "Quitar recargos vigentes"
// condonaba un recargo YA ACUMULADO ($1000, first_late) — ese recargo ya no
// puede existir nunca (`calculateSurchargeAmount` siempre 0), así que
// `clearCurrentlyAccruedSurcharges` nunca encuentra nada que condonar
// (`chargeState.surchargeAmount > 0` nunca es cierto). El principal sigue
// intacto porque nunca hubo nada que tocar, no porque se haya condonado algo.
asyncTest('caso 14 — "Quitar recargos vigentes" nunca condona nada (nunca hay recargo acumulado que condonar), principal intacto', async () => {
  const charge = monthlyCharge(); // dueDate 2026-07-01
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const { deps: paymentsDeps, store: paymentsStore } = makePaymentsDeps({
    charges: [charge],
    payments: [],
    allocations: [],
    adjustments: [],
  });

  // El 15/7 el cargo está en first_late (mora visual) — pero sin recargo automático que condonar.
  await toggleEnabled(false, deps, { clearCurrentSurcharges: true, paymentsDeps });

  assertEqual(paymentsStore.persisted.adjustments.length, 0, 'no hay ningún recargo acumulado que condonar — nunca se crea una condonación');
  assertEqual(paymentsStore.persisted.charges[0].originalAmount, 10000, 'el importe original NUNCA cambia');
  assertEqual(paymentsStore.persisted.payments.length, 0, 'nunca modifica pagos (no había ninguno)');

  const recomputed = calculateChargeState({
    charge: paymentsStore.persisted.charges[0],
    allocations: paymentsStore.persisted.allocations,
    payments: paymentsStore.persisted.payments,
    adjustments: paymentsStore.persisted.adjustments,
    evaluationDate: '2026-07-15',
  });
  assertEqual(recomputed.balance, 10000, 'el saldo queda exactamente en el importe original, sin recargo');
});

asyncTest('"Desde ahora" (sin clearCurrentSurcharges) nunca condona nada — el recargo ya generado en el mes actual sigue existiendo hasta que se recalcula solo', async () => {
  const charge = monthlyCharge();
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const { deps: paymentsDeps, store: paymentsStore } = makePaymentsDeps({
    charges: [charge],
    payments: [],
    allocations: [],
    adjustments: [],
  });

  await toggleEnabled(false, deps, { paymentsDeps });

  assertEqual(paymentsStore.persisted.adjustments.length, 0, '"Desde ahora" nunca crea condonaciones');
});

// ---------------------------------------------------------------------------
// Caso 16: cambio consecutivo del interruptor.
// ---------------------------------------------------------------------------

asyncTest('caso 16 — cambio consecutivo del interruptor (off, luego "on") deja el resultado final SIEMPRE desactivado, sin corrupción', async () => {
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  await toggleEnabled(false, deps);
  const finalResult = await toggleEnabled(true, deps);
  assertEqual(resolveEffectiveSurchargeTierValues(finalResult, '2026-07').enabled, false, 'ni el último cambio ("activar") puede dejar recargos activados — la regla central siempre gana');
});

// ---------------------------------------------------------------------------
// Casos 17 y 26: doble toque / ausencia total de duplicados — dos llamadas
// concurrentes a "Quitar recargos vigentes" nunca generan dos condonaciones
// para el mismo cargo (la cola interna de cada store serializa las mutaciones).
// ---------------------------------------------------------------------------

asyncTest('casos 17/26 — doble toque en "Quitar recargos vigentes": nunca genera ninguna condonación (nunca hay recargo que condonar)', async () => {
  const charge = monthlyCharge();
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const { deps: paymentsDeps, store: paymentsStore } = makePaymentsDeps({
    charges: [charge],
    payments: [],
    allocations: [],
    adjustments: [],
  });

  // Dos toques "simultáneos" (sin esperar el primero antes de disparar el segundo).
  await Promise.all([
    toggleEnabled(false, deps, { clearCurrentSurcharges: true, paymentsDeps }),
    toggleEnabled(false, deps, { clearCurrentSurcharges: true, paymentsDeps }),
  ]);

  assertEqual(paymentsStore.persisted.adjustments.length, 0, 'ningún toque genera condonación — nunca hay recargo acumulado que condonar');
});

// ---------------------------------------------------------------------------
// Caso 25: varios alumnos simultáneamente.
// ---------------------------------------------------------------------------

asyncTest('caso 25 — "Quitar recargos vigentes" con varios alumnos: ninguno recibe condonación (nunca hay recargo que condonar), ninguno se ve afectado', async () => {
  const charges: PaymentCharge[] = [
    monthlyCharge({ id: 'charge-s1', studentId: 's1' }),
    monthlyCharge({ id: 'charge-s2', studentId: 's2' }),
    monthlyCharge({ id: 'charge-s3', studentId: 's3' }),
  ];
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const { deps: paymentsDeps, store: paymentsStore } = makePaymentsDeps({
    charges,
    payments: [],
    allocations: [],
    adjustments: [],
  });

  await toggleEnabled(false, deps, { clearCurrentSurcharges: true, paymentsDeps });

  assertEqual(paymentsStore.persisted.adjustments.length, 0, 'ningún alumno tiene recargo acumulado que condonar');
});

// ---------------------------------------------------------------------------
// Caso 28: la configuración de una profesora nunca afecta otra cuenta.
// ---------------------------------------------------------------------------

asyncTest('caso 28 — dos instancias del store (dos cuentas/identidades qa_* distintas) están completamente aisladas', async () => {
  const { deps: teacherADeps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const { deps: teacherBDeps } = makeSurchargeDeps({
    current: { ...DEFAULT_SURCHARGE_TIER_VALUES, firstLatePercentage: 42 },
    pending: null,
    pendingEffectiveFrom: null,
  });

  await toggleEnabled(false, teacherADeps);

  await teacherBDeps.hydrate();
  const teacherBSnapshot = teacherBDeps.getSnapshot();
  const teacherBEffective = resolveEffectiveSurchargeTierValues(teacherBSnapshot, '2026-07');
  assertEqual(
    teacherBEffective.firstLatePercentage,
    42,
    'la cuenta B nunca ve el cambio hecho en la cuenta A — cada store es independiente, sin estado global compartido'
  );
  assertEqual(teacherBEffective.enabled, false, 'y de cualquier forma, ninguna cuenta puede tener recargos activados — la regla central es universal');
});

// ---------------------------------------------------------------------------
// Caso 18 (a nivel de servicio): si la mutación de configuración falla, la
// condonación de "Quitar recargos vigentes" nunca llega a intentarse.
// ---------------------------------------------------------------------------

asyncTest('caso 18 (servicio) — si falla la escritura de la configuración, nunca se llega a condonar nada', async () => {
  const charge = monthlyCharge();
  let shouldFail = true;
  const settingsAdapter: SurchargeSettingsPersistenceAdapter = {
    readAll: async () => DEFAULT_SURCHARGE_SETTINGS,
    writeAll: async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('fallo simulado de persistencia');
      }
    },
  };
  const settingsController = createSurchargeSettingsStoreController(settingsAdapter);
  const deps: SurchargeSettingsServiceDeps = {
    hydrate: settingsController.hydrate,
    applyMutation: settingsController.applyMutation,
    getSnapshot: settingsController.getSnapshot,
  };
  const { deps: paymentsDeps, store: paymentsStore } = makePaymentsDeps({
    charges: [charge],
    payments: [],
    allocations: [],
    adjustments: [],
  });

  let rejected = false;
  try {
    await toggleEnabled(false, deps, { clearCurrentSurcharges: true, paymentsDeps });
  } catch {
    rejected = true;
  }

  assert(rejected, 'el fallo de persistencia se propaga');
  assertEqual(paymentsStore.persisted.adjustments.length, 0, 'nunca se intenta condonar si la configuración no llegó a guardarse');
});

// ---------------------------------------------------------------------------
// saveSurchargeTierValues (panel completo, único punto de guardado): guarda
// enabled + días/porcentajes + vigencia juntos, en una única llamada.
// ---------------------------------------------------------------------------

asyncTest('saveSurchargeTierValues guarda los días/porcentajes nuevos, pero "enabled" siempre queda desactivado (nunca lo que se pidió)', async () => {
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const result = await saveSurchargeTierValues(
    {
      nextValues: {
        enabled: true,
        graceDay: 5,
        firstLateDay: 6,
        firstLatePercentage: 8,
        secondLateDay: 15,
        secondLatePercentage: 12,
        lastLateDay: 22,
        lastLatePercentage: 18,
      },
      vigencia: 'current_month',
      now: JULY_15,
    },
    deps
  );
  const effective = resolveEffectiveSurchargeTierValues(result, '2026-07');
  assertEqual(effective.enabled, false, 'aunque se pida enabled: true, la regla central lo normaliza a desactivado');
  assertEqual(effective.graceDay, 5, 'el día base nuevo sí se aplica (mora visual)');
  assertEqual(effective.firstLatePercentage, 8, 'el porcentaje queda guardado (aunque ya nunca se use para calcular dinero)');
});

asyncTest('saveSurchargeTierValues puede desactivar y cambiar días/porcentajes en la misma llamada', async () => {
  const { deps } = makeSurchargeDeps(DEFAULT_SURCHARGE_SETTINGS);
  const result = await saveSurchargeTierValues(
    {
      nextValues: { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: false, graceDay: 5 },
      vigencia: 'current_month',
      now: JULY_15,
    },
    deps
  );
  const effective = resolveEffectiveSurchargeTierValues(result, '2026-07');
  assertEqual(effective.enabled, false, 'el switch se guarda desactivado');
  assertEqual(effective.graceDay, 5, 'el día base también se guarda, en la misma llamada');
});
