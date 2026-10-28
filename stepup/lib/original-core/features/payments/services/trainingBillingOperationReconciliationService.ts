// Puerto VERBATIM del original (`src/features/payments/services/trainingBillingOperationReconciliationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { RecurrenceRule } from '../../calendar/types/index.ts';
import { applyRecurrenceMutation } from '../../calendar/hooks/recurrenceMutationQueue.ts';
import { planActivityKindThisAndFutureSplit } from '../../calendar/utils/calendarRecurrenceSplit.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules as loadPersistedRecurrenceRules } from '../../calendar/hooks/calendarStore.ts';
import { getTeacherAvailability, hydrateTeacherAvailability } from '../../calendar/hooks/teacherAvailabilityStore.ts';
import { getStudentsStore } from '../../students/hooks/studentStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { loadTrainingBillingAgreements, upsertTrainingBillingAgreement } from '../hooks/trainingBillingAgreementsStore.ts';
import { getPaymentsSnapshot } from '../hooks/paymentsStore.ts';
import { reconcileTrainingCharges, runTrainingBillingConfiguration, type TrainingBillingConfigurationDeps } from './trainingBillingConfigurationCoordinator.ts';
import { runTrainingChargeGenerationForPeriodRange } from './trainingChargeGenerationService.ts';
import { loadPendingTrainingBillingOperations, removePendingTrainingBillingOperation, type PendingTrainingBillingOperation, type PendingTrainingBillingOperationSplitPlan } from '../hooks/pendingTrainingBillingOperationsStore.ts';

/**
 * Corrección 2026-09-14, CUARTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 3: "recuperación incompleta y reintento de
 * conversión" — `reconcilePendingTrainingBillingOperations` vivía DENTRO de
 * `CalendarTabScreen.tsx`; como los tabs son lazy y la pantalla inicial es
 * Home, si la app se cerraba a mitad de una operación financiera de
 * entrenamiento, al reabrir no se recuperaba nada hasta que la profesora
 * entraba a Calendario — mientras tanto Home/Cobros podían mostrar un
 * estado incompleto): versión SIN React de las dependencias del
 * coordinador (`buildGlobalTrainingBillingDeps`/
 * `buildGlobalTrainingSeriesCreationDeps`, espejo exacto de las que arma
 * `CalendarTabScreen.tsx` para el mismo coordinador, pero usando
 * `getTeacherAvailability()`/`applyRecurrenceMutation`/etc. directamente en
 * vez de estado de React) y `reconcilePendingTrainingBillingOperations`,
 * pensada para correr en el arranque global de la app (`App.tsx`), ANTES
 * de `runTrainingChargeGeneration()` y DESPUÉS de hidratar alumnos/pagos —
 * nunca requiere que ningún sheet ni `CalendarTabScreen` esté montado.
 * Silenciosa si se recupera (nunca interrumpe el arranque); si vuelve a
 * fallar, el registro queda tal cual para el próximo intento (misma
 * apertura de la app, un cambio de día, o un reintento manual desde la
 * interfaz).
 */
function buildGlobalTrainingBillingDeps(extraRulePatch: Partial<RecurrenceRule> = {}): TrainingBillingConfigurationDeps {
  return {
    upsertAgreement: async (agreement) => {
      await upsertTrainingBillingAgreement(agreement);
    },
    readAgreement: async (id) => {
      const persisted = await loadTrainingBillingAgreements();
      return persisted.find((item) => item.id === id) ?? null;
    },
    linkRulesToAgreement: async (agreementId, recurrenceIds) => {
      await applyRecurrenceMutation((current) => {
        const idSet = new Set(recurrenceIds);
        let matched = 0;
        const rules = current.rules.map((candidate) => {
          if (!idSet.has(candidate.recurrenceId)) return candidate;
          matched += 1;
          return { ...candidate, ...extraRulePatch, trainingBillingAgreementId: agreementId };
        });
        if (matched !== recurrenceIds.length) {
          throw new Error('No se encontraron todas las reglas a vincular.');
        }
        return { ...current, rules };
      });
    },
    readLinkedAgreementIds: async (recurrenceIds) => {
      const persistedRules = await loadPersistedRecurrenceRules();
      const map: Record<string, string | null | undefined> = {};
      recurrenceIds.forEach((id) => {
        const found = (persistedRules ?? []).find((candidate) => candidate.recurrenceId === id);
        map[id] = found?.trainingBillingAgreementId ?? null;
      });
      return map;
    },
    generateCharges: async (agreementId, startPeriod, endPeriod) => {
      const [agreements, persistedRules, persistedLessons, persistedExceptions] = await Promise.all([
        loadTrainingBillingAgreements(),
        loadPersistedRecurrenceRules(),
        loadCalendarLessons(),
        loadRecurrenceExceptions(),
      ]);
      const agreement = agreements.find((item) => item.id === agreementId);
      if (!agreement) throw new Error('El acuerdo de entrenamiento no se encontró al generar los cargos.');
      const availability = getTeacherAvailability();
      const outcome = await runTrainingChargeGenerationForPeriodRange({
        agreements: [agreement],
        rules: persistedRules ?? [],
        lessons: persistedLessons ?? [],
        exceptions: persistedExceptions ?? [],
        availability,
        students: getStudentsStore().map((student) => ({
          id: student.id,
          status: student.status,
          statusChangeDate: getStudentProfile(student.id)?.statusChangeDate ?? null,
        })),
        startPeriod,
        endPeriod,
        createdAt: new Date().toISOString(),
      });
      return { createdChargeIds: outcome.createdChargeIds };
    },
    readExistingChargeIds: async (chargeIds) => {
      const ids = new Set(getPaymentsSnapshot().charges.map((charge) => charge.id));
      return chargeIds.filter((id) => ids.has(id));
    },
  };
}

