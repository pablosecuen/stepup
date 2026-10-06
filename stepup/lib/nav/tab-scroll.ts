/**
 * Posición de desplazamiento horizontal que deja una pestaña centrada (o lo más cerca posible) dentro de su contenedor.
 * Pura: se prueba sin DOM. Nunca devuelve un valor fuera de [0, contentWidth - containerWidth].
 */
export function centeredScrollLeft(input: { containerWidth: number; contentWidth: number; tabLeft: number; tabWidth: number }): number {
  const { containerWidth, contentWidth, tabLeft, tabWidth } = input;
  if (![containerWidth, contentWidth, tabLeft, tabWidth].every(Number.isFinite)) return 0;
  const max = Math.max(0, contentWidth - containerWidth);
  const target = tabLeft + tabWidth / 2 - containerWidth / 2;
  return Math.min(max, Math.max(0, Math.round(target)));
}
