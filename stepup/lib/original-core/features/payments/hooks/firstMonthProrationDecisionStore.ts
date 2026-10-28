// Puerto VERBATIM del original (`src/features/payments/hooks/firstMonthProrationDecisionStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { FirstMonthProrationDecision } from '../types/index.ts';
import { isValidBillingPeriod } from '../utils/paymentDates.ts';

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional): registro de
 * las decisiones tomadas en el panel "Primer mes de [alumno]" — mismo
 * patrón mínimo (lectura/escritura directa, sin cola de mutaciones ni
 * rollback) que `monthlyAmountCorrectionLogStore.ts`: es un registro
 * histórico/auditable, nunca la fuente de verdad del saldo real (esa sigue
 * siendo `PaymentCharge.originalAmount` cuando existe un cargo). Participa
 * del respaldo (best-effort, igual que el log de correcciones de monto).
 */
export const FIRST_MONTH_PRORATION_DECISION_LOG_STORAGE_KEY = '@teacherflow/first_month_proration_decisions';

function isValidFirstMonthProrationDecision(value: unknown): value is FirstMonthProrationDecision {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.studentId === 'string' &&
    candidate.studentId.trim().length > 0 &&
    typeof candidate.billingPeriod === 'string' &&
    isValidBillingPeriod(candidate.billingPeriod) &&
    typeof candidate.effectiveJoinDate === 'string' &&
    candidate.effectiveJoinDate.trim().length > 0 &&
    typeof candidate.criterion === 'string' &&
    ['proportional', 'full', 'custom', 'no_charge'].includes(candidate.criterion) &&
    typeof candidate.classesRemaining === 'number' &&
    Number.isFinite(candidate.classesRemaining) &&
    typeof candidate.classesPerFullPeriod === 'number' &&
    Number.isFinite(candidate.classesPerFullPeriod) &&
    typeof candidate.permanentMonthlyAmount === 'number' &&
    Number.isFinite(candidate.permanentMonthlyAmount) &&
    typeof candidate.chargedAmount === 'number' &&
    Number.isFinite(candidate.chargedAmount) &&
    (candidate.chargeId === null || typeof candidate.chargeId === 'string') &&
    typeof candidate.createdAt === 'string' &&
    !Number.isNaN(new Date(candidate.createdAt).getTime()) &&
    typeof candidate.confirmedAt === 'string' &&
    !Number.isNaN(new Date(candidate.confirmedAt).getTime()) &&
    // Corrección 2026-08-27: `source` es opcional y aditivo — ausente en
    // cualquier entrada persistida antes de esta corrección (o restaurada de
    // un respaldo viejo); si está presente, sólo estos dos valores son válidos.
    (candidate.source === undefined || candidate.source === 'manual' || candidate.source === 'automatic') &&
    // Corrección 2026-08-27, cuarta ronda: los tres campos de evidencia son
    // igual de opcionales y aditivos — ausentes en cualquier entrada de
    // antes de esta corrección; si están presentes, se valida su forma
    // mínima (nunca se acepta un valor con la forma equivocada).
    (candidate.recurrenceIds === undefined ||
      (Array.isArray(candidate.recurrenceIds) && candidate.recurrenceIds.every((item) => typeof item === 'string'))) &&
    (candidate.seriesPatternSnapshot === undefined ||
      (Array.isArray(candidate.seriesPatternSnapshot) && candidate.seriesPatternSnapshot.every(isValidSeriesPatternSnapshot))) &&
    (candidate.ruleVersion === undefined || (typeof candidate.ruleVersion === 'number' && Number.isFinite(candidate.ruleVersion)))
  );
}

function isValidSeriesPatternSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.recurrenceId === 'string' &&
    snapshot.recurrenceId.trim().length > 0 &&
    typeof snapshot.cycleLengthWeeks === 'number' &&
    Number.isFinite(snapshot.cycleLengthWeeks) &&
    Array.isArray(snapshot.weeks) &&
    snapshot.weeks.every((week) => {
      if (typeof week !== 'object' || week === null) return false;
      const w = week as Record<string, unknown>;
      return (
        typeof w.weekIndex === 'number' &&
        Number.isFinite(w.weekIndex) &&
        Array.isArray(w.sessions) &&
        w.sessions.every((session) => {
          if (typeof session !== 'object' || session === null) return false;
          const s = session as Record<string, unknown>;
          return (
            typeof s.weekday === 'number' &&
            Number.isFinite(s.weekday) &&
            typeof s.hour === 'number' &&
            Number.isFinite(s.hour) &&
            typeof s.minute === 'number' &&
            Number.isFinite(s.minute) &&
            typeof s.durationMinutes === 'number' &&
            Number.isFinite(s.durationMinutes)
          );
        })
      );
    })
  );
}

/** Parseo puro, separado de AsyncStorage para poder probarlo directamente. Una entrada corrupta se descarta sin invalidar el resto. */
export function parsePersistedFirstMonthProrationDecisionLog(raw: string | null): FirstMonthProrationDecision[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidFirstMonthProrationDecision);
}

export async function loadFirstMonthProrationDecisionLog(): Promise<FirstMonthProrationDecision[]> {
  try {
    const raw = await AsyncStorage.getItem(FIRST_MONTH_PRORATION_DECISION_LOG_STORAGE_KEY);
    return parsePersistedFirstMonthProrationDecisionLog(raw);
  } catch {
    return [];
  }
}

