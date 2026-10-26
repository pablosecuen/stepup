"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { AutoGrowTextArea } from "@/components/ui/auto-grow-textarea";
import { AddItemRow, editIndexKey, editTextKey, useDraft } from "./draft-items";

export interface EditableListItem {
  text: string;
  /** Control propio de la fila (p. ej. la casilla «visto» de un tema), a la izquierda del texto. */
  leading?: ReactNode;
  /** Estado en texto + ícono bajo el texto (p. ej. «Visto»): el estado nunca depende sólo de la casilla. */
  note?: ReactNode;
}

/**
 * Lista de textos del registro (temas, objetivos, actividades, fortalezas, aspectos a mejorar): UN solo componente para todas, así se comportan igual.
 *  - Cada elemento muestra TODO su texto (crece, nunca se recorta ni se fija su alto) y tiene tres acciones con su propio espacio: «Editar», «Eliminar»
 *    y, en la edición, «Guardar cambio» / «Cancelar».
 *  - Editar abre el texto actual en el mismo lugar (misma posición e identidad: `onEditText(index, texto)` sólo cambia el texto). Cancelar —o Escape—
 *    lo descarta y queda el original; Guardar —o Ctrl/⌘+Enter— lo aplica. Enter es un salto de línea.
 *  - La edición en curso vive en el almacén de borradores del formulario (`editIndexKey`/`editTextKey`): si se guarda el registro con una edición abierta, el
 *    guardado la incorpora en su lugar (ver `applyPendingToList`/`applyPendingToTopics`).
 *  - Agregar: «+», Enter o soltar el campo, una sola vez (`AddItemRow`). Abrir la edición de otro elemento aplica antes la que estaba abierta.
 */
export function EditableTextList({
  label,
  singular,
  placeholder,
  draftKey,
  items,
  onEditText,
  onRemove,
  onAdd,
}: {
  label: string;
  /** «Tema», «Objetivo», «Fortaleza»…: para los nombres accesibles («Editar objetivo 2»). */
  singular: string;
  placeholder: string;
  draftKey: string;
  items: EditableListItem[];
  onEditText: (index: number, text: string) => void;
  onRemove: (index: number) => void;
  onAdd: (text: string) => void;
}) {
  const id = useId();
  const edit = useDraft(editTextKey(draftKey));
  const editIndex = useDraft(editIndexKey(draftKey));
  const editingIndex = editIndex.text !== "" && Number.isInteger(Number(editIndex.text)) ? Number(editIndex.text) : null;
  const noun = singular.toLowerCase();

  function finishEdit(confirm: boolean) {
    const index = editingIndex;
    const text = edit.take().trim();
    editIndex.take();
    if (!confirm || index === null || !text) return;
    onEditText(index, text);
  }
  function startEdit(index: number) {
    if (editingIndex !== null && editingIndex !== index) finishEdit(true);
    editIndex.set(String(index));
    edit.set(items[index].text);
  }
  function remove(index: number) {
    // Quitar mueve las posiciones: una edición abierta se cierra sin tocar nada (sus cambios no guardados se descartan).
    if (editingIndex !== null) finishEdit(false);
    onRemove(index);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2.5">
      <legend className="mb-1 text-[14px] font-bold text-textPrimary">{label}</legend>
      {items.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-2">
          {items.map((item, index) =>
            editingIndex === index ? (
              <li key={index} className="flex min-w-0 flex-col gap-2 rounded-[20px] border-[1.5px] border-ink bg-surface p-2.5">
                <AutoGrowTextArea
                  aria-label={`Editar ${noun} ${index + 1}`}
                  autoFocus
                  autoComplete="off"
                  value={edit.text}
                  onChange={(event) => edit.set(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      finishEdit(false);
                    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      finishEdit(true);
                    }
                  }}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => finishEdit(true)} disabled={!edit.text.trim()} aria-label={`Guardar el cambio del ${noun} ${index + 1}`}>
                    Guardar cambio
                  </Button>
                  <Button variant="secondary" onClick={() => finishEdit(false)} aria-label={`Cancelar la edición del ${noun} ${index + 1}`}>
                    Cancelar
                  </Button>
                </div>
              </li>
            ) : (
              <li key={index} className="flex min-w-0 items-start gap-1 rounded-[20px] border border-border bg-paperDeep py-0.5 pl-3 pr-1">
                {item.leading && <span className="flex h-11 shrink-0 items-center">{item.leading}</span>}
                <div className="min-w-0 flex-1 py-[11px] pl-1">
                  <span className="block whitespace-pre-wrap text-[16px] leading-snug text-textPrimary [overflow-wrap:anywhere]">{item.text}</span>
                  {item.note && <span className="mt-1 flex items-center gap-1 text-[13.5px] font-semibold text-textSecondary">{item.note}</span>}
                </div>
                <button type="button" onClick={() => startEdit(index)} aria-label={`Editar ${noun} ${index + 1}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-textMuted hover:bg-border hover:text-textPrimary">
                  <PencilSquareIcon className="h-[18px] w-[18px]" aria-hidden />
                </button>
                <button type="button" onClick={() => remove(index)} aria-label={`Eliminar ${noun} ${index + 1}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-textMuted hover:bg-border hover:text-textPrimary">
                  <XMarkIcon className="h-5 w-5" aria-hidden />
                </button>
              </li>
            )
          )}
        </ul>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-[650] text-textSecondary">{placeholder}</label>
        <AddItemRow draftKey={draftKey} id={id} label={placeholder} onAdd={onAdd} />
      </div>
    </fieldset>
  );
}
