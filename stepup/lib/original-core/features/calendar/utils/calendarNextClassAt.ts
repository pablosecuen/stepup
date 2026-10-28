// Puerto VERBATIM del original (`src/features/calendar/utils/calendarNextClassAt.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../../students/types/index.ts';
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';
import { applyExceptionsToOccurrences, DEFAULT_RECURRENCE_HORIZON_DAYS, generateOccurrences } from './calendarRecurrenceEngine.ts';

type StudentForNextClass = Pick<StudentListItem, 'id' | 'status'>;

/**
 * Corrección P0 (a pedido de Joaquín — CORRECCIÓN GENERAL: "PRÓXIMA CLASE"
 * CAMBIA ANTES DE QUE TERMINE LA CLASE EN CURSO): ÚNICA función pura de
 * clasificación temporal de una ocurrencia — reemplaza los cálculos
 * separados e inconsistentes que existían en `buildDashboardData.ts` (Home,
 * `start >= now`, sólo hoy) y en `calculateNextClassAt` de acá abajo
 * (`start > now`, todo el horizonte) — ambos EXCLUÍAN la clase apenas
 * empezaba (su `start` ya quedaba en el pasado), así que el siguiente
 * cálculo saltaba de inmediato a la clase siguiente en vez de seguir
 * mostrando la que está en curso hasta que termine de verdad. Cualquier
 * pantalla/selector nuevo que necesite "próxima clase"/"clase en curso"
 * debe reutilizar ÉSTA — nunca reimplementar la comparación de horarios por
 * su cuenta.
 *
 * Regla exacta de límites (mitad abierta, sin ambigüedad en los bordes):
 * - `ahora < start`             -> 'upcoming'
 * - `start <= ahora < end`      -> 'in_progress' (incluye el instante EXACTO del inicio)
 * - `ahora >= end`              -> 'finished' (incluye el instante EXACTO del final — ya puede mostrarse la siguiente)
 * - estado inválido (cancelada, completada, o cualquier otro distinto de
 *   `scheduled`/`rescheduled`) -> 'excluded', sin importar el horario.
 *
 * `status` es opcional a propósito: las ocurrencias VIRTUALES generadas por
 * una serie recurrente (`generateOccurrences`/`applyExceptionsToOccurrences`)
 * no tienen un `CalendarLessonStatus` propio — para cuando llegan hasta acá
 * ya pasaron por el motor de excepciones real (cancelación/reprogramación de
 * la serie ya aplicada), así que se tratan como válidas por construcción.
 */
export type LessonTimingStatus = 'upcoming' | 'in_progress' | 'finished' | 'excluded';

export interface LessonTimingCandidate {
  start: string;
  end: string;
  status?: CalendarLesson['status'];
}

const ACTIVE_LESSON_STATUSES: ReadonlyArray<CalendarLesson['status']> = ['scheduled', 'rescheduled'];

export function classifyLessonTiming(
  candidate: LessonTimingCandidate,
  now: Date
): LessonTimingStatus {
  if (candidate.status !== undefined && !ACTIVE_LESSON_STATUSES.includes(candidate.status)) {
    return 'excluded';
  }
  const nowTime = now.getTime();
  const startTime = new Date(candidate.start).getTime();
  const endTime = new Date(candidate.end).getTime();
  if (nowTime < startTime) return 'upcoming';
  if (nowTime < endTime) return 'in_progress';
  return 'finished';
}

export interface CurrentOrNextSelection<T> {
  occurrence: T;
  timing: 'in_progress' | 'upcoming';
}

/**
 * Prioridad de selección (requisito explícito): 1) una clase válida
 * actualmente EN CURSO; 2) si no hay ninguna, la próxima futura válida más
 * cercana; 3) si no hay ninguna, `null`. Nunca depende del ORDEN de entrada
 * de `candidates` — siempre compara horarios reales.
 */
export function selectCurrentOrNextOccurrence<T extends LessonTimingCandidate>(
  candidates: T[],
  now: Date
): CurrentOrNextSelection<T> | null {
  let best: CurrentOrNextSelection<T> | null = null;
  for (const candidate of candidates) {
    const timing = classifyLessonTiming(candidate, now);
    if (timing !== 'in_progress' && timing !== 'upcoming') continue;
    if (!best) {
      best = { occurrence: candidate, timing };
      continue;
    }
    if (timing === 'in_progress' && best.timing === 'upcoming') {
      best = { occurrence: candidate, timing };
      continue;
    }
    if (timing === 'upcoming' && best.timing === 'in_progress') continue;
    if (new Date(candidate.start).getTime() < new Date(best.occurrence.start).getTime()) {
      best = { occurrence: candidate, timing };
    }
  }
  return best;
}

