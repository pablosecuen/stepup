// Puerto VERBATIM del original (`src/features/dashboard/hooks/activeClassSessionStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLessonRegistration, ScheduleAdjustment } from '../../calendar/types/index.ts';
import type { ClassStartSource, StudentArrival } from '../../new-class/types/index.ts';
import { loadActiveClassSession, saveActiveClassSession } from '../../../shared/storage/teacherFlowStorage.ts';

/**
 * Corrección 2026-07-17 (a pedido de Joaquín): "clase en curso" — al tocar
 * "Comenzar clase" arranca un contador visible en Inicio (y, más adelante,
 * en una notificación de Android) con el tiempo asignado restante. Mismo
 * patrón de hidratación perezosa que el resto de los stores de esta app
 * (`savedLessonsStore.ts`, `materialsLibraryStore.ts`), pero con un único
 * valor (nunca hay más de una clase "en curso" a la vez) en vez de una
 * colección.
 *
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda): se suman
 * `scheduledStartAt`/`effectiveStartAt`/`scheduleAdjustment`/
 * `studentArrival`/`startSource` para transportar el ciclo real de la
 * clase (horario original vs. efectivo, respuesta de puntualidad) hasta
 * el momento de "Finalizar clase", donde se vuelca todo al registro
 * pedagógico definitivo — nunca se pierde esta información entremedio.
 */
export interface ActiveClassSession {
  lessonId: string;
  studentId: string;
  studentNames: string[];
  scheduledDurationMinutes: number;
  startedAt: string; // ISO — actualStartedAt real
  calendarRegistration: CalendarLessonRegistration | null;
  scheduledStartAt: string; // ISO — horario originalmente agendado
  effectiveStartAt: string; // ISO — horario efectivo (tras un ajuste, si lo hubo)
  scheduleAdjustment?: ScheduleAdjustment;
  studentArrival: StudentArrival;
  startSource: ClassStartSource;
}

let activeSession: ActiveClassSession | null = null;
let hydrationPromise: Promise<void> | null = null;
let hydrated = false;

export function getActiveClassSession(): ActiveClassSession | null {
  return activeSession ? { ...activeSession } : null;
}

/**
 * Una sesión persistida ANTES de esta fase no tiene los campos nuevos —
 * se completan con valores seguros (nunca se descarta la sesión en curso
 * por esto): el horario efectivo se asume igual al real de inicio, sin
 * ajuste, y la llegada queda "unknown" (nunca se inventa que llegó a
 * horario ni que llegó tarde).
 */
function withLegacyDefaults(saved: Partial<ActiveClassSession> & Pick<ActiveClassSession, 'lessonId' | 'studentId' | 'studentNames' | 'scheduledDurationMinutes' | 'startedAt' | 'calendarRegistration'>): ActiveClassSession {
  return {
    ...saved,
    scheduledStartAt: saved.scheduledStartAt ?? saved.startedAt,
    effectiveStartAt: saved.effectiveStartAt ?? saved.startedAt,
    studentArrival: saved.studentArrival ?? { status: 'unknown', lateMinutes: 0, manuallyCorrected: false },
    startSource: saved.startSource ?? 'button',
  };
}

export function hydrateActiveClassSession(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = loadActiveClassSession<ActiveClassSession>().then((saved) => {
      if (saved && !hydrated) {
        activeSession = withLegacyDefaults(saved);
      }
      hydrated = true;
    });
  }
  return hydrationPromise;
}

export async function startClassSession(session: ActiveClassSession): Promise<void> {
  activeSession = session;
  await saveActiveClassSession(session);
}

/**
 * "Corregir hora de inicio" desde la tarjeta de clase en curso — la
 * profesora puede haberse olvidado de tocar "Comenzar clase" a tiempo.
 * Nunca toca `effectiveStartAt` (el horario efectivo no cambia); sólo el
 * inicio real registrado, con `startSource: 'manual_correction'`.
 */
export async function correctActiveClassSessionStart(newStartedAt: string): Promise<void> {
  if (!activeSession) return;
  const corrected: ActiveClassSession = { ...activeSession, startedAt: newStartedAt, startSource: 'manual_correction' };
  activeSession = corrected;
  await saveActiveClassSession(corrected);
}

export async function clearActiveClassSession(): Promise<void> {
  activeSession = null;
  await saveActiveClassSession(null);
}
