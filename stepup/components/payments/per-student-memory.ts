/**
 * Memoria de la pestaña «Por alumno» (sessionStorage, sólo de esta pestaña del navegador): al abrir un detalle o la edición de un plan se guarda la dirección de la lista
 * (con su búsqueda, filtro y orden), el desplazamiento y los alumnos con sus conceptos desplegados; al volver, la lista se dibuja igual y vuelve a ese punto. Sin almacenamiento,
 * la lista simplemente empieza arriba y cerrada.
 */
export const PER_STUDENT_MEMORY_KEY = "teacherflow:cobros-por-alumno";
const MEMORY_MAX_AGE_MS = 30 * 60 * 1000;
const LIST_HREF_PATTERN = /^\/cobros\/por-alumno(\?[^#\s]*)?$/;

export interface PerStudentMemory {
  href: string;
  y: number;
  studentId: string | null;
  /** Alumnos cuyos conceptos estaban desplegados. */
  expanded: string[];
  at: number;
}

export function readPerStudentMemory(now: number = Date.now()): PerStudentMemory | null {
  try {
    const raw = window.sessionStorage.getItem(PER_STUDENT_MEMORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PerStudentMemory>;
    if (typeof parsed.href !== "string" || !LIST_HREF_PATTERN.test(parsed.href)) return null;
    if (typeof parsed.at !== "number" || now - parsed.at > MEMORY_MAX_AGE_MS) return null;
    const expanded = Array.isArray(parsed.expanded) ? parsed.expanded.filter((id): id is string => typeof id === "string").slice(0, 500) : [];
    return { href: parsed.href, y: typeof parsed.y === "number" && parsed.y >= 0 ? parsed.y : 0, studentId: typeof parsed.studentId === "string" ? parsed.studentId : null, expanded, at: parsed.at };
  } catch {
    return null;
  }
}

export function writePerStudentMemory(memory: Omit<PerStudentMemory, "at">): void {
  try {
    window.sessionStorage.setItem(PER_STUDENT_MEMORY_KEY, JSON.stringify({ ...memory, at: Date.now() }));
  } catch {
    // sin almacenamiento de sesión: se vuelve a la lista sin posición guardada
  }
}

export function clearPerStudentMemory(): void {
  try {
    window.sessionStorage.removeItem(PER_STUDENT_MEMORY_KEY);
  } catch {
    // nada que borrar
  }
}
