// Puerto VERBATIM del original (`src/features/calendar/utils/calendarRecurrenceSplit.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarConflict,
  CalendarLesson,
  GeneratedOccurrence,
  PendingRecurrenceDraft,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';
import type { TeacherAvailability, AvailabilityEvaluation } from '../types/teacherAvailability.ts';
import { findCalendarConflicts, hasBlockingConflict } from './calendarConflicts.ts';
import { generateOccurrences } from './calendarRecurrenceEngine.ts';
import { addDaysToDateKey, getDateKeyJsDay, getLocalDateKey, localDateTimeToInstantIso } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';
import { evaluateAvailability } from './teacherAvailabilityEngine.ts';

export interface RecurrenceSplitResult {
  originalRule: RecurrenceRule;
  successorRule: RecurrenceRule;
  exceptions: RecurrenceException[];
  addedExceptions: RecurrenceException[];
}

export interface FutureRecurrenceConflict {
  occurrence: GeneratedOccurrence;
  calendarConflicts: CalendarConflict[];
  availability: AvailabilityEvaluation;
}

export interface ConsolidatedStudentRecurrences {
  rules: RecurrenceRule[];
  supersededRecurrenceIds: string[];
}

export interface RepairedExplicitSuccessors {
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
  changed: boolean;
}

/**
 * ProyecciÃ³n para UI: una sola serie vigente por alumno. Prioriza la
 * sucesora explÃ­cita mÃ¡s reciente; en datos legacy ambiguos conserva la
 * Ãºltima regla vigente segÃºn el orden persistido.
 */
export function selectCanonicalRecurrenceRules(
  rules: RecurrenceRule[],
  nowIso: string
): RecurrenceRule[] {
  const grouped = new Map<string, Array<{ rule: RecurrenceRule; index: number }>>();
  rules.forEach((rule, index) => {
    const today = getLocalDateKey(nowIso, rule.timezone);
    const isFutureRelevant =
      rule.status !== 'ended' && (!rule.endDate || rule.endDate >= today);
    if (!isFutureRelevant) return;
    const current = grouped.get(rule.studentId) ?? [];
    current.push({ rule, index });
    grouped.set(rule.studentId, current);
  });

  return [...grouped.values()]
    .map((candidates) => {
      const explicit = candidates.filter(
        ({ rule }) => Boolean(rule.supersedesRecurrenceId && rule.effectiveFromDate)
      );
      const source = explicit.length > 0 ? explicit : candidates;
      return source.reduce((best, candidate) => {
        if (explicit.length > 0) {
          const bestDate = best.rule.effectiveFromDate ?? '';
          const candidateDate = candidate.rule.effectiveFromDate ?? '';
          if (candidateDate > bestDate) return candidate;
          if (candidateDate === bestDate && candidate.index > best.index) return candidate;
          return best;
        }
        return candidate.index > best.index ? candidate : best;
      }).rule;
    });
}

/**
 * Corrección 2026-09-16 (a pedido de Joaquín — SERIES DE ENTRENAMIENTO QUE
 * DESAPARECEN DE "SERIES"): CAUSA RAÍZ confirmada — `selectCanonicalRecurrenceRules`
 * agrupa por `rule.studentId`, que es la identidad CORRECTA para una serie
 * individual (TeacherFlow modela todos los días habituales de un alumno en
 * una sola regla — ver comentario de esa función más arriba), pero NO es la
 * identidad de "una serie" en general: dos entrenamientos distintos pueden
 * compartir el mismo alumno principal, varios entrenamientos grupales
 * pueden no tener ninguno (`studentId === ''`, así que todos caían en la
 * MISMA clave de agrupación y sólo uno sobrevivía), y un entrenamiento
 * grupal tiene participantes reales en `participantIds`, no en `studentId`.
 *
 * La única identidad válida de "misma serie, dos tramos" es el LINAJE real
 * de recurrencia: `supersedesRecurrenceId`/`effectiveFromDate`, escritos
 * EXCLUSIVAMENTE por `splitRecurrenceFromDate` ("esta clase y las
 * siguientes"). Cualquier otro par de reglas — aunque coincidan en alumno,
 * participantes, horario o nombre, aunque ninguna de las dos tenga
 * `trainingBillingAgreementId` — son series independientes por definición
 * (nunca se agrupa por igualdad de `undefined`, mismo criterio que ya usa
 * `resolveTrainingBillingLineage` en el motor de cobro). No hace falta
 * agrupar también por `trainingBillingAgreementId`: ese id viaja solo con
 * el spread de `splitRecurrenceFromDate`, así que un linaje real YA lo
 * comparte sin necesidad de un segundo criterio — agregarlo fusionaría
 * series distintas que casualmente comparten acuerdo por otra vía.
 *
 * Devuelve una regla por linaje: la que sigue vigente hacia el futuro
 * (mismo filtro `isFutureRelevant` que `selectCanonicalRecurrenceRules`,
 * así que un linaje totalmente finalizado o vencido no aparece — una serie
 * finalizada nunca vuelve a ofrecer "Configurar/Editar cuota"). Fuente
 * única para la pantalla "Series" (`RecurrenceRulesSheet.tsx`) — el resto
 * de los consumidores de `selectCanonicalRecurrenceRules` (edición de
 * futuras, splits) resuelven una pregunta distinta ("la serie vigente DE
 * ESTE alumno") y siguen usando ese selector sin cambios.
 */
