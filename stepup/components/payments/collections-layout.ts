/**
 * Disposición de la tabla de Cobros, compartida por la vista real y por su esqueleto de carga (29/10/2026): columnas del escritorio (≥ 820 px:
 * alumno · concepto · vence · estado · saldo · acciones; debajo de 820 px cada fila es una tarjeta) y las clases de la tabla, su encabezado y cada fila.
 */
export const COLLECTIONS_ROW_COLUMNS = "nav:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_96px_140px_minmax(0,1.1fr)_auto]";
export const COLLECTIONS_TABLE_CLASS = "mt-6 nav:overflow-hidden nav:rounded-lg nav:border-[1.5px] nav:border-border nav:bg-surface nav:shadow-card";
export const COLLECTIONS_HEADER_CLASS = `hidden border-b-[1.5px] border-border bg-surface2 px-5 py-2.5 text-label font-bold uppercase text-textMuted nav:grid nav:items-center nav:gap-x-4 ${COLLECTIONS_ROW_COLUMNS}`;
export const COLLECTIONS_ROW_CLASS = `flex flex-col gap-3 rounded-lg border-[1.5px] border-border bg-surface p-4 shadow-card nav:grid nav:items-center nav:gap-x-4 nav:gap-y-0 nav:rounded-none nav:border-0 nav:border-b nav:px-5 nav:py-3 nav:shadow-none nav:last:border-b-0 ${COLLECTIONS_ROW_COLUMNS}`;
