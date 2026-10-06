"use client";

import { useEffect, useRef } from "react";
import { FOCUSABLE_SELECTOR, trapTabTarget } from "@/lib/ui/dialog-focus";

/**
 * Comportamiento accesible de un diálogo modal: al abrirse recuerda el control que lo abrió y mueve el foco al diálogo;
 * Escape lo cierra; Tab y Shift+Tab quedan dentro del diálogo; la página de atrás no se desplaza; al cerrarse devuelve el
 * foco al control que lo abrió (si sigue en pantalla). El diálogo debe tener `tabIndex={-1}`, `role="dialog"`,
 * `aria-modal="true"` y un nombre (`aria-labelledby`).
 */
export function useDialogA11y(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      const target = trapTabTarget({ count: focusable.length, currentIndex: focusable.indexOf(document.activeElement as HTMLElement), shift: event.shiftKey });
      if (target === null) return;
      event.preventDefault();
      (target === -1 ? dialog : focusable[target]).focus();
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return dialogRef;
}
