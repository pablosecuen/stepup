// Puerto VERBATIM del original (`src/features/payments/utils/initialMonthlyBillingPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
 * "situación del primer mes" de un alumno mensual, y su reutilización como
 * "marcar el mes actual como pagado" para un alumno mensual que ya existía
 * antes de esta corrección. UNA sola función pura cubre los dos casos —
 * nunca un segundo motor paralelo: reusa exactamente `buildMonthlyCharge`,
 * `recordPayment` y `allocatePayment` del dominio financiero existente.
 *
 * Idempotencia: si ya existe una obligación mensual vigente para
 * (studentId, billingPeriod), esta función NUNCA crea una segunda — la
 * reutiliza. Si esa obligación ya está saldada y se pide 'paid' de nuevo,
 * `allocatePayment` calcula una capacidad segura de 0 y rechaza la
 * asignación (mismo motivo con el que ya rechaza cualquier sobreasignación)
 * — así "marcar como pagado" dos veces nunca duplica un pago, se rechaza
 * con un error claro.
 */
import type { Payment, PaymentAllocation, PaymentCharge, PaymentMethod, PaymentsRepositoryState } from '../types/index.ts';
import { allocatePayment, buildMonthlyCharge, recordPayment } from './paymentMutations.ts';
import { buildDatedAllocationsForCharge, calculateSafeAllocationCapacity, isSurchargeWaivedForCharge } from './paymentCalculations.ts';
import { nextBillingPeriod, resolveMonthlyDueDate } from './paymentDates.ts';
import { DEFAULT_MONTHLY_DUE_DAY } from '../../student-profile/utils/studentBillingPlan.ts';

export type FirstMonthSituation = 'paid' | 'pending' | 'starts_next_month';

export interface EnsureMonthlyChargeSituationInput {
  studentId: string;
  situation: FirstMonthSituation;
  /** Importe mensual vigente — sólo se usa si hace falta CREAR la obligación del período. */
  amount: number;
  /** Período actual (AR), 'YYYY-MM'. */
  billingPeriod: string;
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
   * mensualidades "Mes vencido" al comenzar el mes): día real de vencimiento
   * del alumno (`MonthlyBillingPlan.dueDay`) — sólo se usa si hace falta
   * CREAR la obligación del período (`resolveMonthlyDueDate`, única
   * fuente). Opcional, default `DEFAULT_MONTHLY_DUE_DAY` (10).
   */
  dueDay?: number;
  /**
   * Fecha propuesta de pago (YYYY-MM-DD) — sólo para 'paid'. Por defecto,
   * hoy (la resuelve el llamador). Corrección 2026-08-02: esta función
   * nunca la usa tal cual si cae después del vencimiento — la "situación
   * inicial declarada" nunca puede leerse como una mora real, ver el
   * clamp contra `charge.dueDate` más abajo.
   */
  paidAt: string;
  /**
   * Corrección 2026-08-16 (a pedido de Joaquín — Fase 4/5, corrección
   * integral post-simulación): el clamp de `paidAt` de más abajo (nunca
   * posterior al vencimiento) existe SÓLO para la declaración de
   * "situación del primer mes" en el alta de un alumno — ahí `paidAt` es
   * ambiguo por diseño (la profesora declara "ya pagó" sin necesariamente
   * conocer/elegir la fecha real). Para "Marcar mes actual como pagado" de
   * un alumno YA EXISTENTE (`markCurrentMonthAsPaid`), en cambio, `paidAt`
   * SÍ es la fecha real de la confirmación — si hoy es genuinamente
   * posterior al vencimiento, el recargo DEBE aplicarse, exactamente como
   * ya lo muestra `resolveSuggestedMonthlyPaymentAmount` en la vista previa
   * (antes NO se distinguían los dos casos: un alumno realmente vencido que
   * se marcaba como pagado hoy quedaba registrado como "en término", sin
   * el recargo que la propia vista previa ya le había mostrado a la
   * profesora un instante antes). `true` (default) conserva el
   * comportamiento exacto de siempre para el alta; `markCurrentMonthAsPaid`
   * pasa `false` explícitamente.
   */
  clampPaidAtToDueDate?: boolean;
  method: PaymentMethod;
  todayDateKey: string;
  /** ISO — instante en el que se crea el cargo/pago. */
  createdAt: string;
  /** ISO — instante en el que se registra el pago (puede ser el mismo que createdAt). */
  recordedAt: string;
  notes?: string;
  chargeId: string;
  paymentId: string;
  allocationId: string;
  /** Estado financiero completo ya persistido — nunca un snapshot parcial. */
  state: PaymentsRepositoryState;
}

export interface EnsureMonthlyChargeSituationResult {
  /**
   * Período a partir del cual el plan de este alumno debe generar
   * obligaciones futuras: el actual para 'paid'/'pending', el siguiente
   * para 'starts_next_month'. El llamador lo persiste como
   * `MonthlyBillingPlan.startPeriod` cuando corresponde (ver
   * `resolveStudentBillingPlan`/`runMonthlyChargeGeneration`).
   */
  billingPeriodStart: string;
  /** La obligación del mes actual, sólo si esta llamada tuvo que CREARLA (null si ya existía o si `situation` es 'starts_next_month'). */
  chargeToCreate: PaymentCharge | null;
  /** null salvo en 'paid'. */
  payment: Payment | null;
  /** null salvo en 'paid'. */
  allocation: PaymentAllocation | null;
}

