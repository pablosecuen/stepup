/**
 * Detección del teclado en pantalla para el shell móvil. PURO (el efecto con eventos vive en `components/nav/soft-keyboard-sync.tsx`).
 *
 * Por qué no alcanza con «un input tiene foco»: con teclado físico, con el teclado flotante del iPad o con el selector de emojis sin altura, el foco existe y el área visible no cambia.
 * Por qué no alcanza con «el alto cambió»: la barra de direcciones de Safari y la rotación también cambian el alto. La señal es la CONJUNCIÓN de las dos cosas: hay un campo de texto
 * enfocado Y el área visible (viewport visual) perdió una parte grande del alto que tenía estable (`baseline`). Una web anclada al inicio de iOS achica el viewport de LAYOUT al abrir el
 * teclado (la barra inferior `fixed` queda encima del teclado, con su relleno de zona segura como franja vacía); Safari y Chrome de Android sólo achican el viewport VISUAL.
 */

/** Perder al menos esto (px o proporción del alto estable, el mayor) cuenta como teclado: el de iOS más bajo mide ~260 px; la barra de direcciones, ~80 px; la barra de atajos del teclado físico, ~55 px. */
export const KEYBOARD_MIN_HEIGHT_PX = 140;
export const KEYBOARD_MIN_RATIO = 0.15;
/** Un cambio de ancho mayor a esto es una rotación o un cambio de ventana: el alto estable se vuelve a medir. */
export const WIDTH_CHANGE_RESET_PX = 48;

export interface ViewportMeasure {
  /** `window.innerWidth`. */
  width: number;
  /** Alto del área realmente visible: `visualViewport.height` si existe, si no `window.innerHeight`. */
  visibleHeight: number;
}

export interface KeyboardBaseline {
  width: number;
  height: number;
}

/** Alto estable (sin teclado): crece con lo que se ve; se reinicia al rotar. Nunca baja por sí solo, así que un teclado abierto no se confunde con «la pantalla es más baja». */
export function nextBaseline(previous: KeyboardBaseline | null, measure: ViewportMeasure): KeyboardBaseline {
  if (!previous || Math.abs(measure.width - previous.width) > WIDTH_CHANGE_RESET_PX) return { width: measure.width, height: measure.visibleHeight };
  return { width: measure.width, height: Math.max(previous.height, measure.visibleHeight) };
}

export function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "TEXTAREA") return !(element as HTMLTextAreaElement).readOnly && !(element as HTMLTextAreaElement).disabled;
  if (tag === "INPUT") {
    const input = element as HTMLInputElement;
    if (input.readOnly || input.disabled) return false;
    // Estos tipos no abren teclado de texto.
    return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "image", "color", "hidden"].includes(input.type);
  }
  return (element as HTMLElement).isContentEditable === true;
}

export function isSoftKeyboardOpen(input: { editableFocused: boolean; baseline: KeyboardBaseline; measure: ViewportMeasure }): boolean {
  if (!input.editableFocused) return false;
  const lost = input.baseline.height - input.measure.visibleHeight;
  return lost >= Math.max(KEYBOARD_MIN_HEIGHT_PX, input.baseline.height * KEYBOARD_MIN_RATIO);
}
