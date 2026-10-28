// Puerto VERBATIM del original (`src/features/payments/hooks/pendingTrainingBillingOperationsStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { PendingRecurrenceDraft, RecurrenceRule } from '../../calendar/types/index.ts';
import type { TrainingBillingAgreement } from '../types/index.ts';

/**
 * Corrección 2026-09-14, TERCERA ronda (a pedido de Joaquín — revisión
 * INDEPENDIENTE, punto 2: "identidad después de cerrar la app" — los ids
 * generados en refs de `NewCalendarLessonSheet.tsx` sólo son estables
 * mientras el panel sigue montado; si la app se cierra a mitad de una
 * creación de serie de entrenamiento, al reabrir se perdería toda
 * posibilidad de reconocer y continuar la MISMA operación): registro
 * PERSISTIDO de una operación de facturación de entrenamiento todavía no
 * confirmada — se escribe ANTES de tocar el acuerdo/la regla, y se borra
 * recién cuando el coordinador (`runTrainingBillingConfiguration`) confirma
 * éxito completo. Mientras exista un registro para un `operationId`, la
 * MISMA operación (mismo acuerdo, misma regla nueva, mismos ids
 * determinísticos) puede reconocerse y reintentarse — al volver a abrir la
 * app (`reconcilePendingTrainingBillingOperations`, más abajo) o al
 * reintentar manualmente desde la UI — sin depender de que ningún
 * componente siga montado.
 *
 * Nunca es la fuente de verdad del acuerdo/la regla en sí (eso sigue siendo
 * `trainingBillingAgreementsStore.ts`/`recurrenceMutationQueue.ts`) — es
 * sólo la "libreta de operaciones en curso", para poder reconocer una
 * creación abandonada a mitad de camino y terminarla (o limpiarla) de forma
 * segura e idempotente.
 */
export const PENDING_TRAINING_BILLING_OPERATIONS_STORAGE_KEY =
  '@teacherflow/pending_training_billing_operations';

/**
 * Corrección 2026-09-14, CUARTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 3: "recuperación incompleta y reintento de
 * conversión" — "extendé el registro durable de operaciones si es
 * necesario para conversiones y splits; no debe cubrir solamente
 * create_series"): además de crear una serie nueva (`create_series`), este
 * mismo registro ahora también cubre "Toda la serie" (`convert_series`) y
 * "Esta y las siguientes" (`split_this_and_future`) — las tres pasan por el
 * MISMO coordinador (`runTrainingBillingConfiguration`) y por lo tanto por
 * la MISMA reconciliación global (`trainingBillingOperationReconciliationService.ts`).
 */
export type PendingTrainingBillingOperationKind = 'create_series' | 'convert_series' | 'split_this_and_future';

/**
 * Corrección 2026-09-14, QUINTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 2: "'Esta y las siguientes' persiste el acuerdo
 * antes del diario durable" — "no alcanza con guardar sólo el ID de una
 * sucesora que todavía podría no existir"): intención COMPLETA para
 * REHACER el split de "Esta y las siguientes" desde cero — la
 * reconciliación global necesita poder crear la sucesora si la app se
 * cerró ANTES de que existiera, no sólo reconciliar el cargo asumiendo que
 * ya existe. Mismos campos que recibe `planActivityKindThisAndFutureSplit`
 * (`calendarRecurrenceSplit.ts`), la función pura real que aplica el split
 * — la reconciliación nunca reimplementa esta lógica por su cuenta.
 */
export interface PendingTrainingBillingOperationSplitPlan {
  originalRecurrenceId: string;
  studentId: string;
  effectiveDate: string;
  successorId: string;
  draft: PendingRecurrenceDraft;
  successorOverrides: Partial<RecurrenceRule>;
  /**
   * Corrección 2026-09-14, SEXTA ronda (a pedido de Joaquín — revisión
   * independiente: "el split durable deja de poder recuperarse al cambiar
   * el día"): instante ISO en que la profesora confirmó y la operación
   * todavía era válida — congelado acá, nunca recalculado con `new Date()`
   * al reconciliar. La reconciliación (días o meses después) reproduce
   * EXACTAMENTE la misma decisión de "hoy"/serie canónica que tomó la
   * validación original, sin importar el reloj del dispositivo.
   */
  asOfIso: string;
}

/**
 * Corrección 2026-09-14, SEXTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 2: "dos splits que comparten acuerdo pueden
 * sobrescribir su registro pendiente" — un mismo `agreement.id` puede
 * pertenecer al linaje de varias sucesoras distintas de "Esta y las
 * siguientes" (cada conversión reutiliza el acuerdo YA vinculado a la
 * serie si existe); usar `agreement.id` como `operationId` hacía que la
 * segunda operación pisara el registro pendiente de la primera vía el
 * upsert-por-`operationId` de este store): para `create_series`/
 * `convert_series` la equivalencia operación↔acuerdo es 1:1 real (una
 * creación siempre trae un acuerdo recién generado exclusivo para ella;
 * una conversión de "Toda la serie" está atada a un único
 * `training_agreement_<recurrenceId>` por regla) — sus `operationId`
 * siguen siendo `agreement.id`, sin cambios. Para `split_this_and_future`
 * `operationId` es un id compuesto propio de la operación
 * (`buildSplitThisAndFutureOperationId`, más abajo) — nunca el id del
 * acuerdo, que puede repetirse entre splits.
 */
