// Puerto VERBATIM del original (`src/features/payments/hooks/initialPaidSurchargeCorrectionLogStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { InitialPaidSurchargeCorrectionEntry } from '../types/index.ts';
import { isValidBillingPeriod } from '../utils/paymentDates.ts';

/**
 * Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de alumnos
 * nuevos): registro de auditoría de la reparación de recargos incorrectos
 * originados por el bug de fecha de alta — mismo patrón mínimo (lectura/
 * escritura directa, sin cola de mutaciones ni rollback) que
 * `monthlyAmountCorrectionLogStore.ts`: acá nunca hay dos escrituras
 * concurrentes reales que dependan de este store (la mutación financiera
 * real ya está serializada por `paymentsStore.ts`; esto es sólo el
 * registro histórico aparte). SÍ participa del respaldo (`backupKeys.ts`),
 * igual que el log de corrección de monto.
 */
export const INITIAL_PAID_SURCHARGE_CORRECTION_LOG_STORAGE_KEY =
  '@teacherflow/initial_paid_surcharge_correction_log';

function isValidInitialPaidSurchargeCorrectionEntry(
  value: unknown
): value is InitialPaidSurchargeCorrectionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.studentId === 'string' &&
    candidate.studentId.trim().length > 0 &&
    typeof candidate.billingPeriod === 'string' &&
    isValidBillingPeriod(candidate.billingPeriod) &&
    typeof candidate.previousSurchargeAmount === 'number' &&
    Number.isFinite(candidate.previousSurchargeAmount) &&
    typeof candidate.voidedPaymentId === 'string' &&
    candidate.voidedPaymentId.trim().length > 0 &&
    typeof candidate.newPaymentId === 'string' &&
    candidate.newPaymentId.trim().length > 0 &&
    typeof candidate.correctedAt === 'string' &&
    !Number.isNaN(new Date(candidate.correctedAt).getTime()) &&
    typeof candidate.reason === 'string'
  );
}

/**
 * Parseo puro, separado de AsyncStorage para poder probarlo directamente.
 * Cualquier entrada individual corrupta se descarta en vez de invalidar
 * todo el registro — log de auditoría best-effort, nunca la fuente de
 * verdad del saldo real (esa sigue siendo `PaymentCharge`/`Payment`/
 * `PaymentAllocation`).
 */
export function parsePersistedInitialPaidSurchargeCorrectionLog(
  raw: string | null
): InitialPaidSurchargeCorrectionEntry[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidInitialPaidSurchargeCorrectionEntry);
}

export async function loadInitialPaidSurchargeCorrectionLog(): Promise<InitialPaidSurchargeCorrectionEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(INITIAL_PAID_SURCHARGE_CORRECTION_LOG_STORAGE_KEY);
    return parsePersistedInitialPaidSurchargeCorrectionLog(raw);
  } catch {
    return [];
  }
}

export async function saveInitialPaidSurchargeCorrectionLog(
  entries: InitialPaidSurchargeCorrectionEntry[]
): Promise<void> {
  await AsyncStorage.setItem(INITIAL_PAID_SURCHARGE_CORRECTION_LOG_STORAGE_KEY, JSON.stringify(entries));
}

/** Agrega una entrada nueva al final del registro — nunca reemplaza ni borra las anteriores. */
export async function appendInitialPaidSurchargeCorrectionEntry(
  entry: InitialPaidSurchargeCorrectionEntry
): Promise<void> {
  const current = await loadInitialPaidSurchargeCorrectionLog();
  await saveInitialPaidSurchargeCorrectionLog([...current, entry]);
}
