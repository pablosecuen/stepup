// Puerto VERBATIM del original (`src/features/payments/utils/paymentIdempotency.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge } from '../types/index.ts';

/**
 * Clave determinística de una obligación mensual: (alumno, período). Dos
 * llamados con los mismos datos producen siempre el mismo id, así crear el
 * cargo es idempotente sin necesitar una consulta previa.
 */
export function buildMonthlyChargeId(studentId: string, billingPeriod: string): string {
  return `charge_mensual_${studentId}_${billingPeriod}`;
}

/** Clave determinística de una obligación por clase: (alumno, clase pedagógica). */
export function buildPerClassChargeId(studentId: string, savedLessonId: string): string {
  return `charge_por_clase_${studentId}_${savedLessonId}`;
}

/**
 * true si ya existe (anulada o no) un cargo con ese id exacto. Se usa
 * antes de crear un cargo nuevo para no generar dos obligaciones por la
 * misma mensualidad o la misma clase.
 */
export function chargeAlreadyExists(chargeId: string, charges: PaymentCharge[]): boolean {
  return charges.some((charge) => charge.id === chargeId);
}

/**
 * true si ya existe una obligación mensual vigente (no importa si está
 * saldada) para ese alumno y período — atajo sobre `chargeAlreadyExists`
 * usando la clave determinística.
 */
export function hasMonthlyCharge(studentId: string, billingPeriod: string, charges: PaymentCharge[]): boolean {
  return chargeAlreadyExists(buildMonthlyChargeId(studentId, billingPeriod), charges);
}

export function hasPerClassCharge(studentId: string, savedLessonId: string, charges: PaymentCharge[]): boolean {
  return chargeAlreadyExists(buildPerClassChargeId(studentId, savedLessonId), charges);
}

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): mismo criterio de idempotencia (alumno, período) que
 * mensual, generalizado a semanal/quincenal — `periodKey` ya viene resuelto
 * por el llamador (`isoWeekKey`/`biweeklyPeriodKey`).
 */
export function buildPeriodicChargeId(kind: 'semanal' | 'quincenal', studentId: string, periodKey: string): string {
  return `charge_${kind}_${studentId}_${periodKey}`;
}

export function hasPeriodicCharge(
  kind: 'semanal' | 'quincenal',
  studentId: string,
  periodKey: string,
  charges: PaymentCharge[]
): boolean {
  return chargeAlreadyExists(buildPeriodicChargeId(kind, studentId, periodKey), charges);
}

/** Clave determinística de la obligación de COMPRA de un paquete: (alumno, paquete). */
export function buildPackagePurchaseChargeId(studentId: string, packageId: string): string {
  return `charge_paquete_${studentId}_${packageId}`;
}

export function hasPackagePurchaseCharge(studentId: string, packageId: string, charges: PaymentCharge[]): boolean {
  return chargeAlreadyExists(buildPackagePurchaseChargeId(studentId, packageId), charges);
}

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional): clave
 * determinística (alumno, período) para `FirstMonthProrationDecision` —
 * mismo criterio que `buildMonthlyChargeId`, en un espacio de ids propio
 * (nunca colisiona con un `PaymentCharge`, son colecciones distintas).
 */
export function buildFirstMonthProrationDecisionId(studentId: string, billingPeriod: string): string {
  return `firstmonth_${studentId}_${billingPeriod}`;
}

/**
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural,
 * "IDENTIDAD SIN COLISIONES"): antepone la LONGITUD real de `value` antes
 * de su contenido (`"<longitud>:<valor>"`, mismo principio que un
 * netstring) — así, al concatenar varios componentes de longitud variable,
 * el punto de corte entre uno y el siguiente queda determinado de forma
 * única SIN IMPORTAR qué caracteres (incluido "_", el propio separador)
 * contenga cada valor. Necesario porque `trainingBillingAgreementId` nace
 * como `training_agreement_<recurrenceId>` (con guiones bajos propios) y
 * `studentId` también puede contenerlos — una concatenación ingenua
 * `"${a}_${b}"` puede volverse indistinguible entre dos pares (a, b)
 * legítimamente distintos (ver la prueba adversarial en
 * `paymentIdempotency.test.ts`).
 */
function encodeIdSegment(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): clave determinística de una cuota de entrenamiento —
 * (acuerdo estable de la serie, alumno, período). Incluir
 * `trainingBillingAgreementId` es lo que garantiza que dos series de
 * entrenamiento distintas (o una mensualidad de clases del mismo alumno,
 * que usa `buildMonthlyChargeId` sin este prefijo) nunca colisionen ni se
 * fusionen — un alumno en dos series a la vez recibe dos cargos con ids
 * distintos, cada uno idempotente por sí mismo. `trainingBillingAgreementId`
 * y `studentId` se codifican con `encodeIdSegment` (longitud + contenido)
 * — nunca una concatenación cruda — para que ningún par distinto de esos
 * dos valores pueda producir el mismo id final; `billingPeriod` siempre
 * tiene formato fijo 'YYYY-MM' y va al final, sin ambigüedad posible.
 */
export function buildTrainingChargeId(
  trainingBillingAgreementId: string,
  studentId: string,
  billingPeriod: string
): string {
  return `charge_entrenamiento_${encodeIdSegment(trainingBillingAgreementId)}_${encodeIdSegment(studentId)}_${billingPeriod}`;
}

export function hasTrainingCharge(
  trainingBillingAgreementId: string,
  studentId: string,
  billingPeriod: string,
  charges: PaymentCharge[]
): boolean {
  return chargeAlreadyExists(buildTrainingChargeId(trainingBillingAgreementId, studentId, billingPeriod), charges);
}