/**
 * Variante para `create_series`: la regla nueva todavía puede no existir en
 * ningún lado — `linkRulesToAgreement` la INSERTA completa sólo si falta.
 *
 * Corrección 2026-09-14, QUINTA ronda (a pedido de Joaquín — revisión
 * independiente: "si la regla ya existe durante una recuperación, esto
 * puede reemplazarla con `newRule` guardada en una operación pendiente
 * antigua"): si la regla YA existe (un intento anterior la insertó, y
 * pudo haber sido editada después por una acción común — p. ej. el
 * nombre de la serie), esta reconciliación sólo le parchea el campo del
 * vínculo sobre la regla REAL persistida — nunca la reemplaza entera con
 * la fotografía `newRule` congelada en el registro pendiente, que podría
 * estar desactualizada frente a esa edición posterior. Espejo exacto de
 * `CalendarTabScreen.tsx`'s `buildTrainingSeriesCreationDeps`.
 */
function buildGlobalTrainingSeriesCreationDeps(newRule: RecurrenceRule): TrainingBillingConfigurationDeps {
  const shared = buildGlobalTrainingBillingDeps();
  return {
    ...shared,
    linkRulesToAgreement: async (agreementId) => {
      await applyRecurrenceMutation((current) => {
        const alreadyExists = current.rules.some((candidate) => candidate.recurrenceId === newRule.recurrenceId);
        const rules = alreadyExists
          ? current.rules.map((candidate) =>
              candidate.recurrenceId === newRule.recurrenceId
                ? { ...candidate, trainingBillingAgreementId: agreementId }
                : candidate
            )
          : [...current.rules, { ...newRule, trainingBillingAgreementId: agreementId }];
        return { ...current, rules };
      });
    },
  };
}

function depsForOperation(operation: PendingTrainingBillingOperation): TrainingBillingConfigurationDeps {
  if (operation.kind === 'create_series') {
    if (!operation.newRule) throw new Error('Operación create_series sin newRule — registro corrupto.');
    return buildGlobalTrainingSeriesCreationDeps(operation.newRule);
  }
  // 'convert_series': la regla YA existe (fue creada por la operación de
  // calendario que originó este registro) — `linkRulesToAgreement` sólo
  // necesita parchearla, nunca insertarla. Idempotente aunque el vínculo ya
  // se haya aplicado antes (mismo valor).
  return buildGlobalTrainingBillingDeps(operation.extraRulePatch ?? {});
}

/**
 * Corrección 2026-09-14, QUINTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 2: "'Esta y las siguientes' persiste el acuerdo
 * antes del diario durable" — "no alcanza con guardar sólo el ID de una
 * sucesora que todavía podría no existir"): `split_this_and_future` con
 * `splitPlan` (ronda 5/6 — ver `reconcilePendingTrainingBillingOperations`
 * para el formato de ronda 4, sin `splitPlan`) no pasa por
 * `runTrainingBillingConfiguration` — a diferencia de `create_series`/
 * `convert_series` (donde "vincular" es patchear/insertar una regla ya
 * definida), acá "vincular" significa REHACER el split entero si todavía
 * no ocurrió. Reconciliación dedicada, con el mismo orden que el flujo
 * interactivo (`CalendarTabScreen.tsx`): persistir+verificar acuerdo →
 * aplicar el split (función PURA `planActivityKindThisAndFutureSplit`,
 * idempotente si la sucesora YA existe con los mismos overrides) →
 * verificar el vínculo → generar+verificar los cargos. Distingue y
 * recupera cada estado intermedio con la MISMA secuencia, sin importar en
 * cuál haya quedado interrumpida la app:
 *   - diario guardado, acuerdo ausente y split ausente → hace las 3 fases;
 *   - acuerdo presente, split ausente → upsert es no-op, aplica el split;
 *   - acuerdo y split presentes, cargo ausente → ambos pasos anteriores son
 *     no-op, sólo genera/verifica el cargo;
 *   - todo presente pero el diario todavía existe → las 3 fases son no-op,
 *     sólo falta borrar el registro (se hace al final, siempre).
 *
 * `plan.asOfIso` ya llega normalizado (ronda 5 lo recibe de `createdAt`
 * mediante `backfillLegacySplitPlanAsOfIso`, en `pendingTrainingBillingOperationsStore.ts`)
 * — esta función nunca necesita distinguir de qué ronda vino.
 */