export function buildSplitThisAndFutureOperationId(input: {
  originalRecurrenceId: string;
  effectiveDate: string;
  successorId: string;
  agreementId: string;
}): string {
  return `split_this_and_future_${input.originalRecurrenceId}_${input.effectiveDate}_${input.successorId}_${input.agreementId}`;
}

/**
 * Corrección 2026-09-14, SÉPTIMA ronda (a pedido de Joaquín — revisión
 * independiente: "compatibilidad con operaciones pendientes creadas por
 * las rondas anteriores"): versión explícita del esquema de un registro
 * pendiente — ausente en toda entrada de ronda 4 o 5 (anteriores a este
 * campo). Las evoluciones futuras del formato deben incrementarla, para
 * nunca más depender de inferencias frágiles por forma. La lectura acepta
 * SIEMPRE: entradas sin `schemaVersion` (rondas 4/5, reconocidas por forma
 * — ver `isPendingTrainingBillingOperation`), la versión actual, y
 * cualquier versión futura desconocida cuya forma siga siendo reconocible
 * — nunca se descartan sólo por el número de versión.
 */
export const PENDING_TRAINING_BILLING_OPERATION_SCHEMA_VERSION = 1;

export interface PendingTrainingBillingOperation {
  /** Ver `PENDING_TRAINING_BILLING_OPERATION_SCHEMA_VERSION`. Ausente en registros de rondas 4/5. */
  schemaVersion?: number;
  /**
   * Determinístico. Para `create_series`/`convert_series` es igual a
   * `agreement.id` (equivalencia 1:1 real, ver comentario arriba). Para
   * `split_this_and_future` es `buildSplitThisAndFutureOperationId(...)` —
   * NUNCA `agreement.id` por sí solo, porque distintas sucesoras pueden
   * compartir el mismo acuerdo. Las entradas de ronda 4/5 (anteriores a
   * este cambio) pueden tener `operationId === agreement.id` — se
   * conservan tal cual, nunca se recalculan retroactivamente.
   */
  operationId: string;
  kind: PendingTrainingBillingOperationKind;
  agreement: TrainingBillingAgreement;
  /** Sólo `create_series`: la regla NUEVA exacta a insertar — todavía no existe en ningún lado hasta que el coordinador confirma el vínculo. */
  newRule?: RecurrenceRule;
  /**
   * Sólo `convert_series`: cambio adicional (p. ej. `{ activityKind:
   * 'training' }`) que la MISMA escritura atómica del vínculo debe aplicar
   * sobre la regla ya existente — nunca se persiste `activityKind:
   * 'training'` por separado, antes de confirmar el acuerdo (mismo
   * criterio que ya exige la escritura interactiva).
   */
  extraRulePatch?: Partial<RecurrenceRule>;
  /** Sólo `split_this_and_future`: intención completa para rehacer el split si la sucesora todavía no existe. */
  splitPlan?: PendingTrainingBillingOperationSplitPlan;
  recurrenceIdsToLink: string[];
  expectedChargeIds: string[];
  startPeriod: string;
  endPeriod: string;
  createdAt: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Forma mínima real de un `splitPlan` — deliberadamente NO exige
 * `asOfIso` acá: una entrada de ronda 5 tiene el resto del plan completo
 * pero todavía no tenía ese campo (se agregó en ronda 6). Se normaliza por
 * separado (`backfillLegacySplitPlanAsOfIso`, abajo) — nunca se descarta
 * una entrada reconocible sólo porque le falta un campo agregado después.
 */
function isSplitPlanShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Record<string, unknown>;
  return (
    isNonEmptyString(plan.originalRecurrenceId) &&
    isNonEmptyString(plan.studentId) &&
    isNonEmptyString(plan.effectiveDate) &&
    isNonEmptyString(plan.successorId) &&
    typeof plan.draft === 'object' &&
    plan.draft !== null &&
    typeof plan.successorOverrides === 'object' &&
    plan.successorOverrides !== null
  );
}

