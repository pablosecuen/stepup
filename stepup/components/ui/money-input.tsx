"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { formatMoneyTyping, normalizeMoneyOnBlur } from "@/lib/format/money-input";
import { TextInput } from "./field";

type MoneyInputProps = Omit<ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type" | "inputMode" | "ref"> & {
  /** Modo controlado: el texto que se ve (con puntos de miles) y quién lo recibe. */
  value?: string;
  onValueChange?: (text: string) => void;
  /** Modo no controlado (formularios con `name`): texto inicial; lo escrito viaja en el formulario con el mismo formato visible, que el servidor lee con `parseMoneyInput`. */
  defaultValue?: string;
};

/**
 * Campo de IMPORTE compartido por toda la web. Muestra los miles con punto MIENTRAS se escribe («360000» → «360.000») y conserva los centavos con coma («36.000,50»), sin mover el cursor
 * al corregir en el medio, borrar o pegar. Teclado decimal en el celular y letra de 16 px (la de `TextInput`: con menos, iOS amplía la página al enfocar).
 *
 * Sólo cambia lo que se VE: el valor numérico que se guarda sale siempre de `parseMoneyInput` (punto = miles, coma = decimales), nunca del texto con formato; un texto ambiguo («36.5») no se
 * reinterpreta acá y lo rechaza esa misma validación. Vacío es un valor válido mientras se edita.
 */
export function MoneyInput({ value, onValueChange, defaultValue = "", onBlur, ...props }: MoneyInputProps) {
  // Un texto inicial bien formado («36000») ya se ve con miles; uno dudoso queda tal cual para que la validación lo marque.
  const [inner, setInner] = useState(() => formatMoneyTyping("", defaultValue, defaultValue.length).text);
  const controlled = value !== undefined;
  const text = controlled ? value : inner;
  const inputRef = useRef<HTMLInputElement>(null);
  // Cursor que hay que devolver tras dibujar el texto nuevo (React reescribe el valor y el navegador lo manda al final).
  const pendingCaret = useRef<number | null>(null);

  function commit(next: string) {
    if (!controlled) setInner(next);
    onValueChange?.(next);
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (input && caret !== null && document.activeElement === input) input.setSelectionRange(caret, caret);
  });

  return (
    <TextInput
      {...props}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(event) => {
        const input = event.currentTarget;
        const result = formatMoneyTyping(text, input.value, input.selectionStart ?? input.value.length);
        pendingCaret.current = result.caret;
        if (result.text === text) {
          // Tecla rechazada (una letra, una tercera cifra decimal): el estado no cambia y React sólo restituye el valor; el cursor se vuelve a poner a mano.
          window.requestAnimationFrame(() => {
            if (document.activeElement === input) input.setSelectionRange(result.caret, result.caret);
          });
          pendingCaret.current = null;
        }
        commit(result.text);
      }}
      onBlur={(event) => {
        const cleaned = normalizeMoneyOnBlur(text);
        if (cleaned !== text) commit(cleaned);
        onBlur?.(event);
      }}
    />
  );
}
