import type { StudentModality, StudentStatus } from "../db/database.types.ts";
import type { StudentRecord } from "../repositories/students-mapping.ts";
import { matchesStudentSearch } from "./search.ts";

/**
 * Filtros/orden puros de la lista de Alumnos — puerto de
 * `useFilteredStudents`/`StudentsFilterState` del móvil (`DEFAULT_FILTER_STATE.status
 * = 'activo'`, regla confirmada, nunca "todos" por defecto).
 *
 * Deliberadamente SIN `paymentStatus` (filtro) ni `proxima_clase`/`ultimo_pago`
 * (orden): dependen de `calendar_lessons`/`payment_charges`, que todavía no
 * existen en la web (Fase 3/5) — nunca se inventa ese dato. Se documentan
 * como pendientes en `docs/WEB_PARITY_PLAN.md`, nunca se ocultan en
 * silencio.
 */
export type StatusFilter = StudentStatus | "todos";
export type LevelFilter = string | "todos";
export type ModalityFilter = StudentModality | "todos";
export type SortOption = "nombre";

export interface StudentsFilterState {
  search: string;
  status: StatusFilter;
  level: LevelFilter;
  modality: ModalityFilter;
  sortBy: SortOption;
}

export const DEFAULT_FILTER_STATE: StudentsFilterState = {
  search: "",
  status: "activo",
  level: "todos",
  modality: "todos",
  sortBy: "nombre",
};

function sortByName(a: StudentRecord, b: StudentRecord): number {
  return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
}

/** Pura — filtra y ordena una lista ya cargada. No consulta Supabase. */
export function applyStudentFilters(students: StudentRecord[], filters: StudentsFilterState): StudentRecord[] {
  const query = filters.search.trim();
  const filtered = students.filter((student) => {
    if (query && !matchesStudentSearch(student.name, query)) return false;
    if (filters.level !== "todos" && !student.levels.includes(filters.level)) return false;
    if (filters.modality !== "todos" && student.modality !== filters.modality) return false;
    if (filters.status !== "todos" && student.status !== filters.status) return false;
    return true;
  });
  return [...filtered].sort(sortByName);
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** Pura — pagina una lista ya filtrada/ordenada. `page` es 1-indexado, siempre válido (recortado a rango real). */
export function paginate<T>(items: T[], page: number, pageSize: number): PaginatedResult<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
  };
}
