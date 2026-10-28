// Puerto VERBATIM del original (`src/features/calendar/utils/calendarVisualLegend.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../theme/colors.ts';
import type { CalendarLesson, CalendarLessonStatus, CalendarModality } from '../types/index.ts';

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "MODALIDAD VISIBLE EN VISTA
 * DIARIA + PANTALLA DE INFORMACIÓN"): configuración semántica ÚNICA de
 * color + ícono + etiqueta + descripción para modalidades y estados de
 * clase. Antes `CalendarLessonCard.tsx` tenía esta lógica escrita en línea
 * (if/else repetidos) y no había ninguna otra pantalla que pudiera
 * mostrarla — ahora es la única fuente real, consumida tanto por las
 * tarjetas del Calendario como por la pantalla "Información": si mañana
 * cambia un color acá, ambas lo reflejan solas, nunca hay que copiar un
 * hexadecimal a mano en un segundo lugar.
 */

export interface CalendarColorEntry {
  /** Color de fondo de la tarjeta/muestra. */
  color: string;
  /** Color de texto/ícono/borde sobre ese fondo (contraste suficiente). */
  textColor: string;
  label: string;
  description: string;
}

export interface ModalityLegendEntry extends CalendarColorEntry {
  icon: keyof typeof Ionicons.glyphMap;
}

/**
 * Color e ícono real de cada modalidad — usado como color de la tarjeta
 * SÓLO cuando la clase no tiene un estado especial (ver
 * `LESSON_STATUS_COLOR_LEGEND` y `resolveLessonColor` más abajo, que
 * siempre da prioridad al estado sobre la modalidad, igual que antes).
 */
// Corrección puntual 2026-08-18 (a pedido de Joaquín — escala cromática
// CONGELADA del Calendario, ver CLAUDE.md): hex exactos y fijos —
// `colors.calendar*`, tokens EXCLUSIVOS de estas tarjetas. Sólo Joaquín
// puede autorizar cambiar esta escala.
export const MODALITY_LEGEND: Record<CalendarModality, ModalityLegendEntry> = {
  presencial: {
    color: colors.calendarPresencialBg,
    textColor: colors.calendarPresencialBorder,
    icon: 'location-outline',
    label: 'Presencial',
    description: 'La clase se realiza personalmente.',
  },
  online: {
    color: colors.calendarOnlineBg,
    textColor: colors.calendarOnlineBorder,
    icon: 'videocam-outline',
    label: 'Online',
    description: 'La clase se realiza a distancia.',
  },
  mixta: {
    color: colors.calendarMixtaBg,
    textColor: colors.calendarMixtaBorder,
    icon: 'swap-horizontal-outline',
    label: 'Mixta',
    description: 'Puede combinar modalidad presencial y online según lo acordado.',
  },
};

/** Orden de presentación estable para recorrer las 3 modalidades reales. */
export const MODALITY_ORDER: CalendarModality[] = ['presencial', 'online', 'mixta'];

/**
 * Abreviatura de la palabra completa — único caso que la necesita es
 * "Presencial" (las otras dos ya son cortas). Último recurso, sólo en una
 * columna extremadamente angosta (ver `CalendarLessonCard.tsx`); la
 * etiqueta accesible siempre usa la palabra completa de `MODALITY_LEGEND`.
 */
export const MODALITY_SHORT_LABEL: Record<CalendarModality, string> = {
  presencial: 'Pres.',
  online: 'Online',
  mixta: 'Mixta',
};

/**
 * Estados de una clase con color propio — tienen prioridad sobre el color
 * de la modalidad (misma regla que ya existía). `scheduled` (Programada)
 * deliberadamente no tiene entrada acá: nunca tuvo un color propio, usa
 * siempre el de su modalidad — ver `resolveLessonColor`.
 */
/**
 * Etiqueta + descripción reales de cada estado — usadas por
 * `lessonStatusLabel`/`lessonStatusDescription` (pantalla "Información")
 * para los 4 estados reales. IMPORTANTE: `color`/`textColor` de
 * `completed` y `rescheduled` NO se usan más para pintar la tarjeta —
 * ver `resolveLessonColor` más abajo. Corrección puntual 2026-08-18 (a
 * pedido de Joaquín — escala cromática CONGELADA del Calendario): "Clase
 * dictada" (completed) y "Reprogramada" (rescheduled) CONSERVAN el color
 * de su modalidad real — se diferencian sólo con la etiqueta, nunca con
 * un color propio. Antes `rescheduled` mostraba SIEMPRE peach fijo, sin
 * importar si la clase era online/mixta — mismo tipo de bug que el verde
 * de `completed` corregido antes (VERDE EXCLUSIVO PARA REEMPLAZOS): un
 * color de estado hardcodeado, ignorando la modalidad real. Sólo
 * `cancelled` conserva un color propio real (gris) — tiene prioridad
 * absoluta sobre cualquier otra cosa.
 */
