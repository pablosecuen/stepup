// Puerto VERBATIM del original (`src/shared/utils/studentSearch.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Motor único de búsqueda aproximada de alumnos (corrección 2026-07-20, a
 * pedido de Joaquín — "MOTOR DE BÚSQUEDA APROXIMADA DE ALUMNOS"). Puro, sin
 * dependencias externas, sin ningún nombre ni consulta hardcodeada — todo
 * el comportamiento depende únicamente de la normalización y el cálculo de
 * distancia/subsecuencia sobre el texto real recibido.
 *
 * Reemplaza la versión anterior (que sólo soportaba coincidencia exacta,
 * prefijo, prefijo por palabra y un único nivel de tolerancia a errores) y
 * las implementaciones paralelas que hacían `includes()` aislado en otras
 * pantallas (ver `StudentOrGroupPicker.tsx`, redirigida a este módulo).
 *
 * El modelo real de alumno (`StudentProfile`/`StudentListItem`) sólo tiene
 * un campo `name: string` con el nombre completo — no existen campos
 * separados de segundo nombre, segundo apellido ni nombre preferido. Por
 * eso "buscar por cada palabra individual", "apellido + nombre" y
 * "iniciales" se resuelven tokenizando ese único campo, sin necesidad de
 * campos adicionales que hoy no existen en el modelo.
 */

// ---------------------------------------------------------------------------
// Normalización (misma para consulta y candidatos, para que ambas queden
// comparables): minúsculas, sin tildes/diéresis, apóstrofes/guiones tratados
// como separadores de palabra, espacios colapsados. `ñ` se descompone a `n`
// igual que cualquier otra letra con marca diacrítica — deliberado: no hay
// caso especial para `ñ`, así nunca genera una coincidencia "absurda" que
// una `n` normal no generaría también.
// ---------------------------------------------------------------------------

const DIACRITICS_PATTERN = /[̀-ͯ]/g;
const PUNCTUATION_PATTERN = /['’´`-]/g;
const WHITESPACE_PATTERN = /\s+/g;

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .toLowerCase()
    .replace(PUNCTUATION_PATTERN, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  return normalized.length > 0 ? normalized.split(' ') : [];
}

// ---------------------------------------------------------------------------
// Distancia de edición — Damerau-Levenshtein (variante "optimal string
// alignment": admite una transposición de caracteres adyacentes como una
// única operación, además de inserción/eliminación/sustitución). Pura,
// O(n*m), más que suficiente para nombres de hasta unas pocas decenas de
// caracteres.
// ---------------------------------------------------------------------------

function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const distance: number[][] = Array.from({ length: aLen + 1 }, () =>
    new Array<number>(bLen + 1).fill(0)
  );
  for (let i = 0; i <= aLen; i++) distance[i][0] = i;
  for (let j = 0; j <= bLen; j++) distance[0][j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        distance[i - 1][j] + 1, // eliminación
        distance[i][j - 1] + 1, // inserción
        distance[i - 1][j - 1] + substitutionCost // sustitución
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, distance[i - 2][j - 2] + 1); // transposición adyacente
      }
      distance[i][j] = best;
    }
  }
  return distance[aLen][bLen];
}

/**
 * Tolerancia a errores según la longitud de la PALABRA consultada (no del
 * candidato) — límites orientativos pedidos: 1 letra → 0 errores; 2 letras
 * → hasta 1 (sólo aplicado sobre el prefijo, ver `matchWordPair`); 3–5 →
 * hasta 1; 6–9 → hasta 2; 10+ → proporcional, limitada a un máximo de 4
 * para nunca aceptar una palabra sin relación real.
 */
function maxAllowedTypos(queryWordLength: number): number {
  if (queryWordLength <= 2) return 1;
  if (queryWordLength <= 5) return 1;
  if (queryWordLength <= 9) return 2;
  return Math.min(4, Math.floor(queryWordLength / 5) + 1);
}

// ---------------------------------------------------------------------------
// Subsecuencia ordenada: la consulta coincide si sus letras aparecen en el
// mismo orden dentro de la palabra candidata, sin exigir que sean
// consecutivas. Se puntúa (0..1) combinando densidad (qué tan seguidas
// están las letras encontradas — consecutivas puntúa mejor que muy
// separadas), cobertura (qué proporción de la palabra "explica" la
// consulta) y qué tan temprano empieza la coincidencia. Se aplican dos
// umbrales para rechazar coincidencias absurdas: una consulta corta no
// puede dispersarse en una palabra mucho más larga, y una consulta poco
// densa y con poca cobertura tampoco se acepta (evita que "letras sueltas"
// en cualquier posición cuenten como coincidencia real).
// ---------------------------------------------------------------------------

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
  const density = query.length / span; // 1 = letras totalmente consecutivas
  const coverage = query.length / word.length;
  const positionPenalty = firstIndex / word.length;

  // Rechazo 1: consulta corta dispersa en una franja demasiado amplia de la palabra.
  if (span > query.length * 3 + 2) return null;
  // Rechazo 2: ni densa ni con cobertura real — "una letra suelta" en una
  // palabra mucho más larga no cuenta como coincidencia.
  if (density < 0.3 && coverage < 0.25) return null;

  const raw = 0.55 * density + 0.3 * coverage + 0.15 * (1 - positionPenalty);
  return Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// Tipos de coincidencia y bandas de puntaje. Cada banda es disjunta de la
