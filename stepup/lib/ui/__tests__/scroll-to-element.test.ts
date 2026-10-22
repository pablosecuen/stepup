import { test } from "node:test";
import assert from "node:assert/strict";
import { SCROLL_TOP_GAP_PX, scrollTopFor } from "../scroll-to-element.ts";

test("el elemento queda debajo del encabezado fijo más el aire, sin pasarse del contenido ni quedar negativo", () => {
  // La tarjeta está 900 px más abajo del borde visible, la página ya bajó 1200 px y el encabezado tapa 107 px (60 + área segura de 47).
  assert.equal(scrollTopFor({ containerScrollTop: 1200, containerTop: 0, elementTop: 900, obstructionPx: 107 }), 1200 + 900 - 107 - SCROLL_TOP_GAP_PX);
  // Ya arriba del todo: nunca negativo.
  assert.equal(scrollTopFor({ containerScrollTop: 0, containerTop: 0, elementTop: 40, obstructionPx: 107 }), 0);
  // Más allá del final: se ajusta al máximo desplazable.
  assert.equal(scrollTopFor({ containerScrollTop: 500, containerTop: 0, elementTop: 2000, obstructionPx: 0, maxScrollTop: 1000 }), 1000);
  // Un contenedor propio que no empieza en 0: se mide contra su borde superior.
  assert.equal(scrollTopFor({ containerScrollTop: 300, containerTop: 120, elementTop: 520, obstructionPx: 0, gapPx: 24 }), 300 + 400 - 24);
  // El elemento más arriba de lo visible (la persona había subido): el desplazamiento baja.
  assert.equal(scrollTopFor({ containerScrollTop: 800, containerTop: 0, elementTop: -300, obstructionPx: 107 }), 800 - 300 - 107 - SCROLL_TOP_GAP_PX);
});
