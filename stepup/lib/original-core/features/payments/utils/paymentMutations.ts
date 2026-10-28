// Puerto VERBATIM del original (`src/features/payments/utils/paymentMutations.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  Payment,
  PaymentAdjustment,
  PaymentAllocation,
  PaymentCharge,
  PaymentChargeType,
  PaymentMethod,
  PaymentsRepositoryState,
} from '../types/index.ts';
import { buildDatedAllocationsForCharge, calculateSafeAllocationCapacity, isSurchargeWaivedForCharge } from './paymentCalculations.ts';
import { daysBetweenDateKeys, firstDayOfBillingPeriod, isValidDateKey, lastDayOfBillingPeriod, toDateKey } from './paymentDates.ts';
import type { SurchargeSettings } from './surchargeSettings.ts';
import { buildMonthlyChargeId, buildPackagePurchaseChargeId, buildPerClassChargeId, buildPeriodicChargeId, buildTrainingChargeId, chargeAlreadyExists } from './paymentIdempotency.ts';

const PAYMENT_METHODS = new Set<PaymentMethod>(['efectivo', 'transferencia', 'otro']);

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

// ---------------------------------------------------------------------------
// Cargos — idempotentes: crear dos veces la misma obligación lanza en vez
// de duplicar. Además validan forma: alumno/importe/fechas válidos y
// coherencia entre tipo de cargo y sus campos propios.
// ---------------------------------------------------------------------------

export function buildMonthlyCharge(input: {
  studentId: string;
  billingPeriod: string; // YYYY-MM
  /**
   * YYYY-MM-DD — día 1 del período por defecto para toda mensualidad
   * normal. Corrección (a pedido de Joaquín — primer mes proporcional):
   * puede ser CUALQUIER día real dentro del propio período (nunca fuera de
   * él) — únicamente el cargo del primer mes de un alumno incorporado a
   * una serie durante un mes ya comenzado usa esto, con
   * `dueDate = fecha efectiva de incorporación`, para que el motor de
   * recargos (`determineMonthlyDueStage`, que ya calcula todo relativo a
   * `dueDate`) nunca lo trate como moroso por días anteriores a su alta —
   * sin tocar ese motor.
   */
  dueDate: string;
  originalAmount: number;
  createdAt: string;
  existingCharges: PaymentCharge[];
  calendarLessonId?: string | null;
}): PaymentCharge {
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('El cargo necesita un alumno válido.');
  }
  if (!isPositiveFiniteNumber(input.originalAmount)) {
    throw new RangeError('El importe original del cargo debe ser un número positivo y finito.');
  }
  if (!isValidIsoInstant(input.createdAt)) {
    throw new RangeError('createdAt debe ser una fecha ISO válida.');
  }
  // `firstDayOfBillingPeriod`/`lastDayOfBillingPeriod` validan formato Y
  // rango de mes (01-12): un billingPeriod imposible como "2026-13" ya
  // lanza acá, antes de comparar con dueDate.
  const periodStart = firstDayOfBillingPeriod(input.billingPeriod);
  const periodEnd = `${input.billingPeriod}-${String(lastDayOfBillingPeriod(input.billingPeriod)).padStart(2, '0')}`;
  if (!isValidDateKey(input.dueDate) || input.dueDate < periodStart || input.dueDate > periodEnd) {
    throw new RangeError('El vencimiento de una mensualidad debe caer dentro del propio período facturado.');
  }

  const id = buildMonthlyChargeId(input.studentId, input.billingPeriod);
  if (chargeAlreadyExists(id, input.existingCharges)) {
    throw new Error('Ya existe una obligación mensual para este alumno y período.');
  }
  return {
    id,
    studentId: input.studentId,
    type: 'mensual',
    originalAmount: input.originalAmount,
    currency: 'ARS',
    dueDate: input.dueDate,
    createdAt: input.createdAt,
    billingPeriod: input.billingPeriod,
    calendarLessonId: input.calendarLessonId ?? null,
    voidedAt: null,
    voidReason: null,
  };
}

