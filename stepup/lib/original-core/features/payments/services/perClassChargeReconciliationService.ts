// Puerto VERBATIM del original (`src/features/payments/services/perClassChargeReconciliationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson } from '../../new-class/types/index.ts';
// Fase 6D: se importa del módulo neutral `savedLessonsStore.ts`, nunca de
// `useSaveClass.ts` — ese hook importa `reconcilePerClassCharges` de este
// mismo archivo, así que importar el store desde ahí cerraba un ciclo real
// de imports ("Require cycle" reportado por Metro).
import { getSavedLessons, hydrateSavedLessons } from '../../new-class/hooks/savedLessonsStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { planPerClassChargesForLessons, type PerClassChargeSkipped, type StudentBillingLookup } from '../utils/perClassChargeGenerationPlan.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

export interface PerClassChargeReconciliationOutcome {
  createdChargeIds: string[];
  skipped: PerClassChargeSkipped[];
}

/** Sólo lo que esta pieza necesita del store de pagos — inyectable para probar la cola real sin AsyncStorage. */
export type PerClassChargeReconciliationStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: PerClassChargeReconciliationStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

function lookupBilling(studentId: string): StudentBillingLookup | null {
  const profile = getStudentProfile(studentId);
  return profile ? { billingType: profile.billingType, billingPlan: profile.billingPlan, price: profile.price } : null;
}

/**
 * Crea los cargos "por clase" que falten para `lessons`. El plan se calcula
 * DENTRO del updater de `applyMutation`, contra `current.charges` (el
 * estado ya confirmado en ese momento de la cola), no contra un snapshot
 * leído antes de entrar a la mutación — así dos llamadas concurrentes
 * (guardar una clase mientras la reconciliación de arranque todavía está
 * corriendo, por ejemplo) nunca planifican ambas sobre el mismo estado
 * "vacío" y terminan creando el mismo cargo dos veces: la cola interna del
 * store serializa las escrituras.
 */
export async function reconcileChargesForLessons(
  lessons: SavedLesson[],
  getProfile: (studentId: string) => StudentBillingLookup | null,
  createdAt: string,
  deps: PerClassChargeReconciliationStoreDeps = defaultStoreDeps
): Promise<PerClassChargeReconciliationOutcome> {
  await deps.hydrate();

  let outcome: PerClassChargeReconciliationOutcome = { createdChargeIds: [], skipped: [] };

  await deps.applyMutation((current) => {
    const plan = planPerClassChargesForLessons({
      lessons,
      getProfile,
      existingCharges: current.charges,
      createdAt,
    });
    outcome = { createdChargeIds: plan.toCreate.map((charge) => charge.id), skipped: plan.skipped };
    if (plan.toCreate.length === 0) return current;
    return { ...current, charges: [...current.charges, ...plan.toCreate] };
  });

  return outcome;
}

/**
 * Recorre TODAS las clases pedagógicas guardadas y crea los cargos "por
 * clase" que falten — cubre dos casos con el mismo código, a propósito:
 *  1. la clase se guardó recién y todavía no tiene su cargo (llamarla justo
 *     después de `useSaveClass`'s `save()`);
 *  2. la clase se guardó en una sesión anterior pero la escritura
 *     financiera falló en su momento (llamarla al iniciar la app).
 * Idempotente incluso ante llamadas concurrentes. Nunca inventa una
 * división para clases grupales sin desglose por alumno — esas se reportan
 * en `skipped` con `reason: 'grupal_sin_desglose'` para revisión manual, no
 * se les crea ningún cargo.
 */
export async function reconcilePerClassCharges(
  now: Date = new Date()
): Promise<PerClassChargeReconciliationOutcome> {
  await hydrateSavedLessons();
  const lessons = getSavedLessons();
  return reconcileChargesForLessons(lessons, lookupBilling, now.toISOString());
}