export function selectManageableRecurrenceSeries(
  rules: RecurrenceRule[],
  nowIso: string
): RecurrenceRule[] {
  const byId = new Map(rules.map((item) => [item.recurrenceId, item]));

  function lineageRootId(candidateRule: RecurrenceRule, visited: Set<string>): string {
    if (visited.has(candidateRule.recurrenceId)) return candidateRule.recurrenceId; // ciclo defensivo — nunca debería ocurrir con datos sanos
    visited.add(candidateRule.recurrenceId);
    if (!candidateRule.supersedesRecurrenceId) return candidateRule.recurrenceId;
    const predecessor = byId.get(candidateRule.supersedesRecurrenceId);
    if (!predecessor) return candidateRule.recurrenceId; // predecesor ya no existe: esta regla es la raíz conocida
    return lineageRootId(predecessor, visited);
  }

  const grouped = new Map<string, Array<{ rule: RecurrenceRule; index: number }>>();
  rules.forEach((candidateRule, index) => {
    const today = getLocalDateKey(nowIso, candidateRule.timezone);
    const isFutureRelevant =
      candidateRule.status !== 'ended' && (!candidateRule.endDate || candidateRule.endDate >= today);
    if (!isFutureRelevant) return;
    const root = lineageRootId(candidateRule, new Set());
    const current = grouped.get(root) ?? [];
    current.push({ rule: candidateRule, index });
    grouped.set(root, current);
  });

  return [...grouped.values()].map((candidates) => {
    if (candidates.length === 1) return candidates[0].rule;
    // Defensivo: en datos sanos cada linaje tiene a lo sumo un tramo
    // vigente a la vez (el split cierra el original al crear la sucesora).
    // Si una anomalía histórica dejara más de uno, se usa el mismo criterio
    // de desempate que selectCanonicalRecurrenceRules: sucesora explícita
    // más reciente.
    const explicit = candidates.filter(
      ({ rule: candidateRule }) => Boolean(candidateRule.supersedesRecurrenceId && candidateRule.effectiveFromDate)
    );
    const source = explicit.length > 0 ? explicit : candidates;
    return source.reduce((best, candidate) => {
      if (explicit.length > 0) {
        const bestDate = best.rule.effectiveFromDate ?? '';
        const candidateDate = candidate.rule.effectiveFromDate ?? '';
        if (candidateDate > bestDate) return candidate;
        if (candidateDate === bestDate && candidate.index > best.index) return candidate;
        return best;
      }
      return candidate.index > best.index ? candidate : best;
    }).rule;
  });
}

/**
 * ReparaciÃ³n conservadora para datos ya guardados: sÃ³lo consolida cuando
 * existe una sucesora con linaje explÃ­cito. Las reglas legacy ambiguas sin
 * supersedesRecurrenceId/effectiveFromDate quedan intactas.
 */
export function repairExplicitSuccessorDuplicates(input: {
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
}): RepairedExplicitSuccessors {
  const latestByStudent = new Map<string, RecurrenceRule>();
  input.rules.forEach((rule) => {
    if (
      rule.status === 'ended' ||
      !rule.supersedesRecurrenceId ||
      !rule.effectiveFromDate
    ) return;
    const current = latestByStudent.get(rule.studentId);
    if (
      !current ||
      (current.effectiveFromDate ?? '') < rule.effectiveFromDate ||
      ((current.effectiveFromDate ?? '') === rule.effectiveFromDate &&
        current.startDate < rule.startDate)
    ) {
      latestByStudent.set(rule.studentId, rule);
    }
  });

  let rules = input.rules;
  let lessons = input.lessons;
  let changed = false;

  latestByStudent.forEach((successor) => {
    const effectiveDate = successor.effectiveFromDate!;
    const original = rules.find(
      (rule) => rule.recurrenceId === successor.supersedesRecurrenceId
    );
    if (!original) return;
    const cutoff = addDaysToDateKey(effectiveDate, -1);
    const repairedOriginal: RecurrenceRule = original.startDate < effectiveDate
      ? {
          ...original,
          endDate: cutoff,
          supersededByRecurrenceId: successor.recurrenceId,
        }
      : {
          ...original,
          status: 'ended',
          supersededByRecurrenceId: successor.recurrenceId,
        };
    const consolidation = consolidateStudentFutureRecurrences({
      rules,
      originalRule: repairedOriginal,
      successorRule: successor,
      effectiveDate,
    });
    const nextLessons = removeFutureMaterializationsForRecurrences(
      lessons,
      consolidation.supersededRecurrenceIds,
      effectiveDate,
      successor.timezone
    );
    const rulesChanged = consolidation.rules.some((rule, index) => {
      const previous = rules[index];
      return !previous ||
        previous.status !== rule.status ||
        previous.endDate !== rule.endDate ||
        previous.supersededByRecurrenceId !== rule.supersededByRecurrenceId;
    });
    if (rulesChanged || nextLessons.length !== lessons.length) changed = true;
    rules = consolidation.rules;
    lessons = nextLessons;
  });

  return { rules, lessons, changed };
}

export interface FalselyTruncatedRecurrenceRepair {
  rules: RecurrenceRule[];
  repairedRecurrenceIds: string[];
}

