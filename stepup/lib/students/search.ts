/**
 * Motor ÚNICO de búsqueda aproximada de alumnos — puerto completo de `src/shared/utils/studentSearch.ts` (app anterior). Puro, sin dependencias, sin ningún nombre ni consulta
 * escrita a mano: todo depende de la normalización y de la distancia/subsecuencia sobre el texto recibido. Usado por Alumnos, Nueva clase (clase única y serie semanal), Registrar clase
 * no programada y Modificar participantes: nunca reimplementar una coincidencia exacta ni un `includes()` aislado en una pantalla nueva.
 *
 * El alumno sólo tiene un campo `name` con el nombre completo (no hay nombre/apellido separados), así que «cada palabra», «apellido + nombre» e «iniciales» se resuelven
 * tokenizando ese único campo. Prioridad (cada banda de puntaje es disjunta de la siguiente): nombre completo exacto → palabra exacta → comienzo del nombre → comienzo de una palabra →
 * contenido literal → iniciales → aproximada (error de tipeo o subsecuencia) → alfabético como desempate.
 */

const DIACRITICS_PATTERN = /[̀-ͯ]/g;
const PUNCTUATION_PATTERN = /['’´`-]/g;
const WHITESPACE_PATTERN = /\s+/g;

/** Minúsculas, sin tildes ni diéresis, apóstrofes y guiones como separadores y espacios colapsados (igual para la consulta y para los candidatos). */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS_PATTERN, "").toLowerCase().replace(PUNCTUATION_PATTERN, " ").replace(WHITESPACE_PATTERN, " ").trim();
}

function tokenize(normalized: string): string[] {
  return normalized.length > 0 ? normalized.split(" ") : [];
}

/** Damerau-Levenshtein («optimal string alignment»): inserción, eliminación, sustitución y transposición de dos letras seguidas valen una operación. */
function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const distance: number[][] = Array.from({ length: aLen + 1 }, () => new Array<number>(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i++) distance[i][0] = i;
  for (let j = 0; j <= bLen; j++) distance[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(distance[i - 1][j] + 1, distance[i][j - 1] + 1, distance[i - 1][j - 1] + substitutionCost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, distance[i - 2][j - 2] + 1);
      distance[i][j] = best;
    }
  }
  return distance[aLen][bLen];
}

/** Errores de tipeo tolerados según el largo de la PALABRA consultada: 1–2 letras → 1 (sólo sobre el prefijo), 3–5 → 1, 6–9 → 2, 10 o más → proporcional con tope de 4. */
function maxAllowedTypos(queryWordLength: number): number {
  if (queryWordLength <= 2) return 1;
  if (queryWordLength <= 5) return 1;
  if (queryWordLength <= 9) return 2;
  return Math.min(4, Math.floor(queryWordLength / 5) + 1);
}

/**
 * Subsecuencia ordenada: las letras de la consulta aparecen en el mismo orden dentro de la palabra, sin exigir que sean consecutivas. Puntaje 0–1 por densidad, cobertura y qué tan
 * temprano empieza; se rechazan las coincidencias absurdas (una consulta corta dispersa en una palabra larga, o ni densa ni con cobertura real).
 */
function subsequenceRatio(query: string, word: string): number | null {
  let searchFrom = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (const letter of query) {
    const foundAt = word.indexOf(letter, searchFrom);
    if (foundAt === -1) return null;
    if (firstIndex === -1) firstIndex = foundAt;
    lastIndex = foundAt;
    searchFrom = foundAt + 1;
  }
  const span = lastIndex - firstIndex + 1;
  const density = query.length / span;
  const coverage = query.length / word.length;
  const positionPenalty = firstIndex / word.length;
  if (span > query.length * 3 + 2) return null;
  if (density < 0.3 && coverage < 0.25) return null;
  const raw = 0.55 * density + 0.3 * coverage + 0.15 * (1 - positionPenalty);
  return Math.max(0, Math.min(1, raw));
}