// siguiente, respetando la prioridad pedida (corrección 2026-07-22 — a
// pedido de Joaquín, "BUSCADOR GENERAL DE ALUMNOS"):
//   1. nombre completo exacto
//   2. palabra exacta
//   3. comienzo del nombre completo
//   4. comienzo de alguna palabra
//   5. coincidencia literal dentro del nombre o apellido (contenido)
//   6. iniciales
//   7. coincidencia aproximada (error tipográfico / subsecuencia)
//   8. alfabético, como desempate final (ver `rankStudentsBySearch`)
// El puntaje final de una consulta de varias palabras es el promedio de la
// mejor coincidencia por palabra (más un pequeño bono por tener más de una
// palabra reconocida) — así una consulta "nombre apellido" con ambas
// palabras en nivel alto queda mejor rankeada que una con una sola palabra
// reconocida, sin dejar de ser comparable con los umbrales de cada banda.
// ---------------------------------------------------------------------------

export type StudentSearchMatchType =
  | 'exact'
  | 'word_exact'
  | 'prefix'
  | 'word_prefix'
  | 'contains'
  | 'initials'
  | 'fuzzy'
  | 'subsequence';

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

  // Palabra exacta: tier propio, siempre por debajo del nombre completo
  // exacto (evaluado en `scoreStudentNameMatch`) pero por encima de
  // cualquier prefijo — así "perez" contra "Juan Perez" nunca empata en
  // puntaje con un candidato cuyo nombre completo fuera literalmente "perez".
  if (query === word) return { score: SCORE_WORD_EXACT, type: 'word_exact' };

  if (word.startsWith(query)) {
    const ratio = query.length / word.length;
    return {
      score: SCORE_WORD_PREFIX_MIN + (SCORE_WORD_PREFIX_MAX - SCORE_WORD_PREFIX_MIN) * ratio,
      type: 'word_prefix',
    };
  }

  // Corrección 2026-07-22 (a pedido de Joaquín — bug real: "z" no
  // encontraba a "Juan Perez"): una consulta de una sola letra que no es
  // inicio de la palabra sigue siendo válida si la palabra la CONTIENE en
  // cualquier posición — coincidencia literal únicamente, nunca distancia
  // difusa (tal como pide el punto 4 del pedido).
  if (query.length === 1) {
    return word.includes(query) ? { score: SCORE_CONTAINS_MIN, type: 'contains' } : null;
  }

  if (query.length >= 3 && word.includes(query)) {
    const ratio = query.length / word.length;
    return {
      score: SCORE_CONTAINS_MIN + (SCORE_CONTAINS_MAX - SCORE_CONTAINS_MIN) * ratio,
      type: 'contains',
    };
  }

  const allowedTypos = maxAllowedTypos(query.length);

  // Prefijo aproximado: compara la consulta contra el tramo inicial de la
  // palabra candidata, del mismo largo que la consulta — esto es lo que
  // permite que "je" encuentre "jose" (prefijo real "jo", a 1 sustitución)
  // o que "goms" encuentre "gomez" (prefijo real "gome", a 1 sustitución)
  // sin necesitar tolerancia adicional sobre la palabra completa.
  if (query.length >= 2) {
    const wordPrefix = word.slice(0, query.length);
    const prefixDistance = damerauLevenshteinDistance(query, wordPrefix);
    if (prefixDistance > 0 && prefixDistance <= allowedTypos) {
      const ratio = 1 - prefixDistance / query.length;
      return {
        score: SCORE_FUZZY_MIN + (SCORE_FUZZY_MAX - SCORE_FUZZY_MIN) * ratio,
        type: 'fuzzy',
      };
    }
  }

  // Distancia de edición sobre la palabra completa — cubre letras omitidas
  // o agregadas en cualquier posición (no sólo al final), y transposiciones
  // adyacentes, para consultas de 3 letras o más.
  if (query.length >= 3) {
    const fullDistance = damerauLevenshteinDistance(query, word);
    if (fullDistance > 0 && fullDistance <= allowedTypos) {
      const ratio = 1 - fullDistance / Math.max(query.length, word.length);
      return {
        score: SCORE_FUZZY_MIN + (SCORE_FUZZY_MAX - SCORE_FUZZY_MIN) * ratio,
        type: 'fuzzy',
      };
    }
  }

  if (query.length >= 2) {
    const ratio = subsequenceRatio(query, word);
    if (ratio !== null) {
      return {
        score: SCORE_SUBSEQUENCE_MIN + (SCORE_SUBSEQUENCE_MAX - SCORE_SUBSEQUENCE_MIN) * ratio,
        type: 'subsequence',
      };
    }
  }

  return null;
}

