// Puerto VERBATIM del original (`src/features/calendar/hooks/recurrenceMutationQueue.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../types/index.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules, saveCalendarRecurrenceSnapshot } from './calendarStore.ts';
import { upsertRecurrenceException as upsertRecurrenceExceptionInCollection } from '../utils/calendarRecurrenceMutations.ts';

/**
 * Corrección 2026-09-14, segunda ronda (a pedido de Joaquín — revisión
 * independiente de la corrección anterior: "no uses varios
 * `updateRecurrenceRule` seguidos ni combines escrituras fire-and-forget con
 * una escritura directa"): única puerta de escritura ESPERABLE y SERIALIZADA
 * para las operaciones financieras críticas de recurrencia (crear una serie
 * de entrenamiento, convertir una serie completa, configurar una serie
 * histórica, dividir "esta clase y las siguientes").
 *
 * Corrección 2026-09-14, TERCERA ronda (a pedido de Joaquín — revisión
 * INDEPENDIENTE que encontró que `useWeeklyCalendar.ts` y varios servicios
 * (`dataIntegrityService.ts`, `scheduleAdjustmentService.ts`,
 * `completeCalendarLessonService.ts`, `studentArchiveService.ts`) seguían
 * escribiendo `calendarLessons`/`recurrenceRules`/`recurrenceExceptions`
 * DIRECTAMENTE, por fuera de esta cola — una escritura común podía empezar
 * antes, la operación financiera podía guardar el vínculo, y la escritura
 * común podía terminar después y sobrescribirlo): esta cola pasa a ser la
 * ÚNICA puerta de escritura real para las tres colecciones, punto. Los
 * "save*Queued" exportados más abajo son ahora lo que TODO el código de
 * producción llama (`useWeeklyCalendar.ts` y los cuatro servicios) en vez de
 * los `save*` directos de `calendarStore.ts` — nunca se volvió obligatorio
 * esperar cada acción visual (`void saveXxxQueued(...)` sigue siendo válido
 * para las mutaciones no financieras), pero la ESCRITURA en sí siempre pasa
 * por esta misma cola serializada, así que el orden real de llegada decide,
 * nunca una carrera de "quién termina último".
 *
 * Garantías reales:
 *   - cada mutación encolada calcula SIEMPRE contra el último estado
 *     REALMENTE persistido (nunca contra `recurrenceRulesRef`/estado de
 *     React, que puede estar desactualizado frente a una escritura
 *     concurrente todavía no reflejada en React) — o, para las mutaciones
 *     comunes que ya traen su propio `next` calculado desde React, ese
 *     `next` se escribe de todas formas SERIALIZADO detrás de cualquier
 *     otra escritura en curso, nunca en paralelo;
 *   - la escritura es una única operación coordinada
 *     (`saveCalendarRecurrenceSnapshot`, `AsyncStorage.multiSet`) de las
 *     tres colecciones completas — lecciones, reglas y excepciones — nunca
 *     varias escrituras sueltas por regla;
 *   - corrección 2026-09-14, tercera ronda (punto 5: "la escritura de tres
 *     colecciones no es una transacción comprobada"): cada commit conserva
 *     el snapshot anterior (el mismo `current` recién leído), escribe el
 *     nuevo, RELEE y compara las tres colecciones completas contra lo
 *     esperado — si la escritura lanza o la verificación no coincide,
 *     intenta restaurar el snapshot anterior automáticamente, y el error
 *     final indica explícitamente si ese rollback también falló;
 *   - la función devuelve el snapshot RELEÍDO y VERIFICADO después de
 *     escribir — el llamador usa exactamente ESE resultado (nunca su propia
 *     copia capturada);
 *   - las mutaciones se serializan (misma cola atómica que
 *     `paymentsStore.ts`/`trainingBillingAgreementsStore.ts`): dos llamadas
 *     concurrentes nunca leen el mismo estado de partida ni se pisan entre
 *     sí — la segunda siempre ve ya reflejado lo que escribió la primera.
 *
 * El `mutate` pasado debe ser puro y debe LANZAR ante cualquier
 * precondición inválida (regla no encontrada, ya vinculada a otro acuerdo,
 * etc.) — la excepción se propaga tal cual a quien llamó
 * `applyRecurrenceMutation`, sin romper la cola para la próxima mutación.
 *
 * `createRecurrenceMutationQueue(adapter)` es la fábrica real, probable con
 * un adaptador en memoria que puede fallar a pedido (ver
 * `recurrenceMutationQueue.test.ts`); el singleton de módulo de abajo la
 * instancia una sola vez contra el adaptador real (`calendarStore.ts`).
 */