export function buildPerClassCharge(input: {
  studentId: string;
  savedLessonId: string;
  dueDate: string; // fecha de la clase, YYYY-MM-DD
  originalAmount: number;
  createdAt: string;
  existingCharges: PaymentCharge[];
  calendarLessonId?: string | null;
}): PaymentCharge {
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('El cargo necesita un alumno válido.');
  }
  if (!isPositiveFiniteNumber(input.originalAmount)) {
    throw new RangeError('El importe original del cargo debe ser un número positivo y finito.');
  }
  if (!isValidIsoInstant(input.createdAt)) {
    throw new RangeError('createdAt debe ser una fecha ISO válida.');
  }
  if (!isNonEmptyTrimmedString(input.savedLessonId)) {
    throw new Error('Un cargo por clase necesita la clase pedagógica que lo originó (savedLessonId).');
  }
  if (!isValidDateKey(input.dueDate)) {
    throw new RangeError('El vencimiento de un cargo por clase debe ser una fecha válida (YYYY-MM-DD).');
  }

  const id = buildPerClassChargeId(input.studentId, input.savedLessonId);
  if (chargeAlreadyExists(id, input.existingCharges)) {
    throw new Error('Ya existe una obligación para esta clase.');
  }
  return {
    id,
    studentId: input.studentId,
    type: 'por_clase' as PaymentChargeType,
    originalAmount: input.originalAmount,
    currency: 'ARS',
    dueDate: input.dueDate,
    createdAt: input.createdAt,
    savedLessonId: input.savedLessonId,
    calendarLessonId: input.calendarLessonId ?? null,
    voidedAt: null,
    voidReason: null,
  };
}

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): obligación semanal o quincenal — una por (alumno, período).
 * `periodKey`/`dueDate` ya vienen resueltos por el llamador
 * (`isoWeekKey`/`startOfIsoWeek` o `biweeklyPeriodKey`), esta función sólo
 * valida y construye, mismo patrón que `buildMonthlyCharge`.
 */
export function buildPeriodicCharge(input: {
  kind: 'semanal' | 'quincenal';
  studentId: string;
  periodKey: string;
  dueDate: string; // YYYY-MM-DD
  originalAmount: number;
  createdAt: string;
  existingCharges: PaymentCharge[];
  calendarLessonId?: string | null;
}): PaymentCharge {
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('El cargo necesita un alumno válido.');
  }
  if (!isPositiveFiniteNumber(input.originalAmount)) {
    throw new RangeError('El importe original del cargo debe ser un número positivo y finito.');
  }
  if (!isValidIsoInstant(input.createdAt)) {
    throw new RangeError('createdAt debe ser una fecha ISO válida.');
  }
  if (!isValidDateKey(input.dueDate)) {
    throw new RangeError('El vencimiento debe ser una fecha válida (YYYY-MM-DD).');
  }

  const id = buildPeriodicChargeId(input.kind, input.studentId, input.periodKey);
  if (chargeAlreadyExists(id, input.existingCharges)) {
    throw new Error(`Ya existe una obligación ${input.kind} para este alumno y período.`);
  }
  return {
    id,
    studentId: input.studentId,
    type: input.kind,
    originalAmount: input.originalAmount,
    currency: 'ARS',
    dueDate: input.dueDate,
    createdAt: input.createdAt,
    billingPeriod: input.periodKey,
    calendarLessonId: input.calendarLessonId ?? null,
    voidedAt: null,
    voidReason: null,
  };
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): obligación mensual de UNA serie de entrenamiento — una
 * por (acuerdo de la serie, alumno, período), nunca por (alumno, período) a
 * secas (eso fusionaría dos series distintas del mismo alumno, o la cuota
 * de entrenamiento con la mensualidad de clases). Mismo patrón de
 * validación/vencimiento que `buildMonthlyCharge` (vencimiento dentro del
 * propio período facturado).
 */
