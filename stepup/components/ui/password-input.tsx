"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { TextInput } from "@/components/ui/field";
import { passwordFieldType, passwordToggleLabel } from "@/lib/ui/password-visibility";

/**
 * Campo de contraseña con botón de ojo («Mostrar contraseña» / «Ocultar contraseña»). Oculta por defecto.
 *  - Es el MISMO `<input>` (sólo cambia `type`): conserva valor, foco, selección, `name`, `autoComplete` y la compatibilidad con
 *    gestores de contraseñas. El botón no le quita el foco al campo con el mouse ni con el dedo.
 *  - Nada del valor se guarda, se registra ni sale del formulario; en modo visible se apagan la corrección y el corrector
 *    ortográfico (algunos navegadores envían el texto a un servicio externo).
 *  - El botón es un objetivo táctil de 44 px, `aria-pressed` y con nombre accesible dinámico.
 * Sólo para contraseñas: no usar en otros campos.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof TextInput>, "type" | "ref">) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const restore = useRef<{ start: number | null; end: number | null; direction: "forward" | "backward" | "none" | null; focused: boolean } | null>(null);

  function toggle() {
    const input = inputRef.current;
    restore.current = input
      ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection, focused: document.activeElement === input }
      : null;
    setVisible((current) => !current);
  }

  // Cambiar `type` hace que el navegador lleve el cursor al inicio: se devuelve la selección que había (al aplicar el cambio y una
  // vez más al terminar el ciclo de eventos, porque con un clic real el navegador la vuelve a mover después de aplicar el tipo).
  useLayoutEffect(() => {
    const saved = restore.current;
    restore.current = null;
    const input = inputRef.current;
    if (!saved || !input || !saved.focused) return;
    const apply = () => {
      if (document.activeElement !== input) return;
      try {
        input.setSelectionRange(saved.start ?? input.value.length, saved.end ?? input.value.length, saved.direction ?? undefined);
      } catch {
        // Un navegador que no admite selección en este tipo de campo: el foco y el valor ya se conservaron.
      }
    };
    input.focus({ preventScroll: true });
    apply();
    const timer = window.setTimeout(apply, 0);
    return () => window.clearTimeout(timer);
  }, [visible]);

  const Icon = visible ? EyeSlashIcon : EyeIcon;
  return (
    <div className="relative">
      <TextInput
        {...props}
        ref={inputRef}
        type={passwordFieldType(visible)}
        className={`pr-12${className ? ` ${className}` : ""}`}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={toggle}
        // El mouse y el dedo no le sacan el foco al campo; con teclado (Tab + Enter/Espacio) el foco queda en el botón.
        onMouseDown={(event) => event.preventDefault()}
        aria-pressed={visible}
        aria-label={passwordToggleLabel(visible)}
        title={passwordToggleLabel(visible)}
        className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-md text-textSecondary transition-colors hover:bg-paperDeep hover:text-textPrimary focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      >
        <Icon className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
