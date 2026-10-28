// Puerto VERBATIM del original (`src/features/student-profile/utils/cefrLevel.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CEFRLevel } from '../types/index.ts';
import { daysBetweenDateKeys, isValidDateKey, toDateKey } from '../../payments/utils/paymentDates.ts';

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel):
 * ÚNICA fuente canónica del orden real de los niveles CEFR en TeacherFlow.
 * El tipo `CEFRLevel` está triplicado en `student-profile`/`students`/
 * `new-student` (deuda técnica preexistente, fuera de alcance de esta
 * corrección — tocar esos tres a la vez arriesga romper flujos no
 * relacionados), pero nunca existía un orden/comparación compartido: cada
 * pantalla que necesitaba una lista de niveles la reescribía a mano. Esta
 * función es la única que debe usarse para decidir si un cambio de nivel es
 * un salto, una corrección hacia abajo, o un paso normal.
 */
export const CEFR_LEVEL_ORDER: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function levelIndex(level: CEFRLevel): number {
  return CEFR_LEVEL_ORDER.indexOf(level);
}

/**
 * Corrección (a pedido de Joaquín — niveles personalizados): antes
 * asumía que `from`/`to` SIEMPRE eran uno de los 6 niveles CEFR reales —
 * `CEFRLevel` ahora también acepta el nombre de un nivel personalizado
 * (ver `CustomLevel`), que no tiene ningún lugar real en
 * `CEFR_LEVEL_ORDER`. `levelIndex` devuelve `-1` para esos casos; sin este
 * chequeo, la resta de dos `-1` (o de un índice real contra `-1`) daba un
 * número inventado, sin ningún sentido pedagógico real. `null` = "no hay
 * una distancia CEFR real que calcular" (uno de los dos lados, o los dos,
 * es un nivel personalizado) — nunca un número inventado.
 */
export function levelStepDistance(from: CEFRLevel, to: CEFRLevel): number | null {
  const fromIndex = levelIndex(from);
  const toIndex = levelIndex(to);
  if (fromIndex === -1 || toIndex === -1) return null;
  return toIndex - fromIndex;
}

/** `false` (nunca "sí") si `from`/`to` no son ambos niveles CEFR reales — un nivel personalizado nunca cuenta como una corrección hacia abajo. */
export function isLevelDowngrade(from: CEFRLevel, to: CEFRLevel): boolean {
  const distance = levelStepDistance(from, to);
  return distance !== null && distance < 0;
}

/** Un "salto" es avanzar más de un nivel de una sola vez (ej. A1 → B1). `false` si alguno de los dos lados es un nivel personalizado (ver `levelStepDistance`). */
export function isLevelJump(from: CEFRLevel, to: CEFRLevel): boolean {
  const distance = levelStepDistance(from, to);
  return distance !== null && distance > 1;
}

/**
 * Días calendario entre dos fechas ISO (o `YYYY-MM-DD`), reutilizando el
 * mismo motor de fechas ya probado en `payments/utils/paymentDates.ts`
 * (UTC-safe, sin drift de huso horario) — nunca una segunda implementación
 * de resta de fechas. `null` si alguna de las dos fechas no es válida.
 */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = toDateKey(fromIso);
  const to = toDateKey(toIso);
  if (!isValidDateKey(from) || !isValidDateKey(to)) return null;
  return daysBetweenDateKeys(from, to);
}

/**
 * "2 meses y 12 días" / "1 año y 3 meses" / "Hoy" — humaniza una cantidad
 * de días calendario. Usa meses de 30 días y años de 365 para la
 * conversión (aproximación deliberada: esto es una etiqueta amigable, no
 * un cálculo de facturación — nunca se usa para cobros ni para nada que
 * necesite precisión calendario exacta).
 */
export function formatElapsedDuration(days: number): string {
  if (days <= 0) return 'Hoy';
  if (days < 30) return days === 1 ? '1 día' : `${days} días`;

  const years = Math.floor(days / 365);
  const remainingAfterYears = days % 365;
  const months = Math.floor(remainingAfterYears / 30);
  const remainingDays = remainingAfterYears % 30;

  if (years > 0) {
    const yearPart = years === 1 ? '1 año' : `${years} años`;
    if (months === 0) return yearPart;
    const monthPart = months === 1 ? '1 mes' : `${months} meses`;
    return `${yearPart} y ${monthPart}`;
  }

  const monthPart = months === 1 ? '1 mes' : `${months} meses`;
  if (remainingDays === 0) return monthPart;
  const dayPart = remainingDays === 1 ? '1 día' : `${remainingDays} días`;
  return `${monthPart} y ${dayPart}`;
}
