/** Cantidad de tonos cálidos de avatar (clases `.tf-av-0…5` en app/globals.css). */
export const AVATAR_TONE_COUNT = 6;

/** Tono (0–5) estable para una clave (p. ej. el identificador de un alumno): el mismo valor, siempre el mismo color. */
export function avatarToneFor(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % AVATAR_TONE_COUNT;
}

/** Inicial para un avatar (mayúscula, en español); «?» si el nombre está vacío. */
export function avatarInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase("es") || "?";
}

/** Hasta dos iniciales (primera y segunda palabra del nombre) para el avatar de un alumno; «?» si el nombre está vacío. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w.charAt(0).toLocaleUpperCase("es"));
  return letters.join("") || "?";
}
