// Puerto VERBATIM del original (`src/features/payments/services/trainingBillingConfigurationCoordinator.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { TrainingBillingAgreement } from '../types/index.ts';

/**
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural de
 * `aba94e0`, puntos 2 y 3: "EL ID NUEVO NO QUEDA VINCULADO A LA REGLA REAL"
 * / "PROHIBIDO FIRE-AND-FORGET EN OPERACIONES FINANCIERAS"): coordinador
 * ÚNICO y real para las operaciones que antes escribían el acuerdo con
 * `void upsertTrainingBillingAgreement(...)` sin esperar ni verificar nada
 * (crear una serie de entrenamiento, convertir una serie —ambos alcances—,
 * configurar una serie histórica). Nunca hay un segundo camino que escriba
 * `TrainingBillingAgreement`/vincule `RecurrenceRule.trainingBillingAgreementId`
 * por fuera de acá.
 *
 * Corrección 2026-09-14, segunda ronda (a pedido de Joaquín — revisión
 * INDEPENDIENTE de la corrección anterior, que encontró fallas reales
 * todavía presentes): dos cambios de contrato respecto de la primera
 * versión de este coordinador —
 *   1. `recurrenceIdsToLink`/`expectedChargeIds` pasan a ser parte del PLAN
 *      inmutable (antes vivían sólo como argumento de la fábrica de
 *      dependencias, invisibles para el coordinador) — el plan ahora
 *      declara explícitamente TODOS los `recurrenceId` que deben terminar
 *      vinculados y los ids determinísticos de cargo que se esperan, para
 *      poder verificar los DOS conjuntos completos, nunca sólo el primer
 *      elemento de cada uno.
 *   2. la verificación final de cargos deja de comparar
 *      `generated.createdChargeIds.every(...)` (vacuamente `true` sobre un
 *      array vacío — "cero cargos generados" pasaba como éxito aunque
 *      correspondiera generar alguno) y pasa a comparar
 *      `plan.expectedChargeIds` (calculados ANTES de ejecutar, contra el
 *      plan de cargos real) contra lo que quedó realmente persistido — cero
 *      cargos sólo es éxito cuando `expectedChargeIds` ya era `[]` de
 *      entrada (el plan determinó legítimamente cero obligaciones) o cuando
 *      todos esos ids ya existían de una corrida anterior.
 *
 * Orden seguro, exactamente el pedido:
 *   1. el plan ya llega armado (inmutable) desde el llamador — agreement,
 *      TODOS los recurrenceId a vincular y los ids de cargo esperados,
 *      todos calculados de antemano contra un snapshot puro.
 *   2. persistir el acuerdo (cola atómica del store).
 *   3. releer y verificar el acuerdo persistido.
 *   4. vincular la regla/linaje real (inyectado — requiere el store de
 *      calendario, fuera de este módulo) y releer/verificar que TODOS los
 *      `recurrenceIdsToLink` quedaron con el acuerdo correcto.
 *   5. generar cargos ÚNICAMENTE después de verificar 2-4, y releer/
 *      verificar que TODOS los `expectedChargeIds` quedaron persistidos.
 *   6. el llamador decide cerrar la interfaz SÓLO si `result.ok`.
 *
 * Recuperable e idempotente en vez de rollback distribuido: el id del
 * acuerdo es siempre el mismo para la MISMA regla/serie/fecha efectiva
 * (determinístico, ver los puntos de entrada reales en
 * `NewCalendarLessonSheet.tsx`/`CalendarTabScreen.tsx`/
 * `TrainingBillingAgreementSheet.tsx`), así que reintentar esta función
 * completa tras CUALQUIER fallo es siempre seguro: `upsertAgreement` es un
 * upsert (nunca duplica), `linkRulesToAgreement` es idempotente por
 * construcción (mismo id, mismo resultado), y la generación de cargos es
 * idempotente por `buildTrainingChargeId`. Nunca puede quedar "una regla sin
 * acuerdo" (la regla sólo se toca DESPUÉS de verificar que el acuerdo ya
 * quedó persistido); un acuerdo puede quedar transitoriamente sin ninguna
 * regla que lo referencie si el paso de vinculación falla, pero eso es
 * inofensivo (nunca genera cargos por sí solo, ninguna regla lo señala
 * todavía) y se autorepara en el siguiente reintento con el mismo id.
 */

export interface TrainingBillingConfigurationPlan {
  agreement: TrainingBillingAgreement;
  /** Períodos (YYYY-MM) para los que corresponde generar cuotas en esta operación — inclusive, ambos extremos. */
  startPeriod: string;
  endPeriod: string;
  /** TODOS los `recurrenceId` reales que deben terminar con `trainingBillingAgreementId === agreement.id` — se verifican todos, nunca sólo el primero. */
  recurrenceIdsToLink: string[];
  /**
   * Ids determinísticos de los cargos que este plan espera que existan al
   * terminar (`buildTrainingChargeId`), calculados de antemano contra el
   * plan de cargos real (ver `planTrainingChargeGenerationForPeriodRange`) —
   * ya excluye los omitidos por precio inválido. Un array vacío es un plan
   * válido cuando genuinamente no corresponde generar ninguna cuota (nunca
   * se confunde con "no se pudo calcular").
   */
  expectedChargeIds: string[];
}