export const LESSON_STATUS_COLOR_LEGEND: Partial<Record<CalendarLessonStatus, CalendarColorEntry>> = {
  cancelled: {
    color: colors.calendarCancelledBg,
    textColor: colors.calendarCancelledBorder,
    label: 'Cancelada',
    description: 'La clase no se dictará y aparece atenuada en el calendario.',
  },
  completed: {
    color: colors.pastelRose,
    textColor: colors.pastelRoseText,
    label: 'Completada',
    description: 'La clase ya se dictó y quedó registrada.',
  },
  rescheduled: {
    color: colors.pastelPeach,
    textColor: colors.pastelPeachText,
    label: 'Reprogramada',
    description: 'La clase fue trasladada a otra fecha u horario.',
  },
};

/**
 * Los 4 estados reales del modelo (`CalendarLessonStatus`), en el orden en
 * que conviene explicarlos. Nunca agregar acá un estado que no exista de
 * verdad en el código — la pantalla "Información" recorre exactamente
 * esta lista, nunca inventa una propia.
 */
export const LESSON_STATUS_ORDER: CalendarLessonStatus[] = [
  'scheduled',
  'completed',
  'cancelled',
  'rescheduled',
];

/** Descripción de "Programada" — el único estado sin color propio, así que no vive en `LESSON_STATUS_COLOR_LEGEND`. */
export const SCHEDULED_STATUS_DESCRIPTION =
  'La clase está agendada y todavía no se dictó. Usa el color de su modalidad.';

export function lessonStatusLabel(status: CalendarLessonStatus): string {
  if (status === 'scheduled') return 'Programada';
  return LESSON_STATUS_COLOR_LEGEND[status]?.label ?? status;
}

export function lessonStatusDescription(status: CalendarLessonStatus): string {
  if (status === 'scheduled') return SCHEDULED_STATUS_DESCRIPTION;
  return LESSON_STATUS_COLOR_LEGEND[status]?.description ?? '';
}

/**
 * Corrección puntual 2026-08-18 (a pedido de Joaquín — VERDE EXCLUSIVO
 * PARA CLASES DE REEMPLAZO): entrada mínima que necesita esta función para
 * identificar la clase — sólo `id` (opcional: la leyenda de "Información"
 * pinta colores de ejemplo sin ninguna clase real detrás, así que nunca
 * puede exigirlo).
 */
export interface LessonColorInput {
  id?: string;
  status: CalendarLessonStatus;
  modality: CalendarModality;
  freedByLessonId?: string | null;
}

export type CalendarLessonVisualCategory =
  | 'cancelled'
  | 'replacement'
  | 'completed'
  | 'rescheduled'
  | 'scheduled';

/**
 * ÚNICA fuente de verdad real para clasificar visualmente una clase —
 * vista semanal, vista diaria (mismo `WeekTimeGrid.tsx`) y
 * `CalendarLessonCard.tsx` consultan exactamente esta función, nunca una
 * condición propia. El verde (`pastelReplacement`) queda reservado
 * EXCLUSIVAMENTE para `'replacement'`, y esa categoría exige las CUATRO
 * condiciones reales a la vez:
 *   1. la propia clase tiene `freedByLessonId`;
 *   2. ese id aparece en `allLessons`;
 *   3. la clase encontrada con ese id está realmente cancelada
 *      (`status === 'cancelled'`) — el vínculo "informativo" de
 *      `freedByLessonId` (ver `types/index.ts`) se vuelve, sólo acá, un
 *      requisito real para el color, nunca para conflictos/pagos/
 *      identidad, que siguen sin leerlo;
 *   4. la propia clase de reemplazo no está cancelada ella misma (si se
 *      cancela o se elimina, deja de contar — sin condición aparte: un
 *      `freedByLessonId` que ya no aparece en `allLessons` porque la
 *      clase se borró tampoco encuentra nada en el paso 2).
 * `cancelled` tiene prioridad absoluta: una clase cancelada es SIEMPRE
 * gris, incluso si alguna vez fue, o si técnicamente tuviera, un
 * `freedByLessonId` propio.
 */
export function resolveLessonVisualCategory(
  lesson: LessonColorInput,
  allLessons: Pick<CalendarLesson, 'id' | 'status'>[] = []
): CalendarLessonVisualCategory {
  if (lesson.status === 'cancelled') return 'cancelled';

  if (lesson.freedByLessonId) {
    const original = allLessons.find((candidate) => candidate.id === lesson.freedByLessonId);
    if (original && original.status === 'cancelled') {
      return 'replacement';
    }
  }

  if (lesson.status === 'completed') return 'completed';
  if (lesson.status === 'rescheduled') return 'rescheduled';
  return 'scheduled';
}

