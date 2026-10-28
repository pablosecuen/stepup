// Puerto VERBATIM del original (`src/features/payments/utils/monthlyPeriodStatus.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
 * estado del PERÍODO ACTUAL de un alumno mensual, para el perfil
 * financiero — "Pagado", "Parcial", "Pendiente", "Vencido" o "Comienza el
 * próximo mes". Pura: nunca persiste nada, siempre se recalcula a partir de
 * `charges`/`chargeStates` (mismo orden e índice que devuelve
 * `buildStudentPaymentsSummary`) y del `StudentBillingPlan` resuelto.
 */
import type { ChargeComputedState, PaymentCharge, PaymentDueStage } from '../types/index.ts';
import type { MonthlyBillingPlan, StudentBillingPlan, StudentStatus } from '../../student-profile/types/index.ts';
import { DEFAULT_MONTHLY_DUE_DAY, resolveEffectiveMonthlyAmount } from '../../student-profile/utils/studentBillingPlan.ts';
import type { StatusColorKey } from '../../../theme/colors.ts';
import { billingPeriodOfDateKey, resolveMonthlyDueDate, toDateKey } from './paymentDates.ts';
import { isChargeOverdueForDisplay, resolveMonthlyDueDateUrgency } from './paymentDueStage.ts';
import { formatBillingPeriodMonthOnly, formatDateKeyDayMonth } from './paymentFormat.ts';
import { DEFAULT_SURCHARGE_SETTINGS, resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';
import { isStudentEligibleForCollectionsDisplay } from './studentCollectionEligibility.ts';

export type MonthlyPeriodStatusLabel = 'pagado' | 'parcial' | 'pendiente' | 'vencido' | 'comienza_proximo_mes';

export interface CurrentMonthlyPeriodStatus {
  billingPeriod: string; // YYYY-MM
  label: MonthlyPeriodStatusLabel;
  charge: PaymentCharge | null;
  chargeState: ChargeComputedState | null;
}

export const MONTHLY_PERIOD_STATUS_LABEL: Record<MonthlyPeriodStatusLabel, string> = {
  pagado: 'Pagado',
  parcial: 'Parcial',
  pendiente: 'Pendiente',
  vencido: 'Vencido',
  comienza_proximo_mes: 'Comienza el próximo mes',
};

/**
 * `null` cuando el plan resuelto no es `'monthly'` — el período actual sólo
 * tiene sentido para alumnos mensuales, el resto de los planes (por clase,
 * semanal, quincenal, paquete, sin cargo) no lo necesitan.
 */
export function resolveCurrentMonthlyPeriodStatus(input: {
  plan: StudentBillingPlan;
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  evaluationDate: string; // YYYY-MM-DD, ya resuelto en huso de Buenos Aires
}): CurrentMonthlyPeriodStatus | null {
  if (input.plan.type !== 'monthly') return null;

  const billingPeriod = billingPeriodOfDateKey(input.evaluationDate);

  if (input.plan.startPeriod && billingPeriod < input.plan.startPeriod) {
    return { billingPeriod, label: 'comienza_proximo_mes', charge: null, chargeState: null };
  }

  const index = input.charges.findIndex(
    (charge) => charge.type === 'mensual' && charge.billingPeriod === billingPeriod
  );
  if (index === -1) {
    return { billingPeriod, label: 'pendiente', charge: null, chargeState: null };
  }

  const charge = input.charges[index];
  const chargeState = input.chargeStates[index];

  let label: MonthlyPeriodStatusLabel;
  if (chargeState.balance <= 0) {
    label = 'pagado';
  } else if (chargeState.paidAmount > 0) {
    label = 'parcial';
    // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
    // mensualidades "Mes vencido" al comenzar el mes): "en término" ya no se
    // decide con la etapa de RECARGO (`chargeState.stage`, ventana de gracia
    // contada desde `dueDate`) sino con el vencimiento real de la
    // mensualidad (`resolveMonthlyDueDateUrgency`) — única fuente, nunca
    // reimplementada acá.
  } else if (isChargeOverdueForDisplay('mensual', charge.dueDate, chargeState.stage, input.evaluationDate)) {
    label = 'vencido';
  } else {
    label = 'pendiente';
  }

  return { billingPeriod, label, charge, chargeState };
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y tarjetas
// de Alumnos): estado financiero COMPLETO del mes actual, para la tarjeta de
// la lista de Alumnos. Deliberadamente SEPARADA de `resolveCurrentMonthlyPeriodStatus`
// (arriba) en vez de reescribirla: esa función ya está en producción y
// probada (la usa `CobrosTab.tsx`, que el diagnóstico confirmó que YA
// distingue "pendiente" de "pagado" correctamente) — tocarla arriesgaba
// romper ese comportamiento ya correcto sin necesidad. Esta función nueva
// añade lo que a la lista de Alumnos le faltaba: nunca usa el semáforo de
// gravedad (`paymentTrafficLight.ts`) para afirmar "pagado" — sólo un saldo
// real en $0 puede decir eso — y separa el "vencido" genérico en las 3
// etapas canónicas (`determineMonthlyDueStage`, mismo motor que ya usa
// `calculateChargeState`).
// ---------------------------------------------------------------------------

export type StudentCardFinancialStatusKind =
  | 'pagado'
  | 'pendiente_en_termino'
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
   * mensualidades "Mes vencido" al comenzar el mes): ventana de aviso de 3
   * días corridos antes del vencimiento real — todavía no vencida, ver
   * `resolveMonthlyDueDateUrgency`.
   */
  | 'vence_pronto'
  | 'pago_parcial'
  | 'primer_vencimiento'
  | 'segundo_vencimiento'
  | 'ultimo_vencimiento'
  /**
   * Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
   * configurables): con los recargos desactivados, "en la interfaz del
   * alumno sólo usar 'Al día'/'Mes vencido'... no mostrar Primer/Segundo/
   * Último vencimiento ni importes con recargo" — este estado reemplaza a
   * los tres de arriba (nunca conviven para el mismo cargo).
   */
  | 'vencido_sin_recargo'
  | 'comienza_proximo_mes'
  | 'cargo_pendiente_generar'
  | 'sin_plan_mensual'
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — ESTADO INACTIVO): un
   * alumno que no está `activo` nunca muestra un estado de pago corriente
   * como si siguiera facturándose — "No aplica" gana sobre CUALQUIER otro
   * cálculo (pagado/pendiente/vencido/etc.), sin importar si existe deuda
   * histórica real (esa deuda se conserva íntegra en el historial
   * financiero — Centro de cobros, resúmenes — nunca se borra ni se
   * perdona; sólo deja de representarse como "el estado actual" acá).
   */
  | 'no_aplica';