export function planEnsureMonthlyChargeSituation(
  input: EnsureMonthlyChargeSituationInput
): EnsureMonthlyChargeSituationResult {
  const existingCharge = input.state.charges.find(
    (charge) =>
      charge.studentId === input.studentId &&
      charge.type === 'mensual' &&
      charge.billingPeriod === input.billingPeriod &&
      charge.voidedAt === null
  );

  if (input.situation === 'starts_next_month') {
    if (existingCharge) {
      throw new Error(
        'Ya existe una obligación mensual para el mes actual: no corresponde marcar "comienza a pagar el mes siguiente".'
      );
    }
    return {
      billingPeriodStart: nextBillingPeriod(input.billingPeriod),
      chargeToCreate: null,
      payment: null,
      allocation: null,
    };
  }

  let chargeToCreate: PaymentCharge | null = null;
  let charge = existingCharge ?? null;
  if (!charge) {
    charge = buildMonthlyCharge({
      studentId: input.studentId,
      billingPeriod: input.billingPeriod,
      dueDate: resolveMonthlyDueDate(input.billingPeriod, input.dueDay ?? DEFAULT_MONTHLY_DUE_DAY),
      originalAmount: input.amount,
      createdAt: input.createdAt,
      existingCharges: input.state.charges,
    });
    chargeToCreate = charge;
  }

  if (input.situation === 'pending') {
    return {
      billingPeriodStart: input.billingPeriod,
      chargeToCreate,
      payment: null,
      allocation: null,
    };
  }

  // situation === 'paid'
  const stateWithCharge: PaymentsRepositoryState = chargeToCreate
    ? { ...input.state, charges: [...input.state.charges, chargeToCreate] }
    : input.state;

  // Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
  // nuevos): causa raíz real del recargo incorrecto — antes se usaba
  // `input.paidAt` tal cual (por defecto, "hoy"), así que un alta cerca de
  // fin de mes quedaba con un `paidAt` muy posterior al `dueDate` (día 1 del
  // mes facturado), y `determineMonthlyDueStage` la clasificaba como
  // vencida (`last_late`) pese a que la profesora la declaró pagada. "El
  // alta de un alumno y la carga de su situación inicial no representan
  // necesariamente la fecha real en la que pagó" — así que para ESTA
  // declaración puntual (nunca para un pago normal registrado desde
  // "Registrar pago", que sí usa la fecha real elegida por la profesora) el
  // `paidAt` efectivo nunca puede ser posterior al vencimiento: si
  // `input.paidAt` es posterior, se usa `charge.dueDate` en su lugar
  // (siempre "en término" por construcción, sin inventar una fecha de pago
  // "observada" que nunca ocurrió).
  const shouldClamp = input.clampPaidAtToDueDate ?? true;
  const safePaidAt = shouldClamp && input.paidAt > charge.dueDate ? charge.dueDate : input.paidAt;

  // Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente
  // el flujo financiero mensual): causa raíz real del importe rechazado —
  // `input.amount` (el precio VIGENTE DEL PLAN en el momento de llamar) se
  // usaba directo como importe del pago aunque ya existiera un cargo
  // materializado con un `originalAmount` DISTINTO (por ejemplo, el plan
  // subió de $185.000 a $192.000 después de generarse el cargo del mes:
  // "pagar completo" nunca puede significar "el precio del plan hoy", sino
  // el saldo REAL del cargo que se está saldando). Cuando el cargo YA
  // EXISTÍA (no lo creó esta misma llamada), el importe a pagar se deriva
  // SIEMPRE de su propia capacidad segura — la misma función que valida
  // `allocatePayment` más abajo — así esta función nunca puede terminar
  // proponiendo un importe que esa validación luego rechace. `input.amount`
  // sólo se usa para fijar el `originalAmount` de un cargo NUEVO (sin ese
  // riesgo: nace con ese importe, no puede haber divergido de sí mismo).
  const isWaived = isSurchargeWaivedForCharge(charge.id, stateWithCharge.adjustments);
  const existingDatedAllocations = buildDatedAllocationsForCharge(
    charge.id,
    stateWithCharge.allocations,
    stateWithCharge.payments
  );
  const amountToPay = chargeToCreate
    ? input.amount
    : calculateSafeAllocationCapacity(charge, existingDatedAllocations, safePaidAt, isWaived);

  if (amountToPay <= 0) {
    // Idempotencia: "marcar como pagado" dos veces (o sobre un cargo ya
    // saldado por otra vía) nunca duplica un pago — se rechaza con un
    // error claro en vez de registrar un pago de $0 o negativo.
    throw new Error('Este período ya está saldado — no hay saldo pendiente para registrar.');
  }

  const payment = recordPayment({
    id: input.paymentId,
    studentId: input.studentId,
    amount: amountToPay,
    method: input.method,
    paidAt: safePaidAt,
    recordedAt: input.recordedAt,
    todayDateKey: input.todayDateKey,
    notes: input.notes,
    source: 'initial_student_setup',
  });

  const stateWithPayment: PaymentsRepositoryState = {
    ...stateWithCharge,
    payments: [...stateWithCharge.payments, payment],
  };

  const allocation = allocatePayment({
    id: input.allocationId,
    paymentId: payment.id,
    chargeId: charge.id,
    amount: amountToPay,
    state: stateWithPayment,
  });

  return {
    billingPeriodStart: input.billingPeriod,
    chargeToCreate,
    payment,
    allocation,
  };
}
