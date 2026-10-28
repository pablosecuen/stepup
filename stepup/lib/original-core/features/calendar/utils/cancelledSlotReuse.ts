// Puerto VERBATIM del original (`src/features/calendar/utils/cancelledSlotReuse.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../types/index.ts';
import type { SavedLesson } from '../../new-class/types/index.ts';
import { findSavedLessonForCalendarLesson } from '../../new-class/utils/editRegisteredLessonDomain.ts';
import { localMidnightIso } from './calendarDayIso.ts';

/**
 * Corrección puntual 2026-08-18 (a pedido de Joaquín — CORREGIR
 * DUPLICACIÓN DE CANCELACIONES): ÚNICA fuente de verdad real del
 * "conjunto visible" de la grilla — vista semanal y vista diaria (mismo
 * `WeekTimeGrid.tsx`) reciben exactamente este resultado, vía
 * `windowDisplayLessons` en `useWeeklyCalendar.ts`, ANTES de layout/
 * columnas/contadores diarios (nunca un `if` dentro de
 * `CalendarLessonCard`). La clase oculta desaparece del arreglo por
 * completo — no ocupa ancho, no crea columna, no suma a contadores, no
 * intercepta toques. Nunca modifica ni elimina nada real: `allLessons` no
 * se toca, esto sólo decide qué devolver.
 *
 * Dos reglas, reutilizando EXACTAMENTE `hasActiveReplacementForCancelledSlot`
 * (la misma función real que ya decide "Reemplazar con otro alumno") —
 * nunca una segunda copia de la condición:
 *   1. Un reemplazo que a su vez fue cancelado (`freedByLessonId` propio +
 *      `status === 'cancelled'`) nunca se muestra — antes esta función
 *      sólo ocultaba la cancelación ORIGINAL cuando tenía un reemplazo
 *      activo, pero nunca ocultaba un REEMPLAZO que a su vez se hubiera
 *      cancelado: ese caso quedaba como una segunda tarjeta gris,
 *      duplicando la cancelación que ya representa la original (la causa
 *      real de "dos tarjetas canceladas en el mismo horario" reportada).
 *   2. Una clase cancelada se oculta apenas exista OTRA clase real,
 *      activa (no cancelada), que la reemplace — se ve sólo el
 *      reemplazo, tamaño completo.
 * Con reemplazos encadenados (uno cancelado, otro activo), la regla 1
 * oculta el intento cancelado y la regla 2 oculta la original — sin
 * ningún caso especial para "cadenas", ni necesidad de recorrerlas.
 */
export function hideCancelledLessonsWithActiveReplacement(
  allLessons: CalendarLesson[]
): CalendarLesson[] {
  return allLessons.filter((lesson) => {
    if (lesson.freedByLessonId && lesson.status === 'cancelled') return false;
    if (lesson.status === 'cancelled' && hasActiveReplacementForCancelledSlot(lesson, allLessons)) {
      return false;
    }
    return true;
  });
}

