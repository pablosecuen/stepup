/**
 * La dirección de la lista de Alumnos (`/alumnos?q=…&status=…`): UNA sola forma de armarla para el servidor (paginación, enlaces) y para el campo de búsqueda del navegador, de modo que
 * la misma búsqueda siempre produce la misma dirección — recargable, compartible y comparable (si no cambió, no se vuelve a pedir nada). Los valores por defecto no se escriben.
 */

/** Largo máximo del texto buscado: de sobra para un nombre completo, y acota el costo de comparar con cada alumno. */
export const MAX_STUDENT_SEARCH_LENGTH = 100;

/** Dónde se recuerda, por pestaña, la última lista mostrada (búsqueda y filtros) para que «Volver a Alumnos» desde un perfil la recupere. */
export const STUDENTS_LIST_MEMORY_KEY = "tf.alumnos.lista";

export interface StudentsListUrlState {
  q?: string;
  status?: string;
  level?: string;
  modality?: string;
  pago?: string;
  orden?: string;
  page?: string;
}

/** El texto buscado como viaja en la dirección: sin espacios al principio ni al final, espacios repetidos colapsados y acotado. «ale », « ale» y «ale» son la misma búsqueda. */
export function cleanStudentSearchText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_STUDENT_SEARCH_LENGTH).trim();
}

export function buildStudentsListHref(state: StudentsListUrlState): string {
  const query = new URLSearchParams();
  const q = cleanStudentSearchText(state.q);
  if (q) query.set("q", q);
  if (state.status && state.status !== "activo") query.set("status", state.status);
  if (state.level && state.level !== "todos") query.set("level", state.level);
  if (state.modality && state.modality !== "todos") query.set("modality", state.modality);
  if (state.pago && state.pago !== "todos") query.set("pago", state.pago);
  if (state.orden && state.orden !== "nombre") query.set("orden", state.orden);
  if (state.page && state.page !== "1") query.set("page", state.page);
  const qs = query.toString();
  return qs ? `/alumnos?${qs}` : "/alumnos";
}