function lessonBelongsToStudent(
  lesson: CalendarLesson,
  studentId: string
): boolean {
  return (
    lesson.studentId === studentId ||
    lesson.participants.some((participant) => participant.studentId === studentId)
  );
}

/**
 * Corrección P0 (a pedido de Joaquín — "próxima clase" pasada y
 * recurrencias futuras ausentes): antes esto filtraba las reglas SÓLO por
 * `rule.studentId === student.id` — para una serie grupal, sólo el
 * participante PRINCIPAL (el primero) tenía `rule.studentId` igual al
 * suyo; el resto de los participantes reales (en `rule.participantIds`)
 * nunca coincidía, así que nunca recibían ninguna ocurrencia virtual
 * futura de esa serie como candidata — sólo veían las que ya estuvieran
 * materializadas. Mismo criterio de resolución de participantes que ya usa
 * `generateOccurrences` (`calendarRecurrenceEngine.ts`): `participantIds`
 * si existe y no está vacío, si no `[studentId]`.
 */
function ruleIncludesStudent(rule: RecurrenceRule, studentId: string): boolean {
  const participantIds = rule.participantIds && rule.participantIds.length > 0 ? rule.participantIds : rule.studentId ? [rule.studentId] : [];
  return participantIds.includes(studentId);
}

function startOfLocalDay(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  return start;
}

export interface CurrentOrNextClass {
  start: string;
  end: string;
  timing: 'in_progress' | 'upcoming';
}

/**
 * Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
 * TERMINE LA CLASE EN CURSO): cálculo canónico real — antes exigía
 * `start > now` para CUALQUIER candidata (materializada o virtual), así que
 * en el instante exacto en que una clase empezaba, su propio `start` ya
 * quedaba en el pasado y dejaba de ser candidata: el resultado saltaba de
 * inmediato a la clase siguiente, aunque la actual siguiera en curso.
 * Ahora reúne candidatas por "todavía no terminó" (`end > now`, incluye
 * tanto la que está en curso como las futuras) y usa
 * `selectCurrentOrNextOccurrence` (la única función real de prioridad) para
 * elegir. Para ocurrencias virtuales de una serie, `generateOccurrences` se
 * pide desde el INICIO DEL DÍA (no desde `now`) — si se pidiera desde `now`,
 * la ocurrencia de HOY que ya empezó (su `start` real es anterior a `now`)
 * ni siquiera se generaría, sin importar el filtro de acá.
 */
export function calculateCurrentOrNextClass(
  student: StudentForNextClass,
  lessons: CalendarLesson[],
  recurrenceRules: RecurrenceRule[],
  exceptions: RecurrenceException[],
  now: Date
): CurrentOrNextClass | null {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) throw new RangeError('now es inválido.');
  if (student.status !== 'activo') return null;

  const candidates: LessonTimingCandidate[] = lessons
    .filter(
      (lesson) =>
        lessonBelongsToStudent(lesson, student.id) &&
        (lesson.status === 'scheduled' || lesson.status === 'rescheduled') &&
        new Date(lesson.end).getTime() > nowTime
    )
    .map((lesson) => ({ start: lesson.start, end: lesson.end, status: lesson.status }));

  const horizonEnd = new Date(
    nowTime + DEFAULT_RECURRENCE_HORIZON_DAYS * 86_400_000
  );
  recurrenceRules
    .filter(
      (rule) => rule.status === 'active' && ruleIncludesStudent(rule, student.id)
    )
    .forEach((rule) => {
      const generated = applyExceptionsToOccurrences(
        generateOccurrences(rule, startOfLocalDay(now), horizonEnd),
        exceptions,
        lessons
      );

      generated.forEach((occurrence) => {
        // Cinturón de seguridad de siempre: sólo ocurrencias todavía sin
        // materializar (evita duplicar una candidata que ya está en
        // `lessons`), y que todavía no terminaron (`end > now`) — incluye
        // la que está en curso, ya no exige que el INICIO sea futuro.
        if (
          occurrence.materializationStatus === 'virtual' &&
          new Date(occurrence.end).getTime() > nowTime
        ) {
          candidates.push({ start: occurrence.start, end: occurrence.end });
        }
      });
    });

  const selection = selectCurrentOrNextOccurrence(candidates, now);
  if (!selection) return null;
  return { start: selection.occurrence.start, end: selection.occurrence.end, timing: selection.timing };
}

/** Proyección liviana de `calculateCurrentOrNextClass` para quien sólo necesita el inicio (ej. comparar/reparar el valor persistido). */
export function calculateNextClassAt(
  student: StudentForNextClass,
  lessons: CalendarLesson[],
  recurrenceRules: RecurrenceRule[],
  exceptions: RecurrenceException[],
  now: Date
): string | null {
  return (
    calculateCurrentOrNextClass(student, lessons, recurrenceRules, exceptions, now)?.start ?? null
  );
}

