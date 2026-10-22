"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";

/**
 * Borradores de los campos «agregar» del registro (fortalezas, aspectos a mejorar, temas, objetivos, actividades) y de las ediciones en curso de
 * una etiqueta. Viven en el formulario del registro (no en cada campo) para que «Guardar progreso», «Completar alumno» y «Guardar registro» incorporen
 * lo que quedó escrito y nunca se pierda un texto pendiente. Sin proveedor (uso suelto) cada campo guarda el suyo.
 */
export interface DraftsApi {
  /** Valor más reciente (sincrónico: refleja lo escrito aunque React todavía no haya vuelto a pintar). */
  read(key: string): string;
  set(key: string, text: string): void;
  /** Para volver a pintar a quien lo lee. */
  drafts: Readonly<Record<string, string>>;
}

const DraftsContext = createContext<DraftsApi | null>(null);
export const DraftsProvider = DraftsContext.Provider;

/** Estado y referencia de borradores para el formulario que los provee (`<DraftsProvider value={api}>`). */
export function useDraftsStore(): { api: DraftsApi; snapshot: () => Record<string, string>; clear: () => void } {
  const ref = useRef<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const read = useCallback((key: string) => ref.current[key] ?? "", []);
  const set = useCallback((key: string, text: string) => {
    ref.current = { ...ref.current, [key]: text };
    setDrafts(ref.current);
  }, []);
  const snapshot = useCallback(() => ({ ...ref.current }), []);
  const clear = useCallback(() => {
    ref.current = {};
    setDrafts({});
  }, []);
  return { api: { read, set, drafts }, snapshot, clear };
}

/** Texto pendiente de UNA clave: del formulario (si hay proveedor) o local. `take` lo entrega y lo vacía en el acto (una sola vez). */
export function useDraft(key: string): { text: string; set: (text: string) => void; take: () => string } {
  const api = useContext(DraftsContext);
  const localRef = useRef("");
  const [localText, setLocalText] = useState("");
  const set = useCallback(
    (text: string) => {
      if (api) api.set(key, text);
      else {
        localRef.current = text;
        setLocalText(text);
      }
    },
    [api, key]
  );
  const take = useCallback(() => {
    const value = api ? api.read(key) : localRef.current;
    if (value) set("");
    return value;
  }, [api, key, set]);
  return { text: api ? (api.drafts[key] ?? "") : localText, set, take };
}

/**
 * Campo «agregar» + botón «+». El texto se incorpora a la lista UNA sola vez, por cualquiera de estos caminos: Enter, «+», o al soltar el campo
 * (`blur`): el ✅ superior del teclado de iOS NO envía Enter, sólo cierra el teclado y suelta el campo. `take()` entrega el borrador y lo vacía
 * en el mismo instante, así que blur seguido de click en «+» (o Enter seguido de blur) nunca duplica. No envía ningún formulario ni cambia de alumno.
 */
export function AddItemRow({ draftKey, id, label, placeholder, onAdd }: { draftKey: string; id: string; label: string; placeholder?: string; onAdd: (text: string) => void }) {
  const { text, set, take } = useDraft(draftKey);
  function commit() {
    const value = take().trim();
    if (value) onAdd(value);
  }
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <div className="min-w-0 flex-1">
        <TextInput
          id={id}
          aria-label={label}
          placeholder={placeholder}
          enterKeyHint="done"
          autoComplete="off"
          value={text}
          onChange={(event) => set(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            commit();
          }}
        />
      </div>
      <Button variant="secondary" onClick={commit} disabled={!text.trim()} aria-label={label} className="!min-h-[46px] min-w-[46px] shrink-0 !px-3.5">
        +
      </Button>
    </div>
  );
}

export { applyPendingToList, editIndexKey, editTextKey, hasPendingDrafts, pendingText } from "@/lib/lessons/pending-drafts";
