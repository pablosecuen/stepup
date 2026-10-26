/**
 * Lo que queda escrito sin confirmar en los campos «agregar» del registro y las ediciones de etiquetas en curso. Puro: lo usa el guardado para
 * incorporarlo a las listas ANTES de enviar (nunca se pierde un texto pendiente) y las pruebas.
 */

/** Texto pendiente de una clave, sin espacios sobrantes. */
export function pendingText(drafts: Readonly<Record<string, string>>, key: string): string {
  return (drafts[key] ?? "").trim();
}

/** Claves de la edición en curso de una etiqueta: la posición y el texto nuevo. */
export const editIndexKey = (listKey: string) => `${listKey}#edit-index`;
export const editTextKey = (listKey: string) => `${listKey}#edit-text`;

/** Aplica a una lista de textos lo pendiente: la edición en curso (en su lugar, mismo orden) y el borrador de «agregar» (al final). */
export function applyPendingToList(items: string[], drafts: Readonly<Record<string, string>>, listKey: string): string[] {
  let next = items;
  const rawIndex = drafts[editIndexKey(listKey)];
  const index = rawIndex === undefined || rawIndex === "" ? -1 : Number(rawIndex);
  const edited = pendingText(drafts, editTextKey(listKey));
  if (Number.isInteger(index) && index >= 0 && index < next.length && edited) next = next.map((item, i) => (i === index ? edited : item));
  const added = pendingText(drafts, listKey);
  return added ? [...next, added] : next;
}

/** Igual para los temas: la edición en curso cambia SÓLO el texto del tema en su lugar (conserva `id` y `status`) y el borrador de «agregar» suma un tema nuevo «planificado» al final. */
export function applyPendingToTopics<T extends { id: string | null; text: string; status: "planificado" | "visto" }>(topics: T[], drafts: Readonly<Record<string, string>>, listKey: string, newId: () => string): T[] {
  let next = topics;
  const rawIndex = drafts[editIndexKey(listKey)];
  const index = rawIndex === undefined || rawIndex === "" ? -1 : Number(rawIndex);
  const edited = pendingText(drafts, editTextKey(listKey));
  if (Number.isInteger(index) && index >= 0 && index < next.length && edited) next = next.map((topic, i) => (i === index ? { ...topic, text: edited } : topic));
  const added = pendingText(drafts, listKey);
  return added ? [...next, { id: newId(), text: added, status: "planificado" } as T] : next;
}

/** ¿Hay algo escrito pendiente (incluida una edición abierta)? */
export function hasPendingDrafts(drafts: Readonly<Record<string, string>>): boolean {
  return Object.values(drafts).some((value) => value.trim() !== "");
}