/**
 * Corrección 2026-08-18, revisada el mismo día (CORRECCIÓN URGENTE tras
 * prueba física real: "Reemplazar con otro alumno" faltaba). La versión
 * anterior exigía encontrar un `SavedLesson` con
 * `form.eventType === 'cancelada_con_aviso'` — pero el caso real (cancelar
 * una clase FUTURA con el botón directo "Cancelar esta clase", nunca
 * registrada pedagógicamente) no tiene ningún `SavedLesson` asociado, así
 * que esa condición nunca se cumplía y el botón nunca aparecía.
 *
 * Condición correcta, la información real persistida de cancelación:
 * `CalendarLesson.status === 'cancelled'`. En todo este código base ese
 * estado SÓLO se produce por (a) cancelación directa o (b) el registro
 * "Cancelada con aviso" — los otros 6 resultados posibles dejan
 * `status: 'completed'`, así que quedan excluidos automáticamente sin
 * necesidad de mirar el registro pedagógico para nada.
 *
 * Corrección puntual 2026-08-18 (a pedido de Joaquín — REEMPLAZO SÓLO EN
 * HORARIOS FUTUROS): `status === 'cancelled'` solo no alcanza — también
 * permitía "Reemplazar" sobre una clase cancelada cuyo horario YA PASÓ (no
 * tiene sentido reemplazar un horario que ya no existe) y no contemplaba
 * que ya hubiera una clase de reemplazo activa ocupando ese mismo horario
 * (ofrecerla de nuevo crearía un segundo reemplazo duplicado). Ahora exige,
 * simultáneamente: (1) cancelada, (2) fecha de inicio válida, (3) el inicio
 * es estrictamente POSTERIOR a `now` (una cancelación exactamente "ahora"
 * ya no cuenta como futura), y (4) que no exista ya un reemplazo activo
 * (ver `hasActiveReplacementForCancelledSlot`).
 *
 * Corrección P0 2026-08-18 (a pedido de Joaquín — "REEMPLAZAR CON OTRO
 * ALUMNO" SIGUE SIN APARECER EN EL TELÉFONO, tras confirmar en el commit
 * 51e20ab que la función aislada ya era correcta): `isEligibleForCancelled-
 * SlotReuse` e `hasActiveReplacementForCancelledSlot` dejan de tener cada
 * una su propia copia de las cuatro condiciones — ambas delegan ahora en
 * `getCancelledSlotReuseDecision`, la ÚNICA fuente de verdad real, la misma
 * que usa la interfaz. Esto no cambia ningún comportamiento (las pruebas
 * puras de la corrección anterior seguían pasando); lo que cambia es que
 * ahora existe un único lugar posible para una condición mal escrita, y un
 * objeto de diagnóstico completo (`reason`, `status`, `startTime`,
 * `nowTime`, ids de los reemplazos encontrados) para inspeccionar el
 * recorrido real sin adivinar.
 */
export type CancelledSlotReuseReason =
  | 'not_cancelled'
  | 'invalid_date'
  | 'not_future'
  | 'has_active_replacement'
  | 'eligible';

export interface CancelledSlotReuseDecision {
  eligible: boolean;
  reason: CancelledSlotReuseReason;
  status: CalendarLesson['status'];
  startTime: number;
  nowTime: number;
  hasActiveReplacement: boolean;
  /** Ids de las clases reales detectadas como reemplazo activo — vacío si no hay ninguna. */
  activeReplacementIds: string[];
}

/**
 * Diagnóstico puro: evalúa las cuatro condiciones de "Reemplazar con otro
 * alumno" sobre el objeto REAL recibido (el mismo `CalendarLesson` que
 * `WeekTimeGrid` le pasa a `handlePressLesson`, sin reconstruir nada) y
 * devuelve exactamente qué condición decidió el resultado — nunca sólo un
 * booleano. `isEligibleForCancelledSlotReuse` y
 * `hasActiveReplacementForCancelledSlot` son wrappers finos sobre esto: no
 * hay una segunda copia de la lógica en ningún lado.
 */
export function getCancelledSlotReuseDecision(
  lesson: CalendarLesson,
  allLessons: CalendarLesson[],
  now: Date = new Date()
): CancelledSlotReuseDecision {
  const status = lesson.status;
  const startTime = new Date(lesson.start).getTime();
  const nowTime = now.getTime();

  // Un reemplazo sólo cuenta si es un objeto REALMENTE distinto de la
  // cancelación original (nunca la propia clase apuntándose a sí misma por
  // algún dato corrupto), vinculado por freedByLessonId, y todavía activo
  // (cualquier status menos cancelled — programada, completada o
  // reprogramada siguen ocupando de hecho el horario).
  const activeReplacements = allLessons.filter(
    (candidate) =>
      candidate.id !== lesson.id &&
      candidate.freedByLessonId === lesson.id &&
      candidate.status !== 'cancelled'
  );
  const hasActiveReplacement = activeReplacements.length > 0;
  const activeReplacementIds = activeReplacements.map((candidate) => candidate.id);

  const base = { status, startTime, nowTime, hasActiveReplacement, activeReplacementIds };

  if (status !== 'cancelled') {
    return { ...base, eligible: false, reason: 'not_cancelled' };
  }
  if (Number.isNaN(startTime)) {
    return { ...base, eligible: false, reason: 'invalid_date' };
  }
  if (startTime <= nowTime) {
    return { ...base, eligible: false, reason: 'not_future' };
  }
  if (hasActiveReplacement) {
    return { ...base, eligible: false, reason: 'has_active_replacement' };
  }
  return { ...base, eligible: true, reason: 'eligible' };
}

