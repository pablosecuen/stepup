// Puerto VERBATIM del original (`src/features/payments/services/packagePurchaseService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { applyPaymentsMutation, hydratePaymentsStore } from '../hooks/paymentsStore.ts';
import { applyPackagesMutation, getPackagesSnapshot, hydratePackagesStore } from '../hooks/packagesStore.ts';
import type { PackageCreditMovement, PackagePurchase } from '../types/index.ts';
import { buildPackagePurchaseCharge } from '../utils/paymentMutations.ts';
import { findActivePackage, planPackageCreditConsumption } from '../utils/packageCredits.ts';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): registra la compra de un paquete de clases. Crea el
 * `PackagePurchase` (store de paquetes) y su `PaymentCharge` tipo
 * `'paquete'` (store de pagos) en dos pasos secuenciales — mismo criterio ya
 * usado en `useSaveClass.ts` (guarda la clase y después reconcilia el
 * cargo, sin transacción cruzada única entre stores). `packageId` es
 * determinístico por (alumno, fecha de inicio): dos compras del mismo
 * alumno con el mismo `validFrom` son la misma obligación, nunca se
 * duplican.
 */
export function buildPackageId(studentId: string, validFrom: string): string {
  return `pkg_${studentId}_${validFrom}`;
}

export interface RegisterPackagePurchaseInput {
  studentId: string;
  includedClasses: number;
  amount: number;
  validFrom: string; // YYYY-MM-DD
  validUntil?: string;
  createdAt: string; // ISO
}

export interface RegisterPackagePurchaseResult {
  purchase: PackagePurchase;
  chargeId: string;
  alreadyExisted: boolean;
}

export async function registerPackagePurchase(
  input: RegisterPackagePurchaseInput
): Promise<RegisterPackagePurchaseResult> {
  if (!Number.isInteger(input.includedClasses) || input.includedClasses <= 0) {
    throw new RangeError('La cantidad de clases incluidas debe ser un entero positivo.');
  }

  await hydratePackagesStore();
  const packageId = buildPackageId(input.studentId, input.validFrom);
  const existing = getPackagesSnapshot().purchases.find((purchase) => purchase.id === packageId);

  if (existing) {
    return { purchase: existing, chargeId: `charge_paquete_${input.studentId}_${packageId}`, alreadyExisted: true };
  }

  const purchase: PackagePurchase = {
    id: packageId,
    studentId: input.studentId,
    includedClasses: input.includedClasses,
    amount: input.amount,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    createdAt: input.createdAt,
    voidedAt: null,
    voidReason: null,
  };

  await applyPackagesMutation((current) => ({
    ...current,
    purchases: [...current.purchases, purchase],
  }));

  await hydratePaymentsStore();
  let chargeId = '';
  await applyPaymentsMutation((current) => {
    const charge = buildPackagePurchaseCharge({
      studentId: input.studentId,
      packageId,
      dueDate: input.validFrom,
      originalAmount: input.amount,
      createdAt: input.createdAt,
      existingCharges: current.charges,
    });
    chargeId = charge.id;
    return { ...current, charges: [...current.charges, charge] };
  });

  return { purchase, chargeId, alreadyExisted: false };
}

export interface ConsumePackageCreditInput {
  studentId: string;
  savedLessonId: string;
  lessonDate: string; // YYYY-MM-DD
  createdAt: string; // ISO
}

export type ConsumePackageCreditOutcome =
  | { status: 'consumido'; movement: PackageCreditMovement }
  | { status: 'sin_paquete_activo' }
  | { status: 'rechazado'; reason: 'ya_consumido' | 'sin_creditos_disponibles' | 'paquete_no_vigente' };

/**
 * Consume un crédito de paquete al registrar una clase efectivamente
 * dictada. Idempotente por `(packageId, savedLessonId)` — llamarla dos
 * veces para la misma clase nunca descuenta doble. NUNCA debe llamarse
 * para una clase cancelada, ausencia docente, reprogramada, eliminada o un
 * borrador (esa decisión es responsabilidad del llamador: esta función sólo
 * ejecuta el consumo, no decide cuándo corresponde).
 */
export async function consumePackageCreditForLesson(
  input: ConsumePackageCreditInput
): Promise<ConsumePackageCreditOutcome> {
  await hydratePackagesStore();

  let outcome: ConsumePackageCreditOutcome = { status: 'sin_paquete_activo' };

  await applyPackagesMutation((current) => {
    const activePackage = findActivePackage(input.studentId, current.purchases, input.lessonDate);
    if (!activePackage) {
      outcome = { status: 'sin_paquete_activo' };
      return current;
    }

    const result = planPackageCreditConsumption({
      purchase: activePackage,
      movements: current.creditMovements,
      studentId: input.studentId,
      savedLessonId: input.savedLessonId,
      lessonDate: input.lessonDate,
      createdAt: input.createdAt,
      id: `pcm_${activePackage.id}_${input.savedLessonId}`,
    });

    if (!result.ok) {
      outcome = { status: 'rechazado', reason: result.reason };
      return current;
    }

    outcome = { status: 'consumido', movement: result.movement };
    return { ...current, creditMovements: [...current.creditMovements, result.movement] };
  });

  return outcome;
}
