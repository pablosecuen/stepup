"use client";

import { useRef, useState } from "react";
import { AdjustmentsHorizontalIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS, MODALITY_LABEL, MODALITY_OPTIONS, STANDARD_LEVELS } from "@/lib/students/constants";
import { Button, PrivateButtonLink, linkClass } from "@/components/ui/button";
import PrivateLink from "@/components/nav/private-link";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";

interface FilterValues {
  search: string;
  status: string;
  level: string;
  modality: string;
  levelOptions: string[];
}

function statusOptions() {
  return STUDENT_STATUS_OPTIONS.map((option) => (
    <option key={option} value={option}>
      {STUDENT_STATUS_LABEL[option]}
    </option>
  ));
}

function levelOptionList(levelOptions: string[]) {
  const allLevels = [...STANDARD_LEVELS, ...levelOptions.filter((l) => !STANDARD_LEVELS.includes(l))];
  return allLevels.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ));
}

function modalityOptions() {
  return MODALITY_OPTIONS.map((option) => (
    <option key={option} value={option}>
      {MODALITY_LABEL[option]}
    </option>
  ));
}

/** Los filtros que cambiaron respecto del estado inicial (activos, todos los niveles, todas las modalidades), ya en texto. */
function activeFilterLabels({ status, level, modality }: FilterValues): string[] {
  const labels: string[] = [];
  if (status !== "activo") labels.push(`Estado: ${status === "todos" ? "Todos" : (STUDENT_STATUS_LABEL as Record<string, string>)[status] ?? status}`);
  if (level !== "todos") labels.push(`Nivel: ${level}`);
  if (modality !== "todos") labels.push(`Modalidad: ${(MODALITY_LABEL as Record<string, string>)[modality] ?? modality}`);
  return labels;
}

/**
 * Formulario GET — sin lógica de filtrado en el cliente. Cada envío navega a `/alumnos?...` con los filtros como query string;
 * la página (Server Component) los lee de `searchParams` y hace el filtrado/orden real. Nunca duplica el filtrado en el cliente.
 *
 * Escritorio: búsqueda, tres selectores y «Aplicar filtros» en una fila. Móvil: búsqueda + botón «Filtros» que abre una hoja
 * inferior con los tres selectores (un formulario propio que reenvía el texto buscado). Los selectores del formulario principal
 * siguen en la página (ocultos con CSS en móvil, no por JavaScript), así buscar por nombre en móvil conserva los filtros activos.
 */
export function StudentsFiltersForm(values: FilterValues) {
  const { search, status, level, modality, levelOptions } = values;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSearch, setSheetSearch] = useState(search);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeLabels = activeFilterLabels(values);

  function openSheet() {
    setSheetSearch(searchRef.current?.value ?? search);
    setSheetOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <form method="GET" action="/alumnos" aria-label="Buscar y filtrar alumnos" className="rounded-lg border-[1.5px] border-border bg-surface p-3 shadow-card nav:p-5">
        <div className="flex items-end gap-2 nav:flex-wrap nav:gap-3">
          <div className="min-w-0 flex-1 nav:min-w-[220px] nav:flex-[2_1_240px]">
            <Field label={<span className="max-nav:sr-only">Buscar por nombre</span>} htmlFor="q">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-textMuted" aria-hidden />
                <TextInput ref={searchRef} id="q" name="q" type="text" defaultValue={search} placeholder="Nombre del alumno..." className="block pl-11" />
              </div>
            </Field>
          </div>

          <div className="hidden min-w-0 flex-[3_1_480px] gap-3 nav:grid nav:grid-cols-3">
            <Field label="Estado" htmlFor="status">
              <SelectInput id="status" name="status" defaultValue={status}>
                <option value="todos">Todos</option>
                {statusOptions()}
              </SelectInput>
            </Field>
            <Field label="Nivel" htmlFor="level">
              <SelectInput id="level" name="level" defaultValue={level}>
                <option value="todos">Todos</option>
                {levelOptionList(levelOptions)}
              </SelectInput>
            </Field>
            <Field label="Modalidad" htmlFor="modality">
              <SelectInput id="modality" name="modality" defaultValue={modality}>
                <option value="todos">Todas</option>
                {modalityOptions()}
              </SelectInput>
            </Field>
          </div>

          <Button type="submit" variant="secondary" className="hidden nav:inline-flex">
            Aplicar filtros
          </Button>
          <PrivateLink href="/alumnos" className={`${linkClass()} hidden px-2 nav:inline-flex`}>
            Limpiar
          </PrivateLink>

          <Button variant="secondary" onClick={openSheet} aria-haspopup="dialog" className="shrink-0 nav:hidden">
            <AdjustmentsHorizontalIcon className="h-5 w-5" aria-hidden />
            Filtros{activeLabels.length > 0 ? ` (${activeLabels.length})` : ""}
          </Button>
        </div>
      </form>

      {activeLabels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 nav:hidden">
          <ul className="flex flex-wrap gap-2" aria-label="Filtros aplicados">
            {activeLabels.map((label) => (
              <li key={label} className="inline-flex min-h-[26px] items-center rounded-pill border border-borderMid bg-paperDeep px-2.5 text-[12.5px] font-[650] text-textSecondary [overflow-wrap:anywhere]">
                {label}
              </li>
            ))}
          </ul>
          <PrivateLink href="/alumnos" className={linkClass()}>
            Limpiar
          </PrivateLink>
        </div>
      )}

      {sheetOpen && (
        <Dialog
          title="Filtros"
          size="sm"
          onClose={() => setSheetOpen(false)}
          footer={
            <>
              <PrivateButtonLink href="/alumnos" variant="secondary">
                Limpiar
              </PrivateButtonLink>
              <Button type="submit" form="students-filters-sheet" variant="primary">
                Aplicar filtros
              </Button>
            </>
          }
        >
          <form id="students-filters-sheet" method="GET" action="/alumnos" className="flex flex-col gap-3.5">
            <input type="hidden" name="q" value={sheetSearch} />
            <Field label="Estado" htmlFor="sheet-status">
              <SelectInput id="sheet-status" name="status" defaultValue={status}>
                <option value="todos">Todos</option>
                {statusOptions()}
              </SelectInput>
            </Field>
            <Field label="Nivel" htmlFor="sheet-level">
              <SelectInput id="sheet-level" name="level" defaultValue={level}>
                <option value="todos">Todos</option>
                {levelOptionList(levelOptions)}
              </SelectInput>
            </Field>
            <Field label="Modalidad" htmlFor="sheet-modality">
              <SelectInput id="sheet-modality" name="modality" defaultValue={modality}>
                <option value="todos">Todas</option>
                {modalityOptions()}
              </SelectInput>
            </Field>
          </form>
        </Dialog>
      )}
    </div>
  );
}
