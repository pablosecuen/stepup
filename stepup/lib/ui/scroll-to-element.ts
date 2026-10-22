/**
 * Llevar un elemento al comienzo de la zona visible, debajo del encabezado fijo, desplazando el contenedor que REALMENTE tiene el scroll (no se asume `window`: la página, un panel con
 * `overflow` o cualquier ancestro). Se usa al pasar de un alumno al siguiente en un registro grupal, igual que la app original (`scrollTo` al comienzo de la tarjeta del participante con 24 px de aire).
 */

export const SCROLL_TOP_GAP_PX = 12;

/** Nuevo `scrollTop` del contenedor para que el elemento quede `obstructionPx + gapPx` debajo del borde superior visible. PURO. */
export function scrollTopFor(input: { containerScrollTop: number; containerTop: number; elementTop: number; obstructionPx: number; gapPx?: number; maxScrollTop?: number }): number {
  const target = input.containerScrollTop + (input.elementTop - input.containerTop) - input.obstructionPx - (input.gapPx ?? SCROLL_TOP_GAP_PX);
  const clamped = Math.max(0, target);
  return input.maxScrollTop === undefined ? clamped : Math.min(clamped, Math.max(0, input.maxScrollTop));
}

/** ¿Este elemento desplaza su contenido en vertical? (`overflow-y` auto/scroll/overlay y contenido más alto que él). */
export function isVerticalScroller(element: Element): boolean {
  const { overflowY } = getComputedStyle(element);
  return (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && element.scrollHeight > element.clientHeight + 1;
}

/** El ancestro que desplaza de verdad; si ninguno, el elemento de desplazamiento del documento. */
export function findScrollContainer(from: Element): Element {
  for (let node = from.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (isVerticalScroller(node)) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Alto (px) que tapa por arriba un encabezado fijo o pegajoso marcado con `data-tf-top-bar` (0 si no se ve: escritorio). */
export function topObstructionPx(): number {
  let obstruction = 0;
  for (const bar of Array.from(document.querySelectorAll<HTMLElement>("[data-tf-top-bar]"))) {
    const style = getComputedStyle(bar);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0) obstruction = Math.max(obstruction, rect.bottom);
  }
  return Math.max(0, obstruction);
}

function scrollOnce(element: HTMLElement, smooth: boolean): number {
  const container = findScrollContainer(element);
  const isDocument = container === document.scrollingElement || container === document.documentElement;
  const containerTop = isDocument ? 0 : container.getBoundingClientRect().top;
  const top = scrollTopFor({
    containerScrollTop: container.scrollTop,
    containerTop,
    elementTop: element.getBoundingClientRect().top,
    // Un contenedor propio (no la página) ya empieza debajo del encabezado: sólo la página debe descontarlo.
    obstructionPx: isDocument ? topObstructionPx() : 0,
    maxScrollTop: container.scrollHeight - container.clientHeight,
  });
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  if (isDocument) window.scrollTo({ top, behavior });
  else container.scrollTo({ top, behavior });
  return top;
}

/**
 * Lleva `element` al comienzo de la zona visible. Se agenda con doble `requestAnimationFrame` (que React termine de pintar el cambio de estado) y se revisa otra vez a los 350 ms: al cerrarse el teclado en el
 * iPhone el área visible cambia y puede mover la pantalla. La revisión sólo corrige si la persona NO tocó, rodó ni escribió desde entonces. Devuelve una función que cancela todo.
 */
export function scrollElementToTop(element: HTMLElement, options: { smooth?: boolean } = {}): () => void {
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const smooth = options.smooth !== false && !reduceMotion;
  let cancelled = false;
  let interacted = false;
  const markInteraction = () => {
    interacted = true;
  };
  const events = ["touchstart", "wheel", "keydown", "pointerdown"] as const;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  const cleanup = () => {
    for (const name of events) window.removeEventListener(name, markInteraction, true);
    if (timer) clearTimeout(timer);
    if (frame) cancelAnimationFrame(frame);
  };
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (cancelled || !element.isConnected) return cleanup();
      for (const name of events) window.addEventListener(name, markInteraction, { capture: true, passive: true });
      scrollOnce(element, smooth);
      timer = setTimeout(() => {
        if (!cancelled && !interacted && element.isConnected) scrollOnce(element, false);
        cleanup();
      }, 350);
    });
  });
  return () => {
    cancelled = true;
    cleanup();
  };
}
