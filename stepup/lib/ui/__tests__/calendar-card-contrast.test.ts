import { test } from "node:test";
import assert from "node:assert/strict";
import { CANCELLED_COLORS, CARD_TEXT_COLORS, ELAPSED_COLORS, MODALITY_COLORS, REPLACEMENT_COLORS } from "../../calendar-theme.ts";

/** Contraste WCAG 2.x sin redondear: el umbral de 4,5:1 se compara con el valor exacto (4,4955 NO llega). */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("el contraste se calcula sin redondear (el color anterior de la línea secundaria de «Cancelada» daba 4,4955:1 y no pasaba)", () => {
  const anterior = contrast("#9A6200", CANCELLED_COLORS.bg);
  assert.ok(anterior < 4.5 && anterior > 4.49, String(anterior));
});

test("tarjeta «Cancelada»: texto principal y secundario llegan a 4,5:1 sobre #FFF1B8 (fondo, borde y significado no cambian)", () => {
  assert.equal(CANCELLED_COLORS.bg, "#FFF1B8");
  assert.equal(CANCELLED_COLORS.border, "#D99100");
  assert.equal(CANCELLED_COLORS.textPrimary, "#7A4B00");
  assert.ok(contrast(CANCELLED_COLORS.textPrimary, CANCELLED_COLORS.bg) >= 4.5);
  assert.ok(contrast(CANCELLED_COLORS.textSecondary, CANCELLED_COLORS.bg) >= 4.5, "la línea secundaria de «Cancelada» no puede bajar de 4,5:1");
});

test("tarjetas transcurridas, de modalidad y de reemplazo: todo texto llega a 4,5:1 sobre su fondo", () => {
  for (const key of ["textPrimary", "textSecondary"] as const) assert.ok(contrast(ELAPSED_COLORS[key], ELAPSED_COLORS.bg) >= 4.5, `transcurrida ${key}`);
  const fondos = [...Object.entries(MODALITY_COLORS).map(([k, v]) => [k, v.bg]), ["reemplazo", REPLACEMENT_COLORS.bg]] as [string, string][];
  for (const [nombre, bg] of fondos) for (const key of ["primary", "secondary"] as const) assert.ok(contrast(CARD_TEXT_COLORS[key], bg) >= 4.5, `${nombre} ${key}`);
});
