/**
 * Teclado del menú de cuenta (patrón "menu button" de WAI-ARIA APG): lógica pura, sin DOM, para poder probarla.
 * El componente sólo traduce el resultado a `focus()`.
 */
export type MenuKeyAction =
  | { kind: "focus"; index: number }
  | { kind: "close"; restoreFocus: boolean }
  | { kind: "none" };

/** Tecla pulsada DENTRO del menú abierto (con `count` elementos y `current` enfocado; -1 si ninguno). */
export function menuKeyAction(key: string, current: number, count: number): MenuKeyAction {
  if (count <= 0) return key === "Escape" ? { kind: "close", restoreFocus: true } : { kind: "none" };
  switch (key) {
    case "ArrowDown":
      return { kind: "focus", index: current < 0 ? 0 : (current + 1) % count };
    case "ArrowUp":
      return { kind: "focus", index: current < 0 ? count - 1 : (current - 1 + count) % count };
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: count - 1 };
    case "Escape":
      return { kind: "close", restoreFocus: true };
    case "Tab":
      // Tab saca el foco del menú: se cierra sin forzar el foco (sigue el orden natural del documento).
      return { kind: "close", restoreFocus: false };
    default:
      return { kind: "none" };
  }
}

/** Tecla pulsada en el BOTÓN que abre el menú: las flechas lo abren y enfocan el primero/último elemento. */
export function triggerKeyAction(key: string): { open: true; focus: "first" | "last" } | null {
  if (key === "ArrowDown") return { open: true, focus: "first" };
  if (key === "ArrowUp") return { open: true, focus: "last" };
  return null;
}
