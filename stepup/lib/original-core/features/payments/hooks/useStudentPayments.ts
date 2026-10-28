// Puerto VERBATIM del original (`src/features/payments/hooks/useStudentPayments.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useEffect, useMemo, useReducer, useState } from '../../../shims/react.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { buildStudentPaymentsSummary, type StudentPaymentsSummary } from '../utils/studentPaymentsSummary.ts';
import { getPaymentsSnapshot, hydratePaymentsStore, subscribePayments } from './paymentsStore.ts';
import { useSurchargeSettings } from './useSurchargeSettings.ts';

export interface UseStudentPaymentsResult extends StudentPaymentsSummary {
  /** false mientras el store de pagos todavía no terminó de hidratar. */
  isReady: boolean;
}

/**
 * Hook público de sólo lectura para Cobros: hidrata el store de pagos (si
 * hace falta), se suscribe a sus cambios, y recalcula el resumen del
 * alumno con el motor puro en cada notificación — nunca guarda saldos,
 * recargos ni scoring, todo se deriva en el momento. Si la hidratación
 * falla, `isReady` queda en `false` (la pantalla de error de hidratación a
 * nivel de app ya se encarga de eso; este hook no reintenta por su cuenta).
 */
export function useStudentPayments(studentId: string): UseStudentPaymentsResult {
  const [isReady, setIsReady] = useState(false);
  const [tick, forceRecompute] = useReducer((count: number) => count + 1, 0);
  const surchargeSettings = useSurchargeSettings();

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
    const summary = buildStudentPaymentsSummary({
      studentId,
      state: getPaymentsSnapshot(),
      evaluationDate,
      surchargeSettings,
    });
    return { ...summary, isReady };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, isReady, tick, surchargeSettings]);
}
