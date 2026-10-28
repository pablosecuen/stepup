// Puerto VERBATIM del original (`src/features/new-class/utils/savedLessonLinkageDiagnostics.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../../calendar/types/index.ts';
import { buildCalendarReservationKey } from '../../calendar/utils/calendarRecurrenceMutations.ts';
import type { SavedLesson } from '../types/index.ts';
import { validateNewClassForm } from './validation.ts';

/**
 * Corrección 2026-08-27, quinta ronda (a pedido de Joaquín — EVIDENCIA
 * FÍSICA REAL: 23 `SavedLesson` reales, con contenido pedagógico real,
 * quedaban clasificados como "sin clase real que los respalde" — CORREGIR
 * EL MODELO): un `SavedLesson` sin `CalendarLesson` materializada NO es un
 * problema. En una serie recurrente, la ocurrencia puede ser virtual o
 * haberse regenerado sin necesidad de materializarse nunca (ver
 * `markCalendarLessonCompleted`, que no bloquea el registro pedagógico si
 * no encuentra una ocurrencia real al momento de registrar) — el registro
 * pedagógico persistido debe sobrevivir y mostrarse SIEMPRE,
 * independientemente de si el Calendario llegó a materializar una tarjeta.
 *
 * Esta ronda separa dos conceptos que la ronda anterior mezclaba:
 *
 *   1) VINCULACIÓN (`classifySavedLessonLinkage`): información puramente
 *      enriquecedora, nunca una condición de validez. Un `SavedLesson` sin
 *      ningún vínculo (`no_calendar_link`) es tan válido como uno vinculado
 *      — la única diferencia real es si el Calendario puede ofrecer
 *      "Editar registro" desde una tarjeta además del acceso directo por
 *      `SavedLesson.id` (que siempre funciona, con o sin vínculo).
 *   2) INTEGRIDAD real (`findSavedLessonIntegrityIssues`): los ÚNICOS
 *      problemas genuinos de un `SavedLesson` — formulario estructuralmente
 *      inválido (misma validación real que ya usa el guardado,
 *      `validateNewClassForm` — nunca una segunda regla) o dos registros
 *      distintos compartiendo la misma identidad canónica
 *      (`calendarReservationKey` duplicado, una corrupción real). Nunca se
 *      reporta "sin vínculo" como si fuera un problema de integridad.
 */

export type SavedLessonLinkKind =
  | 'linked' // calendarReservationKey coincide exacto con una CalendarLesson completed real
  | 'recoverable_by_stable_identity' // sin calendarReservationKey, pero calendarLessonId apunta a UNA CalendarLesson completed real
  | 'ambiguous' // más de un candidato posible — nunca se fusiona automáticamente
  | 'no_calendar_link'; // sin ninguna CalendarLesson vinculada — NORMAL, nunca un problema; el registro sigue siendo válido y visible por su propio SavedLesson.id

export interface SavedLessonLinkageResult {
  savedLessonId: string;
  kind: SavedLessonLinkKind;
  /** Sólo presente cuando kind === 'linked' | 'recoverable_by_stable_identity'. */
  matchedCalendarLessonId: string | null;
  /** Todos los candidatos considerados — longitud > 1 sólo en 'ambiguous'. */
  candidateCalendarLessonIds: string[];
}

export interface CompletedLessonWithoutSavedLesson {
  calendarLessonId: string;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
}

export interface SavedLessonLinkageReport {
  results: SavedLessonLinkageResult[];
  completedWithoutSavedLesson: CompletedLessonWithoutSavedLesson[];
}

function findCandidates(saved: SavedLesson, calendarLessons: CalendarLesson[]): CalendarLesson[] {
  // 1) Identidad canónica exacta — misma que usa findSavedLessonForCalendarLesson.
  if (saved.calendarReservationKey) {
    const exact = calendarLessons.filter(
      (lesson) => lesson.status === 'completed' && buildCalendarReservationKey(lesson) === saved.calendarReservationKey
    );
    if (exact.length > 0) return exact;
  }
  // 2) Identidad secundaria estable, también canónica (nunca una
  // aproximación): el id real de la CalendarLesson que se completó,
  // guardado en su momento — algunos registros lo tienen aunque no tengan
  // calendarReservationKey.
  if (saved.calendarLessonId) {
    return calendarLessons.filter(
      (lesson) => lesson.status === 'completed' && lesson.id === saved.calendarLessonId
    );
  }
  return [];
}

/**
 * Clasificación de sólo lectura — nunca muta `savedLessons` ni
 * `calendarLessons`, nunca escribe en ningún almacenamiento. Apta para
 * correr sobre un respaldo exportado (modo lectura) sin ningún riesgo.
 * `no_calendar_link` NUNCA debe tratarse como un problema — ver el
 * docblock del módulo.
 */
