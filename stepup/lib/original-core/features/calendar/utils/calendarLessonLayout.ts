// Puerto VERBATIM del original (`src/features/calendar/utils/calendarLessonLayout.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, bug reportado en dispositivo:
 * "hay estudiantes que no aparecen" al recorrer la vista Día): antes,
 * `WeekTimeGrid` posicionaba CADA clase del día con el mismo `left`/`right`
 * fijo (todo el ancho de la columna), sin importar si otra clase ya
 * ocupaba ese mismo horario — dos clases superpuestas en el tiempo
 * (superposición permitida, series que quedaron encimadas tras un cambio,
 * etc.) terminaban pintadas exactamente una arriba de la otra, y sólo la
 * última en dibujarse quedaba visible; la otra desaparecía sin ningún
 * indicio. Esto ya pasaba en la vista Semana, pero la fila ancha de la
 * vista Día lo hace total (tapa el 100% de la clase de abajo).
 *
 * Esta función es puramente de LAYOUT visual — nunca decide qué clases
 * existen, nunca reimplementa el motor de recurrencias/conflictos
 * (`calendarConflicts.ts`, sin cambios) — sólo reparte el ancho disponible
 * entre las clases que de verdad se superponen en el tiempo, para que
 * todas queden visibles lado a lado, exactamente como cualquier agenda
 * profesional.
 */
export interface LessonColumnSlot {
  lessonId: string;
  columnIndex: number;
  columnCount: number;
}

function startTime(lesson: CalendarLesson): number {
  return new Date(lesson.start).getTime();
}

function endTime(lesson: CalendarLesson): number {
  return new Date(lesson.end).getTime();
}

/**
 * Barrido cronológico clásico de asignación de columnas: cada clase recibe
 * la columna libre más baja entre las clases todavía "abiertas" (que no
 * terminaron antes de que ésta empiece); cuando ninguna clase sigue
 * abierta, se cierra el grupo de superposición y el conteo de columnas de
 * ese grupo queda fijo en el máximo usado. Nunca muta `lessons`.
 */
export function computeLessonColumnLayout(lessons: CalendarLesson[]): LessonColumnSlot[] {
  const sorted = [...lessons].sort((first, second) => {
    const startDiff = startTime(first) - startTime(second);
    if (startDiff !== 0) return startDiff;
    return endTime(first) - endTime(second);
  });

  const columnByLessonId = new Map<string, number>();
  let active: Array<{ lesson: CalendarLesson; column: number }> = [];
  let currentGroup: CalendarLesson[] = [];
  const groups: CalendarLesson[][] = [];

  const closeGroup = () => {
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    currentGroup = [];
  };

  for (const lesson of sorted) {
    active = active.filter((entry) => endTime(entry.lesson) > startTime(lesson));

    if (active.length === 0) {
      closeGroup();
    }

    const usedColumns = new Set(active.map((entry) => entry.column));
    let column = 0;
    while (usedColumns.has(column)) {
      column += 1;
    }

    active.push({ lesson, column });
    columnByLessonId.set(lesson.id, column);
    currentGroup.push(lesson);
  }
  closeGroup();

  const slots: LessonColumnSlot[] = [];
  for (const group of groups) {
    const columnCount =
      Math.max(...group.map((lesson) => columnByLessonId.get(lesson.id) ?? 0)) + 1;
    for (const lesson of group) {
      slots.push({
        lessonId: lesson.id,
        columnIndex: columnByLessonId.get(lesson.id) ?? 0,
        columnCount,
      });
    }
  }

  return slots;
}
