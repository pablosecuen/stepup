// Puerto VERBATIM del original (`src/features/calendar/hooks/teacherAvailabilityStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';
import type { TeacherAvailability } from '../types/teacherAvailability.ts';

export const TEACHER_AVAILABILITY_STORAGE_KEY = '@teacherflow/teacher_availability_v1';
export const DEFAULT_TEACHER_AVAILABILITY: TeacherAvailability = {
  schemaVersion: 1,
  timezone: 'America/Argentina/Buenos_Aires',
  weeklyBlocks: [],
  exceptions: [],
};

type Listener = () => void;
const listeners = new Set<Listener>();
let current: TeacherAvailability = DEFAULT_TEACHER_AVAILABILITY;
let hydrationPromise: Promise<TeacherAvailability> | null = null;

function clone(value: TeacherAvailability): TeacherAvailability {
  return {
    ...value,
    weeklyBlocks: value.weeklyBlocks.map((block) => ({ ...block })),
    exceptions: value.exceptions.map((exception) => ({ ...exception })),
  };
}

function isTeacherAvailability(value: unknown): value is TeacherAvailability {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TeacherAvailability>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.timezone === 'string' &&
    Array.isArray(candidate.weeklyBlocks) &&
    Array.isArray(candidate.exceptions)
  );
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getTeacherAvailability(): TeacherAvailability {
  return clone(current);
}

export async function hydrateTeacherAvailability(): Promise<TeacherAvailability> {
  if (!hydrationPromise) {
    hydrationPromise = AsyncStorage.getItem(TEACHER_AVAILABILITY_STORAGE_KEY).then((stored) => {
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isTeacherAvailability(parsed)) current = clone(parsed);
      }
      notify();
      return getTeacherAvailability();
    });
  }
  return hydrationPromise!;
}

export async function replaceTeacherAvailability(
  next: TeacherAvailability
): Promise<void> {
  if (!isTeacherAvailability(next)) throw new Error('Disponibilidad docente inválida.');
  const previous = current;
  current = clone(next);
  notify();
  try {
    await AsyncStorage.setItem(TEACHER_AVAILABILITY_STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    current = previous;
    notify();
    throw error;
  }
}

export function subscribeTeacherAvailability(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Igual que `replaceTeacherAvailability` pero sin persistir: sólo actualiza
 * la copia en memoria y notifica a los suscriptores. Pensada para cuando la
 * persistencia ya ocurrió por otra vía (por ejemplo, la escritura atómica
 * de una restauración de respaldo) y sólo falta sincronizar este store.
 */
export function setTeacherAvailabilityInMemory(next: TeacherAvailability): void {
  if (!isTeacherAvailability(next)) throw new Error('Disponibilidad docente inválida.');
  current = clone(next);
  notify();
}

export function resetTeacherAvailabilityHydrationForTests(): void {
  hydrationPromise = null;
  current = DEFAULT_TEACHER_AVAILABILITY;
}
