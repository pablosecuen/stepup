// Puerto VERBATIM del original (`src/features/payments/utils/monthlyAmountCorrection.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState, PaymentCharge } from '../types/index.ts';
import { firstDayOfBillingPeriod, isValidBillingPeriod, nextBillingPeriod } from './paymentDates.ts';
import { buildMonthlyChargeId } from './paymentIdempotency.ts';
import { buildMonthlyCharge } from './paymentMutations.ts';

/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual): reemplaza la corrección de monto mensual
 * anterior (que sólo sabía aplicar "desde este mes", sin distinguir un
 * cargo ya saldado de uno con pago parcial) por una versión con vigencia
 * explícita — "Aplicar desde este mes" / "Aplicar desde el próximo mes" —
 * y las dos protecciones que faltaban: nunca reescribe silenciosamente un
 * período ya cerrado (saldo $0), y nunca reduce el importe por debajo de lo
 * que ya se asignó (eso generaría saldo a favor, algo que el dominio nunca
 * admite en ningún otro flujo). Sigue siendo la ÚNICA función que toca
 * `PaymentCharge.originalAmount` — nunca toca `payments` ni `allocations`.
 *
 * Corrección 2026-08-10 (a pedido de Joaquín — REGRESIÓN CRÍTICA: la cuota
 * nueva no actualizaba el cargo abierto): "este mes" sin cargo vigente
 * todavía ANTES sólo actualizaba el importe efectivo del plan y esperaba a
 * que el próximo ciclo automático de generación mensual terminara de crear
 * el cargo — mientras tanto, "Registrar pago" no tenía NINGÚN cargo del
 * período actual con el importe nuevo (podía mostrar una deuda vieja de un
 * período anterior en su lugar, dando la falsa impresión de que la cuota
 * "no se actualizó"). Ahora, si la vigencia es "este mes" y todavía no
 * existe un cargo para el período, se CREA en el acto con el importe
 * nuevo — exactamente como si lo hubiera creado la generación automática,
 * nunca un cargo paralelo. `chargeCreated` distingue este caso de
 * "actualizado in place" para que el rollback (ver
 * `monthlyAmountCorrectionService.ts`) sepa si debe RETIRAR el cargo
 * (nunca existió antes de esta llamada) o sólo revertir su importe.
 *
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO GENERAL: cuota
 * mensual y obligación desincronizadas, cualquier alumno/monto/período): la
 * corrección de arriba todavía buscaba el cargo del período EXCLUSIVAMENTE
 * por `buildMonthlyChargeId(studentId, currentBillingPeriod)`. Un cargo
 * mensual real (mismo alumno, mismo período, `type: 'mensual'`,
 * `voidedAt: null`) creado por una versión anterior del sistema — o por
 * cualquier otro camino que no haya usado ese id determinístico exacto —
 * queda invisible para esa búsqueda: la función entraba a la rama "sin
 * cargo vigente" y CREABA un segundo cargo con el importe nuevo, dejando el
 * cargo real (viejo, con el importe anterior) intacto y sin anular —
 * "Registrar pago" seguía viendo el cargo viejo. Ahora la identidad del
 * cargo vigente se resuelve por SEMÁNTICA (alumno + `mensual` + período +
 * no anulado, ver `existingCharge` más abajo) — la misma búsqueda que ya
 * hacía `monthlyAmountCorrectionService.ts` para `currentChargeState`, pero
 * antes se desperdiciaba porque esta función volvía a buscar por id.
 * `buildMonthlyChargeId` sigue siendo el id que se ASIGNA cuando de verdad
 * no existe ningún cargo del período (nunca se inventa un id para un cargo
 * que ya existe) — nunca se exige que un cargo real coincida con ese id
 * para poder corregirlo.
 */
export type MonthlyAmountChangeEffectiveFrom = 'this_month' | 'next_month';

export interface MonthlyAmountChangePlanPatch {
  /** `undefined` cuando el cambio es "próximo mes": el importe efectivo actual no cambia. */
  amount?: number;
  /** `undefined` cuando el cambio es "este mes": no queda ningún cambio pendiente. */
  pendingAmount?: number;
  pendingAmountEffectiveFrom?: string;
}

export interface MonthlyAmountChangePlan {
  chargeId: string;
  /** El cargo del período actual cambió en el store de pagos (se actualizó in place, o se creó recién ahora). */
  chargeUpdated: boolean;
  /** El cargo del período actual NO existía y se creó recién ahora, con el importe nuevo — nunca existió antes de esta llamada. */
  chargeCreated: boolean;
  previousChargeAmount: number | null;
  newAmount: number;
  effectiveFrom: MonthlyAmountChangeEffectiveFrom;
  /** Cargos resultantes — igual a los recibidos si `chargeUpdated` es false. Nunca duplica un cargo existente. */
  updatedCharges: PaymentCharge[];
  /** Qué escribir en `MonthlyBillingPlan` — ver `resolveEffectiveMonthlyAmount`. */
  planPatch: MonthlyAmountChangePlanPatch;
}

