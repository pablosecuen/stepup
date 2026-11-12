import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pantalla «Tenés dos dispositivos activos» / «Este dispositivo fue reemplazado»: el botón `block` de la app mide como máximo 320 px; dentro de la tarjeta de 440 px
// quedaba más angosto que las opciones y pegado a la izquierda. Los tres botones de esta pantalla ocupan todo el ancho de la tarjeta.
const form = readFileSync(new URL("../../../app/dispositivo/device-transfer-form.tsx", import.meta.url), "utf8");

test("los botones de la pantalla de dispositivos ocupan todo el ancho de la tarjeta, alineados con las opciones", () => {
  const buttons = form.match(/<Button [^>]*size="lg" block[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3, "autorizar, cancelar/cerrar sesión y reintentar");
  for (const tag of buttons) assert.match(tag, /className="!max-w-none"/, tag);
});
