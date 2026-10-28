// Puerto VERBATIM del original (`src/features/payments/hooks/useStudentPaymentHistory.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useEffect, useMemo, useReducer, useState } from '../../../shims/react.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { buildStudentPaymentHistory, type StudentPaymentHistory } from '../utils/studentPaymentHistory.ts';
import { getPaymentsSnapshot, hydratePaymentsStore, subscribePayments } from './paymentsStore.ts';

export interface UseStudentPaymentHistoryResult extends StudentPaymentHistory {
  /** false mientras el store de pagos todavía no terminó de hidratar. */
  isReady: boolean;
}

/**
 * Hook público de sólo lectura para el apartado "Historial de pagos" de
 * Cobros (Fase Pagos 4C.1): hidrata el store de pagos (si hace falta), se
 * suscribe a sus cambios, y recalcula el historial de los últimos 12 meses
 * con el motor puro en cada notificación — nunca guarda el historial ni
 * ninguna estadística derivada, todo se deriva en el momento a partir de
 * `PaymentCharge`/`Payment`/`PaymentAllocation`/`PaymentAdjustment`. Mismo
 * patrón que `useStudentPayments`.
 */
export function useStudentPaymentHistory(studentId: string): UseStudentPaymentHistoryResult {
  const [isReady, setIsReady] = useState(false);
  const [tick, forceRecompute] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    let active = true;
    hydratePaymentsStore()
      .then(() => {
        if (active) setIsReady(true);
      })
      .catch(() => {
        // Silencioso a propósito: la hidratación de pagos ya se resuelve
        // (con pantalla de error y reintento) a nivel de App.tsx antes de
        // que cualquier pantalla que use este hook llegue a montarse.
      });
    const unsubscribe = subscribePayments(forceRecompute);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return useMemo(() => {
    const evaluationDate = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
    const history = buildStudentPaymentHistory({ studentId, state: getPaymentsSnapshot(), evaluationDate });
    return { ...history, isReady };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, isReady, tick]);
}
