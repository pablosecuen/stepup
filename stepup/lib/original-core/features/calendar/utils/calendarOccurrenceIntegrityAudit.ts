// Puerto VERBATIM del original (`src/features/calendar/utils/calendarOccurrenceIntegrityAudit.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../types/index.ts';
import { applyExceptionsToOccurrences, generateOccurrences } from './calendarRecurrenceEngine.ts';
import { getLocalDateKey } from './calendarTimezone.ts';

/**
 * Corrección 2026-08-13 (a pedido de Joaquín — ERROR CRÍTICO: OCURRENCIAS
 * QUE DESAPARECEN DEL CALENDARIO, FASE 2 — "auditoría de un mes completo
 * detecta cualquier hueco inesperado"): función pura de sólo lectura, nunca
 * muta nada — cruza lo que la regla real DEBERÍA producir contra lo que
 * efectivamente queda visible (virtual + materializado) dentro de un rango,
 * y señala huecos que ninguna excepción legítima explica.
 *
 * Dos clases de hueco:
 * 1) `orphanCompleted`: existe un `CalendarLesson` ya `completed` con el
 *    `recurrenceId` de esta regla, su fecha cae dentro del rango auditado,
 *    pero la regla YA NO lo genera (quedó fuera de sus límites reales,
 *    normalmente por un `endDate`/`status` truncado incorrectamente) — la
 *    firma exacta del bug corregido en `removeFutureMaterializationsForRecurrences`.
 * 2) `missingMaterialization`: `applyExceptionsToOccurrences` marca la
 *    ocurrencia como `materialized`/`rescheduled` (es decir, "acá debería
 *    haber una clase real"), pero ningún `CalendarLesson` con esa identidad
 *    existe realmente en `lessons` — la ocurrencia no aparece ni virtual
 *    (excluida por estar "materializada") ni real (el registro se perdió).
 */
export interface RecurrenceOccurrenceGap {
  recurrenceId: string;
  occurrenceKey: string;
  expectedStart: string;
  kind: 'orphanCompleted' | 'missingMaterialization';
}

export function auditRecurrenceOccurrenceGaps(input: {
  rule: RecurrenceRule;
  exceptions: RecurrenceException[];
  lessons: CalendarLesson[];
  rangeStart: Date;
  rangeEnd: Date;
}): RecurrenceOccurrenceGap[] {
  const { rule, exceptions, lessons, rangeStart, rangeEnd } = input;
  const gaps: RecurrenceOccurrenceGap[] = [];

  const generated = generateOccurrences(rule, rangeStart, rangeEnd);
  const applied = applyExceptionsToOccurrences(generated, exceptions, lessons);

  // 1) Ocurrencias generadas cuya materialización esperada no existe realmente.
  applied.forEach((occurrence) => {
    if (occurrence.materializationStatus !== 'materialized' && occurrence.materializationStatus !== 'rescheduled') {
      return;
    }
    const hasRealLesson = lessons.some(
      (lesson) =>
        lesson.id === occurrence.materializedLessonId ||
        (lesson.recurrenceId === occurrence.recurrenceId &&
          lesson.recurrenceOccurrenceKey === occurrence.occurrenceKey)
    );
    if (!hasRealLesson) {
      gaps.push({
        recurrenceId: occurrence.recurrenceId,
        occurrenceKey: occurrence.occurrenceKey,
        expectedStart: occurrence.start,
        kind: 'missingMaterialization',
      });
    }
  });

  // 2) Clases YA COMPLETADAS de esta regla, dentro del rango, que la regla
  // ya no reconoce como propias (quedaron fuera de sus límites reales).
  const recognizedKeys = new Set(generated.map((occurrence) => occurrence.occurrenceKey));
  lessons.forEach((lesson) => {
    if (lesson.recurrenceId !== rule.recurrenceId) return;
    if (lesson.status !== 'completed') return;
    if (!lesson.recurrenceOccurrenceKey) return;
    const logicalStart = lesson.recurrenceOriginalStart ?? lesson.start;
    const startTime = new Date(logicalStart).getTime();
    if (startTime < rangeStart.getTime() || startTime > rangeEnd.getTime()) return;
    if (recognizedKeys.has(lesson.recurrenceOccurrenceKey)) return;
    gaps.push({
      recurrenceId: rule.recurrenceId,
      occurrenceKey: lesson.recurrenceOccurrenceKey,
      expectedStart: logicalStart,
      kind: 'orphanCompleted',
    });
  });

  return gaps.sort((first, second) => new Date(first.expectedStart).getTime() - new Date(second.expectedStart).getTime());
}

/**
 * Variante multi-regla — recorre todas las reglas activas y agrega sus
 * huecos, cada uno anotado con IDs reales (nunca nombres de alumnos), apta
 * para un reporte de auditoría de un mes completo sin exponer datos
 * personales.
 */
export function auditAllRecurrenceOccurrenceGaps(input: {
  rules: RecurrenceRule[];
  exceptions: RecurrenceException[];
  lessons: CalendarLesson[];
  rangeStart: Date;
  rangeEnd: Date;
}): RecurrenceOccurrenceGap[] {
  return input.rules
    .filter((rule) => rule.status === 'active')
    .flatMap((rule) =>
      auditRecurrenceOccurrenceGaps({
        rule,
        exceptions: input.exceptions,
        lessons: input.lessons,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
      })
    );
}

// Reexportado para que un consumidor de auditoría pueda formatear la fecha
// lógica en horario argentino sin importar el motor de recurrencia entero.
export { getLocalDateKey };