/**
 * Corrección 2026-08-27, segunda ronda (a pedido de Joaquín — FALLO FÍSICO
 * CONFIRMADO: SERIE TODAVÍA AUSENTE): la corrección anterior arregló el
 * ALGORITMO (`consolidateStudentFutureRecurrences` ya compara contra
 * `originalRule.studentId`), pero nunca repara una `RecurrenceRule` cuyo
 * `endDate`/`status: 'ended'` YA quedó truncado y persistido por el bug
 * antes de esa corrección — el algoritmo sano no reescribe datos que ya
 * están mal, sólo evita ensuciar datos sanos.
 *
 * Evidencia determinista de un daño causado POR ESTE bug específico (nunca
 * un final genuino): la regla dañada (`victim`) quedó con
 * `supersededByRecurrenceId` apuntando a otra regla (`impostor`) — pero el
 * linaje REAL de `impostor` (siguiendo su propia cadena de
 * `supersedesRecurrenceId` hasta la raíz) nació bajo un `studentId`
 * DISTINTO al de `victim`. Eso es estructuralmente imposible en una
 * consolidación legítima (`consolidateStudentFutureRecurrences`, ahora
 * corregida, sólo trunca reglas cuyo linaje real pertenece al MISMO
 * alumno que la sucesora) — sólo puede haber ocurrido porque `impostor`
 * fue reasignado a otro alumno DESPUÉS de que su propio linaje naciera
 * (p. ej. "Modificar participantes" de una serie grupal), y el bug viejo
 * confundió esa identidad prestada con la de `victim`.
 *
 * Cuando esa evidencia se confirma, se deshace EXACTAMENTE lo que el
 * barrido viejo escribió (nunca más que eso): `endDate: null` si truncó
 * por fecha, `status: 'active'` si truncó por estado (`hasFuture` sólo
 * podía haber sido true si el estado previo NO era `'ended'`), y
 * `supersededByRecurrenceId: null` en ambos casos. Nunca se inventa una
 * fecha de fin distinta — el valor real previo al bug no quedó persistido
 * en ningún lado (el barrido lo sobrescribía sin conservarlo), así que
 * "sin fin conocido" es la única reconstrucción honesta.
 *
 * Sin esa evidencia (sin `supersededByRecurrenceId`, o con linaje real del
 * mismo alumno, o con un `impostor` que ya no existe) la regla NUNCA se
 * toca — puede ser un final genuino, una consolidación legítima de
 * duplicados reales del mismo alumno, o una regla finalizada a mano
 * (`setRuleStatus`/"Finalizar serie" nunca escribe
 * `supersededByRecurrenceId`, así que esas quedan afuera de este barrido
 * por construcción).
 *
 * Idempotente: una regla ya reparada queda sin `supersededByRecurrenceId`,
 * así que una segunda pasada la descarta en el primer chequeo, sin volver
 * a evaluarla.
 */
export function repairFalselyTruncatedRecurrences(
  rules: RecurrenceRule[]
): FalselyTruncatedRecurrenceRepair {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));

  function lineageRootStudentId(rule: RecurrenceRule, visited: Set<string>): string | null {
    if (visited.has(rule.recurrenceId)) return null; // ciclo defensivo — nunca debería ocurrir con datos sanos
    visited.add(rule.recurrenceId);
    if (!rule.supersedesRecurrenceId) return rule.studentId;
    const predecessor = byId.get(rule.supersedesRecurrenceId);
    if (!predecessor) return rule.studentId; // predecesor ya no existe: el propio rule es la raíz conocida
    return lineageRootStudentId(predecessor, visited);
  }

  const repairedRecurrenceIds: string[] = [];
  const nextRules = rules.map((rule) => {
    if (!rule.supersededByRecurrenceId) return rule;
    const impostor = byId.get(rule.supersededByRecurrenceId);
    if (!impostor) return rule;
    const realRootStudentId = lineageRootStudentId(impostor, new Set());
    if (realRootStudentId === null || realRootStudentId === rule.studentId) return rule;

    repairedRecurrenceIds.push(rule.recurrenceId);
    if (rule.status === 'ended') {
      return { ...rule, status: 'active' as const, supersededByRecurrenceId: null };
    }
    return { ...rule, endDate: null, supersededByRecurrenceId: null };
  });

  return { rules: nextRules, repairedRecurrenceIds };
}

export interface SuccessorSessionGapRepair {
  rules: RecurrenceRule[];
  repairedRecurrenceIds: string[];
}

/**
 * Corrección 2026-08-28, novena ronda (a pedido de Joaquín — SERIE SEMANAL
 * CON UN DÍA QUE DESAPARECE PARA SIEMPRE): reparación determinista para el
 * daño YA persistido por el bug de `consolidateStudentFutureRecurrences`
 * corregido arriba (`sessionsCoveredBySuccessor`) — antes de esa corrección,
 * una sucesora podía quedar activa cubriendo sólo PARTE de las sesiones
 * semanales reales del alumno (p. ej. sólo miércoles, habiendo perdido un
 * lunes que sí tenía la regla original), mientras cada regla `ended` que
 * quedó apuntándole (`supersededByRecurrenceId`) documenta EXACTAMENTE la
 * sesión perdida, repetida de forma idéntica en cada intento posterior de
 * recrearla.
 *
 * Nunca inventa un horario: sólo restaura una sesión cuando aparece,
 * palabra por palabra (weekday+hora+minuto), en una regla real que apunta a
 * esa sucesora exacta. Nunca toca las reglas `ended` en sí (no se
 * "resucitan" — quedan como quedaron, documentando el historial real);
 * sólo completa la sucesora activa con lo que ya le faltaba. Se abstiene
 * por completo (no repara nada de ese par) ante cualquier ambigüedad real:
 * ciclos de más de una semana (nunca se adivina en qué semana del ciclo
 * va la sesión perdida) o un `studentId` que no coincide exactamente entre
 * ambas reglas (nunca mezcla series de alumnos distintos). Idempotente: una
 * vez restaurada la sesión, `sessionsCoveredBySuccessor` ya la encuentra
 * cubierta y una segunda pasada no vuelve a tocarla.
 */
