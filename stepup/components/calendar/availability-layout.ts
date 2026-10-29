/**
 * Disposición del editor de Disponibilidad, compartida por el editor real y por su esqueleto de carga (29/10/2026): la grilla de cada formulario
 * (se reparte en columnas según el ancho), la fila de una lista y el estado vacío. El esqueleto usa estas mismas clases para ocupar el mismo lugar.
 */
export const AVAILABILITY_FORM_GRID = "mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] items-end gap-3.5 border-t-[1.5px] border-border pt-4";
export const AVAILABILITY_ROW_CLASS = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border-[1.5px] border-border bg-surface2 py-1 pl-3.5 pr-1.5 text-[15px] text-textPrimary";
export const AVAILABILITY_EMPTY_CLASS = "w-full max-w-[540px] rounded-md border-2 border-dashed border-borderMid px-4 py-3.5 text-[14.5px] text-textMuted";
