// Puerto VERBATIM del original (`src/features/student-profile/hooks/useStudentPunctuality.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useCallback, useEffect, useState } from '../../../shims/react.ts';
import { getSavedLessons, hydrateSavedLessons } from '../../new-class/hooks/savedLessonsStore.ts';
import { buildPunctualityScoreEntriesForStudent } from '../../new-class/utils/punctualityScoreEntries.ts';
import { buildPunctualitySummary, type PunctualitySummary } from '../../new-class/utils/punctualityScoring.ts';

function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): sección "Puntualidad" del perfil del alumno —
 * scoring INDEPENDIENTE del financiero, nunca combinado con "Comportamiento
 * de pago". Expone `refetch` para que una corrección manual post-clase
 * (`ManualSessionCorrectionSheet`) pueda refrescar el resumen sin remontar
 * toda la pestaña.
 */
export function useStudentPunctuality(studentId: string): { summary: PunctualitySummary | null; refetch: () => void } {
  const [summary, setSummary] = useState<PunctualitySummary | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    void hydrateSavedLessons().then(() => {
      if (cancelled) return;
      const entries = buildPunctualityScoreEntriesForStudent(getSavedLessons(), studentId, todayDateKey());
      setSummary(buildPunctualitySummary(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  useEffect(() => load(), [load]);

  const refetch = useCallback(() => {
    load();
  }, [load]);

  return { summary, refetch };
}
