/**
 * Capacidad del almacenamiento de archivos (Supabase Storage) antes de copiar las fotos del teléfono. PURO.
 *
 * El plan del proyecto NO se puede consultar desde la computadora sin credenciales del panel de Supabase, así que la comprobación usa el piso que garantiza CUALQUIER plan
 * (el gratuito incluye 1 GB de archivos y admite archivos de hasta 50 MB; los planes pagos, mucho más): si entra en ese piso, entra en cualquier plan. El cupo real puede
 * indicarse con `TF_STORAGE_QUOTA_BYTES` si algún día se quiere medir contra otro valor.
 */

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;
/** Piso garantizado por cualquier plan de Supabase para los archivos (1 GB). */
export const MINIMUM_PLAN_QUOTA_BYTES = 1 * GIB;
/** Tope de un archivo en cualquier plan (50 MB) y tope propio del bucket `lesson-files` (20 MiB, migración R10): rige el menor. */
export const BUCKET_FILE_LIMIT_BYTES = 20 * MIB;
/** Margen que se deja libre: nunca se llena el cupo. */
export const RESERVE_RATIO = 0.1;

/** Megabytes con un decimal, sin formateadores de la interfaz (esto es una herramienta de línea de comandos). */
const mb = (bytes: number): number => Math.round((bytes / MIB) * 10) / 10;

export interface CapacityInput {
  /** Bytes que faltan copiar (lo declarado por la app para los archivos pendientes). */
  requiredBytes: number;
  /** Bytes que la cuenta ya ocupa (archivos ya copiados y, por prudencia, el tope de cada PDF de reporte existente). */
  usedBytes: number;
  /** El archivo más grande que falta copiar. */
  largestFileBytes: number;
  quotaBytes?: number;
}

export interface CapacityVerdict {
  ok: boolean;
  requiredBytes: number;
  usedBytes: number;
  quotaBytes: number;
  usableBytes: number;
  freeAfterBytes: number;
  percentUsedAfter: number;
  reasons: string[];
}

export function checkStorageCapacity(input: CapacityInput): CapacityVerdict {
  const quotaBytes = input.quotaBytes && input.quotaBytes > 0 ? input.quotaBytes : MINIMUM_PLAN_QUOTA_BYTES;
  const usableBytes = Math.floor(quotaBytes * (1 - RESERVE_RATIO));
  const after = input.usedBytes + input.requiredBytes;
  const reasons: string[] = [];
  if (input.largestFileBytes > BUCKET_FILE_LIMIT_BYTES) reasons.push(`Hay un archivo de ${mb(input.largestFileBytes)} MB y el tope por archivo es ${BUCKET_FILE_LIMIT_BYTES / MIB} MB.`);
  if (after > usableBytes) reasons.push(`No entra en el almacenamiento: faltan ${mb(after - usableBytes)} MB (se necesitan ${mb(after)} MB y se pueden usar ${mb(usableBytes)} MB, dejando ${RESERVE_RATIO * 100}% libre).`);
  return { ok: reasons.length === 0, requiredBytes: input.requiredBytes, usedBytes: input.usedBytes, quotaBytes, usableBytes, freeAfterBytes: quotaBytes - after, percentUsedAfter: Math.round((after / quotaBytes) * 1000) / 10, reasons };
}

export function describeCapacity(v: CapacityVerdict): string {
  return `Almacenamiento: se copian ${mb(v.requiredBytes)} MB sobre ${mb(v.usedBytes)} MB ya usados → ${v.percentUsedAfter}% del cupo mínimo garantizado de ${Math.round(v.quotaBytes / MIB)} MB (${v.ok ? "entra con margen" : "NO ENTRA"}).`;
}
