import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("cableado: el título «Evidencias y materiales» pide lugar para las fotos y no queda huérfano al pie de una página", () => {
  const pdf = readFileSync(new URL("../pdf.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(pdf, /<View style=\{styles\.sectionTitle\} minPresenceAhead=\{170\}>\n\s+<Text>Evidencias y materiales<\/Text>/);
});
