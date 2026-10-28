// Puerto VERBATIM del original (`src/features/payments/hooks/monthlyAmountCorrectionLogStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { MonthlyAmountCorrectionEntry } from '../types/index.ts';
import { isValidBillingPeriod } from '../utils/paymentDates.ts';

/**
 * Corrección 2026-07-30 (a pedido de Joaquín — editar monto mensual):
 * registro de auditoría de correcciones de importe mensual — mismo patrón
 * mínimo (lectura/escritura directa, sin cola de mutaciones ni rollback)
 * que `dailyCollectionsNoticeStore.ts`, a propósito más simple que
 * `paymentsStore.ts`/`packagesStore.ts`: acá nunca hay dos escrituras
 * concurrentes reales (una corrección de monto es una acción manual,
 * puntual, de la profesora) y el contenido es sólo un registro histórico
 * de auditoría — nunca la fuente de verdad del saldo (esa sigue siendo
 * `PaymentCharge.originalAmount`, corregido aparte por
 * `monthlyAmountCorrection.ts`). Aun así SÍ participa del respaldo
 * (`backupKeys.ts`), a diferencia del aviso diario: es información
 * financiera real que la profesora puede necesitar consultar después.
 */
export const MONTHLY_AMOUNT_CORRECTION_LOG_STORAGE_KEY = '@teacherflow/monthly_amount_correction_log';

function isValidMonthlyAmountCorrectionEntry(value: unknown): value is MonthlyAmountCorrectionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.studentId === 'string' &&
    candidate.studentId.trim().length > 0 &&
    typeof candidate.billingPeriod === 'string' &&
    isValidBillingPeriod(candidate.billingPeriod) &&
    typeof candidate.previousAmount === 'number' &&
    Number.isFinite(candidate.previousAmount) &&
    typeof candidate.newAmount === 'number' &&
    Number.isFinite(candidate.newAmount) &&
    typeof candidate.changedAt === 'string' &&
    !Number.isNaN(new Date(candidate.changedAt).getTime()) &&
    typeof candidate.reason === 'string'
  );
}

/**
 * Parseo puro, separado de AsyncStorage para poder probarlo directamente.
 * Cualquier entrada individual corrupta se descarta en vez de invalidar
 * todo el registro — es un log de auditoría best-effort, nunca la fuente
 * de verdad del saldo real.
 */
export function parsePersistedMonthlyAmountCorrectionLog(raw: string | null): MonthlyAmountCorrectionEntry[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidMonthlyAmountCorrectionEntry);
}

export async function loadMonthlyAmountCorrectionLog(): Promise<MonthlyAmountCorrectionEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(MONTHLY_AMOUNT_CORRECTION_LOG_STORAGE_KEY);
    return parsePersistedMonthlyAmountCorrectionLog(raw);
  } catch {
    return [];
  }
}

export async function saveMonthlyAmountCorrectionLog(entries: MonthlyAmountCorrectionEntry[]): Promise<void> {
  await AsyncStorage.setItem(MONTHLY_AMOUNT_CORRECTION_LOG_STORAGE_KEY, JSON.stringify(entries));
}

/** Agrega una entrada nueva al final del registro — nunca reemplaza ni borra las anteriores. */
export async function appendMonthlyAmountCorrectionEntry(entry: MonthlyAmountCorrectionEntry): Promise<void> {
  const current = await loadMonthlyAmountCorrectionLog();
  await saveMonthlyAmountCorrectionLog([...current, entry]);
}