export type StudentSearchMatchType = "exact" | "word_exact" | "prefix" | "word_prefix" | "contains" | "initials" | "fuzzy" | "subsequence";

const SCORE_EXACT = 1000;
const SCORE_WORD_EXACT = 960;
const SCORE_PREFIX_MIN = 860;
const SCORE_PREFIX_MAX = 940;
const SCORE_WORD_PREFIX_MIN = 740;
const SCORE_WORD_PREFIX_MAX = 830;
const SCORE_CONTAINS_MIN = 600;
const SCORE_CONTAINS_MAX = 700;
const SCORE_INITIALS_MIN = 460;
const SCORE_INITIALS_MAX = 560;
const SCORE_FUZZY_MIN = 300;
const SCORE_FUZZY_MAX = 420;
const SCORE_SUBSEQUENCE_MIN = 150;
const SCORE_SUBSEQUENCE_MAX = 280;

/** Puntaje mínimo global para aceptar cualquier coincidencia — filtro de seguridad final. */
const MIN_ACCEPTABLE_SCORE = 60;

interface WordMatch {
  score: number;
  type: StudentSearchMatchType;
}

/** Coincidencia entre UNA palabra de la consulta y UNA palabra candidata. */
function matchWordPair(query: string, word: string): WordMatch | null {
  if (query.length === 0 || word.length === 0) return null;
  if (query === word) return { score: SCORE_WORD_EXACT, type: "word_exact" };

  if (word.startsWith(query)) {
    const ratio = query.length / word.length;
    return { score: SCORE_WORD_PREFIX_MIN + (SCORE_WORD_PREFIX_MAX - SCORE_WORD_PREFIX_MIN) * ratio, type: "word_prefix" };
  }

  // Una sola letra que no abre la palabra sigue valiendo si la palabra la CONTIENE (sólo literal, nunca difuso): «z» encuentra a «Juan Perez».
  if (query.length === 1) return word.includes(query) ? { score: SCORE_CONTAINS_MIN, type: "contains" } : null;

  if (query.length >= 3 && word.includes(query)) {
    const ratio = query.length / word.length;
    return { score: SCORE_CONTAINS_MIN + (SCORE_CONTAINS_MAX - SCORE_CONTAINS_MIN) * ratio, type: "contains" };
  }

  const allowedTypos = maxAllowedTypos(query.length);

  // Prefijo aproximado: la consulta contra el tramo inicial de la palabra del mismo largo («je» encuentra «jose», «goms» encuentra «gomez»).
  if (query.length >= 2) {
    const prefixDistance = damerauLevenshteinDistance(query, word.slice(0, query.length));
    if (prefixDistance > 0 && prefixDistance <= allowedTypos) {
      const ratio = 1 - prefixDistance / query.length;
      return { score: SCORE_FUZZY_MIN + (SCORE_FUZZY_MAX - SCORE_FUZZY_MIN) * ratio, type: "fuzzy" };
    }
  }

  // Distancia sobre la palabra completa: letras omitidas o agregadas en cualquier posición y transposiciones, desde 3 letras.
  if (query.length >= 3) {
    const fullDistance = damerauLevenshteinDistance(query, word);
    if (fullDistance > 0 && fullDistance <= allowedTypos) {
      const ratio = 1 - fullDistance / Math.max(query.length, word.length);
      return { score: SCORE_FUZZY_MIN + (SCORE_FUZZY_MAX - SCORE_FUZZY_MIN) * ratio, type: "fuzzy" };
    }
  }

  if (query.length >= 2) {
    const ratio = subsequenceRatio(query, word);
    if (ratio !== null) return { score: SCORE_SUBSEQUENCE_MIN + (SCORE_SUBSEQUENCE_MAX - SCORE_SUBSEQUENCE_MIN) * ratio, type: "subsequence" };
  }

  return null;
}

