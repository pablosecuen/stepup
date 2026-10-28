// Puerto VERBATIM del original (`src/features/payments/utils/collectionsCenter.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { FirstMonthProrationDecision, PaymentChargeType, PaymentsRepositoryState } from '../types/index.ts';
import type { StudentStatus } from '../../student-profile/types/index.ts';
import { calculateChargeState } from './paymentCalculations.ts';
import { formatBillingPeriodLong, formatDateKeyDMY } from './paymentFormat.ts';
import { billingPeriodOfDateKey } from './paymentDates.ts';
import { resolveMonthlyDueDateUrgency } from './paymentDueStage.ts';
import { findFirstMonthProrationReviewNeeds } from './firstMonthProration.ts';
import { isStudentEligibleForCollectionsDisplay } from './studentCollectionEligibility.ts';
import { DEFAULT_SURCHARGE_SETTINGS, resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
 * configurables): `'vencido'` es el urgencia GENÉRICA usada en vez de
 * `primer_vencimiento`/`segundo_vencimiento`/`ultimo_vencimiento` cuando
 * los recargos están desactivados para ese cargo — "no mostrar Primer/
 * Segundo/Último vencimiento" aplica también acá, nunca sólo a la lista de
 * Alumnos.
 *
 * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
 * mensualidades "Mes vencido" al comenzar el mes): `'vence_pronto'` es
 * EXCLUSIVA de mensualidades, 3 días corridos antes del vencimiento real
 * (`resolveMonthlyDueDateUrgency`) — todavía no vencida, informa
 * `daysUntilDue`.
 */
export type CollectionUrgency =
  | 'vence_pronto'
  | 'vence_hoy'
  | 'primer_vencimiento'
  | 'segundo_vencimiento'
  | 'ultimo_vencimiento'
  | 'vencido';

/**
 * Orden de urgencia para el Centro de cobros: 0 es lo más urgente (último
 * vencimiento), 4 lo menos urgente de lo que igual aparece en la lista
 * (vence pronto — todavía ni siquiera venció). `'vencido'` (recargos
 * desactivados) comparte el rango más urgente: sin etapas para discriminar
 * severidad, cualquier deuda vencida necesita atención con la misma
 * prioridad.
 */
export const URGENCY_RANK: Record<CollectionUrgency, number> = {
  ultimo_vencimiento: 0,
  vencido: 0,
  segundo_vencimiento: 1,
  primer_vencimiento: 2,
  vence_hoy: 3,
  vence_pronto: 4,
};

export interface CollectionEntry {
  chargeId: string;
  studentId: string;
  chargeType: PaymentChargeType;
  /** "Mensualidad de julio 2026" o "Clase del 11/07/2026" — distingue mensualidades de clases individuales. */
  concept: string;
  /** Saldo pendiente (con el recargo vigente incluido), siempre positivo. */
  pendingAmount: number;
  /** Fecha de vencimiento, YYYY-MM-DD (mostrar siempre en DD/MM/YYYY con `formatDateKeyDMY`). */
  dueDate: string;
  urgency: CollectionUrgency;
  /** Corrección 2026-09-02 (a pedido de Joaquín — "vence pronto" debe informar los días restantes): sólo presente cuando `urgency === 'vence_pronto'`. */
  daysUntilDue?: number;
  /** true si ya se registró al menos un pago parcial vigente contra este cargo, aunque quede saldo pendiente. */
  hasPartialPayment: boolean;
  /**
   * Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — HACER
   * CORREGIBLE EL PRORRATEO HISTÓRICO MARCADO PARA REVISIÓN): true cuando
   * este cargo corresponde a una decisión de primer mes proporcional de
   * origen ambiguo (`findFirstMonthProrationReviewNeeds`) — nunca se
   * recalcula por separado acá, reutiliza la misma función pura que
   * `CobrosTab.tsx`. La profesora ve una acción "Revisar primer mes
   * proporcional" además de "Registrar pago" en esta misma tarjeta.
   */
  needsFirstMonthProrationReview: boolean;
}

