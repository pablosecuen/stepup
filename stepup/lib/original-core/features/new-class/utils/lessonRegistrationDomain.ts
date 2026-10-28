// Puerto VERBATIM del original (`src/features/new-class/utils/lessonRegistrationDomain.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLessonRegistration } from '../../calendar/types/index.ts';
import type { LessonOutcomeForProfile } from '../../student-profile/utils/profileLessonOutcome.ts';
import type {
  ClassSessionMeta,
  GroupRegistrationProgress,
  HomeworkReviewEntry,
  NewClassFormState,
  SavedLesson,
} from '../types/index.ts';
import { isClassHeld } from './validation.ts';
import { upsertHomeworkReviews } from './homeworkPendingDomain.ts';

export interface PrepareSavedLessonInput {
  current: SavedLesson[];
  form: NewClassFormState;
  studentPrices: Record<string, number>;
  calendarRegistration?: CalendarLessonRegistration;
  savedLessonId: string;
  createdAt: string;
  /** Ciclo real de clase y puntualidad (2026-07-18, tercera ronda) — presente sólo si vino de "Finalizar clase". */
  sessionMeta?: ClassSessionMeta;
  /**
   * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: ciclo real de
   * tareas pendientes): revisiones de tareas asignadas en clases
   * ANTERIORES, decididas en la tarjeta "Tarea pendiente" de esta misma
   * pantalla. Siempre se aplican (upsert por taskId), incluso cuando la
   * reserva de esta clase ya estaba aplicada — revisar una tarea vieja es
   * una acción independiente de si el CONTENIDO de esta clase es nuevo.
   */
  homeworkReviewEntries?: HomeworkReviewEntry[];
  /**
   * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E
   * INTUITIVO DEL REGISTRO DE CLASES, "progreso parcial grupal"): ausente
   * (el caso de siempre, `NewClassScreen.tsx`/"Finalizar clase"/registro
   * individual) equivale a un registro `completed` — comportamiento
   * IDÉNTICO al de antes de esta fase, cero cambios para esos flujos.
   * `'partially_registered'` + `groupProgress` son EXCLUSIVOS del panel
   * grupal nuevo (`useSaveGroupRegistration.ts`) cuando la profesora todavía
   * no completó a todos los participantes — nunca dispara aplicar
   * perfiles/tareas/cobros (eso lo decide el llamador, no esta función
   * pura). Pasar `registrationStatus: undefined` explícitamente (el default
   * de "Finalizar registro") SIEMPRE limpia cualquier estado parcial previo
   * — nunca queda un registro "terminado" que todavía diga
   * `partially_registered` por spreadear el `existing` sin querer.
   */
  registrationStatus?: 'partially_registered' | 'completed';
  groupProgress?: GroupRegistrationProgress;
}

export interface PreparedSavedLesson {
  saved: SavedLesson;
  next: SavedLesson[];
  isNew: boolean;
  alreadyApplied: boolean;
  /**
   * Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO: registro de
   * clase, series, scroll y modal atascado): `true` cuando ya existía un
   * `SavedLesson` para esta reserva PERO todavía no se había aplicado
   * (`profileAppliedAt` nulo) y se actualizó con el formulario recién
   * completado — el llamador debe persistirlo igual que si fuera nuevo
   * (`isNew` sigue en `false` porque el `id`/`createdAt` originales se
   * conservan, nunca se duplica la fila).
   */
  wasUpdated: boolean;
}

/**
 * Corrección 2026-08-12 (a pedido de Joaquín — CORRECCIÓN FINANCIERA
 * OBLIGATORIA: las ausencias del alumno no anulan el cobro): la
 * facturación depende EXCLUSIVAMENTE del resultado general de la clase
 * (`isClassHeld` — "Realizada", o "Feriado" con excepción), nunca de la
 * asistencia individual. Una clase "Realizada" se cobra aunque ningún
 * participante haya asistido — Presente, Tarde, Ausente con aviso y
 * Ausente son todos estados informativos (historial, puntualidad,
 * reportes), ninguno anula ni reduce el cargo. Si la profesora quiere
 * ofrecer una recuperación por una ausencia avisada, es una reprogramación
 * explícita — nunca algo automático desde acá.
 */
