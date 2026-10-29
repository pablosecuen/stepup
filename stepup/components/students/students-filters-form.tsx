"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdjustmentsHorizontalIcon, InformationCircleIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { STUDENT_STATUS_LABEL, STUDENT_STATUS_OPTIONS, MODALITY_LABEL, MODALITY_OPTIONS, STANDARD_LEVELS } from "@/lib/students/constants";
import { Button, PrivateButtonLink, linkClass } from "@/components/ui/button";
import PrivateLink from "@/components/nav/private-link";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { PAYMENT_STATUS_FILTER_OPTIONS, SORT_OPTIONS } from "@/lib/students/list-filters";
import { buildStudentsListHref, cleanStudentSearchText, MAX_STUDENT_SEARCH_LENGTH, STUDENTS_LIST_MEMORY_KEY } from "@/lib/students/list-url";

/** Espera desde la última tecla hasta pedir los resultados: lo bastante corta para sentirse inmediata y lo bastante larga para no pedir una lista por cada letra. */
export const SEARCH_DEBOUNCE_MS = 200;

interface FilterValues {
  search: string;
  status: string;
  level: string;
  modality: string;
  paymentStatus: string;
  sortBy: string;
  levelOptions: string[];
  /** Alumnos que muestra la lista con estos filtros (todas las páginas). */
  totalItems: number;
  /** Alumnos que coinciden con el texto buscado pero que los otros filtros dejan fuera. */
  matchesOutsideFilters: number;
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

function paymentOptions() {
  return PAYMENT_STATUS_FILTER_OPTIONS.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

function sortOptions() {
  return SORT_OPTIONS.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

/** Los filtros que cambiaron respecto del estado inicial (activos, todos los niveles, todas las modalidades), ya en texto. */
function activeFilterLabels({ status, level, modality, paymentStatus, sortBy }: Pick<FilterValues, "status" | "level" | "modality" | "paymentStatus" | "sortBy">): string[] {
  const labels: string[] = [];
  if (status !== "activo") labels.push(`Estado: ${status === "todos" ? "Todos" : (STUDENT_STATUS_LABEL as Record<string, string>)[status] ?? status}`);
  if (level !== "todos") labels.push(`Nivel: ${level}`);
  if (modality !== "todos") labels.push(`Modalidad: ${(MODALITY_LABEL as Record<string, string>)[modality] ?? modality}`);
  if (paymentStatus !== "todos") labels.push(`Pago: ${PAYMENT_STATUS_FILTER_OPTIONS.find((option) => option.value === paymentStatus)?.label ?? paymentStatus}`);
  if (sortBy !== "nombre") labels.push(`Orden: ${SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy}`);
  return labels;
}

/** Los filtros que RECORTAN la búsqueda, incluido el estado «Activo» que viene puesto de entrada (el orden no recorta nada). */
function narrowingFilterLabels({ status, level, modality, paymentStatus }: Pick<FilterValues, "status" | "level" | "modality" | "paymentStatus">): string[] {
  const labels: string[] = [];
  if (status !== "todos") labels.push(`Estado: ${(STUDENT_STATUS_LABEL as Record<string, string>)[status] ?? status}`);
  if (level !== "todos") labels.push(`Nivel: ${level}`);
  if (modality !== "todos") labels.push(`Modalidad: ${(MODALITY_LABEL as Record<string, string>)[modality] ?? modality}`);
  if (paymentStatus !== "todos") labels.push(`Pago: ${PAYMENT_STATUS_FILTER_OPTIONS.find((option) => option.value === paymentStatus)?.label ?? paymentStatus}`);
  return labels;
}

/**
 * Búsqueda y filtros de Alumnos. El servidor sigue siendo el único que filtra, ordena y pagina (nunca se duplica el filtrado en el navegador): este formulario sólo PIDE la dirección
 * `/alumnos?q=…` que corresponde.
 *
 * - Buscar mientras se escribe: ~200 ms después de la última tecla se reemplaza la dirección (`router.replace`, sin llenar el historial letra por letra y sin la página: vuelve a la primera).
 *   Enter hace lo mismo al instante. Los demás filtros se aplican con «Aplicar filtros», como siempre; escribir nunca cambia los filtros ya aplicados.
 * - El campo es del navegador mientras se escribe: la lista nueva nunca le pisa el texto, el cursor ni el foco (una respuesta que llega con otro texto en camino se ignora). Sólo cuando la
 *   búsqueda cambia desde afuera (Limpiar, Quitar filtros, Atrás) el campo adopta el texto de la dirección.
 * - Una respuesta vieja nunca reemplaza a una más nueva: la navegación del router descarta la anterior al empezar otra, y el conteo sale de la misma respuesta que la lista.
 *
 * Escritorio: búsqueda, cinco selectores y «Aplicar filtros» en una fila. Móvil: búsqueda + botón «Filtros» que abre una hoja inferior con los selectores (un formulario propio que reenvía el
 * texto buscado). Los selectores del formulario principal siguen en la página (ocultos con CSS en móvil, no por JavaScript).
 */
export function StudentsFiltersForm(values: FilterValues) {
  const { search, status, level, modality, paymentStatus, sortBy, levelOptions, totalItems, matchesOutsideFilters } = values;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState(search);
  const [debouncing, setDebouncing] = useState(false);
  const [requestedHref, setRequestedHref] = useState<string | null>(null);
  const [lastSearchProp, setLastSearchProp] = useState(search);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSearch, setSheetSearch] = useState(search);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composingRef = useRef(false);
  const activeLabels = activeFilterLabels(values);
  const narrowingLabels = narrowingFilterLabels(values);
  const appliedHref = buildStudentsListHref({ q: search, status, level, modality, pago: paymentStatus, orden: sortBy });

  // Los filtros ya aplicados, siempre los últimos (la espera de 200 ms nunca debe usar un valor viejo).
  const latestRef = useRef({ status, level, modality, pago: paymentStatus, orden: sortBy, appliedHref, requestedHref });
  useEffect(() => {
    latestRef.current = { status, level, modality, pago: paymentStatus, orden: sortBy, appliedHref, requestedHref };
  });

  // La búsqueda cambió desde afuera (Limpiar, Quitar filtros, Atrás): el campo adopta el texto, salvo que la usuaria tenga letras sin enviar o una respuesta en camino.
  if (search !== lastSearchProp) {
    setLastSearchProp(search);
    if (!isPending && !debouncing && cleanStudentSearchText(text) !== search) {
      setText(search);
      setRequestedHref(null);
    }
  }

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STUDENTS_LIST_MEMORY_KEY, appliedHref);
    } catch {
      /* sin almacenamiento de sesión: «Volver a Alumnos» vuelve a la lista sin filtros */
    }
  }, [appliedHref]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function go(href: string, mode: "replace" | "push") {
    cancelTimer();
    setDebouncing(false);
    const latest = latestRef.current;
    if (href === (latest.requestedHref ?? latest.appliedHref)) return;
    setRequestedHref(href);
    startTransition(() => {
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    });
  }

  function searchHref(value: string): string {
    const { status: s, level: l, modality: m, pago, orden } = latestRef.current;
    return buildStudentsListHref({ q: value, status: s, level: l, modality: m, pago, orden });
  }

  function scheduleSearch(value: string) {
    cancelTimer();
    setDebouncing(true);
    timerRef.current = setTimeout(() => go(searchHref(value), "replace"), SEARCH_DEBOUNCE_MS);
  }

  function onTextChange(value: string) {
    setText(value);
    if (composingRef.current) return; // composición de teclado (acentos, IME): se busca al terminar
    scheduleSearch(value);
  }

  function clearText() {
    setText("");
    go(searchHref(""), "replace");
    inputRef.current?.focus();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (name: string, fallback: string) => String(data.get(name) ?? fallback);
    go(buildStudentsListHref({ q: read("q", ""), status: read("status", "activo"), level: read("level", "todos"), modality: read("modality", "todos"), pago: read("pago", "todos"), orden: read("orden", "nombre") }), "push");
  }

  function openSheet() {
    setSheetSearch(cleanStudentSearchText(text));
    setSheetOpen(true);
  }

  const showNotice = search !== "" && narrowingLabels.length > 0 && (matchesOutsideFilters > 0 || totalItems === 0);
  const noticeAction = buildStudentsListHref({ q: search, status: "todos", orden: sortBy });

  return (
    <div className="flex flex-col gap-3">
      <form method="GET" action="/alumnos" role="search" aria-label="Buscar y filtrar alumnos" onSubmit={onSubmit} className="rounded-lg border-[1.5px] border-border bg-surface p-3 shadow-card nav:p-5">
        <div className="flex items-end gap-2 nav:flex-wrap nav:gap-3">
          <div className="min-w-0 flex-1 nav:min-w-[220px] nav:flex-[2_1_240px]">
            <Field label={<span className="max-nav:sr-only">Buscar por nombre</span>} htmlFor="q">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-textMuted" aria-hidden />
                <TextInput
                  ref={inputRef}
                  id="q"
                  name="q"
                  type="text"
                  value={text}
                  onChange={(event) => onTextChange(event.target.value)}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={(event) => {
                    composingRef.current = false;
                    scheduleSearch(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && text !== "") {
                      event.preventDefault();
                      clearText();
                    }
                  }}
                  maxLength={MAX_STUDENT_SEARCH_LENGTH}
                  placeholder="Nombre del alumno..."
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  aria-describedby={search ? "students-search-status" : undefined}
                  className="block pl-11 pr-11"
                />
                {text !== "" && (
                  <button
                    type="button"
                    onClick={clearText}
                    aria-label="Borrar búsqueda"
                    className="absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-textMuted transition-colors hover:text-textPrimary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden />
                  </button>
                )}
              </div>
            </Field>
          </div>

          <div key={`${status}|${level}|${modality}|${paymentStatus}|${sortBy}`} className="hidden min-w-0 flex-[4_1_640px] gap-3 nav:grid nav:grid-cols-5">
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
            <Field label="Estado de pago" htmlFor="pago">
              <SelectInput id="pago" name="pago" defaultValue={paymentStatus}>
                {paymentOptions()}
              </SelectInput>
            </Field>
            <Field label="Ordenar por" htmlFor="orden">
              <SelectInput id="orden" name="orden" defaultValue={sortBy}>
                {sortOptions()}
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

      {search !== "" && (
        <div className="flex flex-col gap-2">
          {/* La cantidad sale de la MISMA respuesta que la lista: nunca puede mostrar un número de otra búsqueda. «Buscando…» aparece sólo si la respuesta tarda. */}
          <p id="students-search-status" role="status" aria-live="polite" className="flex flex-wrap items-baseline gap-x-3 text-[14.5px] font-[650] text-textSecondary [overflow-wrap:anywhere]">
            <span>
              {totalItems === 0 ? "Ninguna coincidencia" : `${totalItems} ${totalItems === 1 ? "coincidencia" : "coincidencias"}`} para «{search}»
            </span>
            <span aria-hidden className={`text-[13px] font-normal text-textMuted transition-opacity duration-150 ${isPending ? "opacity-100 delay-300" : "opacity-0"}`}>
              Buscando…
            </span>
          </p>
          {showNotice && (
            <div className="flex max-w-[720px] gap-2.5 rounded-md border-[1.5px] border-infoLine bg-infoSoft px-3.5 py-3 text-[14px] text-textSecondary">
              <InformationCircleIcon className="mt-px h-5 w-5 shrink-0 text-info" aria-hidden />
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p>
                  Se buscan coincidencias dentro de los filtros elegidos ({narrowingLabels.join(", ")}).
                  {matchesOutsideFilters > 0 && ` Hay ${matchesOutsideFilters} ${matchesOutsideFilters === 1 ? "alumno más que coincide" : "alumnos más que coinciden"} fuera de ellos.`}
                </p>
                <PrivateLink href={noticeAction} className={`${linkClass()} -ml-1 px-1`}>
                  Quitar filtros
                </PrivateLink>
              </div>
            </div>
          )}
        </div>
      )}

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
            <Field label="Estado de pago" htmlFor="sheet-pago">
              <SelectInput id="sheet-pago" name="pago" defaultValue={paymentStatus}>
                {paymentOptions()}
              </SelectInput>
            </Field>
            <Field label="Ordenar por" htmlFor="sheet-orden">
              <SelectInput id="sheet-orden" name="orden" defaultValue={sortBy}>
                {sortOptions()}
              </SelectInput>
            </Field>
          </form>
        </Dialog>
      )}
    </div>
  );
}