/**
 * Corrección 2026-09-14, SÉPTIMA ronda (a pedido de Joaquín — revisión
 * independiente: "compatibilidad con operaciones pendientes creadas por
 * las rondas anteriores"): reconoce, sin descartar, los TRES formatos que
 * pueden existir legítimamente en AsyncStorage para `split_this_and_future`:
 *   - ronda 6 (actual): `splitPlan` completo, con `asOfIso`;
 *   - ronda 5: `splitPlan` completo, SIN `asOfIso` (se agregó recién en
 *     ronda 6) — se acepta acá y se normaliza después, nunca se descarta
 *     sólo por faltarle ese campo;
 *   - ronda 4: SIN `splitPlan` — se guardaba DESPUÉS de crear y vincular la
 *     sucesora, con la misma forma que `convert_series`
 *     (`extraRulePatch`/`recurrenceIdsToLink`/`expectedChargeIds` solos) —
 *     reconciliable con el mecanismo histórico seguro (ver
 *     `trainingBillingOperationReconciliationService.ts`), nunca fabrica
 *     una serie si la sucesora esperada no existe.
 * `schemaVersion` nunca se usa para RECHAZAR una entrada — sólo estas
 * comprobaciones de forma deciden si es reconocible.
 */
function isPendingTrainingBillingOperation(value: unknown): value is PendingTrainingBillingOperation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !(
      isNonEmptyString(candidate.operationId) &&
      (candidate.kind === 'create_series' || candidate.kind === 'convert_series' || candidate.kind === 'split_this_and_future') &&
      typeof candidate.agreement === 'object' &&
      candidate.agreement !== null &&
      Array.isArray(candidate.recurrenceIdsToLink) &&
      Array.isArray(candidate.expectedChargeIds) &&
      isNonEmptyString(candidate.startPeriod) &&
      isNonEmptyString(candidate.endPeriod) &&
      isNonEmptyString(candidate.createdAt)
    )
  ) {
    return false;
  }
  if (candidate.kind === 'create_series') {
    return typeof candidate.newRule === 'object' && candidate.newRule !== null;
  }
  if (candidate.kind === 'split_this_and_future' && candidate.splitPlan !== undefined) {
    // Ronda 5 o 6 — `splitPlan` presente (con o sin `asOfIso` todavía).
    return isSplitPlanShape(candidate.splitPlan);
  }
  // 'convert_series', o 'split_this_and_future' de ronda 4 (sin
  // `splitPlan`): misma forma real, mismo criterio de aceptación.
  return candidate.extraRulePatch === undefined || (typeof candidate.extraRulePatch === 'object' && candidate.extraRulePatch !== null);
}

/**
 * Normalización EN MEMORIA de una entrada de ronda 5 reconocida
 * (`splitPlan` completo sin `asOfIso`): usa `createdAt` — capturado
 * durante la operación original, la mejor fuente histórica disponible —
 * como `asOfIso`. Nunca reescribe el registro persistido sólo por esto (la
 * próxima escritura real ocurre recién si la operación se completa o se
 * actualiza por otro motivo genuino); nunca toca `operationId`.
 */
function backfillLegacySplitPlanAsOfIso(operation: PendingTrainingBillingOperation): PendingTrainingBillingOperation {
  if (operation.kind !== 'split_this_and_future' || !operation.splitPlan || operation.splitPlan.asOfIso) {
    return operation;
  }
  return {
    ...operation,
    splitPlan: { ...operation.splitPlan, asOfIso: operation.createdAt },
  };
}

/** Parseo puro, separado de AsyncStorage para poder probarlo directamente. Una entrada corrupta se descarta sin invalidar el resto; una entrada histórica reconocible nunca se descarta — se normaliza. */
export function parsePersistedPendingTrainingBillingOperations(raw: string | null): PendingTrainingBillingOperation[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isPendingTrainingBillingOperation).map(backfillLegacySplitPlanAsOfIso);
}

// Misma cola secuencial mínima que el resto de los stores de este módulo —
// evita que dos escrituras concurrentes a esta libreta se pisen entre sí.
let writeQueue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<PendingTrainingBillingOperation[]> {
  const raw = await AsyncStorage.getItem(PENDING_TRAINING_BILLING_OPERATIONS_STORAGE_KEY);
  return parsePersistedPendingTrainingBillingOperations(raw);
}

async function writeAll(entries: PendingTrainingBillingOperation[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_TRAINING_BILLING_OPERATIONS_STORAGE_KEY, JSON.stringify(entries));
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(
    () => {},
    () => {}
  ).then(task);
  writeQueue = result.then(
    () => {},
    () => {}
  );
  return result;
}

export function loadPendingTrainingBillingOperations(): Promise<PendingTrainingBillingOperation[]> {
  return enqueue(readAll);
}

/** Upsert por `operationId` — reintentar la misma operación nunca duplica su registro. */
export function savePendingTrainingBillingOperation(operation: PendingTrainingBillingOperation): Promise<void> {
  return enqueue(async () => {
    const current = await readAll();
    const next = current.some((entry) => entry.operationId === operation.operationId)
      ? current.map((entry) => (entry.operationId === operation.operationId ? operation : entry))
      : [...current, operation];
    await writeAll(next);
  });
}

export function removePendingTrainingBillingOperation(operationId: string): Promise<void> {
  return enqueue(async () => {
    const current = await readAll();
    await writeAll(current.filter((entry) => entry.operationId !== operationId));
  });
}

export function resetPendingTrainingBillingOperationsForTests(): void {
  writeQueue = Promise.resolve();
}