/**
 * Corrección 2026-10-04 (a pedido de Joaquín — CENTRO DE COBROS: una clase
 * suelta aparecía "Mes vencido"): texto de la urgencia genérica `'vencido'`
 * según el tipo de cargo. "Mes vencido" sólo describe un período mensual
 * (mensualidad y cuota de entrenamiento); cualquier otro cargo (por clase,
 * semanal, quincenal, paquete) es "Pago vencido" — el mismo texto que ya usa la
 * lista de Alumnos para ese estado. Única fuente: la pantalla nunca decide el
 * texto por su cuenta.
 */
export function resolveGenericOverdueLabel(chargeType: PaymentChargeType): 'Mes vencido' | 'Pago vencido' {
  return chargeType === 'mensual' || chargeType === 'entrenamiento' ? 'Mes vencido' : 'Pago vencido';
}

/** Exportada para que cualquier pantalla que muestre un cargo puntual (Centro de cobros, Cobros del alumno, anulación) use el MISMO texto — nunca una segunda redacción. */
export function buildConcept(input: {
  type: PaymentChargeType;
  billingPeriod?: string;
  dueDate: string;
  trainingSeriesName?: string;
}): string {
  if (input.type === 'mensual' && input.billingPeriod) {
    return `Mensualidad de ${formatBillingPeriodLong(input.billingPeriod)}`;
  }
  // Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
  // ENTRENAMIENTOS): concepto propio — nombre de la serie + mes — nunca el
  // texto genérico "Clase del DD/MM/YYYY" (esto no es una clase suelta), ni
  // el mismo texto que una mensualidad de clases (deben distinguirse de un
  // vistazo, nunca fusionarse).
  if (input.type === 'entrenamiento' && input.billingPeriod) {
    const seriesName = input.trainingSeriesName?.trim() || 'Entrenamiento';
    return `${seriesName} · ${formatBillingPeriodLong(input.billingPeriod)}`;
  }
  return `Clase del ${formatDateKeyDMY(input.dueDate)}`;
}

/**
 * Centro de cobros (Fase Pagos 4C.2): qué obligaciones necesitan atención
 * HOY — vencen hoy, están en cualquier etapa de mora, o tienen un pago
 * parcial con saldo todavía pendiente. Calculado exclusivamente desde
 * `PaymentCharge`/`Payment`/`PaymentAllocation`/`PaymentAdjustment` con el
 * motor puro ya existente (`calculateChargeState`) — nunca lee
 * `paymentStatus` heredado. Cargos y pagos anulados se ignoran por
 * completo (los anulados ni siquiera se evalúan). Una obligación saldada
 * (incluso con sobrepago) nunca aparece: ya no necesita atención.
 *
 * Una obligación "en término" (`stage: 'on_time'`) sólo entra a la lista si
 * su `dueDate` es EXACTAMENTE `evaluationDate` ("vence hoy") — todavía
 * dentro del margen de días de gracia pero sin vencer today no es urgente
 * y no se muestra (evita saturar el centro de cobros con obligaciones que
 * recién acaban de generarse).
 *
 * Cada cargo aparece como máximo UNA vez (nunca se duplica, incluso si el
 * array de entrada tuviera algún id repetido). El resultado siempre viene
 * ordenado con las situaciones más urgentes primero. Pura — no muta
 * `input.state`.
 *
 * Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
 * CIRCUITO DE COBROS): un cargo cuyo alumno NO está `'activo'` nunca entra
 * al Centro de cobros, sin importar su saldo/etapa — misma regla única que
 * el resto del dominio (`isStudentEligibleForCollectionsDisplay`). La deuda
 * real no se toca (`state` nunca se muta) — sólo deja de representarse como
 * una situación operativa vigente mientras el alumno esté pausado/inactivo/
 * archivado. `studentStatusById` es opcional (default: cualquier alumno se
 * trata como `'activo'`, el comportamiento previo) para no romper ningún
 * llamador/fixture existente que todavía no simula alumnos inactivos — el
 * llamador real (`useCollectionsCenter`) siempre construye el mapa completo
 * desde el store de alumnos.
 */
