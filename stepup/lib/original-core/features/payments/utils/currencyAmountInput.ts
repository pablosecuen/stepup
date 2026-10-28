// Puerto VERBATIM del original (`src/features/payments/utils/currencyAmountInput.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-30 (a pedido de Joaquín — editar monto mensual):
 * lógica pura del campo de importe con separadores de miles. El campo NUNCA
 * guarda el texto formateado como fuente de verdad — cada tecla se
 * convierte primero a un entero canónico (`parseAmountInputToInteger`) y
 * recién de ahí se vuelve a formatear (`formatIntegerThousands`) para
 * mostrarlo. Así nunca se cuelan ceros involuntarios ni separadores/símbolo
 * "$" dentro del valor guardado — el mismo mecanismo que evita el bug real
 * de Rocío Spitale (un importe mal tecleado que terminó guardado tal cual).
 */

/** Sólo dígitos — quita puntos, espacios, "$", letras y cualquier otro carácter. */
export function digitsOnly(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

/**
 * Texto tal cual lo tecleó la profesora -> entero canónico, o `null` si
 * quedó vacío. Los ceros a la izquierda desaparecen solos (`Number('007')`
 * es `7`), nunca hay forma de teclear un importe negativo o decimal (no se
 * acepta ningún carácter que no sea 0-9).
 */
export function parseAmountInputToInteger(text: string): number | null {
  const digits = digitsOnly(text);
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Entero -> "100.800" (separadores de miles argentinos, sin símbolo de moneda). */
export function formatIntegerThousands(value: number): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.trunc(value));
}

/** Entero (o null) -> "$ 100.800" — vista previa del campo, tal como la pide la interfaz. */
export function formatAmountPreviewARS(value: number | null): string {
  if (value === null) return '$ 0';
  return `$ ${formatIntegerThousands(value)}`;
}

export interface AmountValidationResult {
  isValid: boolean;
  error: string | null;
}

/**
 * Reglas de validación del campo: vacío, cero, negativo, NaN, infinito o
 * no entero se rechazan con un mensaje mostrable debajo del campo. Nunca
 * decimales por ahora (`Number.isInteger`).
 */
export function validateAmountInput(value: number | null): AmountValidationResult {
  if (value === null) return { isValid: false, error: 'Ingresá un importe.' };
  if (!Number.isFinite(value)) return { isValid: false, error: 'El importe no es válido.' };
  if (!Number.isInteger(value)) return { isValid: false, error: 'El importe debe ser un número entero.' };
  if (value <= 0) return { isValid: false, error: 'El importe debe ser mayor a cero.' };
  if (!Number.isSafeInteger(value)) return { isValid: false, error: 'El importe es demasiado grande.' };
  return { isValid: true, error: null };
}