export function isEligibleForCancelledSlotReuse(
  lesson: CalendarLesson,
  allLessons: CalendarLesson[],
  now: Date = new Date()
): boolean {
  return getCancelledSlotReuseDecision(lesson, allLessons, now).eligible;
}

/**
 * `true` cuando ya existe otra clase real, vinculada a ESTA cancelada vía
 * `freedByLessonId === lesson.id`, que sigue "activa" (cualquier status
 * menos `cancelled`: programada, completada o reprogramada — todas siguen
 * ocupando de hecho el horario). Si esa clase de reemplazo se elimina por
 * completo (deja de existir en `allLessons`) o ella misma se cancela, deja
 * de contar — el horario vuelve a quedar libre para un reemplazo nuevo, sin
 * ningún caso especial: es la misma regla real que ya usa el resto del
 * calendario para "cancelado = libre".
 */
export function hasActiveReplacementForCancelledSlot(
  lesson: CalendarLesson,
  allLessons: CalendarLesson[]
): boolean {
  return getCancelledSlotReuseDecision(lesson, allLessons).hasActiveReplacement;
}

/**
 * Distinto de lo anterior: esto NO decide si se puede "reemplazar" (eso es
 * siempre que esté cancelada). Decide si es seguro ofrecer "Restaurar esta
 * clase" — reactivar una cancelación que en realidad viene de un registro
 * pedagógico real ("Cancelada con aviso" ya registrado) dejaría ese
 * registro apuntando a una clase que volvió a estar "programada", una
 * inconsistencia real de datos. Para una cancelación directa (sin ningún
 * registro pedagógico), restaurar sigue siendo 100% seguro.
 */
export function hasRegisteredCancellationOutcome(
  lesson: CalendarLesson,
  savedLessons: SavedLesson[]
): boolean {
  if (lesson.status !== 'cancelled') return false;
  const saved = findSavedLessonForCalendarLesson(lesson, savedLessons);
  return saved?.form.eventType === 'cancelada_con_aviso';
}

export interface ReuseSlotPreset {
  date: string;
  hour: number;
  minute: number;
  durationMinutes: number;
  modality: CalendarLesson['modality'];
  /** El `id` de la clase cancelada que liberó este horario — ver `CalendarLesson.freedByLessonId`. */
  freedByLessonId: string;
}

/**
 * Convierte la clase cancelada tocada en el preset real que necesita el
 * mismo sheet de "Nueva clase" que ya usa tocar un horario vacío en la
 * grilla (`NewCalendarLessonSheet`, vía `SelectedSlot` en
 * `CalendarTabScreen.tsx`) — fecha, hora, duración y modalidad EXACTAS de
 * la clase cancelada, para que la profesora nunca tenga que volver a
 * buscarlas a mano. `date` usa `localMidnightIso` — el mismo formato
 * (ISO de la medianoche LOCAL) que ya produce `week.days[].date` y que
 * `SelectedSlot.date`/`NewCalendarLessonSheet.initialDate` esperan en
 * todos los demás lugares de este archivo — nunca un `YYYY-MM-DD` suelto,
 * que `new Date(...)` interpretaría como medianoche UTC y correría el día
 * en zonas horarias negativas (Argentina, UTC-3).
 */
export function buildReuseSlotPreset(lesson: CalendarLesson): ReuseSlotPreset {
  const start = new Date(lesson.start);
  const durationMinutes = Math.round(
    (new Date(lesson.end).getTime() - start.getTime()) / 60_000
  );
  return {
    date: localMidnightIso(start),
    hour: start.getHours(),
    minute: start.getMinutes(),
    durationMinutes,
    modality: lesson.modality,
    freedByLessonId: lesson.id,
  };
}
