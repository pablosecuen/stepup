import type { StudentRecord } from "../repositories/students-mapping.ts";
import { rankStudentsBySearch, searchRelevanceClass } from "./search.ts";
import type { StudentStatusProjection } from "./list-status.ts";
import type { StudentListAggregates } from "./list-aggregates.ts";
import type { LevelFilter, ModalityFilter, StatusFilter } from "./filters.ts";

export type PaymentStatusFilter = "todos" | "verde" | "amarillo" | "naranja" | "rojo";
export type StudentSortOption = "nombre" | "proxima_clase" | "ultimo_pago";

export const PAYMENT_STATUS_FILTER_OPTIONS: Array<{ value: PaymentStatusFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "verde", label: "Al día" },
  { value: "amarillo", label: "1er venc." },
  { value: "naranja", label: "2do venc." },
  { value: "rojo", label: "Mora" },
];

export const SORT_OPTIONS: Array<{ value: StudentSortOption; label: string }> = [
  { value: "nombre", label: "Nombre" },
  { value: "proxima_clase", label: "Próxima clase" },
  { value: "ultimo_pago", label: "Último pago" },
];

export interface StudentListFilterState {
  search: string;
  status: StatusFilter;
  level: LevelFilter;
  modality: ModalityFilter;
  paymentStatus: PaymentStatusFilter;
  sortBy: StudentSortOption;
}

/** Un alumno con lo que la lista necesita para filtrar y ordenar. `nextClassStart` ya viene resuelto: una clase pasada o ausente es `null`. */
export interface StudentListEntry {
  student: StudentRecord;
  payment: StudentStatusProjection;
  nextClassStart: string | null;
  nextClassEnd: string | null;
}

/** Una fila de la página: el alumno, su estado de pago, su próxima clase y los datos de las clases dictadas. */
export interface StudentListRow extends StudentListEntry {
  aggregates: StudentListAggregates;
}

export function parsePaymentStatusFilter(value: string | undefined): PaymentStatusFilter {
  return PAYMENT_STATUS_FILTER_OPTIONS.some((option) => option.value === value) ? (value as PaymentStatusFilter) : "todos";
}

export function parseSortOption(value: string | undefined): StudentSortOption {
  return SORT_OPTIONS.some((option) => option.value === value) ? (value as StudentSortOption) : "nombre";
}

/**
 * Filtros y orden de la lista de Alumnos — puerto de `useFilteredStudents` (original). «Estado de pago» filtra por el semáforo de gravedad; «Próxima clase» ordena de la más cercana a la más
 * lejana con los alumnos sin clase próxima al final; «Último pago» del más reciente al más antiguo con los que nunca pagaron al final; el orden por nombre ignora mayúsculas y tildes.
 */
export function applyStudentListFilters(entries: readonly StudentListEntry[], filters: StudentListFilterState): StudentListEntry[] {
  return resolveStudentList(entries, filters).items;
}

/** El resultado completo de la lista (antes de paginar): los alumnos en su orden final y cuántas coincidencias de la búsqueda quedaron fuera por los demás filtros. */
export interface StudentListResolution {
  items: StudentListEntry[];
  /** Alumnos que SÍ coinciden con el texto buscado pero que estado, nivel, modalidad o pago dejan fuera (0 sin búsqueda). Sirve para no ocultarlos en silencio. */
  matchesOutsideFilters: number;
}

function passesListFilters({ student, payment }: StudentListEntry, filters: StudentListFilterState): boolean {
  if (filters.level !== "todos" && !student.levels.includes(filters.level)) return false;
  if (filters.modality !== "todos" && student.modality !== filters.modality) return false;
  if (filters.paymentStatus !== "todos" && payment.paymentStatus !== filters.paymentStatus) return false;
  if (filters.status !== "todos" && student.status !== filters.status) return false;
  return true;
}

/**
 * Búsqueda + filtros + orden, todo sobre la lista COMPLETA de la cuenta y antes de paginar. Con texto buscado manda la relevancia del motor único (`search.ts`): nombre exacto, palabra exacta,
 * comienzos, fragmentos y por último las aproximadas (por cercanía); a igual relevancia rige el orden elegido. Sin texto, sólo el orden elegido.
 */
export function resolveStudentList(entries: readonly StudentListEntry[], filters: StudentListFilterState): StudentListResolution {
  const query = filters.search.trim();
  const ranked = query
    ? rankStudentsBySearch(entries, query, { getName: (entry) => entry.student.name, getStatus: (entry) => entry.student.status, getId: (entry) => entry.student.id })
    : null;
  const relevance = new Map<string, { class: number; score: number }>();
  if (ranked) for (const result of ranked) relevance.set(result.item.student.id, { class: searchRelevanceClass(result.matchType), score: result.score });

  const pool = ranked ? ranked.map((result) => result.item) : entries;
  const filtered = pool.filter((entry) => passesListFilters(entry, filters));
  const matchesOutsideFilters = ranked ? pool.length - filtered.length : 0;

  const byChosenOrder = (a: StudentListEntry, b: StudentListEntry): number => {
    switch (filters.sortBy) {
      case "proxima_clase": {
        if (!a.nextClassStart && !b.nextClassStart) return 0;
        if (!a.nextClassStart) return 1;
        if (!b.nextClassStart) return -1;
        return new Date(a.nextClassStart).getTime() - new Date(b.nextClassStart).getTime();
      }
      case "ultimo_pago": {
        if (!a.payment.lastPaymentAt && !b.payment.lastPaymentAt) return 0;
        if (!a.payment.lastPaymentAt) return 1;
        if (!b.payment.lastPaymentAt) return -1;
        return new Date(b.payment.lastPaymentAt).getTime() - new Date(a.payment.lastPaymentAt).getTime();
      }
      case "nombre":
      default:
        return a.student.name.localeCompare(b.student.name, "es", { sensitivity: "base" });
    }
  };

  const items = [...filtered].sort((a, b) => {
    if (ranked) {
      const aRelevance = relevance.get(a.student.id)!;
      const bRelevance = relevance.get(b.student.id)!;
      if (aRelevance.class !== bRelevance.class) return aRelevance.class - bRelevance.class;
      // Las aproximadas siguen su cercanía (clases 4 y 5); las directas, el orden elegido.
      if (aRelevance.class >= 4 && aRelevance.score !== bRelevance.score) return bRelevance.score - aRelevance.score;
    }
    return byChosenOrder(a, b);
  });
  return { items, matchesOutsideFilters };
}
