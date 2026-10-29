/**
 * Superficies compartidas entre el contenido real y su esqueleto de carga (29/10/2026). Si una tarjeta cambia de borde, radio o sombra,
 * cambia aquí y el esqueleto la sigue sola: nunca se repiten estas clases a mano en un `loading.tsx` ni en un esqueleto.
 *  - `PANEL_CLASS`: panel de una lista o de una columna (Inicio, Cobros, filas de tablas);
 *  - `CARD_CLASS`: tarjeta con relleno propio (Resumen financiero, Series, Registro).
 */
export const PANEL_CLASS = "rounded-xl border-[1.5px] border-border bg-surface shadow-card";
export const CARD_CLASS = "rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5";
