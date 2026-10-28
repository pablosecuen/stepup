// Puerto VERBATIM del original (`src/features/students/hooks/useFilteredStudents.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useMemo } from '../../../shims/react.ts';
import type {
  StudentListItem,
  StudentsFilterState,
} from '../types/index.ts';
import { matchesStudentSearch } from '../../../shared/utils/studentSearch.ts';
import { resolveDisplayableNextClassAt } from '../../calendar/utils/calendarNextClassAt.ts';

export function useFilteredStudents(
  students: StudentListItem[],
  filters: StudentsFilterState
): StudentListItem[] {
  return useMemo(() => {
    const query = filters.search.trim();

    const filtered = students.filter((student) => {
      if (
        query &&
        !matchesStudentSearch(student.name, query)
      ) {
        return false;
      }

      if (
        filters.level !== 'todos' &&
        !student.levels.includes(filters.level)
      ) {
        return false;
      }

      if (
        filters.modality !== 'todos' &&
        student.modality !== filters.modality
      ) {
        return false;
      }

      if (
        filters.paymentStatus !== 'todos' &&
        student.paymentStatus !== filters.paymentStatus
      ) {
        return false;
      }

      if (
        filters.status !== 'todos' &&
        student.status !== filters.status
      ) {
        return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (filters.sortBy) {
        case 'proxima_clase': {
          // Corrección P0 (a pedido de Joaquín — "próxima clase" pasada y
          // recurrencias futuras ausentes): un `nextClassAt` vencido/no
          // futuro se trata igual que ausente — nunca ordena como si fuera
          // una clase próxima real.
          const nextA = resolveDisplayableNextClassAt(a.nextClassAt, new Date(), a.nextClassEndAt ?? null);
          const nextB = resolveDisplayableNextClassAt(b.nextClassAt, new Date(), b.nextClassEndAt ?? null);
          if (!nextA && !nextB) return 0;
          if (!nextA) return 1;
          if (!nextB) return -1;

          return (
            new Date(nextA).getTime() -
            new Date(nextB).getTime()
          );
        }

        case 'ultimo_pago': {
          if (!a.lastPaymentAt && !b.lastPaymentAt) return 0;
          if (!a.lastPaymentAt) return 1;
          if (!b.lastPaymentAt) return -1;

          return (
            new Date(b.lastPaymentAt).getTime() -
            new Date(a.lastPaymentAt).getTime()
          );
        }

        case 'nombre':
        default:
          return a.name.localeCompare(b.name, 'es', {
            sensitivity: 'base',
          });
      }
    });
  }, [students, filters]);
}