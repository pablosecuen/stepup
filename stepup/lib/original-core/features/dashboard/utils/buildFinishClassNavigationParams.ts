// Puerto VERBATIM del original (`src/features/dashboard/utils/buildFinishClassNavigationParams.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ActiveClassSession } from '../hooks/activeClassSessionStore.ts';
import type { CalendarLessonRegistration } from '../../calendar/types/index.ts';
import type { ClassSessionMeta } from '../../new-class/types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, cuarta ronda): arma los
 * parámetros de navegación hacia "Nueva clase" a partir de una sesión
 * activa terminada — extraído de `HomeScreen.handleFinishClass` para que
 * "Cerrar clase manualmente" (desde el diálogo de bloqueo al desactivar el
 * seguimiento en Cuenta) arme EXACTAMENTE el mismo bundle, sin duplicar la
 * lógica en dos lugares que podrían desincronizarse.
 *
 * El tipo de retorno se declara localmente (en vez de tomar
 * `RootStackParamList['NewClass']` de `RootNavigator.tsx`) a propósito:
 * este archivo es puro y se prueba bajo `tsconfig.dashboard-tests.json`,
 * que no configura `jsx` — importar un tipo desde un `.tsx` con JSX real
 * rompe esa compilación aunque el import sea `import type`. Ambos objetos
 * son estructuralmente compatibles; TypeScript los acepta igual en
 * `navigation.navigate('NewClass', ...)`.
 */
export interface FinishClassNavigationParams {
  studentId: string;
  calendarRegistration?: CalendarLessonRegistration;
  initialActualDurationMinutes?: number;
  sessionMeta: ClassSessionMeta;
}

export function buildFinishClassNavigationParams(
  session: ActiveClassSession,
  actualEndedAt: string,
  elapsedMinutes: number | null
): FinishClassNavigationParams {
  return {
    studentId: session.studentId,
    calendarRegistration: session.calendarRegistration ?? undefined,
    initialActualDurationMinutes: elapsedMinutes ?? undefined,
    sessionMeta: {
      scheduledStartAt: session.scheduledStartAt,
      effectiveStartAt: session.effectiveStartAt,
      actualStartedAt: session.startedAt,
      actualEndedAt,
      scheduleAdjustment: session.scheduleAdjustment,
      studentArrival: session.studentArrival,
      startSource: session.startSource,
    },
  };
}