// Orden de mejor a peor, sólo para informar el tipo de coincidencia «más débil» de una consulta de varias palabras (nunca cambia el puntaje).
const MATCH_TYPE_PRIORITY: StudentSearchMatchType[] = ["exact", "word_exact", "prefix", "word_prefix", "contains", "initials", "fuzzy", "subsequence"];

/** Iniciales: la consulta (sin espacios) coincide con las primeras letras de palabras consecutivas — «jp» → «Juan Pérez». Último recurso. */
function matchInitials(query: string, candidateWords: string[]): number | null {
  if (query.length < 2 || query.length > candidateWords.length) return null;
  const initials = candidateWords.map((word) => word[0] ?? "").join("");
  if (initials.length === 0) return null;
  if (initials.startsWith(query)) return SCORE_INITIALS_MAX;
  if (initials.includes(query)) return SCORE_INITIALS_MIN + (SCORE_INITIALS_MAX - SCORE_INITIALS_MIN) * 0.6;
  let searchFrom = 0;
  for (const letter of query) {
    const foundAt = initials.indexOf(letter, searchFrom);
    if (foundAt === -1) return null;
    searchFrom = foundAt + 1;
  }
  return SCORE_INITIALS_MIN;
}

interface ScoredMatch {
  score: number;
  matchType: StudentSearchMatchType;
}

/** Cada palabra de la consulta busca su mejor coincidencia entre TODAS las palabras del nombre, sin importar el orden; si alguna no encuentra nada, se rechaza todo. */
function matchMultiWord(queryWords: string[], candidateWords: string[]): ScoredMatch | null {
  const perWord: WordMatch[] = [];
  for (const queryWord of queryWords) {
    let best: WordMatch | null = null;
    for (const candidateWord of candidateWords) {
      const match = matchWordPair(queryWord, candidateWord);
      if (match && (!best || match.score > best.score)) best = match;
    }
    if (!best) return null;
    perWord.push(best);
  }
  const averageScore = perWord.reduce((sum, match) => sum + match.score, 0) / perWord.length;
  const completenessBonus = perWord.length > 1 ? 8 : 0;
  const worstType = perWord.reduce<StudentSearchMatchType>((worst, match) => (MATCH_TYPE_PRIORITY.indexOf(match.type) > MATCH_TYPE_PRIORITY.indexOf(worst) ? match.type : worst), perWord[0].type);
  return { score: averageScore + completenessBonus, matchType: worstType };
}

/** Puntúa un nombre completo contra una consulta completa. `null` cuando no hay relación real (nunca un `true`/`false` plano). */
export function scoreStudentNameMatch(candidateName: string, query: string): ScoredMatch | null {
  const candidateNormalized = normalizeSearchText(candidateName);
  const queryNormalized = normalizeSearchText(query);
  if (queryNormalized.length === 0 || candidateNormalized.length === 0) return null;

  if (candidateNormalized === queryNormalized) return { score: SCORE_EXACT, matchType: "exact" };

  if (candidateNormalized.startsWith(queryNormalized)) {
    const ratio = queryNormalized.length / candidateNormalized.length;
    return { score: SCORE_PREFIX_MIN + (SCORE_PREFIX_MAX - SCORE_PREFIX_MIN) * ratio, matchType: "prefix" };
  }

  const candidateWords = tokenize(candidateNormalized);

  // Una sola letra: inicio de palabra rankea más alto, pero cualquier nombre o apellido que la contenga aparece (sólo literal).
  if (queryNormalized.length === 1) {
    if (candidateWords.some((word) => word.startsWith(queryNormalized))) return { score: SCORE_WORD_PREFIX_MAX, matchType: "word_prefix" };
    if (candidateWords.some((word) => word.includes(queryNormalized))) return { score: SCORE_CONTAINS_MIN, matchType: "contains" };
    return null;
  }

  const queryWords = tokenize(queryNormalized);
  const wordResult = matchMultiWord(queryWords, candidateWords);

  // Iniciales: sólo como alternativa cuando la consulta es una sola palabra que no encontró relación real palabra por palabra.
  let initialsResult: ScoredMatch | null = null;
  if (queryWords.length === 1 && queryWords[0].length >= 2 && !wordResult) {
    const initialsScore = matchInitials(queryWords[0], candidateWords);
    if (initialsScore !== null) initialsResult = { score: initialsScore, matchType: "initials" };
  }

  const result = wordResult ?? initialsResult;
  if (!result || result.score < MIN_ACCEPTABLE_SCORE) return null;
  return result;
}

