import { addDaysToDateKey, startOfIsoWeek } from "../payments/dates.ts";
import { instantDateKey } from "../calendar/civil-calendar.ts";
import { calculateAverageGrade } from "../lessons/grades.ts";

export interface HomeStats {
  activeStudents: number;
  lessonsThisWeek: number;
  /** Horas (1 decimal) de las clases dictadas este mes que tienen duración real registrada; `null` si no se pudieron leer. */
  hoursTaughtThisMonth: number | null;
  /** Promedio de TODAS las notas generales reales (1 decimal); `null` si no hay ninguna. */
  averageGrade: number | null;
}

/** Los tiempos de un registro de clase dictada: la duración real guardada (sólo la traen los traslados y la corrección de sesión) y los instantes real y programado. */
export interface RegisteredClassTimes {
  actualDurationMinutes: number | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
}

const minutesBetween = (startIso: string | null, endIso: string | null): number | null => {
  if (!startIso || !endIso) return null;
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

/**
 * Cuánto duró UNA clase dictada (una sola vez, sea individual, grupal o entrenamiento: nunca se multiplica por participante). Orden: la duración real guardada, la diferencia entre el
 * inicio y el fin reales (lo que escribe el registro de la web al finalizar) y, si no hay, la programada. Si ninguna existe devuelve `null` («sin dato»), nunca 0.
 * Es la misma resolución que usa el reporte del alumno. PURO.
 */
export function resolveClassMinutes(times: RegisteredClassTimes): number | null {
  if (times.actualDurationMinutes !== null && Number.isFinite(times.actualDurationMinutes) && times.actualDurationMinutes > 0) return times.actualDurationMinutes;
  return minutesBetween(times.actualStartedAt, times.actualEndedAt) ?? minutesBetween(times.scheduledStartAt, times.scheduledEndAt);
}

/**
 * Los minutos de las clases dictadas de UN mes civil de Argentina (`monthKey` AAAA-MM), una entrada por clase. El día de cada clase es el del instante en que se dictó: el inicio real, o el
 * programado, o el de alta. Una clase que termina cerca de medianoche cuenta en el mes de su inicio. `null` = clase dictada sin ninguna duración conocida. PURO.
 */
export function monthMinutesOf(rows: ReadonlyArray<RegisteredClassTimes & { createdAt: string }>, monthKey: string): Array<number | null> {
  return rows.filter((row) => instantDateKey(row.actualStartedAt ?? row.scheduledStartAt ?? row.createdAt).slice(0, 7) === monthKey).map((row) => resolveClassMinutes(row));
}

/** Semana de Inicio: de lunes a domingo, con los días civiles de Argentina (mismo criterio de semana que el original). Devuelve el lunes y el lunes siguiente (fin exclusivo). */
export function weekBounds(todayDateKey: string): { startKey: string; endExclusiveKey: string } {
  const startKey = startOfIsoWeek(todayDateKey);
  return { startKey, endExclusiveKey: addDaysToDateKey(startKey, 7) };
}

/**
 * Indicadores de Inicio — puerto de `buildDashboardData` (original): alumnos activos; clases de la semana sin contar las canceladas; horas enseñadas este mes (clases dictadas que cuentan como
 * clase, una vez cada una, suma de su duración resuelta con `resolveClassMinutes`, redondeada a 1 decimal); promedio de evaluaciones (todas las notas generales reales, un 0 o la ausencia de nota nunca cuenta).
 */
export function buildHomeStats(input: {
  activeStudents: number;
  weekItems: ReadonlyArray<{ status: string }>;
  monthMinutes: ReadonlyArray<number | null>;
  grades: ReadonlyArray<number | null>;
}): HomeStats {
  const taughtMinutes = input.monthMinutes.reduce<number>((total, minutes) => total + (minutes ?? 0), 0);
  // Hay clases dictadas este mes pero ninguna con duración conocida: «Sin datos», nunca un 0 que parezca real. Sin clases dictadas, 0 h es la verdad.
  const unmeasuredOnly = input.monthMinutes.length > 0 && input.monthMinutes.every((minutes) => minutes === null);
  return {
    activeStudents: input.activeStudents,
    lessonsThisWeek: input.weekItems.filter((item) => item.status !== "cancelled").length,
    hoursTaughtThisMonth: unmeasuredOnly ? null : Math.round((taughtMinutes / 60) * 10) / 10,
    averageGrade: calculateAverageGrade([...input.grades]),
  };
}
