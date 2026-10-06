/**
 * Lógica pura del foco dentro de un diálogo modal (se prueba sin DOM).
 *  - `trapTabTarget`: a qué índice pasa el foco con Tab / Shift+Tab sin salir del diálogo; `null` = dejar el comportamiento
 *    normal del navegador (el foco sigue dentro).
 */
export function trapTabTarget(input: { count: number; currentIndex: number; shift: boolean }): number | null {
  const { count, currentIndex, shift } = input;
  if (count <= 0) return -1; // sin nada enfocable: el foco se queda en el diálogo mismo
  if (currentIndex < 0) return shift ? count - 1 : 0; // el foco está en el contenedor o fuera: entra por el extremo correcto
  if (shift && currentIndex === 0) return count - 1;
  if (!shift && currentIndex === count - 1) return 0;
  return null;
}

/** Selector de lo que se puede enfocar con teclado dentro de un diálogo. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
