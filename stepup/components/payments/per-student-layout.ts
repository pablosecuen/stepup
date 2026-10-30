/**
 * Disposición de «Cobros › Por alumno», compartida por la vista real y por su esqueleto de carga: UNA tabla de tres columnas (nombre · fecha de pago · cobro) más una pista
 * angosta sin encabezado para el menú «⋯». Todas las filas comparten las mismas columnas (nunca se alinea cada fila por separado): el nombre a la izquierda, la fecha bajo su
 * encabezado y el importe alineado a la derecha, también en móvil.
 */
export const PER_STUDENT_TOOLBAR_CLASS = "mt-4 flex flex-col gap-2.5 nav:flex-row nav:items-end";
export const PER_STUDENT_TABLE_WRAP_CLASS = "mt-3 overflow-hidden rounded-lg border-[1.5px] border-border bg-surface shadow-card";
export const PER_STUDENT_TABLE_CLASS = "w-full table-fixed border-collapse text-left";
/** Anchos de las columnas (móvil / escritorio): el nombre ocupa el resto. */
export const PER_STUDENT_COLGROUP = ["", "w-[84px] nav:w-[176px]", "w-[112px] nav:w-[210px]", "w-10 nav:w-12"] as const;
export const PER_STUDENT_HEAD_ROW_CLASS = "border-b-[1.5px] border-border bg-surface2";
export const PER_STUDENT_TH_CLASS = "px-2 py-2 align-bottom text-[11px] font-bold uppercase leading-tight text-textMuted nav:px-5 nav:text-label";
export const PER_STUDENT_GROUP_CLASS = "border-t-[1.5px] border-border first-of-type:border-t-0";
export const PER_STUDENT_TD_CLASS = "px-2 py-0.5 align-middle nav:px-5";