export function buildTrainingCharge(input: {
  studentId: string;
  trainingBillingAgreementId: string;
  trainingSeriesName: string;
  billingPeriod: string; // YYYY-MM
  dueDate: string;
  originalAmount: number;
  createdAt: string;
  existingCharges: PaymentCharge[];
  calendarLessonId?: string | null;
}): PaymentCharge {
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('El cargo necesita un alumno válido.');
  }
  if (!isNonEmptyTrimmedString(input.trainingBillingAgreementId)) {
    throw new Error('Un cargo de entrenamiento necesita la identidad estable del acuerdo de la serie.');
  }
  if (!isPositiveFiniteNumber(input.originalAmount)) {
    throw new RangeError('El importe original del cargo debe ser un número positivo y finito.');
  }
  if (!isValidIsoInstant(input.createdAt)) {
    throw new RangeError('createdAt debe ser una fecha ISO válida.');
  }
  const periodStart = firstDayOfBillingPeriod(input.billingPeriod);
  const periodEnd = `${input.billingPeriod}-${String(lastDayOfBillingPeriod(input.billingPeriod)).padStart(2, '0')}`;
  if (!isValidDateKey(input.dueDate) || input.dueDate < periodStart || input.dueDate > periodEnd) {
    throw new RangeError('El vencimiento de una cuota de entrenamiento debe caer dentro del propio período facturado.');
  }

  const id = buildTrainingChargeId(input.trainingBillingAgreementId, input.studentId, input.billingPeriod);
  if (chargeAlreadyExists(id, input.existingCharges)) {
    throw new Error('Ya existe una cuota de entrenamiento para este alumno, serie y período.');
  }
  return {
    id,
    studentId: input.studentId,
    type: 'entrenamiento',
    originalAmount: input.originalAmount,
    currency: 'ARS',
    dueDate: input.dueDate,
    createdAt: input.createdAt,
    billingPeriod: input.billingPeriod,
    trainingBillingAgreementId: input.trainingBillingAgreementId,
    trainingSeriesName: input.trainingSeriesName,
    calendarLessonId: input.calendarLessonId ?? null,
    voidedAt: null,
    voidReason: null,
  };
}

/** Obligación de COMPRA de un paquete de clases — una por (alumno, paquete). */
export function buildPackagePurchaseCharge(input: {
  studentId: string;
  packageId: string;
  dueDate: string; // YYYY-MM-DD — fecha de la compra
  originalAmount: number;
  createdAt: string;
  existingCharges: PaymentCharge[];
}): PaymentCharge {
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('El cargo necesita un alumno válido.');
  }
  if (!isPositiveFiniteNumber(input.originalAmount)) {
    throw new RangeError('El importe original del cargo debe ser un número positivo y finito.');
  }
  if (!isValidIsoInstant(input.createdAt)) {
    throw new RangeError('createdAt debe ser una fecha ISO válida.');
  }
  if (!isNonEmptyTrimmedString(input.packageId)) {
    throw new Error('Un cargo de paquete necesita el paquete que lo originó (packageId).');
  }
  if (!isValidDateKey(input.dueDate)) {
    throw new RangeError('El vencimiento debe ser una fecha válida (YYYY-MM-DD).');
  }

  const id = buildPackagePurchaseChargeId(input.studentId, input.packageId);
  if (chargeAlreadyExists(id, input.existingCharges)) {
    throw new Error('Ya existe una obligación de compra para este paquete.');
  }
  return {
    id,
    studentId: input.studentId,
    type: 'paquete',
    originalAmount: input.originalAmount,
    currency: 'ARS',
    dueDate: input.dueDate,
    createdAt: input.createdAt,
    packageId: input.packageId,
    calendarLessonId: null,
    voidedAt: null,
    voidReason: null,
  };
}

