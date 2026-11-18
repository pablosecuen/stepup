import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("los efectos decorativos no desplazan ni rellenan las zonas horarias del calendario", () => {
  const css = readFileSync(new URL("../../../app/natural-theme.css", import.meta.url), "utf8");
  const controlRules = css.split("\n").filter((line) => line.includes("body :is(.tf-motion-link"));
  assert.equal(controlRules.length, 6);
  for (const rule of controlRules) {
    assert.ok(rule.includes("):not(:where([data-calendar-scroller] *))"),
      `La geometría de tarjetas, rótulos, grupos y horas libres debe permanecer fija: ${rule}`);
  }
  // Los botones de la aplicación que no pertenecen a la grilla conservan su efecto de mouse.
  assert.ok(css.includes("translate:0 -3px"));
  assert.ok(css.includes("(hover:hover) and (pointer:fine)"));
});