export function computeLessonBilledAmount(
  form: NewClassFormState,
  studentPrices: Record<string, number>
): number | null {
  if (!form.isBillable) return null;
  const totalPrice = form.studentIds.reduce(
    (sum, studentId) => sum + (studentPrices[studentId] ?? 0),
    0
  );
  if (form.eventType === 'cancelada_tarde' && form.lateCancellationPolicy) {
    if (form.lateCancellationPolicy === 'cobrar_100') return totalPrice;
    if (form.lateCancellationPolicy === 'cobrar_porcentaje') {
      return form.lateCancellationPercentage
        ? Math.round((totalPrice * form.lateCancellationPercentage) / 100)
        : 0;
    }
    return 0;
  }
  return isClassHeld(form) ? totalPrice : 0;
}

/**
 * Factor (0 a 1) que aplica sobre el precio de CADA alumno para llegar a su
 * importe facturado — exactamente la misma regla que `computeLessonBilledAmount`
 * aplica sobre el total, así que el desglose por alumno es consistente con
 * el total (salvo, a lo sumo, 1 peso de diferencia por redondeo cuando hay
 * más de un alumno con "cobrar_porcentaje": acá se redondea por alumno, allá
 * se redondea una única vez sobre el total).
 */
function billingFactor(form: NewClassFormState): number {
  if (form.eventType === 'cancelada_tarde' && form.lateCancellationPolicy) {
    if (form.lateCancellationPolicy === 'cobrar_100') return 1;
    if (form.lateCancellationPolicy === 'cobrar_porcentaje') {
      return form.lateCancellationPercentage ? form.lateCancellationPercentage / 100 : 0;
    }
    return 0; // descontar_del_paquete | no_cobrar
  }
  return isClassHeld(form) ? 1 : 0;
}

/**
 * Desglose del importe facturado por alumno (Fase Pagos 4B.1) — `null` si
 * la clase no es facturable (`isBillable: false`), igual que
 * `computeLessonBilledAmount`. Nunca inventa una división distinta del
 * precio propio de cada alumno: cada uno factura su propio precio (ajustado
 * por la misma política de cancelación tardía que aplica al total).
 */
export function computeLessonBilledAmountByStudent(
  form: NewClassFormState,
  studentPrices: Record<string, number>
): Record<string, number> | null {
  if (!form.isBillable) return null;
  const factor = billingFactor(form);
  const result: Record<string, number> = {};
  form.studentIds.forEach((studentId) => {
    const price = studentPrices[studentId] ?? 0;
    result[studentId] = factor === 1 ? price : Math.round(price * factor);
  });
  return result;
}

/**
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO: registro de
 * clase, series, scroll y modal atascado): ANTES, encontrar un
 * `SavedLesson` con el mismo `calendarReservationKey` devolvía ese registro
 * `existing` TAL CUAL, sin importar si ya se había aplicado o no —
 * descartando en silencio contenido pedagógico, evaluación, observaciones,
 * tarea, adjuntos, asistencia individual y duración real recién
 * completados por la profesora. La protección contra duplicados (nunca
 * crear una segunda fila para la misma reserva, nunca re-aplicar
 * estadísticas/pagos dos veces) sigue intacta — se resuelve por identidad
 * (`calendarReservationKey`) y por `profileAppliedAt`, nunca devolviendo
 * datos viejos como si fueran el resultado del guardado actual:
 *
 *   - sin registro previo → se crea uno nuevo (comportamiento de siempre);
 *   - registro previo SIN aplicar (`profileAppliedAt` nulo) → se ACTUALIZA
 *     con una copia profunda del formulario recién completado —
 *     `wasUpdated: true` le indica al llamador que debe persistir este
 *     cambio igual que si fuera nuevo, conservando el mismo `id`;
 *   - registro previo YA aplicado → se devuelve tal cual
 *     (`alreadyApplied: true`): un reintento idéntico es idempotente
 *     (nunca duplica estadísticas/asistencia/cobros), y cualquier cambio
 *     de contenido posterior debe pasar por el flujo real de edición
 *     (`useEditRegisteredLesson.ts`), nunca por acá.
 *
 * La copia del formulario es SIEMPRE profunda (`JSON.parse(JSON.stringify)`
 * — todos los campos de `NewClassFormState` son JSON-serializables, sin
 * funciones ni fechas nativas): nunca se guarda la referencia mutable del
 * estado de React, que el componente puede resetear (`resetForm()`)
 * inmediatamente después de llamar a esta función.
 */
