/**
 * Un `<input type="number">` ENFOCADO cambia su valor (±1) cuando la rueda del mouse pasa por encima: una persona que baja por la
 * página con el cursor sobre «Duración (min)» convierte 60 en 59 sin darse cuenta. El valor y los cálculos de la aplicación son
 * exactos; el cambio es del navegador. Solución: si la rueda actúa sobre el campo numérico enfocado, se le quita el foco (la rueda
 * sigue desplazando la página y el valor no se toca). Sólo duck-typing: sin acceso al DOM, para poder probarlo sin navegador.
 */
interface InputLike {
  readonly tagName?: unknown;
  readonly type?: unknown;
}

export function shouldBlurOnWheel(target: unknown, activeElement: unknown): boolean {
  if (typeof target !== "object" || target === null || target !== activeElement) return false;
  const input = target as InputLike;
  return input.tagName === "INPUT" && input.type === "number";
}
