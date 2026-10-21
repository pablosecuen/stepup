import { normalizeSearchText, searchStudentsByName } from "./search.ts";

/**
 * Lógica pura del selector de alumnos con buscador (Nueva clase — clase única y serie semanal —, Registrar clase no programada y Modificar participantes de una serie): qué alumnos se
 * listan para una búsqueda, qué dice el encabezado de resultados y qué elegidos se muestran. Puerto de `NewCalendarLessonSheet` (app anterior: «N alumnos disponibles», «N coincidencia(s)»,
 * lista completa ordenada por nombre sin búsqueda, relevancia con búsqueda). La búsqueda sólo filtra lo que se VE: los alumnos elegidos nunca dejan de estar elegidos.
 */
export interface PickableStudent {
  id: string;
  name: string;
  status?: string;
  /** Nivel o niveles, sólo para mostrar a la derecha de cada fila. */
  level?: string;
}

export interface StudentPickerView<T extends PickableStudent> {
  /** Alumnos a listar: todos por nombre (sin búsqueda) o los que coinciden, por relevancia. */
  items: T[];
  /** «12 alumnos disponibles», «3 coincidencias», «Ninguna coincidencia» o «No hay alumnos cargados». */
  header: string;
  /** La consulta ya limpia (sin espacios de los extremos). */
  query: string;
}

export function buildStudentPickerView<T extends PickableStudent>(students: readonly T[], rawQuery: string): StudentPickerView<T> {
  const query = rawQuery.trim();
  if (students.length === 0) return { items: [], header: "No hay alumnos cargados", query };
  if (!query) {
    const items = [...students].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    return { items, header: `${items.length} alumno${items.length === 1 ? "" : "s"} disponible${items.length === 1 ? "" : "s"}`, query };
  }
  const items = searchStudentsByName(students, query, { getName: (student) => student.name, getStatus: (student) => student.status ?? "", getId: (student) => student.id });
  return { items, header: items.length === 0 ? "Ninguna coincidencia" : `${items.length} coincidencia${items.length === 1 ? "" : "s"}`, query };
}

/** Elegidos en el orden de la lista completa de alumnos (nunca se pierde uno por estar fuera del resultado de la búsqueda; uno que ya no existe se descarta). */
export function selectedStudentsInOrder<T extends PickableStudent>(students: readonly T[], selectedIds: ReadonlySet<string> | readonly string[]): T[] {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds as readonly string[]);
  return students.filter((student) => selected.has(student.id));
}

/** ¿El nombre escrito coincide EXACTAMENTE con algún alumno (ignorando tildes y mayúsculas)? Sirve para no ofrecer «¿Ya existe?» cuando ya se encontró. */
export function hasExactNameMatch(students: readonly PickableStudent[], query: string): boolean {
  const normalized = normalizeSearchText(query);
  return normalized.length > 0 && students.some((student) => normalizeSearchText(student.name) === normalized);
}
