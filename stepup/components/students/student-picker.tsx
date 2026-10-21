"use client";

import { useId, useMemo, useState } from "react";
import { MagnifyingGlassIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { TextInput, choiceGroupClass } from "@/components/ui/field";
import { buildStudentPickerView, selectedStudentsInOrder, type PickableStudent } from "@/lib/students/picker";

/**
 * Selector de alumnos con buscador — Nueva clase (clase única y serie semanal), Registrar clase no programada y Modificar participantes de una serie. Igual que la app anterior:
 * un campo «Buscar por nombre o apellido» con su lupa y su «borrar», un encabezado que dice cuántos alumnos hay o cuántas coincidencias, y la lista completa por nombre cuando no hay
 * búsqueda (por relevancia cuando la hay: tildes, mayúsculas, orden de las palabras, errores de tipeo chicos, iniciales — el motor único de `lib/students/search.ts`).
 *
 * La búsqueda sólo filtra lo que se VE: los alumnos elegidos quedan siempre a la vista como etiquetas (con su «quitar») aunque no figuren en el resultado, siguen elegidos al cambiar o
 * borrar la búsqueda y, con `hiddenInputName`, viajan en el formulario aunque su fila esté oculta (nunca dependen de una casilla visible).
 */
export function StudentPicker({
  students,
  selectedIds,
  onToggle,
  hiddenInputName,
  searchLabel = "Buscar por nombre o apellido",
  emptyText = "No hay alumnos activos todavía.",
  listMaxHeightClass = "max-h-64",
}: {
  students: readonly PickableStudent[];
  selectedIds: ReadonlySet<string>;
  onToggle: (studentId: string) => void;
  /** Si se indica, cada elegido va como `<input type="hidden" name=…>` (pensado para `<form action>`). */
  hiddenInputName?: string;
  searchLabel?: string;
  emptyText?: string;
  listMaxHeightClass?: string;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const view = useMemo(() => buildStudentPickerView(students, query), [students, query]);
  const selected = useMemo(() => selectedStudentsInOrder(students, selectedIds), [students, selectedIds]);
  const hasQuery = query.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hiddenInputName && selected.map((student) => <input key={student.id} type="hidden" name={hiddenInputName} value={student.id} />)}

      {selected.length > 0 && (
        <ul className="mb-1 flex flex-wrap gap-2" aria-label={`Alumnos elegidos (${selected.length})`}>
          {selected.map((student) => (
            <li key={student.id} className="inline-flex min-h-11 items-center gap-1 rounded-pill border-[1.5px] border-ink bg-ink pl-4 pr-1 text-[14.5px] font-[650] text-background">
              <span className="[overflow-wrap:anywhere]">{student.name}</span>
              <button type="button" onClick={() => onToggle(student.id)} aria-label={`Quitar a ${student.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-background hover:bg-white/15">
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-textMuted" aria-hidden />
        <TextInput
          id={searchId}
          type="text"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Dentro de un formulario, Enter en el buscador no debe guardarlo; Escape borra la búsqueda.
            if (event.key === "Enter") event.preventDefault();
            if (event.key === "Escape" && hasQuery) {
              event.preventDefault();
              setQuery("");
            }
          }}
          placeholder={searchLabel}
          className="block pl-11 pr-12"
        />
        {hasQuery && (
          <button type="button" onClick={() => setQuery("")} aria-label="Borrar búsqueda de alumno" className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-pill text-textMuted hover:text-textPrimary">
            <XCircleIcon className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      <p role="status" aria-live="polite" className="px-1 text-[13.5px] font-semibold text-textMuted">
        {view.header}
        {selected.length > 0 && hasQuery && ` · ${selected.length} elegido${selected.length === 1 ? "" : "s"}`}
      </p>

      <div className={`${choiceGroupClass} ${listMaxHeightClass} overflow-y-auto`}>
        {students.length === 0 ? (
          <p className="px-3 py-3 text-[14.5px] text-textMuted">{emptyText}</p>
        ) : view.items.length === 0 ? (
          <p className="px-3 py-3 text-[14.5px] text-textMuted">Ningún alumno coincide con «{view.query}». Probá con otro nombre o apellido.</p>
        ) : (
          view.items.map((student) => {
            const isSelected = selectedIds.has(student.id);
            return (
              <button
                key={student.id}
                type="button"
                onClick={() => onToggle(student.id)}
                aria-pressed={isSelected}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[15px] text-textPrimary transition-colors hover:bg-paperDeep"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-[1.5px] text-[12px] font-bold leading-none ${isSelected ? "border-ink bg-ink text-background" : "border-borderStrong"}`}>
                    {isSelected ? "✓" : ""}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{student.name}</span>
                </span>
                {student.level && <span className="shrink-0 text-[13px] text-textMuted">{student.level}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
