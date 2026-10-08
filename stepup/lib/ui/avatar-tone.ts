/** Cantidad de tonos cálidos de avatar (clases `.tf-av-0…5` en app/globals.css). */
export const AVATAR_TONE_COUNT = 6;

/** Tono (0–5) estable para una clave (p. ej. el identificador de un alumno): el mismo valor, siempre el mismo color. */
export function avatarToneFor(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % AVATAR_TONE_COUNT;
}