/**
 * Color real de una clase — el mismo cálculo que ya usaban `cardBackground`/
 * `cardAccent` en `CalendarLessonCard.tsx`, ahora en un único lugar.
 * Delega en `resolveLessonVisualCategory`: nunca reimplementa la
 * clasificación acá, sólo la traduce a color/texto/etiqueta reales.
 */
export function resolveLessonColor(
  lesson: LessonColorInput,
  allLessons: Pick<CalendarLesson, 'id' | 'status'>[] = []
): CalendarColorEntry {
  const category = resolveLessonVisualCategory(lesson, allLessons);
  if (category === 'replacement') {
    return {
      color: colors.calendarReplacementBg,
      textColor: colors.calendarReplacementBorder,
      label: 'Reemplazo',
      description: 'Clase que ocupa un horario liberado por una cancelación.',
    };
  }
  if (category === 'cancelled') {
    return LESSON_STATUS_COLOR_LEGEND.cancelled ?? MODALITY_LEGEND[lesson.modality];
  }
  // 'completed' y 'rescheduled' conservan el color de su modalidad real —
  // ver el comentario de LESSON_STATUS_COLOR_LEGEND más arriba.
  return MODALITY_LEGEND[lesson.modality];
}

/**
 * Color real de un bloque de disponibilidad (trabajo, estudio,
 * vacaciones, feriado, licencia, etc.) en la grilla del Calendario — el
 * mismo `colors.availabilityBlockBg`/`availabilityBlockBorder` que ya usa
 * `WeekTimeGrid.tsx`. Todos los motivos comparten este único estilo
 * visual (gris neutro): lo que cambia es sólo el texto, nunca el color.
 */
export const AVAILABILITY_BLOCK_COLOR: CalendarColorEntry = {
  color: colors.availabilityBlockBg,
  textColor: colors.availabilityBlockBorder,
  label: 'Bloqueado',
  description: 'Ese horario ya no está disponible para agendar una clase.',
};

/**
 * Corrección puntual 2026-08-18 (a pedido de Joaquín — CAMBIO VISUAL
 * PUNTUAL, CLASES DADAS Y CANCELADAS): REEMPLAZA la corrección anterior del
 * mismo día ("clase transcurrida" = color de su modalidad atenuado con una
 * mezcla de gris — `applyPastLessonTreatment`/`mixHexColors`, eliminadas).
 * Ahora es un gris oscuro FIJO y congelado (nunca una mezcla), con
 * prioridad sobre TODO excepto la cancelación — incluido un reemplazo
 * activo cuyo horario ya terminó, que también pasa a este gris en vez de
 * quedar coral. Ver CLAUDE.md → "Reglas visuales congeladas del
 * calendario".
 */
export const ELAPSED_LESSON_COLOR: CalendarColorEntry = {
  color: colors.calendarElapsedBg,
  textColor: colors.calendarElapsedBorder,
  label: 'Transcurrida',
  description: 'La clase ya terminó su horario.',
};

/**
 * ÚNICA función real que `CalendarLessonCard.tsx` debe llamar para pintar
 * el fondo/borde de una tarjeta — el orden centralizado de prioridad
 * completo, en un solo lugar, para que vista semanal y vista diaria (mismo
 * `WeekTimeGrid.tsx`) nunca puedan resolverlo de forma distinta. Nunca
 * duplicar estas condiciones en el componente: sólo consumir el resultado.
 *   1. Cancelada (`lesson.status === 'cancelled'`) → naranja congelado,
 *      SIEMPRE — la cancelación tiene prioridad absoluta y nunca se vuelve
 *      gris por el paso del tiempo, sin importar `isElapsed`.
 *   2. No cancelada y `isElapsed` (hora de FINALIZACIÓN <= ahora, ver
 *      `isPastLesson` en `calendarDayGridLayout.ts`) → gris oscuro
 *      congelado — incluye un reemplazo activo cuyo horario ya terminó.
 *   3. Cualquier otro caso → `resolveLessonColor` (reemplazo activo
 *      FUTURO = coral; si no, color real de la modalidad/estado —
 *      exactamente el mismo cálculo de siempre, sin ningún cambio).
 * `isElapsed` es puramente temporal y NUNCA participa en
 * `resolveLessonVisualCategory`/`resolveLessonColor`: por construcción, no
 * puede seleccionar la paleta de reemplazo ni la de modalidad por sí sola.
 */
export function resolveLessonCardPalette(
  lesson: LessonColorInput,
  allLessons: Pick<CalendarLesson, 'id' | 'status'>[] = [],
  isElapsed: boolean = false
): CalendarColorEntry {
  if (lesson.status === 'cancelled') {
    return LESSON_STATUS_COLOR_LEGEND.cancelled ?? resolveLessonColor(lesson, allLessons);
  }
  if (isElapsed) {
    return ELAPSED_LESSON_COLOR;
  }
  return resolveLessonColor(lesson, allLessons);
}