// Orden de mejor a peor (usado sólo para reportar el `matchType` "más débil"
// entre las palabras de una consulta de varias palabras — nunca afecta el
// puntaje en sí). Corrección 2026-07-22: "iniciales" pasa a rankear por
// encima de "aproximada" (fuzzy/subsequence), como pide el punto 5 del
// pedido — antes quedaba último, contradiciendo esa prioridad.
const MATCH_TYPE_PRIORITY: StudentSearchMatchType[] = [
  'exact',
  'word_exact',
  'prefix',
  'word_prefix',
  'contains',
  'initials',
  'fuzzy',
  'subsequence',
];

/**
 * Iniciales: la consulta (sin espacios) coincide con la primera letra de
 * palabras consecutivas del candidato — "jp" -> "Juan Pérez", "mg" ->
 * "Martina Gómez". Es el último recurso: sólo se intenta cuando la
 * consulta, tomada como una sola palabra, no encontró ninguna relación
 * real por prefijo/contenido/error tipográfico/subsecuencia contra NINGUNA
 * palabra candidata (ver `matchMultiWord`).
 */
function matchInitials(query: string, candidateWords: string[]): number | null {
  if (query.length < 2 || query.length > candidateWords.length) return null;

  const initials = candidateWords.map((word) => word[0] ?? '').join('');
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

/**
 * Consulta de varias palabras (o de una sola, que no sea el caso especial
 * de 1 letra): cada palabra de la consulta busca su mejor coincidencia
 * entre TODAS las palabras candidatas, sin importar el orden ("perez
 * juan" encuentra "Juan Pérez" igual que "juan perez"). Si alguna palabra
 * de la consulta no encuentra ninguna relación con ninguna palabra
 * candidata, se rechaza la coincidencia completa — "nombre y apellido no
 * tienen relación suficiente con la consulta" del pedido.
 */
function matchMultiWord(queryWords: string[], candidateWords: string[]): ScoredMatch | null {
  const perWord: WordMatch[] = [];

  for (const queryWord of queryWords) {
    let best: WordMatch | null = null;
    for (const candidateWord of candidateWords) {
      const match = matchWordPair(queryWord, candidateWord);
      if (match && (!best || match.score > best.score)) {
        best = match;
      }
    }
    if (!best) return null;
    perWord.push(best);
  }

  const averageScore = perWord.reduce((sum, match) => sum + match.score, 0) / perWord.length;
  const completenessBonus = perWord.length > 1 ? 8 : 0;

  const worstType = perWord.reduce<StudentSearchMatchType>((worst, match) => {
    return MATCH_TYPE_PRIORITY.indexOf(match.type) > MATCH_TYPE_PRIORITY.indexOf(worst)
      ? match.type
      : worst;
  }, perWord[0].type);

  return { score: averageScore + completenessBonus, matchType: worstType };
}

/**
 * Puntúa un nombre candidato completo contra una consulta completa.
 * Devuelve `null` cuando no hay relación real — nunca `false`/`true`
 * planos, siempre un puntaje determinista o ausencia de coincidencia.
 */
export function scoreStudentNameMatch(
  candidateName: string,
  query: string
): ScoredMatch | null {
  const candidateNormalized = normalizeSearchText(candidateName);
  const queryNormalized = normalizeSearchText(query);
  if (queryNormalized.length === 0 || candidateNormalized.length === 0) return null;

  if (candidateNormalized === queryNormalized) {
    return { score: SCORE_EXACT, matchType: 'exact' };
  }

  if (candidateNormalized.startsWith(queryNormalized)) {
    const ratio = queryNormalized.length / candidateNormalized.length;
    return {
      score: SCORE_PREFIX_MIN + (SCORE_PREFIX_MAX - SCORE_PREFIX_MIN) * ratio,
      matchType: 'prefix',
    };
  }

  const candidateWords = tokenize(candidateNormalized);

  // Corrección 2026-07-22 (a pedido de Joaquín — bug real: "z" no
  // encontraba a "Juan Perez"): una consulta de una sola letra ya no se
  // limita al inicio de una palabra — cualquier alumno cuyo nombre o
  // apellido CONTENGA esa letra en cualquier posición debe aparecer
  // (inicio de palabra sigue rankeando más alto). Sigue siendo
  // exclusivamente literal: nunca dispara distancia difusa ni subsecuencia.
  if (queryNormalized.length === 1) {
    const startsHit = candidateWords.some((word) => word.startsWith(queryNormalized));
    if (startsHit) return { score: SCORE_WORD_PREFIX_MAX, matchType: 'word_prefix' };
    const containsHit = candidateWords.some((word) => word.includes(queryNormalized));
    if (containsHit) return { score: SCORE_CONTAINS_MIN, matchType: 'contains' };
    return null;
  }

  const queryWords = tokenize(queryNormalized);
  const wordResult = matchMultiWord(queryWords, candidateWords);

  // Iniciales: sólo se evalúa como alternativa cuando la consulta es un
  // único token (sin espacios) que no encontró relación real palabra por
  // palabra — evita que "iniciales" le gane a una coincidencia real de
  // prefijo/contenido/error tipográfico ya encontrada.
  let initialsResult: ScoredMatch | null = null;
  if (queryWords.length === 1 && queryWords[0].length >= 2 && !wordResult) {
    const initialsScore = matchInitials(queryWords[0], candidateWords);
    if (initialsScore !== null) {
      initialsResult = { score: initialsScore, matchType: 'initials' };
    }
  }

  const result = wordResult ?? initialsResult;
  if (!result || result.score < MIN_ACCEPTABLE_SCORE) return null;
  return result;
}

// ---------------------------------------------------------------------------
// API pública — usada por Alumnos, Nueva clase, Agregar participantes y
// cualquier selector futuro. Una única implementación: nunca reimplementar
// coincidencia exacta ni `includes()` aislado en una pantalla nueva.
// ---------------------------------------------------------------------------

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
  for (const word of candidateWords) {
    if (word.startsWith(queryNormalized)) {
      best = Math.max(best, queryNormalized.length / word.length);
    }
  }
  return best;
}

