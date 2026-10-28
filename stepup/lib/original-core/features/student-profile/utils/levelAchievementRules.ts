// Puerto VERBATIM del original (`src/features/student-profile/utils/levelAchievementRules.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CEFRLevel, LevelHistoryEntry } from '../types/index.ts';
import { isValidDateKey, toDateKey } from '../../payments/utils/paymentDates.ts';
import { daysBetween, levelStepDistance } from './cefrLevel.ts';

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel):
 * planificador PURO (nunca toca AsyncStorage/Supabase/React) — mismo
 * patrón ya establecido en `monthlyAmountCorrection.ts`/`registerPaymentPlan.ts`:
 * separar la decisión (qué entrada crear, si hay que confirmar algo, qué
 * error mostrar) de la persistencia real (`useStudentProfile.ts`), para
 * poder probar la lógica de negocio con datos ficticios en memoria, sin
 * ningún adaptador real.
 */

export type LevelAchievementErrorCode =
  | 'same_level'
  | 'future_date'
  | 'before_start'
  | 'incoherent_sequence'
  | 'invalid_date';

export class LevelAchievementError extends Error {
  code: LevelAchievementErrorCode;
  constructor(code: LevelAchievementErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'LevelAchievementError';
  }
}

export interface LevelAchievementWarning {
  kind: 'downgrade' | 'jump';
  fromLevel: CEFRLevel;
  toLevel: CEFRLevel;
  /** Cantidad de niveles de diferencia (siempre positivo, con signo ya resuelto por `kind`). */
  steps: number;
}

export interface PlanLevelAchievementInput {
  currentLevel: CEFRLevel;
  /** Historial existente, en orden cronológico (el mismo array tal como vive en `profile.levelHistory`). */
  history: LevelHistoryEntry[];
  /**
   * Fecha de inicio pedagógico del alumno (`profile.dateJoined`) — base
   * para calcular la duración del PRIMER logro. `null`/inválida si no hay
   * una fecha de inicio confiable (nunca se inventa una).
   */
  dateJoined: string | null | undefined;
  toLevel: CEFRLevel;
  /** ISO o `YYYY-MM-DD` — fecha REAL en la que el alumno alcanzó el nivel (nunca la fecha de carga tardía). */
  achievedAt: string;
  note?: string;
  /** Momento real de guardado (para `recordedAt` y para "no permitir fechas futuras") — inyectado, nunca `new Date()` interno, para que el planificador sea puro y testeable. */
  now: Date;
}

export interface PlanLevelAchievementResult {
  entry: LevelHistoryEntry;
  nextLevel: CEFRLevel;
  nextHistory: LevelHistoryEntry[];
  warning: LevelAchievementWarning | null;
}

function lastEntry(history: LevelHistoryEntry[]): LevelHistoryEntry | null {
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * Nunca lanza para "advertir" (salto o corrección hacia abajo) — eso se
 * devuelve en `warning` para que la UI pida confirmación explícita antes
 * de llamar de nuevo. Sólo lanza `LevelAchievementError` para los casos
 * que la tarea pide RECHAZAR sin excepción (mismo nivel, fecha futura,
 * fecha anterior al inicio, secuencia incoherente).
 */
export function planLevelAchievement(input: PlanLevelAchievementInput): PlanLevelAchievementResult {
  const { currentLevel, history, dateJoined, toLevel, note, now } = input;

  const achievedAtKey = toDateKey(input.achievedAt);
  if (!isValidDateKey(achievedAtKey)) {
    throw new LevelAchievementError('invalid_date', 'La fecha del logro no es válida.');
  }

  if (toLevel === currentLevel) {
    throw new LevelAchievementError('same_level', 'El alumno ya está en ese nivel — elegí un nivel distinto.');
  }

  const todayKey = toDateKey(now.toISOString());
  if (achievedAtKey > todayKey) {
    throw new LevelAchievementError('future_date', 'La fecha del logro no puede ser futura.');
  }

  const previous = lastEntry(history);
  const previousMilestoneAt = previous ? toDateKey(previous.date) : null;

  // Nunca permitir que la secuencia quede temporalmente incoherente: un
  // logro nuevo no puede fecharse ANTES que el último ya registrado.
  if (previousMilestoneAt && achievedAtKey < previousMilestoneAt) {
    throw new LevelAchievementError(
      'incoherent_sequence',
      'La fecha del logro no puede ser anterior al último logro ya registrado.'
    );
  }

  const dateJoinedKey = dateJoined ? toDateKey(dateJoined) : null;
  const hasValidStart = Boolean(dateJoinedKey && isValidDateKey(dateJoinedKey));

  // Sin logros previos: la fecha del logro no puede ser anterior al
  // comienzo real del alumno (si tenemos una fecha de inicio confiable).
  if (!previousMilestoneAt && hasValidStart && achievedAtKey < (dateJoinedKey as string)) {
    throw new LevelAchievementError(
      'before_start',
      'La fecha del logro no puede ser anterior a la fecha de inicio del alumno.'
    );
  }

  const baselineDate = previousMilestoneAt ?? (hasValidStart ? (dateJoinedKey as string) : null);
  const durationDays = baselineDate ? daysBetween(baselineDate, achievedAtKey) : null;

  // Corrección (a pedido de Joaquín — niveles personalizados):
  // `levelStepDistance` devuelve `null` cuando `currentLevel`/`toLevel` no
  // son ambos uno de los 6 niveles CEFR reales (uno de los dos, o los dos,
  // es un nivel personalizado) — en ese caso nunca hay advertencia de
  // salto/corrección, porque ese concepto no existe fuera de la escala
  // CEFR real.
  const steps = levelStepDistance(currentLevel, toLevel);
  const warning: LevelAchievementWarning | null =
    steps !== null && steps < 0
      ? { kind: 'downgrade', fromLevel: currentLevel, toLevel, steps: Math.abs(steps) }
      : steps !== null && steps > 1
        ? { kind: 'jump', fromLevel: currentLevel, toLevel, steps }
        : null;

  const entry: LevelHistoryEntry = {
    id: `levelup_${now.getTime()}_${history.length}`,
    level: toLevel,
    date: achievedAtKey,
    fromLevel: currentLevel,
    recordedAt: now.toISOString(),
    previousMilestoneAt: baselineDate,
    durationDays,
    note: note?.trim() ? note.trim() : undefined,
    origin: 'manual',
  };

  return {
    entry,
    nextLevel: toLevel,
    nextHistory: [...history, entry],
    warning,
  };
}