export interface StudentSearchOptions<T> {
  getName: (item: T) => string;
  /** Alumno activo primero en caso de empate — opcional. */
  getStatus?: (item: T) => string;
  /** ID estable como último desempate — opcional. */
  getId?: (item: T) => string;
}

export interface StudentSearchResult<T> {
  item: T;
  score: number;
  matchType: StudentSearchMatchType;
}

function bestPrefixRatio(candidateName: string, query: string): number {
  const candidateWords = tokenize(normalizeSearchText(candidateName));
  const queryNormalized = normalizeSearchText(query);
  let best = 0;
  for (const word of candidateWords) if (word.startsWith(queryNormalized)) best = Math.max(best, queryNormalized.length / word.length);
  return best;
}

/**
 * Ordena y filtra por relevancia sin mutar la lista. Con la consulta vacía devuelve todo en el mismo orden. Desempate ante igual puntaje: coincidencia exacta con la primera palabra,
 * con la última, alumno activo, mejor prefijo, orden alfabético e id.
 */
export function rankStudentsBySearch<T>(items: readonly T[], query: string, options: StudentSearchOptions<T>): StudentSearchResult<T>[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return items.map((item) => ({ item, score: 0, matchType: "exact" as const }));

  const { getName, getStatus, getId } = options;
  const queryFirstWord = tokenize(normalizeSearchText(trimmedQuery))[0] ?? "";

  const scored: StudentSearchResult<T>[] = [];
  for (const item of items) {
    const match = scoreStudentNameMatch(getName(item), trimmedQuery);
    if (match) scored.push({ item, score: match.score, matchType: match.matchType });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aWords = tokenize(normalizeSearchText(getName(a.item)));
    const bWords = tokenize(normalizeSearchText(getName(b.item)));
    const aFirstExact = aWords[0] === queryFirstWord;
    const bFirstExact = bWords[0] === queryFirstWord;
    if (aFirstExact !== bFirstExact) return aFirstExact ? -1 : 1;
    const aLastExact = aWords[aWords.length - 1] === queryFirstWord;
    const bLastExact = bWords[bWords.length - 1] === queryFirstWord;
    if (aLastExact !== bLastExact) return aLastExact ? -1 : 1;
    if (getStatus) {
      const aActive = getStatus(a.item) === "activo";
      const bActive = getStatus(b.item) === "activo";
      if (aActive !== bActive) return aActive ? -1 : 1;
    }
    const aPrefix = bestPrefixRatio(getName(a.item), trimmedQuery);
    const bPrefix = bestPrefixRatio(getName(b.item), trimmedQuery);
    if (aPrefix !== bPrefix) return bPrefix - aPrefix;
    const nameCompare = getName(a.item).localeCompare(getName(b.item), "es", { sensitivity: "base" });
    if (nameCompare !== 0) return nameCompare;
    if (getId) return getId(a.item).localeCompare(getId(b.item));
    return 0;
  });

  return scored;
}

/** La misma búsqueda, devolviendo sólo los elementos en su orden final. */
export function searchStudentsByName<T>(items: readonly T[], query: string, options: StudentSearchOptions<T>): T[] {
  return rankStudentsBySearch(items, query, options).map((result) => result.item);
}

/** ¿`candidateName` tiene alguna relación real con `query`? Para pantallas que filtran su propia lista (por ejemplo Alumnos, que ordena por nombre). */
export function matchesStudentSearch(candidateName: string, query: string): boolean {
  if (query.trim().length === 0) return true;
  return scoreStudentNameMatch(candidateName, query) !== null;
}
