/**
 * Búsqueda de alumnos por nombre — puerto PARCIAL, deliberado, del motor
 * único del móvil (`src/shared/utils/studentSearch.ts`,
 * `matchesStudentSearch`/`scoreStudentNameMatch`). Se portan las capas que
 * cubren el requisito explícito de esta fase ("búsqueda con acentos y
 * mayúsculas"): normalización de acentos/mayúsculas, coincidencia
 * exacta/por prefijo/por prefijo de palabra/por contención, y coincidencia
 * multi-palabra sin importar el orden ("perez juan" encuentra "Juan
 * Pérez"). Deliberadamente NO se porta la capa de tolerancia a errores de
 * tipeo (Damerau-Levenshtein) ni la de iniciales — motores más complejos,
 * de menor impacto para esta fase y con mayor riesgo de una traducción
 * incorrecta sin pruebas exhaustivas propias del móvil disponibles acá. Se
 * documenta como diferencia conocida en `docs/WEB_PARITY_PLAN.md`, nunca
 * silenciada.
 */

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['''´`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(value: string): string[] {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

/** true si `word` empieza, contiene o coincide exactamente con `query` (ambos ya normalizados). */
function wordMatches(word: string, query: string): boolean {
  if (query.length === 0) return true;
  if (word === query) return true;
  if (word.startsWith(query)) return true;
  if (query.length >= 2 && word.includes(query)) return true;
  return false;
}

/**
 * Coincidencia multi-palabra: cada palabra de la búsqueda debe encontrar
 * alguna palabra del nombre que la contenga/empiece con ella (orden
 * independiente) — mismo criterio que `matchMultiWord` del móvil, sin la
 * puntuación fina (acá sólo se necesita sí/no, nunca un ranking).
 */
export function matchesStudentSearch(candidateName: string, query: string): boolean {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return true;

  const candidateWords = wordsOf(candidateName);
  if (candidateWords.length === 0) return false;

  const queryWords = wordsOf(trimmedQuery);
  if (queryWords.length === 0) return true;

  return queryWords.every((queryWord) => candidateWords.some((candidateWord) => wordMatches(candidateWord, queryWord)));
}