export interface TrainingBillingConfigurationDeps {
  /** Persiste el acuerdo vía la cola atómica del store (`upsertTrainingBillingAgreement`). Debe lanzar si falla. */
  upsertAgreement: (agreement: TrainingBillingAgreement) => Promise<void>;
  /** Relee el acuerdo YA persistido (nunca el objeto en memoria que se acaba de construir) para verificar. */
  readAgreement: (id: string) => Promise<TrainingBillingAgreement | null>;
  /**
   * Vincula (y persiste, en una única escritura serializada real — ver
   * `recurrenceMutationQueue.ts`) `trainingBillingAgreementId` en TODAS las
   * reglas de `recurrenceIdsToLink` a la vez. Debe lanzar si no puede
   * vincular alguna.
   */
  linkRulesToAgreement: (agreementId: string, recurrenceIds: string[]) => Promise<void>;
  /** Relee las reglas YA persistidas y devuelve, para cada `recurrenceId` pedido, su `trainingBillingAgreementId` real (o null/undefined si no quedó vinculada). */
  readLinkedAgreementIds: (recurrenceIds: string[]) => Promise<Record<string, string | null | undefined>>;
  /** Genera los cargos del rango de períodos — motor real, idempotente, usando EXCLUSIVAMENTE reglas ya persistidas y verificadas (nunca una copia capturada de antemano). Debe lanzar si falla la persistencia. */
  generateCharges: (agreementId: string, startPeriod: string, endPeriod: string) => Promise<{ createdChargeIds: string[] }>;
  /** Relee cuáles de los ids dados existen realmente ya persistidos, para verificar la generación. */
  readExistingChargeIds: (chargeIds: string[]) => Promise<string[]>;
}

export type TrainingBillingConfigurationStage =
  | 'agreement_persist_failed'
  | 'agreement_verify_failed'
  | 'rule_link_failed'
  | 'rule_verify_failed'
  | 'charge_generation_failed'
  | 'charge_verify_failed';

export interface TrainingBillingConfigurationResult {
  ok: boolean;
  /** Presente sólo cuando `ok` es `false` — en qué paso exacto falló. */
  stage?: TrainingBillingConfigurationStage;
  /** Mensaje legible para mostrar en la interfaz — nunca se cierra el panel con esto presente. */
  error?: string;
  createdChargeIds: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}

/**
 * Único coordinador real — ver comentario del archivo. Pura salvo por las
 * dependencias inyectadas (nunca toca AsyncStorage ni ningún store
 * directamente), así que es 100% probable con dependencias falsas que
 * fallan a pedido en cualquier paso (ver
 * `trainingBillingConfigurationCoordinator.test.ts`).
 */
export async function runTrainingBillingConfiguration(
  plan: TrainingBillingConfigurationPlan,
  deps: TrainingBillingConfigurationDeps
): Promise<TrainingBillingConfigurationResult> {
  // 2. Persistir el acuerdo.
  try {
    await deps.upsertAgreement(plan.agreement);
  } catch (error) {
    return { ok: false, stage: 'agreement_persist_failed', error: errorMessage(error), createdChargeIds: [] };
  }

  // 3. Releer y verificar el acuerdo.
  let verifiedAgreement: TrainingBillingAgreement | null;
  try {
    verifiedAgreement = await deps.readAgreement(plan.agreement.id);
  } catch (error) {
    return { ok: false, stage: 'agreement_verify_failed', error: errorMessage(error), createdChargeIds: [] };
  }
  if (
    !verifiedAgreement ||
    verifiedAgreement.monthlyFee !== plan.agreement.monthlyFee ||
    verifiedAgreement.startPeriod !== plan.agreement.startPeriod ||
    verifiedAgreement.pendingMonthlyFee !== plan.agreement.pendingMonthlyFee ||
    verifiedAgreement.pendingMonthlyFeeEffectiveFrom !== plan.agreement.pendingMonthlyFeeEffectiveFrom
  ) {
    return {
      ok: false,
      stage: 'agreement_verify_failed',
      error: 'El acuerdo no se guardó correctamente — no coincide con lo verificado al releerlo.',
      createdChargeIds: [],
    };
  }

  // 4a. Vincular la regla/linaje real — TODAS las reglas del plan a la vez.
  try {
    await deps.linkRulesToAgreement(plan.agreement.id, plan.recurrenceIdsToLink);
  } catch (error) {
    // El acuerdo YA quedó persistido y verificado — queda "huérfano"
    // (ninguna regla lo referencia todavía) de forma transitoria, nunca
    // genera cargos por sí solo, y el mismo id se reutiliza en el
    // reintento (determinístico) — nunca un acuerdo duplicado.
    return { ok: false, stage: 'rule_link_failed', error: errorMessage(error), createdChargeIds: [] };
  }

  // 4b. Releer y verificar la vinculación — TODOS los recurrenceId del
  // plan, nunca sólo el primero que aparezca.
  let linkedIds: Record<string, string | null | undefined>;
  try {
    linkedIds = await deps.readLinkedAgreementIds(plan.recurrenceIdsToLink);
  } catch (error) {
    return { ok: false, stage: 'rule_verify_failed', error: errorMessage(error), createdChargeIds: [] };
  }
  const allLinked = plan.recurrenceIdsToLink.every((id) => linkedIds[id] === plan.agreement.id);
  if (!allLinked) {
    return {
      ok: false,
      stage: 'rule_verify_failed',
      error: 'La serie no quedó vinculada al acuerdo — no coincide con lo verificado al releerla.',
      createdChargeIds: [],
    };
  }

  // 5. Generar y verificar cargos — fase común reutilizable (ver
  // `reconcileTrainingCharges`, más abajo).
  const chargeResult = await reconcileTrainingCharges(
    deps,
    plan.agreement.id,
    plan.startPeriod,
    plan.endPeriod,
    plan.expectedChargeIds
  );
  if (!chargeResult.ok) {
    return {
      ok: false,
      stage: chargeResult.stage,
      error: chargeResult.error,
      createdChargeIds: chargeResult.createdChargeIds,
    };
  }

  // 6. Éxito — el llamador cierra la interfaz recién ahora.
  return { ok: true, createdChargeIds: chargeResult.createdChargeIds };
}

