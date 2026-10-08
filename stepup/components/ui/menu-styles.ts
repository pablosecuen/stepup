// Estilos compartidos de menús desplegables (docs/design/web-v1/02-componentes-y-navegacion.md §6). Los usa el menú de cuenta
// y quedan disponibles para los siguientes. El comportamiento (teclado, foco) vive en cada menú con `lib/nav/menu-keyboard.ts`.

/** Panel del menú: superficie, borde 1,5 px, radio 16, sombra de panel. */
export const MENU_PANEL = "overflow-hidden rounded-lg border-[1.5px] border-borderMid bg-surface shadow-panel";

/** Elemento del menú: 48 px de alto (56 px en móvil, donde el menú es una hoja inferior). */
export const MENU_ITEM =
  "flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] font-[650] transition-colors duration-150 hover:bg-paperDeep focus-visible:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink nav:min-h-12";

/** Variante destructiva (cerrar sesión). */
export const MENU_ITEM_DANGER = "text-bad hover:bg-badSoft focus-visible:bg-badSoft";

export const MENU_SEPARATOR = "mx-2 my-1 h-[1.5px] bg-border";
