// Puerto VERBATIM del original (`src/features/new-class/utils/manualSessionCorrection.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson, StudentArrival } from '../types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): corrección manual POST-clase — la profesora puede
 * haberse olvidado de tocar "Comenzar clase"/"Finalizar clase" a tiempo, o
 * haber contestado mal la pregunta de puntualidad. Nunca crea un segundo
 * registro: siempre corrige el `SavedLesson` ya guardado, en el mismo
 * lugar. Recalcula `actualDurationMinutes` a partir del nuevo inicio/fin
 * real, marca `manuallyCorrected`/`startSource`/`endSource` y actualiza
 * `sessionUpdatedAt` (nunca toca `createdAt` ni ningún campo financiero).
 */
export type ManualSessionCorrectionErrorCode = 'end_before_start' | 'arrival_wrong_day' | 'not_found';

export type ManualSessionCorrectionResult =
  | { ok: true; lesson: SavedLesson }
  | { ok: false; code: ManualSessionCorrectionErrorCode; message: string };

export function applyManualSessionCorrection(
  lesson: SavedLesson,
  actualStartedAt: string,
  actualEndedAt: string,
  arrival: StudentArrival,
  nowIso: string
): ManualSessionCorrectionResult {
  if (new Date(actualEndedAt).getTime() <= new Date(actualStartedAt).getTime()) {
    return {
      ok: false,
      code: 'end_before_start',
      message: 'La hora de finalización debe ser posterior a la hora de inicio.',
    };
  }

  if (arrival.arrivedAt && arrival.arrivedAt.slice(0, 10) !== lesson.form.date) {
    return {
      ok: false,
      code: 'arrival_wrong_day',
      message: 'La hora de llegada no corresponde al día de esta clase.',
    };
  }

  const actualDurationMinutes = Math.max(
    1,
    Math.round((new Date(actualEndedAt).getTime() - new Date(actualStartedAt).getTime()) / 60_000)
  );

  return {
    ok: true,
    lesson: {
      ...lesson,
      actualStartedAt,
      actualEndedAt,
      studentArrival: { ...arrival, manuallyCorrected: true },
      startSource: 'manual_correction',
      endSource: 'manual_correction',
      sessionUpdatedAt: nowIso,
      form: { ...lesson.form, actualDurationMinutes },
    },
  };
}