export function repairSuccessorMissingSessions(rules: RecurrenceRule[]): SuccessorSessionGapRepair {
  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  const missingSessionsBySuccessor = new Map<string, RecurrenceRule['weeks'][number]['sessions']>();

  rules.forEach((rule) => {
    if (!rule.supersededByRecurrenceId) return;
    const successor = byId.get(rule.supersededByRecurrenceId);
    if (!successor) return;
    // Sólo ciclos simples de una semana en ambos lados — nunca se adivina
    // en qué semana de un ciclo compuesto habría ido la sesión perdida.
    if (rule.cycleLengthWeeks !== 1 || successor.cycleLengthWeeks !== 1) return;
    // Nunca mezcla series de alumnos distintos (misma cautela que
    // repairFalselyTruncatedRecurrences con el linaje de studentId).
    if (rule.studentId !== successor.studentId) return;
    if (!rule.studentId) return;

    const successorKeys = new Set(
      successor.weeks.flatMap((week) =>
        week.sessions.map((session) => `${session.weekday}:${session.hour}:${session.minute}`)
      )
    );
    const alreadyQueued = missingSessionsBySuccessor.get(successor.recurrenceId) ?? [];
    const queuedKeys = new Set(alreadyQueued.map((session) => `${session.weekday}:${session.hour}:${session.minute}`));

    rule.weeks.forEach((week) => {
      week.sessions.forEach((session) => {
        const key = `${session.weekday}:${session.hour}:${session.minute}`;
        if (successorKeys.has(key) || queuedKeys.has(key)) return;
        queuedKeys.add(key);
        alreadyQueued.push(session);
      });
    });

    if (alreadyQueued.length > 0) {
      missingSessionsBySuccessor.set(successor.recurrenceId, alreadyQueued);
    }
  });

  if (missingSessionsBySuccessor.size === 0) {
    return { rules, repairedRecurrenceIds: [] };
  }

  const repairedRecurrenceIds: string[] = [];
  const nextRules = rules.map((rule) => {
    const missing = missingSessionsBySuccessor.get(rule.recurrenceId);
    if (!missing || missing.length === 0 || rule.weeks.length === 0) return rule;
    repairedRecurrenceIds.push(rule.recurrenceId);
    return {
      ...rule,
      weeks: rule.weeks.map((week, index) =>
        index === 0 ? { ...week, sessions: [...week.sessions, ...missing] } : week
      ),
    };
  });

  return { rules: nextRules, repairedRecurrenceIds };
}

/**
 * TeacherFlow modela todos los días habituales de un alumno dentro de una
 * misma regla. Al editar futuras, cualquier otra regla vigente del alumno
 * debe dejar de producir ocurrencias desde la misma fecha.
 *
 * Corrección 2026-08-27 (a pedido de Joaquín — SERIE QUE APARECE Y
 * DESAPARECE): el barrido de "otras reglas del mismo alumno" se compara
 * contra `originalRule.studentId`, NUNCA contra `successorRule.studentId`.
 * En una edición real de "editar futuras" ambos valores son siempre
 * iguales (la sucesora nace del mismo `rule.studentId`, sin tocarlo) — pero
 * `repairExplicitSuccessorDuplicates` reutiliza esta misma función en CADA
 * hidratación, y para entonces la "sucesora" persistida pudo haber sido
 * REASIGNADA a otro alumno (p. ej. "Modificar participantes" de una serie
 * grupal cambia `studentId` in place, sin crear un `recurrenceId` nuevo,
 * conservando su viejo `supersedesRecurrenceId`/`effectiveFromDate`). Usar
 * `successorRule.studentId` ahí confundía la identidad histórica de la
 * cadena con el principal ACTUAL de la serie grupal, y terminaba truncando
 * — como si fuera un duplicado — la serie individual real, no relacionada,
 * de ese mismo alumno (reproducido en
 * calendarOccurrencePersistenceAudit.test.ts, "PROBE 2"). `originalRule`
 * conserva siempre la identidad bajo la que esta cadena nació, así que es
 * la referencia correcta en los dos casos.
 */
export function consolidateStudentFutureRecurrences(input: {
  rules: RecurrenceRule[];
  originalRule: RecurrenceRule;
  successorRule: RecurrenceRule;
  effectiveDate: string;
}): ConsolidatedStudentRecurrences {
  const cutoff = addDaysToDateKey(input.effectiveDate, -1);
  const superseded = new Set<string>([input.originalRule.recurrenceId]);
  const nextRules = input.rules.map((rule) => {
    if (rule.recurrenceId === input.originalRule.recurrenceId) {
      return input.originalRule;
    }
    if (rule.recurrenceId === input.successorRule.recurrenceId) {
      return input.successorRule;
    }
    const hasFuture =
      rule.studentId === input.originalRule.studentId &&
      rule.status !== 'ended' &&
      (!rule.endDate || rule.endDate >= input.effectiveDate);
    if (!hasFuture) return rule;

    superseded.add(rule.recurrenceId);
    if (rule.startDate < input.effectiveDate) {
      return {
        ...rule,
        endDate: cutoff,
        supersededByRecurrenceId: input.successorRule.recurrenceId,
      };
    }
    // No se fabrica un endDate anterior a startDate. Una duplicada que aÃºn
    // no empezÃ³ se cierra por estado y conserva fechas vÃ¡lidas.
    return {
      ...rule,
      status: 'ended' as const,
      supersededByRecurrenceId: input.successorRule.recurrenceId,
    };
  });

  if (!nextRules.some((rule) => rule.recurrenceId === input.successorRule.recurrenceId)) {
    nextRules.push(input.successorRule);
  }
  return { rules: nextRules, supersededRecurrenceIds: [...superseded] };
}