/**
 * Corrección P0 (a pedido de Joaquín — "próxima clase" pasada y
 * recurrencias futuras ausentes): último cinturón de seguridad en la capa
 * de LECTURA/presentación. `calculateNextClassAt` ya nunca devuelve una
 * fecha pasada, y la reparación automática (`repairStaleNextClassAtForAllStudents`)
 * ya corrige el valor persistido en cada hidratación/restauración — pero
 * ningún lugar que sólo LEE el campo ya persistido (tarjeta de alumno,
 * orden de la lista, resumen del perfil) debe confiar ciegamente en que
 * ese valor siga siendo válido en el instante exacto en que se dibuja la
 * pantalla, sobre todo si la app quedó abierta un buen rato sin ninguna
 * mutación de calendario. Nunca devuelve otra fecha como reemplazo: si el
 * valor no es estrictamente futuro (o es inválido), se trata como si no
 * hubiera ninguna próxima clase.
 *
 * Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" CAMBIA ANTES DE QUE
 * TERMINE LA CLASE EN CURSO): `nextClassEndAt` es OPCIONAL y va al final
 * (nunca se reordenan los parámetros existentes — todo llamador viejo que
 * pasaba `now` como segundo argumento sigue funcionando idéntico). Cuando se
 * conoce el final real de la misma ocurrencia, una fecha ya pasada YA NO se
 * descarta automáticamente: sigue siendo válida mientras la clase continúe
 * en curso (`now < nextClassEndAt`) — recién se descarta cuando también
 * terminó. Sin `nextClassEndAt` (dato viejo, de antes de esta corrección, o
 * un llamador que todavía no lo tiene a mano), se conserva el comportamiento
 * anterior tal cual (estrictamente futuro), nunca se rompe.
 */
export function resolveDisplayableNextClassAt(
  nextClassAt: string | null,
  now: Date = new Date(),
  nextClassEndAt: string | null = null
): string | null {
  if (!nextClassAt) return null;
  const time = new Date(nextClassAt).getTime();
  if (!Number.isFinite(time)) return null;
  const nowTime = now.getTime();
  if (time > nowTime) return nextClassAt;
  if (nextClassEndAt) {
    const endTime = new Date(nextClassEndAt).getTime();
    if (Number.isFinite(endTime) && endTime > nowTime) return nextClassAt;
  }
  return null;
}

export interface NextClassAtRepairCandidate {
  id: string;
  currentNextClassAt: string | null;
  canonicalNextClassAt: string | null;
  /** Corrección P0 (ver `calculateCurrentOrNextClass`) — final efectivo de la misma ocurrencia que `canonicalNextClassAt`. */
  canonicalNextClassEndAt: string | null;
}

type StudentForRepair = StudentForNextClass & { nextClassAt: string | null; nextClassEndAt?: string | null };

/**
 * Corrección P0 (a pedido de Joaquín — requisito 8, "hidratar la
 * aplicación"/"restaurar un respaldo"): núcleo PURO de la reparación — dado
 * un snapshot de alumnos y calendario, decide para cuáles alumnos el
 * `nextClassAt`/`nextClassEndAt` persistidos quedaron vencidos/inconsistentes
 * respecto del cálculo canónico, sin escribir nada ni depender de ningún
 * store en memoria (por eso es testeable sin AsyncStorage).
 * `repairStaleNextClassAtForAllStudents` (`calendarNextClassAtSync.ts`) es
 * la capa de escritura fina que aplica exactamente estos resultados contra
 * los stores reales.
 */
export function planNextClassAtRepairs(
  students: StudentForRepair[],
  lessons: CalendarLesson[],
  recurrenceRules: RecurrenceRule[],
  exceptions: RecurrenceException[],
  now: Date
): NextClassAtRepairCandidate[] {
  return students.reduce<NextClassAtRepairCandidate[]>((repairs, student) => {
    const canonical = calculateCurrentOrNextClass(student, lessons, recurrenceRules, exceptions, now);
    const canonicalNextClassAt = canonical?.start ?? null;
    const canonicalNextClassEndAt = canonical?.end ?? null;
    if (
      canonicalNextClassAt === student.nextClassAt &&
      canonicalNextClassEndAt === (student.nextClassEndAt ?? null)
    ) {
      return repairs;
    }
    repairs.push({
      id: student.id,
      currentNextClassAt: student.nextClassAt,
      canonicalNextClassAt,
      canonicalNextClassEndAt,
    });
    return repairs;
  }, []);
}