export interface RecurrenceSnapshot {
  lessons: CalendarLesson[];
  rules: RecurrenceRule[];
  exceptions: RecurrenceException[];
}

export interface RecurrenceSnapshotPersistenceAdapter {
  readSnapshot: () => Promise<RecurrenceSnapshot>;
  writeSnapshot: (next: RecurrenceSnapshot) => Promise<void>;
}

export interface RecurrenceMutationQueue {
  applyMutation: (mutate: (current: RecurrenceSnapshot) => RecurrenceSnapshot) => Promise<RecurrenceSnapshot>;
  readSnapshot: () => Promise<RecurrenceSnapshot>;
  resetForTests: () => void;
}

export type RecurrenceCommitFailureStage = 'write_failed' | 'verify_mismatch';

/**
 * Lanzada cuando el commit transaccional (escribir + releer y comparar)
 * falla — `rolledBack` indica si se pudo restaurar el snapshot anterior;
 * `rollbackError` sólo está presente cuando el rollback TAMBIÉN falló (el
 * peor caso: hay que informarlo con claridad, nunca ocultarlo).
 */
export class RecurrenceCommitError extends Error {
  readonly stage: RecurrenceCommitFailureStage;
  readonly rolledBack: boolean;
  readonly rollbackError?: string;

  constructor(message: string, stage: RecurrenceCommitFailureStage, rolledBack: boolean, rollbackError?: string) {
    super(message);
    this.name = 'RecurrenceCommitError';
    this.stage = stage;
    this.rolledBack = rolledBack;
    this.rollbackError = rollbackError;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}

function snapshotsEqual(a: RecurrenceSnapshot, b: RecurrenceSnapshot): boolean {
  return (
    JSON.stringify(a.lessons) === JSON.stringify(b.lessons) &&
    JSON.stringify(a.rules) === JSON.stringify(b.rules) &&
    JSON.stringify(a.exceptions) === JSON.stringify(b.exceptions)
  );
}

/**
 * Corrección 2026-09-14, tercera ronda (punto 5): commit transaccional real
 * — `AsyncStorage.multiSet` se describe como una sola operación, pero nunca
 * se verificaba que las tres colecciones quedaran exactamente como se
 * esperaba, ni se conservaba un snapshot para deshacer una escritura
 * parcial. Acá: escribir → releer → comparar completo; ante cualquier
 * discrepancia (la escritura lanzó, o lo releído no coincide), intentar
 * restaurar `previous` — y si ESE intento también falla, el error final lo
 * dice explícitamente (`rolledBack: false`, `rollbackError` con el motivo).
 */
async function commitWithVerifiedRollback(
  adapter: RecurrenceSnapshotPersistenceAdapter,
  previous: RecurrenceSnapshot,
  next: RecurrenceSnapshot
): Promise<RecurrenceSnapshot> {
  try {
    await adapter.writeSnapshot(next);
  } catch (writeError) {
    try {
      await adapter.writeSnapshot(previous);
      throw new RecurrenceCommitError(
        `No se pudo guardar el cambio de calendario — se restauró el estado anterior. (${errorMessage(writeError)})`,
        'write_failed',
        true
      );
    } catch (rollbackAttemptError) {
      if (rollbackAttemptError instanceof RecurrenceCommitError) throw rollbackAttemptError;
      throw new RecurrenceCommitError(
        `No se pudo guardar el cambio de calendario Y TAMPOCO se pudo restaurar el estado anterior — el almacenamiento puede haber quedado inconsistente. (${errorMessage(writeError)})`,
        'write_failed',
        false,
        errorMessage(rollbackAttemptError)
      );
    }
  }

  const verified = await adapter.readSnapshot();
  if (snapshotsEqual(verified, next)) {
    return verified;
  }

  try {
    await adapter.writeSnapshot(previous);
    throw new RecurrenceCommitError(
      'Lo guardado no coincide con lo esperado al releerlo — se restauró el estado anterior.',
      'verify_mismatch',
      true
    );
  } catch (rollbackAttemptError) {
    if (rollbackAttemptError instanceof RecurrenceCommitError) throw rollbackAttemptError;
    throw new RecurrenceCommitError(
      `Lo guardado no coincide con lo esperado al releerlo Y TAMPOCO se pudo restaurar el estado anterior — el almacenamiento puede haber quedado inconsistente. (rollback: ${errorMessage(rollbackAttemptError)})`,
      'verify_mismatch',
      false,
      errorMessage(rollbackAttemptError)
    );
  }
}

export function createRecurrenceMutationQueue(adapter: RecurrenceSnapshotPersistenceAdapter): RecurrenceMutationQueue {
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function applyMutation(
    mutate: (current: RecurrenceSnapshot) => RecurrenceSnapshot
  ): Promise<RecurrenceSnapshot> {
    const task = mutationQueue.then(
      () => {},
      () => {}
    ).then(async () => {
      const current = await adapter.readSnapshot();
      const next = mutate(current);
      return commitWithVerifiedRollback(adapter, current, next);
    });
    mutationQueue = task.then(
      () => {},
      () => {}
    );
    return task;
  }

  /** Sólo lectura, encolada detrás de cualquier mutación pendiente — nunca lee "a mitad" de una escritura en curso. */
  function readSnapshot(): Promise<RecurrenceSnapshot> {
    const task = mutationQueue.then(
      () => {},
      () => {}
    ).then(() => adapter.readSnapshot());
    mutationQueue = task.then(
      () => {},
      () => {}
    );
    return task;
  }

  function resetForTests(): void {
    mutationQueue = Promise.resolve();
  }

  return { applyMutation, readSnapshot, resetForTests };
}

// ---------------------------------------------------------------------------
// Adaptador real (calendarStore.ts/AsyncStorage) y cola de módulo singleton —
// mismo patrón que trainingBillingAgreementsStore.ts/paymentsStore.ts.
// ---------------------------------------------------------------------------

const realAdapter: RecurrenceSnapshotPersistenceAdapter = {
  readSnapshot: async () => {
    const [lessons, rules, exceptions] = await Promise.all([
      loadCalendarLessons(),
      loadRecurrenceRules(),
      loadRecurrenceExceptions(),
    ]);
    return {
      lessons: lessons ?? [],
      rules: rules ?? [],
      exceptions: exceptions ?? [],
    };
  },
  writeSnapshot: async (next) => {
    await saveCalendarRecurrenceSnapshot(next.lessons, next.rules, next.exceptions);
  },
};

const singleton = createRecurrenceMutationQueue(realAdapter);

export const applyRecurrenceMutation = singleton.applyMutation;
export const readRecurrenceSnapshot = singleton.readSnapshot;

/**
 * Sólo para pruebas: reinicia la cola para que una prueba nunca herede el
 * estado de la anterior. Nunca se llama desde código de producción.
 */
export const resetRecurrenceMutationQueueForTests = singleton.resetForTests;

// ---------------------------------------------------------------------------
// Corrección 2026-09-14, CUARTA ronda (a pedido de Joaquín — revisión
// independiente, punto 2: "la cola compartida todavía puede sobrescribir con
// snapshots viejos"): los antiguos `save*Queued(arrayYaCalculado)` —
// eliminados acá — encolaban la escritura (serializada, verificada, con
// rollback), pero el VALOR a escribir ya venía resuelto desde estado React
// (`nextRules`/`nextLessons` calculados contra un snapshot que podía estar
// desactualizado) — si una operación financiera vinculaba un acuerdo
// mientras esta escritura esperaba su turno, la escritura común, al llegar
// su turno, sobrescribía igual con su copia vieja y el vínculo desaparecía.
// Serializar el ORDEN de escritura nunca alcanza si el CONTENIDO de cada
// escritura no se recalcula contra lo realmente persistido.
//
// Reemplazo: intenciones PURAS que reciben `current` — el último snapshot
// REALMENTE persistido, leído recién al llegar su turno en la cola — y
// devuelven sólo el resultado de aplicar esa intención sobre `current`,
// nunca un array ya armado desde otro lado. Un upsert por identidad
// preserva automáticamente cualquier cambio concurrente en las otras
// colecciones (el spread de `...current`) y en la propia colección
// (nunca reemplaza el array completo, sólo el ítem que le corresponde).
//
// Para el caso general (una operación que necesita recalcular las TRES
// colecciones a la vez a partir de una lógica propia — reprogramar,
// cancelar, dividir series, etc.) el llamador usa `applyRecurrenceMutation`
// directamente, pasando su propia función pura `(current) => next` — nunca
// construye `next` por fuera y lo encola ya armado. Ver `persistRecurrenceMutation`
// en `useWeeklyCalendar.ts` para el patrón de referencia (recalcula el mismo
// plan puro tanto para la actualización optimista de React como para la
// escritura real, para no duplicar lógica).
// ---------------------------------------------------------------------------

// Corrección 2026-09-14, QUINTA ronda (a pedido de Joaquín — revisión
// independiente: "una escritura común todavía puede borrar el vínculo
// financiero de LA MISMA serie" — `upsertRecurrenceRuleQueued(rule)`
// reemplazaba la regla COMPLETA con un objeto ya armado desde afuera
// (React), así que una edición común encolada ANTES de que una operación
// financiera vinculara `trainingBillingAgreementId` a esa MISMA regla,
// pero cuyo turno real de escritura llegaba DESPUÉS, pisaba el vínculo al
// llegar su turno — perdía `trainingBillingAgreementId`, `activityKind`,
// o cualquier otro campo que otra operación hubiera agregado mientras
// tanto). Reemplazado por dos primitivas explícitas, nunca una sola
// "upsert" ambigua:
//   - `insertRecurrenceRuleIfMissingQueued` — para una regla GENUINAMENTE
//     NUEVA: inserta el objeto completo sólo si no existe; si ya existe
//     (reintento/doble toque), nunca la reemplaza con una fotografía
//     vieja — la deja tal cual (no-op).
//   - `patchRecurrenceRuleQueued` — para actualizar una regla YA
//     EXISTENTE: recibe una función de transformación pura
//     `(reglaPersistida) => reglaNueva`, aplicada sobre la regla REAL
//     persistida al llegar su turno — cualquier campo que el patch no
//     toque explícitamente (vínculo financiero, tipo de actividad,
//     límites/linaje de recurrencia, participantes, o cualquier campo
//     agregado por otra operación mientras tanto) sobrevive intacto,
//     porque el patch parte de esa regla real, nunca de una capturada por
//     fuera.

/** Inserta `rule` si no existe una regla con su `recurrenceId` — si ya existe (reintento), la deja intacta, nunca la reemplaza con una fotografía vieja. */
export function insertRecurrenceRuleIfMissingQueued(rule: RecurrenceRule): Promise<RecurrenceSnapshot> {
  return applyRecurrenceMutation((current) => {
    if (current.rules.some((candidate) => candidate.recurrenceId === rule.recurrenceId)) {
      return current;
    }
    return { ...current, rules: [...current.rules, rule] };
  });
}

/**
 * Aplica `patch` sobre la regla REALMENTE persistida con ese `recurrenceId`
 * al llegar su turno en la cola — nunca sobre una copia capturada por
 * fuera. Lanza si la regla no existe (nada que parchear); el llamador debe
 * asegurarse de que la regla exista antes de patchear.
 */
export function patchRecurrenceRuleQueued(
  recurrenceId: string,
  patch: (persistedRule: RecurrenceRule) => RecurrenceRule
): Promise<RecurrenceSnapshot> {
  return applyRecurrenceMutation((current) => {
    const existing = current.rules.find((candidate) => candidate.recurrenceId === recurrenceId);
    if (!existing) {
      throw new Error('No se encontró la serie recurrente.');
    }
    const patched = patch(existing);
    return {
      ...current,
      rules: current.rules.map((candidate) => (candidate.recurrenceId === recurrenceId ? patched : candidate)),
    };
  });
}

/** Inserta `lesson` si no existe una clase con su `id`, o la reemplaza si ya existe. */
export function upsertCalendarLessonQueued(lesson: CalendarLesson): Promise<RecurrenceSnapshot> {
  return applyRecurrenceMutation((current) => {
    const exists = current.lessons.some((candidate) => candidate.id === lesson.id);
    const lessons = exists
      ? current.lessons.map((candidate) => (candidate.id === lesson.id ? lesson : candidate))
      : [...current.lessons, lesson];
    return { ...current, lessons };
  });
}

/** Elimina la clase con ese `id` de `current.lessons`, si existe — nunca toca el resto. */
export function removeCalendarLessonQueued(lessonId: string): Promise<RecurrenceSnapshot> {
  return applyRecurrenceMutation((current) => ({
    ...current,
    lessons: current.lessons.filter((candidate) => candidate.id !== lessonId),
  }));
}

/** Inserta o reemplaza (por `recurrenceId`+`occurrenceKey`) una excepción — misma identidad que `upsertRecurrenceException`. */
export function upsertRecurrenceExceptionQueued(exception: RecurrenceException): Promise<RecurrenceSnapshot> {
  return applyRecurrenceMutation((current) => ({
    ...current,
    exceptions: upsertRecurrenceExceptionInCollection(current.exceptions, exception),
  }));
}
