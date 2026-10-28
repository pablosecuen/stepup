// Puerto VERBATIM del original (`src/features/payments/types/index.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
// Dominio de cobros — Fase 4A: sólo modelo, motor puro y persistencia.
// paymentStatus en StudentProfile/StudentListItem sigue siendo el semáforo
// manual existente; este dominio es independiente a propósito (no se
// convierte en una tercera fuente de verdad todavía). La UI que los una
// vive en una fase posterior.

export type Currency = 'ARS';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): `'semanal'`/`'quincenal'` (una obligación por período, mismo
 * criterio que `'mensual'`) y `'paquete'` (la compra del paquete en sí,
 * como una única obligación) — ver `StudentBillingPlan` en
 * `student-profile/types/index.ts` para el plan del alumno que decide qué
 * tipo de cargo le corresponde.
 */
/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): `'entrenamiento'` — cuota mensual de UNA serie de
 * entrenamiento, siempre independiente de la mensualidad de clases del
 * mismo alumno (nunca se fusionan, ver `buildTrainingChargeId`). Mismo
 * criterio de período que `'mensual'` (billingPeriod 'YYYY-MM',
 * vencimiento día 10 global), pero identificada además por
 * `trainingBillingAgreementId` — un alumno puede tener una mensualidad de
 * clases Y una o varias cuotas de entrenamiento simultáneas, cada una su
 * propio `PaymentCharge`.
 */
export type PaymentChargeType = 'mensual' | 'por_clase' | 'semanal' | 'quincenal' | 'paquete' | 'entrenamiento';

export type PaymentMethod = 'efectivo' | 'transferencia' | 'otro';

/**
 * Etapa de vencimiento de una obligación en un instante dado. No es un
 * estado persistido: siempre se calcula a partir de `dueDate` y la fecha
 * de evaluación (ver `paymentDueStage.ts`).
 */
export type PaymentDueStage = 'on_time' | 'first_late' | 'second_late' | 'last_late';

/**
 * Obligación de cobro ("cargo"). Nunca guarda montos pagados, saldo,
 * recargo ni estado: todo eso se deriva de `Payment`/`PaymentAllocation`/
 * `PaymentAdjustment` en el momento de la consulta (ver motor puro).
 *
 * Idempotencia: para `type: 'mensual'`, la combinación (studentId,
 * billingPeriod) identifica una única obligación posible. Para
 * `type: 'por_clase'`, la combinación (studentId, savedLessonId) la
 * identifica. Ver `paymentIdempotency.ts`.
 */