/**
 * Corrección 2026-08-13 (a pedido de Joaquín — ERROR CRÍTICO: OCURRENCIAS
 * QUE DESAPARECEN DEL CALENDARIO): causa raíz real, confirmada con el motor
 * real (ver `calendarOccurrencePersistenceAudit.test.ts`) — esta función se
 * llama al consolidar reglas concurrentes del mismo alumno ("Editar
 * futuras") y, sin excepción alguna, en CADA hidratación/refetch de la app
 * vía `repairExplicitSuccessorDuplicates` para cualquier serie con linaje
 * de sucesora. A diferencia de su hermana `removeFutureUncompletedMaterializations`
 * (usada sólo al eliminar una serie completa), ésta nunca eximía a una
 * clase ya `completed` — una clase efectivamente dictada y registrada
 * pedagógicamente podía borrarse del calendario sólo porque su fecha caía
 * en/después de la fecha efectiva de una consolidación, sin relación alguna
 * con si esa clase específica ya había ocurrido de verdad. Un registro
 * pedagógico ya completado es un HECHO histórico — nunca se purga por esta
 * vía, sin importar su fecha (mismo criterio que ya usa
 * `sanitizeMaterializationsByRuleBounds` y `removeFutureUncompletedMaterializations`).
 */
export function removeFutureMaterializationsForRecurrences(
  lessons: CalendarLesson[],
  recurrenceIds: string[],
  effectiveDate: string,
  timezone: string
): CalendarLesson[] {
  const ids = new Set(recurrenceIds);
  return lessons.filter((lesson) => {
    if (!lesson.recurrenceId || !ids.has(lesson.recurrenceId)) return true;
    if (lesson.status === 'completed') return true;
    const logicalStart = lesson.recurrenceOriginalStart ?? lesson.start;
    return getLocalDateKey(logicalStart, timezone) < effectiveDate;
  });
}

/** DiagnÃ³stico: no se eliminan automÃ¡ticamente porque pueden ser clases sueltas reales. */
export function findDetachedFutureLessonsForStudent(
  lessons: CalendarLesson[],
  studentId: string,
  effectiveDate: string,
  timezone: string
): CalendarLesson[] {
  return lessons.filter(
    (lesson) =>
      lesson.recurrenceId === null &&
      lesson.status !== 'cancelled' &&
      (lesson.studentId === studentId ||
        lesson.participants.some((participant) => participant.studentId === studentId)) &&
      getLocalDateKey(lesson.start, timezone) >= effectiveDate
  );
}

/** Quita sólo las materializaciones del tramo reemplazado de la regla vieja. */
export function removeSupersededFutureMaterializations(
  lessons: CalendarLesson[],
  originalRule: RecurrenceRule,
  effectiveDate: string
): CalendarLesson[] {
  return lessons.filter((lesson) => {
    if (lesson.recurrenceId !== originalRule.recurrenceId) return true;
    // Una reprogramación conserva la identidad temporal de su ocurrencia en
    // recurrenceOriginalStart. Así no borramos una clase nacida antes del
    // corte sólo porque fue movida a una fecha posterior.
    const logicalStart = lesson.recurrenceOriginalStart ?? lesson.start;
    return getLocalDateKey(logicalStart, originalRule.timezone) < effectiveDate;
  });
}

/** Repara datos viejos: una materializaciÃ³n no puede quedar despuÃ©s del
 * endDate de la regla a la que pertenece. Las reprogramadas se evalÃºan por
 * su fecha original para conservar historia legÃ­tima. Un registro pedagÃ³gico
 * ya completado nunca se purga por esta vÃ­a, sin importar su fecha. */
export function sanitizeMaterializationsByRuleBounds(
  lessons: CalendarLesson[],
  rules: RecurrenceRule[]
): CalendarLesson[] {
  const ruleById = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  return lessons.filter((lesson) => {
    if (!lesson.recurrenceId) return true;
    if (lesson.status === 'completed') return true;
    const rule = ruleById.get(lesson.recurrenceId);
    if (!rule?.endDate) return true;
    const logicalStart = lesson.recurrenceOriginalStart ?? lesson.start;
    return getLocalDateKey(logicalStart, rule.timezone) <= rule.endDate;
  });
}

export interface StudentRecurrenceTruncation {
  rules: RecurrenceRule[];
  truncatedRecurrenceIds: string[];
}

/**
 * "Eliminar esta y todas las siguientes": termina, desde effectiveDate
 * inclusive, todas las reglas futuras o en curso del alumno (no sÃ³lo la que
 * originÃ³ el pedido) â€” TeacherFlow modela una sola serie futura por
 * alumno, igual que consolidateStudentFutureRecurrences. Reglas ya
 * finalizadas o vencidas antes de esa fecha, y reglas de otros alumnos, no
 * se tocan.
 */
export function truncateStudentRecurrencesFromDate(input: {
  rules: RecurrenceRule[];
  studentId: string;
  effectiveDate: string;
}): StudentRecurrenceTruncation {
  const cutoff = addDaysToDateKey(input.effectiveDate, -1);
  const truncatedRecurrenceIds: string[] = [];
  const rules = input.rules.map((rule) => {
    if (rule.studentId !== input.studentId || rule.status === 'ended') return rule;
    const hasFuture = !rule.endDate || rule.endDate >= input.effectiveDate;
    if (!hasFuture) return rule;

    truncatedRecurrenceIds.push(rule.recurrenceId);
    if (rule.startDate < input.effectiveDate) {
      return { ...rule, endDate: cutoff };
    }
    // No se fabrica un endDate anterior a startDate: una regla que todavÃ­a
    // no empezÃ³ se cierra por estado, no por fecha.
    return { ...rule, status: 'ended' as const };
  });
  return { rules, truncatedRecurrenceIds };
}

/**
 * Igual que removeFutureMaterializationsForRecurrences, pero nunca borra un
 * registro pedagÃ³gico ya completado, sin importar su fecha lÃ³gica.
 */