export function voidCharge(
  charges: PaymentCharge[],
  chargeId: string,
  reason: string,
  voidedAt: string
): PaymentCharge[] {
  if (!isNonEmptyTrimmedString(reason)) {
    throw new Error('La anulación de un cargo necesita un motivo.');
  }
  if (!isValidIsoInstant(voidedAt)) {
    throw new RangeError('voidedAt debe ser una fecha ISO válida.');
  }
  const charge = charges.find((item) => item.id === chargeId);
  if (!charge) {
    throw new Error('No se puede anular un cargo que no existe.');
  }
  if (charge.voidedAt !== null) {
    throw new Error('El cargo ya está anulado.');
  }
  return charges.map((item) => (item.id === chargeId ? { ...item, voidedAt, voidReason: reason } : item));
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

export function recordPayment(input: {
  id: string;
  studentId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // YYYY-MM-DD, fecha real de pago
  recordedAt: string; // ISO
  todayDateKey: string; // inyectado para mantener la función pura y testeable
  notes?: string;
  replacesPaymentId?: string | null;
  source?: Payment['source'];
}): Payment {
  if (!isNonEmptyTrimmedString(input.id)) {
    throw new Error('El pago necesita un id.');
  }
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('El pago necesita un alumno válido.');
  }
  if (!isPositiveFiniteNumber(input.amount)) {
    throw new RangeError('El importe del pago debe ser un número positivo y finito.');
  }
  if (!PAYMENT_METHODS.has(input.method)) {
    throw new Error('El medio de pago no es válido.');
  }
  if (!isValidIsoInstant(input.recordedAt)) {
    throw new RangeError('recordedAt debe ser una fecha ISO válida.');
  }
  if (!isValidDateKey(toDateKey(input.paidAt))) {
    throw new RangeError('paidAt debe ser una fecha válida (YYYY-MM-DD).');
  }
  const paidAtKey = toDateKey(input.paidAt);
  if (daysBetweenDateKeys(input.todayDateKey, paidAtKey) > 0) {
    throw new RangeError('La fecha real de pago no puede ser futura.');
  }
  const recordedAtKey = toDateKey(input.recordedAt);
  if (daysBetweenDateKeys(recordedAtKey, paidAtKey) > 0) {
    throw new RangeError('La fecha real de pago no puede ser posterior al momento en que se cargó (recordedAt).');
  }
  return {
    id: input.id,
    studentId: input.studentId,
    amount: input.amount,
    currency: 'ARS',
    method: input.method,
    paidAt: paidAtKey,
    recordedAt: input.recordedAt,
    notes: input.notes,
    voidedAt: null,
    voidReason: null,
    replacesPaymentId: input.replacesPaymentId ?? null,
    source: input.source,
  };
}

export function voidPayment(payments: Payment[], paymentId: string, reason: string, voidedAt: string): Payment[] {
  if (!isNonEmptyTrimmedString(reason)) {
    throw new Error('La anulación de un pago necesita un motivo.');
  }
  if (!isValidIsoInstant(voidedAt)) {
    throw new RangeError('voidedAt debe ser una fecha ISO válida.');
  }
  const payment = payments.find((item) => item.id === paymentId);
  if (!payment) {
    throw new Error('No se puede anular un pago que no existe.');
  }
  if (payment.voidedAt !== null) {
    throw new Error('El pago ya está anulado.');
  }
  return payments.map((item) => (item.id === paymentId ? { ...item, voidedAt, voidReason: reason } : item));
}

/**
 * "Corregir un pago debe hacerse mediante anulación y nuevo registro, sin
 * sobrescribir historial": anula el pago viejo y agrega uno nuevo
 * encadenado por `replacesPaymentId`. El pago anulado permanece en el
 * array, íntegro. Pura — no muta `payments`.
 */
export function replacePayment(
  payments: Payment[],
  paymentIdToVoid: string,
  voidReason: string,
  voidedAt: string,
  newPayment: Payment
): { payments: Payment[]; newPayment: Payment } {
  const original = payments.find((item) => item.id === paymentIdToVoid);
  if (!original) {
    throw new Error('No se puede reemplazar un pago que no existe.');
  }
  if (newPayment.id === paymentIdToVoid) {
    throw new Error('El pago nuevo necesita un id distinto del que reemplaza.');
  }
  if (payments.some((item) => item.id === newPayment.id)) {
    throw new Error('Ya existe un pago con el id del reemplazo.');
  }
  if (newPayment.studentId !== original.studentId) {
    throw new Error('No se puede reemplazar el pago de un alumno con un pago de otro alumno.');
  }

  const voided = voidPayment(payments, paymentIdToVoid, voidReason, voidedAt);
  const linkedNewPayment: Payment = { ...newPayment, replacesPaymentId: paymentIdToVoid };
  return { payments: [...voided, linkedNewPayment], newPayment: linkedNewPayment };
}

// ---------------------------------------------------------------------------
// Asignaciones (pagos parciales / reparto entre obligaciones)
// ---------------------------------------------------------------------------

