// Puerto VERBATIM del original (`src/features/students/hooks/rescheduleCancellationNoticeStore.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import AsyncStorage from '../../../shims/async-storage.ts';

/**
 * Decisión de producto de Joaquín (2026-07-16): cuando reprogramar una
 * clase choca con el horario de otro alumno y la profesora elige
 * "Eliminar y reemplazar", esa clase del otro alumno se cancela (nunca se
 * borra) — pero además queda un aviso visible en el perfil de ESE alumno
 * ("Clase cancelada el [fecha]") para que la profesora, si todavía no le
 * avisó, se acuerde de hacerlo; y si ya le avisó, pueda descartarlo para
 * que no siga apareciendo.
 *
 * Clave propia, separada del dominio de calendario/pagos: es sólo una
 * cola de avisos de UI, nunca una fuente de verdad de qué pasó con la
 * clase (eso ya lo registra `RecurrenceException`/`CalendarLesson.status`
 * de forma completa e irreversible). Perder esta cola en una restauración
 * sólo significa que el aviso deja de mostrarse — nunca una pérdida de
 * información real sobre la clase cancelada en sí.
 */
const STORAGE_KEY = '@teacherflow/reschedule_cancellation_notices';

export interface RescheduleCancellationNotice {
  id: string;
  studentId: string;
  /** Fecha/hora original de la clase que se canceló por el choque de horario. */
  cancelledLessonStartIso: string;
  createdAt: string;
}

function isValidNotice(value: unknown): value is RescheduleCancellationNotice {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.studentId === 'string' &&
    candidate.studentId.length > 0 &&
    typeof candidate.cancelledLessonStartIso === 'string' &&
    !Number.isNaN(new Date(candidate.cancelledLessonStartIso).getTime()) &&
    typeof candidate.createdAt === 'string' &&
    !Number.isNaN(new Date(candidate.createdAt).getTime())
  );
}

/**
 * Parseo puro, separado de AsyncStorage para poder probarlo sin runtime de
 * React Native. Cualquier entrada corrupta o con forma inválida se
 * descarta en silencio (mismo criterio que `dailyCollectionsNoticeStore`:
 * es sólo una cola de avisos de UI, el peor caso es perder un aviso
 * pendiente, nunca un dato real).
 */
export function parsePersistedRescheduleCancellationNotices(raw: string | null): RescheduleCancellationNotice[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidNotice);
}

export async function loadRescheduleCancellationNotices(): Promise<RescheduleCancellationNotice[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return parsePersistedRescheduleCancellationNotices(raw);
  } catch {
    return [];
  }
}

export async function saveRescheduleCancellationNotices(notices: RescheduleCancellationNotice[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(notices));
}

/** Función pura: agrega un aviso nuevo al final de la lista actual. */
export function addRescheduleCancellationNotice(
  current: RescheduleCancellationNotice[],
  notice: RescheduleCancellationNotice
): RescheduleCancellationNotice[] {
  return [...current, notice];
}

/** Función pura: descarta un aviso por id — nunca afecta a los demás. */
export function dismissRescheduleCancellationNotice(
  current: RescheduleCancellationNotice[],
  id: string
): RescheduleCancellationNotice[] {
  return current.filter((notice) => notice.id !== id);
}

/** Función pura: sólo los avisos de un alumno puntual, más recientes primero. */
export function noticesForStudent(
  current: RescheduleCancellationNotice[],
  studentId: string
): RescheduleCancellationNotice[] {
  return current
    .filter((notice) => notice.studentId === studentId)
    .sort((first, second) => (first.createdAt < second.createdAt ? 1 : -1));
}