export function removeFutureUncompletedMaterializations(
  lessons: CalendarLesson[],
  recurrenceIds: string[],
  effectiveDate: string,
  timezone: string
): CalendarLesson[] {
  const ids = new Set(recurrenceIds);
  return lessons.filter((lesson) => {
    if (!lesson.recurrenceId || !ids.has(lesson.recurrenceId)) return true;
    if (lesson.status === 'completed') return true;
    const logicalStart = lesson.recurrenceOriginalStart ?? lesson.start;
    return getLocalDateKey(logicalStart, timezone) < effectiveDate;
  });
}

export interface DeleteRecurrenceSeriesResult {
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
  effectiveDate: string;
  truncatedRecurrenceIds: string[];
}

/**
 * "Eliminar esta y todas las siguientes" a partir de una tarjeta cancelada:
 * corta la serie del alumno desde la fecha lÃ³gica de esa ocurrencia
 * (recurrenceOriginalStart ?? start) y quita las materializaciones futuras
 * (incluidas canceladas/reprogramadas) de todas las reglas afectadas.
 */
export function buildDeleteRecurrenceSeriesFromLesson(input: {
  lesson: CalendarLesson;
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
}): DeleteRecurrenceSeriesResult {
  const { lesson, rules, lessons } = input;
  if (!lesson.recurrenceId || !lesson.recurrenceOccurrenceKey) {
    throw new Error('La clase no pertenece a una repeticiÃ³n identificable.');
  }
  if (lesson.status !== 'cancelled') {
    throw new Error('Primero cancelÃ¡ la clase antes de eliminar la serie.');
  }
  const anchorRule = rules.find((rule) => rule.recurrenceId === lesson.recurrenceId);
  if (!anchorRule) {
    throw new Error('No se encontrÃ³ la serie de esta clase.');
  }

  const logicalStart = lesson.recurrenceOriginalStart ?? lesson.start;
  const effectiveDate = getLocalDateKey(logicalStart, anchorRule.timezone);

  const { rules: nextRules, truncatedRecurrenceIds } = truncateStudentRecurrencesFromDate({
    rules,
    studentId: anchorRule.studentId,
    effectiveDate,
  });

  const nextLessons = removeFutureUncompletedMaterializations(
    lessons,
    truncatedRecurrenceIds,
    effectiveDate,
    anchorRule.timezone
  );

  return { rules: nextRules, lessons: nextLessons, effectiveDate, truncatedRecurrenceIds };
}

function mondayFor(date: string): string {
  return addDaysToDateKey(date, -jsDayToAppWeekday(getDateKeyJsDay(date)));
}

function cloneWeeks(draft: PendingRecurrenceDraft): RecurrenceRule['weeks'] {
  return draft.weeks.map((week) => ({
    ...week,
    sessions: week.sessions.map((session) => ({ ...session })),
  }));
}

/**
 * Corrección 2026-08-18 (a pedido de Joaquín — EDICIÓN DE DURACIÓN):
 * inversa de `cloneWeeks` — convierte una `RecurrenceRule` ya persistida en
 * el `PendingRecurrenceDraft` que espera `splitRecurrenceFromDate`
 * (mismos días/horarios/duraciones, clonados sin compartir referencia).
 * Extraído de `EditFutureRecurrenceSheet.tsx` (donde vivía como función
 * local `draftFromRule`, ahora la importa de acá) para que
 * `calendarDurationEdit.ts` lo reutilice sin duplicar la conversión —
 * nunca una segunda implementación del mismo mapeo.
 */
export function draftFromRule(rule: RecurrenceRule): PendingRecurrenceDraft {
  return {
    mode: rule.type === 'weekly' ? 'weekly' : 'custom',
    cycleLengthWeeks: rule.cycleLengthWeeks,
    weeks: rule.weeks.map((week) => ({
      ...week,
      sessions: week.sessions.map((session) => ({ ...session })),
    })),
  };
}

function coversEffectiveDate(rule: RecurrenceRule, effectiveDate: string): boolean {
  return (
    rule.status !== 'ended' &&
    rule.startDate <= effectiveDate &&
    (!rule.effectiveFromDate || rule.effectiveFromDate <= effectiveDate) &&
    (!rule.endDate || rule.endDate >= effectiveDate)
  );
}

/**
 * Resuelve una tarjeta/regla vieja hacia la sucesora vigente. Los campos de
 * linaje cubren splits nuevos; la inferencia por semana inicial sanea datos
 * creados antes de que existiera ese linaje.
 */
export function resolveEditableRecurrenceRule(
  requestedRule: RecurrenceRule,
  rules: RecurrenceRule[],
  effectiveDate: string
): RecurrenceRule {
  if (coversEffectiveDate(requestedRule, effectiveDate)) return requestedRule;

  const byId = new Map(rules.map((rule) => [rule.recurrenceId, rule]));
  const visited = new Set<string>([requestedRule.recurrenceId]);
  let current = requestedRule;
  while (current.supersededByRecurrenceId) {
    const next = byId.get(current.supersededByRecurrenceId);
    if (!next || visited.has(next.recurrenceId)) break;
    visited.add(next.recurrenceId);
    if (coversEffectiveDate(next, effectiveDate)) return next;
    current = next;
  }

  const explicit = rules.filter(
    (rule) =>
      rule.supersedesRecurrenceId === requestedRule.recurrenceId &&
      coversEffectiveDate(rule, effectiveDate)
  );
  if (explicit.length === 1) return explicit[0];

  if (requestedRule.endDate) {
    const expectedStart = mondayFor(addDaysToDateKey(requestedRule.endDate, 1));
    const legacy = rules.filter(
      (rule) =>
        rule.recurrenceId !== requestedRule.recurrenceId &&
        rule.studentId === requestedRule.studentId &&
        rule.startDate === expectedStart &&
        coversEffectiveDate(rule, effectiveDate)
    );
    if (legacy.length === 1) return legacy[0];
  }

  throw new Error(
    'Esta tarjeta pertenece a un tramo anterior. Abrí la serie vigente para editar las próximas clases.'
  );
}