export interface StudentMonthlyCardStatus {
  status: StudentCardFinancialStatusKind;
  /** 'YYYY-MM' del período evaluado, o `null` cuando el alumno no tiene plan mensual. */
  billingPeriod: string | null;
  /** Texto exacto para mostrar en la tarjeta — ej. "Agosto pagado", "Primer vencimiento". */
  label: string;
  colorKey: StatusColorKey;
  /** Saldo pendiente del período actual — 0 cuando no aplica (pagado, sin cargo todavía, sin plan). */
  balance: number;
}

const NON_MONTHLY_PLAN_LABEL: Record<Exclude<StudentBillingPlan['type'], 'monthly'>, string> = {
  per_class: 'Por clase',
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  class_package: 'Paquete de clases',
  complimentary: 'Sin cargo',
};

const STAGE_TO_COLOR_KEY: Record<PaymentDueStage, StatusColorKey> = {
  on_time: 'statusPendiente',
  first_late: 'statusAmarillo',
  second_late: 'statusNaranja',
  last_late: 'statusRojo',
};

export function resolveStudentMonthlyCardStatus(input: {
  plan: StudentBillingPlan;
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  evaluationDate: string; // YYYY-MM-DD, ya resuelto en huso de Buenos Aires
  /** Corrección 2026-08-11 (recargos automáticos configurables): opcional, default = comportamiento actual (recargos activados). */
  surchargeSettings?: SurchargeSettings;
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — ESTADO INACTIVO): opcional
   * — un llamador que no lo provee conserva el comportamiento anterior
   * (nunca corta por estado). Cualquier valor distinto de `'activo'` gana
   * sobre todo lo demás: la tarjeta nunca debe mostrar un estado de pago
   * corriente para un alumno que ya no está activo.
   */
  status?: StudentStatus;
}): StudentMonthlyCardStatus {
  if (input.status && !isStudentEligibleForCollectionsDisplay(input.status)) {
    return {
      status: 'no_aplica',
      billingPeriod: null,
      label: 'No aplica',
      colorKey: 'statusSinDatos',
      balance: 0,
    };
  }

  if (input.plan.type !== 'monthly') {
    return {
      status: 'sin_plan_mensual',
      billingPeriod: null,
      label: NON_MONTHLY_PLAN_LABEL[input.plan.type],
      colorKey: 'statusSinDatos',
      balance: 0,
    };
  }

  const billingPeriod = billingPeriodOfDateKey(input.evaluationDate);

  if (input.plan.startPeriod && billingPeriod < input.plan.startPeriod) {
    return {
      status: 'comienza_proximo_mes',
      billingPeriod,
      // A media oración el nombre del mes va en minúscula ("Comienza en
      // septiembre"), a diferencia de "Agosto pendiente"/"Agosto pagado"
      // más abajo, donde el mes abre el texto y sí lleva mayúscula inicial.
      label: `Comienza en ${formatBillingPeriodMonthOnly(input.plan.startPeriod).toLowerCase()}`,
      colorKey: 'statusSinDatos',
      balance: 0,
    };
  }

  const monthName = formatBillingPeriodMonthOnly(billingPeriod);
  const index = input.charges.findIndex(
    (charge) => charge.type === 'mensual' && charge.billingPeriod === billingPeriod
  );

  // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
  // mensualidades "Mes vencido" al comenzar el mes): sin cargo generado
  // todavía, el vencimiento REAL (`resolveMonthlyDueDate`, con el `dueDay`
  // real del alumno — nunca el día 1) decide si estamos dentro del término
  // normal ("pendiente en término", el caso más común, apenas arranca el
  // mes) o si ya deberíamos tener un cargo y no lo tenemos (anómalo: la
  // generación automática todavía no corrió).
  if (index === -1) {
    const dueDate = resolveMonthlyDueDate(billingPeriod, input.plan.dueDay);
    const dueStatus = resolveMonthlyDueDateUrgency(dueDate, input.evaluationDate);
    if (dueStatus.urgency !== 'mes_vencido') {
      return {
        status: 'pendiente_en_termino',
        billingPeriod,
        label: `${monthName} pendiente`,
        colorKey: 'statusPendiente',
        balance: 0,
      };
    }
    return {
      status: 'cargo_pendiente_generar',
      billingPeriod,
      label: 'Cargo pendiente de generar',
      colorKey: 'statusSinDatos',
      balance: 0,
    };
  }

  const charge = input.charges[index];
  const chargeState = input.chargeStates[index];

  // Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
  // configurables): se resuelve para el PERÍODO REAL del cargo (nunca
  // "hoy" a secas) — mismo criterio que `calculateChargeState`, para que
  // un mes viejo ya cerrado conserve su propio comportamiento aunque la
  // configuración haya cambiado después.
  const surchargeEnabled = resolveEffectiveSurchargeTierValues(
    input.surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
    billingPeriod
  ).enabled;

  if (chargeState.balance <= 0) {
    return {
      status: 'pagado',
      billingPeriod,
      label: `${monthName} pagado`,
      colorKey: 'statusVerde',
      balance: 0,
    };
  }

  if (chargeState.paidAmount > 0) {
    return {
      status: 'pago_parcial',
      billingPeriod,
      label: 'Pago parcial',
      colorKey: surchargeEnabled ? STAGE_TO_COLOR_KEY[chargeState.stage] : 'statusRojo',
      balance: chargeState.balance,
    };
  }

  // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
  // mensualidades "Mes vencido" al comenzar el mes): "en término"/"vence
  // pronto"/"vencido" ya no se deciden con la etapa de RECARGO
  // (`chargeState.stage`) sino con el vencimiento real de la mensualidad
  // (`resolveMonthlyDueDateUrgency`, única fuente) — `chargeState.stage`
  // sigue existiendo para el cálculo de recargo en sí (dinero), nunca para
  // decidir si esto necesita atención.
  const dueStatus = resolveMonthlyDueDateUrgency(charge.dueDate, input.evaluationDate);

  if (dueStatus.urgency === 'pendiente_en_termino' || dueStatus.urgency === 'vence_hoy') {
    return {
      status: 'pendiente_en_termino',
      billingPeriod,
      label: `${monthName} pendiente`,
      colorKey: 'statusPendiente',
      balance: chargeState.balance,
    };
  }

  if (dueStatus.urgency === 'vence_pronto') {
    return {
      status: 'vence_pronto',
      billingPeriod,
      label: `Vence en ${dueStatus.daysUntilDue} día${dueStatus.daysUntilDue === 1 ? '' : 's'}`,
      colorKey: 'statusPendiente',
      balance: chargeState.balance,
    };
  }

  // A partir de acá, `dueStatus.urgency === 'mes_vencido'`.

  // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
  // mensualidades "Mes vencido" al comenzar el mes): el vencimiento real ya
  // pasó, pero la etapa de RECARGO (`chargeState.stage`, su propia ventana
  // de gracia independiente) todavía no salió de "en término" — puede pasar
  // si el `dueDay` configurado es más chico que el `graceDay` del recargo.
  // Nunca "Último vencimiento" en ese caso (no hay ninguna etapa de mora
  // real todavía) — "Mes vencido" genérico, mismo criterio que recargos
  // desactivados: hace falta atención, pero el saldo no lleva recargo.
  if (chargeState.stage === 'on_time') {
    return {
      status: 'vencido_sin_recargo',
      billingPeriod,
      label: 'Mes vencido',
      colorKey: 'statusRojo',
      balance: chargeState.balance,
    };
  }

  // Recargos desactivados para este período: "Mes vencido" genérico —
  // nunca Primer/Segundo/Último vencimiento, sin importar la etapa real
  // (que se sigue calculando internamente para el scoring/puntualidad,
  // nunca se pierde, sólo deja de traducirse a un texto/color granular).
  if (!surchargeEnabled) {
    return {
      status: 'vencido_sin_recargo',
      billingPeriod,
      label: 'Mes vencido',
      colorKey: 'statusRojo',
      balance: chargeState.balance,
    };
  }

  switch (chargeState.stage) {
    case 'first_late':
      return {
        status: 'primer_vencimiento',
        billingPeriod,
        label: 'Primer vencimiento',
        colorKey: 'statusAmarillo',
        balance: chargeState.balance,
      };
    case 'second_late':
      return {
        status: 'segundo_vencimiento',
        billingPeriod,
        label: 'Segundo vencimiento',
        colorKey: 'statusNaranja',
        balance: chargeState.balance,
      };
    default:
      return {
        status: 'ultimo_vencimiento',
        billingPeriod,
        label: 'Último vencimiento',
        colorKey: 'statusRojo',
        balance: chargeState.balance,
      };
  }
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-03 (a pedido de Joaquín — ERROR VISUAL: "Septiembre
// pendiente" desborda el recuadro pequeño de pago del perfil): ese recuadro
// (`QuickSummary.tsx`) es demasiado angosto para un texto largo como
// "Septiembre pendiente" o "Pendiente en término" en una sola línea de
// valor — necesita la MISMA separación que ya usan sus otras métricas
// (valor corto arriba, etiqueta secundaria abajo). Esta función arma
// exactamente ese par, reutilizando `resolveStudentMonthlyCardStatus`
// (nunca reimplementa el cálculo financiero) y agregando sólo la distinción
// "Vence hoy" (el propio día del vencimiento) frente a "Pendiente" (el
// resto del término) — la única que esa función no expone como estado
// propio porque, para la tarjeta de Alumnos/Centro de cobros, ambos casos
// comparten exactamente el mismo texto ("{Mes} pendiente"). Pura.
// ---------------------------------------------------------------------------

/**
 * Corrección 2026-09-03 (a pedido de Joaquín — ERROR VISUAL: pastilla
 * "Septiembre pendiente" desborda/superpone en la lista de Alumnos): la
 * distinción "vence hoy" vs. "pendiente en término" (`resolveStudentMonthlyCardStatus`
 * comparte el mismo texto/status para las dos, ver arriba) ahora es un tipo
 * propio, exportado, para que CUALQUIER presentación compacta (la tarjeta
 * del perfil, la tarjeta de Alumnos) la reutilice sin repetir el cálculo.
 */
export type MonthlyCardDisplayKind = StudentCardFinancialStatusKind | 'vence_hoy';

function resolveMonthlyCardDisplayKind(input: {
  plan: StudentBillingPlan;
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  evaluationDate: string;
  surchargeSettings?: SurchargeSettings;
  status?: StudentStatus;
}): { kind: MonthlyCardDisplayKind; cardStatus: StudentMonthlyCardStatus } {
  const cardStatus = resolveStudentMonthlyCardStatus(input);
  if (cardStatus.status === 'pendiente_en_termino') {
    const dueDate = resolveCurrentPeriodDueDate(input, cardStatus.billingPeriod);
    if (dueDate === input.evaluationDate) return { kind: 'vence_hoy', cardStatus };
  }
  return { kind: cardStatus.status, cardStatus };
}

function resolveCurrentPeriodDueDate(
  input: { plan: StudentBillingPlan; charges: PaymentCharge[] },
  billingPeriod: string | null
): string | null {
  if (!billingPeriod) return null;
  const charge = input.charges.find((c) => c.type === 'mensual' && c.billingPeriod === billingPeriod);
  if (charge) return charge.dueDate;
  if (input.plan.type !== 'monthly') return null;
  return resolveMonthlyDueDate(billingPeriod, input.plan.dueDay);
}

export interface QuickPaymentSummaryDisplay {
  /** Valor corto para la línea principal — nunca incluye el nombre del mes. */
  value: string;
  /** "Pago de {mes}" — `null` cuando el valor ya es autoexplicativo (No aplica, Comienza en X, Por clase, etc). */
  secondaryLabel: string | null;
  colorKey: StatusColorKey;
}

export function resolveQuickPaymentSummaryDisplay(input: {
  plan: StudentBillingPlan;
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  evaluationDate: string;
  surchargeSettings?: SurchargeSettings;
  status?: StudentStatus;
}): QuickPaymentSummaryDisplay {
  const { kind, cardStatus } = resolveMonthlyCardDisplayKind(input);
  const monthName = cardStatus.billingPeriod ? formatBillingPeriodMonthOnly(cardStatus.billingPeriod) : null;
  const secondaryLabel = monthName ? `Pago de ${monthName.toLowerCase()}` : null;

  switch (kind) {
    case 'no_aplica':
    case 'sin_plan_mensual':
    case 'comienza_proximo_mes':
      // Ya son autoexplicativos y cortos — nunca llevan mes aparte.
      return { value: cardStatus.label, secondaryLabel: null, colorKey: cardStatus.colorKey };
    case 'pendiente_en_termino':
      return { value: 'Pendiente', secondaryLabel, colorKey: cardStatus.colorKey };
    case 'vence_hoy':
      return { value: 'Vence hoy', secondaryLabel, colorKey: cardStatus.colorKey };
    case 'vence_pronto':
      return { value: 'Vence pronto', secondaryLabel, colorKey: cardStatus.colorKey };
    case 'cargo_pendiente_generar':
      return { value: 'Pendiente', secondaryLabel, colorKey: cardStatus.colorKey };
    case 'pago_parcial':
      return { value: 'Pago parcial', secondaryLabel, colorKey: cardStatus.colorKey };
    case 'pagado':
      return { value: 'Pagado', secondaryLabel, colorKey: cardStatus.colorKey };
    case 'primer_vencimiento':
    case 'segundo_vencimiento':
    case 'ultimo_vencimiento':
    case 'vencido_sin_recargo':
      return { value: 'Vencido', secondaryLabel, colorKey: cardStatus.colorKey };
  }
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-03 (a pedido de Joaquín — ERROR VISUAL: "Septiembre
// pendiente" desborda/se superpone con la nota y las clases en la pastilla
// compacta de la lista de Alumnos): variante MÁS corta todavía que
// `resolveQuickPaymentSummaryDisplay` — sólo el `kind`, nunca un texto, para
// que cada presentación (acá, `StudentCard.tsx`; antes, `QuickSummary.tsx`)
// decida su propia palabra exacta sin duplicar el cálculo financiero. Pura.
// ---------------------------------------------------------------------------
export function resolveMonthlyStatusKindForDisplay(input: {
  plan: StudentBillingPlan;
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  evaluationDate: string;
  surchargeSettings?: SurchargeSettings;
  status?: StudentStatus;
}): MonthlyCardDisplayKind {
  return resolveMonthlyCardDisplayKind(input).kind;
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-04 (a pedido de Joaquín — "Pago vencido" fantasma tras
// saldar julio): el badge "Pago vencido" (`StudentBadges.tsx`, driven por
// `hasOverduePayment`) ya calculaba correctamente SI había deuda vencida
// (`summary.overdueBalance > 0`, recalculado siempre desde `chargeStates` —
// nunca de un campo heredado), pero el texto genérico nunca decía DE QUÉ
// período. Eso generaba la confusión reportada: la profesora paga julio por
// completo, el badge deja de referirse a julio (correcto, `overdueBalance`
// ya no lo cuenta) pero SIGUE apareciendo "Pago vencido" — ahora por una
// deuda distinta y real (junio, u otro período todavía impago) — y sin
// nombrarla, parece que "no se actualizó" en vez de que cambió de motivo.
// `summarizeOverdueDebt` identifica CUÁL(es) período(s) siguen vencidos para
// poder mostrar "Julio vencido" o "2 meses vencidos" en vez del genérico.
// ---------------------------------------------------------------------------

export interface OverdueDebtSummary {
  /** Cantidad de obligaciones vigentes con saldo real positivo y ya vencidas (etapa distinta de "en término"). */
  count: number;
  /** `null` cuando `count` es 0 — nunca se muestra ningún badge en ese caso. */
  label: string | null;
}

/**
 * A partir de las mismas `charges`/`chargeStates` (mismo índice, tal como las
 * devuelve `buildStudentPaymentsSummary`) identifica la deuda REALMENTE
 * vencida — nunca de un campo heredado — y arma un texto específico:
 *   - una sola obligación mensual vencida → "Julio vencido" (mes real).
 *   - varias obligaciones, todas mensuales → "N meses vencidos".
 *   - alguna obligación no mensual (por clase/semanal/quincenal/paquete)
 *     entre las vencidas → texto genérico seguro ("Pago vencido" / "N pagos
 *     vencidos"), porque esos tipos no tienen un "mes" que nombrar. Pura.
 */
// Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
// contradictorios "Agosto pendiente" + "Pago vencido" en la lista de
// Alumnos): antes, una obligación vencida que NO fuera mensual (por
// ejemplo, un cargo `por_clase` residual) siempre caía en el texto
// genérico "Pago vencido" — la profesora no podía saber DE QUÉ clase se
// trataba, lo que hacía parecer un error de la app en vez de una deuda
// real y puntual. Ahora una única obligación por clase vencida nombra la
// fecha exacta ("Clase del 07/08 vencida"), igual criterio que ya se usaba
// para una mensualidad ("Julio vencido"). Cuando hay VARIAS obligaciones
// vencidas de tipos distintos (o varias por clase), el texto agrupado pasa
// a decir "N obligaciones vencidas" (antes "N pagos vencidos") — mismo
// criterio, wording más claro. El caso de varios MESES vencidos, todos
// mensuales, conserva su texto ya aprobado ("N meses vencidos"): es más
// específico que el genérico y no tenía ningún problema reportado.
export function summarizeOverdueDebt(input: {
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  /**
   * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
   * mensualidades "Mes vencido" al comenzar el mes): opcional — un llamador
   * que no lo provee conserva el criterio anterior (`stage !== 'on_time'`)
   * para TODOS los tipos, ningún test/llamador existente cambia de
   * comportamiento. Con `evaluationDate`, una mensualidad usa el
   * vencimiento real (`isChargeOverdueForDisplay`) en vez de la etapa de
   * recargo — el resto de los tipos no cambia.
   */
  evaluationDate?: string;
}): OverdueDebtSummary {
  const overdueMonthlyPeriods: string[] = [];
  const overduePerClassDates: string[] = [];
  let overdueOtherCount = 0;

  input.charges.forEach((charge, index) => {
    const state = input.chargeStates[index];
    if (state.balance <= 0) return;
    const isOverdue = input.evaluationDate
      ? isChargeOverdueForDisplay(charge.type, charge.dueDate, state.stage, input.evaluationDate)
      : state.stage !== 'on_time';
    if (!isOverdue) return;
    if (charge.type === 'mensual' && charge.billingPeriod) {
      overdueMonthlyPeriods.push(charge.billingPeriod);
    } else if (charge.type === 'por_clase') {
      overduePerClassDates.push(charge.dueDate);
    } else {
      overdueOtherCount += 1;
    }
  });

  const count = overdueMonthlyPeriods.length + overduePerClassDates.length + overdueOtherCount;
  if (count === 0) return { count: 0, label: null };

  if (count === 1) {
    if (overdueMonthlyPeriods.length === 1) {
      return { count: 1, label: `${formatBillingPeriodMonthOnly(overdueMonthlyPeriods[0])} vencido` };
    }
    if (overduePerClassDates.length === 1) {
      return { count: 1, label: `Clase del ${formatDateKeyDayMonth(toDateKey(overduePerClassDates[0]))} vencida` };
    }
    return { count: 1, label: 'Pago vencido' };
  }

  if (overduePerClassDates.length === 0 && overdueOtherCount === 0) {
    return { count, label: `${count} meses vencidos` };
  }

  return { count, label: `${count} obligaciones vencidas` };
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
// flujo financiero mensual): causa raíz del caso demostrado ($185.000 →
// $192.000) — "Marcar mes actual como pagado" y la vista previa que lo
// antecede usaban el precio VIGENTE DEL PLAN como importe a pagar, sin
// comprobar el saldo real del cargo YA MATERIALIZADO del período (que puede
// tener un `originalAmount` distinto si el plan cambió después de generarse
// el cargo). `resolveSuggestedMonthlyPaymentAmount` es la ÚNICA fuente del
// importe sugerido: la usa tanto la vista previa (antes de confirmar) como
// el servicio que efectivamente registra el pago — nunca pueden divergir,
// porque son la misma función. Nunca propone más de lo que el cargo puede
// aceptar de forma segura.
// ---------------------------------------------------------------------------

export interface SuggestedMonthlyPaymentAmount {
  billingPeriod: string;
  /** true si ya existe un `PaymentCharge` vigente (no anulado) para este período. */
  chargeExists: boolean;
  /**
   * Importe a proponer: el saldo REAL del cargo si ya existe (nunca el
   * precio del plan a secas), o el importe efectivo del plan si el cargo
   * todavía no se generó (sin riesgo de divergencia: nace con ese importe).
   * 0 cuando no hay nada que pagar (cargo ya saldado).
   */
  amount: number;
  /** true si el cargo existente ya está saldado por completo — no hay nada que pagar. */
  alreadySettled: boolean;
}

export function resolveSuggestedMonthlyPaymentAmount(input: {
  plan: MonthlyBillingPlan;
  charges: PaymentCharge[];
  chargeStates: ChargeComputedState[];
  evaluationDate: string;
}): SuggestedMonthlyPaymentAmount {
  const billingPeriod = billingPeriodOfDateKey(input.evaluationDate);
  const index = input.charges.findIndex(
    (charge) => charge.type === 'mensual' && charge.billingPeriod === billingPeriod
  );

  if (index === -1) {
    return {
      billingPeriod,
      chargeExists: false,
      amount: resolveEffectiveMonthlyAmount(input.plan, billingPeriod),
      alreadySettled: false,
    };
  }

  const balance = Math.max(input.chargeStates[index].balance, 0);
  return { billingPeriod, chargeExists: true, amount: balance, alreadySettled: balance <= 0 };
}
