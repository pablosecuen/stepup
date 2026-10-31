/**
 * Disposición de «Cobros › Por alumno», compartida por la vista real y por su esqueleto de carga: UNA tabla de tres columnas (nombre · fecha de pago · cobro) más una pista
 * angosta sin encabezado para el menú «⋯». Todas las filas —también las subfilas de los conceptos desplegados— comparten las mismas columnas (nunca se alinea cada fila por
 * separado). Dentro de «Cobro» hay tres posiciones propias, siempre reservadas: indicador · importe · unidad, para que las tildes y los importes queden sobre el mismo eje.
 */
export const PER_STUDENT_TOOLBAR_CLASS = "mt-4 flex flex-col gap-2.5 nav:flex-row nav:items-end";
export const PER_STUDENT_TABLE_WRAP_CLASS = "mt-3 overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card";
export const PER_STUDENT_TABLE_CLASS = "w-full table-fixed border-collapse text-left";
/** Anchos de las columnas (móvil / escritorio): el nombre ocupa el resto. */
export const PER_STUDENT_COLGROUP = ["", "w-[80px] nav:w-[176px]", "w-[138px] nav:w-[272px]", "w-8 nav:w-12"] as const;
export const PER_STUDENT_HEAD_ROW_CLASS = "border-b-[1.5px] border-border bg-surface2";
export const PER_STUDENT_TH_CLASS = "px-2 py-2 align-bottom text-[11px] font-bold uppercase leading-tight text-textMuted nav:px-5 nav:text-label";
export const PER_STUDENT_GROUP_CLASS = "border-t-[1.5px] border-border first-of-type:border-t-0";
/** Todas las filas cerradas miden lo mismo (el alto es un mínimo: el contenido de una fila nunca lo supera). */
export const PER_STUDENT_ROW_CLASS = "h-[52px] nav:h-12";
export const PER_STUDENT_TD_CLASS = "px-2 py-0.5 align-middle nav:px-5";
/**
 * «Cobro»: cinco posiciones compartidas por TODAS las filas y detalles —indicador · signo $ · cifra · unidad · desplegable—. Cada una es una columna propia de la grilla (nada se alinea
 * con espacios ni márgenes por importe): los signos $ quedan sobre un mismo eje, las cifras se alinean a la derecha con números tabulares y la unidad nunca los desplaza. En móvil la
 * unidad baja bajo la cifra y el desplegable ocupa las dos líneas. Las posiciones sin contenido se reservan igual.
 */
export const PER_STUDENT_AMOUNT_GRID_CLASS =
  "grid grid-cols-[14px_9px_62px_28px] items-center justify-end gap-x-[3px] text-[13px] leading-tight nav:grid-cols-[16px_10px_76px_68px_36px] nav:gap-x-1.5 nav:text-[14px]";
export const PER_STUDENT_INDICATOR_CLASS = "col-start-1 [grid-row:1/span_2] inline-flex h-4 w-4 items-center justify-center nav:[grid-row:1/span_1]";
export const PER_STUDENT_DOLLAR_CLASS = "col-start-2 row-start-1 text-right";
export const PER_STUDENT_FIGURE_CLASS = "tf-num col-start-3 row-start-1 whitespace-nowrap text-right";
export const PER_STUDENT_UNIT_CLASS = "col-start-3 row-start-2 whitespace-nowrap text-right text-textMuted nav:col-start-4 nav:row-start-1 nav:text-left";
export const PER_STUDENT_TOGGLE_SLOT_CLASS = "col-start-4 [grid-row:1/span_2] flex items-center justify-end nav:col-start-5 nav:[grid-row:1/span_1]";
export const PER_STUDENT_NONE_CLASS = "col-span-2 col-start-2 row-start-1 text-right text-textMuted nav:col-span-3";