export function splitRecurrenceFromDate(input: {
  rule: RecurrenceRule;
  effectiveDate: string;
  todayDate: string;
  draft: PendingRecurrenceDraft;
  newRecurrenceId: string;
  exceptions: RecurrenceException[];
  createdAt?: string;
}): RecurrenceSplitResult {
  const { rule, effectiveDate, todayDate, draft, newRecurrenceId } = input;
  if (effectiveDate < todayDate) throw new Error('No se puede cambiar una serie desde una fecha pasada.');
  // Corrección 2026-07-26 (a pedido de Joaquín — error "La fecha efectiva
  // debe ser posterior al inicio de la serie original"): una fecha
  // efectiva IGUAL al inicio de la serie es válida — significa "cambiar el
  // patrón desde el principio", no un no-op. Antes esto se rechazaba con
  // una comparación estricta `<=` que no admitía esa igualdad.
  if (effectiveDate < rule.startDate) {
    throw new Error('La fecha efectiva debe ser igual o posterior al inicio de la serie original.');
  }
  if (rule.endDate && effectiveDate > rule.endDate) {
    throw new Error('La fecha efectiva está fuera de la serie original.');
  }
  if (!newRecurrenceId.trim() || newRecurrenceId === rule.recurrenceId) {
    throw new Error('La serie sucesora necesita una identidad nueva.');
  }
  if (draft.mode === 'single') throw new Error('La sucesora debe ser semanal o personalizada.');

  const successorStartDate = mondayFor(effectiveDate);
  // Cuando effectiveDate === rule.startDate no hay ningún tramo previo que
  // conservar: la regla original nunca llegó a producir una sola
  // ocurrencia antes del cambio, así que se cierra por estado en vez de
  // fabricar un endDate anterior a su propio startDate (mismo patrón que
  // ya usan consolidateStudentFutureRecurrences/truncateStudentRecurrencesFromDate
  // para el mismo caso límite).
  const originalRule: RecurrenceRule =
    rule.startDate < effectiveDate
      ? {
          ...rule,
          endDate: addDaysToDateKey(effectiveDate, -1),
          supersededByRecurrenceId: newRecurrenceId,
        }
      : {
          ...rule,
          status: 'ended',
          supersededByRecurrenceId: newRecurrenceId,
        };
  const successorRule: RecurrenceRule = {
    ...rule,
    recurrenceId: newRecurrenceId,
    type: draft.mode === 'weekly' ? 'weekly' : 'custom',
    cycleLengthWeeks: draft.cycleLengthWeeks,
    weeks: cloneWeeks(draft),
    startDate: successorStartDate,
    endDate: rule.endDate,
    supersedesRecurrenceId: rule.recurrenceId,
    supersededByRecurrenceId: null,
    effectiveFromDate: effectiveDate,
  };

  // Como startDate debe ser lunes, se excluyen explícitamente las sesiones
  // del patrón sucesor que caerían antes de la fecha efectiva en esa semana.
  const rangeStart = new Date(localDateTimeToInstantIso({
    date: successorStartDate, hour: 0, minute: 0, timeZone: rule.timezone,
  }));
  const effectiveStart = new Date(localDateTimeToInstantIso({
    date: effectiveDate, hour: 0, minute: 0, timeZone: rule.timezone,
  }));
  const preEffective = effectiveDate === successorStartDate
    ? []
    : generateOccurrences(
        { ...successorRule, status: 'active' },
        rangeStart,
        new Date(effectiveStart.getTime() - 1)
      );
  const createdAt = input.createdAt ?? new Date().toISOString();
  const addedExceptions: RecurrenceException[] = preEffective.map((occurrence) => ({
    recurrenceId: successorRule.recurrenceId,
    occurrenceKey: occurrence.occurrenceKey,
    type: 'excluded',
    createdAt,
  }));

  return {
    originalRule,
    successorRule,
    exceptions: [...input.exceptions, ...addedExceptions],
    addedExceptions,
  };
}

export function validateFutureRecurrence(input: {
  successorRule: RecurrenceRule;
  effectiveDate: string;
  horizonEnd: Date;
  lessons: CalendarLesson[];
  availability: TeacherAvailability;
  originalRecurrenceId: string;
  supersededRecurrenceIds?: string[];
}): FutureRecurrenceConflict[] {
  const start = new Date(localDateTimeToInstantIso({
    date: input.effectiveDate, hour: 0, minute: 0, timeZone: input.successorRule.timezone,
  }));
  const occurrences = generateOccurrences(
    { ...input.successorRule, status: 'active' },
    start,
    input.horizonEnd
  );
  const ignoredRecurrenceIds = new Set([
    input.originalRecurrenceId,
    ...(input.supersededRecurrenceIds ?? []),
  ]);
  const relevantLessons = input.lessons.filter((lesson) => {
    if (!lesson.recurrenceId || !ignoredRecurrenceIds.has(lesson.recurrenceId)) return true;
    return getLocalDateKey(lesson.start, input.successorRule.timezone) < input.effectiveDate;
  });

  return occurrences.flatMap((occurrence) => {
    const calendarConflicts = findCalendarConflicts(
      occurrence.start,
      occurrence.end,
      relevantLessons
    );
    const availability = evaluateAvailability(
      occurrence.start,
      occurrence.end,
      input.availability
    );
    return hasBlockingConflict(calendarConflicts) || !availability.isAvailable
      ? [{ occurrence, calendarConflicts, availability }]
      : [];
  });
}