async function reconcileSplitThisAndFutureOperation(
  operation: PendingTrainingBillingOperation,
  plan: PendingTrainingBillingOperationSplitPlan
): Promise<boolean> {
  try {
    await upsertTrainingBillingAgreement(operation.agreement);
  } catch {
    return false;
  }
  const verifiedAgreement = (await loadTrainingBillingAgreements()).find((item) => item.id === operation.agreement.id);
  if (!verifiedAgreement || verifiedAgreement.monthlyFee !== operation.agreement.monthlyFee) {
    return false;
  }

  let commitResult: Awaited<ReturnType<typeof applyRecurrenceMutation>>;
  try {
    commitResult = await applyRecurrenceMutation((current) => planActivityKindThisAndFutureSplit(current, plan));
  } catch {
    return false;
  }

  const linkedSuccessor = commitResult.rules.find((candidate) => candidate.recurrenceId === plan.successorId);
  if (!linkedSuccessor || linkedSuccessor.trainingBillingAgreementId !== operation.agreement.id) {
    return false;
  }

  const deps = buildGlobalTrainingBillingDeps();
  const chargeResult = await reconcileTrainingCharges(
    deps,
    operation.agreement.id,
    operation.startPeriod,
    operation.endPeriod,
    operation.expectedChargeIds
  );
  return chargeResult.ok;
}

/**
 * Corrección 2026-09-14, SÉPTIMA ronda (a pedido de Joaquín — revisión
 * independiente: "compatibilidad con operaciones pendientes creadas por
 * las rondas anteriores"): una operación `split_this_and_future` de ronda
 * 4 (sin `splitPlan` — se guardaba DESPUÉS de crear y vincular la
 * sucesora) tiene EXACTAMENTE la misma forma real que `convert_series`
 * (`extraRulePatch`/`recurrenceIdsToLink`/`expectedChargeIds`, ninguna
 * intención para rehacer nada) — se reconcilia con el MISMO mecanismo
 * histórico seguro: `linkRulesToAgreement` de `buildGlobalTrainingBillingDeps`
 * sólo PARCHEA reglas que ya existen (nunca inserta), así que si la
 * sucesora esperada no está, el coordinador falla en `rule_link_failed` sin
 * fabricar nada — la operación queda pendiente, nunca se descarta.
 */
function depsForLegacySplitWithoutPlan(operation: PendingTrainingBillingOperation): TrainingBillingConfigurationDeps {
  return buildGlobalTrainingBillingDeps(operation.extraRulePatch ?? {});
}

/**
 * Reintenta, en orden, cada operación de facturación de entrenamiento que
 * haya quedado pendiente de una apertura anterior de la app interrumpida a
 * mitad de camino — mismo coordinador único (o la misma función pura de
 * split, para `split_this_and_future` con `splitPlan`), mismos ids
 * determinísticos ya persistidos en el registro (nunca los regenera).
 * Reconoce y recupera, con el mecanismo correcto para cada una, las TRES
 * formas legítimas que puede tener una entrada pendiente
 * `split_this_and_future` (ver `pendingTrainingBillingOperationsStore.ts`):
 * ronda 6 (`splitPlan` con `asOfIso`), ronda 5 (`splitPlan` sin `asOfIso`,
 * ya normalizado al leer) y ronda 4 (sin `splitPlan`, mecanismo histórico).
 * Nunca lanza: un fallo en una operación no impide reintentar el resto, ni
 * bloquea el arranque de la app.
 */
export async function reconcilePendingTrainingBillingOperations(): Promise<void> {
  await hydrateTeacherAvailability();
  let pending: PendingTrainingBillingOperation[];
  try {
    pending = await loadPendingTrainingBillingOperations();
  } catch {
    return;
  }
  for (const operation of pending) {
    try {
      if (operation.kind === 'split_this_and_future' && operation.splitPlan) {
        // Ronda 5/6 — `splitPlan` completo (asOfIso ya normalizado al
        // leer, si hacía falta) — puede rehacer el split entero.
        const ok = await reconcileSplitThisAndFutureOperation(operation, operation.splitPlan);
        if (ok) {
          await removePendingTrainingBillingOperation(operation.operationId);
        }
        continue;
      }
      const deps =
        operation.kind === 'split_this_and_future'
          ? depsForLegacySplitWithoutPlan(operation) // ronda 4: sin splitPlan.
          : depsForOperation(operation);
      const result = await runTrainingBillingConfiguration(
        {
          agreement: operation.agreement,
          startPeriod: operation.startPeriod,
          endPeriod: operation.endPeriod,
          recurrenceIdsToLink: operation.recurrenceIdsToLink,
          expectedChargeIds: operation.expectedChargeIds,
        },
        deps
      );
      if (result.ok) {
        await removePendingTrainingBillingOperation(operation.operationId);
      }
    } catch {
      // Deja el registro para el próximo intento — nunca lo descarta por un
      // fallo real (de red, de storage, o un registro corrupto).
    }
  }
}
