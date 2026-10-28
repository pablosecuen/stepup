// Puerto VERBATIM del original (`src/features/student-profile/hooks/useStudentSessionHistory.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useCallback, useEffect, useState } from '../../../shims/react.ts';
import { getSavedLessons, hydrateSavedLessons } from '../../new-class/hooks/savedLessonsStore.ts';
import { buildStudentSessionHistory, type StudentSessionHistoryEntry } from '../../new-class/utils/studentSessionHistory.ts';

function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): lista de clases pasadas del alumno para "Corrección
 * manual post-clase" en `ClasesTab.tsx`. Expone `refetch` para refrescar
 * después de guardar una corrección.
 */
export function useStudentSessionHistory(studentId: string): {
  entries: StudentSessionHistoryEntry[];
  refetch: () => void;
} {
  const [entries, setEntries] = useState<StudentSessionHistoryEntry[]>([]);

  const load = useCallback(() => {
    let cancelled = false;
    void hydrateSavedLessons().then(() => {
      if (cancelled) return;
      setEntries(buildStudentSessionHistory(getSavedLessons(), studentId, todayDateKey()));
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  useEffect(() => load(), [load]);

  const refetch = useCallback(() => {
    load();
  }, [load]);

  return { entries, refetch };
}
