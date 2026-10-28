// Puerto VERBATIM del original (`src/features/students/hooks/useRescheduleCancellationNotices.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useCallback, useEffect, useState } from '../../../shims/react.ts';
import { dismissRescheduleCancellationNotice, loadRescheduleCancellationNotices, noticesForStudent, saveRescheduleCancellationNotices, type RescheduleCancellationNotice } from './rescheduleCancellationNoticeStore.ts';

export interface UseRescheduleCancellationNoticesResult {
  notices: RescheduleCancellationNotice[];
  /** "Entendido": la profesora ya avisó (o ya lo sabía) — descarta el aviso para que no siga apareciendo. */
  dismiss: (id: string) => void;
}

/**
 * Lee y descarta los avisos de "clase cancelada por reprogramación" de UN
 * alumno puntual (perfil del alumno). Quien AGREGA un aviso nuevo es
 * `CalendarTabScreen` (en el momento en que se elige "Eliminar y
 * reemplazar" al reprogramar) — este hook nunca escribe avisos nuevos,
 * sólo los lee y permite descartarlos, para no acoplar el perfil del
 * alumno con el flujo de reprogramación del Calendario.
 */
export function useRescheduleCancellationNotices(studentId: string): UseRescheduleCancellationNoticesResult {
  const [all, setAll] = useState<RescheduleCancellationNotice[]>([]);

  useEffect(() => {
    let active = true;
    loadRescheduleCancellationNotices().then((loaded) => {
      if (active) setAll(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setAll((current) => {
      const next = dismissRescheduleCancellationNotice(current, id);
      // No es crítico: si la escritura falla, el aviso simplemente vuelve
      // a aparecer en la próxima apertura — nunca se pierde información
      // real (la cancelación de la clase en sí ya quedó registrada aparte).
      void saveRescheduleCancellationNotices(next).catch(() => {});
      return next;
    });
  }, []);

  return { notices: noticesForStudent(all, studentId), dismiss };
}