export interface ThisAndFutureActivityKindSplitInput {
  /** `recurrenceId` de la serie ORIGINAL tal como la eligió la profesora — se resuelve de nuevo contra `current.rules`, nunca contra una fotografía capturada de antemano. */
  originalRecurrenceId: string;
  studentId: string;
  effectiveDate: string;
  /** Id determinístico de la sucesora (`recurrence_successor_<originalId>_<effectiveDate>`). */
  successorId: string;
  draft: PendingRecurrenceDraft;
  /** Campos que la sucesora debe llevar además del patrón — `activityKind`, y `trainingBillingAgreementId` cuando ya está confirmado. */
  successorOverrides: Partial<RecurrenceRule>;
  /**
   * Corrección 2026-09-14, SEXTA ronda (a pedido de Joaquín — revisión
   * independiente: "el split durable deja de poder recuperarse al cambiar
   * el día" — esta función leía `new Date()` internamente, así que una
   * operación válida el 14/09 (fecha efectiva 14/09, hoy 14/09) se
   * rechazaba al reconciliarse el 15/09, porque `todayDate` se recalculaba
   * con el reloj del momento de la RECUPERACIÓN, no con el de la
   * VALIDACIÓN original): instante ISO congelado en el momento en que la
   * profesora confirmó y la operación todavía era válida — nunca se
   * recalcula. El flujo interactivo lo captura una única vez y lo persiste
   * en `splitPlan`; la reconciliación global reproduce EXACTAMENTE esa
   * misma decisión, sin importar cuándo ni en qué dispositivo se ejecute.
   * Dos corridas de esta función con el mismo `current` y el mismo
   * `asOfIso` producen SIEMPRE el mismo resultado — nunca depende del
   * reloj real del dispositivo que la ejecuta.
   */
  asOfIso: string;
}

export interface ThisAndFutureActivityKindSplitSnapshot {
  lessons: CalendarLesson[];
  rules: RecurrenceRule[];
  exceptions: RecurrenceException[];
}

/**
 * Corrección 2026-09-14, QUINTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 2: "'Esta y las siguientes' persiste el acuerdo
 * antes del diario durable" — la reconciliación global necesita poder
 * REHACER el split en sí, no sólo reconciliar el cargo asumiendo que la
 * sucesora ya existe; "no alcanza con guardar sólo el ID de una sucesora
 * que todavía podría no existir"): extrae el commit real de "Esta clase y
 * las siguientes" (antes sólo vivía inline dentro del `applyRecurrenceMutation`
 * de `CalendarTabScreen.tsx`) a una función PURA reutilizable — recalcula
 * TODO (regla editable, idempotencia, split, consolidación, lecciones
 * futuras) contra `current`, el snapshot que le pase el llamador (el
 * REALMENTE persistido, tanto en el flujo interactivo como en la
 * reconciliación tras reiniciar la app). `originalRecurrenceId`/`studentId`
 * son strings — nunca un objeto `RecurrenceRule` capturado de antemano —
 * así que la regla original se busca fresca en `current.rules` cada vez.
 * Idempotente: si la sucesora YA existe con exactamente estos overrides
 * (reintento/doble toque/reconciliación repetida), es un no-op.
 */
export function planActivityKindThisAndFutureSplit(
  current: ThisAndFutureActivityKindSplitSnapshot,
  input: ThisAndFutureActivityKindSplitInput
): ThisAndFutureActivityKindSplitSnapshot {
  const { originalRecurrenceId, studentId, effectiveDate, successorId, draft, successorOverrides, asOfIso } = input;

  const alreadyApplied = current.rules.find((candidate) => candidate.recurrenceId === successorId);
  if (
    alreadyApplied &&
    alreadyApplied.activityKind === successorOverrides.activityKind &&
    alreadyApplied.trainingBillingAgreementId === successorOverrides.trainingBillingAgreementId
  ) {
    return current;
  }

  const requestedRule = current.rules.find((candidate) => candidate.recurrenceId === originalRecurrenceId);
  if (!requestedRule) {
    throw new Error('No se encontró la serie original.');
  }

  let editableRule: RecurrenceRule;
  try {
    editableRule = resolveEditableRecurrenceRule(requestedRule, current.rules, effectiveDate);
  } catch {
    // `asOfIso` — nunca `new Date()` — para que una reconciliación
    // ejecutada un día (o un mes) después de la validación original
    // resuelva exactamente la misma serie canónica que resolvió la
    // profesora al confirmar.
    const canonicalFresh = selectCanonicalRecurrenceRules(current.rules, asOfIso).find(
      (candidate) => candidate.studentId === studentId
    );
    if (!canonicalFresh) throw new Error('No hay una serie vigente para editar.');
    editableRule = canonicalFresh;
  }

  const todayDate = getLocalDateKey(asOfIso, editableRule.timezone);
  const split = splitRecurrenceFromDate({
    rule: editableRule,
    effectiveDate,
    todayDate,
    draft,
    newRecurrenceId: successorId,
    exceptions: current.exceptions,
  });
  const successorRule: RecurrenceRule = { ...split.successorRule, ...successorOverrides };
  const consolidation = consolidateStudentFutureRecurrences({
    rules: current.rules,
    originalRule: split.originalRule,
    successorRule,
    effectiveDate,
  });
  const boundedLessons = sanitizeMaterializationsByRuleBounds(current.lessons, consolidation.rules);
  const nextLessons = removeFutureMaterializationsForRecurrences(
    boundedLessons,
    consolidation.supersededRecurrenceIds,
    effectiveDate,
    successorRule.timezone
  );
  return { lessons: nextLessons, rules: consolidation.rules, exceptions: split.exceptions };
}
