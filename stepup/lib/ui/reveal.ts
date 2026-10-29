/**
 * Parámetros ÚNICOS de la aparición suave del contenido (29/10/2026). Las hojas de estilo los declaran como variables CSS
 * (`--tf-reveal-*` en `app/globals.css`) y el código que anima desde JS (`EnterOnChange`) los lee de aquí; una prueba comprueba que ambos
 * lados coinciden y que están dentro de lo pedido: desplazamiento vertical de 6–10 px, 220–320 ms por bloque, 35–55 ms entre bloques y una
 * secuencia total acotada para no retrasar una pantalla larga.
 */
export const REVEAL = {
  distancePx: 8,
  durationMs: 260,
  stepMs: 40,
  /** El bloque a partir del cual deja de aumentar el retraso (el sexto): la secuencia completa dura como mucho `stepMs * 5 + durationMs`. */
  maxStaggerBlocks: 6,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

/** Retraso (ms) del bloque número `index` (empezando en 0), con el tope de la secuencia. */
export function revealDelayMs(index: number): number {
  return Math.min(Math.max(index, 0), REVEAL.maxStaggerBlocks - 1) * REVEAL.stepMs;
}

/** Duración total de la aparición de una pantalla con `blocks` bloques listos a la vez. */
export function revealTotalMs(blocks: number): number {
  return revealDelayMs(blocks - 1) + REVEAL.durationMs;
}
