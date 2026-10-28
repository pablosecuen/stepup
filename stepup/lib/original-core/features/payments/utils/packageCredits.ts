// Puerto VERBATIM del original (`src/features/payments/utils/packageCredits.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PackageCreditMovement, PackageCreditsSummary, PackagePurchase } from '../types/index.ts';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): motor puro de créditos de paquete. Nunca permite créditos
 * negativos en silencio — `planPackageCreditConsumption` rechaza
 * explícitamente si no hay disponibles, en vez de dejar `available` en
 * negativo.
 */
export function computePackageCreditsSummary(
  purchase: PackagePurchase,
  movements: PackageCreditMovement[]
): PackageCreditsSummary {
  const consumed = movements
    .filter((movement) => movement.packageId === purchase.id && movement.voidedAt === null)
    .reduce((sum, movement) => sum + movement.amount, 0);
  const available = purchase.includedClasses - consumed;
  return {
    packageId: purchase.id,
    includedClasses: purchase.includedClasses,
    consumed,
    available,
    isExhausted: available <= 0,
  };
}

export function hasConsumedCreditForLesson(packageId: string, savedLessonId: string, movements: PackageCreditMovement[]): boolean {
  return movements.some(
    (movement) =>
      movement.packageId === packageId &&
      movement.type === 'consumo' &&
      movement.savedLessonId === savedLessonId &&
      movement.voidedAt === null
  );
}

export type PackageCreditConsumptionResult =
  | { ok: true; movement: PackageCreditMovement }
  | { ok: false; reason: 'ya_consumido' | 'sin_creditos_disponibles' | 'paquete_no_vigente' };

/**
 * Decide si dictar `savedLessonId` puede consumir un crédito del paquete.
 * Idempotente: si ya existe un movimiento de consumo para esa clase exacta,
 * no crea uno nuevo (nunca descuenta dos veces la misma clase). Nunca deja
 * `available` en negativo — si no hay créditos, rechaza en vez de restar.
 * Pura — no persiste nada, sólo decide.
 */
export function planPackageCreditConsumption(input: {
  purchase: PackagePurchase;
  movements: PackageCreditMovement[];
  studentId: string;
  savedLessonId: string;
  lessonDate: string; // YYYY-MM-DD
  createdAt: string; // ISO
  id: string;
}): PackageCreditConsumptionResult {
  const { purchase, movements, studentId, savedLessonId, lessonDate, createdAt, id } = input;

  if (purchase.voidedAt !== null) {
    return { ok: false, reason: 'paquete_no_vigente' };
  }
  if (lessonDate < purchase.validFrom || (purchase.validUntil && lessonDate > purchase.validUntil)) {
    return { ok: false, reason: 'paquete_no_vigente' };
  }
  if (hasConsumedCreditForLesson(purchase.id, savedLessonId, movements)) {
    return { ok: false, reason: 'ya_consumido' };
  }

  const summary = computePackageCreditsSummary(purchase, movements);
  if (summary.available <= 0) {
    return { ok: false, reason: 'sin_creditos_disponibles' };
  }

  return {
    ok: true,
    movement: {
      id,
      packageId: purchase.id,
      studentId,
      type: 'consumo',
      amount: 1,
      savedLessonId,
      createdAt,
      voidedAt: null,
      voidReason: null,
    },
  };
}

/** El paquete vigente más reciente (mayor `validFrom`) y no anulado de un alumno, o null si no tiene ninguno. */
export function findActivePackage(studentId: string, purchases: PackagePurchase[], todayDateKey: string): PackagePurchase | null {
  const candidates = purchases.filter(
    (purchase) =>
      purchase.studentId === studentId &&
      purchase.voidedAt === null &&
      purchase.validFrom <= todayDateKey &&
      (!purchase.validUntil || purchase.validUntil >= todayDateKey)
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (candidate.validFrom > latest.validFrom ? candidate : latest));
}