export async function saveFirstMonthProrationDecisionLog(entries: FirstMonthProrationDecision[]): Promise<void> {
  await AsyncStorage.setItem(FIRST_MONTH_PRORATION_DECISION_LOG_STORAGE_KEY, JSON.stringify(entries));
}

/** Agrega una entrada nueva al final del registro — nunca reemplaza ni borra las anteriores. */
export async function appendFirstMonthProrationDecision(entry: FirstMonthProrationDecision): Promise<void> {
  const current = await loadFirstMonthProrationDecisionLog();
  const next = [...current, entry];
  await saveFirstMonthProrationDecisionLog(next);
  // Corrección 2026-08-27, tercera ronda: mantiene el caché en memoria
  // (abajo) sincronizado con la escritura real — nunca al revés (la
  // escritura en AsyncStorage sigue siendo la única fuente de verdad; el
  // caché es sólo para lecturas sincrónicas rápidas, ver más abajo).
  cachedDecisions = next;
  cacheHydrated = true;
  notifyDecisionListeners();
}

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — HACER
// CORREGIBLE EL PRORRATEO HISTÓRICO MARCADO PARA REVISIÓN): mismo patrón
// hidratar/snapshot/suscribir que `paymentsStore.ts`/`studentStore.ts` —
// hasta ahora este registro sólo se leía con `loadFirstMonthProrationDecisionLog()`
// (async, un viaje a AsyncStorage por llamada). `useCollectionsCenter`/
// `CobrosTab.tsx` necesitan una lectura SINCRÓNICA reactiva (para calcular
// `findFirstMonthProrationReviewNeeds` en el mismo render que ya usa
// `getPaymentsSnapshot()`/`getStudentsStore()`) sin volver a tocar
// AsyncStorage en cada render. Deliberadamente SIN cola de mutaciones ni
// rollback (a diferencia de `paymentsStore.ts`): este registro es un
// historial auditable best-effort, nunca la fuente de verdad del saldo real
// — mismo criterio ya documentado arriba.
// ---------------------------------------------------------------------------

let cachedDecisions: FirstMonthProrationDecision[] = [];
let cacheHydrated = false;
let hydrationPromise: Promise<FirstMonthProrationDecision[]> | null = null;
const decisionListeners = new Set<() => void>();

function notifyDecisionListeners(): void {
  decisionListeners.forEach((listener) => listener());
}

/** Lee AsyncStorage UNA vez (llamadas concurrentes comparten la misma promesa) y puebla el caché en memoria. Reintenta en la próxima llamada si falla. */
export function hydrateFirstMonthProrationDecisions(): Promise<FirstMonthProrationDecision[]> {
  if (!hydrationPromise) {
    hydrationPromise = loadFirstMonthProrationDecisionLog()
      .then((entries) => {
        cachedDecisions = entries;
        cacheHydrated = true;
        notifyDecisionListeners();
        return cachedDecisions;
      })
      .catch((error) => {
        hydrationPromise = null;
        throw error;
      });
  }
  return hydrationPromise;
}

/** Snapshot sincrónico del último estado hidratado — `[]` hasta que `hydrateFirstMonthProrationDecisions()` resuelva por primera vez (nunca inventa datos mientras tanto). */
export function getFirstMonthProrationDecisionsSnapshot(): FirstMonthProrationDecision[] {
  return cachedDecisions;
}

export function isFirstMonthProrationDecisionsCacheHydrated(): boolean {
  return cacheHydrated;
}

export function subscribeFirstMonthProrationDecisions(listener: () => void): () => void {
  decisionListeners.add(listener);
  return () => decisionListeners.delete(listener);
}

/**
 * Sólo para pruebas — puebla el caché en memoria directamente (sin
 * AsyncStorage real), como si `hydrateFirstMonthProrationDecisions()` ya
 * hubiera resuelto con exactamente estas entradas. Notifica a los
 * suscriptores igual que una hidratación/escritura real, para poder probar
 * la reactividad (`useCollectionsCenter`/`CobrosTab.tsx`) sin AsyncStorage.
 */
export function replaceFirstMonthProrationDecisionsCacheForTests(entries: FirstMonthProrationDecision[]): void {
  cachedDecisions = entries;
  cacheHydrated = true;
  notifyDecisionListeners();
}

/** Sólo para pruebas — limpia el caché en memoria entre corridas, nunca toca AsyncStorage real. */
export function resetFirstMonthProrationDecisionsCacheForTests(): void {
  cachedDecisions = [];
  cacheHydrated = false;
  hydrationPromise = null;
}

/** La decisión más reciente para (alumno, período), si existe — usada para saber si ya se decidió el primer mes de este período. */
export function findFirstMonthProrationDecision(
  entries: FirstMonthProrationDecision[],
  studentId: string,
  billingPeriod: string
): FirstMonthProrationDecision | null {
  const matches = entries.filter((entry) => entry.studentId === studentId && entry.billingPeriod === billingPeriod);
  if (matches.length === 0) return null;
  return matches.reduce((latest, entry) => (entry.confirmedAt > latest.confirmedAt ? entry : latest));
}