export function prepareSavedLesson(input: PrepareSavedLessonInput): PreparedSavedLesson {
  const existingIndex = input.calendarRegistration
    ? input.current.findIndex(
        (lesson) =>
          lesson.calendarReservationKey === input.calendarRegistration?.reservationKey
      )
    : -1;
  const existing = existingIndex === -1 ? undefined : input.current[existingIndex];

  if (existing?.profileAppliedAt) {
    return {
      saved: existing,
      next: input.current,
      isNew: false,
      alreadyApplied: true,
      wasUpdated: false,
    };
  }

  // Copia profunda — nunca la referencia mutable del formulario de React.
  const formCopy: NewClassFormState = JSON.parse(JSON.stringify(input.form));
  const computedFields = {
    countsAsClass: isClassHeld(formCopy),
    billedAmount: computeLessonBilledAmount(formCopy, input.studentPrices),
    billedAmountByStudent: computeLessonBilledAmountByStudent(formCopy, input.studentPrices) ?? undefined,
    appliedPolicy: formCopy.eventType === 'cancelada_tarde' ? formCopy.lateCancellationPolicy : null,
  };
  const sessionMetaFields = input.sessionMeta
    ? {
        scheduledStartAt: input.sessionMeta.scheduledStartAt,
        effectiveStartAt: input.sessionMeta.effectiveStartAt,
        actualStartedAt: input.sessionMeta.actualStartedAt,
        actualEndedAt: input.sessionMeta.actualEndedAt,
        scheduleAdjustment: input.sessionMeta.scheduleAdjustment,
        studentArrival: input.sessionMeta.studentArrival,
        startSource: input.sessionMeta.startSource,
      }
    : {};

  // FASE 3 (ciclo de tareas pendientes): revisar una tarea de una clase
  // anterior es una acción independiente del contenido de ESTA clase — se
  // aplica siempre que haya selecciones, tanto si la reserva es nueva como
  // si ya existía sin aplicar todavía.
  const homeworkReviews = input.homeworkReviewEntries?.length
    ? upsertHomeworkReviews(existing?.homeworkReviews, input.homeworkReviewEntries)
    : existing?.homeworkReviews;

  if (existing) {
    const updated: SavedLesson = {
      ...existing,
      form: formCopy,
      ...computedFields,
      ...sessionMetaFields,
      homeworkReviews,
      // Nunca "spreadear" un `registrationStatus`/`groupProgress` viejo del
      // `existing` sin querer: se fija explícitamente según lo que pide
      // ESTE guardado — así "Finalizar registro" (sin pasar estos campos)
      // siempre limpia el estado parcial anterior, y un guardado de
      // borrador siempre refleja el progreso recién actualizado.
      registrationStatus: input.registrationStatus,
      groupProgress: input.groupProgress,
    };
    const next = input.current.map((lesson, index) => (index === existingIndex ? updated : lesson));
    return { saved: updated, next, isNew: false, alreadyApplied: false, wasUpdated: true };
  }

  const saved: SavedLesson = {
    id: input.savedLessonId,
    createdAt: input.createdAt,
    form: formCopy,
    ...computedFields,
    calendarReservationKey: input.calendarRegistration?.reservationKey,
    calendarLessonId: input.calendarRegistration?.lessonId,
    calendarRegistration: input.calendarRegistration,
    profileAppliedAt: null,
    ...sessionMetaFields,
    homeworkReviews,
    registrationStatus: input.registrationStatus,
    groupProgress: input.groupProgress,
  };
  return { saved, next: [...input.current, saved], isNew: true, alreadyApplied: false, wasUpdated: false };
}

export function buildLessonOutcomeForStudent(
  form: NewClassFormState,
  studentId: string,
  countsAsClass: boolean
): LessonOutcomeForProfile {
  const attendance = form.attendance.find((entry) => entry.studentId === studentId);
  const evaluation = form.evaluations.find((entry) => entry.studentId === studentId);
  return {
    countsAsClass,
    dateTimeIso: new Date(`${form.date}T${form.time || '00:00'}:00`).toISOString(),
    hoursDelta:
      countsAsClass && form.actualDurationMinutes ? form.actualDurationMinutes / 60 : 0,
    present: attendance ? attendance.present : null,
    generalGrade: evaluation?.generalGrade ?? null,
    skillGrades: (evaluation?.skillGrades as Record<string, number>) ?? {},
    strengths: evaluation?.strengths ?? [],
    areasToImprove: evaluation?.areasToImprove ?? [],
    homeworkDescription: form.homeworkDescription.trim() || null,
  };
}

export function markSavedLessonApplied(
  current: SavedLesson[],
  savedLessonId: string,
  appliedAt: string
): SavedLesson[] {
  return current.map((lesson) =>
    lesson.id === savedLessonId ? { ...lesson, profileAppliedAt: appliedAt } : lesson
  );
}
