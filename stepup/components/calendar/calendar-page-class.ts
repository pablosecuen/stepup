/**
 * Contenedor de la pantalla del Calendario. Vive aparte (sin imports) para que el esqueleto de carga lo comparta con `CalendarView` y ocupe
 * EXACTAMENTE el mismo lugar sin arrastrar al paquete del layout todo el código del calendario.
 */
export const CALENDAR_PAGE_CLASS =
  "fixed inset-x-0 top-[calc(var(--tf-m-header)+var(--tf-safe-top))] bottom-[calc(var(--tf-m-nav)+var(--tf-safe-bottom))] z-40 flex flex-col bg-background pt-1 nav:static nav:z-auto nav:mx-auto nav:h-[calc(100dvh-var(--tf-shell-top))] nav:w-full nav:max-w-[1360px] nav:bg-transparent nav:px-6 nav:pb-4 nav:pt-1";