export function buildCollectionsCenterEntries(input: {
  state: PaymentsRepositoryState;
  evaluationDate: string;
  surchargeSettings?: SurchargeSettings;
  /** Decisiones de primer mes proporcional ya persistidas — opcional (default `[]`) para no romper ningún llamador existente que todavía no las conoce. */
  firstMonthProrationDecisions?: readonly FirstMonthProrationDecision[];
  /** Estado ACTUAL de cada alumno, por id — ver comentario de arriba. */
  studentStatusById?: ReadonlyMap<string, StudentStatus>;
}): CollectionEntry[] {
  const { state, evaluationDate, surchargeSettings, firstMonthProrationDecisions = [], studentStatusById } = input;
  const seenChargeIds = new Set<string>();
  const entries: CollectionEntry[] = [];
  const chargeIdsNeedingFirstMonthReview = new Set(
    findFirstMonthProrationReviewNeeds({
      decisions: firstMonthProrationDecisions,
      charges: state.charges,
      allocations: state.allocations,
    }).map((need) => need.chargeId)
  );

  state.charges
    .filter((charge) => charge.voidedAt === null)
    .filter((charge) => isStudentEligibleForCollectionsDisplay(studentStatusById?.get(charge.studentId) ?? 'activo'))
    .forEach((charge) => {
      if (seenChargeIds.has(charge.id)) return;
      seenChargeIds.add(charge.id);

      const chargeState = calculateChargeState({
        charge,
        allocations: state.allocations,
        payments: state.payments,
        adjustments: state.adjustments,
        evaluationDate,
        surchargeSettings,
      });
      const pendingAmount = Math.max(chargeState.balance, 0);
      if (pendingAmount <= 0) return;

      // Corrección 2026-08-12: `pendingAmount > 0` ya garantiza que el cargo
      // está ABIERTO (una obligación saldada nunca tiene `balance` positivo)
      // — se resuelve por `evaluationDate` (hoy), nunca por el período
      // propio del cargo, así una deuda vieja sin pagar refleja la
      // configuración vigente en este mismo instante.
      const surchargeEnabledForCharge = resolveEffectiveSurchargeTierValues(
        surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
        billingPeriodOfDateKey(evaluationDate)
      ).enabled;

      let urgency: CollectionUrgency;
      let daysUntilDue: number | undefined;

      // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
      // mensualidades "Mes vencido" al comenzar el mes): para 'mensual', la
      // pregunta "¿esto necesita atención?" ya NO se responde con la etapa
      // de recargo (`chargeState.stage`, ventana de gracia contada desde
      // `dueDate` — pensada para cuando `dueDate` era siempre el día 1) sino
      // con el vencimiento real (`resolveMonthlyDueDateUrgency`, única
      // fuente — nunca reimplementada acá). El resto de los tipos
      // (por_clase/semanal/quincenal/paquete) conserva EXACTAMENTE el
      // criterio de siempre.
      // Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO
      // DE ENTRENAMIENTOS, regla 9: "reutilizá las reglas existentes de
      // aviso, vencimiento..."): una cuota de entrenamiento vence exactamente
      // igual que una mensualidad de clases (mismo día 10 global) — nunca un
      // segundo cálculo de urgencia paralelo.
      if (charge.type === 'mensual' || charge.type === 'entrenamiento') {
        const dueStatus = resolveMonthlyDueDateUrgency(charge.dueDate, evaluationDate);
        if (dueStatus.urgency === 'pendiente_en_termino') return;
        if (dueStatus.urgency === 'vence_pronto') {
          urgency = 'vence_pronto';
          daysUntilDue = dueStatus.daysUntilDue;
        } else if (dueStatus.urgency === 'vence_hoy') {
          urgency = 'vence_hoy';
        } else if (!surchargeEnabledForCharge || chargeState.stage === 'on_time') {
          // Vencimiento real ya pasado, pero la etapa de RECARGO (su propia
          // ventana de gracia, independiente) todavía no salió de "en
          // término" — puede pasar si el `dueDay` configurado es más chico
          // que el `graceDay` del recargo. Nunca "Último vencimiento" sin
          // ninguna etapa de mora real detrás.
          urgency = 'vencido';
        } else if (chargeState.stage === 'first_late') {
          urgency = 'primer_vencimiento';
        } else if (chargeState.stage === 'second_late') {
          urgency = 'segundo_vencimiento';
        } else {
          urgency = 'ultimo_vencimiento';
        }
      } else if (chargeState.stage === 'on_time') {
        if (charge.dueDate !== evaluationDate) return;
        urgency = 'vence_hoy';
      } else if (!surchargeEnabledForCharge) {
        urgency = 'vencido';
      } else if (chargeState.stage === 'first_late') {
        urgency = 'primer_vencimiento';
      } else if (chargeState.stage === 'second_late') {
        urgency = 'segundo_vencimiento';
      } else {
        urgency = 'ultimo_vencimiento';
      }

      entries.push({
        chargeId: charge.id,
        studentId: charge.studentId,
        chargeType: charge.type,
        concept: buildConcept({
          type: charge.type,
          billingPeriod: charge.billingPeriod,
          dueDate: charge.dueDate,
          trainingSeriesName: charge.trainingSeriesName,
        }),
        pendingAmount,
        dueDate: charge.dueDate,
        urgency,
        daysUntilDue,
        hasPartialPayment: chargeState.paidAmount > 0,
        needsFirstMonthProrationReview: chargeIdsNeedingFirstMonthReview.has(charge.id),
      });
    });

  return entries.sort((a, b) => {
    if (URGENCY_RANK[a.urgency] !== URGENCY_RANK[b.urgency]) {
      return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
    }
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.pendingAmount !== b.pendingAmount) return b.pendingAmount - a.pendingAmount;
    return a.chargeId < b.chargeId ? -1 : a.chargeId > b.chargeId ? 1 : 0;
  });
}