export function planMonthlyAmountChange(input: {
  studentId: string;
  currentBillingPeriod: string; // YYYY-MM, hoy (AR)
  newAmount: number;
  effectiveFrom: MonthlyAmountChangeEffectiveFrom;
  existingCharges: PaymentCharge[];
  /**
   * El cargo mensual VIGENTE del período, resuelto por el llamador por
   * IDENTIDAD SEMÁNTICA (mismo studentId, `type: 'mensual'`, mismo
   * billingPeriod, `voidedAt: null`) — nunca por su id. Puede tener
   * cualquier id real, determinístico o no (cargos creados por una versión
   * anterior del sistema, o por cualquier otro camino). `null` sólo cuando
   * de verdad no existe ninguna obligación mensual vigente para ese alumno
   * y período. Esta función NUNCA vuelve a buscar por su cuenta —
   * `existingCharge` es la única fuente de verdad sobre si el cargo existe.
   */
  existingCharge: PaymentCharge | null;
  /** Estado calculado de `existingCharge` (mismo cargo, `null` si `existingCharge` es `null`). */
  currentChargeState: ChargeComputedState | null;
  /** ISO — sólo se usa si hace falta CREAR el cargo del período (vigencia "este mes", sin cargo todavía). */
  createdAt: string;
}): MonthlyAmountChangePlan {
  const { studentId, currentBillingPeriod, newAmount, effectiveFrom, existingCharges, existingCharge, currentChargeState, createdAt } = input;

  if (!studentId || !studentId.trim()) {
    throw new Error('Se necesita un alumno válido para cambiar el monto mensual.');
  }
  if (!isValidBillingPeriod(currentBillingPeriod)) {
    throw new RangeError('El período facturado debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  if (!Number.isFinite(newAmount) || !Number.isInteger(newAmount) || newAmount <= 0) {
    throw new RangeError('El nuevo importe mensual debe ser un número entero positivo.');
  }
  if (
    existingCharge &&
    (existingCharge.studentId !== studentId ||
      existingCharge.type !== 'mensual' ||
      existingCharge.billingPeriod !== currentBillingPeriod ||
      existingCharge.voidedAt !== null)
  ) {
    // Defensivo: si el llamador se equivocó de cargo, mejor lanzar acá que
    // corregir silenciosamente la obligación de otro alumno o período.
    throw new Error('El cargo provisto no corresponde al mismo alumno, tipo, período vigente y no anulado.');
  }

  const existing = existingCharge;
  const chargeId = existing ? existing.id : buildMonthlyChargeId(studentId, currentBillingPeriod);

  if (effectiveFrom === 'next_month') {
    // Nunca toca el cargo del período actual (ni siquiera si existe): el
    // nuevo importe queda pendiente hasta que empiece el próximo período.
    return {
      chargeId,
      chargeUpdated: false,
      chargeCreated: false,
      previousChargeAmount: existing?.originalAmount ?? null,
      newAmount,
      effectiveFrom,
      updatedCharges: existingCharges,
      planPatch: {
        pendingAmount: newAmount,
        pendingAmountEffectiveFrom: nextBillingPeriod(currentBillingPeriod),
      },
    };
  }

  // effectiveFrom === 'this_month'
  if (!existing) {
    // De verdad no existe ningún cargo mensual vigente para este alumno y
    // período (búsqueda semántica del llamador, no por id): se crea EN EL
    // ACTO con el importe nuevo — nunca se deja la corrección a mitad de
    // camino esperando el próximo ciclo automático (ver corrección
    // 2026-08-10 arriba). Usa el id determinístico porque es un cargo
    // realmente nuevo — `buildMonthlyCharge` sigue siendo idempotente por
    // ese id, así que esto nunca puede colisionar con un cargo que la
    // generación automática cree después para el mismo período.
    const newCharge = buildMonthlyCharge({
      studentId,
      billingPeriod: currentBillingPeriod,
      dueDate: firstDayOfBillingPeriod(currentBillingPeriod),
      originalAmount: newAmount,
      createdAt,
      existingCharges,
    });
    return {
      chargeId: newCharge.id,
      chargeUpdated: true,
      chargeCreated: true,
      previousChargeAmount: null,
      newAmount,
      effectiveFrom,
      updatedCharges: [...existingCharges, newCharge],
      planPatch: { amount: newAmount, pendingAmount: undefined, pendingAmountEffectiveFrom: undefined },
    };
  }

  if (currentChargeState && currentChargeState.balance <= 0) {
    // PARTE 2.D — mes cerrado: nunca se reescribe silenciosamente un
    // período ya saldado. La profesora puede seguir aplicando el cambio
    // desde el próximo mes; una corrección histórica es un flujo aparte,
    // explícito y auditable (no este).
    throw new Error(
      'Este período ya está pagado en su totalidad — no se puede modificar retroactivamente. Elegí "Aplicar desde el próximo mes".'
    );
  }

  if (currentChargeState && currentChargeState.paidAmount > newAmount) {
    // PARTE 2.C — reducir por debajo de lo ya asignado generaría saldo a
    // favor, algo que el dominio nunca admite en ningún otro flujo
    // (`allocatePayment`/`planPaymentRegistration` lo rechazan siempre).
    throw new Error(
      `Ya se asignaron ${currentChargeState.paidAmount} a este período — el nuevo importe no puede ser menor a lo ya pagado. Elegí "Aplicar desde el próximo mes" o un importe mayor o igual a lo ya asignado.`
    );
  }

  return {
    chargeId,
    chargeUpdated: true,
    chargeCreated: false,
    previousChargeAmount: existing.originalAmount,
    newAmount,
    effectiveFrom,
    updatedCharges: existingCharges.map((charge) =>
      charge.id === chargeId ? { ...charge, originalAmount: newAmount } : charge
    ),
    planPatch: { amount: newAmount, pendingAmount: undefined, pendingAmountEffectiveFrom: undefined },
  };
}