/**
 * Ordena y filtra `items` por relevancia frente a `query`, sin mutar el
 * arreglo recibido. Con `query` vacía devuelve `items` tal cual (mismo
 * orden, sin copiar).
 *
 * Desempate ante mismo puntaje, en este orden: coincidencia exacta en la
 * primera palabra del nombre completo ("nombre"), coincidencia exacta en
 * la última palabra ("apellido" — el modelo real no separa nombre de
 * apellido en campos distintos, así que se adapta tomando la primera y la
 * última palabra del nombre completo), alumno activo, mejor prefijo,
 * orden alfabético, ID estable.
 */
export function rankStudentsBySearch<T>(
  items: readonly T[],
  query: string,
  options: StudentSearchOptions<T>
): StudentSearchResult<T>[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return items.map((item) => ({ item, score: 0, matchType: 'exact' as const }));
  }

  const { getName, getStatus, getId } = options;
  const queryFirstWord = tokenize(normalizeSearchText(trimmedQuery))[0] ?? '';

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
      const aActive = getStatus(a.item) === 'activo';
      const bActive = getStatus(b.item) === 'activo';
      if (aActive !== bActive) return aActive ? -1 : 1;
    }

    const aPrefix = bestPrefixRatio(getName(a.item), trimmedQuery);
    const bPrefix = bestPrefixRatio(getName(b.item), trimmedQuery);
    if (aPrefix !== bPrefix) return bPrefix - aPrefix;

    const nameCompare = getName(a.item).localeCompare(getName(b.item), 'es', { sensitivity: 'base' });
    if (nameCompare !== 0) return nameCompare;

    if (getId) return getId(a.item).localeCompare(getId(b.item));
    return 0;
  });

  return scored;
}

/**
 * Misma búsqueda que `rankStudentsBySearch`, devolviendo sólo los items en
 * el orden final — firma compatible con la versión anterior de este
 * módulo para no romper a los consumidores existentes (Nueva clase,
 * Agregar participantes) que sólo necesitan la lista ya ordenada.
 */
export function searchStudentsByName<T>(
  items: readonly T[],
  query: string,
  options: StudentSearchOptions<T>
): T[] {
  return rankStudentsBySearch(items, query, options).map((result) => result.item);
}

/**
 * `true`/`false` de si `candidateName` tiene alguna relación real con
 * `query` — usada por pantallas que filtran una lista propia (por ejemplo
 * Alumnos, que además permite elegir un criterio de orden distinto al de
 * relevancia) sin necesitar el puntaje ni el tipo de coincidencia.
 */
export function matchesStudentSearch(candidateName: string, query: string): boolean {
  if (query.trim().length === 0) return true;
  return scoreStudentNameMatch(candidateName, query) !== null;
}