/**
 * Combinador simple sin validar contra el estado global: reparte un pago
 * (todavía no persistido) entre varias obligaciones sin superar su importe.
 * Para asignar contra el estado ya persistido (pago/cargo existentes,
 * sobreasignación, duplicados) usar `allocatePayment` — esa es la única
 * operación recomendada para modificar el estado persistido. Endurecida a
 * propósito: `amount <= 0` NO detecta `NaN` (`NaN <= 0` es `false` en JS,
 * igual que `NaN > cualquier cosa`), así que antes se podía colar un
 * importe `NaN` que terminaba serializándose como `null`. Ahora se valida
 * explícitamente que cada importe sea un número positivo y finito.
 */
export function buildPaymentAllocations(
  payment: Pick<Payment, 'id' | 'studentId' | 'amount'>,
  targets: Array<{ id: string; chargeId: string; amount: number }>
): PaymentAllocation[] {
  if (!isNonEmptyTrimmedString(payment.id)) {
    throw new Error('El pago necesita un id para poder repartirlo.');
  }
  if (!isPositiveFiniteNumber(payment.amount)) {
    throw new RangeError('El importe del pago a repartir debe ser un número positivo y finito.');
  }
  targets.forEach((target) => {
    if (!isNonEmptyTrimmedString(target.id)) {
      throw new Error('Cada asignación necesita un id.');
    }
    if (!isNonEmptyTrimmedString(target.chargeId)) {
      throw new Error('Cada asignación necesita una obligación (chargeId) válida.');
    }
    if (!isPositiveFiniteNumber(target.amount)) {
      throw new RangeError('Cada asignación debe tener un importe positivo y finito (nunca NaN o Infinity).');
    }
  });
  const targetIds = targets.map((target) => target.id);
  if (new Set(targetIds).size !== targetIds.length) {
    throw new Error('No puede haber dos asignaciones con el mismo id.');
  }

  const totalAllocated = targets.reduce((sum, target) => sum + target.amount, 0);
  if (totalAllocated > payment.amount) {
    throw new RangeError('La suma de las asignaciones no puede superar el importe del pago.');
  }

  return targets.map((target) => ({
    id: target.id,
    paymentId: payment.id,
    chargeId: target.chargeId,
    studentId: payment.studentId,
    amount: target.amount,
  }));
}

/**
 * Operación segura de asignación: recibe el estado financiero completo y
 * valida contra él antes de crear la asignación. Nunca se implementa un
 * "saldo a favor" acá — si la asignación superaría lo necesario para saldar
 * la obligación en la fecha real del pago, se rechaza explícitamente en vez
 * de dejar un balance negativo silencioso. Pura — no muta `state`.
 */