export function classifySavedLessonLinkage(input: {
  savedLessons: SavedLesson[];
  calendarLessons: CalendarLesson[];
}): SavedLessonLinkageReport {
  const { savedLessons, calendarLessons } = input;
  const linkedCalendarLessonIds = new Set<string>();

  const results: SavedLessonLinkageResult[] = savedLessons.map((saved) => {
    const candidates = findCandidates(saved, calendarLessons);
    if (candidates.length === 0) {
      return {
        savedLessonId: saved.id,
        kind: 'no_calendar_link',
        matchedCalendarLessonId: null,
        candidateCalendarLessonIds: [],
      };
    }
    if (candidates.length > 1) {
      return {
        savedLessonId: saved.id,
        kind: 'ambiguous',
        matchedCalendarLessonId: null,
        candidateCalendarLessonIds: candidates.map((lesson) => lesson.id),
      };
    }
    const match = candidates[0];
    linkedCalendarLessonIds.add(match.id);
    const isExact = Boolean(saved.calendarReservationKey) && buildCalendarReservationKey(match) === saved.calendarReservationKey;
    return {
      savedLessonId: saved.id,
      kind: isExact ? 'linked' : 'recoverable_by_stable_identity',
      matchedCalendarLessonId: match.id,
      candidateCalendarLessonIds: [match.id],
    };
  });

  const completedWithoutSavedLesson: CompletedLessonWithoutSavedLesson[] = calendarLessons
    .filter((lesson) => lesson.status === 'completed' && !linkedCalendarLessonIds.has(lesson.id))
    .map((lesson) => ({
      calendarLessonId: lesson.id,
      recurrenceId: lesson.recurrenceId,
      recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
    }));

  return { results, completedWithoutSavedLesson };
}

export interface RecoveredSavedLessonLinks {
  savedLessons: SavedLesson[];
  recoveredSavedLessonIds: string[];
}

/**
 * Repara de forma ADITIVA los registros `recoverable_by_stable_identity`:
 * les completa `calendarReservationKey` con la identidad canónica real ya
 * encontrada, para que la próxima consulta los encuentre también por el
 * camino directo desde una tarjeta de Calendario — nunca copia ni duplica
 * el registro, nunca toca ningún otro campo, nunca decide sobre un caso
 * 'ambiguous'. Un `SavedLesson` `no_calendar_link` NUNCA se toca acá: no
 * hay nada que reparar en un registro que simplemente nunca tuvo (ni
 * necesita) una ocurrencia materializada. Idempotente: un registro ya
 * 'linked' no aparece en el reporte como recuperable, así que una segunda
 * pasada no vuelve a tocarlo.
 */
export function recoverOrphanedSavedLessonLinks(input: {
  savedLessons: SavedLesson[];
  calendarLessons: CalendarLesson[];
}): RecoveredSavedLessonLinks {
  const report = classifySavedLessonLinkage(input);
  const recoverableByLessonId = new Map(
    report.results
      .filter((result): result is SavedLessonLinkageResult & { matchedCalendarLessonId: string } =>
        result.kind === 'recoverable_by_stable_identity' && result.matchedCalendarLessonId !== null
      )
      .map((result) => [result.savedLessonId, result.matchedCalendarLessonId])
  );
  if (recoverableByLessonId.size === 0) {
    return { savedLessons: input.savedLessons, recoveredSavedLessonIds: [] };
  }
  const calendarLessonById = new Map(input.calendarLessons.map((lesson) => [lesson.id, lesson]));
  const recoveredSavedLessonIds: string[] = [];
  const savedLessons = input.savedLessons.map((saved) => {
    const matchedId = recoverableByLessonId.get(saved.id);
    if (!matchedId) return saved;
    const matchedLesson = calendarLessonById.get(matchedId);
    if (!matchedLesson) return saved;
    recoveredSavedLessonIds.push(saved.id);
    return {
      ...saved,
      calendarReservationKey: buildCalendarReservationKey(matchedLesson),
    };
  });
  return { savedLessons, recoveredSavedLessonIds };
}

// ===========================================================================
// Integridad REAL de SavedLesson — los únicos problemas genuinos.
// ===========================================================================

export type SavedLessonIntegrityIssueKind = 'duplicate_canonical_key' | 'invalid_form';

export interface SavedLessonIntegrityIssue {
  savedLessonId: string;
  kind: SavedLessonIntegrityIssueKind;
  /** Sólo presente en 'duplicate_canonical_key': el otro SavedLesson real con la misma clave. */
  relatedSavedLessonId?: string;
}

/**
 * Los ÚNICOS problemas reales de un `SavedLesson`: dos registros distintos
 * comparten la misma identidad canónica (`calendarReservationKey`
 * duplicado — una corrupción real, nunca esperada) o el formulario
 * persistido no pasa la MISMA validación estructural que ya exige el
 * guardado real (`validateNewClassForm`, `validation.ts` — nunca una
 * segunda regla paralela). Nunca clasifica "sin CalendarLesson vinculada"
 * como problema — eso es `classifySavedLessonLinkage`, información
 * separada y nunca un indicio de corrupción.
 */
export function findSavedLessonIntegrityIssues(savedLessons: SavedLesson[]): SavedLessonIntegrityIssue[] {
  const issues: SavedLessonIntegrityIssue[] = [];
  const firstSeenIdByKey = new Map<string, string>();

  savedLessons.forEach((saved) => {
    if (saved.calendarReservationKey) {
      const existingId = firstSeenIdByKey.get(saved.calendarReservationKey);
      if (existingId) {
        issues.push({ savedLessonId: saved.id, kind: 'duplicate_canonical_key', relatedSavedLessonId: existingId });
      } else {
        firstSeenIdByKey.set(saved.calendarReservationKey, saved.id);
      }
    }

    const validation = validateNewClassForm(saved.form);
    if (!validation.isValid) {
      issues.push({ savedLessonId: saved.id, kind: 'invalid_form' });
    }
  });

  return issues;
}