export interface TrainingChargeReconciliationDeps {
  generateCharges: (agreementId: string, startPeriod: string, endPeriod: string) => Promise<{ createdChargeIds: string[] }>;
  readExistingChargeIds: (chargeIds: string[]) => Promise<string[]>;
}

export interface TrainingChargeReconciliationResult {
  ok: boolean;
  stage?: 'charge_generation_failed' | 'charge_verify_failed';
  error?: string;
  createdChargeIds: string[];
}

/**
 * Corrección 2026-09-14, TERCERA ronda (a pedido de Joaquín — revisión
 * INDEPENDIENTE, punto 3: "no mantengas esta ruta [Esta y las siguientes]
 * como una implementación financiera manual separada. Debe reutilizar el
 * mismo coordinador o una fase común de reconciliación verificada"):
 * extraído de los pasos 5a/5b de `runTrainingBillingConfiguration` para que
 * el split ("Esta clase y las siguientes", en `CalendarTabScreen.tsx`) —
 * que no puede pasar por el coordinador completo porque su paso de
 * "vincular" no es una operación determinística reintentable genérica,
 * sino un split real — reutilice EXACTAMENTE esta misma fase de generación
 * + verificación, nunca una reimplementación manual con su propio
 * `try/catch`/`every(...)` suelto. Genera cargos y releé/compara TODOS los
 * `expectedChargeIds` contra lo persistido — cero esperados es éxito
 * legítimo sólo cuando el plan ya lo determinó así de antemano (nunca un
 * `[].every(...)` vacío disfrazado de verificación).
 */
export async function reconcileTrainingCharges(
  deps: TrainingChargeReconciliationDeps,
  agreementId: string,
  startPeriod: string,
  endPeriod: string,
  expectedChargeIds: string[]
): Promise<TrainingChargeReconciliationResult> {
  let generated: { createdChargeIds: string[] };
  try {
    generated = await deps.generateCharges(agreementId, startPeriod, endPeriod);
  } catch (error) {
    // La configuración previa (acuerdo + vínculo) ya quedó persistida y
    // verificada — se conserva. Un reintento generará únicamente los
    // cargos que todavía falten (idempotente por buildTrainingChargeId).
    return { ok: false, stage: 'charge_generation_failed', error: errorMessage(error), createdChargeIds: [] };
  }

  // Releer y verificar TODOS los cargos ESPERADOS (nunca sólo los que el
  // motor de generación dice haber creado en esta corrida puntual — un
  // `[].every(...)` sobre cero cargos creados no prueba nada si se
  // esperaban varios). Cero esperados es éxito legítimo sólo cuando ya se
  // determinó así de antemano.
  let existingIds: string[];
  try {
    existingIds = await deps.readExistingChargeIds(expectedChargeIds);
  } catch (error) {
    return { ok: false, stage: 'charge_verify_failed', error: errorMessage(error), createdChargeIds: generated.createdChargeIds };
  }
  const existingIdSet = new Set(existingIds);
  const allVerified = expectedChargeIds.every((id) => existingIdSet.has(id));
  if (!allVerified) {
    return {
      ok: false,
      stage: 'charge_verify_failed',
      error: 'Algunos cargos esperados no se pudieron verificar al releerlos.',
      createdChargeIds: generated.createdChargeIds,
    };
  }

  return { ok: true, createdChargeIds: generated.createdChargeIds };
}