export function allocatePayment(input: {
  id: string;
  paymentId: string;
  chargeId: string;
  amount: number;
  state: PaymentsRepositoryState;
  /**
   * Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO: recargo
   * desactivado que seguía apareciendo como deuda): configuración REAL de
   * recargos vigente — opcional, default el comportamiento anterior a esta
   * corrección (`calculateSafeAllocationCapacity` sin este parámetro), para
   * no romper ningún llamador existente. Todo llamador de UI real debe
   * pasar la configuración vigente (`useSurchargeSettings()`/
   * `getSurchargeSettingsSnapshot()`) — sin esto, la capacidad máxima
   * aceptada se calculaba como si los recargos SIEMPRE estuvieran
   * activados (10/15/20% por defecto), permitiendo de más aunque la
   * profesora los haya desactivado.
   */
  surchargeSettings?: SurchargeSettings;
}): PaymentAllocation {
  const { id, paymentId, chargeId, amount, state, surchargeSettings } = input;

  if (!isNonEmptyTrimmedString(id)) {
    throw new Error('La asignación necesita un id.');
  }
  if (state.allocations.some((allocation) => allocation.id === id)) {
    throw new Error('Ya existe una asignación con ese id.');
  }
  if (!isPositiveFiniteNumber(amount)) {
    throw new RangeError('El importe de la asignación debe ser un número positivo y finito.');
  }

  const payment = state.payments.find((item) => item.id === paymentId);
  if (!payment) {
    throw new Error('El pago referenciado en la asignación no existe.');
  }
  if (payment.voidedAt !== null) {
    throw new Error('No se puede asignar un pago anulado.');
  }

  const charge = state.charges.find((item) => item.id === chargeId);
  if (!charge) {
    throw new Error('La obligación referenciada en la asignación no existe.');
  }
  if (charge.voidedAt !== null) {
    throw new Error('No se puede asignar a una obligación anulada.');
  }

  if (payment.studentId !== charge.studentId) {
    throw new Error('El pago y la obligación pertenecen a alumnos distintos.');
  }

  const isDuplicate = state.allocations.some(
    (allocation) => allocation.paymentId === paymentId && allocation.chargeId === chargeId
  );
  if (isDuplicate) {
    throw new Error('Ya existe una asignación entre este pago y esta obligación.');
  }

  const alreadyAllocatedFromPayment = state.allocations
    .filter((allocation) => allocation.paymentId === paymentId)
    .reduce((sum, allocation) => sum + allocation.amount, 0);
  if (alreadyAllocatedFromPayment + amount > payment.amount) {
    throw new RangeError('La suma histórica de asignaciones no puede superar el importe del pago.');
  }

  // Capacidad segura: cuánto se puede agregar en `payment.paidAt`
  // considerando TODAS las asignaciones vigentes del cargo, tanto
  // anteriores como POSTERIORES a esa fecha (una asignación retroactiva se
  // inserta en su lugar cronológico real, nunca se compara sólo contra el
  // requerido de su propia fecha — eso rechazaba incorrectamente pagos
  // retroactivos válidos cuando ya existía una asignación posterior con un
  // recargo más alto). Misma función que usan `planPaymentRegistration` y
  // `calculateAssignableDebt`, para que la vista previa del formulario
  // coincida siempre con lo que esta validación termina aceptando.
  const isWaived = isSurchargeWaivedForCharge(chargeId, state.adjustments);
  const existingDatedAllocations = buildDatedAllocationsForCharge(chargeId, state.allocations, state.payments);
  const maxSafeAmount = calculateSafeAllocationCapacity(charge, existingDatedAllocations, payment.paidAt, isWaived, surchargeSettings);
  if (amount > maxSafeAmount) {
    throw new RangeError(
      'La asignación supera lo que se puede agregar de forma segura en la fecha real del pago (considerando asignaciones anteriores y posteriores). Todavía no se admite saldo a favor.'
    );
  }

  return {
    id,
    paymentId,
    chargeId,
    studentId: payment.studentId,
    amount,
  };
}

// ---------------------------------------------------------------------------
// Ajustes / condonaciones
// ---------------------------------------------------------------------------

export function buildAdjustment(input: {
  id: string;
  chargeId: string;
  studentId: string;
  reason: string;
  createdAt: string;
}): PaymentAdjustment {
  if (!isNonEmptyTrimmedString(input.id)) {
    throw new Error('La condonación necesita un id.');
  }
  if (!isNonEmptyTrimmedString(input.chargeId)) {
    throw new Error('La condonación necesita una obligación válida.');
  }
  if (!isNonEmptyTrimmedString(input.studentId)) {
    throw new Error('La condonación necesita un alumno válido.');
  }
  if (!isValidIsoInstant(input.createdAt)) {
    throw new RangeError('createdAt debe ser una fecha ISO válida.');
  }
  if (!isNonEmptyTrimmedString(input.reason)) {
    throw new Error('La condonación necesita un motivo.');
  }
  return {
    id: input.id,
    chargeId: input.chargeId,
    studentId: input.studentId,
    reason: input.reason,
    createdAt: input.createdAt,
    voidedAt: null,
    voidReason: null,
  };
}

export function voidAdjustment(
  adjustments: PaymentAdjustment[],
  adjustmentId: string,
  reason: string,
  voidedAt: string
): PaymentAdjustment[] {
  if (!isNonEmptyTrimmedString(reason)) {
    throw new Error('La anulación de una condonación necesita un motivo.');
  }
  if (!isValidIsoInstant(voidedAt)) {
    throw new RangeError('voidedAt debe ser una fecha ISO válida.');
  }
  const adjustment = adjustments.find((item) => item.id === adjustmentId);
  if (!adjustment) {
    throw new Error('No se puede anular una condonación que no existe.');
  }
  if (adjustment.voidedAt !== null) {
    throw new Error('La condonación ya está anulada.');
  }
  return adjustments.map((item) =>
    item.id === adjustmentId ? { ...item, voidedAt, voidReason: reason } : item
  );
}
