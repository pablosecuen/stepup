/**
 * Contraste WCAG 2.x entre dos colores hexadecimales (#RRGGBB). Pura: la usan las pruebas de accesibilidad para fijar que la
 * paleta de la web cumple AA (4.5:1 texto, 3:1 componentes de interfaz) y no se degrade sin que falle una prueba.
 */
function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new RangeError(`Color inválido: ${hex}`);
  const n = parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mezcla `foreground` sobre `background` con opacidad `alpha` (0-1): cómo se ve un `bg-color/10` sobre una superficie. */
export function blend(foreground: string, background: string, alpha: number): string {
  const f = parseInt(foreground.slice(1), 16);
  const b = parseInt(background.slice(1), 16);
  const mix = (shift: number) => Math.round(((f >> shift) & 255) * alpha + ((b >> shift) & 255) * (1 - alpha));
  return "#" + [16, 8, 0].map((s) => mix(s).toString(16).padStart(2, "0")).join("");
}
