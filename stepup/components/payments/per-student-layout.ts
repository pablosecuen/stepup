/**
 * Disposición de «Cobros › Por alumno», compartida por la vista real y por su esqueleto de carga: UNA tabla de tres columnas (nombre · fecha de pago · cobro) más una pista
 * angosta sin encabezado para el menú «⋯». Todas las filas —también las subfilas de los conceptos desplegados— comparten las mismas columnas (nunca se alinea cada fila por
 * separado). Dentro de «Cobro» hay tres posiciones propias, siempre reservadas: indicador · importe · unidad, para que las tildes y los importes queden sobre el mismo eje.
 */
export const PER_STUDENT_TOOLBAR_CLASS = "mt-4 flex flex-col gap-2.5 nav:flex-row nav:items-end";
export const PER_STUDENT_TABLE_WRAP_CLASS = "mt-3 overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card";
export const PER_STUDENT_TABLE_CLASS = "w-full table-fixed border-collapse text-left";
/** Anchos de las columnas (móvil / escritorio): el nombre ocupa el resto. */
export const PER_STUDENT_COLGROUP = ["", "w-[84px] nav:w-[176px]", "w-[118px] nav:w-[244px]", "w-10 nav:w-12"] as const;
export const PER_STUDENT_HEAD_ROW_CLASS = "border-b-[1.5px] border-border bg-surface2";
export const PER_STUDENT_TH_CLASS = "px-2 py-2 align-bottom text-[11px] font-bold uppercase leading-tight text-textMuted nav:px-5 nav:text-label";
export const PER_STUDENT_GROUP_CLASS = "border-t-[1.5px] border-border first-of-type:border-t-0";
/** Todas las filas cerradas miden lo mismo (el alto es un mínimo: el contenido de una fila nunca lo supera). */
export const PER_STUDENT_ROW_CLASS = "h-[52px] nav:h-12";
export const PER_STUDENT_TD_CLASS = "px-2 py-0.5 align-middle nav:px-5";
/** «Cobro»: indicador (16 px) · importe · unidad. En móvil la unidad baja bajo el importe, alineada a la derecha como él. */
export const PER_STUDENT_AMOUNT_GRID_CLASS = "grid grid-cols-[16px_minmax(0,1fr)] items-center gap-x-1.5 text-[13px] leading-tight nav:grid-cols-[16px_92px_76px] nav:justify-end nav:text-[14px]";
export const PER_STUDENT_INDICATOR_CLASS = "row-span-2 inline-flex h-4 w-4 items-center justify-center nav:row-span-1";
export const PER_STUDENT_UNIT_CLASS = "col-start-2 row-start-2 text-right text-textMuted nav:col-start-3 nav:row-start-1 nav:text-left";