export interface PaymentCharge {
  id: string;
  studentId: string;
  type: PaymentChargeType;
  /** Importe original, sin recargo. Los recargos siempre se calculan sobre este valor. */
  originalAmount: number;
  currency: Currency;
  /**
   * Fecha de vencimiento real: el `dueDay` configurado del alumno dentro del
   * mes facturado (mensual, ver `resolveMonthlyDueDate` — default día 10,
   * `DEFAULT_MONTHLY_DUE_DAY`) o fecha de la clase (por_clase). Excepción: el
   * cargo del primer mes proporcional de un alumno incorporado a una serie a
   * mitad de período usa su fecha efectiva de incorporación — ver
   * `buildMonthlyCharge`.
   */
  dueDate: string; // YYYY-MM-DD
  createdAt: string; // ISO
  /**
   * Sólo para type: 'mensual'/'semanal'/'quincenal'. Clave de período —
   * formato distinto según el tipo (mensual: 'YYYY-MM'; semanal: 'YYYY-Www'
   * ISO; quincenal: la fecha de inicio del período, 'YYYY-MM-DD', contada
   * desde `BiweeklyBillingPlan.anchorDate`). Siempre identifica de forma
   * determinística la obligación junto con `studentId` — ver
   * `paymentIdempotency.ts`.
   */
  billingPeriod?: string;
  /** Sólo para type: 'por_clase'. Relación con el registro pedagógico que originó el cargo. */
  savedLessonId?: string;
  /** Sólo para type: 'paquete'. Id del paquete comprado (ver `PackagePurchase`). */
  packageId?: string;
  /**
   * Sólo para type: 'entrenamiento'. Identidad estable del acuerdo de cobro
   * de la serie — igual a `RecurrenceRule.trainingBillingAgreementId` (ver
   * `calendar/types`). Junto con `studentId` y `billingPeriod` forma la
   * identidad económica única de esta obligación (nunca dos cargos para el
   * mismo acuerdo+alumno+período — ver `buildTrainingChargeId`).
   */
  trainingBillingAgreementId?: string;
  /**
   * Sólo para type: 'entrenamiento'. Copia CONGELADA del nombre de la serie
   * en el momento de generar el cargo (`RecurrenceRule.classTitle`/nombre
   * mostrado) — nunca se vuelve a leer del calendario después: si la serie
   * cambia de nombre más tarde, los cargos ya generados conservan el nombre
   * que tenían cuando se generaron, igual criterio que
   * `FirstMonthProrationDecision.seriesPatternSnapshot`.
   */
  trainingSeriesName?: string;
  /** Relación opcional con la reserva de calendario, cuando existe. */
  calendarLessonId?: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * Un pago real, tal como lo cuenta la profesora. Nunca se borra: se anula
 * (`voidedAt`/`voidReason`) y, si corresponde corregirlo, se registra un
 * pago nuevo — la corrección nunca sobrescribe el pago original.
 */
export interface Payment {
  id: string;
  studentId: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  /** Fecha real en la que el alumno pagó. Nunca puede ser futura respecto de `recordedAt`. */
  paidAt: string; // YYYY-MM-DD
  /** Momento en el que la profesora lo cargó en la app. Puede ser posterior a `paidAt` (carga retroactiva). */
  recordedAt: string; // ISO
  notes?: string;
  voidedAt: string | null;
  voidReason: string | null;
  /** Si este pago reemplaza a uno anulado por error de carga, referencia al original. */
  replacesPaymentId?: string | null;
  /**
   * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
   * nuevos): marca un pago como "situación inicial declarada" — nunca un
   * pago observado en el momento real, sino una declaración de la
   * profesora al dar de alta al alumno (o al usar "Marcar mes actual como
   * pagado"). Opcional: ausente = pago normal registrado por la profesora
   * en el flujo habitual. Nunca se usa como id ni clave de relación.
   */
  source?: 'initial_student_setup';
}

/**
 * Qué parte de un `Payment` se aplicó a qué `PaymentCharge`. Un pago puede
 * repartirse entre varias obligaciones; una obligación puede recibir
 * aportes de varios pagos (pagos parciales).
 */
export interface PaymentAllocation {
  id: string;
  paymentId: string;
  chargeId: string;
  studentId: string;
  amount: number;
}

/**
 * Condonación manual del recargo de una obligación puntual: mientras haya
 * un ajuste vigente (no anulado) para un `chargeId`, el total adeudado de
 * esa obligación se calcula siempre como `originalAmount`, sin importar
 * cuántos días de atraso tenga.
 */
export interface PaymentAdjustment {
  id: string;
  chargeId: string;
  studentId: string;
  reason: string;
  createdAt: string; // ISO
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PaymentsRepositoryState {
  charges: PaymentCharge[];
  payments: Payment[];
  allocations: PaymentAllocation[];
  adjustments: PaymentAdjustment[];
}

// ---------------------------------------------------------------------------
// Resultados calculados por el motor puro (nunca persistidos)
// ---------------------------------------------------------------------------

export interface ChargeComputedState {
  chargeId: string;
  studentId: string;
  originalAmount: number;
  /** Recargo vigente calculado a la fecha de evaluación (0 si hay condonación activa). */
  surchargeAmount: number;
  /** originalAmount + surchargeAmount. */
  totalDue: number;
  /** Suma de allocations no anuladas. */
  paidAmount: number;
  balance: number;
  stage: PaymentDueStage;
  /** Fecha en la que el total asignado alcanzó el monto correspondiente, o null si no está saldada. */
  settledAt: string | null;
  isSurchargeWaived: boolean;
  /** true si dueDate es posterior a la fecha de evaluación (todavía no vencida). */
  isNotYetDue: boolean;
}

export type ScoreCategory =
  | 'excelente'
  | 'buena'
  | 'irregular'
  | 'riesgo_de_deuda'
  | 'historial_insuficiente';

export interface StudentScoringResult {
  /** null si hay menos de tres obligaciones resueltas. */
  score: number | null;
  resolvedChargeCount: number;
  category: ScoreCategory;
}

// ---------------------------------------------------------------------------
// Paquetes de clases (2026-07-19) — la COMPRA se cobra como un PaymentCharge
// (type:'paquete', ver arriba); acá sólo vive lo propio del paquete: cuántas
// clases incluye y los movimientos de crédito. Store separado
// (`packagesStore.ts`), mismo patrón de hidratación/mutación atómica/
// rollback que `paymentsStore.ts` — nunca se infieren "clases usadas"
// contando SavedLesson, siempre por movimiento explícito.
// ---------------------------------------------------------------------------

export interface PackagePurchase {
  id: string; // = packageId, referenciado por PaymentCharge.packageId
  studentId: string;
  includedClasses: number;
  amount: number;
  validFrom: string; // YYYY-MM-DD
  validUntil?: string; // YYYY-MM-DD
  createdAt: string; // ISO
  voidedAt: string | null;
  voidReason: string | null;
}

export type PackageCreditMovementType = 'consumo' | 'ajuste_manual';

/**
 * `savedLessonId` es la clave de idempotencia para `type:'consumo'`: nunca
 * dos movimientos de consumo con el mismo (packageId, savedLessonId) — así
 * corregir/recalcular una clase nunca descuenta dos créditos por la misma
 * clase dictada.
 */
export interface PackageCreditMovement {
  id: string;
  packageId: string;
  studentId: string;
  type: PackageCreditMovementType;
  /** Créditos que resta este movimiento (siempre 1 para 'consumo'). */
  amount: number;
  savedLessonId?: string; // sólo 'consumo'
  reason?: string; // sólo 'ajuste_manual'
  createdAt: string; // ISO
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PackagesRepositoryState {
  purchases: PackagePurchase[];
  creditMovements: PackageCreditMovement[];
}

export interface PackageCreditsSummary {
  packageId: string;
  includedClasses: number;
  consumed: number;
  available: number;
  isExhausted: boolean;
}

/**
 * Corrección 2026-07-30 (a pedido de Joaquín — editar monto mensual):
 * registro mínimo de auditoría cada vez que se corrige el importe mensual
 * de un alumno desde Cobros. Nunca reemplaza ni borra el historial de
 * pagos — es un registro aparte, de sólo lectura una vez creado (no tiene
 * `voidedAt`: una corrección no se anula, si hace falta se corrige de
 * nuevo con una entrada nueva que queda igual de visible que la anterior).
 */
export interface MonthlyAmountCorrectionEntry {
  id: string;
  studentId: string;
  /** Período (YYYY-MM) del cargo mensual afectado. */
  billingPeriod: string;
  previousAmount: number;
  newAmount: number;
  changedAt: string; // ISO
  reason: string;
  /**
   * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente
   * el flujo financiero mensual): 'this_month' actualizó el cargo del
   * período vigente; 'next_month' sólo dejó el cambio pendiente para el
   * período siguiente (el cargo actual, si existía, no se tocó). Opcional
   * — una entrada de un respaldo anterior a esta corrección no lo tiene, y
   * eso nunca es un error (se interpreta como 'this_month', el único
   * comportamiento que existía antes).
   */
  effectiveFrom?: 'this_month' | 'next_month';
}

/**
 * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
 * nuevos): registro mínimo de auditoría cada vez que la reparación
 * automática (o el botón manual "[ Corregir situación inicial ]") corrige
 * un recargo incorrecto originado por el bug de fecha de alta. Mismo
 * criterio que `MonthlyAmountCorrectionEntry`: nunca se anula, si hiciera
 * falta corregir de nuevo se agrega una entrada nueva.
 */
export interface InitialPaidSurchargeCorrectionEntry {
  id: string;
  studentId: string;
  /** Período (YYYY-MM) del cargo mensual corregido. */
  billingPeriod: string;
  previousSurchargeAmount: number;
  voidedPaymentId: string;
  newPaymentId: string;
  correctedAt: string; // ISO
  reason: string;
}

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
 * alumno a una serie recurrente): registro de la decisión tomada en el
 * panel "Primer mes de [alumno]" — UNA entrada por (alumno, período),
 * cualquiera sea el criterio elegido (incluido `'no_charge'`, que nunca
 * produce un `PaymentCharge`, así que necesita un lugar propio donde
 * quedar igual de persistida/auditable que los otros tres). `chargeId` es
 * `null` únicamente en ese caso. Nunca se anula ni se borra — si la serie
 * cambia y la profesora confirma una recalculación antes de pagar, se
 * agrega una entrada NUEVA (mismo criterio que `MonthlyAmountCorrectionEntry`:
 * el historial de decisiones nunca se sobrescribe).
 */
export interface FirstMonthProrationDecision {
  id: string;
  studentId: string;
  billingPeriod: string; // YYYY-MM
  effectiveJoinDate: string; // YYYY-MM-DD
  criterion: 'proportional' | 'full' | 'custom' | 'no_charge';
  classesRemaining: number;
  classesPerFullPeriod: number;
  /** Cuota mensual permanente vigente en el momento de la decisión — nunca cambia aunque el plan suba/baje después. */
  permanentMonthlyAmount: number;
  /** Importe efectivamente cargado para este primer período (0 si `criterion` es `'no_charge'`). */
  chargedAmount: number;
  /** Id del `PaymentCharge` creado/actualizado — `null` sólo para `'no_charge'`. */
  chargeId: string | null;
  createdAt: string; // ISO — cuándo se calculó la sugerencia
  confirmedAt: string; // ISO — cuándo la profesora confirmó
  /**
   * Corrección 2026-08-27 (a pedido de Joaquín — EL PRIMER MES SIGUE
   * COBRANDO LA CUOTA COMPLETA): procedencia de la decisión — `'manual'`
   * cuando la profesora la confirmó a mano en el panel de revisión
   * (`CobrosTab.tsx`), `'automatic'` cuando la generó la detección/
   * reparación automática (`ensureFirstMonthProrationDecision`). Opcional y
   * aditivo a propósito: una entrada persistida ANTES de este campo, o
   * restaurada de un respaldo viejo, queda sin `source` — se trata como
   * "histórica sin versión", NUNCA como manual, así que sigue siendo
   * elegible para la reparación automática exactamente igual que una
   * decisión automática (nunca bloquea para siempre la corrección de un
   * cargo real todavía desactualizado).
   */
  source?: 'manual' | 'automatic';
  /**
   * Corrección 2026-08-27, cuarta ronda (a pedido de Joaquín — SOLUCIÓN
   * ESTRUCTURAL DEFINITIVA — PRORRATEO AUTOMÁTICO AL VINCULAR UN ALUMNO):
   * identidad de TODAS las series recurrentes activas que aportaron clases
   * a `classesRemaining`/`classesPerFullPeriod` — la MISMA lista que
   * `planFirstMonthProration` sumó. Opcional y aditivo (ausente en
   * decisiones de antes de este campo, o restauradas de un respaldo viejo).
   */
  recurrenceIds?: string[];
  /**
   * Corrección 2026-08-27, cuarta ronda: copia CONGELADA del patrón semanal
   * vigente de cada serie de `recurrenceIds` en el instante exacto de esta
   * decisión — nunca se vuelve a leer del store más tarde, así que
   * sobrevive aunque la serie se edite, se pause o se elimine después.
   * Estructura propia (no importa tipos de `calendar/types`, a propósito:
   * mantiene desacoplados los dos dominios) — sólo lo mínimo necesario para
   * documentar "qué patrón real justificó este cálculo". Opcional y
   * aditivo.
   */
  seriesPatternSnapshot?: FirstMonthProrationSeriesPatternSnapshot[];
  /**
   * Corrección 2026-08-27, cuarta ronda: versión de la fórmula/regla que
   * produjo esta decisión (`FIRST_MONTH_PRORATION_RULE_VERSION`, ver
   * `firstMonthProration.ts`) — permite distinguir en el futuro decisiones
   * calculadas con una versión ya superada de la regla, sin necesidad de
   * inferirlo de otros campos. Opcional y aditivo; ausente = anterior a
   * este campo.
   */
  ruleVersion?: number;
}

/**
 * Corrección 2026-08-27, cuarta ronda: copia mínima y autocontenida del
 * patrón semanal de UNA serie recurrente, congelada dentro de una
 * `FirstMonthProrationDecision` — deliberadamente NO es el mismo tipo que
 * `RecurrenceRule`/`RecurrenceWeek` de `calendar/types` (evita acoplar los
 * dos dominios); sólo espeja su forma con campos primitivos.
 */
export interface FirstMonthProrationSeriesPatternSnapshot {
  recurrenceId: string;
  cycleLengthWeeks: number;
  weeks: Array<{
    weekIndex: number;
    sessions: Array<{ weekday: number; hour: number; minute: number; durationMinutes: number }>;
  }>;
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): configuración financiera de UNA serie de entrenamiento —
 * `id` es la misma identidad estable que `RecurrenceRule.trainingBillingAgreementId`
 * (calendar/types), nunca se genera dos veces para la misma serie. Vive en
 * el dominio de pagos (nunca en `calendar/types`, que no conoce dinero) —
 * mismo patrón de separación que ya existe entre `CalendarLesson` y
 * `PaymentCharge.calendarLessonId` (cross-referencia por id, nunca un campo
 * financiero cruzando al lado del calendario).
 *
 * Finalizar la serie ("Finalizar entrenamiento") NO tiene un campo propio
 * acá — reutiliza por completo `RecurrenceRule.status`/`endDate` (la MISMA
 * infraestructura de "Finalizar" que ya existe para cualquier serie): una
 * vez que la regla deja de estar `'active'` o su `endDate` queda atrás,
 * `generateOccurrences` dejar de producir ocurrencias futuras es, por sí
 * solo, lo que impide nuevas cuotas — sin necesitar un segundo estado
 * paralelo que pueda desincronizarse del real.
 */
export interface TrainingBillingAgreement {
  id: string;
  /** Cuota mensual vigente — nunca se sobrescribe directamente al cambiar el precio, ver `pendingMonthlyFee`. */
  monthlyFee: number;
  /**
   * Corrección 2026-09-13: mismo patrón de vigencia que
   * `MonthlyBillingPlan.pendingAmount`/`pendingAmountEffectiveFrom` — un
   * cambio de precio NUNCA toca `monthlyFee` ni ningún cargo ya generado;
   * queda pendiente hasta que el período facturado alcance
   * `pendingMonthlyFeeEffectiveFrom` (ver `resolveEffectiveTrainingMonthlyFee`).
   */
  pendingMonthlyFee?: number;
  pendingMonthlyFeeEffectiveFrom?: string; // YYYY-MM
  /**
   * Primer período (YYYY-MM) para el que este acuerdo puede generar una
   * cuota — nunca uno anterior, sin importar la fecha de inicio real de la
   * serie en el calendario. Protege contra deuda retroactiva en creación,
   * conversión y configuración de series históricas.
   */
  startPeriod: string;
  createdAt: string; // ISO
}

export interface MonthlyPaymentStats {
  period: string; // YYYY-MM
  totalCharged: number;
  totalCollected: number;
  totalOutstanding: number;
  chargeCount: number;
  paidChargeCount: number;
}
