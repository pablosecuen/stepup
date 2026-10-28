// Puerto VERBATIM del original (`src/features/payments/hooks/useCollectionsCenter.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useEffect, useMemo, useReducer } from '../../../shims/react.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { buildCollectionsCenterEntries, type CollectionEntry } from '../utils/collectionsCenter.ts';
import { getPaymentsSnapshot, subscribePayments } from './paymentsStore.ts';
import { getStudentsStore, subscribeStudents } from '../../students/hooks/studentStore.ts';
import { getFirstMonthProrationDecisionsSnapshot, subscribeFirstMonthProrationDecisions } from './firstMonthProrationDecisionStore.ts';
import { useSurchargeSettings } from './useSurchargeSettings.ts';

export interface CollectionEntryWithStudent extends CollectionEntry {
  studentName: string;
}

/**
 * Centro de cobros (Fase Pagos 4C.2): se suscribe al store de pagos (para
 * actualizarse de inmediato ante cualquier pago, anulación o cargo nuevo —
 * por ejemplo, apenas se cierra el formulario de "Registrar pago") y al de
 * alumnos (sólo para resolver el nombre a mostrar; el motor de pagos en sí
 * no conoce nombres, sólo `studentId`). Usa la fecha de Buenos Aires. Nunca
 * persiste nada: se recalcula por completo en cada notificación.
 *
 * Un alumno eliminado no debería tener cargos vigentes (la eliminación
 * definitiva borra su historial financiero también — Fase Pagos 4B.1), pero
 * por las dudas se omite acá cualquier entrada cuyo alumno ya no exista, en
 * vez de mostrarla sin nombre o con su `studentId` crudo.
 */
export function useCollectionsCenter(): CollectionEntryWithStudent[] {
  const [tick, notifyChanged] = useReducer((count: number) => count + 1, 0);
  const surchargeSettings = useSurchargeSettings();

  useEffect(() => {
    const unsubscribePayments = subscribePayments(notifyChanged);
    const unsubscribeStudents = subscribeStudents(notifyChanged);
    // Corrección 2026-08-27, tercera ronda: apenas la profesora confirma
    // "Revisar primer mes proporcional" (source: 'manual'), esta lista debe
    // dejar de mostrar la acción de inmediato — misma reactividad que ya
    // tienen pagos/alumnos, nunca hace falta cerrar y reabrir la pantalla.
    const unsubscribeDecisions = subscribeFirstMonthProrationDecisions(notifyChanged);
    return () => {
      unsubscribePayments();
      unsubscribeStudents();
      unsubscribeDecisions();
    };
  }, []);

  return useMemo(() => {
    const evaluationDate = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
    const studentsById = new Map(getStudentsStore().map((student) => [student.id, student]));
    // Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
    // CIRCUITO DE COBROS): el estado ACTUAL de cada alumno viaja acá para
    // que `buildCollectionsCenterEntries` nunca muestre el cargo de un
    // alumno que no está `'activo'`, sin importar su saldo/etapa.
    const studentStatusById = new Map(
      Array.from(studentsById.entries()).map(([id, student]) => [id, student.status])
    );
    const entries = buildCollectionsCenterEntries({
      state: getPaymentsSnapshot(),
      evaluationDate,
      surchargeSettings,
      firstMonthProrationDecisions: getFirstMonthProrationDecisionsSnapshot(),
      studentStatusById,
    });
    return entries.flatMap((entry): CollectionEntryWithStudent[] => {
      const student = studentsById.get(entry.studentId);
      if (!student) return [];
      return [{ ...entry, studentName: student.name }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, surchargeSettings]);
}
