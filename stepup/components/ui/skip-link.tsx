/**
 * "Saltar al contenido": primer elemento enfocable de cada página. Invisible hasta recibir el foco por teclado; lleva al
 * `<main id="contenido">` (con `tabIndex={-1}` para que el foco quede realmente en el contenido y no sólo el desplazamiento).
 * Se salta la barra de navegación y el menú de cuenta, que van antes del contenido en el orden de lectura.
 */
export const MAIN_CONTENT_ID = "contenido";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-background shadow-panel transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      Saltar al contenido
    </a>
  );
}