export interface CollectionsUrgencySummary {
  /** Corrección 2026-09-02 (a pedido de Joaquín — mensualidades "Mes vencido" al comenzar el mes): mensualidades dentro de la ventana de 3 días antes del vencimiento — todavía no vencidas, nunca cuentan como "requieren atención urgente". */
  dueSoon: number;
  dueToday: number;
  firstLate: number;
  secondLate: number;
  lastLate: number;
  /**
   * Suma de las tres etapas de mora (primer + segundo + último
   * vencimiento) — NO incluye "vence hoy" ni "vence pronto": ninguna de las
   * dos es deuda vencida todavía, sólo necesitan aviso/atención hoy o en
   * los próximos días.
   */
  totalWithDebt: number;
  /** El rango de urgencia (`URGENCY_RANK`) más severo presente, o `null` si no hay ninguna entrada. */
  worstUrgencyRank: number | null;
}

/**
 * Cuenta las entradas del Centro de cobros por urgencia (Fase Pagos 4C.3,
 * aviso diario del Home) — nunca nombres ni importes, sólo cantidades.
 * Reutiliza directamente `CollectionEntry[]` ya construido por
 * `buildCollectionsCenterEntries`, sin volver a tocar el estado financiero.
 * Pura — no muta `entries`.
 */
export function summarizeCollectionsUrgency(entries: CollectionEntry[]): CollectionsUrgencySummary {
  let dueSoon = 0;
  let dueToday = 0;
  let firstLate = 0;
  let secondLate = 0;
  let lastLate = 0;
  let worstUrgencyRank: number | null = null;

  entries.forEach((entry) => {
    // `'vencido'` (recargos desactivados) cae en el mismo balde que
    // `'ultimo_vencimiento'` a propósito: comparten el mismo rango de
    // urgencia (0, el más severo) y este resumen sólo informa CANTIDADES,
    // nunca la etapa/nombre de cada obligación.
    if (entry.urgency === 'vence_pronto') dueSoon += 1;
    else if (entry.urgency === 'vence_hoy') dueToday += 1;
    else if (entry.urgency === 'primer_vencimiento') firstLate += 1;
    else if (entry.urgency === 'segundo_vencimiento') secondLate += 1;
    else lastLate += 1;

    const rank = URGENCY_RANK[entry.urgency];
    if (worstUrgencyRank === null || rank < worstUrgencyRank) {
      worstUrgencyRank = rank;
    }
  });

  return {
    dueSoon,
    dueToday,
    firstLate,
    secondLate,
    lastLate,
    totalWithDebt: firstLate + secondLate + lastLate,
    worstUrgencyRank,
  };
}
