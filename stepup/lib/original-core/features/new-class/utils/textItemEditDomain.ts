// Puerto VERBATIM del original (`src/features/new-class/utils/textItemEditDomain.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-14 (a pedido de Joaquín — CORRECCIÓN GENERAL: "no se
 * puede corregir un elemento de texto ya guardado sin borrarlo y volver a
 * escribirlo"): funciones puras que reemplazan el texto de UN elemento ya
 * agregado, preservando su posición (o su identidad, para `TopicEntry`) y
 * todo lo demás de la lista — nunca "borrar y crear de nuevo".
 */
import type { TopicEntry } from '../types/index.ts';

/** Reemplaza el texto del elemento en `index`, sin tocar el resto de la lista. */
export function replaceChipTextAt(items: string[], index: number, newText: string): string[] {
  return items.map((item, i) => (i === index ? newText : item));
}

/** Reemplaza sólo el `text` del tema con ese `id` — conserva su `status` (planificado/visto) intacto. */
export function replaceTopicTextById(items: TopicEntry[], id: string, newText: string): TopicEntry[] {
  return items.map((item) => (item.id === id ? { ...item, text: newText } : item));
}
