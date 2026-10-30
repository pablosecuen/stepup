/**
 * Disposición de «Cobros › Por alumno», compartida por la vista real y por su esqueleto de carga: columnas del escritorio (≥ 820 px: nombre · cobro · fecha de pago ·
 * saldo pendiente · acciones; debajo de 820 px cada alumno es una tarjeta compacta), la barra de búsqueda y filtros, y las clases de la tabla, su encabezado y cada fila.
 */
export const PER_STUDENT_COLUMNS = "nav:grid-cols-[minmax(0,1.2fr)_minmax(0,1.25fr)_minmax(0,1.35fr)_minmax(0,0.85fr)_auto]";
export const PER_STUDENT_TOOLBAR_CLASS = "mt-5 flex flex-col gap-3 nav:flex-row nav:items-end";
export const PER_STUDENT_TABLE_CLASS = "mt-4 nav:overflow-hidden nav:rounded-lg nav:border-[1.5px] nav:border-border nav:bg-surface nav:shadow-card";
export const PER_STUDENT_HEADER_CLASS = `hidden border-b-[1.5px] border-border bg-surface2 px-5 py-2.5 text-label font-bold uppercase text-textMuted nav:grid nav:items-center nav:gap-x-4 ${PER_STUDENT_COLUMNS}`;
export const PER_STUDENT_ROW_CLASS = "flex flex-col rounded-lg border-[1.5px] border-border bg-surface p-3.5 shadow-card nav:rounded-none nav:border-0 nav:border-b nav:px-5 nav:py-3 nav:shadow-none nav:last:border-b-0";
export const PER_STUDENT_GRID_CLASS = `grid grid-cols-2 gap-x-3 gap-y-2.5 nav:items-start nav:gap-x-4 nav:gap-y-0 ${PER_STUDENT_COLUMNS}`;
export const PER_STUDENT_SUBROWS_CLASS = "mt-2.5 flex flex-col gap-2.5 border-t-[1.5px] border-border pt-2.5 nav:mt-2 nav:pt-2";
